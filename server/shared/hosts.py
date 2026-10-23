"""
子域名 → 角色 的映射

每个端有自己的域名，答辩时三个界面在三个不同的 origin 上，看起来就是三个站：

    https://customer.xllm.cloud/        顾客端  → /customer/
    https://restaurant.xllm.cloud/      商家端  → /merchant/
    https://delivery.xllm.cloud/        骑手端  → /rider/
    https://xllm.cloud/                 官网 + 管理大屏（原来的入口，保留）

为什么这件事放在 Flask 而不是全丢给 nginx
    nginx 那层只做三件它擅长的事：绑证书、收 TLS、转给 gunicorn。
    "哪个域名落到哪个端""在顾客域名下点了商家入口该跳去哪""官网链接该指到哪个域名"
    这些判断需要知道路由表，放在一个 before_request 里最省事，也最容易在本地关掉。

可选、可退化
    域名全部来自配置（CUSTOMER_HOST / MERCHANT_HOST / RIDER_HOST / SITE_HOST）。
    本地开发不设它们 → 三个 *_HOST 都是空串 → 本模块所有函数都退化成相对路径，
    行为和加子域名之前一模一样，127.0.0.1:8080 上照样点得通。

    这一点很像高德 Key 的处理：配了就更像真的，没配也不能把主流程弄挂。
"""

from flask import current_app, redirect, request

# 三个业务角色，顺序无关，只用来遍历配置
ROLES = ("customer", "merchant", "rider")

# 属于"官网"的路径前缀：出现在角色域名下时，送回主域名
SITE_PREFIXES = ("info", "admin")


# ---------------------------------------------------------------------------
# 配置读取
# ---------------------------------------------------------------------------

def _norm(host: str | None) -> str:
    """去掉协议、端口、结尾的斜杠，统一小写 —— 让人在 .env 里怎么写都不出错"""
    host = (host or "").strip().lower()
    for prefix in ("https://", "http://"):
        if host.startswith(prefix):
            host = host[len(prefix):]
    return host.split("/")[0].split(":")[0]


def site_host() -> str:
    return _norm(current_app.config.get("SITE_HOST"))


def role_host(role: str) -> str:
    return _norm(current_app.config.get(f"{role.upper()}_HOST"))


def host_role(hostname: str | None = None) -> str | None:
    """这个请求落在哪个角色域名上；主域名/本地/直接用 IP 访问都返回 None"""
    hostname = _norm(hostname or request.host)
    for role in ROLES:
        if role_host(role) and role_host(role) == hostname:
            return role
    return None


# ---------------------------------------------------------------------------
# 生成地址：给模板用的 portal_url()
# ---------------------------------------------------------------------------

def portal_url(role: str, sub: str = "") -> str:
    """某个端的入口地址。

        portal_url("merchant")        → https://restaurant.xllm.cloud/merchant/
        portal_url("rider", "login")  → https://delivery.xllm.cloud/rider/login

    没配域名时返回 /merchant/ 、/rider/login 这样的相对路径，
    所以同一个模板在本地和线上都能用。
    """
    host = role_host(role)
    path = f"/{role}/" + sub.strip("/") if sub else f"/{role}/"
    return f"https://{host}{path}" if host else path


def site_url(sub: str = "") -> str:
    host = site_host()
    path = "/" + sub.strip("/")
    return f"https://{host}{path}" if host else path


def portal_host(role: str) -> str:
    """只要域名本身（不带协议和路径），没配置时返回空串 —— 给文案里展示用"""
    return role_host(role)


# ---------------------------------------------------------------------------
# 请求分流
# ---------------------------------------------------------------------------

def _keep_query(url: str) -> str:
    query = request.query_string.decode()
    return f"{url}?{query}" if query else url


def route_by_host():
    """before_request：把每个域名收在自己的端里。

    规则只有四条，按顺序判断：

      1. /api/... 一律不管。接口归 session 和 require_role 管，
         域名不是权限边界；在这里拦会出现 "fetch 302 到别的主机" 的怪事。
      2. 角色域名下的根路径 → 该端首页（/customer/ 之类）。
         首页自己会判断登录态，没登录再跳登录页，不用这里操心。
      3. 角色域名下访问了另一个端的页面 → 302 到那个端的域名。
         于是 "Merchant portal →" 这种链接在顾客域名下点也是对的。
      4. 角色域名下访问 /info 或 /admin → 送回主域名，官网和管理大屏只在一个地方。
    """
    role = host_role()
    if role is None:
        return None                              # 主域名 / 本地 / IP：不干预

    path = request.path

    # 1. 接口不分域名
    if path == "/api" or path.startswith("/api/"):
        return None

    # 2. 根路径落到本端首页
    if path == "/":
        return redirect(f"/{role}/", code=302)

    first = path.lstrip("/").split("/")[0]

    # 3. 别的端的页面 → 去它自己的域名
    if first in ROLES and first != role:
        other = role_host(first)
        if other:
            return redirect(_keep_query(f"https://{other}{path}"), code=302)
        return None                              # 没配那个域名就留在原地（本地开发）

    # 4. 官网 / 管理大屏 → 主域名
    if first in SITE_PREFIXES:
        home = site_host()
        if home and home != _norm(request.host):
            return redirect(_keep_query(f"https://{home}{path}"), code=302)

    return None


def install(app) -> None:
    """在 create_app() 里调用一次"""
    app.before_request(route_by_host)
    # 模板里直接写 {{ portal_url('merchant', 'login') }}，不用到处拼字符串
    app.jinja_env.globals["portal_url"] = portal_url
    app.jinja_env.globals["portal_host"] = portal_host
    app.jinja_env.globals["site_url"] = site_url
