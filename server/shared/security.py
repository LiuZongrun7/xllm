"""
会话与权限

认证方式：Flask 的 session（服务端签名 cookie），与 week-5 讲的 session 一致。
    session["uid"]  = 用户 id
    session["role"] = 角色，用于免查库的快速判断

⚠️ 权限判断的落脚点永远是【后端查询带归属条件】，
   本模块提供的 require_role 只解决"这个角色能不能调这个接口"，
   数据级归属（只能看自己的订单）必须在各自的查询里再写一次。
"""

from functools import wraps

from flask import current_app, g, jsonify, redirect, request, session, url_for

from shared.models import User


def current_user() -> User | None:
    """当前登录用户；每个请求只查一次库（缓存在 g 上）"""
    if "user" in g:
        return g.user
    uid = session.get("uid")
    user = User.query.get(uid) if uid else None
    if user is not None and not user.is_active:
        session.clear()
        user = None
    g.user = user
    return user


def log_denied(reason: str, **fields) -> None:
    """记录一次被拒绝的跨归属访问（NFR-5）。

    对外的响应仍然保持模糊（404 而不是"这是别人的订单"），但日志里要能查得到：
    谁、什么角色、访问了哪条路径、想动哪条数据。
    """
    user = current_user()
    current_app.logger.warning(
        "[denied] uid=%s role=%s path=%s reason=%s %s",
        getattr(user, "id", None), getattr(user, "role", None),
        request.path, reason,
        " ".join(f"{key}={value}" for key, value in fields.items()),
    )


def login_user(user: User) -> None:
    session.clear()                 # 换用户时清掉旧会话，防会话固定
    session["uid"] = user.id
    session["role"] = user.role
    session.permanent = True


def logout_user() -> None:
    session.clear()


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if current_user() is None:
            return jsonify({"ok": False, "error": "Please sign in first"}), 401
        return view(*args, **kwargs)
    return wrapper


def require_role(*roles: str):
    """限定可访问的角色，例如 @require_role("restaurant")"""
    def deco(view):
        @wraps(view)
        @login_required
        def wrapper(*args, **kwargs):
            user = current_user()
            if user.role not in roles:
                log_denied("role_mismatch", required="/".join(roles))
                return jsonify({
                    "ok": False,
                    "error": f"This action is only available to: {'/'.join(roles)}",
                }), 403
            return view(*args, **kwargs)
        return wrapper
    return deco


def role_page(role: str, login_endpoint: str):
    """页面版权限：没登录或角色不对，都重定向到本端的登录页。

    接口越权返回 401/403（给 fetch 用），页面越权必须跳转（给浏览器用）——
    两者不能混用，否则用户会看到一坨 JSON。
    """
    def deco(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            user = current_user()
            if user is None or user.role != role:
                return redirect(url_for(login_endpoint))
            return view(*args, **kwargs)
        return wrapper
    return deco
