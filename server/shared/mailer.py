"""
邮件发送模块

⚠️ 核心设计原则：**发信失败绝不能让业务逻辑失败。**
   注册成功但欢迎邮件没发出去 —— 注册依然算成功；
   找回密码的验证码没发出去 —— 接口返回"已发送"，但把失败记进日志。

   所有异常都在本模块内部吞掉，只返回 True/False。
   调用方不需要 try/except。

配置来自环境变量（见 config.py 与服务器 ~/xllm/.env）：
    MAIL_HOST / MAIL_PORT / MAIL_USER / MAIL_PASSWORD / MAIL_SENDER
"""

import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

from flask import current_app

# Tencent Exmail 实测：465(SSL) 和 587(STARTTLS) 都可用，默认用 465
DEFAULT_PORT = 465
TIMEOUT = 20


def _settings() -> dict:
    c = current_app.config
    return {
        "host": c.get("MAIL_HOST"),
        "port": int(c.get("MAIL_PORT") or DEFAULT_PORT),
        "user": c.get("MAIL_USER"),
        "password": c.get("MAIL_PASSWORD"),
        "sender": c.get("MAIL_SENDER") or c.get("MAIL_USER"),
        "sender_name": c.get("MAIL_SENDER_NAME", "xLLM Food Delivery"),
        "reply_to": c.get("MAIL_REPLY_TO", ""),
    }


def is_configured() -> bool:
    s = _settings()
    return bool(s["host"] and s["user"] and s["password"])


def _deliver(msg: EmailMessage) -> bool:
    """真正投递。任何异常都在这里被吃掉。"""
    if not is_configured():
        current_app.logger.warning("[mail] 未配置 MAIL_*，跳过发送：%s", msg["Subject"])
        return False

    s = _settings()

    # From 与认证账号不一致时，腾讯企业邮会拒绝或改写 —— 提前在日志里说清楚，
    # 否则线上只会看到一个含糊的 553，很难定位。
    if s["sender"] and s["user"] and s["sender"].lower() != s["user"].lower():
        current_app.logger.warning(
            "[mail] MAIL_SENDER(%s) != MAIL_USER(%s)：企业邮会用认证账号校验 From，"
            "两者不一致会被拒绝或改写。要换发件地址，请连 MAIL_USER 一起换。",
            s["sender"], s["user"],
        )

    try:
        ctx = ssl.create_default_context()
        if s["port"] == 465:
            server = smtplib.SMTP_SSL(s["host"], s["port"], timeout=TIMEOUT, context=ctx)
        else:
            server = smtplib.SMTP(s["host"], s["port"], timeout=TIMEOUT)
            server.ehlo()
            server.starttls(context=ctx)
            server.ehlo()

        with server:
            server.login(s["user"], s["password"])
            server.send_message(msg)

        current_app.logger.info("[mail] 已发送 → %s | %s", msg["To"], msg["Subject"])
        return True

    except Exception as exc:                     # noqa: BLE001 —— 就是要全接住
        current_app.logger.error(
            "[mail] 发送失败 → %s | %s | %s: %s",
            msg["To"], msg["Subject"], type(exc).__name__, exc,
        )
        return False


def _build(to: str, subject: str, body: str) -> EmailMessage:
    s = _settings()
    name = (s["sender_name"] or "").strip()
    msg = EmailMessage()
    # 显示名允许为空：留空时 From 就是纯地址（收件人看到 "contact@xllm.cloud"）
    msg["From"] = f"{name} <{s['sender']}>" if name else str(s["sender"])
    # no-reply@ 不收信，加 Reply-To 让用户点"回复"落到人工邮箱。
    # 这只是头字段，不需要 Reply-To 那个邮箱的授权码。
    reply_to = (s.get("reply_to") or "").strip()
    if reply_to:
        msg["Reply-To"] = reply_to
    msg["To"] = to
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=(s["sender"] or "").split("@")[-1] or None)
    msg.set_content(body)
    return msg


# ---------------------------------------------------------------------------
# 业务邮件
# ---------------------------------------------------------------------------
_CODE_LABEL = {
    "login": "sign-in code",
    "reset_password": "password reset code",
}


def send_verification_code(to: str, code: str, purpose: str) -> bool:
    """发送验证码邮件。返回是否成功，但调用方不必依赖返回值。"""
    label = _CODE_LABEL.get(purpose, "verification code")
    body = f"""Here is your {label} for xLLM:

        {code}

The code expires in 5 minutes and can be used only once.
Requesting a new code invalidates the previous one.

If you did not request this, you can safely ignore this email — your account is unchanged.

— xLLM Food Delivery (course project; automated message, please do not reply)
"""
    return _deliver(_build(to, f"xLLM · {label.capitalize()}: {code}", body))


def send_test(to: str) -> bool:
    """部署自检用：确认 SMTP 链路通"""
    body = (
        "This is a test message from xLLM. "
        "If you received it, the mail channel is working.\n"
    )
    return _deliver(_build(to, "xLLM · Mail channel test", body))
