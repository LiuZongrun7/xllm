#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
M1 报告 Figure 1 —— 应用结构图

生成 structure.svg，再由 qlmanage 转 PNG（qlmanage 会把非正方形 SVG 拉伸成正方形，
所以画布按正方形建、转完再裁掉多余留白）。

用法:
    python3 make_structure.py
    qlmanage -t -s 6000 -o . structure.svg
    # 再按下面的 CROP 参数裁成正常比例
"""

import html
import math

# 画布（正方形，最后会裁掉留白）
CANVAS = 1600
# 内容实际范围（裁图用）
CROP = (85, 90, 1470, 1205)       # x0, y0, x1, y1

FONT = "Helvetica Neue, Helvetica, Arial, sans-serif"

C_BOX = "#ffffff"
C_BOX_ALT = "#f7f7f7"
C_HEAD = "#e8e8e8"
C_STROKE = "#2c2c2c"
C_SOFT = "#666666"
C_TEXT = "#111111"


def esc(s):
    return html.escape(str(s))


def box(x, y, w, h, lines, fill=C_BOX, bold_first=True, size=26, rx=6, stroke=2.0):
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" '
           f'fill="{fill}" stroke="{C_STROKE}" stroke-width="{stroke}"/>']
    n = len(lines)
    lh = size * 1.35
    total = (n - 1) * lh
    cy = y + h / 2 - total / 2
    for i, line in enumerate(lines):
        weight = "700" if (i == 0 and bold_first) else "normal"
        fs = size if i == 0 else size - 3
        out.append(f'<text x="{x + w/2:.0f}" y="{cy + i*lh:.0f}" font-family="{FONT}" '
                   f'font-size="{fs}" font-weight="{weight}" fill="{C_TEXT}" '
                   f'text-anchor="middle" dominant-baseline="middle">{esc(line)}</text>')
    return "".join(out)


def arrow(x1, y1, x2, y2, dashed=False, label=None, lx=None, ly=None, lsize=21):
    m = "arrd" if dashed else "arr"
    d = ' stroke-dasharray="9,7"' if dashed else ""
    out = [f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{C_STROKE}" '
           f'stroke-width="2.2"{d} marker-end="url(#{m})"/>']
    if label:
        mx = lx if lx is not None else (x1 + x2) / 2
        my = ly if ly is not None else (y1 + y2) / 2
        w = len(label) * lsize * 0.58 + 12
        out.append(f'<rect x="{mx - w/2:.0f}" y="{my - 13:.0f}" width="{w:.0f}" height="26" '
                   f'fill="#ffffff"/>')
        out.append(f'<text x="{mx:.0f}" y="{my:.0f}" font-family="{FONT}" font-size="{lsize}" '
                   f'fill="{C_SOFT}" text-anchor="middle" dominant-baseline="middle">'
                   f'{esc(label)}</text>')
    return "".join(out)


def path(d, dashed=False):
    m = "arrd" if dashed else "arr"
    dd = ' stroke-dasharray="9,7"' if dashed else ""
    return (f'<path d="{d}" fill="none" stroke="{C_STROKE}" stroke-width="2.2"{dd} '
            f'marker-end="url(#{m})"/>')


def build():
    p = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS}" height="{CANVAS}" '
         f'viewBox="0 0 {CANVAS} {CANVAS}">',
         '<defs>'
         '<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
         'markerHeight="7" orient="auto-start-reverse">'
         '<path d="M 0 0 L 10 5 L 0 10 z" fill="#2c2c2c"/></marker>'
         '<marker id="arrd" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
         'markerHeight="7" orient="auto-start-reverse">'
         '<path d="M 0 0 L 10 5 L 0 10 z" fill="#2c2c2c"/></marker>'
         '</defs>',
         f'<rect width="{CANVAS}" height="{CANVAS}" fill="#ffffff"/>']

    # ---------- 浏览器层 ----------
    bw, bh, by = 360, 100, 100
    xs = [140, 620, 1100]
    for x, (t, s) in zip(xs, [("Customer interface", "browser"),
                              ("Restaurant interface", "browser"),
                              ("Rider interface", "browser")]):
        p.append(box(x, by, bw, bh, [t, s]))

    # 汇合到中轴
    mid = CANVAS / 2
    merge_y = by + bh + 55
    for x in xs:
        cx = x + bw / 2
        p.append(arrow(cx, by + bh, cx, merge_y - 1))
    p.append(f'<line x1="{xs[0]+bw/2}" y1="{merge_y}" x2="{xs[-1]+bw/2}" y2="{merge_y}" '
             f'stroke="{C_STROKE}" stroke-width="2.2"/>')

    # ---------- nginx ----------
    nx, nw, nh, ny = mid - 230, 460, 80, merge_y + 50
    p.append(box(nx, ny, nw, nh, ["nginx  (reverse proxy, TLS)", "pages + /api  →  application server"]))
    p.append(arrow(xs[1] + bw / 2, merge_y, xs[1] + bw / 2, ny - 1,
                   label="HTTPS", lx=xs[1] + bw / 2 + 62, ly=merge_y + 26))

    # ---------- gunicorn ----------
    gx, gw, gh, gy = mid - 230, 460, 80, ny + nh + 64
    p.append(box(gx, gy, gw, gh, ["gunicorn  (WSGI server)", "127.0.0.1:8080"]))
    p.append(arrow(mid, ny + nh, mid, gy - 1, label="http (loopback)",
                   lx=mid + 108, ly=ny + nh + 32))

    # ---------- Flask 容器 ----------
    fx, fw, fy, fh = 180, 1240, gy + gh + 64, 310
    p.append(f'<rect x="{fx}" y="{fy}" width="{fw}" height="{fh}" rx="8" fill="{C_BOX_ALT}" '
             f'stroke="{C_STROKE}" stroke-width="2.4"/>')
    p.append(f'<text x="{mid}" y="{fy+34}" font-family="{FONT}" font-size="31" font-weight="700" '
             f'fill="{C_TEXT}" text-anchor="middle" dominant-baseline="middle">'
             f'Flask application</text>')
    p.append(arrow(mid, gy + gh, mid, fy - 1, label="WSGI", lx=mid + 62, ly=gy + gh + 32))

    # 模块
    mw, mh, msep = 212, 92, 22
    total = 5 * mw + 4 * msep
    mx0 = mid - total / 2
    my = fy + 62
    mods = [("auth", "sessions, roles"), ("restaurants", "menu, hours"),
            ("orders", "state machine"), ("riders", "pool, position"),
            ("reviews", "ratings")]
    for i, (name, sub) in enumerate(mods):
        p.append(box(mx0 + i * (mw + msep), my, mw, mh, [name, sub], size=25, stroke=1.8))

    # 共享数据访问层
    sx, sw, sh, sy = mx0, total, 58, my + mh + 26
    p.append(box(sx, sy, sw, sh, ["Shared data access layer (SQLAlchemy models, ownership checks)"],
                 fill=C_HEAD, size=23, stroke=1.8))

    # ---------- 数据与外部服务 ----------
    dy, dh = fy + fh + 90, 108
    store = [("MySQL 8", "12 records (InnoDB)", 180, 430),
             ("Amap (map service)", "address picker / map display", 660, 360),
             ("SMTP mail service", "password recovery", 1070, 350)]

    for name, sub, x, w in store:
        p.append(box(x, dy, w, dh, [name, sub], size=25))

    # Flask → MySQL / Amap / SMTP（虚线）
    p.append(arrow(400, fy + fh, 395, dy - 1, dashed=True, label="SQL",
                   lx=440, ly=fy + fh + 40))
    p.append(arrow(1240, fy + fh, 1240, dy - 1, dashed=True, label="SMTP",
                   lx=1290, ly=fy + fh + 40))

    # 浏览器 → Amap（地图 JS API）：沿左侧下行，从底部绕到 Amap 下方
    p.append(path(f"M {xs[0]} {by + bh/2} L 110 {by + bh/2} L 110 {dy + dh + 30} "
                  f"L 840 {dy + dh + 30} L 840 {dy + dh + 1}", dashed=True))
    p.append(f'<rect x="420" y="{dy + dh + 6}" width="150" height="26" fill="#ffffff"/>')
    p.append(f'<text x="495" y="{dy + dh + 19}" font-family="{FONT}" font-size="21" '
             f'fill="{C_SOFT}" text-anchor="middle" dominant-baseline="middle">map JS API</text>')

    # ---------- 图例 ----------
    ly0 = dy + dh + 86
    p.append(f'<line x1="180" y1="{ly0 - 22}" x2="1420" y2="{ly0 - 22}" '
             f'stroke="{C_SOFT}" stroke-width="1"/>')
    p.append(f'<line x1="180" y1="{ly0}" x2="245" y2="{ly0}" stroke="{C_STROKE}" '
             f'stroke-width="2.4" marker-end="url(#arr)"/>')
    p.append(f'<text x="258" y="{ly0}" font-family="{FONT}" font-size="23" fill="{C_SOFT}" '
             f'dominant-baseline="middle">user request / response</text>')
    p.append(f'<line x1="560" y1="{ly0}" x2="625" y2="{ly0}" stroke="{C_STROKE}" '
             f'stroke-width="2.4" stroke-dasharray="9,7" marker-end="url(#arrd)"/>')
    p.append(f'<text x="638" y="{ly0}" font-family="{FONT}" font-size="23" fill="{C_SOFT}" '
             f'dominant-baseline="middle">call to storage or an external service</text>')

    p.append("</svg>")
    return "\n".join(p)


if __name__ == "__main__":
    svg = build()
    with open("structure.svg", "w", encoding="utf-8") as f:
        f.write(svg)
    x0, y0, x1, y1 = CROP
    print(f"已生成 structure.svg")
    print(f"转 PNG: qlmanage -t -s 6000 -o . structure.svg")
    print(f"裁图:   内容在 SVG 坐标 ({x0},{y0})-({x1},{y1})，"
          f"按 6000/{CANVAS} 缩放后在 PNG 里对应 "
          f"({x0*6000//CANVAS},{y0*6000//CANVAS})-({x1*6000//CANVAS},{y1*6000//CANVAS})")
