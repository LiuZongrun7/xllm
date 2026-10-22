#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
xLLM · Food Delivery Website — Chen 记法 ER 图生成器
================================================================================
记法（严格遵循 COMP2013J《Database Design》08/09 课件, Elmasri & Navathe 第 7 章）:
    实体 Entity          矩形
    属性 Attribute       椭圆
    主键 Primary key     属性名【实线下划线】
    关系 Relationship    菱形
    基数 Cardinality     连线上的 1 / N
    外键 Foreign key     浅蓝底色（辅助色, 不占用任何标准记法符号）

⚠️ 虚线下划线在本课程里是【弱实体的部分键】, 不是外键, 所以本图不使用它。

布局要解决的三个问题（都是踩过坑之后加的）:
    1. 关系连线会从自己的属性圈上穿过去
       → 属性只摆在"没有关系经过"的角度扇区里（place_angles）
    2. 扇区窄的时候椭圆会互相压
       → 环半径按【可用角度】自适应放大（fit_radius）
    3. 菱形放在连线中点时会互相重叠
       → 菱形放在"两个属性环之间的空隙"里, 并做简单排斥（build 里的 resolve）

用法:
    python3 生成ER图.py                      # 生成 ER图.svg
    qlmanage -t -s 7000 -o . ER图.svg        # 转 PNG（⚠️ qlmanage 会把非正方形
                                             #   SVG 拉伸变形, 所以画布强制补成正方形）
"""

import html
import math

# ============================================================================
#  1. 画布与样式
# ============================================================================
ENTITY_W, ENTITY_H = 250, 68
OVAL_RX, OVAL_RY = 100, 33
DIAMOND_W, DIAMOND_H = 190, 106
FONT = "Helvetica Neue, Helvetica, Arial, sans-serif"

FILL_ENTITY = "#e9e9e9"
FILL_ATTR = "#ffffff"
FILL_FK = "#eef4ff"
FILL_REL = "#f7f7f7"
STROKE = "#2c2c2c"
STROKE_SOFT = "#555555"
COLOR_FK = "#1d4ed8"

FS_ENTITY = 25
FS_ATTR = 19
FS_REL = 19
FS_CARD = 22

MARGIN = 110
GAP_X, GAP_Y = 170, 170
ATTR_GAP = 36
MIN_SEP = DIAMOND_W * 0.78          # 菱形之间的最小间距


# ============================================================================
#  2. 实体
# ============================================================================
ENTITIES = {
    "users": [
        ("user_id", True, False), ("role", False, False),
        ("username", False, False), ("email", False, False),
        ("name", False, False), ("phone", False, False),
        ("password_hash", False, False), ("email_verified_at", False, False),
        ("is_active", False, False),
    ],
    "restaurants": [
        ("restaurant_id", True, False), ("owner_id", False, True),
        ("name", False, False), ("phone", False, False),
        ("address_text", False, False), ("lng", False, False), ("lat", False, False),
        ("min_order_amount", False, False), ("delivery_fee", False, False),
        ("delivery_radius_km", False, False), ("is_open", False, False),
    ],
    "opening_hours": [
        ("hours_id", True, False), ("restaurant_id", False, True),
        ("weekday", False, False), ("open_time", False, False),
        ("close_time", False, False), ("is_closed", False, False),
    ],
    "menu_items": [
        ("item_id", True, False), ("restaurant_id", False, True),
        ("name", False, False), ("price", False, False), ("calories", False, False),
        ("category", False, False), ("stock", False, False),
        ("is_available", False, False),
    ],
    "customer_addresses": [
        ("address_id", True, False), ("user_id", False, True),
        ("label", False, False), ("contact_name", False, False),
        ("contact_phone", False, False), ("address_text", False, False),
        ("lng", False, False), ("lat", False, False),
    ],
    "orders": [
        ("order_id", True, False), ("order_no", False, False),
        ("customer_id", False, True), ("restaurant_id", False, True),
        ("rider_id", False, True),
        ("status", False, False), ("payment_status", False, False),
        ("total_amount", False, False),
        ("delivery_address_text", False, False), ("delivery_lng", False, False),
        ("delivery_lat", False, False), ("distance_km", False, False),
        ("estimated_delivery_at", False, False),
        ("remark", False, False), ("cancel_reason", False, False),
        ("created_at", False, False),
    ],
    "order_items": [
        ("order_item_id", True, False), ("order_id", False, True),
        ("menu_item_id", False, True), ("name_snapshot", False, False),
        ("unit_price", False, False), ("quantity", False, False),
    ],
    "reviews": [
        ("review_id", True, False), ("order_id", False, True),
        ("reviewer_id", False, True), ("target_type", False, False),
        ("target_id", False, False), ("rating", False, False),
        ("content", False, False),
    ],
    "rider_locations": [
        ("location_id", True, False), ("rider_id", False, True),
        ("order_id", False, True), ("lng", False, False), ("lat", False, False),
        ("accuracy_m", False, False), ("recorded_at", False, False),
    ],
    "coupons": [
        ("coupon_id", True, False), ("code", False, False), ("title", False, False),
        ("owner_type", False, False), ("owner_id", False, False),
        ("discount_type", False, False), ("discount_value", False, False),
        ("min_order_amount", False, False), ("total_quantity", False, False),
        ("end_at", False, False), ("is_active", False, False),
    ],
    "email_codes": [
        ("code_id", True, False), ("email", False, False),
        ("purpose", False, False), ("code_hash", False, False),
        ("expires_at", False, False), ("used_at", False, False),
        ("attempts", False, False),
    ],
    "user_coupons": [
        ("user_coupon_id", True, False), ("user_id", False, True),
        ("coupon_id", False, True), ("status", False, False),
        ("used_order_id", False, True), ("claimed_at", False, False),
        ("used_at", False, False),
    ],
}


# ============================================================================
#  3. 关系（动词用英文，和上学期那张图一致）
# ============================================================================
RELATIONSHIPS = [
    ("OWNS",      "users",       "restaurants",        "1", "1"),
    ("HAS",       "restaurants", "opening_hours",      "1", "N"),
    ("OFFERS",    "restaurants", "menu_items",         "1", "N"),
    ("SAVES",     "users",       "customer_addresses", "1", "N"),
    ("PLACES",    "users",       "orders",             "1", "N"),
    ("RECEIVES",  "restaurants", "orders",             "1", "N"),
    ("DELIVERS",  "users",       "orders",             "1", "N"),
    ("CONTAINS",  "orders",      "order_items",        "1", "N"),
    ("REFERS_TO", "menu_items",  "order_items",        "1", "N"),
    ("RATED_IN",  "orders",      "reviews",            "1", "N"),
    ("WRITES",    "users",       "reviews",            "1", "N"),
    ("REPORTS",   "users",       "rider_locations",    "1", "N"),
    ("TRACKS",    "orders",      "rider_locations",    "1", "N"),
    ("ISSUES",    "coupons",     "user_coupons",       "1", "N"),
    ("CLAIMS",    "users",       "user_coupons",       "1", "N"),
    ("USED_IN",   "orders",      "user_coupons",       "1", "1"),
    ("VERIFIES",  "users",       "email_codes",        "1", "N"),
]

# 实体摆放顺序：连得多的放中间
GRID = [
    ["opening_hours", "restaurants",     "menu_items",  "coupons"],
    ["customer_addresses", "orders",     "order_items", "user_coupons"],
    ["reviews",       "rider_locations", "users",       "email_codes"],
]

TWO_PI = 2 * math.pi
STEPS = 1440                       # 圆周采样精度（0.25°）


# ============================================================================
#  4. 环半径与角度分配
# ============================================================================
def base_radius(n):
    """按属性个数算基准环半径（保证沿整圈摆得下）"""
    if n == 0:
        return 0
    return max(OVAL_RY + 76, n * (2 * OVAL_RX + ATTR_GAP) / TWO_PI)


def free_runs(blocked, r):
    """把圆周按 STEPS 采样，返回没被关系方向占用的连续角度段 [(起点, 长度), ...]"""
    if not blocked:
        return [(0, STEPS)]
    delta = math.asin(min(1.0, (OVAL_RX + 40) / max(r, OVAL_RX + 41))) * 1.30
    free = [
        all(abs(((TWO_PI * i / STEPS - b + math.pi) % TWO_PI) - math.pi) > delta
            for b in blocked)
        for i in range(STEPS)
    ]
    runs, i = [], 0
    while i < STEPS:
        if free[i]:
            j = i
            while j < STEPS and free[j]:
                j += 1
            runs.append([i, j - i])
            i = j
        else:
            i += 1
    # 首尾相接的两段合并
    if len(runs) > 1 and runs[0][0] == 0 and runs[-1][0] + runs[-1][1] == STEPS:
        s_last, l_last = runs.pop()
        runs[0][0] = s_last - STEPS
        runs[0][1] += l_last
    return runs


def fit_radius(n, blocked):
    """扇区窄的时候把半径放大，直到 n 个椭圆沿可用角度摆得下。

    半径和 delta 互相依赖，所以迭代几次收敛。
    """
    r = base_radius(n)
    for _ in range(6):
        runs = free_runs(blocked, r)
        span = TWO_PI * sum(l for _, l in runs) / STEPS
        if span < 0.12 * TWO_PI:          # 几乎没有空隙 → 放弃避让，用整圈
            return base_radius(n), False
        need = n * (2 * OVAL_RX + ATTR_GAP) / span
        if need <= r * 1.01:
            return r, True
        r = need
    return r, True


def place_angles(blocked, n, r):
    """把 n 个属性分配到空闲扇区里，按段长比例"""
    even = [-math.pi / 2 + TWO_PI * i / n for i in range(n)]
    if n == 0:
        return []
    runs = free_runs(blocked, r)
    total = sum(l for _, l in runs)
    if total == 0:
        return even

    delta = math.asin(min(1.0, (OVAL_RX + 40) / max(r, OVAL_RX + 41))) * 1.30
    min_len = 2.0 * delta * STEPS / TWO_PI
    alloc = [max(1, int(round(n * l / total))) if l >= min_len else 0
             for _, l in runs]

    guard = 0
    while sum(alloc) > n and guard < 300:
        idx = max(range(len(alloc)), key=lambda t: alloc[t])
        if alloc[idx] <= 1:
            break
        alloc[idx] -= 1
        guard += 1
    while sum(alloc) < n and guard < 600:
        idx = max(range(len(alloc)),
                  key=lambda t: runs[t][1] / max(alloc[t], 1))
        alloc[idx] += 1
        guard += 1

    out = []
    for (s, l), k in zip(runs, alloc):
        for t in range(k):
            if k <= 0:
                continue
            out.append(TWO_PI * ((s + (t + 0.5) * l / k) % STEPS) / STEPS)
    while len(out) < n:
        out.append(even[len(out) % n])
    return out[:n]


# ============================================================================
#  5. 网格定位（半径 → 单元尺寸 → 行列坐标），迭代两次让位置与半径自洽
# ============================================================================
def layout(radii):
    col_w = [0] * max(len(r) for r in GRID)
    row_h = [0] * len(GRID)
    for ri, row in enumerate(GRID):
        for ci, name in enumerate(row):
            if name is None:
                continue
            s = 2 * (radii[name] + OVAL_RX + 30)
            col_w[ci] = max(col_w[ci], s)
            row_h[ri] = max(row_h[ri], s)

    col_x, x = [], MARGIN
    for w in col_w:
        col_x.append(x + w / 2)
        x += w + GAP_X
    row_y, y = [], MARGIN
    for h in row_h:
        row_y.append(y + h / 2)
        y += h + GAP_Y

    pos = {}
    for ri, row in enumerate(GRID):
        for ci, name in enumerate(row):
            if name is not None:
                pos[name] = (col_x[ci], row_y[ri])
    return pos, x + MARGIN, y + MARGIN


def compute_positions():
    """位置 ↔ 关系方向 ↔ 环半径 互相依赖，迭代三轮收敛"""
    radii = {n: base_radius(len(a)) for n, a in ENTITIES.items()}
    pos, W, H = layout(radii)
    for _ in range(3):
        dirs = rel_directions(pos)
        radii = {n: fit_radius(len(a), dirs[n])[0] for n, a in ENTITIES.items()}
        pos, W, H = layout(radii)
    dirs = rel_directions(pos)
    radii = {n: fit_radius(len(a), dirs[n])[0] for n, a in ENTITIES.items()}
    pos, W, H = layout(radii)
    return pos, radii, W, H


def rel_directions(pos):
    dirs = {name: [] for name in ENTITIES}
    for rel, a, b, ca, cb in RELATIONSHIPS:
        ax, ay = pos[a]
        bx, by = pos[b]
        dirs[a].append(math.atan2(by - ay, bx - ax))
        dirs[b].append(math.atan2(ay - by, ax - bx))
    return dirs


# ============================================================================
#  6. SVG 基元
# ============================================================================
def esc(s):
    return html.escape(str(s))


def line(x1, y1, x2, y2, w=1.5, color=STROKE_SOFT):
    return (f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
            f'stroke="{color}" stroke-width="{w}"/>')


def text(x, y, s, size, anchor="middle", weight="normal", color="#111111"):
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-family="{FONT}" font-size="{size}" '
            f'font-weight="{weight}" fill="{color}" text-anchor="{anchor}" '
            f'dominant-baseline="middle">{esc(s)}</text>')


def entity_shape(cx, cy, name):
    return (f'<rect x="{cx - ENTITY_W/2:.1f}" y="{cy - ENTITY_H/2:.1f}" '
            f'width="{ENTITY_W}" height="{ENTITY_H}" fill="{FILL_ENTITY}" '
            f'stroke="{STROKE}" stroke-width="2.6" rx="3"/>'
            + text(cx, cy, name.upper(), FS_ENTITY, weight="700"))


def attr_shape(cx, cy, label, pk, fk):
    fill = FILL_FK if fk else FILL_ATTR
    out = [f'<ellipse cx="{cx:.1f}" cy="{cy:.1f}" rx="{OVAL_RX}" ry="{OVAL_RY}" '
           f'fill="{fill}" stroke="{STROKE}" stroke-width="1.6"/>',
           text(cx, cy + 1, label, FS_ATTR, color=COLOR_FK if fk else "#111111")]
    if pk:
        tw = len(label) * FS_ATTR * 0.56
        uy = cy + 1 + FS_ATTR * 0.66
        out.append(line(cx - tw / 2, uy, cx + tw / 2, uy, w=1.9, color="#111111"))
    return "".join(out)


def diamond_shape(cx, cy, label):
    pts = (f"{cx:.1f},{cy - DIAMOND_H/2:.1f} {cx + DIAMOND_W/2:.1f},{cy:.1f} "
           f"{cx:.1f},{cy + DIAMOND_H/2:.1f} {cx - DIAMOND_W/2:.1f},{cy:.1f}")
    return (f'<polygon points="{pts}" fill="{FILL_REL}" stroke="{STROKE}" '
            f'stroke-width="2.0"/>' + text(cx, cy, label, FS_REL, weight="600"))


def rect_edge(cx, cy, tx, ty):
    dx, dy = tx - cx, ty - cy
    if dx == 0 and dy == 0:
        return cx, cy
    sx = (ENTITY_W / 2) / abs(dx) if dx else float("inf")
    sy = (ENTITY_H / 2) / abs(dy) if dy else float("inf")
    s = min(sx, sy)
    return cx + dx * s, cy + dy * s


# ============================================================================
#  7. 关系菱形定位（放在两个属性环之间的空隙里 + 排斥）
# ============================================================================
def collect_ovals(pos, radii, dirs):
    """先算出所有属性椭圆的圆心，供菱形避让使用"""
    out = []
    for name, attrs in ENTITIES.items():
        cx, cy = pos[name]
        r = radii[name]
        for ang in place_angles(dirs[name], len(attrs), r):
            out.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    return out


def sync(d):
    """由 t（沿连线滑动的距离）和 off（垂直偏移）重算菱形中心"""
    d["x"] = d["ax"] + d["ux"] * d["t"] + d["px"] * d["off"]
    d["y"] = d["ay"] + d["uy"] * d["t"] + d["py"] * d["off"]


def resolve_diamonds(pos, radii, ovals):
    """返回每个关系的菱形中心坐标

    三级处理:
      1. 同一对实体之间的多条关系（如 users↔orders 既有 PLACES 又有 DELIVERS）
         会让菱形沿【垂直方向】错开 —— 否则它们共用同一条连线，会完全重叠
      2. 沿连线滑动，躲开其它菱形
      3. 沿连线滑动，躲开属性椭圆
    只沿连线滑动（+ 固定的垂直偏移），所以菱形不会跑离它该在的那条关系线上。
    """
    groups = {}
    for idx, (rel, a, b, ca, cb) in enumerate(RELATIONSHIPS):
        groups.setdefault(tuple(sorted((a, b))), []).append(idx)
    perp = {}
    for idxs in groups.values():
        n = len(idxs)
        for k, idx in enumerate(idxs):
            perp[idx] = (k - (n - 1) / 2) * (DIAMOND_H + 34)

    items = []
    for idx, (rel, a, b, ca, cb) in enumerate(RELATIONSHIPS):
        ax, ay = pos[a]
        bx, by = pos[b]
        d = math.hypot(bx - ax, by - ay) or 1
        ux, uy = (bx - ax) / d, (by - ay) / d
        t0 = radii[a] + OVAL_RY + 40
        t1 = d - (radii[b] + OVAL_RY + 40)
        if t1 - t0 < DIAMOND_W + 40:
            t0, t1 = d * 0.30, d * 0.70
        it = dict(rel=rel, a=a, b=b, ca=ca, cb=cb, ax=ax, ay=ay,
                  ux=ux, uy=uy, px=-uy, py=ux, off=perp[idx],
                  t=(t0 + t1) / 2, t0=t0, t1=t1, x=0.0, y=0.0)
        sync(it)
        items.append(it)

    OVAL_CLEAR = OVAL_RX + 34

    for _ in range(240):
        moved = False
        for i, di in enumerate(items):
            for dj in items[i + 1:]:
                dd = math.hypot(dj["x"] - di["x"], dj["y"] - di["y"])
                if dd >= MIN_SEP:
                    continue
                if dd < 1e-6:                      # 完全重合：朝相反方向推开
                    for d, s in ((di, -1), (dj, 1)):
                        d["t"] = max(d["t0"], min(d["t1"], d["t"] + s * 40))
                        sync(d)
                    moved = True
                    continue
                step = min(70.0, (MIN_SEP - dd) / 2 + 4)
                for d, other in ((di, dj), (dj, di)):
                    away = ((other["x"] - d["x"]) * d["ux"]
                            + (other["y"] - d["y"]) * d["uy"])
                    nt = d["t"] + (-step if away > 0 else step)
                    d["t"] = max(d["t0"], min(d["t1"], nt))
                    sync(d)
                moved = True

            for (qx, qy) in ovals:                 # 躲开属性椭圆
                dd = math.hypot(qx - di["x"], qy - di["y"])
                if dd >= OVAL_CLEAR or dd < 1e-6:
                    continue
                step = min(80.0, (OVAL_CLEAR - dd) + 6)
                if (qx - di["x"]) * di["ux"] + (qy - di["y"]) * di["uy"] > 0:
                    nt = di["t"] - step
                else:
                    nt = di["t"] + step
                di["t"] = max(di["t0"], min(di["t1"], nt))
                sync(di)
                moved = True

        if not moved:
            break
    return items


# ============================================================================
#  8. 图例
# ============================================================================
def legend(W, y0):
    H = 225
    COL_W = 950                       # 固定列宽 —— 不能用画布全宽均分，
    box_w = COL_W * 3 + 80            # 否则画布一大，图例项就被拉得相隔几千像素
    box_x = (W - box_w) / 2           # 在画布上居中
    parts = [
        f'<rect x="{box_x:.0f}" y="{y0}" width="{box_w:.0f}" height="{H}" '
        f'fill="#fafafa" stroke="{STROKE_SOFT}" stroke-width="1.4" rx="5"/>',
        text(box_x + 38, y0 + 40, "NOTATION  记法", 26, anchor="start", weight="700"),
    ]
    items = [
        ("rect",    "Entity 实体"),
        ("ellipse", "Attribute 属性"),
        ("pk",      "Primary key 主键"),
        ("fk",      "Foreign key 外键（辅助色）"),
        ("diamond", "Relationship 关系"),
        ("card",    "1 / N   Cardinality 基数"),
    ]
    for i, (kind, label) in enumerate(items):
        cx = box_x + 38 + (i % 3) * COL_W
        cy = y0 + 95 + (i // 3) * 66
        if kind == "rect":
            parts.append(f'<rect x="{cx}" y="{cy-19}" width="58" height="38" '
                         f'fill="{FILL_ENTITY}" stroke="{STROKE}" stroke-width="2"/>')
        elif kind == "ellipse":
            parts.append(f'<ellipse cx="{cx+29}" cy="{cy}" rx="32" ry="19" '
                         f'fill="{FILL_ATTR}" stroke="{STROKE}" stroke-width="1.6"/>')
        elif kind == "fk":
            parts.append(f'<ellipse cx="{cx+29}" cy="{cy}" rx="32" ry="19" '
                         f'fill="{FILL_FK}" stroke="{STROKE}" stroke-width="1.6"/>')
            parts.append(text(cx + 29, cy + 1, "name", 18, color=COLOR_FK))
        elif kind == "diamond":
            pts = f"{cx+29},{cy-20} {cx+59},{cy} {cx+29},{cy+20} {cx-1},{cy}"
            parts.append(f'<polygon points="{pts}" fill="{FILL_REL}" '
                         f'stroke="{STROKE}" stroke-width="1.9"/>')
        elif kind == "pk":
            parts.append(text(cx + 29, cy, "name", 19))
            parts.append(line(cx - 5, cy + 13, cx + 63, cy + 13, w=1.9, color="#111111"))
        elif kind == "card":
            parts.append(f'<circle cx="{cx+29}" cy="{cy}" r="17" fill="#ffffff"/>')
            parts.append(text(cx + 29, cy + 1, "1 / N", 18, weight="700"))
        parts.append(text(cx + 78, cy, label, 19, anchor="start"))
    return "".join(parts)


# ============================================================================
#  9. 主流程
# ============================================================================
def build():
    pos, radii, W, H = compute_positions()
    dirs = rel_directions(pos)
    ovals = collect_ovals(pos, radii, dirs)
    diamonds = resolve_diamonds(pos, radii, ovals)

    LEGEND_H = 260
    cw, ch = W, H + LEGEND_H
    S = max(cw, ch)
    ox, oy = (S - cw) / 2, (S - ch) / 2

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{S:.0f}" height="{S:.0f}" '
        f'viewBox="0 0 {S:.0f} {S:.0f}">',
        f'<rect width="{S:.0f}" height="{S:.0f}" fill="#ffffff"/>',
        f'<g transform="translate({ox:.1f},{oy:.1f})">',
    ]

    # ---- 9.1 关系连线 + 菱形 ----
    for dm in diamonds:
        for ent, card in ((dm["a"], dm["ca"]), (dm["b"], dm["cb"])):
            ex, ey = pos[ent]
            sx, sy = rect_edge(ex, ey, dm["x"], dm["y"])
            vx, vy = dm["x"] - ex, dm["y"] - ey
            L = math.hypot(vx, vy) or 1
            a, b = DIAMOND_W / 2, DIAMOND_H / 2
            k = 1.0 / ((abs(vx) / L) / a + (abs(vy) / L) / b)
            parts.append(line(sx, sy, dm["x"] - vx * k / L, dm["y"] - vy * k / L,
                              w=1.7))
            # 基数标注：放在靠实体一侧约 40% 处，加白底避免压线
            lx = sx + (dm["x"] - sx) * 0.42
            ly = sy + (dm["y"] - sy) * 0.42
            parts.append(f'<circle cx="{lx:.1f}" cy="{ly:.1f}" r="16" '
                         f'fill="#ffffff"/>')
            parts.append(text(lx, ly + 1, card, FS_CARD, weight="700"))
        parts.append(diamond_shape(dm["x"], dm["y"], dm["rel"]))

    # ---- 9.2 实体 + 属性 ----
    for name, attrs in ENTITIES.items():
        cx, cy = pos[name]
        r = radii[name]
        angles = place_angles(dirs[name], len(attrs), r)
        for (label, pk, fk), ang in zip(attrs, angles):
            ox_, oy_ = cx + r * math.cos(ang), cy + r * math.sin(ang)
            sx, sy = rect_edge(cx, cy, ox_, oy_)
            dx, dy = ox_ - sx, oy_ - sy
            L = math.hypot(dx, dy) or 1
            # t 是从【椭圆中心】到椭圆边界的距离，所以终点必须从椭圆中心往回量
            t = 1.0 / math.sqrt((dx / OVAL_RX) ** 2 + (dy / OVAL_RY) ** 2)
            parts.append(line(sx, sy, ox_ - dx * t / L, oy_ - dy * t / L, w=1.4))
            parts.append(attr_shape(ox_, oy_, label, pk, fk))
        parts.append(entity_shape(cx, cy, name))

    parts.append(legend(W, H + 30))
    parts.append("</g></svg>")
    return "\n".join(parts)


if __name__ == "__main__":
    svg = build()
    with open("ER图.svg", "w", encoding="utf-8") as f:
        f.write(svg)
    print(f"已生成 ER图.svg ({len(svg)} 字符)")
    print("转 PNG:  qlmanage -t -s 7000 -o . ER图.svg")
