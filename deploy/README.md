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

| Variable       | Default                          | Meaning |
|----------------|-----------------------------------|---------|
| `REPO_URL`     | this repo, HTTPS                  | Git remote to deploy from |
| `REPO_REF`     | `main`                            | Branch/tag/commit to deploy |
| `ADDR`         | auto-detected public IP           | Canonical hostname or IP Caddy serves on and the client connects its WebSocket to |
| `ADDR_ALIASES` | none                              | Comma-separated extra hostnames (e.g. a `www.` variant) that 301-redirect to `ADDR` -- each still gets its own real certificate |
| `INSTALL_DIR`  | `/opt/koden`                      | Where the app lives on disk |
| `NODE_MAJOR`   | `22`                               | Node.js major version to install |
| `GEMINI_API_KEY` | none (M0AI off the air)         | Google Gemini API key -- enables M0AI, the AI QSO partner station (see below) |
| `GEMINI_LIVE_MODEL` | `gemini-3.1-flash-live-preview`  | Override the Gemini Live model M0AI uses |

If you have a real domain pointed at the VPS, set `ADDR=your.domain.com` to
get a proper trusted certificate instead of the self-signed fallback. Koden
is live at **https://kodenradio.uk** (with `https://www.kodenradio.uk`
redirecting to it), deployed via `ADDR=kodenradio.uk
ADDR_ALIASES=www.kodenradio.uk` -- see `.github/workflows/deploy.yml`.

## M0AI (optional)

Set `GEMINI_API_KEY` (a [Google Gemini API key](https://aistudio.google.com/apikey))
and Koden puts a real AI-operated station, M0AI, on the air on 20m
(14275kHz USB) -- Alex, operating from Leeds -- tune it in and key up for a
genuine live voice QSO via the [Gemini Live API](https://ai.google.dev/gemini-api/docs/live),
not a scripted response. It's a single shared frequency, like a real DX
station worked simplex: whoever it's currently in a QSO with is heard by
everyone tuned in, and it follows [IARU Region 1's operating rules](https://www.iaru-r1.org/on-the-air/code-of-conduct/) --
one caller at a time, correct callsigns both ways, no jumping in on someone
else's exchange. No key set, no M0AI -- everything else works exactly the
same either way, and the station simply doesn't show up on anyone's
roster. See `packages/server/src/dsp/aiStation.ts`.

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

## Automatic deploys (GitHub Actions)

`.github/workflows/deploy.yml` SSHes into the VPS and re-runs `install.sh`
(which is idempotent, so this is just "pull latest + rebuild + restart") on
every push to `main`, or on demand via the Actions tab ("Run workflow").

One-time setup, since this needs credentials only you should hold:

1. Generate a dedicated deploy keypair (don't reuse a personal key):
   ```bash
   ssh-keygen -t ed25519 -f koden_deploy_key -N "" -C "koden-deploy@github-actions"
   ```
2. Authorize the public half on the VPS (as root):
   ```bash
   cat koden_deploy_key.pub >> /root/.ssh/authorized_keys
   ```
3. Add three repository secrets under **Settings → Secrets and variables →
   Actions → New repository secret**:
   - `VPS_HOST` -- the VPS's IP or hostname
   - `VPS_USER` -- `root` (install.sh requires root)
   - `VPS_SSH_KEY` -- the full contents of `koden_deploy_key` (the private
     half -- never the `.pub` file)
   - `GEMINI_API_KEY` -- optional, enables M0AI (see above); leave unset and
     deploys still work fine, M0AI just stays off the air
4. Delete the local `koden_deploy_key` / `koden_deploy_key.pub` files once
   both are in place; only the copies on the VPS and in GitHub's secret
   store are needed afterwards.

Once the secrets are set, pushes to `main` deploy automatically -- no
Claude session or manual SSH required.
