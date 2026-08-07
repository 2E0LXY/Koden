# Koden

Koden is a virtual amateur radio transceiver. Multiple people connect over the
web and talk to each other as if they were on real HF bands: the server
simulates propagation, band fading (QSB), atmospheric static, meteor scatter
openings, and other interference so the channel sounds like a real, noisy,
shared radio spectrum instead of a clean VoIP call. Antennas are modeled too
— a rotatable beam's gain pattern (and the bearing you'd need to point it)
is computed from real Maidenhead grid squares, not faked.

M0AI is a live, always-on AI station on 20m (14275 kHz USB) built on
Gemini's Live API, run like a real pileup: it hears everyone in its passband
at once, answers one caller at a time in callsign order, and follows IARU
Region&nbsp;1 operating convention (proper phonetics, RS reports, call-order
etiquette). It's location- and antenna-aware — whether you can work it, and
how strong it sounds, depends on your real bearing/distance to its Leeds,
UK grid square, same as any other station.

A station's full setup — both VFOs, memory channels, every receiver/TX
knob, antenna heading, device selection — is saved server-side keyed by
callsign, so it's restored automatically next time you log in with the
same callsign, from any browser or device.

## Try it

**Play now, no install:** **[kodenradio.uk](https://kodenradio.uk/)** — the
web client runs in any modern browser (mic access required for
transmitting).

**Native desktop (Windows / Debian):** early-stage, download from the
[Releases page](https://github.com/2E0LXY/Koden/releases) — a genuinely
native JUCE/C++ client (not a browser wrapper) that talks to the same
server over the same protocol. It's currently a network/status window
only (no audio, no radio panel yet — see
[`apps/desktop`](apps/desktop/README.md) for what's actually implemented
so far). The `.deb` has been installed and run in CI; the Windows build
compiles and passes its network test in CI but hasn't been run on a real
Windows machine yet.

## Packages

- `packages/shared` — band plan, Maidenhead grid square math, antenna gain
  patterns, and the WebSocket protocol shared between every client and the
  server.
- `packages/server` — the "ether": a Node.js/TypeScript server that tracks
  every connected station's VFO frequency/mode/grid locator, and every audio
  tick computes, per listener, who is audible and how their signal should be
  degraded (distance/band propagation, QSB fading, atmospheric noise, meteor
  scatter bursts, birdies) before mixing and sending back a unique impaired
  audio stream per listener. Also runs M0AI (the AI station) and per-callsign
  settings persistence.
- `packages/client` — a React web app styled as a retro multiband
  transceiver (VFO dial, S-meter, waterfall, band/mode selectors, PTT) that
  captures the mic, streams audio to the server, and plays back the mixed,
  impaired signal.
- `apps/desktop` — a native JUCE/C++ desktop client (Windows/Debian) using
  the same server and wire protocol. Early stage — see its own README for
  what's implemented so far.

## Development

```bash
npm install
npm run build --workspace=packages/shared
npm run dev:server   # starts the WebSocket/audio server
npm run dev:client   # starts the Vite dev server for the web UI
```

The client expects the server's WebSocket endpoint at `VITE_SERVER_WS_URL`
(defaults to `ws://localhost:8787/ws` in development).

## Deployment

Pushing to `main` triggers the `Deploy to VPS` GitHub Actions workflow
(`.github/workflows/deploy.yml`), which SSHes into the VPS and runs
`/opt/koden/deploy/install.sh` there. It can also be run manually from the
Actions tab (`workflow_dispatch`), optionally against a specific
branch/tag/commit.
