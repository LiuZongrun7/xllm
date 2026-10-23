"""
公开官网 —— /info

    /            官网首页（单页长滚动，锚点导航）
    /demo        三端入口（与首页 #demo 同内容，方便直接分享链接）

设计约束（与三端一致，答辩时可以这么解释）：

  1. **不碰数据库。** 这个蓝图里没有一次 db.session 调用。官网挂掉不该
     影响下单，数据库挂掉也不该让官网 500。所有文案都是常量。
  2. **不碰会话。** 没有 @role_page、没有 login 判断。登没登录看到的完全一样。
  3. **自己的皮肤。** 模板在 templates/info/，样式在 static/css/info.css，
     只复用 /static/css/reset.css。删掉 server/info/ 只是少一个官网。
  4. **文案与像素分离。** 卡片、状态机、技术栈这些内容以 Python 数据结构给出
     （下面的常量），模板只负责循环渲染 —— 改文案不用改 HTML 结构。
"""

from datetime import date

from flask import Blueprint, redirect, render_template, url_for

pages = Blueprint(
    "info",
    __name__,
    url_prefix="/info",
    template_folder="templates",
    static_folder="static",
    static_url_path="/static",
)

# ---------------------------------------------------------------------------
# 页面文案
# ---------------------------------------------------------------------------

SITE = {
    "name": "xLLM",
    "product": "xLLM Food Delivery",
    "course": "COMP3019J Web Application Development",
    "term": "2026/27",
    "topic": "Final Project · Topic 7 — Food Delivery",
    "github": "https://github.com/LiuZongrun7/xllm",
    "email": "contact@xllm.cloud",
}

STATS = [
    ("3", "role-specific interfaces"),
    ("13", "database tables"),
    ("7", "order states"),
    ("100", "automated checks"),
]

# 三端入口卡片。#demo 里按这个顺序渲染。
ROLES = [
    {
        "key": "customer",
        "label": "Customer",
        "headline": "Order in under a minute",
        "device": "Mobile web",
        "endpoint": "customer.login_page",
        "account": "alex",
        "image": "customer-app.jpg",
        "orientation": "phone",
        "width": 430, "height": 1057,
        "tint": "#FF4B3E",
        "glow": "rgba(255, 75, 62, .20)",
        "cta": "Open the customer app",
        "points": [
            "Browse by cuisine or search across restaurants and dishes",
            "Cart, checkout, delivery-radius check, mock payment",
            "Live progress with a status timeline",
            "Cancel or move the address before pickup",
            "Rate a delivered order — once",
        ],
    },
    {
        "key": "merchant",
        "label": "Restaurant",
        "headline": "Run the whole service day",
        "device": "Desktop web",
        "endpoint": "merchant.login_page",
        "account": "goldenwok",
        "image": "merchant-dashboard.jpg",
        "orientation": "desktop",
        "width": 1200, "height": 750,
        "tint": "#E45C86",
        "glow": "rgba(228, 92, 134, .20)",
        "cta": "Open the restaurant console",
        "points": [
            "Four-column board: new, preparing, ready, on the way",
            "Accept, decline, start cooking, mark ready",
            "Menu CRUD with stock, sell-out switch and restock",
            "Opening hours, kitchen capacity, pause service",
            "Delay flags, after-sales issues, revenue analytics",
        ],
    },
    {
        "key": "rider",
        "label": "Rider",
        "headline": "Claim a job, finish it",
        "device": "Mobile web",
        "endpoint": "rider.login_page",
        "account": "chen",
        "image": "rider-app.jpg",
        "orientation": "phone",
        "width": 430, "height": 958,
        "tint": "#E0A02E",
        "glow": "rgba(224, 160, 46, .20)",
        "cta": "Open the rider app",
        "points": [
            "Open pool of orders the restaurant has released",
            "One-claim guarantee — two riders cannot win the same job",
            "Pickup and delivery checkpoints with timestamps",
            "Location reporting, with accuracy and speed sanity checks",
            "Delivery history and today's earnings",
        ],
    },
]

FEATURES = [
    (
        "One order, three viewpoints",
        "A single order row, three role-scoped APIs. Prices, fees and the delivery "
        "address are snapshotted at checkout, so later menu edits cannot rewrite history.",
    ),
    (
        "A lifecycle the server owns",
        "Seven states, one transition table. The interface can offer a button only "
        "where the server will accept the move — an illegal transition is a 409, not a bug.",
    ),
    (
        "One-claim guarantee",
        "Grabbing a job is a single conditional UPDATE ... WHERE rider_id IS NULL. "
        "Two riders tapping at the same moment, exactly one wins; the other retries.",
    ),
    (
        "Delivery zones, actually checked",
        "Distance from kitchen to drop-off is computed with the Haversine formula and "
        "compared against the restaurant's radius before the order is accepted.",
    ),
    (
        "Kitchen reality",
        "Opening hours, capacity per time slot, sold-out dishes and a manual pause all "
        "block checkout honestly, with the reason shown at the point of failure.",
    ),
    (
        "Staged cancellation",
        "Who may cancel, until when, and what the other two sides see afterwards is "
        "written down and enforced — not improvised per screen.",
    ),
    (
        "Money and opinions",
        "Totals are computed server-side from the cart, and a delivered order can be "
        "reviewed exactly once. Revenue and best-sellers come from the same rows.",
    ),
    (
        "Denied access is logged",
        "Reading another customer's order returns the same 404 as a missing one, and "
        "writes an audit line. A page existing is not the same as permission to see it.",
    ),
    (
        "Three interfaces, one vocabulary",
        "Customer, restaurant and rider share the language — status names, currency, "
        "time formats — while keeping three separate design systems.",
    ),
]

FLOW = [
    ("Placed", "Customer submits. Totals, fees and address are frozen."),
    ("Accepted", "Restaurant takes the job; a kitchen slot is reserved."),
    ("Preparing", "The kitchen starts. Flagging a delay becomes possible."),
    ("Ready", "Released to riders and appears in the open pool."),
    ("On the way", "A rider claimed it and confirmed pickup."),
    ("Delivered", "The customer confirms arrival; rating unlocks once."),
    ("Cancelled", "Allowed only before pickup, always with a recorded reason."),
]

GUARDRAILS = [
    ("Role checks on every query",
     "Not on the page, on the data. A merchant request for another store's order "
     "matches zero rows."),
    ("Atomic hand-over",
     "The rider claim is a conditional write, not read-then-write, so it holds "
     "under concurrent taps."),
    ("Snapshot columns",
     "Dish name, unit price and drop-off address are copied into the order at "
     "checkout time."),
    ("GPS sanity rules",
     "Location fixes without accuracy, or implying impossible speed, are rejected "
     "instead of trusted."),
]

STACK = [
    ("Backend", ["Python 3", "Flask 3.1", "SQLAlchemy 2.0", "blueprints", "REST / JSON"]),
    ("Data", ["MySQL 8", "13 tables", "SQLite for local dev", "idempotent migrations"]),
    ("Front end", ["Jinja2", "vanilla JS (fetch)", "hand-written CSS", "no framework", "no CDN"]),
    ("Operations", ["nginx + TLS", "gunicorn", "systemd", "Let's Encrypt", "Amap JS API"]),
]

DESIGN_SYSTEMS = [
    {
        "name": "Customer",
        "note": "Phone first. Pills, generous shadows, warm red.",
        "swatches": ["#FFFFFF", "#FFF4F2", "#EB1700", "#1A1A1A"],
        "detail": "48px pill buttons · soft shadows · 17px base",
    },
    {
        "name": "Restaurant",
        "note": "Desktop back office. Dense tables, square corners, wine.",
        "swatches": ["#FBF5F7", "#F3DCE4", "#B11955", "#241016"],
        "detail": "6px radii · no shadows · 56px table rows",
    },
    {
        "name": "Rider",
        "note": "Gloved hands, sunlight. Big targets, high contrast, amber.",
        "swatches": ["#F4F5F4", "#E7E9E7", "#D08A38", "#14180F"],
        "detail": "56px buttons · no shadows · 15px base",
    },
]

TEAM = [
    ("Fu Rao", "Customer interface"),
    ("Liu Jing", "Restaurant interface"),
    ("Zhou Jiaxu", "Rider interface"),
    ("Liu Zongrun", "Shared platform, state machine, deployment"),
]


# ---------------------------------------------------------------------------
# 页面
# ---------------------------------------------------------------------------
def _ctx() -> dict:
    return {
        "site": SITE,
        "stats": STATS,
        "roles": ROLES,
        "features": FEATURES,
        "flow": FLOW,
        "guardrails": GUARDRAILS,
        "stack": STACK,
        "designs": DESIGN_SYSTEMS,
        "team": TEAM,
        "year": date.today().year,
    }


@pages.get("/")
def index():
    """官网首页。不需要登录，也不读数据库。"""
    return render_template("info/index.html", **_ctx())


@pages.get("/demo")
def demo():
    """
    三端入口的短地址：/info/demo → /info/#demo

    做成独立地址只为方便把链接单独发出去，不复制一份页面内容，
    否则"演示卡片"要维护两处，迟早不一致。
    """
    return redirect(url_for("info.index") + "#demo", code=302)
