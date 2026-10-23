"""
订单状态机 + 共享业务计算 —— 三端唯一的"业务真相"

为什么单独一个文件：
    顾客点"取消"、商家点"接单"、骑手点"取餐"，改的都是同一行 orders。
    如果每个端的 routes.py 各自写 if status == ...，三份状态机必然逐渐不一致。
    所以流转规则、时间戳、产能判断都放这里，三端只能调用，不能自己判断。

状态流转（题目要求的主链路）
    pending ──Accept──> accepted ──Start preparing──> preparing ──Mark ready──> ready
    ready ──(rider)Grab order──> ready(rider_id 落库) ──Mark picked up──> delivering
    delivering ──Confirm delivered──> delivered

    取消：pending / accepted 可由顾客发起；preparing 之后顾客不能自行取消，
          只能由商家（缺货、地址问题）或系统取消。
"""

from __future__ import annotations

import math
import secrets
from datetime import datetime, time, timedelta

from sqlalchemy import func

from shared.extensions import db
from shared.models import (Order, OpeningHour, Restaurant, Review)

# ---------------------------------------------------------------------------
#  词表：三端一字不差（见 docs/设计语言.md §6.1）
# ---------------------------------------------------------------------------
STATUS_LABELS = {
    "pending": "Placed",
    "accepted": "Accepted",
    "preparing": "Preparing",
    "ready": "Ready",
    "delivering": "On the way",
    "delivered": "Delivered",
    "cancelled": "Cancelled",
}

# 顾客端时间轴不单独显示 ready，并入 On the way 之前
CUSTOMER_TIMELINE = ("pending", "accepted", "preparing", "delivering", "delivered")

ACTIVE_STATUSES = ("pending", "accepted", "preparing", "ready", "delivering")
PREP_STATUSES = ("pending", "accepted", "preparing")   # 占用备餐产能的订单

# (from, to) -> 允许发起该流转的角色
TRANSITIONS = {
    ("pending", "accepted"): {"restaurant"},
    ("pending", "cancelled"): {"customer", "restaurant", "system"},
    ("accepted", "preparing"): {"restaurant"},
    ("accepted", "cancelled"): {"customer", "restaurant", "system"},
    ("preparing", "ready"): {"restaurant"},
    ("preparing", "cancelled"): {"restaurant", "system"},
    ("ready", "delivering"): {"rider"},
    ("ready", "cancelled"): {"restaurant", "system"},
    ("delivering", "delivered"): {"rider"},
    ("delivering", "cancelled"): {"system"},
}

STAMP_FIELD = {
    "accepted": "accepted_at",
    "preparing": "preparing_at",
    "ready": "ready_at",
    "delivering": "picked_up_at",
    "delivered": "delivered_at",
    "cancelled": "cancelled_at",
}


class FlowError(Exception):
    """状态流转被拒绝 —— 交给调用方转成 HTTP 4xx"""

    def __init__(self, message: str, status: int = 409, code: str = "conflict"):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


# ---------------------------------------------------------------------------
#  状态流转
# ---------------------------------------------------------------------------
def transition(order: Order, target: str, actor: str,
               reason: str | None = None) -> Order:
    """执行一次状态流转；非法流转抛 FlowError。

    actor 是 "customer" / "restaurant" / "rider" / "system"，
    它回答的是"谁点的这个按钮"，而不是"谁是订单的谁"。
    """
    allowed_actors = TRANSITIONS.get((order.status, target))
    if allowed_actors is None:
        raise FlowError(
            f"Cannot move this order from {STATUS_LABELS.get(order.status)} "
            f"to {STATUS_LABELS.get(target, target)}"
        )
    if actor not in allowed_actors:
        raise FlowError(
            f"This action is not allowed for {actor} in status "
            f"{STATUS_LABELS.get(order.status)}", status=403, code="forbidden"
        )

    order.status = target
    stamp = STAMP_FIELD.get(target)
    if stamp:
        setattr(order, stamp, datetime.now())

    if target == "cancelled":
        order.cancel_reason = (reason or "Cancelled")[:100]
        order.cancelled_by = "customer" if actor == "customer" else (
            actor if actor in ("restaurant", "rider", "system") else "system")
        if order.payment_status == "paid":
            order.payment_status = "refunded"

    db.session.commit()
    return order


def flag_delay(order: Order, reason: str | None = None) -> Order:
    """商家标记延迟（FR-18）—— 不改变状态，只加标记并顺延预计送达"""
    order.delay_flagged_at = datetime.now()
    order.delay_reason = (reason or "Kitchen is running behind")[:100]
    if order.estimated_delivery_at:
        order.estimated_delivery_at += timedelta(minutes=10)
    db.session.commit()
    return order


# ---------------------------------------------------------------------------
#  几何 / 金额 / 时间
# ---------------------------------------------------------------------------
EARTH_RADIUS_KM = 6371.0


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """两点直线距离（km）。不调地图 API —— 配送范围校验用这个就够。"""
    p1, p2 = math.radians(float(lat1)), math.radians(float(lat2))
    d_lat = p2 - p1
    d_lng = math.radians(float(lng2) - float(lng1))
    a = math.sin(d_lat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(d_lng / 2) ** 2
    return round(2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a)), 2)


def money(value) -> float:
    return round(float(value or 0), 2)


def new_order_no() -> str:
    """对外展示的订单号：XLM-261022-7F3K，可读、不暴露自增 id"""
    while True:
        candidate = "XLM-{}-{}".format(
            datetime.now().strftime("%y%m%d"),
            secrets.token_hex(2).upper(),
        )
        if not Order.query.filter_by(order_no=candidate).first():
            return candidate


def estimate_delivery_at(prep_minutes: int, distance_km: float,
                         start: datetime | None = None) -> datetime:
    """备餐时长 + 路上时间（按 18 km/h 估算），给顾客一个可解释的预计时间"""
    start = start or datetime.now()
    riding = max(int(distance_km / 18 * 60), 5) if distance_km else 10
    return start + timedelta(minutes=int(prep_minutes or 20) + riding)


# ---------------------------------------------------------------------------
#  营业时间 / 产能
# ---------------------------------------------------------------------------
def week_hours(restaurant: Restaurant) -> list[OpeningHour]:
    return sorted(restaurant.opening_hours, key=lambda h: h.weekday)


def _today_hours(restaurant: Restaurant, now: datetime) -> OpeningHour | None:
    weekday = now.isoweekday()
    for row in restaurant.opening_hours:
        if row.weekday == weekday:
            return row
    return None


def hours_state(restaurant: Restaurant, now: datetime | None = None) -> dict:
    """当前是否在营业时段内；返回给人看的说明，前端的 tooltip 直接用"""
    now = now or datetime.now()
    row = _today_hours(restaurant, now)
    if row is None or row.is_closed:
        return {"within_hours": False, "label": "Closed today", "closes_at": None}

    open_at, close_at = row.open_time, row.close_time
    current = now.time()
    overnight = close_at <= open_at
    inside = (current >= open_at or current <= close_at) if overnight \
        else (open_at <= current <= close_at)
    if not inside:
        return {
            "within_hours": False,
            "label": f"Opens at {open_at.strftime('%H:%M')}",
            "closes_at": close_at.strftime("%H:%M"),
        }
    return {
        "within_hours": True,
        "label": f"Open until {close_at.strftime('%H:%M')}",
        "closes_at": close_at.strftime("%H:%M"),
    }


def prep_load(restaurant_id: int) -> int:
    """正在占用备餐产能的单数"""
    return Order.query.filter(
        Order.restaurant_id == restaurant_id,
        Order.status.in_(PREP_STATUSES),
    ).count()


def restaurant_state(restaurant: Restaurant, now: datetime | None = None,
                     load: int | None = None) -> dict:
    """顾客端看到的"这家店现在能不能下单"。

    三种不能下单的原因必须区分开，因为顾客能做的动作不同：
        paused → 店家手动打烊（等一会儿再来）
        hours  → 不在营业时段（显示几点开门）
        full   → 备餐产能满（店家忙不过来）

    load 可由调用方传入（例如管理大屏一次查完所有门店的负载），
    不传就退回单店查询 —— 单店页面不需要关心这件事。
    """
    now = now or datetime.now()
    hours = hours_state(restaurant, now)
    if load is None:
        load = prep_load(restaurant.id)
    capacity = restaurant.max_concurrent_orders or 20

    if not restaurant.is_open:
        state = {"accepting": False, "reason": "paused",
                 "label": "Closed", "detail": "The restaurant has paused orders"}
    elif not hours["within_hours"]:
        state = {"accepting": False, "reason": "hours",
                 "label": "Closed", "detail": hours["label"]}
    elif load >= capacity:
        state = {"accepting": False, "reason": "full",
                 "label": "Busy", "detail": "Kitchen is at capacity right now"}
    else:
        state = {"accepting": True, "reason": None,
                 "label": "Open", "detail": hours["label"]}

    state.update({
        "hours": hours["label"],
        "active_orders": load,
        "capacity": capacity,
        "seats_left": max(capacity - load, 0),
    })
    return state


# ---------------------------------------------------------------------------
#  评分汇总
# ---------------------------------------------------------------------------
def rating_summary(target_type: str, target_id: int) -> dict:
    row = db.session.query(
        func.avg(Review.rating), func.count(Review.id)
    ).filter(
        Review.target_type == target_type, Review.target_id == target_id
    ).one()
    avg, count = row[0], row[1]
    return {
        "rating": round(float(avg), 1) if avg is not None else None,
        "review_count": int(count or 0),
    }


# ---------------------------------------------------------------------------
#  给前端的辅助判断
# ---------------------------------------------------------------------------
def customer_actions(order: Order) -> list[str]:
    if order.status in ("pending", "accepted"):
        return ["cancel"]
    if order.status == "delivered" and not order.reviews:
        return ["review"]
    return []


def merchant_actions(order: Order) -> list[str]:
    if order.status == "pending":
        return ["accept", "decline"]
    if order.status == "accepted":
        return ["preparing", "decline"]
    if order.status == "preparing":
        return ["ready", "flag_delay"]
    if order.status == "ready":
        return ["flag_delay"]
    return []


def rider_actions(order: Order) -> list[str]:
    if order.status == "ready":
        return ["pickup"]
    if order.status == "delivering":
        return ["deliver"]
    return []


def recent_locations(order_id: int, limit: int = 1) -> list[dict]:
    from shared.models import RiderLocation
    rows = (
        RiderLocation.query
        .filter_by(order_id=order_id)
        .order_by(RiderLocation.recorded_at.desc())
        .limit(limit).all()
    )
    return [r.to_dict() for r in rows]


def parse_hhmm(value: str | None, fallback: time = time(9, 0)) -> time:
    """'09:30' -> time(9,30)；解析不了就用兜底值，不让坏数据打断保存"""
    try:
        hour, minute = str(value).split(":")[:2]
        return time(int(hour), int(minute))
    except (ValueError, AttributeError):
        return fallback
