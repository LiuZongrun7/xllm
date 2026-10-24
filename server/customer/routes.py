"""
顾客端 —— 页面与接口（负责人：A）
================================================================================
这是顾客端的**全部代码入口**。答辩时只需要打开这一行下面这几个文件：

    customer/routes.py                 ← 本文件：页面路由 + 顾客侧接口
    customer/templates/customer/       ← 顾客端页面（Jinja2）
    customer/static/css/customer.css   ← 顾客端设计系统（与另两端零共享）
    customer/static/js/customer.js     ← 顾客端交互

只依赖 shared/ 里的数据模型、权限装饰器与订单状态机，不碰商家端和骑手端的任何东西。

页面前缀   /customer/...           → pages
接口前缀   /api/customer/...       → api

页面
    /login /register               登录注册
    /                              首页：附近餐厅 + 进行中的订单
    /search                        搜索餐厅 / 菜品
    /restaurant/<id>               餐厅菜单
    /cart                          购物车（数据在 localStorage，服务端只算价）
    /checkout                      结算：地址 + 距离校验 + 模拟支付
    /orders                        我的订单
    /orders/<id>                   订单进度 / 取消 / 评价
    /addresses                     地址簿
    /account                       个人资料

接口
    浏览    GET    /restaurants            GET /restaurants/<id>    GET /search
    地址    GET    /addresses              POST /addresses
            DELETE /addresses/<id>         POST /addresses/<id>/default
    下单    POST   /orders
    订单    GET    /orders                 GET /orders/<id>
            POST   /orders/<id>/cancel     POST /orders/<id>/review
    资料    GET    /profile                PATCH /profile
    配置    GET    /config                 （高德 Key 给前端按需加载地图）
================================================================================
"""

from datetime import datetime, timedelta
from decimal import Decimal

from flask import Blueprint, current_app, render_template, request

from shared.catalog import cuisine_emoji, dish_emoji, dish_tag, small_image
from shared.extensions import db
from shared.models import (CouponPackage, CouponPurchase, CustomerAddress,
                           MenuItem, Order, OrderItem, Restaurant, Review,
                           UserCoupon)
from shared.order_flow import (FlowError, customer_actions, estimate_delivery_at,
                               haversine_km, money, new_order_no, rating_summary,
                               recent_locations, restaurant_state, transition)
from shared.security import current_user, log_denied, require_role, role_page
from shared import coupons as coupon_engine
from shared.coupons import CouponError
from shared.utils import body, clean, err, ok

# 页面
pages = Blueprint(
    "customer",
    __name__,
    url_prefix="/customer",
    template_folder="templates",
    static_folder="static",
    static_url_path="/static",
)

# 接口
api = Blueprint("customer_api", __name__, url_prefix="/api/customer")

ROLE = "customer"


# ===========================================================================
#  内部工具
# ===========================================================================
def _my_address() -> CustomerAddress | None:
    """当前顾客的默认地址：下单、算距离、首页排序都用它

    匿名访问公开列表接口时 current_user() 是 None —— 返回 None 而不是抛异常，
    否则一个未登录的 GET /api/customer/restaurants 就会 500。
    """
    user = current_user()
    if user is None:
        return None
    return (
        CustomerAddress.query.filter_by(user_id=user.id)
        .order_by(CustomerAddress.is_default.desc(), CustomerAddress.id.asc())
        .first()
    )


def _distance(restaurant: Restaurant, address: CustomerAddress | None):
    if address is None:
        return None
    return haversine_km(float(restaurant.lat), float(restaurant.lng),
                        float(address.lat), float(address.lng))


def _orders_last_30d(restaurant_ids: list[int] | None = None) -> dict[int, int]:
    """近 30 天每家店的成交单量（取消的不算）—— 卡片上那句"月售 xx"。

    一次聚合查完所有店，不要在循环里按店查（4 家店看不出差别，
    40 家店就是 40 次往返）。
    """
    cutoff = datetime.now() - timedelta(days=30)
    query = (db.session.query(Order.restaurant_id, db.func.count(Order.id))
             .filter(Order.created_at >= cutoff, Order.status != "cancelled"))
    if restaurant_ids is not None:
        if not restaurant_ids:
            return {}
        query = query.filter(Order.restaurant_id.in_(restaurant_ids))
    return {rid: int(count) for rid, count in query.group_by(Order.restaurant_id).all()}


def _restaurant_card(rest: Restaurant, address: CustomerAddress | None,
                     with_menu: bool = False,
                     orders_30d: int | None = None) -> dict:
    distance = _distance(rest, address)
    data = rest.to_dict(with_menu=with_menu)
    data.update({
        "distance_km": distance,
        "rating": rating_summary("restaurant", rest.id)["rating"],
        "review_count": rating_summary("restaurant", rest.id)["review_count"],
        "orders_30d": orders_30d if orders_30d is not None else 0,
        "state": restaurant_state(rest),
        "emoji": cuisine_emoji(rest.cuisine),
        "cover_sm": small_image(data.get("cover_url")),
        "eta_minutes": int(rest.avg_prep_minutes or 20) + (
            max(int((distance or 1) / 18 * 60), 5)),
        "delivery_fee": money(rest.delivery_fee),
    })
    if with_menu:
        grouped: dict[str, list] = {}
        for item in rest.menu_items:
            row = item.to_dict()
            row["emoji"] = dish_emoji(item.name, item.category)
            row["tag"] = dish_tag(item.name)
            row["image_sm"] = small_image(row.get("image_url"))
            grouped.setdefault(item.category or "Menu", []).append(row)
        data["menu"] = [{"category": name, "items": items}
                        for name, items in grouped.items()]
    return data


def _visible_restaurants(q: str = "", cuisine: str = "", only_open: bool = False,
                         sort: str = "distance"):
    query = Restaurant.query
    if q:
        like = f"%{q}%"
        # 店名或菜名命中都算
        sub = db.session.query(MenuItem.restaurant_id).filter(
            MenuItem.name.like(like))
        query = query.filter(db.or_(Restaurant.name.like(like),
                                    Restaurant.id.in_(sub)))
    if cuisine:
        query = query.filter(Restaurant.cuisine == cuisine)

    address = _my_address()
    rows = query.all()
    counts = _orders_last_30d([rest.id for rest in rows])
    cards = [_restaurant_card(rest, address, orders_30d=counts.get(rest.id, 0))
             for rest in rows]
    if only_open:
        cards = [c for c in cards if c["state"]["accepting"]]

    if sort == "rating":
        cards.sort(key=lambda c: (c["rating"] or 0), reverse=True)
    elif sort == "eta":
        cards.sort(key=lambda c: c["eta_minutes"])
    else:
        cards.sort(key=lambda c: (c["distance_km"] if c["distance_km"] is not None
                                  else 999))
    return cards


def _order_for_customer(order_id: int) -> Order | None:
    """⚠️ 归属校验：订单必须属于当前登录的顾客

    查不到时记一条 denied 日志（NFR-5），对外仍然只说 "Order not found"，
    避免通过 403/404 的差异探测"这单存在、但不是你的"。
    """
    user = current_user()
    order = Order.query.filter_by(id=order_id, customer_id=user.id).first()
    if order is None:
        log_denied("customer_order_not_owned", order_id=order_id)
    return order


def _can_review(order: Order) -> bool:
    return order.status == "delivered" and not any(
        r.target_type == "restaurant" for r in order.reviews)


# ===========================================================================
#  页面
# ===========================================================================
@pages.get("/design-system")
def design_system():
    """顾客端设计规范样张页（答辩时用来讲这一端的视觉语言）"""
    return render_template("customer/design-system.html")


@pages.get("/login")
def login_page():
    return render_template("customer/login.html", mode="login")


@pages.get("/register")
def register_page():
    return render_template("customer/register.html", mode="register")


@pages.get("/")
@role_page(ROLE, "customer.login_page")
def home():
    return render_template("customer/home.html", page="home")


@pages.get("/search")
@role_page(ROLE, "customer.login_page")
def search_page():
    return render_template("customer/search.html", page="search")


@pages.get("/restaurant/<int:restaurant_id>")
@role_page(ROLE, "customer.login_page")
def restaurant_page(restaurant_id: int):
    return render_template("customer/restaurant.html", page="home",
                           restaurant_id=restaurant_id)


@pages.get("/cart")
@role_page(ROLE, "customer.login_page")
def cart_page():
    return render_template("customer/cart.html", page="cart")


@pages.get("/checkout")
@role_page(ROLE, "customer.login_page")
def checkout_page():
    return render_template("customer/checkout.html", page="cart")


@pages.get("/orders")
@role_page(ROLE, "customer.login_page")
def orders_page():
    return render_template("customer/orders.html", page="orders")


@pages.get("/orders/<int:order_id>")
@role_page(ROLE, "customer.login_page")
def order_page(order_id: int):
    return render_template("customer/order.html", page="orders",
                           order_id=order_id)


@pages.get("/addresses")
@role_page(ROLE, "customer.login_page")
def addresses_page():
    return render_template("customer/addresses.html", page="account",
                           amap_key=current_app.config.get("AMAP_JS_KEY", ""))


@pages.get("/account")
@role_page(ROLE, "customer.login_page")
def account_page():
    return render_template("customer/account.html", page="account")


@pages.get("/coupons")
@role_page(ROLE, "customer.login_page")
def coupons_page():
    """我的券：可用 / 已用 / 已过期。"""
    return render_template("customer/coupons.html", page="account")


@pages.get("/coupons/store")
@role_page(ROLE, "customer.login_page")
def coupon_store_page():
    """券包货架：官方发券的唯一售卖入口。"""
    return render_template("customer/coupon-store.html", page="account")


# ===========================================================================
#  接口 · 浏览
# ===========================================================================
@api.get("/config")
def client_config():
    """前端按需加载高德地图；没有 Key 时地图降级为纯文本地址"""
    return ok({
        "amap_js_key": current_app.config.get("AMAP_JS_KEY", ""),
        "amap_security_code": current_app.config.get("AMAP_SECURITY_CODE", ""),
    })


@api.get("/restaurants")
def list_restaurants():
    cards = _visible_restaurants(
        q=clean(request.args.get("q"), 80),
        cuisine=clean(request.args.get("cuisine"), 30),
        only_open=request.args.get("open") == "1",
        sort=clean(request.args.get("sort"), 12) or "distance",
    )
    return ok({
        "restaurants": cards,
        "cuisines": sorted({r.cuisine for r in Restaurant.query.all() if r.cuisine}),
        "address": _my_address().to_dict() if _my_address() else None,
    })


@api.get("/restaurants/<int:restaurant_id>")
def restaurant_detail(restaurant_id: int):
    rest = db.session.get(Restaurant, restaurant_id)
    if rest is None:
        return err("Restaurant not found", 404)
    address = _my_address()
    distance = _distance(rest, address)
    card = _restaurant_card(rest, address, with_menu=True,
                            orders_30d=_orders_last_30d([rest.id]).get(rest.id, 0))
    card["within_radius"] = (
        distance is not None and distance <= float(rest.delivery_radius_km)
    )
    card["address_distance_km"] = distance
    card["reviews"] = [
        r.to_dict() for r in Review.query.filter_by(
            target_type="restaurant", target_id=rest.id)
        .order_by(Review.created_at.desc()).limit(5).all()
    ]
    return ok(card)


@api.get("/search")
def search():
    q = clean(request.args.get("q"), 80)
    if not q:
        return ok({"restaurants": [], "dishes": [], "query": ""})
    like = f"%{q}%"

    address = _my_address()
    cards = _visible_restaurants(q=q)
    dishes = []
    rows = (MenuItem.query.join(Restaurant)
            .filter(MenuItem.name.like(like), MenuItem.is_available.is_(True),
                    Restaurant.is_open.is_(True))
            .limit(12).all())
    for item in rows:
        dish = item.to_dict()
        dish["emoji"] = dish_emoji(item.name, item.category)
        dish["tag"] = dish_tag(item.name)
        dish["image_sm"] = small_image(dish.get("image_url"))
        dish["restaurant_name"] = item.restaurant.name
        dishes.append(dish)
    return ok({
        "query": q,
        "restaurants": cards,
        "dishes": dishes,
        "address": address.to_dict() if address else None,
    })


# ===========================================================================
#  接口 · 地址簿
# ===========================================================================
@api.get("/addresses")
@require_role(ROLE)
def list_addresses():
    rows = (CustomerAddress.query.filter_by(user_id=current_user().id)
            .order_by(CustomerAddress.is_default.desc(),
                      CustomerAddress.created_at.desc()).all())
    return ok({"addresses": [a.to_dict() for a in rows]})


@api.post("/addresses")
@require_role(ROLE)
def create_address():
    d = body()
    label = clean(d.get("label"), 20) or "Home"
    contact_name = clean(d.get("contact_name"), 50)
    contact_phone = clean(d.get("contact_phone"), 20)
    address_text = clean(d.get("address_text"), 255)
    lng = d.get("lng")
    lat = d.get("lat")

    if not contact_name or not contact_phone:
        return err("Add a contact name and phone number so the rider can reach you")
    if len(address_text) < 6:
        return err("Address is too short — include the street and building number")
    try:
        lng, lat = float(lng), float(lat)
    except (TypeError, ValueError):
        return err("Pick the address location on the map first")
    if not (-180 <= lng <= 180 and -90 <= lat <= 90):
        return err("Map coordinates are out of range")

    user = current_user()
    is_default = bool(d.get("is_default")) or \
        CustomerAddress.query.filter_by(user_id=user.id).count() == 0
    if is_default:
        CustomerAddress.query.filter_by(user_id=user.id).update(
            {"is_default": False}, synchronize_session=False)

    row = CustomerAddress(
        user_id=user.id, label=label, contact_name=contact_name,
        contact_phone=contact_phone, address_text=address_text,
        lng=Decimal(str(lng)), lat=Decimal(str(lat)), is_default=is_default,
    )
    db.session.add(row)
    db.session.commit()
    return ok(row.to_dict(), status=201)


@api.delete("/addresses/<int:address_id>")
@require_role(ROLE)
def delete_address(address_id: int):
    row = CustomerAddress.query.filter_by(
        id=address_id, user_id=current_user().id).first()
    if row is None:
        log_denied("customer_address_not_owned", address_id=address_id)
        return err("Address not found", 404)
    if row.is_default:
        return err("Set another address as default before deleting this one")
    db.session.delete(row)
    db.session.commit()
    return ok({"message": "Address deleted"})


@api.post("/addresses/<int:address_id>/default")
@require_role(ROLE)
def set_default_address(address_id: int):
    user = current_user()
    row = CustomerAddress.query.filter_by(id=address_id, user_id=user.id).first()
    if row is None:
        return err("Address not found", 404)
    CustomerAddress.query.filter_by(user_id=user.id).update(
        {"is_default": False}, synchronize_session=False)
    row.is_default = True
    db.session.commit()
    return ok(row.to_dict())


# ===========================================================================
#  接口 · 下单
# ===========================================================================
@api.post("/orders")
@require_role(ROLE)
def place_order():
    """下单 —— 这里把顾客能犯的错全部挡在前面，并给出下一步动作

    校验顺序刻意从"最不可恢复"到"最容易改"：
        餐厅存在 → 地址归属 → 是否在营业 → 菜品可售 → 起送价 → 配送范围
    """
    d = body()
    user = current_user()
    try:
        restaurant_id = int(d.get("restaurant_id") or 0)
        address_id = int(d.get("address_id") or 0)
    except (TypeError, ValueError):
        return err("Invalid restaurant or address")
    restaurant = db.session.get(Restaurant, restaurant_id)
    if restaurant is None:
        return err("Restaurant not found", 404)

    address = CustomerAddress.query.filter_by(
        id=address_id, user_id=user.id).first()
    if address is None:
        return err("Select a delivery address first")

    state = restaurant_state(restaurant)
    if not state["accepting"]:
        return err(f"{restaurant.name} is not taking orders right now — "
                   f"{state['detail']}", 409)

    raw_items = d.get("items")
    if not isinstance(raw_items, list) or not raw_items:
        return err("Your cart is empty")

    # 合并同菜品的数量，避免前端重复提交绕过库存检查
    wanted: dict[int, int] = {}
    for row in raw_items:
        try:
            item_id = int(row.get("menu_item_id"))
            quantity = int(row.get("quantity") or 0)
        except (TypeError, ValueError, AttributeError):
            return err("Cart contains an invalid item")
        if quantity <= 0:
            continue
        wanted[item_id] = wanted.get(item_id, 0) + quantity
    if not wanted:
        return err("Your cart is empty")

    menu = {item.id: item for item in MenuItem.query.filter(
        MenuItem.id.in_(wanted.keys()), MenuItem.restaurant_id == restaurant.id).all()}

    lines: list[tuple[MenuItem, int]] = []
    items_amount = Decimal("0.00")
    for item_id, quantity in wanted.items():
        item = menu.get(item_id)
        if item is None:
            return err("One of the dishes is no longer on this menu — "
                       "remove it and try again", 409)
        if item.sold_out:
            return err(f"“{item.name}” is sold out — remove it from your cart", 409)
        if item.stock is not None and item.stock < quantity:
            return err(f"Only {item.stock} × “{item.name}” left — "
                       f"reduce the quantity", 409)
        subtotal = Decimal(str(item.price)) * quantity
        items_amount += subtotal
        lines.append((item, quantity))

    min_order = Decimal(str(restaurant.min_order_amount))
    if items_amount < min_order:
        return err(f"Add ¥{float(min_order - items_amount):.2f} more to reach the "
                   f"¥{float(min_order):.2f} minimum order", 409)

    distance = _distance(restaurant, address)
    if distance is None or distance > float(restaurant.delivery_radius_km):
        return err(
            f"This address is {distance} km away, outside {restaurant.name}'s "
            f"{float(restaurant.delivery_radius_km):.0f} km delivery radius — "
            f"pick a closer address", 409)

    # 优惠券（可选）：先确认是自己的券，再交给唯一计价入口
    user_coupon = None
    raw_coupon = d.get("user_coupon_id")
    if raw_coupon not in (None, "", 0, "0"):
        try:
            user_coupon_id = int(raw_coupon)
        except (TypeError, ValueError):
            return err("Invalid coupon")
        user_coupon = UserCoupon.query.filter_by(
            id=user_coupon_id, user_id=user.id).first()
        if user_coupon is None:
            return err("Coupon not found", 404)

    quote = coupon_engine.price_order(restaurant, items_amount, user_coupon)
    if user_coupon is not None and quote["coupon_error"]:
        return err(quote["coupon_error"], 409)

    fee = Decimal(str(restaurant.delivery_fee))

    order = Order(
        order_no=new_order_no(),
        customer_id=user.id,
        restaurant_id=restaurant.id,
        status="pending",
        payment_status="paid",         # 模拟支付：没有真实网关
        delivery_address_text=address.address_text,
        delivery_lng=address.lng,
        delivery_lat=address.lat,
        delivery_contact_name=address.contact_name,
        delivery_contact_phone=address.contact_phone,
        items_amount=items_amount,
        delivery_fee=fee,
        discount_amount=quote["discount_amount"],
        total_amount=quote["total_amount"],
        coupon_id=user_coupon.coupon_id if user_coupon else None,
        coupon_title=user_coupon.coupon.title if user_coupon else None,
        coupon_funded_by=user_coupon.coupon.funded_by if user_coupon else None,
        distance_km=Decimal(str(distance)),
        estimated_delivery_at=estimate_delivery_at(
            restaurant.avg_prep_minutes, distance),
        remark=clean(d.get("remark"), 255) or None,
    )
    db.session.add(order)
    db.session.flush()

    # 核销必须是条件更新：两人同时用同一张券，只能成功一次
    if user_coupon is not None and not coupon_engine.redeem(user, user_coupon, order):
        db.session.rollback()
        return err("This coupon has already been used", 409)

    for item, quantity in lines:
        db.session.add(OrderItem(
            order_id=order.id, menu_item_id=item.id, name_snapshot=item.name,
            unit_price=item.price, quantity=quantity,
            subtotal=Decimal(str(item.price)) * quantity,
        ))
        # 扣库存：stock 为 NULL 表示不限量，不动它
        if item.stock is not None:
            item.stock = max(item.stock - quantity, 0)

    db.session.commit()
    return ok({"order": order.to_dict(detail=True),
               "message": f"Order placed — {restaurant.name} will confirm shortly"},
              status=201)


# ===========================================================================
#  接口 · 我的订单
# ===========================================================================
@api.get("/orders")
@require_role(ROLE)
def my_orders():
    user = current_user()
    rows = (Order.query.filter_by(customer_id=user.id)
            .order_by(Order.created_at.desc()).limit(50).all())
    # active 也带 detail：卡片上的进度条直接用 steps，不必前端自己猜状态顺序
    active = [o.to_dict(detail=True) for o in rows if o.is_active]
    past = [o.to_dict(detail=True) for o in rows if not o.is_active]
    return ok({"active": active, "past": past,
               "active_count": len(active)})


@api.get("/orders/<int:order_id>")
@require_role(ROLE)
def order_detail(order_id: int):
    order = _order_for_customer(order_id)
    if order is None:
        return err("Order not found", 404)
    data = order.to_dict(detail=True)
    data["actions"] = customer_actions(order)
    data["can_review"] = _can_review(order)
    data["can_cancel"] = order.status in ("pending", "accepted")
    data["can_change_address"] = (
        order.picked_up_at is None
        and order.status in ("pending", "accepted", "preparing", "ready")
    )
    # FR-23：顾客能看到骑手最后一次上报的位置
    data["rider_location"] = (recent_locations(order.id) or [None])[0]
    data["steps"] = [s for s in data["timeline"]
                     if s["status"] in ("pending", "accepted", "preparing",
                                        "delivering", "delivered")]
    data["restaurant_phone"] = order.restaurant.phone if order.restaurant else None
    data["payment_label"] = ("Paid online (demo)" if order.payment_status == "paid"
                             else "Refunded" if order.payment_status == "refunded"
                             else "Unpaid")
    return ok(data)


@api.post("/orders/<int:order_id>/cancel")
@require_role(ROLE)
def cancel_order(order_id: int):
    order = _order_for_customer(order_id)
    if order is None:
        return err("Order not found", 404)

    if order.status in ("preparing", "ready", "delivering"):
        return err("The kitchen has already started this order — call the "
                   "restaurant if you need to cancel", 409)
    if order.status not in ("pending", "accepted"):
        return err("This order is already closed", 409)

    reason = clean(body().get("reason"), 100) or "Cancelled by customer"
    try:
        transition(order, "cancelled", "customer", reason=reason)
    except FlowError as exc:
        return err(exc.message, exc.status)
    return ok({"order": order.to_dict(detail=True),
               "message": "Order cancelled — any payment is refunded "
                          "(demo: no real charge was made)"})


@api.post("/orders/<int:order_id>/address")
@require_role(ROLE)
def change_order_address(order_id: int):
    """FR-19：骑手取餐前可以改配送地址，改了之后距离/预计时间重算，骑手端会看到提示"""
    order = _order_for_customer(order_id)
    if order is None:
        return err("Order not found", 404)

    if order.picked_up_at is not None or order.status in (
            "delivering", "delivered", "cancelled"):
        return err("The rider has already collected this order — call them "
                   "on the number in your order to redirect the delivery", 409)

    try:
        address_id = int(body().get("address_id") or 0)
    except (TypeError, ValueError):
        return err("Invalid address")
    address = CustomerAddress.query.filter_by(
        id=address_id, user_id=current_user().id).first()
    if address is None:
        return err("Select one of your saved addresses")

    restaurant = db.session.get(Restaurant, order.restaurant_id)
    distance = haversine_km(float(restaurant.lat), float(restaurant.lng),
                            float(address.lat), float(address.lng))
    if distance > float(restaurant.delivery_radius_km):
        return err(f"That address is {distance} km away, outside "
                   f"{restaurant.name}'s "
                   f"{float(restaurant.delivery_radius_km):.0f} km delivery radius",
                   409)

    order.delivery_address_text = address.address_text
    order.delivery_lng = address.lng
    order.delivery_lat = address.lat
    order.delivery_contact_name = address.contact_name
    order.delivery_contact_phone = address.contact_phone
    order.distance_km = Decimal(str(distance))
    order.estimated_delivery_at = estimate_delivery_at(
        restaurant.avg_prep_minutes, distance)
    order.address_updated_at = datetime.now()
    db.session.commit()

    return ok({
        "order": order.to_dict(detail=True),
        "message": "Delivery address updated — the kitchen and rider can see it",
    })


@api.post("/orders/<int:order_id>/review")
@require_role(ROLE)
def review_order(order_id: int):
    order = _order_for_customer(order_id)
    if order is None:
        return err("Order not found", 404)
    if order.status != "delivered":
        return err("You can rate an order once it has been delivered", 409)

    d = body()
    try:
        restaurant_rating = int(d.get("restaurant_rating"))
    except (TypeError, ValueError):
        return err("Pick a rating for the restaurant (1–5 stars)")
    if not 1 <= restaurant_rating <= 5:
        return err("Rating must be between 1 and 5 stars")

    existing = {r.target_type for r in order.reviews}
    if "restaurant" in existing:
        return err("You have already rated this order", 409)

    content = clean(d.get("content"), 500) or None
    db.session.add(Review(
        order_id=order.id, reviewer_id=current_user().id,
        target_type="restaurant", target_id=order.restaurant_id,
        rating=restaurant_rating, content=content,
    ))

    rider_rating = d.get("rider_rating")
    if order.rider_id and rider_rating is not None:
        try:
            rider_rating = int(rider_rating)
        except (TypeError, ValueError):
            rider_rating = None
        if rider_rating and 1 <= rider_rating <= 5 and "rider" not in existing:
            db.session.add(Review(
                order_id=order.id, reviewer_id=current_user().id,
                target_type="rider", target_id=order.rider_id,
                rating=rider_rating,
                content="Rated together with the restaurant review.",
            ))

    db.session.commit()
    return ok({"message": "Thanks — your rating helps other customers"})


@api.get("/active-order")
@require_role(ROLE)
def active_order():
    """首页顶部横幅：当前进行中的那一单"""
    order = (Order.query.filter(
        Order.customer_id == current_user().id,
        Order.status.in_(("pending", "accepted", "preparing", "ready",
                          "delivering")),
    ).order_by(Order.created_at.desc()).first())
    return ok({"order": order.to_dict(detail=True) if order else None})


# ===========================================================================
#  接口 · 优惠券
# ===========================================================================
@api.get("/coupons")
@require_role(ROLE)
def my_coupons():
    """我的券。带上 restaurant_id + items_amount 时顺便算出"这单能不能用"。"""
    rid = request.args.get("restaurant_id", type=int)
    amount = request.args.get("items_amount")
    items_amount = Decimal(amount) if amount not in (None, "") else None
    return ok(coupon_engine.summarize(current_user(), restaurant_id=rid,
                                      items_amount=items_amount))


@api.get("/coupon-packages")
@require_role(ROLE)
def coupon_packages():
    """券包货架 —— 按限购和库存算好 can_buy，前端不用自己推。"""
    user = current_user()
    now = datetime.now()
    rows = (CouponPackage.query.filter_by(is_active=True)
            .order_by(CouponPackage.sort_order, CouponPackage.id).all())

    bought = dict(
        db.session.query(CouponPurchase.package_id, db.func.count())
        .filter(CouponPurchase.user_id == user.id)
        .group_by(CouponPurchase.package_id).all()
    )

    packages = []
    for pkg in rows:
        mine = bought.get(pkg.id, 0)
        remaining = (None if pkg.total_quantity is None
                     else max(pkg.total_quantity - pkg.sold_count, 0))
        reason = None
        if pkg.start_at and now < pkg.start_at:
            reason = "Not on sale yet"
        elif pkg.end_at and now > pkg.end_at:
            reason = "No longer on sale"
        elif remaining is not None and remaining <= 0:
            reason = "Sold out"
        elif mine >= (pkg.per_user_limit or 1):
            reason = "Purchase limit reached"

        data = pkg.to_dict()
        data.update({
            "items": [{"coupon_id": item.coupon_id, "label": item.label(),
                       "title": item.coupon.title if item.coupon else "Coupon",
                       "quantity": item.quantity}
                      for item in pkg.items],
            "purchased": mine,
            "can_buy": reason is None,
            "reason": reason,
        })
        packages.append(data)

    return ok({"packages": packages,
               "wallet": {"available": _coupon_count(user)}})


def _coupon_count(user) -> int:
    return sum(1 for c in UserCoupon.query.filter_by(user_id=user.id).all()
               if coupon_engine.effective_status(c) == "unused")


@api.post("/coupon-packages/<int:package_id>/purchase")
@require_role(ROLE)
def purchase_coupon_package(package_id: int):
    """购买券包（模拟支付）。一次事务：扣库存 + 记购买 + 发券。"""
    package = db.session.get(CouponPackage, package_id)
    if package is None:
        return err("Coupon pack not found", 404)
    try:
        purchase, issued = coupon_engine.grant_package(current_user(), package)
    except CouponError as exc:
        db.session.rollback()
        return err(exc.message, exc.status)

    return ok({
        "purchase": {
            "id": purchase.id,
            "price_paid": float(purchase.price_paid),
            "coupon_count": purchase.coupon_count,
            "package_title": package.title,
        },
        "coupons": [coupon_engine.serialize(c) for c in issued],
        "message": f"{purchase.coupon_count} coupons added to your account",
    }, status=201)


# ===========================================================================
#  接口 · 个人资料
# ===========================================================================
@api.get("/profile")
@require_role(ROLE)
def profile():
    user = current_user()
    return ok({
        "user": user.to_dict(),
        "default_address": _my_address().to_dict() if _my_address() else None,
        "order_count": Order.query.filter_by(customer_id=user.id).count(),
    })


@api.patch("/profile")
@require_role(ROLE)
def update_profile():
    user = current_user()
    d = body()
    if "name" in d:
        name = clean(d.get("name"), 50)
        if len(name) < 2:
            return err("Name must be at least 2 characters")
        user.name = name
    if "phone" in d:
        phone = clean(d.get("phone"), 20)
        if phone and not phone.replace("+", "").replace("-", "").replace(" ", "").isdigit():
            return err("Phone number can only contain digits, spaces, + and -")
        user.phone = phone or None
    if "avatar_url" in d:
        user.avatar_url = clean(d.get("avatar_url"), 255) or None
    db.session.commit()
    return ok({"user": user.to_dict(), "message": "Profile updated"})
