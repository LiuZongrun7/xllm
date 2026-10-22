"""
商家端 —— 页面与接口（负责人：B）
================================================================================
这是商家端的**全部代码入口**。答辩时只需要打开这一行下面这几个文件：

    merchant/routes.py                 ← 本文件：页面路由 + 商家侧接口
    merchant/templates/                ← 商家端页面（Jinja2）
    merchant/static/css/merchant.css   ← 商家端设计系统（与另两端零共享）

只依赖 shared/ 里的数据模型与权限装饰器，不碰顾客端和骑手端的任何东西。

页面前缀   /merchant/...           → pages
接口前缀   /api/merchant/...       → api

待实现（路径与载荷见 docs/API契约.md）：
    店铺资料      GET/PATCH /api/merchant/profile
    营业时间      GET/PUT   /api/merchant/opening-hours
    营业状态      POST      /api/merchant/status        （营业中 / 暂停接单）
    菜单          GET       /api/merchant/menu-items
                  POST      /api/merchant/menu-items
                  PATCH     /api/merchant/menu-items/<id>
                  DELETE    /api/merchant/menu-items/<id>
    库存与售罄    PATCH     /api/merchant/menu-items/<id>/stock
    订单队列      GET       /api/merchant/orders
    订单详情      GET       /api/merchant/orders/<id>
    状态推进      POST      /api/merchant/orders/<id>/accept
                  POST      /api/merchant/orders/<id>/preparing
                  POST      /api/merchant/orders/<id>/ready
                  POST      /api/merchant/orders/<id>/delay
    异常列表      GET       /api/merchant/issues

⚠️ 状态推进必须调用 shared/ 里的状态机，不要在这里自己判 if status == ...
================================================================================
"""

from flask import Blueprint, jsonify, render_template

# 页面
pages = Blueprint(
    "merchant",
    __name__,
    url_prefix="/merchant",
    template_folder="templates",
    static_folder="static",
    static_url_path="/static",
)

# 接口
api = Blueprint("merchant_api", __name__, url_prefix="/api/merchant")


# ── 页面 ──────────────────────────────────────────────────────────────────────
@pages.get("/design-system")
def design_system():
    """商家端设计规范样张页（答辩时用来讲这一端的视觉语言）"""
    return render_template("merchant/design-system.html")


# ── 接口 ──────────────────────────────────────────────────────────────────────
@api.get("/ping")
def ping():
    """占位：证明商家端这一条链路可以独立跑通"""
    return jsonify(role="merchant", ok=True)
