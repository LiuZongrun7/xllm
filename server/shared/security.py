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

from flask import g, jsonify, session

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
            return jsonify({"ok": False, "error": "请先登录"}), 401
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
                return jsonify({
                    "ok": False,
                    "error": f"该操作仅限 {'/'.join(roles)} 角色",
                }), 403
            return view(*args, **kwargs)
        return wrapper
    return deco
