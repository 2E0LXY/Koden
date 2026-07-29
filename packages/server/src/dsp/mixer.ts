import { WebSocket } from "ws";
import {
  BANDS,
  FRAME_SAMPLES,
  type Band,
  type Mode,
  type ServerMessage,
  antennaById,
  bandById,
  daylightFactor,
  findBand,
  gridToLatLon,
  localSolarHour,
} from "@koden/shared";
import type { Station } from "../stationManager.js";
import { StationManager } from "../stationManager.js";
import { PropagationEngine, passbandKHz } from "./propagation.js";
import { SporadicEEngine } from "./sporadicE.js";
import { BandNoiseGenerator, dbToLinear, modeNoiseGainDb } from "./noise.js";
import { MultipathFilter, TxBandwidthFilter, applySplatterColorInPlace } from "./audioEffects.js";
import { int16ToFloat32, float32ToInt16 } from "./pcm.js";
import { BEACON_FREQ_KHZ, BEACON_ID, BEACON_SIGNAL_DB, MorseBeacon } from "./beacon.js";

const AUDIBLE_THRESHOLD_DB = -38;
const METER_EVERY_N_TICKS = 4;
/** dB above threshold at which FM's capture effect has essentially silenced the background noise. */
const FM_CAPTURE_RANGE_DB = 26;

interface RxNoiseState {
  bandId: string;
  generator: BandNoiseGenerator;
}

interface TxBandwidthState {
  mode: Mode;
  filter: TxBandwidthFilter;
}

export class MixerEngine {
  private sporadicE = new SporadicEEngine();
  private propagation = new PropagationEngine(this.sporadicE);
  private noiseByStation = new Map<string, RxNoiseState>();
  private txBandwidthByStation = new Map<string, TxBandwidthState>();
  private multipathByPair = new Map<string, MultipathFilter>();
  private tickCount = 0;
  private beacon = new MorseBeacon("KODEN BEACON", 10, 7);

  constructor(
    private stations: StationManager,
    private sampleRate: number,
    private send: (ws: WebSocket, message: ServerMessage) => void,
  ) {}

  onDisconnect(id: string): void {
    this.propagation.forget(id);
    this.noiseByStation.delete(id);
    this.txBandwidthByStation.delete(id);
    for (const key of [...this.multipathByPair.keys()]) {
      if (key.startsWith(`${id}:`) || key.endsWith(`:${id}`)) this.multipathByPair.delete(key);
    }
  }

  private getTxBandwidthFilter(tx: Station): TxBandwidthFilter {
    const existing = this.txBandwidthByStation.get(tx.id);
    if (existing && existing.mode === tx.mode) return existing.filter;
    const filter = new TxBandwidthFilter(this.sampleRate, tx.mode);
    this.txBandwidthByStation.set(tx.id, { mode: tx.mode, filter });
    return filter;
  }

  private getMultipathFilter(tx: Station, rx: Station): MultipathFilter {
    const key = `${tx.id}:${rx.id}`;
    const existing = this.multipathByPair.get(key);
    if (existing) return existing;
    const filter = new MultipathFilter(this.sampleRate);
    this.multipathByPair.set(key, filter);
    return filter;
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

    for (const event of this.sporadicE.tick(BANDS, dtMs)) {
      const band = bandById(event.bandId);
      if (!band) continue;
      const message =
        event.kind === "band_opening"
          ? `Sporadic-E opening on ${band.name} -- short-skip DX may be workable!`
          : `Sporadic-E opening on ${band.name} has closed.`;
      for (const s of all) {
        this.send(s.ws, { type: "band_event", kind: event.kind, bandId: band.id, message });
      }
    }

    // Generated once per tick (not per listener) so its internal oscillator
    // phase and keying clock advance in real time regardless of how many
    // stations are tuned in to hear it.
    const beaconFrame = this.beacon.nextFrame(nowMs, this.sampleRate, FRAME_SAMPLES);
    const beaconGain = dbToLinear(Math.min(BEACON_SIGNAL_DB, 0));

    for (const rx of all) {
      const rxBand = findBand(rx.freqKHz);
      if (!rxBand) continue;

      const output = new Float32Array(FRAME_SAMPLES);
      const scratch = new Float32Array(FRAME_SAMPLES);
      const audibleIds: string[] = [];
      let peakSignalDb = -Infinity;

      // The test beacon bypasses propagation entirely: a fixed, always-on
      // reference signal at BEACON_SIGNAL_DB for anyone tuned within their
      // passband of BEACON_FREQ_KHZ, regardless of distance or band conditions.
      const beaconOffsetKHz = Math.abs(BEACON_FREQ_KHZ - rx.freqKHz);
      if (beaconOffsetKHz <= passbandKHz(rx.mode, rx.filterWidth) / 2) {
        audibleIds.push(BEACON_ID);
        peakSignalDb = Math.max(peakSignalDb, BEACON_SIGNAL_DB);
        for (let i = 0; i < output.length; i++) output[i] += beaconFrame[i] * beaconGain;
      }

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
            txAntenna: tx.antenna,
            txHeadingDeg: tx.headingDeg,
            rxAntenna: rx.antenna,
            rxHeadingDeg: rx.headingDeg,
            txPowerWatts: tx.txPowerWatts,
            txSwr: tx.swr,
          },
          nowMs,
          dtMs,
        );

        if ((!result.inPassband && !result.splatterZone) || result.signalDb < AUDIBLE_THRESHOLD_DB) {
          continue;
        }

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

        if (result.flutterJustStarted) {
          this.send(rx.ws, {
            type: "band_event",
            kind: "flutter",
            bandId: rxBand.id,
            message: `Flutter fading on ${tx.callsign}'s signal -- disturbed ionosphere.`,
          });
        }

        const gainDb = Math.min(result.signalDb, 0);
        const gain = dbToLinear(gainDb);
        int16ToFloat32(tx.pendingFrame!, scratch);

        // Band-limit to the transmitter's own mode bandwidth (every listener
        // hears the same occupied bandwidth regardless of their own filter),
        // then layer sweeping frequency-selective multipath fading, then
        // (if this path is arriving as adjacent-channel splatter rather than
        // cleanly in-passband) a soft-clip to make it read as distorted
        // bleed-through rather than a clean quiet copy.
        this.getTxBandwidthFilter(tx).processInPlace(scratch);
        this.getMultipathFilter(tx, rx).processInPlace(scratch, result.multipathDepth);
        if (result.splatterZone) applySplatterColorInPlace(scratch);

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
      const antennaNoiseAdjustDb = antennaById(rx.antenna)?.noiseFloorAdjustDb ?? 0;
      const effectiveNoiseFloorDb =
        rxBand.baseNoiseFloorDb +
        modeNoiseGainDb(rx.mode, rx.filterWidth) +
        nightQrnBoostDb +
        antennaNoiseAdjustDb;
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
