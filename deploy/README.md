# Deploying Koden to a VPS

`install.sh` sets up a complete, self-contained deployment on a fresh
Debian/Ubuntu VPS: Node.js, the Koden server as a `systemd` service, and
[Caddy](https://caddyfile.dev/) as a reverse proxy/static file server in
front of it. It's idempotent -- run it again any time to pull the latest
code, rebuild, and restart everything, so it's also the update script.

## Why Caddy

- Terminates HTTPS and reverse-proxies `/ws` (WebSocket) to the Node server,
  so the browser only ever talks to one host on port 443.
- Serves the built client as static files with SPA fallback.
- If you point it at a real domain name, it gets you a real Let's Encrypt
  certificate automatically, no extra config.
- If you only have a bare IP (no domain), Let's Encrypt can't issue a
  certificate for it -- Caddy instead falls back to `tls internal`, which
  self-signs one. **Microphone access requires a secure context (HTTPS)**,
  and a self-signed certificate still satisfies that; browsers just show a
  one-time "connection is not private" warning to click through first.

## Usage

On the VPS, as root:

```bash
# Right now, before this PR is merged, the code only exists on its feature
# branch, so tell the script to deploy from there:
REPO_REF=claude/virtual-amateur-radio-transceiver-n1xm70 bash -c "$(curl -fsSL https://raw.githubusercontent.com/2E0LXY/Koden/claude/virtual-amateur-radio-transceiver-n1xm70/deploy/install.sh)"

# Once merged to main, it's just:
curl -fsSL https://raw.githubusercontent.com/2E0LXY/Koden/main/deploy/install.sh | bash
```

Or, if you already have a clone on the box:

```bash
sudo bash deploy/install.sh
```

When it finishes it prints the URL to open (`https://<your-ip>/`).

## Configuration

All optional, set as environment variables before running:

| Variable      | Default                          | Meaning |
|---------------|-----------------------------------|---------|
| `REPO_URL`    | this repo, HTTPS                  | Git remote to deploy from |
| `REPO_REF`    | `main`                            | Branch/tag/commit to deploy |
| `ADDR`        | auto-detected public IP           | Hostname or IP Caddy serves on and the client connects its WebSocket to |
| `INSTALL_DIR` | `/opt/koden`                      | Where the app lives on disk |
| `NODE_MAJOR`  | `22`                               | Node.js major version to install |

If you have a real domain pointed at the VPS, set `ADDR=your.domain.com` to
get a proper trusted certificate instead of the self-signed fallback.

## What it sets up

- A dedicated, unprivileged `koden` system user.
- `/etc/systemd/system/koden-server.service` running
  `node dist/index.js` from `packages/server`, bound to `127.0.0.1:8787`
  (never exposed directly -- only Caddy is reachable from outside).
- `/etc/caddy/Caddyfile` serving `packages/client/dist` and reverse-proxying
  `/ws` and `/health` to the server.
- `ufw` rules for 80/443, only if `ufw` is already active on the box.

## Logs

```bash
journalctl -u koden-server -f
journalctl -u caddy -f
```
