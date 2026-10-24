#!/usr/bin/env python3
"""
给静态图生成缩略版（-sm.jpg），顺手把体积从 200KB+ 降到 30KB 上下

    ~/dev/aiagent/ppt_review/.venv/bin/python tools/make-derivatives.py

为什么需要
    页面上一张 68px 的分类图标、一个 76px 的菜品缩略图，现在拿的都是
    1024×1024 或 1536×1024 的原图（200–300KB）。一屏 8 张图就是 1.5MB。

规则
    - 长边缩到 480px，JPEG 质量 78 —— 430pt 宽的手机上 2x 也够
    - 输出 <名字>-sm.jpg，原图不动（详情页头图、官网样机还要用）
    - 源文件比缩略图新才重做，所以可以反复跑

⚠️ 只用 Pillow；本机 xLLM 的 venv 里没有，借 aiagent 的那个。
"""

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("✗ 没有 Pillow。用 ~/dev/aiagent/ppt_review/.venv/bin/python 跑这个脚本。")

ROOT = Path(__file__).resolve().parent.parent
TARGETS = [ROOT / "server" / "static" / "img", ROOT / "server" / "customer" / "static" / "img",
           ROOT / "server" / "rider" / "static" / "img", ROOT / "server" / "merchant" / "static" / "img",
           ROOT / "server" / "info" / "static" / "img"]
LONG_EDGE = 480
QUALITY = 78
# 只处理 JPEG/PNG：贴纸、券底板这些是带 alpha 的 WebP，本身就不是缩略图用的
EXTS = {".jpg", ".jpeg", ".png"}


def main() -> int:
    made = skipped = 0
    for base in TARGETS:
        if not base.exists():
            continue
        for src in sorted(base.rglob("*")):
            if src.suffix.lower() not in EXTS or src.name.endswith("-sm.jpg"):
                continue
            if "_candidates" in src.parts:
                continue
            dst = src.with_name(src.stem + "-sm.jpg")
            if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
                skipped += 1
                continue
            with Image.open(src) as im:
                im = im.convert("RGB")
                w, h = im.size
                scale = LONG_EDGE / max(w, h)
                if scale < 1:
                    im = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
                im.save(dst, "JPEG", quality=QUALITY, optimize=True, progressive=True)
            made += 1
    print(f"[derivatives] 生成 {made} 张，跳过 {skipped} 张")
    return 0


if __name__ == "__main__":
    sys.exit(main())
