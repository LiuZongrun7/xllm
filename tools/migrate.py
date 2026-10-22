"""
增量迁移 —— 把已有数据库补到当前模型

背景：M1 建库时只有 users / email_codes 两张表，业务表是随功能加进来的。
    db.create_all() 只能【建缺失的表】，不会给已有表加字段，
    所以字段级的补充要靠这个脚本。

用法
    # 本地
    cd server
    DATABASE_URL=sqlite:///$(pwd)/dev.db ../.venv/bin/python ../tools/migrate.py

    # 服务器（先把 .env 读进环境，否则会连到默认库）
    cd /home/ubuntu/xllm/server
    set -a; . ../.env; set +a
    ../.venv/bin/python ../tools/migrate.py

特性
    · 只加不删：不 DROP 任何列/表，重复执行安全
    · 兼容 MySQL 与 SQLite（自己查 information_schema / PRAGMA）
    · 执行前打印当前缺什么，执行后逐条打印结果
"""

from __future__ import annotations

import sys
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent / "server"
sys.path.insert(0, str(SERVER_DIR))

from sqlalchemy import inspect, text                      # noqa: E402

from app import create_app                                 # noqa: E402
from shared.extensions import db                            # noqa: E402
from shared import models  # noqa: F401                    # noqa: E402

# (表, 列, MySQL 类型, SQLite 类型)
COLUMNS = [
    ("restaurants", "cuisine", "VARCHAR(30) NULL", "VARCHAR(30)"),
    ("restaurants", "max_concurrent_orders", "INT NOT NULL DEFAULT 20", "INTEGER NOT NULL DEFAULT 20"),
    ("restaurants", "avg_prep_minutes", "INT NOT NULL DEFAULT 20", "INTEGER NOT NULL DEFAULT 20"),
    ("orders", "preparing_at", "DATETIME NULL", "DATETIME"),
    ("orders", "delay_flagged_at", "DATETIME NULL", "DATETIME"),
    ("orders", "delay_reason", "VARCHAR(100) NULL", "VARCHAR(100)"),
    ("orders", "address_updated_at", "DATETIME NULL", "DATETIME"),
]


def _existing_columns(inspector, table: str) -> set[str]:
    try:
        return {column["name"] for column in inspector.get_columns(table)}
    except Exception:                                          # 表不存在
        return set()


def main() -> None:
    app = create_app()
    with app.app_context():
        inspector = inspect(db.engine)
        before = {name for name in inspector.get_table_names()}
        print(f"[migrate] database      : {db.engine.url.render_as_string(hide_password=True)}")
        print(f"[migrate] tables before : {len(before)}")

        # 1) 缺失的表（rider_profiles 等）由 create_all 负责
        db.create_all()
        after = {name for name in inspect(db.engine).get_table_names()}
        created = sorted(after - before)
        print(f"[migrate] tables after  : {len(after)}"
              f"{'  (created: ' + ', '.join(created) + ')' if created else ''}")

        # 2) 已有表的缺失字段
        inspector = inspect(db.engine)
        is_sqlite = db.engine.dialect.name == "sqlite"
        applied = 0
        for table, column, mysql_type, sqlite_type in COLUMNS:
            columns = _existing_columns(inspector, table)
            if not columns:
                print(f"[migrate] skip {table}.{column}: table missing")
                continue
            if column in columns:
                print(f"[migrate] ok   {table}.{column}")
                continue
            ddl = sqlite_type if is_sqlite else mysql_type
            db.session.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{column}` {ddl}"))
            db.session.commit()
            applied += 1
            print(f"[migrate] add  {table}.{column}")

        print(f"[migrate] done — {applied} column(s) added, {len(created)} table(s) created")


if __name__ == "__main__":
    main()
