"""
通用小工具：统一 JSON 响应格式 + 参数校验

响应格式固定为：
    成功  {"ok": true,  "data": {...}}
    失败  {"ok": false, "error": "人类可读的原因"}
这样前端只需要判断 ok 一个字段。
"""

import re

from flask import jsonify, request

# 邮箱：宽松校验，真正的有效性靠发信验证
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
# 用户名：3-40 位，字母 / 数字 / 下划线 / 汉字
USERNAME_RE = re.compile(r"^[\w\u4e00-\u9fa5]{3,40}$")


def ok(data=None, status=200, **extra):
    payload = {"ok": True}
    if data is not None:
        payload["data"] = data
    payload.update(extra)
    return jsonify(payload), status


def err(message: str, status: int = 400, **extra):
    payload = {"ok": False, "error": message}
    payload.update(extra)
    return jsonify(payload), status


def body() -> dict:
    """取 JSON 请求体；不是 JSON 或为空时返回 {}，不会抛异常"""
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def clean(value, max_len: int | None = None) -> str:
    s = "" if value is None else str(value).strip()
    return s[:max_len] if max_len else s
