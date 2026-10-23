#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
结构图的中文版

做法很轻：不复制 make_structure.py 的排版逻辑，只把英文 SVG 里每个
<text> 节点的文字换成中文，再换掉字体回退链（中文交给 PingFang SC）。
坐标、框、箭头全部沿用英文版，所以两张图的布局完全一致。

用法:
    python3 make_structure.py          # 先有 structure.svg
    python3 make_structure_zh.py       # 生成 structure-zh.svg
    node svg2png.js ... structure-zh.svg structure-zh.png 85 90 1385 1115
"""

import re
from pathlib import Path

# 只替换“整个 <text> 节点内容正好等于 key”的情况，
# 避免把 SQLAlchemy 里的 SQL、browser 里的 brow… 之类误伤。
ZH = {
    "Customer interface": "顾客端界面",
    "Restaurant interface": "商家端界面",
    "Rider interface": "骑手端界面",
    "browser": "浏览器",
    "nginx  (reverse proxy, TLS)": "nginx（反向代理，TLS）",
    "pages + /api  →  application server": "页面与 /api → 应用服务器",
    "gunicorn  (WSGI server)": "gunicorn（WSGI 服务器）",
    "Flask application": "Flask 应用",
    "auth": "认证",
    "sessions, roles": "会话、角色",
    "restaurants": "商家",
    "menu, hours": "菜单、营业时间",
    "orders": "订单",
    "state machine": "状态机",
    "riders": "骑手",
    "pool, position": "抢单池、位置",
    "reviews": "评价",
    "ratings": "评分",
    "Shared data access layer (SQLAlchemy models, ownership checks)":
        "共享数据访问层（SQLAlchemy 模型、归属校验）",
    "12 records (InnoDB)": "12 条记录（InnoDB）",
    "Amap (map service)": "高德（地图服务）",
    "address picker / map display": "选点、地图展示",
    "SMTP mail service": "SMTP 邮件服务",
    "password recovery": "验证码、找回密码",
    "http (loopback)": "http（本机回环）",
    "map JS API": "地图 JS API",
    "user request / response": "用户请求 / 响应",
    "call to storage or an external service": "对存储或外部服务的调用",
}

# 中文字重与英文不同，显式给出中文字体优先的回退链
FONT_ZH = "PingFang SC, Hiragino Sans GB, Helvetica Neue, Helvetica, Arial, sans-serif"


def main() -> None:
    src = Path("structure.svg").read_text(encoding="utf-8")
    out, hits = src, 0

    for english, chinese in ZH.items():
        pattern = re.compile(r">" + re.escape(english) + r"<")
        out, n = pattern.subn(">" + chinese + "<", out)
        hits += n

    out = out.replace(
        "Helvetica Neue, Helvetica, Arial, sans-serif", FONT_ZH
    )
    Path("structure-zh.svg").write_text(out, encoding="utf-8")
    print(f"已生成 structure-zh.svg（替换 {hits} 处文字）")


if __name__ == "__main__":
    main()
