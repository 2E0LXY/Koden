import { WebSocket } from "ws";
import {
  FRAME_SAMPLES,
  type Band,
  type ServerMessage,
  daylightFactor,
  findBand,
  gridToLatLon,
  localSolarHour,
} from "@koden/shared";
import type { Station } from "../stationManager.js";
import { StationManager } from "../stationManager.js";
import { PropagationEngine } from "./propagation.js";
import { BandNoiseGenerator, dbToLinear, modeNoiseGainDb } from "./noise.js";
import { int16ToFloat32, float32ToInt16 } from "./pcm.js";

const AUDIBLE_THRESHOLD_DB = -38;
const METER_EVERY_N_TICKS = 4;
/** dB above threshold at which FM's capture effect has essentially silenced the background noise. */
const FM_CAPTURE_RANGE_DB = 26;

interface RxNoiseState {
  bandId: string;
  generator: BandNoiseGenerator;
}

export class MixerEngine {
  private propagation = new PropagationEngine();
  private noiseByStation = new Map<string, RxNoiseState>();
  private tickCount = 0;

  constructor(
    private stations: StationManager,
    private sampleRate: number,
    private send: (ws: WebSocket, message: ServerMessage) => void,
  ) {}

  onDisconnect(id: string): void {
    this.propagation.forget(id);
    this.noiseByStation.delete(id);
  }

  private getNoiseGenerator(rx: Station, band: Band): BandNoiseGenerator {
    const existing = this.noiseByStation.get(rx.id);
    if (existing && existing.bandId === band.id && existing.generator.matches(rx.mode)) {
      return existing.generator;
    }
    const generator = new BandNoiseGenerator(band, this.sampleRate, rx.mode, rx.filterWidth);
    this.noiseByStation.set(rx.id, { bandId: band.id, generator });
    return generator;
  }

  tick(nowMs: number, dtMs: number): void {
    this.tickCount++;
    const all = this.stations.all();
    const transmitters = all.filter((s) => s.transmitting && s.pendingFrame);

    for (const rx of all) {
      const rxBand = findBand(rx.freqKHz);
      if (!rxBand) continue;

      const output = new Float32Array(FRAME_SAMPLES);
      const scratch = new Float32Array(FRAME_SAMPLES);
      const audibleIds: string[] = [];
      let peakSignalDb = -Infinity;

      for (const tx of transmitters) {
        if (tx.id === rx.id) continue;
        const result = this.propagation.compute(
          {
            txId: tx.id,
            rxId: rx.id,
            txGrid: tx.grid,
            rxGrid: rx.grid,
            txFreqKHz: tx.txFreqKHz,
            rxFreqKHz: rx.freqKHz,
            rxMode: rx.mode,
            rxFilterWidth: rx.filterWidth,
            band: rxBand,
          },
          nowMs,
          dtMs,
        );

        if (!result.inPassband || result.signalDb < AUDIBLE_THRESHOLD_DB) continue;

        audibleIds.push(tx.id);
        peakSignalDb = Math.max(peakSignalDb, result.signalDb);

        if (result.meteorScatterJustStarted) {
          this.send(rx.ws, {
            type: "band_event",
            kind: "meteor_scatter",
            bandId: rxBand.id,
            message: `Meteor scatter ping from ${tx.callsign}!`,
          });
        }

        const gainDb = Math.min(result.signalDb, 0);
        const gain = dbToLinear(gainDb);
        int16ToFloat32(tx.pendingFrame!, scratch);
        for (let i = 0; i < output.length; i++) output[i] += scratch[i] * gain;
      }

      // Real receiver noise power scales with passband bandwidth (a narrow
      // CW filter admits far less noise than a wide FM filter), and low-band
      // atmospheric static (QRN) gets noticeably worse at night once the
      // D-layer stops absorbing distant thunderstorm crashes.
      const rxLoc = gridToLatLon(rx.grid);
      const rxDaylight = daylightFactor(localSolarHour(rxLoc.lon, nowMs));
      const nightQrnBoostDb = rxBand.daytimeAbsorption * (1 - rxDaylight) * 6;
      const crackleRateMultiplier = 1 + rxBand.daytimeAbsorption * (1 - rxDaylight) * 0.8;

      const noiseGen = this.getNoiseGenerator(rx, rxBand);
      const effectiveNoiseFloorDb =
        rxBand.baseNoiseFloorDb + modeNoiseGainDb(rx.mode, rx.filterWidth) + nightQrnBoostDb;
      const noiseFrame = noiseGen.generate(FRAME_SAMPLES, effectiveNoiseFloorDb, crackleRateMultiplier);

      // FM's capture effect: once a signal is comfortably above the noise
      // floor, an FM detector locks on and background noise all but
      // disappears -- unlike AM/SSB/CW, where noise stays additive
      // regardless of signal strength.
      let noiseGain = 1;
      if (rx.mode === "FM" && peakSignalDb !== -Infinity) {
        const above = peakSignalDb - AUDIBLE_THRESHOLD_DB;
        noiseGain = Math.max(0.04, 1 - above / FM_CAPTURE_RANGE_DB);
      }
      for (let i = 0; i < output.length; i++) output[i] += noiseFrame[i] * noiseGain;

      const outInt16 = float32ToInt16(output);
      if (rx.ws.readyState === WebSocket.OPEN) {
        rx.ws.send(Buffer.from(outInt16.buffer, outInt16.byteOffset, outInt16.byteLength));
      }

      if (this.tickCount % METER_EVERY_N_TICKS === 0) {
        this.send(rx.ws, {
          type: "meter",
          sMeterDb: peakSignalDb === -Infinity ? rxBand.baseNoiseFloorDb : peakSignalDb,
          noiseFloorDb: effectiveNoiseFloorDb,
          audibleStationIds: audibleIds,
        });
      }
    }

    for (const s of all) s.pendingFrame = null;
  }
}
