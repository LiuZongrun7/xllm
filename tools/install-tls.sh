#!/usr/bin/env bash
# =============================================================================
#  安装三个子域名的证书并启用 nginx 站点
#
#      ./tools/install-tls.sh                    # 默认从 ~/Downloads 找 CA 给的 zip
#      ./tools/install-tls.sh ~/Downloads        # 指定目录
#
#  它做四件事，每步都可以重复跑（幂等）：
#
#      1. 在本地解开 CA 给的 nginx 证书包，校验证书和私钥是一对、SAN 对得上域名
#      2. 传到服务器，装进 /etc/nginx/ssl/<域名>/{fullchain.pem,privkey.key}
#      3. 装 nginx 站点配置 + snippet，软链到 sites-enabled，nginx -t 通过才 reload
#      4. 用 curl 走一遍三个域名，打印实际生效的证书和跳转
#
#  ⚠️ 私钥永远不进 Git。本脚本只从本地目录读、直接 scp 到服务器，
#     仓库里只有 nginx 配置（deploy/nginx/），没有任何证书文件。
#
#  ⚠️ 证书有效期 90 天（TrustAsia DV）。到期前重新申请，再跑一遍本脚本即可，
#     不需要改任何代码。
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${1:-$HOME/Downloads}"
SSH_HOST="${XLLM_SSH:-xllm}"

HOSTS=(customer.xllm.cloud restaurant.xllm.cloud delivery.xllm.cloud)

say() { printf '\033[1m[%s]\033[0m %s\n' "$1" "$2"; }
die() { printf '\033[1;31m[error]\033[0m %s\n' "$1" >&2; exit 1; }

[ -d "$SRC" ] || die "找不到目录: $SRC"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ---------------------------------------------------------------------------
# 1. 本地解包 + 校验
# ---------------------------------------------------------------------------
say 1 "解包并校验证书（$SRC）"
for host in "${HOSTS[@]}"; do
  zip="$SRC/${host}_nginx.zip"
  [ -f "$zip" ] || die "缺少 $host 的证书包: $zip"

  mkdir -p "$WORK/$host"
  unzip -q -o "$zip" -d "$WORK/$host"

  # CA 给的目录结构是 <host>_nginx/<host>.key|.crt|.pem，用 find 免得依赖层级
  crt="$(find "$WORK/$host" -name '*_bundle.pem' -o -name '*_bundle.crt' | head -1)"
  key="$(find "$WORK/$host" -name '*.key' | head -1)"
  [ -n "$crt" ] && [ -f "$crt" ] || die "$host: 包里没找到 .pem/.crt"
  [ -n "$key" ] && [ -f "$key" ] || die "$host: 包里没找到 .key"

  # 证书必须包含这个域名，否则浏览器照样报警
  openssl x509 -in "$crt" -noout -checkhost "$host" | grep -q "does match" \
    || die "$host: 证书的 SAN 不包含这个域名"

  # 私钥和证书必须是一对（比 modulus 最直接）
  a="$(openssl x509 -in "$crt" -noout -modulus | openssl md5)"
  b="$(openssl rsa  -in "$key" -noout -modulus 2>/dev/null | openssl md5)"
  [ "$a" = "$b" ] || die "$host: 私钥和证书不匹配"

  expiry="$(openssl x509 -in "$crt" -noout -enddate | cut -d= -f2)"
  say ok "$host —— 到期 $expiry"

  # 统一命名，服务器上只有这两个文件
  cp "$crt" "$WORK/$host/fullchain.pem"
  cp "$key" "$WORK/$host/privkey.key"
done

# ---------------------------------------------------------------------------
# 2. 上传 + 安装证书
# ---------------------------------------------------------------------------
say 2 "上传证书并安装到 /etc/nginx/ssl/"
tar -C "$WORK" -czf "$WORK/certs.tar.gz" \
    $(for h in "${HOSTS[@]}"; do printf '%s/fullchain.pem %s/privkey.key ' "$h" "$h"; done)

scp -q "$WORK/certs.tar.gz" "$SSH_HOST:/tmp/xllm-certs.tar.gz"
ssh "$SSH_HOST" "set -e
  rm -rf /tmp/xllm-certs && mkdir -p /tmp/xllm-certs
  tar -C /tmp/xllm-certs -xzf /tmp/xllm-certs.tar.gz
  for h in ${HOSTS[*]}; do
    sudo install -d -m 755 /etc/nginx/ssl/\$h
    sudo install -m 644 -o root -g root /tmp/xllm-certs/\$h/fullchain.pem /etc/nginx/ssl/\$h/fullchain.pem
    sudo install -m 600 -o root -g root /tmp/xllm-certs/\$h/privkey.key   /etc/nginx/ssl/\$h/privkey.key
  done
  rm -rf /tmp/xllm-certs /tmp/xllm-certs.tar.gz
  echo '  已安装: /etc/nginx/ssl/{customer,restaurant,delivery}.xllm.cloud/'"

# ---------------------------------------------------------------------------
# 3. 装 nginx 配置（先备份，nginx -t 不过就不 reload）
# ---------------------------------------------------------------------------
say 3 "安装 nginx 站点配置"
scp -q "$ROOT/deploy/nginx/xllm-subdomains.conf" "$SSH_HOST:/tmp/xllm-subdomains.conf"
scp -q "$ROOT/deploy/nginx/snippets/xllm-proxy.conf" "$ROOT/deploy/nginx/snippets/xllm-tls.conf" \
       "$SSH_HOST:/tmp/"

ssh "$SSH_HOST" "set -e
  sudo install -d -m 755 /etc/nginx/snippets
  sudo cp /tmp/xllm-proxy.conf /tmp/xllm-tls.conf /etc/nginx/snippets/
  if [ -f /etc/nginx/sites-available/xllm-subdomains ]; then
    sudo cp -a /etc/nginx/sites-available/xllm-subdomains \
                /etc/nginx/sites-available/xllm-subdomains.bak.\$(date +%Y%m%d-%H%M%S)
  fi
  sudo install -m 644 /tmp/xllm-subdomains.conf /etc/nginx/sites-available/xllm-subdomains
  sudo ln -sfn /etc/nginx/sites-available/xllm-subdomains /etc/nginx/sites-enabled/xllm-subdomains
  rm -f /tmp/xllm-subdomains.conf /tmp/xllm-proxy.conf /tmp/xllm-tls.conf
  sudo nginx -t
  sudo systemctl reload nginx
  echo '  nginx reloaded'"

# ---------------------------------------------------------------------------
# 4. 验收
# ---------------------------------------------------------------------------
say 4 "验收"
printf '  %-26s %-10s %-8s %s\n' HOST /api/ping '/' '根路径跳到'
for host in "${HOSTS[@]}"; do
  api="$(curl -sS -o /dev/null -m 15 -w '%{http_code}' "https://$host/api/ping" || echo ERR)"
  code="$(curl -sS -o /dev/null -m 15 -w '%{http_code}' "https://$host/" || echo ERR)"
  to="$(curl -s "-o" /dev/null -m 15 -w '%{redirect_url}' "https://$host/" 2>/dev/null || true)"
  printf '  %-26s %-10s %-8s %s\n' "$host" "$api" "$code" "${to#https://}"
done

echo
say ok "证书链（样本：customer.xllm.cloud）"
echo | openssl s_client -servername customer.xllm.cloud -connect customer.xllm.cloud:443 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates 2>/dev/null | sed 's/^/  /' \
  || echo "  （openssl s_client 检查跳过）"

echo
say done "三端域名就绪 —— customer / restaurant / delivery .xllm.cloud"
