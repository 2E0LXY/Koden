# Koden Desktop (JUCE) -- native Windows/Debian client

A genuinely native (not Electron/webview) desktop client for Koden, built
with [JUCE](https://juce.com/) in C++. It talks to the existing Node.js
server over the same WebSocket protocol the browser client uses
(`packages/shared/src/protocol.ts`) -- the server needs no changes to
support this client.

## Status: phase 1 of ~3 -- network layer only

This is the first slice of a multi-week effort, scoped deliberately small so
it can be verified end-to-end before investing in the audio engine or full
UI. What's here:

- **`koden_net`** -- a platform-neutral static library: the wire protocol
  (JSON encode/decode via JUCE's `juce::var`/`JSON`, mirroring
  `protocol.ts`) and a `KodenSocket` class wrapping
  [IXWebSocket](https://github.com/machinezone/IXWebSocket) for the actual
  connection (TLS via OpenSSL, so `wss://` works). No GUI or audio module
  dependencies, so it builds and runs in a headless environment.
- **`koden_net_smoketest`** -- a console app that connects to a real Koden
  server, does the `hello` -> `welcome`/`roster`/`settings` handshake, and
  prints the result. This is the part of the native client that's actually
  been run and verified against production (`wss://kodenradio.uk/ws`) in a
  sandboxed build environment with no display.
- **`KodenDesktop`** -- a minimal JUCE GUI app (a window showing connection
  status + live roster). Proves the GUI target compiles and links against
  `koden_net`. **Not yet visually verified** -- it was built in a headless
  container with no X server, so only compilation has been confirmed;
  someone with a real desktop needs to actually run it and confirm the
  window renders and updates correctly.

### What's deliberately not here yet

- **Audio engine.** No RX/TX DSP, no mic capture, no playback. See the
  scoping notes below for what this involves -- it's the bulk of the
  remaining work.
- **Full radio panel UI.** Just a status label and a roster list right now,
  not the ~140-control transceiver panel.
- **Settings persistence UI**, antenna/rotator, waterfall/panadapter, retro
  skeuomorphic styling -- all follow-on work once the audio engine exists.

## Why JUCE

JUCE gives one C++ codebase for both Windows and Debian/Linux (and,
later, Android) with real native low-latency audio I/O (`AudioIODevice`,
WASAPI/ALSA under the hood) and native GUI rendering -- no browser runtime,
no Electron/webview. The tradeoff: JUCE has no built-in dynamics
compressor or WebSocket client, so both had to be sourced separately
(a hand-built compressor for phase 2's audio engine; IXWebSocket here).

## Roadmap (see the sizing discussion in the PR/commit history for detail)

1. ~~Network/protocol layer + minimal status window~~ (this phase)
2. Audio engine: RX DSP chain (notch/IF-shift/NR/NB/AGC/squelch/monitor,
   built on JUCE's `dsp::IIR` for filters + a hand-rolled compressor reused
   3x), TX capture (mic I/O, VOX, speech processor), real-time audio
   thread architecture (ring buffers feeding `AudioIODeviceCallback`)
3. Full radio panel UI: knobs, meters, memory bank, waterfall/panadapter
   (custom-painted scroll-blit), rotator compass, retro styling

Android is a separate follow-on decision once the desktop audio engine is
proven out -- JUCE does support Android, but touch interaction and
audio-permission plumbing differ enough to treat it as its own phase.

## Building

Requires a C++17 compiler, CMake 3.22+, and (on Linux) the usual JUCE Linux
dependencies: `libasound2-dev libjack-jackd2-dev libcurl4-openssl-dev
libfreetype6-dev libfontconfig1-dev libx11-dev libxcomposite-dev
libxcursor-dev libxext-dev libxinerama-dev libxrandr-dev libxrender-dev
libglu1-mesa-dev mesa-common-dev libssl-dev zlib1g-dev`.

JUCE (pinned to `8.0.15`) and IXWebSocket (pinned to `v12.0.1`) are fetched
automatically via CMake `FetchContent` -- no submodules to init.

```sh
cmake -S apps/desktop -B apps/desktop/build -G Ninja
cmake --build apps/desktop/build -j
```

Targets: `koden_net_smoketest` (console, safe to run headless) and
`KodenDesktop` (GUI, needs a display). Run the smoke test against the live
server:

```sh
./apps/desktop/build/koden_net_smoketest wss://kodenradio.uk/ws M0TEST IO91WM
```
