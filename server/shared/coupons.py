"""
优惠券引擎 —— 官方发券（付费券包 + 新人限时券）

设计要点（这几条决定了整个功能是否站得住）：

1. **券包是商品。** 券包有价格、库存、限购、上下架；购买一次就按包内容
   批量发行用户券。价格低于面额的部分就是平台的营销成本。

2. **规则只有一份。** 门槛、抵扣算法、可用性判断全部在本模块，
   结算页试算和下单接口都调它 —— 不允许前端另算一遍。

3. **核销是一次条件写入。** 和骑手抢单同一个模式：

       UPDATE user_coupons SET status='used' WHERE id=? AND status='unused'

   rowcount 为 0 就说明这张券已经被用掉了，直接 409。

4. **取消要退券。** 订单被取消时把券退回（未过期的还能再用），
   钱和权益必须一起回滚。

5. **过期是惰性的。** 不写定时任务：读的时候用 expires_at 判断，
   状态列只在"真的用掉/退回"时写。
"""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import or_, update

from shared.extensions import db
from shared.models import (Coupon, CouponPackage, CouponPackageItem,
                           CouponPurchase, UserCoupon)

# 新人券：券模板由 seed 建好，这里只按 code 找
NEW_USER_TEMPLATE_CODE = "NEW15"
NEW_USER_VALID_DAYS = 2

CENT = Decimal("0.01")


class CouponError(Exception):
    """券相关业务错误，统一带状态码，路由层直接 err(message, status)。"""

    def __init__(self, message: str, status: int = 409, code: str = "coupon_error"):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


def _d(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(CENT, ROUND_HALF_UP)


def _f(value) -> float:
    return float(_d(value))


def discount_for(coupon: Coupon, items_amount) -> Decimal:
    """这张券能抵多少钱（永远不超过菜品小计，也不为负）。"""
    items = _d(items_amount)
    if items <= 0 or coupon is None:
        return Decimal("0.00")

    if coupon.discount_type == "percent":
        raw = items * _d(coupon.discount_value) / Decimal("100")
        if coupon.max_discount_amount is not None:
            raw = min(raw, _d(coupon.max_discount_amount))
    else:
        raw = _d(coupon.discount_value)

    return _d(min(max(raw, Decimal("0.00")), items))


def effective_status(user_coupon: UserCoupon, now: datetime | None = None) -> str:
    """读的时候算出真实状态：unused / used / expired。"""
    if user_coupon.status != "unused":
        return user_coupon.status
    now = now or datetime.now()
    if user_coupon.expires_at and user_coupon.expires_at <= now:
        return "expired"
    return "unused"


def check_usable(user_coupon: UserCoupon, restaurant_id: int, items_amount,
                 now: datetime | None = None) -> tuple[bool, str | None]:
    """能不能用在这家店的这一单上；不能用时给出人话原因（给结算页展示）。"""
    now = now or datetime.now()

    if user_coupon is None:
        return False, "Coupon not found"
    if user_coupon.status == "used":
        return False, "Already used"
    if effective_status(user_coupon, now) == "expired":
        return False, "Expired"

    coupon = user_coupon.coupon
    if coupon is None:
        return False, "Coupon unavailable"
    if coupon.end_at and coupon.end_at <= now:
        return False, "Expired"
    if coupon.owner_type == "restaurant" and coupon.owner_id != restaurant_id:
        return False, "Only valid at another restaurant"

    minimum = _d(coupon.min_order_amount)
    if _d(items_amount) < minimum:
        return False, f"Spend ¥{minimum:.2f} to use this coupon"

    return True, None


def price_order(restaurant, items_amount, user_coupon: UserCoupon | None = None) -> dict:
    """唯一的计价入口：菜品 + 配送 − 抵扣 = 实付。

    结算页的试算和 POST /orders 都调这一个函数，保证"看到的就是付的"。
    """
    items = _d(items_amount)
    fee = _d(restaurant.delivery_fee)
    discount = Decimal("0.00")
    error = None

    if user_coupon is not None:
        ok, reason = check_usable(user_coupon, restaurant.id, items)
        if ok:
            discount = discount_for(user_coupon.coupon, items)
        else:
            error = reason

    return {
        "items_amount": items,
        "delivery_fee": fee,
        "discount_amount": discount,
        "total_amount": _d(items + fee - discount),
        "coupon_error": error,
    }


# ---------------------------------------------------------------------------
#  发行
# ---------------------------------------------------------------------------
def grant_new_user(user) -> UserCoupon | None:
    """新人限时券：注册时自动发一张，48 小时内有效；已发过就不再发。"""
    template = Coupon.query.filter_by(code=NEW_USER_TEMPLATE_CODE).first()
    if template is None:
        return None

    existing = UserCoupon.query.filter_by(user_id=user.id,
                                          coupon_id=template.id).first()
    if existing is not None:
        return existing

    now = datetime.now()
    coupon = UserCoupon(
        user_id=user.id,
        coupon_id=template.id,
        status="unused",
        source="new_user",
        expires_at=now + timedelta(days=NEW_USER_VALID_DAYS),
    )
    db.session.add(coupon)
    db.session.commit()
    return coupon


def grant_package(user, package: CouponPackage) -> tuple[CouponPurchase, list[UserCoupon]]:
    """购买券包：扣库存 → 记购买 → 批量发券，全在一个事务里。"""
    now = datetime.now()

    if not package.is_active:
        raise CouponError("This coupon pack is no longer on sale")
    if package.start_at and now < package.start_at:
        raise CouponError("This coupon pack is not on sale yet")
    if package.end_at and now > package.end_at:
        raise CouponError("This coupon pack has ended")

    bought = CouponPurchase.query.filter_by(user_id=user.id,
                                            package_id=package.id).count()
    if bought >= (package.per_user_limit or 1):
        raise CouponError("You have reached the purchase limit for this pack")

    # 库存：一条条件更新，卖完就是 rowcount == 0（和抢单同一个手法）
    stock = db.session.execute(
        update(CouponPackage)
        .where(
            CouponPackage.id == package.id,
            CouponPackage.is_active.is_(True),
            or_(CouponPackage.total_quantity.is_(None),
                CouponPackage.sold_count < CouponPackage.total_quantity),
        )
        .values(sold_count=CouponPackage.sold_count + 1)
    )
    if stock.rowcount == 0:
        db.session.rollback()
        raise CouponError("This coupon pack is sold out")

    items = list(package.items)
    count = sum(int(item.quantity) for item in items)

    purchase = CouponPurchase(
        user_id=user.id,
        package_id=package.id,
        price_paid=_d(package.price),
        coupon_count=count,
        payment_status="paid",          # 模拟支付：没有真实网关
    )
    db.session.add(purchase)
    db.session.flush()

    expires_at = now + timedelta(days=int(package.validity_days or 30))
    issued: list[UserCoupon] = []
    for item in items:
        for _ in range(int(item.quantity)):
            coupon = UserCoupon(
                user_id=user.id,
                coupon_id=item.coupon_id,
                status="unused",
                source="purchase",
                purchase_id=purchase.id,
                expires_at=expires_at,
            )
            db.session.add(coupon)
            issued.append(coupon)

    db.session.commit()
    return purchase, issued


# ---------------------------------------------------------------------------
#  核销 / 退券
# ---------------------------------------------------------------------------
def redeem(user, user_coupon: UserCoupon, order) -> bool:
    """把券标记为已用。失败（已被用）返回 False —— 调用方回滚整单。"""
    result = db.session.execute(
        update(UserCoupon)
        .where(
            UserCoupon.id == user_coupon.id,
            UserCoupon.user_id == user.id,
            UserCoupon.status == "unused",
        )
        .values(status="used", order_id=order.id, used_at=datetime.now())
    )
    return result.rowcount == 1


def release_for_order(order) -> UserCoupon | None:
    """订单取消时退券；已经过期的直接标 expired，不再给用户。"""
    coupon = UserCoupon.query.filter_by(order_id=order.id, status="used").first()
    if coupon is None:
        return None

    now = datetime.now()
    coupon.order_id = None
    coupon.used_at = None
    if coupon.expires_at and coupon.expires_at <= now:
        coupon.status = "expired"
    else:
        coupon.status = "unused"
    return coupon


# ---------------------------------------------------------------------------
#  序列化
# ---------------------------------------------------------------------------
def _iso(value) -> str | None:
    return value.isoformat(timespec="seconds") if value else None


def serialize(user_coupon: UserCoupon, *, restaurant_id: int | None = None,
              items_amount=None, now: datetime | None = None) -> dict:
    now = now or datetime.now()
    coupon = user_coupon.coupon
    status = effective_status(user_coupon, now)

    data = {
        "id": user_coupon.id,
        "code": coupon.code if coupon else None,
        "title": coupon.title if coupon else "Coupon",
        "discount_type": coupon.discount_type if coupon else None,
        "discount_value": _f(coupon.discount_value) if coupon else 0,
        "min_order_amount": _f(coupon.min_order_amount) if coupon else 0,
        "max_discount_amount": (_f(coupon.max_discount_amount)
                                if coupon and coupon.max_discount_amount is not None else None),
        "funded_by": coupon.funded_by if coupon else "platform",
        "restaurant_id": (coupon.owner_id
                          if coupon and coupon.owner_type == "restaurant" else None),
        "status": status,
        "source": user_coupon.source,
        "claimed_at": _iso(user_coupon.claimed_at),
        "expires_at": _iso(user_coupon.expires_at),
        "used_at": _iso(user_coupon.used_at),
        "order_id": user_coupon.order_id,
    }

    if user_coupon.expires_at and status == "unused":
        left = user_coupon.expires_at - now
        data["expires_in_hours"] = max(int(left.total_seconds() // 3600), 0)
    else:
        data["expires_in_hours"] = None

    # 带上这单的上下文时，顺便算出"能不能用 / 能减多少"
    if restaurant_id is not None and items_amount is not None:
        ok, reason = check_usable(user_coupon, restaurant_id, items_amount, now)
        data["applicable"] = ok
        data["reason"] = reason
        data["discount_preview"] = _f(discount_for(coupon, items_amount)) if ok else 0
    return data


def summarize(user, *, restaurant_id: int | None = None, items_amount=None) -> dict:
    """我的券：可用 / 已用 / 已过期三组 + 计数（账户页角标用）。"""
    now = datetime.now()
    rows = (UserCoupon.query.filter_by(user_id=user.id)
            .order_by(UserCoupon.claimed_at.desc()).all())

    available, used, expired = [], [], []
    for row in rows:
        data = serialize(row, restaurant_id=restaurant_id,
                         items_amount=items_amount, now=now)
        if data["status"] == "unused":
            available.append(data)
        elif data["status"] == "used":
            used.append(data)
        else:
            expired.append(data)

    # 能用的排前面、快到期的排前面
    available.sort(key=lambda c: (not c.get("applicable", True),
                                  c.get("expires_at") or ""))
    return {
        "available": available,
        "used": used,
        "expired": expired,
        "counts": {"available": len(available), "used": len(used),
                   "expired": len(expired)},
    }
