"""
SQLAlchemy 模型 —— 与 database/schema.sql 一一对应

表清单
    users               用户（顾客 / 商家 / 骑手 三种角色共用）
    email_codes         邮箱验证码
    restaurants         餐厅
    rider_profiles      骑手档案（在线状态 / 车型 / 服务半径）★ schema 补充
    opening_hours       营业时间
    menu_items          菜品
    customer_addresses  顾客收货地址
    orders              订单（核心表）
    order_items         订单明细（菜品快照）
    reviews             评价（商家 + 骑手共用）
    rider_locations     骑手位置上报
    coupons             优惠券（加分项，本期不开放 UI）
    user_coupons        用户领券记录（同上）

两个工程细节
    1. 主键用 BIGINT，但 SQLite 只有 `INTEGER PRIMARY KEY` 才会自增，
       所以统一走 `_pk()` 做 SQLite 变体 —— 本地开发用 SQLite 也能跑。
    2. 时间统一存【服务器本地时间】的 naive datetime，前端按 HH:mm 显示。
"""

from datetime import datetime

from sqlalchemy.dialects.mysql import BIGINT
from werkzeug.security import check_password_hash, generate_password_hash

from shared.extensions import db


# ---------------------------------------------------------------------------
#  类型工具
# ---------------------------------------------------------------------------
def _pk():
    """BIGINT UNSIGNED 主键。

    两个平台细节都不能省：
      · MySQL：schema.sql 用的是 UNSIGNED，模型必须一致 —— 否则外键两边
        符号不同，`FOREIGN KEY ... REFERENCES users(id)` 会直接建表失败(3780)。
      · SQLite：只有 `INTEGER PRIMARY KEY` 才会自增，BIGINT 不会，
        所以降级成 Integer。
    """
    return BIGINT(unsigned=True).with_variant(db.Integer, "sqlite")


def _fk():
    return BIGINT(unsigned=True).with_variant(db.Integer, "sqlite")


def _now():
    return datetime.now()


def _f(value, digits: int = 2) -> float | None:
    """Decimal → float，JSON 里不出现字符串数字"""
    return None if value is None else round(float(value), digits)


def _dt(value: datetime | None) -> str | None:
    return value.isoformat(timespec="seconds") if value else None


# ---------------------------------------------------------------------------
#  用户与验证码
# ---------------------------------------------------------------------------
class User(db.Model):
    __tablename__ = "users"

    id = db.Column(_pk(), primary_key=True, autoincrement=True)
    role = db.Column(db.Enum("customer", "restaurant", "rider", name="user_role"),
                     nullable=False, default="customer")
    username = db.Column(db.String(40), nullable=False, unique=True)
    email = db.Column(db.String(120), nullable=False, unique=True)
    name = db.Column(db.String(50), nullable=False)
    phone = db.Column(db.String(20), nullable=True)
    password_hash = db.Column(db.String(255), nullable=False)
    avatar_url = db.Column(db.String(255), nullable=True)
    email_verified_at = db.Column(db.DateTime, nullable=True)
    is_active = db.Column(db.SmallInteger, nullable=False, default=1)
    created_at = db.Column(db.DateTime, nullable=False, default=_now,
                           server_default=db.func.current_timestamp())
    updated_at = db.Column(db.DateTime, nullable=False, default=_now, onupdate=_now,
                           server_default=db.func.current_timestamp())

    # ---- 密码 ----
    def set_password(self, raw: str) -> None:
        # werkzeug 默认用 scrypt，自带随机盐，同一密码每次哈希都不同
        self.password_hash = generate_password_hash(raw)

    def check_password(self, raw: str) -> bool:
        return check_password_hash(self.password_hash, raw)

    # ---- 序列化：绝不把 password_hash 带出去 ----
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "role": self.role,
            "username": self.username,
            "email": self.email,
            "name": self.name,
            "phone": self.phone,
            "avatar_url": self.avatar_url,
            "email_verified": self.email_verified_at is not None,
            "created_at": _dt(self.created_at),
        }

    def __repr__(self) -> str:
        return f"<User {self.id} {self.username} ({self.role})>"


class EmailCode(db.Model):
    """邮箱验证码 —— 只存哈希，有有效期，一次性，限错误次数"""

    __tablename__ = "email_codes"

    id = db.Column(_pk(), primary_key=True, autoincrement=True)
    email = db.Column(db.String(120), nullable=False)
    purpose = db.Column(db.Enum("login", "reset_password", name="code_purpose"),
                        nullable=False)
    code_hash = db.Column(db.String(255), nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    used_at = db.Column(db.DateTime, nullable=True)
    attempts = db.Column(db.SmallInteger, nullable=False, default=0)
    created_at = db.Column(db.DateTime, nullable=False, default=_now,
                           server_default=db.func.current_timestamp())

    def set_code(self, code: str) -> None:
        self.code_hash = generate_password_hash(code)

    def check_code(self, code: str) -> bool:
        return check_password_hash(self.code_hash, code)

    def is_usable(self, now: datetime | None = None) -> bool:
        now = now or datetime.now()
        return self.used_at is None and self.expires_at > now and self.attempts < 5

    def __repr__(self) -> str:
        return f"<EmailCode {self.email} {self.purpose}>"


# ---------------------------------------------------------------------------
#  餐厅 / 骑手档案 / 营业时间
# ---------------------------------------------------------------------------
class Restaurant(db.Model):
    __tablename__ = "restaurants"

    id = db.Column(_pk(), primary_key=True, autoincrement=True)
    owner_id = db.Column(_fk(), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    name = db.Column(db.String(80), nullable=False)
    phone = db.Column(db.String(20), nullable=False)
    address_text = db.Column(db.String(255), nullable=False)
    lng = db.Column(db.Numeric(10, 7), nullable=False)
    lat = db.Column(db.Numeric(10, 7), nullable=False)
    description = db.Column(db.String(500), nullable=True)
    cover_url = db.Column(db.String(255), nullable=True)
    cuisine = db.Column(db.String(30), nullable=True)          # ★ 菜系筛选
    min_order_amount = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    delivery_fee = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    delivery_radius_km = db.Column(db.Numeric(5, 2), nullable=False, default=5)
    max_concurrent_orders = db.Column(db.Integer, nullable=False, default=20)  # ★ 备餐产能
    avg_prep_minutes = db.Column(db.Integer, nullable=False, default=20)       # ★ 平均备餐
    is_open = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=_now)
    updated_at = db.Column(db.DateTime, nullable=False, default=_now, onupdate=_now)

    owner = db.relationship("User", foreign_keys=[owner_id], lazy="joined")
    opening_hours = db.relationship(
        "OpeningHour", back_populates="restaurant", lazy="selectin",
        order_by="OpeningHour.weekday", cascade="all, delete-orphan",
    )
    menu_items = db.relationship(
        "MenuItem", back_populates="restaurant", lazy="selectin",
        order_by="MenuItem.sort_order", cascade="all, delete-orphan",
    )

    def to_dict(self, with_menu: bool = False) -> dict:
        data = {
            "id": self.id,
            "name": self.name,
            "phone": self.phone,
            "address_text": self.address_text,
            "lng": _f(self.lng, 7),
            "lat": _f(self.lat, 7),
            "description": self.description,
            "cover_url": self.cover_url,
            "cuisine": self.cuisine,
            "min_order_amount": _f(self.min_order_amount),
            "delivery_fee": _f(self.delivery_fee),
            "delivery_radius_km": _f(self.delivery_radius_km),
            "max_concurrent_orders": self.max_concurrent_orders,
            "avg_prep_minutes": self.avg_prep_minutes,
            "is_open": bool(self.is_open),
        }
        if with_menu:
            data["opening_hours"] = [h.to_dict() for h in self.opening_hours]
            data["menu"] = [m.to_dict() for m in self.menu_items]
        return data

    def __repr__(self) -> str:
        return f"<Restaurant {self.id} {self.name}>"


class RiderProfile(db.Model):
    """★ schema 补充表：骑手的工作状态。

    库存/营业状态在 restaurants 上，骑手的在线状态同样需要一个落脚点。
    放在单独的 1:1 表里而不是塞进 users —— 骑手之外的两种角色没有这些字段。
    """

    __tablename__ = "rider_profiles"

    user_id = db.Column(_fk(), db.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    is_online = db.Column(db.Boolean, nullable=False, default=False)
    vehicle_type = db.Column(db.Enum("bike", "ebike", "motorbike", "car",
                                     name="vehicle_type"),
                             nullable=False, default="ebike")
    service_radius_km = db.Column(db.Numeric(5, 2), nullable=False, default=5)
    created_at = db.Column(db.DateTime, nullable=False, default=_now)
    updated_at = db.Column(db.DateTime, nullable=False, default=_now, onupdate=_now)

    user = db.relationship("User", lazy="joined")

    def to_dict(self) -> dict:
        data = {
            "user_id": self.user_id,
            "is_online": bool(self.is_online),
            "vehicle_type": self.vehicle_type,
            "service_radius_km": _f(self.service_radius_km),
        }
        if self.user is not None:
            data["name"] = self.user.name
            data["phone"] = self.user.phone
            data["email"] = self.user.email
        return data

    def __repr__(self) -> str:
        return f"<RiderProfile {self.user_id} online={self.is_online}>"


class OpeningHour(db.Model):
    __tablename__ = "opening_hours"

    id = db.Column(_pk(), primary_key=True, autoincrement=True)
    restaurant_id = db.Column(_fk(), db.ForeignKey("restaurants.id", ondelete="CASCADE"), nullable=False)
    weekday = db.Column(db.SmallInteger, nullable=False)          # 1=Mon ... 7=Sun
    open_time = db.Column(db.Time, nullable=False)
    close_time = db.Column(db.Time, nullable=False)
    is_closed = db.Column(db.Boolean, nullable=False, default=False)

    restaurant = db.relationship("Restaurant", back_populates="opening_hours")

    def to_dict(self) -> dict:
        return {
            "weekday": self.weekday,
            "open_time": self.open_time.strftime("%H:%M") if self.open_time else None,
            "close_time": self.close_time.strftime("%H:%M") if self.close_time else None,
            "is_closed": bool(self.is_closed),
        }


class MenuItem(db.Model):
    __tablename__ = "menu_items"

    id = db.Column(_pk(), primary_key=True, autoincrement=True)
    restaurant_id = db.Column(_fk(), db.ForeignKey("restaurants.id"), nullable=False)
    name = db.Column(db.String(80), nullable=False)
    description = db.Column(db.String(255), nullable=True)
    price = db.Column(db.Numeric(10, 2), nullable=False)
    calories = db.Column(db.Integer, nullable=True)
    category = db.Column(db.String(30), nullable=True)
    stock = db.Column(db.Integer, nullable=True)          # NULL = 不限量
    is_available = db.Column(db.Boolean, nullable=False, default=True)
    image_url = db.Column(db.String(255), nullable=True)
    sort_order = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime, nullable=False, default=_now)
    updated_at = db.Column(db.DateTime, nullable=False, default=_now, onupdate=_now)

    restaurant = db.relationship("Restaurant", back_populates="menu_items")

    @property
    def sold_out(self) -> bool:
        return (not self.is_available) or self.stock == 0

    def to_dict(self, for_merchant: bool = False) -> dict:
        data = {
            "id": self.id,
            "restaurant_id": self.restaurant_id,
            "name": self.name,
            "description": self.description,
            "price": _f(self.price),
            "calories": self.calories,
            "category": self.category,
            "stock": self.stock,
            "is_available": bool(self.is_available),
            "image_url": self.image_url,
            "sold_out": self.sold_out,
            "sort_order": self.sort_order,
        }
        if for_merchant:
            data["stock_state"] = stock_state(self)
        return data


def stock_state(item: MenuItem) -> str:
    """商家端三档库存标签：in stock / low stock / sold out"""
    if item.sold_out:
        return "sold_out"
    if item.stock is not None and item.stock <= 5:
        return "low_stock"
    return "in_stock"


# ---------------------------------------------------------------------------
#  顾客地址
# ---------------------------------------------------------------------------
class CustomerAddress(db.Model):
    __tablename__ = "customer_addresses"

    id = db.Column(_pk(), primary_key=True, autoincrement=True)
    user_id = db.Column(_fk(), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    label = db.Column(db.String(20), nullable=True)
    contact_name = db.Column(db.String(50), nullable=False)
    contact_phone = db.Column(db.String(20), nullable=False)
    address_text = db.Column(db.String(255), nullable=False)
    lng = db.Column(db.Numeric(10, 7), nullable=False)
    lat = db.Column(db.Numeric(10, 7), nullable=False)
    is_default = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=_now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "contact_name": self.contact_name,
            "contact_phone": self.contact_phone,
            "address_text": self.address_text,
            "lng": _f(self.lng, 7),
            "lat": _f(self.lat, 7),
            "is_default": bool(self.is_default),
        }


# ---------------------------------------------------------------------------
#  订单
# ---------------------------------------------------------------------------
ORDER_STATUSES = ("pending", "accepted", "preparing", "ready",
                  "delivering", "delivered", "cancelled")


class Order(db.Model):
    __tablename__ = "orders"

    id = db.Column(_pk(), primary_key=True, autoincrement=True)
    order_no = db.Column(db.String(32), nullable=False, unique=True)
    customer_id = db.Column(_fk(), db.ForeignKey("users.id"), nullable=False)
    restaurant_id = db.Column(_fk(), db.ForeignKey("restaurants.id"), nullable=False)
    rider_id = db.Column(_fk(), db.ForeignKey("users.id"), nullable=True)

    status = db.Column(
        db.Enum(*ORDER_STATUSES, name="order_status"),
        nullable=False, default="pending",
    )
    payment_status = db.Column(
        db.Enum("unpaid", "paid", "refunded", name="payment_status"),
        nullable=False, default="unpaid",
    )

    # ---- 地址快照 ----
    delivery_address_text = db.Column(db.String(255), nullable=False)
    delivery_lng = db.Column(db.Numeric(10, 7), nullable=False)
    delivery_lat = db.Column(db.Numeric(10, 7), nullable=False)
    delivery_contact_name = db.Column(db.String(50), nullable=False)
    delivery_contact_phone = db.Column(db.String(20), nullable=False)

    # ---- 金额快照 ----
    items_amount = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    delivery_fee = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    discount_amount = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    total_amount = db.Column(db.Numeric(10, 2), nullable=False, default=0)

    # ---- 配送与预估 ----
    distance_km = db.Column(db.Numeric(6, 2), nullable=True)
    estimated_delivery_at = db.Column(db.DateTime, nullable=True)
    remark = db.Column(db.String(255), nullable=True)

    # ---- 取消 / 延迟（★ 延迟标记为 FR-18 所需）----
    cancel_reason = db.Column(db.String(100), nullable=True)
    cancelled_by = db.Column(
        db.Enum("customer", "restaurant", "rider", "system",
                name="cancelled_by"),
        nullable=True,
    )
    delay_flagged_at = db.Column(db.DateTime, nullable=True)
    delay_reason = db.Column(db.String(100), nullable=True)
    address_updated_at = db.Column(db.DateTime, nullable=True)   # ★ FR-19

    # ---- 时间戳：配送进度的数据来源 ----
    created_at = db.Column(db.DateTime, nullable=False, default=_now,
                           server_default=db.func.current_timestamp())
    accepted_at = db.Column(db.DateTime, nullable=True)
    preparing_at = db.Column(db.DateTime, nullable=True)     # ★ schema 补充
    ready_at = db.Column(db.DateTime, nullable=True)
    picked_up_at = db.Column(db.DateTime, nullable=True)
    delivered_at = db.Column(db.DateTime, nullable=True)
    cancelled_at = db.Column(db.DateTime, nullable=True)

    customer = db.relationship("User", foreign_keys=[customer_id], lazy="joined")
    rider = db.relationship("User", foreign_keys=[rider_id], lazy="joined")
    restaurant = db.relationship("Restaurant", lazy="joined")
    items = db.relationship("OrderItem", back_populates="order", lazy="selectin",
                            cascade="all, delete-orphan")
    reviews = db.relationship("Review", back_populates="order", lazy="selectin")

    # ---- 便捷属性 ----
    @property
    def is_active(self) -> bool:
        return self.status in ("pending", "accepted", "preparing", "ready", "delivering")

    @property
    def is_delayed(self) -> bool:
        return self.delay_flagged_at is not None and self.status not in (
            "delivered", "cancelled")

    def to_dict(self, detail: bool = False) -> dict:
        data = {
            "id": self.id,
            "order_no": self.order_no,
            "status": self.status,
            "payment_status": self.payment_status,
            "created_at": _dt(self.created_at),
            "accepted_at": _dt(self.accepted_at),
            "ready_at": _dt(self.ready_at),
            "picked_up_at": _dt(self.picked_up_at),
            "delivered_at": _dt(self.delivered_at),
            "cancelled_at": _dt(self.cancelled_at),
            "estimated_delivery_at": _dt(self.estimated_delivery_at),
            "is_delayed": self.is_delayed,
            "delay_reason": self.delay_reason,
            "address_updated_at": _dt(self.address_updated_at),
            "items_amount": _f(self.items_amount),
            "delivery_fee": _f(self.delivery_fee),
            "discount_amount": _f(self.discount_amount),
            "total_amount": _f(self.total_amount),
            "distance_km": _f(self.distance_km),
            "remark": self.remark,
            "cancel_reason": self.cancel_reason,
            "cancelled_by": self.cancelled_by,
            "delivery": {
                "address_text": self.delivery_address_text,
                "lng": _f(self.delivery_lng, 7),
                "lat": _f(self.delivery_lat, 7),
                "contact_name": self.delivery_contact_name,
                "contact_phone": self.delivery_contact_phone,
            },
            "restaurant": {
                "id": self.restaurant_id,
                "name": self.restaurant.name if self.restaurant else None,
                "address_text": self.restaurant.address_text if self.restaurant else None,
                "lng": _f(self.restaurant.lng, 7) if self.restaurant else None,
                "lat": _f(self.restaurant.lat, 7) if self.restaurant else None,
                "phone": self.restaurant.phone if self.restaurant else None,
            },
            "customer": {
                "id": self.customer_id,
                "name": self.customer.name if self.customer else None,
                "phone": self.customer.phone if self.customer else None,
            },
            "rider": {
                "id": self.rider_id,
                "name": self.rider.name if self.rider else None,
                "phone": self.rider.phone if self.rider else None,
            } if self.rider_id else None,
            "items": [_item_row(i) for i in self.items],
            "item_count": sum(i.quantity for i in self.items),
            "reviewed": len(self.reviews) > 0,
        }
        if detail:
            data["timeline"] = order_timeline(self)
            data["reviews"] = [r.to_dict() for r in self.reviews]
        return data

    def __repr__(self) -> str:
        return f"<Order {self.order_no} {self.status}>"


def _item_row(item: "OrderItem") -> dict:
    """订单明细 + 占位视觉：同一道菜在三端显示同一个 emoji / 同一张实拍图

    图按**菜名快照**查，不按 menu_item_id —— 菜被商家删掉以后，历史订单里的
    那一行还得有图；反过来，改名之后旧订单显示旧名，也不该突然换一张新图。
    """
    from shared.catalog import dish_emoji, dish_image
    row = item.to_dict()
    row["emoji"] = dish_emoji(item.name_snapshot)
    row["image_url"] = dish_image(item.name_snapshot)
    return row


class OrderItem(db.Model):
    __tablename__ = "order_items"

    id = db.Column(_pk(), primary_key=True, autoincrement=True)
    order_id = db.Column(_fk(), db.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    menu_item_id = db.Column(_fk(), db.ForeignKey("menu_items.id", ondelete="SET NULL"), nullable=True)
    name_snapshot = db.Column(db.String(80), nullable=False)
    unit_price = db.Column(db.Numeric(10, 2), nullable=False)
    quantity = db.Column(db.Integer, nullable=False, default=1)
    subtotal = db.Column(db.Numeric(10, 2), nullable=False)

    order = db.relationship("Order", back_populates="items")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "menu_item_id": self.menu_item_id,
            "name": self.name_snapshot,
            "unit_price": _f(self.unit_price),
            "quantity": self.quantity,
            "subtotal": _f(self.subtotal),
        }


class Review(db.Model):
    __tablename__ = "reviews"

    id = db.Column(_pk(), primary_key=True, autoincrement=True)
    order_id = db.Column(_fk(), db.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    reviewer_id = db.Column(_fk(), db.ForeignKey("users.id"), nullable=False)
    target_type = db.Column(db.Enum("restaurant", "rider", name="review_target"),
                            nullable=False)
    target_id = db.Column(_fk(), nullable=False)
    rating = db.Column(db.SmallInteger, nullable=False)
    content = db.Column(db.String(500), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=_now)

    order = db.relationship("Order", back_populates="reviews")
    reviewer = db.relationship("User", foreign_keys=[reviewer_id])

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "order_id": self.order_id,
            "target_type": self.target_type,
            "target_id": self.target_id,
            "rating": self.rating,
            "content": self.content,
            "created_at": _dt(self.created_at),
            "reviewer_name": self.reviewer.name if self.reviewer else "Customer",
        }


class RiderLocation(db.Model):
    __tablename__ = "rider_locations"

    id = db.Column(_pk(), primary_key=True, autoincrement=True)
    rider_id = db.Column(_fk(), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    order_id = db.Column(_fk(), db.ForeignKey("orders.id", ondelete="CASCADE"), nullable=True)
    lng = db.Column(db.Numeric(10, 7), nullable=False)
    lat = db.Column(db.Numeric(10, 7), nullable=False)
    accuracy_m = db.Column(db.SmallInteger, nullable=True)
    recorded_at = db.Column(db.DateTime, nullable=False, default=_now)

    def to_dict(self) -> dict:
        return {
            "lng": _f(self.lng, 7),
            "lat": _f(self.lat, 7),
            "accuracy_m": self.accuracy_m,
            "recorded_at": _dt(self.recorded_at),
        }


# ---------------------------------------------------------------------------
#  优惠券（加分项，本期只保留数据模型，不开放界面）
# ---------------------------------------------------------------------------
class Coupon(db.Model):
    __tablename__ = "coupons"

    id = db.Column(_pk(), primary_key=True, autoincrement=True)
    code = db.Column(db.String(32), nullable=False, unique=True)
    title = db.Column(db.String(50), nullable=False)
    owner_type = db.Column(db.Enum("platform", "restaurant", name="coupon_owner"),
                           nullable=False, default="platform")
    owner_id = db.Column(_fk(), nullable=True)
    discount_type = db.Column(db.Enum("fixed", "percent", name="coupon_type"),
                              nullable=False)
    discount_value = db.Column(db.Numeric(10, 2), nullable=False)
    min_order_amount = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    total_quantity = db.Column(db.Integer, nullable=True)
    claimed_count = db.Column(db.Integer, nullable=False, default=0)
    start_at = db.Column(db.DateTime, nullable=True)
    end_at = db.Column(db.DateTime, nullable=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, nullable=False, default=_now)


class UserCoupon(db.Model):
    __tablename__ = "user_coupons"

    id = db.Column(_pk(), primary_key=True, autoincrement=True)
    user_id = db.Column(_fk(), db.ForeignKey("users.id"), nullable=False)
    coupon_id = db.Column(_fk(), db.ForeignKey("coupons.id"), nullable=False)
    status = db.Column(db.Enum("unused", "used", "expired", name="usercoupon_status"),
                       nullable=False, default="unused")
    order_id = db.Column(_fk(), db.ForeignKey("orders.id"), nullable=True)
    claimed_at = db.Column(db.DateTime, nullable=False, default=_now)
    used_at = db.Column(db.DateTime, nullable=True)


# ---------------------------------------------------------------------------
#  订单时间轴（顾客端 / 商家端 / 骑手端共用同一套节点）
#  放在 models 里而不是某个端的 routes 里 —— 三端必须一字不差
# ---------------------------------------------------------------------------
TIMELINE_STEPS = (
    ("pending", "Placed", "created_at"),
    ("accepted", "Accepted", "accepted_at"),
    ("preparing", "Preparing", "preparing_at"),
    ("ready", "Ready", "ready_at"),
    ("delivering", "On the way", "picked_up_at"),
    ("delivered", "Delivered", "delivered_at"),
)


def order_timeline(order: "Order") -> list[dict]:
    """把 status + 时间戳翻译成时间轴节点。

    顾客端不单独显示 ready（并入 On the way 之前），
    但节点仍然返回，由前端决定显示哪几个 —— 三端共享同一份数据。
    """
    reached = False
    steps = []
    for status, label, field in TIMELINE_STEPS:
        at = getattr(order, field, None)
        index = ORDER_STATUSES.index(status)
        current_index = ORDER_STATUSES.index(order.status) \
            if order.status in ORDER_STATUSES else 0
        state = "done" if at else ("current" if index == current_index else "todo")
        if state == "done":
            reached = True
        steps.append({
            "status": status,
            "label": label,
            "at": _dt(at),
            "state": state,
        })
    if order.status == "cancelled":
        return [{"status": "cancelled", "label": "Cancelled",
                 "at": _dt(order.cancelled_at), "state": "cancelled"}]
    return steps
