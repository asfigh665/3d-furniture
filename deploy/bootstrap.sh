#!/usr/bin/env bash
set -euo pipefail
if [[ $EUID -ne 0 || $# -ne 2 ]]; then
  echo 'Usage: sudo bash bootstrap.sh /tmp/furniture-release.tar.gz RELEASE_ID' >&2
  exit 1
fi
archive=$(realpath "$1")
release_id=$2
[[ "$release_id" =~ ^[a-zA-Z0-9._-]+$ ]] || exit 1
base=/opt/3d-furniture
release="$base/releases/$release_id"
node_version=v24.15.0
node_name="node-$node_version-linux-x64"
install -d -m 755 "$base/releases" "$base/runtime" /etc/3d-furniture /var/www/furniture-acme
if ! id furniture >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/3d-furniture --shell /usr/sbin/nologin furniture
fi
install -d -o furniture -g furniture -m 700 /var/lib/3d-furniture
if [[ ! -x "$base/runtime/$node_name/bin/node" ]]; then
  runtime_tmp=$(mktemp -d)
  trap 'rm -rf -- "$runtime_tmp"' EXIT
  curl --fail --location --retry 3 "https://nodejs.org/dist/$node_version/$node_name.tar.xz" -o "$runtime_tmp/$node_name.tar.xz"
  curl --fail --location --retry 3 "https://nodejs.org/dist/$node_version/SHASUMS256.txt" -o "$runtime_tmp/SHASUMS256.txt"
  (cd "$runtime_tmp" && grep " $node_name.tar.xz$" SHASUMS256.txt | sha256sum --check --status)
  tar -xJf "$runtime_tmp/$node_name.tar.xz" -C "$base/runtime"
fi
ln -sfn "$base/runtime/$node_name" "$base/runtime/node"
if [[ -e "$release" ]]; then
  echo "Release already exists: $release" >&2
  exit 1
fi
install -d -m 755 "$release"
tar -xzf "$archive" -C "$release"
export PATH="$base/runtime/node/bin:$PATH"
(cd "$release" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
chmod -R a+rX "$release"
if [[ ! -f /etc/3d-furniture/furniture.env ]]; then
  umask 077
  cat > /etc/3d-furniture/furniture.env <<'ENV'
PORT=8787
DATA_DIRECTORY=/var/lib/3d-furniture
ALLOWED_ORIGINS=https://furniture.zhenpinfa.cn,http://furniture.zhenpinfa.cn
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-flash
AI_THINKING=disabled
AI_API_KEY=
ENV
fi
install -m 644 "$release/deploy/furniture.service" /etc/systemd/system/furniture.service
install -m 755 "$release/deploy/furniture-set-api-key" /usr/local/sbin/furniture-set-api-key
install -m 755 "$release/deploy/furniture-enable-https" /usr/local/sbin/furniture-enable-https
install -m 644 "$release/deploy/furniture-https.service" /etc/systemd/system/furniture-https.service
install -m 644 "$release/deploy/furniture-https.timer" /etc/systemd/system/furniture-https.timer
ln -sfn "$release" "$base/current"
if [[ ! -e /etc/nginx/sites-available/furniture.conf ]]; then
  install -m 644 "$release/deploy/furniture.nginx.conf" /etc/nginx/sites-available/furniture.conf
fi
ln -sfn /etc/nginx/sites-available/furniture.conf /etc/nginx/sites-enabled/furniture.conf
nginx -t
systemctl daemon-reload
systemctl enable furniture
systemctl enable --now furniture-https.timer
systemctl restart furniture
systemctl reload nginx
for attempt in {1..20}; do
  if curl --silent --fail http://127.0.0.1:8787/api/health; then
    printf '\nRelease %s is ready.\n' "$release_id"
    exit 0
  fi
  sleep 1
done
journalctl -u furniture -n 30 --no-pager
exit 1
