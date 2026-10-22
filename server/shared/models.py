"""
SQLAlchemy 模型

目前只包含认证所需的两张表：users / email_codes。
其余业务表（restaurants / orders / ...）随对应功能一起加，
字段定义以 database/schema.sql 为准。
"""

from datetime import datetime

from werkzeug.security import check_password_hash, generate_password_hash

from shared.extensions import db


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
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
    created_at = db.Column(db.DateTime, nullable=False,
                           server_default=db.func.current_timestamp())
    updated_at = db.Column(db.DateTime, nullable=False,
                           server_default=db.func.current_timestamp(),
                           onupdate=db.func.current_timestamp())

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
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self) -> str:
        return f"<User {self.id} {self.username} ({self.role})>"


class EmailCode(db.Model):
    """邮箱验证码 —— 只存哈希，有有效期，一次性，限错误次数"""

    __tablename__ = "email_codes"

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    email = db.Column(db.String(120), nullable=False)
    purpose = db.Column(db.Enum("login", "reset_password", name="code_purpose"),
                        nullable=False)
    code_hash = db.Column(db.String(255), nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    used_at = db.Column(db.DateTime, nullable=True)
    attempts = db.Column(db.SmallInteger, nullable=False, default=0)
    created_at = db.Column(db.DateTime, nullable=False,
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
