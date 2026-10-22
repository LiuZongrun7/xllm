"""
骑手端 —— 页面与接口（负责人：C）
================================================================================
这是骑手端的**全部代码入口**。答辩时只需要打开这一行下面这几个文件：

    rider/routes.py                 ← 本文件：页面路由 + 骑手侧接口
    rider/templates/                ← 骑手端页面（Jinja2）
    rider/static/css/rider.css      ← 骑手端设计系统（与另两端零共享）

只依赖 shared/ 里的数据模型与权限装饰器，不碰顾客端和商家端的任何东西。

页面前缀   /rider/...              → pages
接口前缀   /api/rider/...          → api

待实现（路径与载荷见 docs/API契约.md）：
    可接单池      GET    /api/rider/pool            （status = ready 且无骑手）
    抢单          POST   /api/rider/orders/<id>/claim   ← 必须原子：UPDATE ... WHERE rider_id IS NULL
    我的配送      GET    /api/rider/orders
    订单详情      GET    /api/rider/orders/<id>
    取餐          POST   /api/rider/orders/<id>/pickup
    送达          POST   /api/rider/orders/<id>/deliver
    位置上报      POST   /api/rider/orders/<id>/location
    在线状态      POST   /api/rider/status
    配送历史      GET    /api/rider/history

⚠️ 抢单的原子性是 FR-21 的核心，两个骑手同时点必须只有一个成功。
   参考写法：UPDATE orders SET rider_id=:me WHERE id=:id AND rider_id IS NULL
            然后检查 rowcount，不要先 SELECT 再 UPDATE。
================================================================================
"""

from flask import Blueprint, jsonify, render_template

# 页面
pages = Blueprint(
    "rider",
    __name__,
    url_prefix="/rider",
    template_folder="templates",
    static_folder="static",
    static_url_path="/static",
)

# 接口
api = Blueprint("rider_api", __name__, url_prefix="/api/rider")


# ── 页面 ──────────────────────────────────────────────────────────────────────
@pages.get("/design-system")
def design_system():
    """骑手端设计规范样张页（答辩时用来讲这一端的视觉语言）"""
    return render_template("rider/design-system.html")


# ── 接口 ──────────────────────────────────────────────────────────────────────
@api.get("/ping")
def ping():
    """占位：证明骑手端这一条链路可以独立跑通"""
    return jsonify(role="rider", ok=True)
