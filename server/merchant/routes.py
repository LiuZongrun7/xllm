"""
商家端 —— 页面与接口（负责人：B）
================================================================================
这是商家端的**全部代码入口**。答辩时只需要打开这一行下面这几个文件：

    merchant/routes.py                 ← 本文件：页面路由 + 商家侧接口
    merchant/templates/merchant/       ← 商家端页面（Jinja2）
    merchant/static/css/merchant.css   ← 商家端设计系统（与另两端零共享）
    merchant/static/js/merchant.js     ← 商家端交互

只依赖 shared/ 里的数据模型、权限装饰器与订单状态机，不碰顾客端和骑手端的任何东西。

页面前缀   /merchant/...           → pages
接口前缀   /api/merchant/...       → api

页面
    /login /register               登录 / 注册
    /setup                         开店引导：第一次登录时录入店铺信息（FR-6/7/11）
    /                              总览：今日 KPI + 待接单队列
    /orders                        订单看板（Placed / Accepted / Preparing / Ready+On the way）
    /orders/<id>                   订单详情 + 状态推进
    /menu                          菜单管理（价格 / 热量 / 库存 / 售罄）
    /settings                      营业设置与产能
    /analytics                     营业分析
    /issues                        异常与售后

接口
    店铺    GET/POST/PATCH /store        GET/PUT /settings      POST /status
    看板    GET /dashboard               GET /orders            GET /orders/<id>
            POST /orders/<id>/accept     POST /orders/<id>/preparing
            POST /orders/<id>/ready      POST /orders/<id>/decline
            POST /orders/<id>/delay
    菜单    GET/POST /menu-items         PATCH/DELETE /menu-items/<id>
            PATCH /menu-items/<id>/stock POST /menu-items/restock
    异常    GET /issues
    分析    GET /analytics?days=7

⚠️ 状态推进一律调用 shared.order_flow.transition()，不要在这里自己判 status。
================================================================================
"""

from datetime import datetime, timedelta
from decimal import Decimal

from flask import Blueprint, current_app, redirect, render_template, request, url_for
from shared.catalog import dish_emoji, small_image
from shared.extensions import db
from shared.models import MenuItem, OpeningHour, Order, Restaurant
from shared.order_flow import (FlowError, flag_delay, merchant_actions, money,
                               parse_hhmm, restaurant_state, transition)
from shared.security import current_user, log_denied, require_role, role_page
from shared.utils import body, clean, err, ok

# 页面
pages = Blueprint(
    "merchant",
    __name__,
    url_prefix="/merchant",
    template_folder="templates",
    static_folder="static",
    static_url_path="/static",
)

# 接口
api = Blueprint("merchant_api", __name__, url_prefix="/api/merchant")

ROLE = "restaurant"
WEEKDAY_NAMES = {1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun"}


# ===========================================================================
#  内部工具
# ===========================================================================
def _my_restaurant() -> Restaurant | None:
    """⚠️ 归属校验的根：商家只能碰 owner_id = 自己的那一家店"""
    user = current_user()
    return Restaurant.query.filter_by(owner_id=user.id).first()


def _store_or_404():
    restaurant = _my_restaurant()
    if restaurant is None:
        return None, err("Create your store profile first", 409)
    return restaurant, None


def _my_order(order_id: int, restaurant: Restaurant) -> Order | None:
    order = Order.query.filter_by(id=order_id, restaurant_id=restaurant.id).first()
    if order is None:
        log_denied("restaurant_order_not_owned", order_id=order_id)
    return order


def _queue_orders(restaurant: Restaurant) -> list[Order]:
    return (Order.query.filter(
        Order.restaurant_id == restaurant.id,
        Order.status.in_(("pending", "accepted", "preparing", "ready",
                          "delivering")),
    ).order_by(Order.created_at.asc()).all())


def _today_range():
    start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=1)


def _kpis(restaurant: Restaurant) -> dict:
    day_start, day_end = _today_range()
    today = Order.query.filter(
        Order.restaurant_id == restaurant.id,
        Order.created_at >= day_start, Order.created_at < day_end,
    ).all()
    delivered = [o for o in today if o.status == "delivered"]
    active = [o for o in today if o.is_active]

    prep_durations = [
        (o.ready_at - o.accepted_at).total_seconds() / 60
        for o in today if o.ready_at and o.accepted_at
    ]
    cancelled = [o for o in today if o.status == "cancelled"]
    awaiting_rider = [
        o for o in _queue_orders(restaurant)
        if o.status == "ready" and o.rider_id is None
    ]

    return {
        "today_orders": len(today),
        "today_delivered": len(delivered),
        "today_revenue": round(sum(money(o.total_amount) for o in delivered), 2),
        "active_orders": len(active),
        "delayed_orders": sum(1 for o in active if o.is_delayed),
        "awaiting_rider": len(awaiting_rider),
        "cancelled_today": len(cancelled),
        "cancel_rate": round(len(cancelled) / len(today) * 100, 1) if today else 0.0,
        "avg_prep_minutes": round(sum(prep_durations) / len(prep_durations), 1)
        if prep_durations else 0.0,
    }


def _queue_summary(restaurant: Restaurant) -> dict:
    rows = _queue_orders(restaurant)
    buckets = {"pending": [], "accepted": [], "preparing": [],
               "ready": [], "delivering": []}
    for order in rows:
        buckets.setdefault(order.status, []).append(order.to_dict())
    return {
        "buckets": buckets,
        "counts": {key: len(value) for key, value in buckets.items()},
        "orders": [o.to_dict() for o in rows],
    }


def _issue_rows(restaurant: Restaurant) -> list[dict]:
    """异常与售后（题目点名的异常流程）"""
    now = datetime.now()
    issues = []
    for order in _queue_orders(restaurant):
        if order.status == "ready" and order.rider_id is None and order.ready_at:
            waiting = int((now - order.ready_at).total_seconds() // 60)
            if waiting >= 8:
                issues.append({
                    "kind": "no_rider",
                    "label": "No rider yet",
                    "detail": f"Ready for {waiting} min and still unclaimed",
                    "severity": "warning" if waiting < 20 else "danger",
                    "order": order.to_dict(),
                })
        if order.is_delayed:
            issues.append({
                "kind": "delayed",
                "label": "Delayed",
                "detail": order.delay_reason or "Kitchen is running behind",
                "severity": "warning",
                "order": order.to_dict(),
            })
        if len(order.delivery_address_text or "") < 8 or not order.delivery_contact_phone:
            issues.append({
                "kind": "address",
                "label": "Address needs checking",
                "detail": "The delivery address looks incomplete — call the customer",
                "severity": "danger",
                "order": order.to_dict(),
            })

    since = now - timedelta(hours=24)
    cancelled = (Order.query.filter(
        Order.restaurant_id == restaurant.id,
        Order.status == "cancelled", Order.cancelled_at >= since,
    ).order_by(Order.cancelled_at.desc()).limit(10).all())
    for order in cancelled:
        issues.append({
            "kind": "cancelled",
            "label": "Cancelled",
            "detail": f"{order.cancelled_by or 'customer'}: "
                      f"{order.cancel_reason or 'no reason given'}",
            "severity": "neutral",
            "order": order.to_dict(),
        })

    sold_out = [i for i in restaurant.menu_items if i.sold_out]
    for item in sold_out[:5]:
        issues.append({
            "kind": "sold_out",
            "label": "Sold out",
            "detail": f"{item.name} is unavailable to customers",
            "severity": "neutral",
            "menu_item_id": item.id,
        })
    return issues


def _day_labels(days: int = 7):
    today = datetime.now().date()
    return [today - timedelta(days=offset) for offset in range(days - 1, -1, -1)]


# ===========================================================================
#  页面
# ===========================================================================
def _store_gate(view):
    """登录了但还没建店 → 一律先去 /setup，避免每个页面各写一遍判断"""
    from functools import wraps

    @wraps(view)
    def wrapper(*args, **kwargs):
        if _my_restaurant() is None:
            return redirect(url_for("merchant.setup_page"))
        return view(*args, **kwargs)
    return wrapper


@pages.get("/design-system")
def design_system():
    """商家端设计规范样张页（答辩时用来讲这一端的视觉语言）"""
    return render_template("merchant/design-system.html")


@pages.get("/login")
def login_page():
    return render_template("merchant/login.html", mode="login")


@pages.get("/register")
def register_page():
    return render_template("merchant/register.html", mode="register")


@pages.get("/setup")
@role_page(ROLE, "merchant.login_page")
def setup_page():
    if _my_restaurant() is not None:
        return redirect(url_for("merchant.dashboard"))
    return render_template("merchant/setup.html", page="setup",
                           amap_key=current_app.config.get("AMAP_JS_KEY", ""),
                           amap_security_code=current_app.config.get(
                               "AMAP_SECURITY_CODE", ""))


@pages.get("/")
@role_page(ROLE, "merchant.login_page")
@_store_gate
def dashboard():
    return render_template("merchant/dashboard.html", page="dashboard")


@pages.get("/orders")
@role_page(ROLE, "merchant.login_page")
@_store_gate
def orders_page():
    return render_template("merchant/orders.html", page="orders")


@pages.get("/orders/<int:order_id>")
@role_page(ROLE, "merchant.login_page")
@_store_gate
def order_page(order_id: int):
    return render_template("merchant/order.html", page="orders",
                           order_id=order_id)


@pages.get("/menu")
@role_page(ROLE, "merchant.login_page")
@_store_gate
def menu_page():
    return render_template("merchant/menu.html", page="menu")


@pages.get("/settings")
@role_page(ROLE, "merchant.login_page")
@_store_gate
def settings_page():
    return render_template("merchant/settings.html", page="settings",
                           amap_key=current_app.config.get("AMAP_JS_KEY", ""),
                           amap_security_code=current_app.config.get(
                               "AMAP_SECURITY_CODE", ""))


@pages.get("/analytics")
@role_page(ROLE, "merchant.login_page")
@_store_gate
def analytics_page():
    return render_template("merchant/analytics.html", page="analytics")


@pages.get("/issues")
@role_page(ROLE, "merchant.login_page")
@_store_gate
def issues_page():
    return render_template("merchant/issues.html", page="issues")


# ===========================================================================
#  接口 · 店铺资料 / 开店
# ===========================================================================
@api.get("/store")
@require_role(ROLE)
def get_store():
    restaurant = _my_restaurant()
    if restaurant is None:
        return ok({"restaurant": None})
    return ok({
        "restaurant": restaurant.to_dict(),
        "state": restaurant_state(restaurant),
        "opening_hours": [h.to_dict() for h in restaurant.opening_hours],
    })


@api.post("/store")
@require_role(ROLE)
def create_store():
    """开店引导 —— 第一次登录时录入店铺，一个账号只能开一家"""
    if _my_restaurant() is not None:
        return err("You already have a store", 409)

    d = body()
    name = clean(d.get("name"), 80)
    phone = clean(d.get("phone"), 20)
    address_text = clean(d.get("address_text"), 255)
    if len(name) < 2:
        return err("Store name must be at least 2 characters")
    if not phone:
        return err("Add a phone number customers can call")
    if len(address_text) < 6:
        return err("Add the street address so riders can find you")
    try:
        lng = float(d.get("lng"))
        lat = float(d.get("lat"))
    except (TypeError, ValueError):
        return err("Pick your store location on the map first")

    user = current_user()
    restaurant = Restaurant(
        owner_id=user.id,
        name=name,
        phone=phone,
        address_text=address_text,
        lng=Decimal(str(lng)),
        lat=Decimal(str(lat)),
        description=clean(d.get("description"), 500) or None,
        cuisine=clean(d.get("cuisine"), 30) or "Chinese",
        min_order_amount=Decimal(str(d.get("min_order_amount") or 20)),
        delivery_fee=Decimal(str(d.get("delivery_fee") or 5)),
        delivery_radius_km=Decimal(str(d.get("delivery_radius_km") or 5)),
        max_concurrent_orders=int(d.get("max_concurrent_orders") or 20),
        avg_prep_minutes=int(d.get("avg_prep_minutes") or 20),
        is_open=True,
    )
    db.session.add(restaurant)
    db.session.flush()

    for weekday in range(1, 8):
        db.session.add(OpeningHour(
            restaurant_id=restaurant.id, weekday=weekday,
            open_time=parse_hhmm("10:00"),
            close_time=parse_hhmm("22:00"),
            is_closed=False,
        ))
    db.session.commit()
    return ok({"restaurant": restaurant.to_dict(),
               "message": "Store created — add your first dishes to open"}, status=201)


@api.patch("/store")
@require_role(ROLE)
def update_store():
    restaurant, error = _store_or_404()
    if error:
        return error
    d = body()

    if "name" in d:
        name = clean(d.get("name"), 80)
        if len(name) < 2:
            return err("Store name must be at least 2 characters")
        restaurant.name = name
    if "phone" in d:
        restaurant.phone = clean(d.get("phone"), 20) or restaurant.phone
    if "address_text" in d:
        restaurant.address_text = clean(d.get("address_text"), 255)
    if "description" in d:
        restaurant.description = clean(d.get("description"), 500) or None
    if "cuisine" in d:
        restaurant.cuisine = clean(d.get("cuisine"), 30) or restaurant.cuisine
    if "lng" in d and "lat" in d:
        try:
            restaurant.lng = Decimal(str(float(d["lng"])))
            restaurant.lat = Decimal(str(float(d["lat"])))
        except (TypeError, ValueError):
            return err("Invalid map coordinates")

    db.session.commit()
    return ok({"restaurant": restaurant.to_dict(), "message": "Store updated"})


# ===========================================================================
#  接口 · 营业设置与产能
# ===========================================================================
@api.get("/settings")
@require_role(ROLE)
def get_settings():
    restaurant = _my_restaurant()
    if restaurant is None:
        return ok({"restaurant": None})
    return ok({
        "restaurant": restaurant.to_dict(),
        "state": restaurant_state(restaurant),
        "opening_hours": [h.to_dict() for h in restaurant.opening_hours],
        "weekday_names": WEEKDAY_NAMES,
    })


@api.put("/settings")
@require_role(ROLE)
def save_settings():
    """一页保存：营业开关 / 产能 / 备餐时长 / 配送半径 / 起送价 / 配送费 / 营业时间"""
    restaurant, error = _store_or_404()
    if error:
        return error
    d = body()

    if "is_open" in d:
        restaurant.is_open = bool(d["is_open"])

    # 店铺资料也允许在这一页保存 —— 否则前端要发两个请求
    if "description" in d:
        restaurant.description = clean(d.get("description"), 500) or None
    if "name" in d:
        name = clean(d.get("name"), 80)
        if len(name) < 2:
            return err("Store name must be at least 2 characters")
        restaurant.name = name
    if "phone" in d:
        restaurant.phone = clean(d.get("phone"), 20) or restaurant.phone
    if "cuisine" in d:
        restaurant.cuisine = clean(d.get("cuisine"), 30) or restaurant.cuisine

    def _number(key, cast, low, high, label):
        if key not in d:
            return None
        try:
            value = cast(d[key])
        except (TypeError, ValueError):
            return err(f"{label} must be a number")
        if not low <= value <= high:
            return err(f"{label} must be between {low} and {high}")
        return value

    for key, cast, low, high, label, attr in (
        ("max_concurrent_orders", int, 1, 200, "Max concurrent orders",
         "max_concurrent_orders"),
        ("avg_prep_minutes", int, 1, 120, "Average prep time", "avg_prep_minutes"),
        ("delivery_radius_km", float, 0.5, 30, "Delivery radius",
         "delivery_radius_km"),
        ("min_order_amount", float, 0, 500, "Minimum order", "min_order_amount"),
        ("delivery_fee", float, 0, 100, "Delivery fee", "delivery_fee"),
    ):
        value = _number(key, cast, low, high, label)
        if isinstance(value, tuple):          # err() 的返回值
            return value
        if value is not None:
            setattr(restaurant, attr, Decimal(str(value)) if cast is float else value)

    hours = d.get("opening_hours")
    if isinstance(hours, list):
        by_weekday = {h.weekday: h for h in restaurant.opening_hours}
        for row in hours:
            try:
                weekday = int(row.get("weekday"))
            except (TypeError, ValueError):
                continue
            if weekday not in by_weekday:
                continue
            current = by_weekday[weekday]
            current.is_closed = bool(row.get("is_closed"))
            current.open_time = parse_hhmm(row.get("open_time"), current.open_time)
            current.close_time = parse_hhmm(row.get("close_time"), current.close_time)
            if current.open_time == current.close_time and not current.is_closed:
                return err(f"{WEEKDAY_NAMES[weekday]}: open and close time "
                           f"cannot be the same")

    db.session.commit()
    return ok({
        "restaurant": restaurant.to_dict(),
        "state": restaurant_state(restaurant),
        "opening_hours": [h.to_dict() for h in restaurant.opening_hours],
        "message": "Settings saved",
    })


@api.post("/status")
@require_role(ROLE)
def set_status():
    """顶栏上的营业开关：只改 is_open，其它设置不动"""
    restaurant, error = _store_or_404()
    if error:
        return error
    data = body()
    if "is_open" not in data:
        return err("Send {is_open: true|false}")
    restaurant.is_open = bool(data["is_open"])
    db.session.commit()
    return ok({
        "is_open": bool(restaurant.is_open),
        "state": restaurant_state(restaurant),
        "message": "You are open for orders" if restaurant.is_open
        else "Orders paused — customers can see your menu but cannot order",
    })


# ===========================================================================
#  接口 · 总览 / 订单看板
# ===========================================================================
@api.get("/dashboard")
@require_role(ROLE)
def dashboard_data():
    restaurant, error = _store_or_404()
    if error:
        return error
    queue = _queue_summary(restaurant)
    return ok({
        "restaurant": restaurant.to_dict(),
        "state": restaurant_state(restaurant),
        "kpis": _kpis(restaurant),
        "queue": queue,
        "issues": _issue_rows(restaurant)[:6],
        "weekday_names": WEEKDAY_NAMES,
    })


@api.get("/orders")
@require_role(ROLE)
def list_orders():
    restaurant, error = _store_or_404()
    if error:
        return error
    status = clean(request.args.get("status"), 120)   # 允许逗号列表：pending,accepted,...
    query = Order.query.filter_by(restaurant_id=restaurant.id)
    if status:
        wanted = [s for s in status.split(",") if s]
        query = query.filter(Order.status.in_(wanted))
    else:
        query = query.filter(Order.status.in_(
            ("pending", "accepted", "preparing", "ready", "delivering")))
    orders = query.order_by(Order.created_at.asc()).all()
    return ok({
        "orders": [o.to_dict() for o in orders],
        "queue": _queue_summary(restaurant),
        "state": restaurant_state(restaurant),
    })


@api.get("/orders/<int:order_id>")
@require_role(ROLE)
def order_detail(order_id: int):
    restaurant, error = _store_or_404()
    if error:
        return error
    order = _my_order(order_id, restaurant)
    if order is None:
        return err("Order not found", 404)
    data = order.to_dict(detail=True)
    data["actions"] = merchant_actions(order)
    data["customer_phone"] = order.delivery_contact_phone
    data["rider"] = data["rider"] or None
    return ok(data)


def _order_action(order_id: int, target: str, reason_field: str = "reason"):
    restaurant, error = _store_or_404()
    if error:
        return error
    order = _my_order(order_id, restaurant)
    if order is None:
        return err("Order not found", 404)
    reason = clean(body().get(reason_field), 100)
    try:
        transition(order, target, "restaurant", reason=reason or None)
    except FlowError as exc:
        return err(exc.message, exc.status)
    return ok({
        "order": order.to_dict(detail=True),
        "message": {
            "accepted": "Order accepted — start preparing when you are ready",
            "preparing": "Kitchen is on it",
            "ready": "Marked ready — riders can now claim this order",
            "cancelled": "Order declined and the customer refunded (demo)",
        }.get(target, "Order updated"),
    })


@api.post("/orders/<int:order_id>/accept")
@require_role(ROLE)
def accept_order(order_id: int):
    return _order_action(order_id, "accepted")


@api.post("/orders/<int:order_id>/preparing")
@require_role(ROLE)
def start_preparing(order_id: int):
    return _order_action(order_id, "preparing")


@api.post("/orders/<int:order_id>/ready")
@require_role(ROLE)
def mark_ready(order_id: int):
    return _order_action(order_id, "ready")


@api.post("/orders/<int:order_id>/decline")
@require_role(ROLE)
def decline_order(order_id: int):
    return _order_action(order_id, "cancelled", reason_field="reason")


@api.post("/orders/<int:order_id>/delay")
@require_role(ROLE)
def mark_delay(order_id: int):
    restaurant, error = _store_or_404()
    if error:
        return error
    order = _my_order(order_id, restaurant)
    if order is None:
        return err("Order not found", 404)
    if order.status in ("delivered", "cancelled"):
        return err("This order is already closed", 409)
    reason = clean(body().get("reason"), 100) or "Kitchen is running behind"
    flag_delay(order, reason)
    return ok({
        "order": order.to_dict(detail=True),
        "message": "Customer notified — the estimate moved back 10 minutes",
    })


# ===========================================================================
#  接口 · 菜单 / 库存
# ===========================================================================
@api.get("/menu-items")
@require_role(ROLE)
def list_menu():
    restaurant, error = _store_or_404()
    if error:
        return error
    items = [i.to_dict(for_merchant=True) for i in restaurant.menu_items]
    for item in items:
        item["emoji"] = dish_emoji(item["name"], item["category"])
        item["image_sm"] = small_image(item.get("image_url"))
    return ok({
        "items": items,
        "categories": sorted({i["category"] for i in items if i["category"]}),
        "stats": {
            "total": len(items),
            "sold_out": sum(1 for i in items if i["sold_out"]),
            "low_stock": sum(1 for i in items if i["stock_state"] == "low_stock"),
        },
    })


def _parse_item_payload(d: dict, partial: bool = False) -> tuple[dict, object]:
    data: dict = {}
    if "name" in d or not partial:
        name = clean(d.get("name"), 80)
        if len(name) < 2:
            return {}, err("Dish name must be at least 2 characters")
        data["name"] = name
    if "description" in d or not partial:
        data["description"] = clean(d.get("description"), 255) or None
    if "price" in d or not partial:
        try:
            price = float(d.get("price"))
        except (TypeError, ValueError):
            return {}, err("Price must be a number")
        if not 0 < price <= 9999:
            return {}, err("Price must be between 0 and 9999")
        data["price"] = Decimal(str(round(price, 2)))
    if "calories" in d or not partial:
        calories = d.get("calories")
        if calories in (None, ""):
            data["calories"] = None
        else:
            try:
                calories = int(calories)
            except (TypeError, ValueError):
                return {}, err("Calories must be a whole number")
            if not 0 <= calories <= 5000:
                return {}, err("Calories must be between 0 and 5000")
            data["calories"] = calories
    if "category" in d or not partial:
        data["category"] = clean(d.get("category"), 30) or "Mains"
    if "stock" in d:
        stock = d.get("stock")
        if stock in (None, "", "unlimited"):
            data["stock"] = None
        else:
            try:
                stock = int(stock)
            except (TypeError, ValueError):
                return {}, err("Stock must be a whole number, or empty for unlimited")
            if stock < 0:
                return {}, err("Stock cannot be negative")
            data["stock"] = stock
    if "is_available" in d:
        data["is_available"] = bool(d["is_available"])
    if "sort_order" in d:
        try:
            data["sort_order"] = int(d["sort_order"])
        except (TypeError, ValueError):
            data["sort_order"] = 0
    if "image_url" in d:
        data["image_url"] = clean(d.get("image_url"), 255) or None
    return data, None


@api.post("/menu-items")
@require_role(ROLE)
def create_menu_item():
    restaurant, error = _store_or_404()
    if error:
        return error
    data, problem = _parse_item_payload(body())
    if problem:
        return problem
    item = MenuItem(restaurant_id=restaurant.id, **data)
    db.session.add(item)
    db.session.commit()
    return ok({"item": item.to_dict(for_merchant=True),
               "message": f"{item.name} added to the menu"}, status=201)


@api.patch("/menu-items/<int:item_id>")
@require_role(ROLE)
def update_menu_item(item_id: int):
    restaurant, error = _store_or_404()
    if error:
        return error
    item = MenuItem.query.filter_by(id=item_id,
                                    restaurant_id=restaurant.id).first()
    if item is None:
        log_denied("restaurant_menu_item_not_owned", item_id=item_id)
        return err("Dish not found", 404)
    data, problem = _parse_item_payload(body(), partial=True)
    if problem:
        return problem
    for key, value in data.items():
        setattr(item, key, value)
    db.session.commit()
    return ok({"item": item.to_dict(for_merchant=True), "message": "Dish updated"})


@api.delete("/menu-items/<int:item_id>")
@require_role(ROLE)
def delete_menu_item(item_id: int):
    restaurant, error = _store_or_404()
    if error:
        return error
    item = MenuItem.query.filter_by(id=item_id,
                                    restaurant_id=restaurant.id).first()
    if item is None:
        log_denied("restaurant_menu_item_not_owned", item_id=item_id)
        return err("Dish not found", 404)
    db.session.delete(item)          # order_items 的快照不受影响
    db.session.commit()
    return ok({"message": f"{item.name} removed from the menu"})


@api.patch("/menu-items/<int:item_id>/stock")
@require_role(ROLE)
def update_stock(item_id: int):
    restaurant, error = _store_or_404()
    if error:
        return error
    item = MenuItem.query.filter_by(id=item_id,
                                    restaurant_id=restaurant.id).first()
    if item is None:
        log_denied("restaurant_menu_item_not_owned", item_id=item_id)
        return err("Dish not found", 404)
    d = body()

    if "stock" in d:
        stock = d.get("stock")
        if stock in (None, "", "unlimited"):
            item.stock = None
        else:
            try:
                stock = int(stock)
            except (TypeError, ValueError):
                return err("Stock must be a whole number")
            if stock < 0:
                return err("Stock cannot be negative")
            item.stock = stock
    if "is_available" in d:
        item.is_available = bool(d["is_available"])
    if "stock" not in d and "is_available" not in d:
        return err("Nothing to update")

    db.session.commit()
    return ok({
        "item": item.to_dict(for_merchant=True),
        "message": "Sold out" if item.sold_out else "Back on sale",
    })


@api.post("/menu-items/restock")
@require_role(ROLE)
def restock():
    """一键补货：把低库存的菜一次性加回一批"""
    restaurant, error = _store_or_404()
    if error:
        return error
    d = body()
    try:
        threshold = int(d.get("threshold", 5))
        amount = int(d.get("amount", 40))
    except (TypeError, ValueError):
        return err("threshold and amount must be whole numbers")
    if amount <= 0:
        return err("Restock amount must be greater than 0")

    touched = 0
    for item in restaurant.menu_items:
        if item.stock is not None and item.stock <= threshold:
            item.stock = item.stock + amount if item.stock > 0 else amount
            item.is_available = True
            touched += 1
    db.session.commit()
    return ok({"updated": touched,
               "message": f"Restocked {touched} dish(es) (+{amount} each)"})


# ===========================================================================
#  接口 · 异常与售后
# ===========================================================================
@api.get("/issues")
@require_role(ROLE)
def issues():
    restaurant, error = _store_or_404()
    if error:
        return error
    rows = _issue_rows(restaurant)
    return ok({
        "issues": rows,
        "counts": {
            "total": len(rows),
            "no_rider": sum(1 for r in rows if r["kind"] == "no_rider"),
            "delayed": sum(1 for r in rows if r["kind"] == "delayed"),
            "cancelled": sum(1 for r in rows if r["kind"] == "cancelled"),
            "sold_out": sum(1 for r in rows if r["kind"] == "sold_out"),
        },
    })


# ===========================================================================
#  接口 · 营业分析
# ===========================================================================
@api.get("/analytics")
@require_role(ROLE)
def analytics():
    restaurant, error = _store_or_404()
    if error:
        return error
    try:
        days = max(1, min(int(request.args.get("days", 7)), 30))
    except (TypeError, ValueError):
        days = 7

    labels = _day_labels(days)
    start = datetime.combine(labels[0], datetime.min.time())
    orders = Order.query.filter(
        Order.restaurant_id == restaurant.id, Order.created_at >= start).all()

    daily = []
    for day in labels:
        rows = [o for o in orders if o.created_at.date() == day]
        delivered = [o for o in rows if o.status == "delivered"]
        daily.append({
            "date": day.isoformat(),
            "label": day.strftime("%m-%d"),
            "orders": len(rows),
            "revenue": round(sum(money(o.total_amount) for o in delivered), 2),
            "cancelled": sum(1 for o in rows if o.status == "cancelled"),
        })

    top_counter: dict[str, dict] = {}
    for order in orders:
        if order.status != "delivered":
            continue
        for item in order.items:
            row = top_counter.setdefault(
                item.name_snapshot, {"name": item.name_snapshot,
                                     "quantity": 0, "revenue": 0.0})
            row["quantity"] += item.quantity
            row["revenue"] = round(row["revenue"] + money(item.subtotal), 2)
    top_items = sorted(top_counter.values(), key=lambda r: r["quantity"],
                       reverse=True)[:6]

    hourly = [{"hour": hour, "orders": 0} for hour in range(24)]
    for order in orders:
        hourly[order.created_at.hour]["orders"] += 1

    status_counts: dict[str, int] = {}
    for order in orders:
        status_counts[order.status] = status_counts.get(order.status, 0) + 1

    prep = [(o.ready_at - o.accepted_at).total_seconds() / 60
            for o in orders if o.ready_at and o.accepted_at]
    delivered = [o for o in orders if o.status == "delivered"]
    cancelled = [o for o in orders if o.status == "cancelled"]

    return ok({
        "days": days,
        "kpis": {
            "orders": len(orders),
            "delivered": len(delivered),
            "revenue": round(sum(money(o.total_amount) for o in delivered), 2),
            "avg_order_value": round(
                sum(money(o.total_amount) for o in delivered) / len(delivered), 2
            ) if delivered else 0.0,
            "cancel_rate": round(len(cancelled) / len(orders) * 100, 1)
            if orders else 0.0,
            "avg_prep_minutes": round(sum(prep) / len(prep), 1) if prep else 0.0,
        },
        "daily": daily,
        "top_items": top_items,
        "hourly": hourly,
        "status": [{"status": key, "count": value}
                   for key, value in sorted(status_counts.items())],
    })
