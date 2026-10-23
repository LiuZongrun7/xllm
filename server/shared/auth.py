"""
认证蓝图 —— 注册 / 密码登录 / 验证码登录 / 找回密码

接口一览
    POST /api/auth/register          注册（username + email + password）
    POST /api/auth/login             账号密码登录（account 可以是用户名，也可以是邮箱）
    POST /api/auth/code/send         发送验证码（purpose = login | reset_password）
    POST /api/auth/code/login        验证码登录（备选登录方式）
    POST /api/auth/password/reset    重置密码
    GET  /api/auth/me                当前用户
    POST /api/auth/logout            退出登录
    POST /api/auth/mail/test         发一封测试邮件（部署自检用）

设计要点
    1. 密码登录是主路径，**不依赖任何外部服务**；验证码登录只是备选
    2. 发信失败不影响接口成功返回（mailer 内部吞异常）
    3. 验证码：5 分钟过期 / 一次性 / 限错误 5 次 / 60 秒限频 / 每小时 5 条
    4. 不泄露"某邮箱是否已注册"—— 无论存在与否返回一致
    5. 开发模式（DEBUG=1）会把验证码回显在响应里，演示时邮件延迟也不怕
"""

import secrets
from datetime import datetime, timedelta

from flask import Blueprint, current_app
from sqlalchemy import or_

from shared import mailer
from shared.extensions import db
from shared.models import EmailCode, User
from shared.security import current_user, login_required, login_user, logout_user
from shared.utils import EMAIL_RE, USERNAME_RE, body, clean, err, ok

bp = Blueprint("auth", __name__, url_prefix="/api/auth")

CODE_TTL = timedelta(minutes=5)         # 验证码有效期
RESEND_INTERVAL = timedelta(seconds=60)  # 同一邮箱两次发送的最小间隔
HOURLY_LIMIT = 5                         # 同一邮箱每小时最多几条
MAX_ATTEMPTS = 5                         # 错几次就作废
PASSWORD_MIN = 8
ROLES = {"customer", "restaurant", "rider"}
PURPOSES = {"login", "reset_password"}


# ===========================================================================
#  内部工具
# ===========================================================================
def _find_codes(email: str, purpose: str):
    return EmailCode.query.filter(
        EmailCode.email == email, EmailCode.purpose == purpose
    )


def _consume_code(email: str, purpose: str, code: str):
    """校验并核销验证码。成功返回 (记录, None)，失败返回 (None, 错误说明)。"""
    now = datetime.now()
    rec = (
        _find_codes(email, purpose)
        .filter(EmailCode.used_at.is_(None), EmailCode.expires_at > now)
        .order_by(EmailCode.created_at.desc())
        .first()
    )
    if rec is None:
        return None, "Verification code not found or expired, please request a new one"
    if rec.attempts >= MAX_ATTEMPTS:
        return None, "Too many failed attempts, please request a new code"
    if not rec.check_code(code):
        rec.attempts += 1
        db.session.commit()
        left = max(MAX_ATTEMPTS - rec.attempts, 0)
        return None, f"Incorrect code, {left} attempt(s) left"

    rec.used_at = now          # 一次性
    db.session.commit()
    return rec, None


# ===========================================================================
#  注册
# ===========================================================================
@bp.post("/register")
def register():
    d = body()
    username = clean(d.get("username"), 40)
    email = clean(d.get("email"), 120).lower()
    password = str(d.get("password") or "")
    role = clean(d.get("role")) or "customer"
    phone = clean(d.get("phone"), 20) or None

    if not USERNAME_RE.match(username):
        return err("Username must be 3–40 characters: letters, digits, underscore or Chinese characters")
    if not EMAIL_RE.match(email):
        return err("Invalid email address")
    if len(password) < PASSWORD_MIN:
        return err(f"Password must be at least {PASSWORD_MIN} characters")
    if role not in ROLES:
        return err("Role must be one of: customer, restaurant, rider")

    if User.query.filter_by(username=username).first():
        return err("That username is already taken")
    if User.query.filter_by(email=email).first():
        return err("That email is already registered")

    user = User(role=role, username=username, email=email,
                name=username, phone=phone)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()

    # 新人限时券：只有顾客有，注册即发（48 小时内有效）
    if user.role == "customer":
        from shared.coupons import grant_new_user
        grant_new_user(user)

    # 注册即登录，省掉一次手动登录（演示友好）
    login_user(user)
    return ok(user.to_dict(), status=201)


# ===========================================================================
#  账号密码登录（主路径）
# ===========================================================================
@bp.post("/login")
def login():
    d = body()
    account = clean(d.get("account"), 120)
    password = str(d.get("password") or "")

    if not account or not password:
        return err("Please enter your account and password")

    user = User.query.filter(
        or_(User.username == account, User.email == account.lower())
    ).first()

    # ⚠️ 不区分"用户不存在"和"密码错误"，否则可被用来枚举账号
    if user is None or not user.check_password(password):
        return err("Incorrect account or password", 401)
    if not user.is_active:
        return err("This account has been disabled", 403)

    login_user(user)
    return ok(user.to_dict())


# ===========================================================================
#  发送验证码
# ===========================================================================
@bp.post("/code/send")
def code_send():
    d = body()
    email = clean(d.get("email"), 120).lower()
    purpose = clean(d.get("purpose")) or "login"

    if not EMAIL_RE.match(email):
        return err("Invalid email address")
    if purpose not in PURPOSES:
        return err("purpose must be 'login' or 'reset_password'")

    now = datetime.now()

    # ---- 限频：60 秒内不允许重复发送 ----
    last = _find_codes(email, purpose).order_by(EmailCode.created_at.desc()).first()
    if last and last.created_at and now - last.created_at < RESEND_INTERVAL:
        wait = int((RESEND_INTERVAL - (now - last.created_at)).total_seconds())
        return err(f"Too many requests, please wait {wait}s", 429)

    # ---- 限频：每小时上限 ----
    hour_ago = now - timedelta(hours=1)
    recent = _find_codes(email, purpose).filter(EmailCode.created_at > hour_ago).count()
    if recent >= HOURLY_LIMIT:
        return err("Hourly limit for codes sent to this email has been reached, please try again later", 429)

    code = f"{secrets.randbelow(10 ** 6):06d}"

    # ---- 旧码立即作废 ----
    _find_codes(email, purpose).filter(
        EmailCode.used_at.is_(None), EmailCode.expires_at > now
    ).update({"used_at": now, "expires_at": now}, synchronize_session=False)

    rec = EmailCode(email=email, purpose=purpose, expires_at=now + CODE_TTL)
    rec.set_code(code)
    db.session.add(rec)
    db.session.commit()

    # ---- 只有已注册的邮箱才真的发信；但对外响应完全一致 ----
    user = User.query.filter_by(email=email).first()
    sent = mailer.send_verification_code(email, code, purpose) if user else False

    payload = {
        "expires_in": int(CODE_TTL.total_seconds()),
        "note": "If this email is registered, the code will arrive within a minute",
    }
    # 开发模式回显验证码：邮件延迟也不影响调试和演示
    if current_app.debug:
        payload["debug_code"] = code
        payload["sent"] = sent
    return ok(payload)


# ===========================================================================
#  验证码登录（备选路径）
# ===========================================================================
@bp.post("/code/login")
def code_login():
    d = body()
    email = clean(d.get("email"), 120).lower()
    code = clean(d.get("code"), 10)

    if not EMAIL_RE.match(email) or not code:
        return err("Please enter your email and the code")

    rec, message = _consume_code(email, "login", code)
    if rec is None:
        return err(message, 400)

    user = User.query.filter_by(email=email).first()
    if user is None:
        return err("This email is not registered", 400)
    if not user.is_active:
        return err("This account has been disabled", 403)

    # 能收到验证码 = 邮箱已验证
    if user.email_verified_at is None:
        user.email_verified_at = datetime.now()
        db.session.commit()

    login_user(user)
    return ok(user.to_dict())


# ===========================================================================
#  找回密码
# ===========================================================================
@bp.post("/password/reset")
def password_reset():
    d = body()
    email = clean(d.get("email"), 120).lower()
    code = clean(d.get("code"), 10)
    new_password = str(d.get("new_password") or "")

    if len(new_password) < PASSWORD_MIN:
        return err(f"New password must be at least {PASSWORD_MIN} characters")

    user = User.query.filter_by(email=email).first()
    # 邮箱不存在也返回同样的错误，避免枚举
    if user is None:
        return err("Incorrect email or code", 400)

    rec, message = _consume_code(email, "reset_password", code)
    if rec is None:
        return err(message, 400)

    user.set_password(new_password)
    if user.email_verified_at is None:
        user.email_verified_at = datetime.now()
    db.session.commit()

    logout_user()          # 改密后清掉当前会话
    return ok({"message": "Password reset. Please sign in with your new password"})


# ===========================================================================
#  会话
# ===========================================================================
@bp.get("/me")
@login_required
def me():
    return ok(current_user().to_dict())


@bp.post("/logout")
def logout():
    logout_user()
    return ok({"message": "Signed out"})


# ===========================================================================
#  部署自检：发一封测试邮件给自己的注册邮箱
# ===========================================================================
@bp.post("/mail/test")
@login_required
def mail_test():
    user = current_user()
    sent = mailer.send_test(user.email)
    return ok({
        "to": user.email,
        "sent": sent,
        "hint": "sent=false means delivery failed; check the [mail] log in journalctl -u xLLM",
    })
