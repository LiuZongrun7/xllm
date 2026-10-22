"""
骑手端 —— 页面与接口（负责人：C）
================================================================================
这是骑手端的**全部代码入口**。答辩时只需要打开这一行下面这几个文件：

    rider/routes.py                 ← 本文件：页面路由 + 骑手侧接口
    rider/templates/rider/          ← 骑手端页面（Jinja2）
    rider/static/css/rider.css      ← 骑手端设计系统（与另两端零共享）
    rider/static/js/rider.js        ← 骑手端交互

只依赖 shared/ 里的数据模型、权限装饰器与订单状态机，不碰顾客端和商家端的任何东西。

页面前缀   /rider/...              → pages
接口前缀   /api/rider/...          → api

页面
    /login /register               登录 / 注册
    /                              工作台：在线状态 + 可接单池 + 进行中
    /orders/<id>                   订单详情 + 取餐 / 送达 / 位置上报
    /history                       配送历史
    /settings                      设置（在线状态 / 车型 / 服务半径）

接口
    工作台  GET    /workbench
    可接单  GET    /pool
    抢单    POST   /orders/<id>/claim      ← 必须原子
    我的单  GET    /orders                 GET /orders/<id>
            POST   /orders/<id>/pickup     POST /orders/<id>/deliver
    位置    POST   /orders/<id>/location
    状态    POST   /status
    历史    GET    /history
    资料    GET/PATCH /profile

⚠️ 抢单的原子性是 FR-21 的核心：两个骑手同时点，只能有一个成功。
   实现用 UPDATE ... WHERE rider_id IS NULL，然后看 rowcount，
   绝不能先 SELECT 再 UPDATE（中间会有竞态窗口）。
================================================================================
"""

from datetime import datetime, timedelta
from decimal import Decimal

from flask import Blueprint, render_template, request
from sqlalchemy import update

from shared.extensions import db
from shared.models import Order, RiderLocation, RiderProfile
from shared.order_flow import (FlowError, haversine_km, rating_summary,
                               rider_actions, transition)
from shared.security import current_user, log_denied, require_role, role_page
from shared.utils import body, clean, err, ok

# 页面
pages = Blueprint(
    "rider",
    __name__,
    url_prefix="/rider",
    template_folder="templates",
    static_folder="static",
    static_url_path="/static",
)

# 接口
api = Blueprint("rider_api", __name__, url_prefix="/api/rider")

ROLE = "rider"

# 位置上报的合理性阈值（客户端坐标不可全信）
MAX_ACCURACY_M = 200
MAX_SPEED_KMH = 80


# ===========================================================================
#  内部工具
# ===========================================================================
def _my_profile() -> RiderProfile:
    """骑手第一次打开页面时自动补一份档案，省掉一张引导页"""
    user = current_user()
    profile = db.session.get(RiderProfile, user.id)
    if profile is None:
        profile = RiderProfile(user_id=user.id, is_online=False,
                               vehicle_type="ebike",
                               service_radius_km=Decimal("5.00"))
        db.session.add(profile)
        db.session.commit()
    return profile


def _pool_query():
    return Order.query.filter(Order.status == "ready", Order.rider_id.is_(None))


def _rider_order(order_id: int) -> Order | None:
    """⚠️ 归属校验：只有已经属于我的订单才允许操作"""
    user = current_user()
    order = Order.query.filter_by(id=order_id, rider_id=user.id).first()
    if order is None:
        log_denied("rider_order_not_owned", order_id=order_id)
    return order


def _pool_card(order: Order) -> dict:
    data = order.to_dict()
    restaurant = order.restaurant
    data["pickup"] = {
        "name": restaurant.name if restaurant else None,
        "address_text": restaurant.address_text if restaurant else None,
        "lng": float(restaurant.lng) if restaurant else None,
        "lat": float(restaurant.lat) if restaurant else None,
        "phone": restaurant.phone if restaurant else None,
    }
    data["dropoff"] = {
        "address_text": order.delivery_address_text,
        "contact_name": order.delivery_contact_name,
        "contact_phone": order.delivery_contact_phone,
        "lng": float(order.delivery_lng),
        "lat": float(order.delivery_lat),
    }
    # 订单本身的里程：餐厅 → 收货地址（骑手据此判断值不值得抢）
    data["trip_km"] = order.distance_km
    data["address_updated_at"] = (
        order.address_updated_at.isoformat(timespec="seconds")
        if order.address_updated_at else None
    )
    data["waiting_minutes"] = (
        int((datetime.now() - order.ready_at).total_seconds() // 60)
        if order.ready_at else 0
    )
    return data


def _active_cards(rider_id: int) -> list[dict]:
    orders = (Order.query.filter(
        Order.rider_id == rider_id,
        Order.status.in_(("delivering",)),
    ).order_by(Order.picked_up_at.asc()).all())
    cards = []
    for order in orders:
        card = _pool_card(order)
        card["actions"] = rider_actions(order)
        locations = (RiderLocation.query.filter_by(order_id=order.id)
                     .order_by(RiderLocation.recorded_at.desc()).limit(1).all())
        card["last_location"] = locations[0].to_dict() if locations else None
        cards.append(card)
    return cards


def _stats(rider_id: int) -> dict:
    day_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    delivered_today = Order.query.filter(
        Order.rider_id == rider_id, Order.status == "delivered",
        Order.delivered_at >= day_start).all()
    all_delivered = Order.query.filter(
        Order.rider_id == rider_id, Order.status == "delivered").all()
    return {
        "today_deliveries": len(delivered_today),
        "today_distance_km": round(
            sum(float(o.distance_km or 0) for o in delivered_today), 1),
        "total_deliveries": len(all_delivered),
        "total_distance_km": round(
            sum(float(o.distance_km or 0) for o in all_delivered), 1),
        "rating": rating_summary("rider", rider_id),
    }


# ===========================================================================
#  页面
# ===========================================================================
@pages.get("/design-system")
def design_system():
    """骑手端设计规范样张页（答辩时用来讲这一端的视觉语言）"""
    return render_template("rider/design-system.html")


@pages.get("/login")
def login_page():
    return render_template("rider/login.html", mode="login")


@pages.get("/register")
def register_page():
    return render_template("rider/register.html", mode="register")


@pages.get("/")
@role_page(ROLE, "rider.login_page")
def workbench():
    return render_template("rider/workbench.html", page="workbench")


@pages.get("/orders/<int:order_id>")
@role_page(ROLE, "rider.login_page")
def order_page(order_id: int):
    return render_template("rider/order.html", page="workbench",
                           order_id=order_id)


@pages.get("/history")
@role_page(ROLE, "rider.login_page")
def history_page():
    return render_template("rider/history.html", page="history")


@pages.get("/settings")
@role_page(ROLE, "rider.login_page")
def settings_page():
    return render_template("rider/settings.html", page="settings")


# ===========================================================================
#  接口 · 工作台
# ===========================================================================
@api.get("/workbench")
@require_role(ROLE)
def workbench_data():
    user = current_user()
    profile = _my_profile()
    pool = _pool_query().order_by(Order.ready_at.asc()).limit(12).all()
    return ok({
        "profile": profile.to_dict(),
        "stats": _stats(user.id),
        "pool": [_pool_card(o) for o in pool],
        "active": _active_cards(user.id),
        "pool_count": len(pool),
    })


@api.get("/pool")
@require_role(ROLE)
def pool():
    rows = _pool_query().order_by(Order.ready_at.asc()).limit(20).all()
    return ok({"orders": [_pool_card(o) for o in rows]})


@api.post("/orders/<int:order_id>/claim")
@require_role(ROLE)
def claim(order_id: int):
    """原子抢单 —— 一条 UPDATE 决定归属，失败就是"已被别人抢走" """
    user = current_user()
    profile = _my_profile()
    if not profile.is_online:
        return err("Go online first, then grab an order", 409)

    result = db.session.execute(
        update(Order)
        .where(Order.id == order_id,
               Order.status == "ready",
               Order.rider_id.is_(None))
        .values(rider_id=user.id)
    )
    db.session.commit()

    if result.rowcount == 0:
        order = db.session.get(Order, order_id)
        if order is None:
            return err("Order not found", 404)
        if order.rider_id == user.id:
            return ok({"order": _pool_card(order),
                       "message": "This order is already yours"})
        if order.status != "ready":
            return err("Too late — this order is no longer available to claim",
                       409)
        return err("Too late — another rider grabbed this order first", 409)

    order = db.session.get(Order, order_id)
    return ok({
        "order": _pool_card(order),
        "message": "Order claimed — head to the restaurant",
    })


@api.get("/orders")
@require_role(ROLE)
def my_orders():
    return ok({"orders": _active_cards(current_user().id)})


@api.get("/orders/<int:order_id>")
@require_role(ROLE)
def order_detail(order_id: int):
    order = _rider_order(order_id)
    if order is None:
        # 可接单池里的单也允许查看详情（抢单前先看看地址）
        order = _pool_query().filter(Order.id == order_id).first()
        if order is None:
            return err("Order not found or not assigned to you", 404)
        data = _pool_card(order)
        data["actions"] = ["claim"]
        return ok(data)

    data = _pool_card(order)
    data["actions"] = rider_actions(order)
    data["timeline"] = order.to_dict(detail=True)["timeline"]
    locations = (RiderLocation.query.filter_by(order_id=order.id)
                 .order_by(RiderLocation.recorded_at.desc()).limit(20).all())
    data["trail"] = [loc.to_dict() for loc in locations]
    data["last_location"] = data["trail"][0] if data["trail"] else None
    return ok(data)


@api.post("/orders/<int:order_id>/pickup")
@require_role(ROLE)
def pickup(order_id: int):
    order = _rider_order(order_id)
    if order is None:
        return err("Order not found or not assigned to you", 404)
    try:
        transition(order, "delivering", "rider")
    except FlowError as exc:
        return err(exc.message, exc.status)
    return ok({"order": _pool_card(order),
               "message": "Picked up — deliver it while it is hot"})


@api.post("/orders/<int:order_id>/deliver")
@require_role(ROLE)
def deliver(order_id: int):
    order = _rider_order(order_id)
    if order is None:
        return err("Order not found or not assigned to you", 404)
    try:
        transition(order, "delivered", "rider")
    except FlowError as exc:
        return err(exc.message, exc.status)
    return ok({"order": _pool_card(order),
               "message": "Delivered — the customer has been notified"})


# ===========================================================================
#  接口 · 位置上报（FR-23）
# ===========================================================================
@api.post("/orders/<int:order_id>/location")
@require_role(ROLE)
def report_location(order_id: int):
    """浏览器上报的坐标不可全信：限制精度、限制瞬时速度"""
    user = current_user()
    order = _rider_order(order_id)
    if order is None:
        return err("Order not found or not assigned to you", 404)
    if order.status not in ("delivering", "ready"):
        return err("Location reporting is only needed while delivering", 409)

    d = body()
    try:
        lng, lat = float(d.get("lng")), float(d.get("lat"))
    except (TypeError, ValueError):
        return err("Invalid coordinates")
    if not (-180 <= lng <= 180 and -90 <= lat <= 90):
        return err("Coordinates out of range")

    accuracy = d.get("accuracy_m")
    try:
        accuracy = int(accuracy) if accuracy is not None else None
    except (TypeError, ValueError):
        accuracy = None
    if accuracy is not None and accuracy > MAX_ACCURACY_M:
        return err("GPS signal is too weak to report a position — "
                   "move somewhere more open and try again", 422)

    last = (RiderLocation.query.filter_by(order_id=order.id)
            .order_by(RiderLocation.recorded_at.desc()).first())
    if last is not None:
        elapsed_h = max((datetime.now() - last.recorded_at).total_seconds(), 1) / 3600
        jumped = haversine_km(float(last.lat), float(last.lng), lat, lng)
        if jumped / elapsed_h > MAX_SPEED_KMH:
            return err("That position is impossible to reach that fast — "
                       "check your GPS and try again", 422)

    row = RiderLocation(rider_id=user.id, order_id=order.id,
                        lng=Decimal(str(lng)), lat=Decimal(str(lat)),
                        accuracy_m=accuracy)
    db.session.add(row)
    db.session.commit()
    return ok({"location": row.to_dict(), "message": "Location shared"})


# ===========================================================================
#  接口 · 在线状态 / 资料 / 历史
# ===========================================================================
@api.post("/status")
@require_role(ROLE)
def set_status():
    profile = _my_profile()
    data = body()
    if "is_online" not in data:
        return err("Send {is_online: true|false}")
    profile.is_online = bool(data["is_online"])
    db.session.commit()
    return ok({
        "profile": profile.to_dict(),
        "message": "You are online — grab orders from the pool" if profile.is_online
        else "You are offline — you will not see new orders",
    })


@api.get("/profile")
@require_role(ROLE)
def profile():
    user = current_user()
    return ok({"user": user.to_dict(),
               "profile": _my_profile().to_dict(),
               "stats": _stats(user.id)})


@api.patch("/profile")
@require_role(ROLE)
def update_profile():
    user = current_user()
    profile = _my_profile()
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
    if "vehicle_type" in d:
        vehicle = clean(d.get("vehicle_type"), 20)
        if vehicle not in ("bike", "ebike", "motorbike", "car"):
            return err("vehicle_type must be bike, ebike, motorbike or car")
        profile.vehicle_type = vehicle
    if "service_radius_km" in d:
        try:
            radius = float(d["service_radius_km"])
        except (TypeError, ValueError):
            return err("Service radius must be a number")
        if not 1 <= radius <= 30:
            return err("Service radius must be between 1 and 30 km")
        profile.service_radius_km = Decimal(str(radius))

    db.session.commit()
    return ok({"user": user.to_dict(), "profile": profile.to_dict(),
               "message": "Settings saved"})


@api.get("/history")
@require_role(ROLE)
def history():
    user = current_user()
    try:
        days = max(1, min(int(request.args.get("days", 30)), 90))
    except (TypeError, ValueError):
        days = 30
    since = datetime.now() - timedelta(days=days)
    rows = (Order.query.filter(
        Order.rider_id == user.id, Order.status == "delivered",
        Order.delivered_at >= since,
    ).order_by(Order.delivered_at.desc()).limit(60).all())
    return ok({
        "orders": [o.to_dict() for o in rows],
        "summary": {
            "deliveries": len(rows),
            "distance_km": round(sum(float(o.distance_km or 0) for o in rows), 1),
            "days": days,
        },
    })
