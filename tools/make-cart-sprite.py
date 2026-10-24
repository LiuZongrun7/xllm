#!/usr/bin/env python3
"""
把生成的"四帧购物车"切成一张规整的精灵图

    ~/dev/aiagent/ppt_review/.venv/bin/python tools/make-cart-sprite.py \
        /tmp/stickers/cart-sprite.jpg server/customer/static/img/cart-sprite.webp

为什么要切
    模型给的四个图标虽然画风一致，但位置和大小是随手摆的。
    直接按四等分切，动画会左右乱跳。所以这里：
      1. 抠掉绿幕（复用 cutout-green 的判据）
      2. 按透明度在 x 轴的投影找出四个图标
      3. 每个缩放到同样宽度、底边对齐到同一条基线
      4. 第三帧（弹起）整体上移一点，才看得出"跳"
    最后拼成 4 格等宽精灵图，前端用 CSS 逐步换 background-position 播放。
"""

import sys
from pathlib import Path

try:
    from PIL import Image, ImageChops
except ImportError:
    sys.exit("✗ 没有 Pillow。用 ~/dev/aiagent/ppt_review/.venv/bin/python 跑。")

TOL = 22          # G 比 R、B 各高出这么多就算背景
CELL = 256        # 每格尺寸
FILL_W = 0.78     # 图标宽度占格子的比例
BASELINE = 0.90   # 底边落在格子的这个高度
JUMP_LIFT = 0.10  # 第三帧往上抬多少


def key_alpha(img):
    r, g, b = img.split()
    gr = ImageChops.subtract(g, r).point(lambda v: 255 if v > TOL else 0)
    gb = ImageChops.subtract(g, b).point(lambda v: 255 if v > TOL else 0)
    green = ImageChops.multiply(gr, gb)
    alpha = ImageChops.invert(green)
    limit = ImageChops.lighter(r, b)
    rgb = Image.merge("RGB", (r, ImageChops.darker(g, limit), b))
    out = rgb.convert("RGBA")
    out.putalpha(alpha.filter(__import__("PIL.ImageFilter", fromlist=["MinFilter"]).MinFilter(5)))
    return out


def columns_mask(img):
    w, h = img.size
    a = img.split()[3]
    cols = [0] * w
    px = a.load()
    for x in range(w):
        n = 0
        for y in range(0, h, 3):
            if px[x, y] > 40:
                n += 1
        cols[x] = n
    return cols


def main():
    if len(sys.argv) != 3:
        sys.exit("用法：make-cart-sprite.py <输入图> <输出.webp>")
    src, dst = sys.argv[1], sys.argv[2]

    img = key_alpha(Image.open(src).convert("RGB"))
    cols = columns_mask(img)

    # 找出四段连续的非空列
    segments, start = [], None
    for x, n in enumerate(cols):
        if n > 2 and start is None:
            start = x
        elif n <= 2 and start is not None:
            segments.append((start, x))
            start = None
    if start is not None:
        segments.append((start, len(cols)))
    segments = [s for s in segments if s[1] - s[0] > 40]
    if len(segments) != 4:
        sys.exit(f"✗ 找到 {len(segments)} 个图标（期望 4 个）：{segments}")

    cells = []
    for index, (x0, x1) in enumerate(segments):
        strip = img.crop((x0, 0, x1, img.size[1]))
        bbox = strip.getbbox()
        if not bbox:
            sys.exit(f"✗ 第 {index + 1} 个图标是空的")
        icon = strip.crop(bbox)

        target_w = int(CELL * FILL_W)
        scale = target_w / icon.size[0]
        icon = icon.resize((target_w, max(1, round(icon.size[1] * scale))), Image.LANCZOS)

        cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        left = (CELL - icon.size[0]) // 2
        top = int(CELL * BASELINE) - icon.size[1]
        if index == 2:                       # 弹起那一帧
            top -= int(CELL * JUMP_LIFT)
        cell.alpha_composite(icon, (left, top))
        cells.append(cell)

    sheet = Image.new("RGBA", (CELL * 4, CELL), (0, 0, 0, 0))
    for i, cell in enumerate(cells):
        sheet.alpha_composite(cell, (i * CELL, 0))
    sheet.save(dst, quality=88, method=6)
    print(f"[cart-sprite] {sheet.size[0]}x{sheet.size[1]} → {dst}")


if __name__ == "__main__":
    main()
