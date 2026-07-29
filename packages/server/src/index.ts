import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import {
  BANDS,
  ClientMessage,
  DEFAULT_ANTENNA,
  FRAME_BYTES,
  SAMPLE_RATE,
  type ServerMessage,
  type StationInfo,
  bandById,
  isValidGrid,
} from "@koden/shared";
import { StationManager, type Station } from "./stationManager.js";
import { MixerEngine } from "./dsp/mixer.js";
import { bufferToInt16Array } from "./dsp/pcm.js";
import { getSolarConditions, startSolarDataRefresh } from "./dsp/solar.js";
import { BEACON_CALLSIGN, BEACON_FREQ_KHZ, BEACON_GRID, BEACON_ID } from "./dsp/beacon.js";

const PORT = Number(process.env.PORT ?? 8787);
const TICK_MS = 20;
const SOLAR_BROADCAST_MS = 5 * 60 * 1000;

const stations = new StationManager();

const BEACON_STATION_INFO: StationInfo = {
  id: BEACON_ID,
  callsign: BEACON_CALLSIGN,
  grid: BEACON_GRID,
  freqKHz: BEACON_FREQ_KHZ,
  txFreqKHz: BEACON_FREQ_KHZ,
  mode: "CW",
  transmitting: true,
  antenna: DEFAULT_ANTENNA,
  headingDeg: 0,
};

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(message));
}

function broadcastRoster(): void {
  const stationInfos: StationInfo[] = [...stations.all().map(toStationInfo), BEACON_STATION_INFO];
  for (const s of stations.all()) {
    send(s.ws, { type: "roster", stations: stationInfos });
  }
}

function broadcastSolar(): void {
  const { sfi, kp } = getSolarConditions();
  for (const s of stations.all()) {
    send(s.ws, { type: "solar", sfi, kp });
  }
}

function toStationInfo(s: Station): StationInfo {
  return {
    id: s.id,
    callsign: s.callsign,
    grid: s.grid,
    freqKHz: s.freqKHz,
    txFreqKHz: s.txFreqKHz,
    mode: s.mode,
    transmitting: s.transmitting,
    antenna: s.antenna,
    headingDeg: s.headingDeg,
  };
}

const mixer = new MixerEngine(stations, SAMPLE_RATE, send);

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, stations: stations.count() }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

wss.on("connection", (ws) => {
  const id = randomUUID();
  let helloReceived = false;

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      const station = stations.get(id);
      if (!station || !station.transmitting) return;
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (buf.byteLength !== FRAME_BYTES) return;
      station.pendingFrame = bufferToInt16Array(buf);
      return;
    }

    let parsed: ClientMessage;
    try {
      parsed = ClientMessage.parse(JSON.parse(data.toString()));
    } catch {
      send(ws, { type: "error", message: "Malformed message" });
      return;
    }

    if (parsed.type === "hello") {
      if (!isValidGrid(parsed.grid)) {
        send(ws, { type: "error", message: "Invalid grid locator" });
        return;
      }
      const defaultBand = bandById("40m")!;
      const startFreq = defaultBand.rangeKHz[0] + 50;
      const station: Station = {
        id,
        ws,
        callsign: parsed.callsign,
        grid: parsed.grid,
        freqKHz: startFreq,
        txFreqKHz: startFreq,
        mode: defaultBand.defaultMode,
        filterWidth: "normal",
        antenna: DEFAULT_ANTENNA,
        headingDeg: 0,
        txPowerWatts: 100,
        swr: 2.8,
        transmitting: false,
        pendingFrame: null,
        connectedAt: Date.now(),
      };
      stations.add(station);
      helloReceived = true;
      send(ws, { type: "welcome", id, serverTimeMs: Date.now() });
      const { sfi, kp } = getSolarConditions();
      send(ws, { type: "solar", sfi, kp });
      broadcastRoster();
      return;
    }

    if (!helloReceived) {
      send(ws, { type: "error", message: "Send hello before other messages" });
      return;
    }

    const station = stations.get(id);
    if (!station) return;

    if (parsed.type === "tune") {
      station.freqKHz = parsed.freqKHz;
      station.txFreqKHz = parsed.txFreqKHz ?? parsed.freqKHz;
      station.mode = parsed.mode;
      station.filterWidth = parsed.filterWidth ?? station.filterWidth;
      broadcastRoster();
    } else if (parsed.type === "ptt") {
      station.transmitting = parsed.active;
      if (!parsed.active) station.pendingFrame = null;
      broadcastRoster();
    } else if (parsed.type === "antenna") {
      station.antenna = parsed.antenna;
      station.headingDeg = parsed.headingDeg;
      broadcastRoster();
    } else if (parsed.type === "power") {
      station.txPowerWatts = parsed.watts;
    } else if (parsed.type === "swr") {
      station.swr = parsed.swr;
    } else if (parsed.type === "profile") {
      if (!isValidGrid(parsed.grid)) {
        send(ws, { type: "error", message: "Invalid grid locator" });
        return;
      }
      station.callsign = parsed.callsign;
      station.grid = parsed.grid;
      broadcastRoster();
    }
  });

  ws.on("close", () => {
    stations.remove(id);
    mixer.onDisconnect(id);
    broadcastRoster();
  });

  ws.on("error", () => {
    stations.remove(id);
    mixer.onDisconnect(id);
  });
});

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = now - lastTick;
  lastTick = now;
  mixer.tick(now, dt);
}, TICK_MS);

startSolarDataRefresh();
setInterval(broadcastSolar, SOLAR_BROADCAST_MS);

httpServer.listen(PORT, () => {
  console.log(`Koden server listening on :${PORT} (ws path /ws)`);
  console.log(`Bands: ${BANDS.map((b) => b.id).join(", ")}`);
});
