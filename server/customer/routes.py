"""
顾客端 —— 页面与接口（负责人：A）
================================================================================
这是顾客端的**全部代码入口**。答辩时只需要打开这一行下面这几个文件：

    customer/routes.py                 ← 本文件：页面路由 + 顾客侧接口
    customer/templates/                ← 顾客端页面（Jinja2）
    customer/static/css/customer.css   ← 顾客端设计系统（与另两端零共享）

只依赖 shared/ 里的数据模型与权限装饰器，不碰商家端和骑手端的任何东西。

页面前缀   /customer/...           → pages
接口前缀   /api/customer/...       → api

待实现（路径与载荷见 docs/API契约.md）：
    浏览与搜索    GET    /api/customer/restaurants
                  GET    /api/customer/restaurants/<id>
    地址簿        GET    /api/customer/addresses
                  POST   /api/customer/addresses
                  DELETE /api/customer/addresses/<id>
    下单          POST   /api/customer/orders
    我的订单      GET    /api/customer/orders
    订单进度      GET    /api/customer/orders/<id>
    取消订单      POST   /api/customer/orders/<id>/cancel
    评价          POST   /api/customer/orders/<id>/review
================================================================================
"""

from flask import Blueprint, jsonify, render_template

# 页面
pages = Blueprint(
    "customer",
    __name__,
    url_prefix="/customer",
    template_folder="templates",
    static_folder="static",
    static_url_path="/static",
)

# 接口
api = Blueprint("customer_api", __name__, url_prefix="/api/customer")


# ── 页面 ──────────────────────────────────────────────────────────────────────
@pages.get("/design-system")
def design_system():
    """顾客端设计规范样张页（答辩时用来讲这一端的视觉语言）"""
    return render_template("customer/design-system.html")


# ── 接口 ──────────────────────────────────────────────────────────────────────
@api.get("/ping")
def ping():
    """占位：证明顾客端这一条链路可以独立跑通"""
    return jsonify(role="customer", ok=True)
