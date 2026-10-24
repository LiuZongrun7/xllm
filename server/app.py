"""
xLLM · COMP3019J Web Application Development
Final Project — Food Delivery Website
================================================================================
Flask 后端入口（应用工厂模式）

    create_app()   创建并配置应用，便于将来写测试
    app            模块级实例，gunicorn 用 `app:app` 拉起

目录约定（答辩时按这个找代码）
    shared/     D —— 数据模型、权限、状态机、公共接口（auth / health）
    customer/   A —— 顾客端页面 + 顾客侧接口
    merchant/   B —— 商家端页面 + 商家侧接口
    rider/      C —— 骑手端页面 + 骑手侧接口
    admin/      E —— 管理大屏（只读，平台运营视角）
    info/       ——  公开官网（/info），不读数据库、不需要登录
    static/     全站唯一共享的前端资源（只有 reset.css）

⚠️ 关于 /api 前缀
    nginx 配置已改为【保留】前缀（proxy_pass 结尾不带斜杠）：
        浏览器  https://xllm.cloud/api/ping
        Flask   收到 /api/ping
    所有接口统一由 Blueprint 的 url_prefix 提供，
    url_for("health.ping") 也能正确生成 /api/ping。

⚠️ 三端各自的接口前缀是 /api/<角色>/...，不做成 /api/orders 这种按实体划分。
    原因：按角色划分时，每条路由的权限归属一眼可见，也正好对应"每人一条竖切"的分工。

本地运行
    cd server && python app.py
    http://127.0.0.1:8080/info/            ← 官网（根路径 / 会跳到这里）
    http://127.0.0.1:8080/customer/design-system
    http://127.0.0.1:8080/merchant/design-system
    http://127.0.0.1:8080/rider/design-system
================================================================================
"""

import logging
import os

from flask import Flask, redirect, render_template, request, url_for

from config import Config
from shared import hosts
from shared.extensions import db
from shared.auth import bp as auth_bp
from shared.health import bp as health_bp

from customer.routes import api as customer_api, pages as customer_pages
from merchant.routes import api as merchant_api, pages as merchant_pages
from rider.routes import api as rider_api, pages as rider_pages
from info.routes import pages as info_pages
from admin.routes import api as admin_api, pages as admin_pages

from shared import models  # noqa: F401  —— 必须 import，SQLAlchemy 才知道有哪些表


def create_app(config_object: type = Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_object)

    # 中文原样输出，不要转义成 \u4f60\u597d
    app.json.ensure_ascii = False

    # Flask 默认只在 debug 下输出 INFO，导致"发信成功"这种日志看不到。
    # 排查邮件问题时需要它，所以显式打开到 INFO。
    app.logger.setLevel(logging.INFO)

    # --- 扩展 ---
    db.init_app(app)

    # --- 静态资源的缓存策略 ---
    # 图片文件名是固定的（重出图会同名覆盖），所以靠 catalog.small_image() 带的
    # ?v=mtime 做失效；这里给一个长 max-age，让浏览器直接不再请求。
    # CSS/JS 没有版本号，给 5 分钟：改完最多 5 分钟内生效。
    @app.after_request
    def _static_cache(response):
        if "/static/" in request.path and response.status_code == 200:
            # ⚠️ Flask 默认给静态文件加 no-cache；不清掉它，max_age 写了也白写
            #    —— 响应头会变成 "no-cache, public, max-age=604800"，浏览器照样每次回来问。
            response.cache_control.no_cache = None
            response.cache_control.no_store = None
            response.cache_control.must_revalidate = None
            if response.mimetype.startswith("image/"):
                response.cache_control.public = True
                response.cache_control.max_age = 7 * 24 * 3600
            elif response.mimetype in ("text/css", "application/javascript",
                                       "text/javascript", "application/json"):
                response.cache_control.public = True
                response.cache_control.max_age = 300
                response.headers["Vary"] = "Accept-Encoding"
        return response

    # --- 域名分流 ---
    # 三个端各有一个子域名（customer / restaurant / delivery.xllm.cloud）。
    # 这里只注册一个 before_request：根路径落到本端首页、跨端链接跳到对方的域名。
    # 域名没配置时（本地开发）整个模块不生效，行为和以前完全一样。
    hosts.install(app)

    # --- 公共蓝图（D）---
    app.register_blueprint(health_bp)
    app.register_blueprint(auth_bp)

    # --- 公开官网（不依赖数据库与会话）---
    app.register_blueprint(info_pages)

    # --- 三端各自的一对蓝图：页面 + 接口 ---
    app.register_blueprint(customer_pages)
    app.register_blueprint(customer_api)

    app.register_blueprint(merchant_pages)
    app.register_blueprint(merchant_api)

    app.register_blueprint(rider_pages)
    app.register_blueprint(rider_api)

    # --- 管理大屏：只读的运营视角，与三端的登录互不影响 ---
    app.register_blueprint(admin_pages)
    app.register_blueprint(admin_api)

    # --- 根路径：官网是"门面"，三端从官网的演示入口进 ---
    # 用 302 而不是 301：这是课程演示站，入口随时可能调整，
    # 而且 301 会被浏览器长期缓存，改回来很麻烦。
    #
    # 这条只管主域名。三个子域名上的 "/" 由 shared/hosts.py 提前拦掉，
    # 直接落到各自端的首页（restaurant.xllm.cloud/ → /merchant/）。
    @app.get("/")
    def root():
        return redirect(url_for("info.index"))

    # --- 错误页：哪一端的 URL 出错，就用哪一端的皮肤 ---
    def _role_from_path() -> str | None:
        for role in ("customer", "merchant", "rider", "admin"):
            if request.path.startswith(f"/{role}"):
                return role
        return None

    # 三端之外的地址（/、/info/...、/api/...）统一用官网的深色皮肤
    def _site_error(code: int, title: str, message: str):
        try:
            return render_template("info/error.html", code=code,
                                   title=title, message=message), code
        except Exception:
            return None

    @app.errorhandler(404)
    def not_found(error):
        role = _role_from_path()
        if role:
            try:
                return render_template(f"{role}/error.html", code=404,
                                       message="We could not find that page.",
                                       role=role), 404
            except Exception:
                pass

        branded = _site_error(404, "Nothing here.", "The page you asked for does not exist. "
                              "It may have moved, or the link may be out of date.")
        if branded:
            return branded

        return ("<h1 style=\"font:600 20px system-ui;padding:48px\">404 — page not found</h1>"
                "<p style=\"font:14px system-ui;padding:0 48px\">"
                "The page you asked for does not exist.</p>"), 404

    @app.errorhandler(500)
    def server_error(error):
        role = _role_from_path()
        if role:
            try:
                return render_template(f"{role}/error.html", code=500,
                                       message="Something broke on our side.",
                                       role=role), 500
            except Exception:
                pass

        branded = _site_error(500, "Something broke.", "We logged it on our side. "
                              "Please try again in a moment.")
        if branded:
            return branded

        return ("<h1 style=\"font:600 20px system-ui;padding:48px\">500 — server error</h1>"
                "<p style=\"font:14px system-ui;padding:0 48px\">"
                "We have logged it. Please try again.</p>"), 500

    return app


# gunicorn 用 `app:app`
app = create_app()


if __name__ == "__main__":
    # 仅本地开发用；生产由 gunicorn 拉起（见 deploy/xllm.service）
    # PORT / FLASK_DEBUG 走环境变量，方便同时开多个端做对照测试
    app.run(host="0.0.0.0",
            port=int(os.environ.get("PORT", "8080")),
            debug=os.environ.get("FLASK_DEBUG", "0") == "1")
