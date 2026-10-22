"""
健康检查 / 环境自检

这些接口不承载业务，只用来确认部署链路是否正常。出问题时先打这几个，
能快速定位是哪一层挂了（nginx / gunicorn / Flask / MySQL）。
"""

import os
import platform
import socket
from datetime import datetime, timezone

import flask
from flask import Blueprint, jsonify
from sqlalchemy import text

from shared.extensions import db

bp = Blueprint("health", __name__, url_prefix="/api")

SERVICE_NAME = "xllm-food-delivery"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# GET /api/ping  —— 只证明 nginx → gunicorn → Flask 通了
# ---------------------------------------------------------------------------
@bp.get("/ping")
def ping():
    return jsonify(
        status="ok",
        service=SERVICE_NAME,
        message="pong",
        time=_now(),
        host=socket.gethostname(),
        pid=os.getpid(),
    )


# ---------------------------------------------------------------------------
# GET /api/whoami  —— 确认跑的是哪个解释器、哪个 Flask
# 排查"本地能跑服务器报错"时先看这个
# ---------------------------------------------------------------------------
@bp.get("/whoami")
def whoami():
    return jsonify(
        status="ok",
        service=SERVICE_NAME,
        python=platform.python_version(),
        flask=flask.__version__,
        executable=os.sys.executable,
        cwd=os.getcwd(),
        time=_now(),
    )


# ---------------------------------------------------------------------------
# GET /api/db-ping  —— 证明 Flask ↔ MySQL 通了
# ---------------------------------------------------------------------------
@bp.get("/db-ping")
def db_ping():
    try:
        row = (
            db.session.execute(
                text("SELECT VERSION() AS version, DATABASE() AS db_name, NOW() AS server_time")
            )
            .mappings()
            .one()
        )
        # datetime 不能直接 JSON 序列化，统一转字符串
        return jsonify(status="ok", database={k: str(v) for k, v in row.items()})

    except Exception as exc:
        # 不要在生产环境把原始异常抛给前端 —— 里面可能带连接串和密码。
        # 这里只回类型和简短信息，详细信息看 journalctl。
        return (
            jsonify(
                status="error",
                error=type(exc).__name__,
                hint="检查 .env 里的 DB_* 配置，以及 MySQL 是否在跑",
            ),
            500,
        )
