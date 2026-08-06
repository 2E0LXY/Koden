# Koden

Koden is a virtual amateur radio transceiver. Multiple people connect over the
web and talk to each other as if they were on real HF bands: the server
simulates propagation, band fading (QSB), atmospheric static, meteor scatter
openings, and other interference so the channel sounds like a real, noisy,
shared radio spectrum instead of a clean VoIP call.

## Packages

- `packages/shared` — band plan, Maidenhead grid square math, and the
  WebSocket protocol shared between client and server.
- `packages/server` — the "ether": a Node.js/TypeScript server that tracks
  every connected station's VFO frequency/mode/grid locator, and every audio
  tick computes, per listener, who is audible and how their signal should be
  degraded (distance/band propagation, QSB fading, atmospheric noise, meteor
  scatter bursts, birdies) before mixing and sending back a unique impaired
  audio stream per listener.
- `packages/client` — a React web app styled as a retro multiband
  transceiver (VFO dial, S-meter, waterfall, band/mode selectors, PTT) that
  captures the mic, streams audio to the server, and plays back the mixed,
  impaired signal.

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
(`.github/workflows/deploy.yml`), which SSHes into the VPS and runs the
install/update script there. It can also be run manually from the Actions
tab (`workflow_dispatch`), optionally against a specific branch/tag/commit.
