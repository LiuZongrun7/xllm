#!/usr/bin/env bash
# =============================================================================
#  部署脚本
#
#      ./tools/deploy.sh                 # 推代码并重启（日常）
#      ./tools/deploy.sh --migrate       # 先迁移数据库结构，再重启
#      ./tools/deploy.sh --migrate --seed  # 迁移 + 灌演示数据（⚠️ 会改线上数据）
#
#  前提：本地 git 远端里有一个叫 server 的远端，指向服务器的裸仓库：
#      git remote add server xllm:/home/ubuntu/xllm.git
#
#  为什么不用「服务器自己 clone GitHub」：那台机器访问 GitHub 会挂死，
#  详见 docs/部署说明.md §5.2。
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MIGRATE=0
SEED=0
for arg in "$@"; do
  case "$arg" in
    --migrate) MIGRATE=1 ;;
    --seed)    SEED=1; MIGRATE=1 ;;
    *) echo "unknown option: $arg"; exit 2 ;;
  esac
done

if [ -n "$(git status --porcelain)" ]; then
  echo "[deploy] working tree is dirty — commit first"; exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "[deploy] pushing $BRANCH to server ..."
git push server "$BRANCH"
echo "[deploy] pushing $BRANCH to origin (GitHub archive) ..."
git push origin "$BRANCH" || echo "[deploy] ⚠️ GitHub push failed — the deploy itself already happened"

if [ "$MIGRATE" -eq 1 ]; then
  echo "[deploy] migrating database ..."
  ssh xllm 'cd /home/ubuntu/xllm/server && set -a && . ../.env && set +a && \
            ../.venv/bin/python ../tools/migrate.py'
fi

if [ "$SEED" -eq 1 ]; then
  echo "[deploy] seeding demo data ..."
  ssh xllm 'cd /home/ubuntu/xllm/server && set -a && . ../.env && set +a && \
            ../.venv/bin/python -m shared.seed'
fi

echo "[deploy] restarting service ..."
ssh xllm 'sudo -n systemctl restart xllm && systemctl is-active xllm'

echo "[deploy] health check ..."
curl -s -o /dev/null -w '  /api/ping        %{http_code}\n' https://xllm.cloud/api/ping
curl -s -o /dev/null -w '  /info/           %{http_code}\n' https://xllm.cloud/info/
curl -s -o /dev/null -w '  /  (→ /info/)    %{http_code}\n' https://xllm.cloud/
curl -s -o /dev/null -w '  /api/db-ping     %{http_code}\n' https://xllm.cloud/api/db-ping
curl -s -o /dev/null -w '  /customer/       %{http_code}\n' https://xllm.cloud/customer/
curl -s -o /dev/null -w '  /merchant/login  %{http_code}\n' https://xllm.cloud/merchant/login
curl -s -o /dev/null -w '  /rider/login     %{http_code}\n' https://xllm.cloud/rider/login
echo "[deploy] done"
