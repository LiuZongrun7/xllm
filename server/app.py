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
    static/     三端唯一共享的前端资源（只有 reset.css）

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
    http://127.0.0.1:8080/customer/design-system
    http://127.0.0.1:8080/merchant/design-system
    http://127.0.0.1:8080/rider/design-system
================================================================================
"""

import logging
import os

from flask import Flask, redirect, render_template, request, url_for

from config import Config
from shared.extensions import db
from shared.auth import bp as auth_bp
from shared.health import bp as health_bp

from customer.routes import api as customer_api, pages as customer_pages
from merchant.routes import api as merchant_api, pages as merchant_pages
from rider.routes import api as rider_api, pages as rider_pages

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

    # --- 公共蓝图（D）---
    app.register_blueprint(health_bp)
    app.register_blueprint(auth_bp)

    # --- 三端各自的一对蓝图：页面 + 接口 ---
    app.register_blueprint(customer_pages)
    app.register_blueprint(customer_api)

    app.register_blueprint(merchant_pages)
    app.register_blueprint(merchant_api)

    app.register_blueprint(rider_pages)
    app.register_blueprint(rider_api)

    # --- 根路径：顾客端是"主入口"，另外两端从各自登录页侧链过去 ---
    @app.get("/")
    def root():
        return redirect(url_for("customer.home"))

    # --- 错误页：哪一端的 URL 出错，就用哪一端的皮肤 ---
    def _role_from_path() -> str | None:
        for role in ("customer", "merchant", "rider"):
            if request.path.startswith(f"/{role}"):
                return role
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
