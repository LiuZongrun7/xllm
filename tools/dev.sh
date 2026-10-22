#!/usr/bin/env bash
# =============================================================================
#  本地一键运行（SQLite，不需要 MySQL）
#
#      ./tools/dev.sh              # 首次会建 .venv、装依赖、灌演示数据，然后起服务
#      ./tools/dev.sh --reset      # 重建数据（会清空本地 dev.db）
#      PORT=8081 ./tools/dev.sh    # 换端口
#
#  演示账号：alex / goldenwok / chen，密码都是 demo1234
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VENV="$ROOT/.venv"
DB="$ROOT/server/dev.db"
PORT="${PORT:-8080}"
PY="$VENV/bin/python"

if [ ! -x "$PY" ]; then
  echo "[dev] creating virtualenv ..."
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q -r server/requirements.txt
fi

export DATABASE_URL="sqlite:///$DB"

if [ "${1:-}" = "--reset" ] || [ ! -f "$DB" ]; then
  echo "[dev] seeding $DB ..."
  (cd server && "$PY" -m shared.seed --reset)
fi

echo "[dev] http://127.0.0.1:$PORT"
echo "[dev]   customer  /customer/   alex        / demo1234"
echo "[dev]   merchant  /merchant/   goldenwok   / demo1234"
echo "[dev]   rider     /rider/      chen        / demo1234"
cd server
PORT="$PORT" FLASK_DEBUG=1 exec "$PY" app.py
