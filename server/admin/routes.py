"""
管理大屏（平台运营视角）—— /admin
================================================================================
这是**第四块界面**，但它不是"第四个角色"：它不参与买卖，也没有属于自己的业务数据。
它只做一件事 —— 把顾客端、商家端、骑手端正在发生的事拼成一块可以盯着看的墙。

    admin/routes.py                    ← 本文件：登录 + 聚合接口
    admin/templates/admin/             ← 大屏 / 登录 / 错误页
    admin/static/css/admin.css         ← 大屏设计系统（与另三端零共享）
    admin/static/js/admin.js           ← 轮询 + 手写 SVG 图表 + 订单抽屉

页面前缀   /admin/...          → pages
接口前缀   /api/admin/...      → api

页面
    /login                运营账号登录
    /                     控制墙（KPI / 趋势 / 实时流水 / 门店 / 骑手 / 告警）
接口
    GET  /api/admin/overview?window=today|24h|7d    一整屏所需的数据，一次取完
    GET  /api/admin/orders/<id>                     抽屉里的订单详情

⚠️ 为什么管理员不放进 users 表
    users 表的 role 枚举是 customer / restaurant / rider —— 那是"市场里的一方"，
    每一行都拥有订单、菜单或配送记录。平台运营不属于任何一方，把它塞进去会
    污染三个端所有的归属查询（`WHERE rider_id = ...` 之类），还得为它改枚举。
    所以运营账号放在环境变量里（ADMIN_USER / ADMIN_PASSWORD），
    走独立的 session 键，与三端的登录互不影响 —— 一端登出不会连带大屏。

⚠️ 大屏是只读的
    写操作全部留在各自的端：接单是商家的决定，抢单是骑手的决定，取消是顾客的。
    大屏只负责"看见"，不提供任何能改变订单状态的按钮 —— 它永远不会成为
    绕开订单状态机的后门。

⚠️ 这里不做归属过滤，而是整体聚合：大屏看到的就是全平台。
    所以它必须比任何一端都更严格地要求登录，且只读。
================================================================================
"""

from __future__ import annotations

import hmac
import platform
import socket
import time
from collections import Counter
from datetime import datetime, timedelta
from functools import wraps

from flask import (Blueprint, current_app, redirect, render_template, request,
                   session, url_for)

from shared.catalog import dish_emoji
from shared.extensions import db
from shared.models import (Order, Restaurant, Review, RiderLocation,
                           RiderProfile, User)
from shared.order_flow import (ACTIVE_STATUSES, PREP_STATUSES, STATUS_LABELS,
                               haversine_km, money, restaurant_state)
from shared.security import current_user
from shared.utils import err, ok

# 页面
pages = Blueprint(
    "admin",
    __name__,
    url_prefix="/admin",
    template_folder="templates",
    static_folder="static",
    static_url_path="/static",
)

# 接口
api = Blueprint("admin_api", __name__, url_prefix="/api/admin")

SESSION_KEY = "ops_session"

# 登录节流：连错 6 次锁 5 分钟。运营账号是整块墙的钥匙，必须比普通登录更钝。
MAX_FAILS = 6
FAIL_WINDOW = 300
_fails: dict[str, list[float]] = {}


# ===========================================================================
#  登录 / 会话
# ===========================================================================
def admin_signed_in() -> bool:
    return bool(session.get(SESSION_KEY))


def _client_key() -> str:
    forwarded = request.headers.get("X-Real-IP") or request.headers.get("X-Forwarded-For")
    return (forwarded or request.remote_addr or "unknown").split(",")[0].strip()


def _locked_for(key: str) -> int:
    """还要锁多少秒；0 表示没锁"""
    now = time.time()
    hits = [t for t in _fails.get(key, []) if now - t < FAIL_WINDOW]
    if hits:
        _fails[key] = hits
    else:
        _fails.pop(key, None)
    if len(hits) < MAX_FAILS:
        return 0
    return int(FAIL_WINDOW - (now - hits[0])) + 1


def _check_credentials(username: str, password: str) -> bool:
    """环境变量里的运营账号。compare_digest 防时序侧信道。"""
    expected_user = current_app.config.get("ADMIN_USER", "admin")
    expected_pass = current_app.config.get("ADMIN_PASSWORD", "")
    if not expected_pass:
        return False
    user_ok = hmac.compare_digest(username.encode(), expected_user.encode())
    pass_ok = hmac.compare_digest(password.encode(), expected_pass.encode())
    return user_ok and pass_ok


def admin_required(view):
    """接口守卫：没登录就 401，前端据此弹回登录页"""
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not admin_signed_in():
            return err("Sign in to the operations console", 401)
        return view(*args, **kwargs)
    return wrapper


def admin_page(view):
    """页面守卫：没登录就跳登录页（浏览器要的是跳转，不能返回 JSON）"""
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not admin_signed_in():
            return redirect(url_for("admin.login", next=request.path))
        return view(*args, **kwargs)
    return wrapper


@pages.get("/login")
def login():
    if admin_signed_in():
        return redirect(url_for("admin.wall"))
    return render_template("admin/login.html",
                           error=None,
                           demo_hint=_demo_hint(),
                           marketplace_user=current_user())


@pages.post("/login")
def login_post():
    key = _client_key()
    wait = _locked_for(key)
    if wait:
        return render_template("admin/login.html",
                               error=f"Too many attempts. Try again in {wait // 60 + 1} min.",
                               demo_hint=_demo_hint(),
                               marketplace_user=current_user()), 429

    username = (request.form.get("username") or "").strip()
    password = request.form.get("password") or ""
    if not _check_credentials(username, password):
        _fails.setdefault(key, []).append(time.time())
        if len(_fails) > 500:                    # 别让随机 IP 把内存吃光
            _fails.clear()
            _fails[key] = [time.time()]
        current_app.logger.warning("[denied] admin login failed from %s (%d/%d)",
                                   key, len(_fails.get(key, [])), MAX_FAILS)
        return render_template("admin/login.html",
                               error="Wrong username or password.",
                               demo_hint=_demo_hint(),
                               marketplace_user=current_user()), 401

    _fails.pop(key, None)
    target = request.form.get("next") or "/admin/"
    if not target.startswith("/admin"):
        target = "/admin/"                      # 只允许回到大屏，防开放重定向

    # 只换掉运营的那把钥匙，不动同一个浏览器里三端的登录状态 ——
    # 运营常在同一个浏览器里一边盯墙一边看商家/顾客端，把他踢出去只会添乱。
    # 安全性不受影响：session 是签名 cookie，攻击者改不出 ops_session；
    # 登录前的会话里本来也没有任何特权字段可以"固定"。
    session.pop(SESSION_KEY, None)
    session[SESSION_KEY] = {"user": username,
                            "at": datetime.now().isoformat(timespec="seconds")}
    session.permanent = True
    current_app.logger.info("[admin] %s signed in from %s", username, key)
    return redirect(target)


@pages.post("/logout")
def logout():
    session.pop(SESSION_KEY, None)
    return redirect(url_for("admin.login"))


def _demo_hint() -> bool:
    """只有仍在使用默认口令时才在登录页提示演示账号 —— 换了密码提示自动消失"""
    return current_app.config.get("ADMIN_PASSWORD") == current_app.config.get("ADMIN_DEMO_PASSWORD")


# ===========================================================================
#  页面
# ===========================================================================
@pages.get("/")
@admin_page
def wall():
    return render_template("admin/wall.html",
                           page="wall",
                           signed_in_as=(session.get(SESSION_KEY) or {}).get("user", "ops"))


# ===========================================================================
#  时间窗口
# ===========================================================================
WINDOWS = {
    "today": "Today",
    "24h": "Last 24 hours",
    "7d": "Last 7 days",
}


def _bounds(key: str):
    """(start, end, prev_start, prev_end) —— 上一段用来算环比。

    「今天」的上一段刻意对齐到【昨天同一个时钟区间】（00:00→此刻），
    而不是"往前推同样长度"。否则 13:00 看大屏时，今天只和昨天 11:00–24:00
    比 —— 拿今天的上午去比昨天的午餐加晚餐，环比数字会毫无意义。
    """
    now = datetime.now()
    if key == "today":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        prev_start = start - timedelta(days=1)
        return start, now, prev_start, prev_start + (now - start)
    if key == "7d":
        start = (now - timedelta(days=6)).replace(hour=0, minute=0, second=0,
                                                 microsecond=0)
        return start, now, start - timedelta(days=7), start
    # 24h：对齐到整点，保证 KPI 与趋势图用的是同一段区间
    start = now.replace(minute=0, second=0, microsecond=0) - timedelta(hours=23)
    return start, now, start - timedelta(hours=24), start


def _buckets(key: str, start: datetime, now: datetime) -> list[dict]:
    """趋势图分桶。today 给满 24 个桶，未来的时段标 future 让前端画暗。"""
    if key == "7d":
        return [{
            "label": (start + timedelta(days=i)).strftime("%a %d"),
            "short": (start + timedelta(days=i)).strftime("%a"),
            "start": (start + timedelta(days=i)).isoformat(timespec="minutes"),
            "future": (start + timedelta(days=i)) > now,
        } for i in range(7)]

    total = 24 if key == "24h" else 24
    return [{
        "label": (start + timedelta(hours=h)).strftime("%H:00"),
        "short": (start + timedelta(hours=h)).strftime("%H"),
        "start": (start + timedelta(hours=h)).isoformat(timespec="minutes"),
        "future": (start + timedelta(hours=h)) > now,
    } for h in range(total)]


def _bucket_index(key: str, start: datetime, when: datetime, size: int) -> int:
    if key == "7d":
        index = (when.date() - start.date()).days
    else:
        index = int((when - start).total_seconds() // 3600)
    return max(0, min(index, size - 1))


# ===========================================================================
#  小工具
# ===========================================================================
def _minutes_since(value: datetime | None, now: datetime) -> int | None:
    if value is None:
        return None
    return max(int((now - value).total_seconds() // 60), 0)


def _pct(part: float, whole: float) -> float:
    return round(part / whole * 100, 1) if whole else 0.0


def _delta(current: float, previous: float) -> float | None:
    """环比百分比；上一期为 0 时没有意义，返回 None 让前端显示 ——"""
    if not previous:
        return None
    return round((current - previous) / previous * 100, 1)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat(timespec="seconds") if value else None


def _money_sum(orders) -> float:
    return round(sum(money(o.total_amount) for o in orders), 2)


def _avg(values: list[float]) -> float:
    return round(sum(values) / len(values), 1) if values else 0.0


# ===========================================================================
#  聚合：一整屏的数据
# ===========================================================================
@api.get("/overview")
@admin_required
def overview():
    key = request.args.get("window", "today")
    if key not in WINDOWS:
        key = "today"

    now = datetime.now()
    start, end, prev_start, prev_end = _bounds(key)

    # ---- 窗口内 + 上一段：一次查出来，省一次往返 ----
    recent = (Order.query
              .filter(Order.created_at >= prev_start, Order.created_at <= end)
              .all())
    current = [o for o in recent if o.created_at >= start]
    previous = [o for o in recent if prev_start <= o.created_at < prev_end]

    delivered = [o for o in current if o.status == "delivered"]
    cancelled = [o for o in current if o.status == "cancelled"]
    gross = _money_sum([o for o in current if o.status != "cancelled"])
    prev_gross = _money_sum([o for o in previous if o.status != "cancelled"])

    delivery_minutes = [
        (o.delivered_at - o.picked_up_at).total_seconds() / 60
        for o in delivered if o.delivered_at and o.picked_up_at
    ]
    prep_minutes = [
        (o.ready_at - o.accepted_at).total_seconds() / 60
        for o in current if o.ready_at and o.accepted_at
    ]

    # ---- "现在"正在发生的事（与窗口无关）----
    active = (Order.query
              .filter(Order.status.in_(ACTIVE_STATUSES))
              .order_by(Order.created_at.desc())
              .all())
    unassigned = [o for o in active if o.status == "ready" and o.rider_id is None]
    late = [o for o in active
            if o.estimated_delivery_at and o.estimated_delivery_at < now]
    delayed = [o for o in active if o.is_delayed]

    # ---- 门店 ----
    restaurants = Restaurant.query.all()
    loads = dict(db.session.query(Order.restaurant_id, db.func.count())
                 .filter(Order.status.in_(PREP_STATUSES))
                 .group_by(Order.restaurant_id).all())
    queues = dict(db.session.query(Order.restaurant_id, db.func.count())
                  .filter(Order.status == "pending")
                  .group_by(Order.restaurant_id).all())
    ratings = {rid: (round(float(avg), 1), int(cnt or 0))
               for rid, avg, cnt in db.session.query(
                   Review.target_id, db.func.avg(Review.rating), db.func.count(Review.id)
               ).filter(Review.target_type == "restaurant")
               .group_by(Review.target_id).all()}

    store_rows = []
    for store in restaurants:
        orders = [o for o in current if o.restaurant_id == store.id]
        state = restaurant_state(store, now, load=loads.get(store.id, 0))
        rating, review_count = ratings.get(store.id, (None, 0))
        store_rows.append({
            "id": store.id,
            "name": store.name,
            "cuisine": store.cuisine,
            "is_open": bool(store.is_open),
            "accepting": state["accepting"],
            "state": state["reason"] or "open",
            "state_label": state["label"],
            "detail": state["detail"],
            "hours": state["hours"],
            "load": state["active_orders"],
            "capacity": state["capacity"],
            "queue": queues.get(store.id, 0),
            "orders": len(orders),
            "delivered": sum(1 for o in orders if o.status == "delivered"),
            "cancelled": sum(1 for o in orders if o.status == "cancelled"),
            "revenue": _money_sum([o for o in orders if o.status == "delivered"]),
            "cancel_rate": _pct(sum(1 for o in orders if o.status == "cancelled"),
                                len(orders)),
            "rating": rating,
            "review_count": review_count,
            "avg_prep": round(_avg([
                (o.ready_at - o.accepted_at).total_seconds() / 60
                for o in orders if o.ready_at and o.accepted_at]), 1),
        })
    store_rows.sort(key=lambda row: row["revenue"], reverse=True)

    # ---- 骑手舰队 ----
    profiles = RiderProfile.query.all()
    rider_orders = [o for o in recent if o.rider_id]
    pings = {rid: last for rid, last in db.session.query(
        RiderLocation.rider_id, db.func.max(RiderLocation.recorded_at)
    ).group_by(RiderLocation.rider_id).all()}

    rider_rows = []
    for profile in profiles:
        user = profile.user
        mine = [o for o in rider_orders if o.rider_id == profile.user_id]
        done = [o for o in mine if o.status == "delivered"]
        trips = [(o.delivered_at - o.picked_up_at).total_seconds() / 60
                 for o in done if o.delivered_at and o.picked_up_at]
        on_time = [o for o in done
                   if o.delivered_at and o.estimated_delivery_at
                   and o.delivered_at <= o.estimated_delivery_at]
        rider_rows.append({
            "id": profile.user_id,
            "name": user.name if user else f"Rider {profile.user_id}",
            "phone": user.phone if user else None,
            "online": bool(profile.is_online),
            "vehicle": profile.vehicle_type,
            "radius": float(profile.service_radius_km or 0),
            "delivering": sum(1 for o in mine if o.status == "delivering"),
            "done": len(done),
            "orders": len(mine),
            "revenue": _money_sum(done),
            "avg_minutes": _avg(trips),
            "on_time_rate": _pct(len(on_time), len(done)),
            "last_ping_at": _iso(pings.get(profile.user_id)),
            "ping_age": _minutes_since(pings.get(profile.user_id), now),
        })
    rider_rows.sort(key=lambda row: (not row["online"], -row["done"], row["name"]))

    # ---- 实时流水：不受窗口限制，永远有内容 ----
    feed_rows = Order.query.order_by(Order.created_at.desc()).limit(18).all()

    # ---- 状态分布 ----
    counts = Counter(o.status for o in current)
    status_mix = [{
        "status": status,
        "label": STATUS_LABELS[status],
        "count": counts[status],
        "share": _pct(counts[status], len(current)),
    } for status in STATUS_LABELS if counts.get(status)]

    # ---- 热销 ----
    items: dict[str, dict] = {}
    for order in current:
        if order.status == "cancelled":
            continue
        for line in order.items:
            row = items.setdefault(line.name_snapshot,
                                   {"name": line.name_snapshot, "quantity": 0,
                                    "revenue": 0.0})
            row["quantity"] += line.quantity
            row["revenue"] = round(row["revenue"] + money(line.subtotal), 2)
    top_items = sorted(items.values(), key=lambda row: row["quantity"],
                       reverse=True)[:6]
    for row in top_items:
        row["emoji"] = dish_emoji(row["name"])

    # ---- 趋势 ----
    trend = _buckets(key, start, now)
    for bucket in trend:
        bucket["orders"] = 0
        bucket["revenue"] = 0.0
        bucket["delivered"] = 0
    for order in current:
        bucket = trend[_bucket_index(key, start, order.created_at, len(trend))]
        bucket["orders"] += 1
        bucket["revenue"] = round(bucket["revenue"] + money(order.total_amount), 2)
        if order.status == "delivered":
            bucket["delivered"] += 1

    payload = {
        "generated_at": _iso(now),
        "window": {"key": key, "label": WINDOWS[key]},
        "meta": {
            "orders_total": Order.query.count(),
            "customers": User.query.filter_by(role="customer").count(),
            "restaurants": len(restaurants),
            "riders": len(profiles),
            "engine": db.engine.dialect.name,
            "python": platform.python_version(),
            "host": socket.gethostname(),
        },
        "kpis": {
            "orders": len(current),
            "orders_delta": _delta(len(current), len(previous)),
            "gross": gross,
            "gross_delta": _delta(gross, prev_gross),
            "avg_order": round(gross / len(current), 2) if current else 0.0,
            "active": len(active),
            "unassigned": len(unassigned),
            "late": len(late),
            "delivered": len(delivered),
            "completion": _pct(len(delivered), len(current)),
            "cancelled": len(cancelled),
            "cancel_rate": _pct(len(cancelled), len(current)),
            "avg_delivery_minutes": _avg(delivery_minutes),
            "avg_prep_minutes": _avg(prep_minutes),
            "delayed": len(delayed),
            "online_riders": sum(1 for row in rider_rows if row["online"]),
            "open_restaurants": sum(1 for row in store_rows if row["accepting"]),
        },
        "trend": trend,
        "status_mix": status_mix,
        "top_items": top_items,
        "restaurants": store_rows,
        "riders": rider_rows,
        "alerts": _alerts(active, store_rows, rider_rows, late, now),
        "live": [_feed_row(o, now) for o in feed_rows],
    }
    return ok(payload)


def _feed_row(order: Order, now: datetime) -> dict:
    eta_late = bool(order.estimated_delivery_at
                    and order.estimated_delivery_at < now
                    and order.is_active)
    return {
        "id": order.id,
        "order_no": order.order_no,
        "status": order.status,
        "status_label": STATUS_LABELS.get(order.status, order.status),
        "active": order.is_active,
        "restaurant": order.restaurant.name if order.restaurant else "—",
        "restaurant_id": order.restaurant_id,
        "customer": order.customer.name if order.customer else "—",
        "rider": order.rider.name if order.rider else None,
        "total": money(order.total_amount),
        "item_count": sum(i.quantity for i in order.items),
        "items": [f"{i.quantity}× {i.name_snapshot}" for i in order.items][:4],
        "created_at": _iso(order.created_at),
        "age_minutes": _minutes_since(order.created_at, now),
        "delayed": order.is_delayed,
        "late": eta_late,
        "distance_km": money(order.distance_km) if order.distance_km is not None else None,
        "address": order.delivery_address_text,
    }


def _alerts(active, stores, riders, late, now) -> list[dict]:
    """运营真正需要被叫醒的几件事。按严重程度排序，最多 8 条。"""
    rows: list[dict] = []
    late_ids = {o.id for o in late}

    def add(severity: str, kind: str, title: str, detail: str,
            order: Order | None = None, age: int | None = None) -> None:
        rows.append({
            "severity": severity,
            "kind": kind,
            "title": title,
            "detail": detail,
            "order_id": order.id if order else None,
            "order_no": order.order_no if order else None,
            "age_minutes": age,
        })

    for order in active:
        age = _minutes_since(order.created_at, now) or 0
        store = order.restaurant.name if order.restaurant else "—"

        if order.status == "pending" and age >= 5:
            add("critical" if age >= 10 else "warn", "not_accepted",
                f"Not accepted for {age} min", f"{order.order_no} · {store}",
                order, age)

        if order.status == "ready" and order.rider_id is None:
            waiting = _minutes_since(order.ready_at, now) or 0
            if waiting >= 8:
                add("critical" if waiting >= 15 else "warn", "nobody_picking_up",
                    f"Ready with no rider for {waiting} min",
                    f"{order.order_no} · {store}", order, waiting)

        if order.is_delayed:
            add("warn", "kitchen_delayed", "Kitchen flagged a delay",
                order.delay_reason or "No reason given", order,
                _minutes_since(order.delay_flagged_at, now))

        if order.id in late_ids and order.status in ("accepted", "preparing",
                                                     "ready", "delivering"):
            over = _minutes_since(order.estimated_delivery_at, now) or 0
            add("critical", "past_eta", f"Past the promised time by {over} min",
                f"{order.order_no} · {order.customer.name if order.customer else '—'}",
                order, over)

    for store in stores:
        if store["state"] == "full":
            add("warn", "saturated", "Kitchen at capacity",
                f"{store['name']} · {store['load']}/{store['capacity']} in the kitchen")
        if not store["is_open"] and store["queue"]:
            add("critical", "closed_with_queue", "Closed but orders are waiting",
                f"{store['name']} · {store['queue']} unaccepted order(s)")
        if (store["rating"] is not None and store["rating"] <= 3.4
                and store["review_count"] >= 3):
            add("info", "low_rating", "Rating needs attention",
                f"{store['name']} · {store['rating']} from {store['review_count']} reviews")

    for rider in riders:
        if rider["delivering"] and (rider["ping_age"] or 0) >= 10:
            add("warn", "rider_silent", f"No signal for {rider['ping_age']} min",
                f"{rider['name']} · carrying {rider['delivering']} order(s)")
        if not rider["online"] and rider["delivering"]:
            add("warn", "rider_offline", "Offline but still carrying an order",
                f"{rider['name']} · {rider['delivering']} in hand")

    severity_rank = {"critical": 0, "warn": 1, "info": 2}
    rows.sort(key=lambda row: (severity_rank.get(row["severity"], 3),
                               -(row["age_minutes"] or 0)))
    return rows[:8]


# ===========================================================================
#  抽屉：单笔订单的完整轨迹
# ===========================================================================
@api.get("/orders/<int:order_id>")
@admin_required
def order_detail(order_id: int):
    order = Order.query.get(order_id)
    if order is None:
        return err("Order not found", 404)

    now = datetime.now()
    data = order.to_dict(detail=True)
    data["status_label"] = STATUS_LABELS.get(order.status, order.status)
    data["age_minutes"] = _minutes_since(order.created_at, now)
    data["minutes"] = {
        "to_accept": _minutes_since(order.accepted_at, now) if order.accepted_at else None,
        "prep": round((order.ready_at - order.accepted_at).total_seconds() / 60)
        if order.ready_at and order.accepted_at else None,
        "to_deliver": round((order.delivered_at - order.picked_up_at).total_seconds() / 60)
        if order.delivered_at and order.picked_up_at else None,
        "total": round((order.delivered_at - order.created_at).total_seconds() / 60)
        if order.delivered_at else None,
    }
    data["restaurant_detail"] = order.restaurant.to_dict() if order.restaurant else None
    location = (RiderLocation.query.filter_by(order_id=order.id)
                .order_by(RiderLocation.recorded_at.desc()).first())
    data["rider_location"] = location.to_dict() if location else None
    if location and order.restaurant:
        data["rider_distance_km"] = haversine_km(
            float(location.lat), float(location.lng),
            float(order.restaurant.lat), float(order.restaurant.lng))
    return ok(data)
