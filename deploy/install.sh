#!/usr/bin/env bash
#
# Koden VPS installer/updater. Run as root on a fresh (or existing) Debian/
# Ubuntu VPS. Once this script is on `main` (i.e. once the PR that added it
# has merged):
#
#   curl -fsSL https://raw.githubusercontent.com/2E0LXY/Koden/main/deploy/install.sh | bash
#
# Until then, the code only lives on its feature branch, so pass REPO_REF
# explicitly (see deploy/README.md for the exact command). Or, from a clone
# you already have on the box:
#
#   sudo bash deploy/install.sh
#
# It is idempotent: re-running it pulls the latest code, rebuilds, and
# restarts services, so it doubles as the update script.
#
# Configuration (all optional, set as env vars before running):
#   REPO_URL   - git remote to deploy from (default: this repo, HTTPS)
#   REPO_REF   - branch/tag/commit to deploy (default: main)
#   INSTALL_DIR- where the app lives on disk (default: /opt/koden)
#   ADDR       - public hostname or IP Caddy will serve on (default:
#                auto-detected public IP). No DNS name is required: without
#                one, Caddy issues itself a locally-trusted self-signed
#                certificate ("tls internal") instead of a real Let's
#                Encrypt one, since ACME cannot issue public certs for bare
#                IP addresses. Browsers will show a one-time security
#                warning to click through -- after that, mic access works
#                normally, because HTTPS (even self-signed) counts as a
#                secure context.
#   NODE_MAJOR - Node.js major version to install (default: 22)
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root (e.g. sudo bash deploy/install.sh)." >&2
  exit 1
fi

REPO_URL="${REPO_URL:-https://github.com/2E0LXY/Koden.git}"
REPO_REF="${REPO_REF:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/koden}"
NODE_MAJOR="${NODE_MAJOR:-22}"
SERVICE_USER="koden"
NODE_PORT="8787"

log() { echo -e "\n\033[1;36m==> $*\033[0m"; }

log "Detecting public address"
if [[ -z "${ADDR:-}" ]]; then
  ADDR="$(curl -fsS4 --max-time 5 https://api.ipify.org || curl -fsS4 --max-time 5 https://ifconfig.me || true)"
fi
if [[ -z "$ADDR" ]]; then
  echo "Could not auto-detect a public IP. Re-run with ADDR=<your-ip-or-domain> set." >&2
  exit 1
fi
echo "Serving on: $ADDR"

log "Installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg git ufw

if ! command -v node >/dev/null || [[ "$(node -v | sed -E 's/^v([0-9]+).*/\1/')" -lt "$NODE_MAJOR" ]]; then
  log "Installing Node.js ${NODE_MAJOR}.x"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

if ! command -v caddy >/dev/null; then
  log "Installing Caddy"
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi
caddy version

if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  log "Creating system user '$SERVICE_USER'"
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

log "Fetching Koden ($REPO_REF) into $INSTALL_DIR"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$REPO_REF"
  git -C "$INSTALL_DIR" checkout -f FETCH_HEAD
else
  rm -rf "$INSTALL_DIR"
  git clone --branch "$REPO_REF" --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

ensure_build_swap() {
  local mem_kb swap_kb
  mem_kb="$(awk '/MemTotal:/ {print $2}' /proc/meminfo)"
  swap_kb="$(awk '/SwapTotal:/ {print $2}' /proc/meminfo)"
  # tsc/vite can use well over 1GB during the build; on a small VPS with
  # little or no swap, the kernel OOM-killer takes the build out instead
  # (exit code 137). Give it enough swap headroom to finish.
  if (( mem_kb + swap_kb >= 2 * 1024 * 1024 )); then
    return
  fi
  log "Low memory (~$((mem_kb / 1024))MB RAM, ~$((swap_kb / 1024))MB swap) -- adding a 2G swap file so the build doesn't get OOM-killed"
  if [[ ! -f /swapfile ]]; then
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile 2>/dev/null || true
  grep -q '^/swapfile ' /etc/fstab 2>/dev/null || echo '/swapfile none swap sw 0 0' >> /etc/fstab
}

log "Installing dependencies and building"
cd "$INSTALL_DIR"
ensure_build_swap
npm install
npm run build --workspace=packages/shared
npm run build --workspace=packages/server

# The client needs to know the server's WebSocket URL at build time. Caddy
# fronts everything on 443 and reverse-proxies /ws to the Node server, so
# the browser only ever talks to $ADDR.
VITE_SERVER_WS_URL="wss://${ADDR}/ws" npm run build --workspace=packages/client

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

log "Writing systemd service"
cat > /etc/systemd/system/koden-server.service <<EOF
[Unit]
Description=Koden virtual HF transceiver server
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}/packages/server
ExecStart=$(command -v node) dist/index.js
Environment=PORT=${NODE_PORT}
Environment=NODE_ENV=production
Restart=on-failure
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

log "Writing Caddyfile"
cat > /etc/caddy/Caddyfile <<EOF
${ADDR} {
	tls internal

	handle /ws {
		reverse_proxy 127.0.0.1:${NODE_PORT}
	}

	handle /health {
		reverse_proxy 127.0.0.1:${NODE_PORT}
	}

	handle {
		root * ${INSTALL_DIR}/packages/client/dist
		encode gzip
		try_files {path} /index.html
		file_server
	}
}
EOF

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  log "Opening firewall ports 80/443"
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
fi

log "Starting services"
systemctl daemon-reload
systemctl enable --now koden-server
systemctl restart koden-server
systemctl enable --now caddy
systemctl restart caddy

log "Done"
echo "Koden should now be reachable at: https://${ADDR}/"
echo "The certificate is self-signed (no domain name was used) -- accept the"
echo "one-time browser warning; the page will still be a secure context, so"
echo "microphone access works normally afterwards."
echo
echo "Logs:      journalctl -u koden-server -f"
echo "Caddy log: journalctl -u caddy -f"
echo "Re-run this script any time to pull and deploy the latest ${REPO_REF}."
