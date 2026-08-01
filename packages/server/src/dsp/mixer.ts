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
  nearestBand,
  gridToLatLon,
  localSolarHour,
} from "@koden/shared";
import type { Station } from "../stationManager.js";
import { StationManager } from "../stationManager.js";
import { PropagationEngine, passbandKHz, type PropagationResult } from "./propagation.js";
import { SporadicEEngine } from "./sporadicE.js";
import { BandNoiseGenerator, dbToLinear, modeNoiseGainDb } from "./noise.js";
import {
  MultipathFilter,
  SsbFrequencyShifter,
  TxBandwidthFilter,
  applySplatterColorInPlace,
} from "./audioEffects.js";
import { int16ToFloat32, float32ToInt16 } from "./pcm.js";
import {
  BEACON_CARRIER_KHZ,
  BEACON_FREQ_KHZ,
  BEACON_ID,
  BEACON_SIGNAL_DB,
  BeaconToneOscillator,
  MorseBeacon,
} from "./beacon.js";

const AUDIBLE_THRESHOLD_DB = -38;
const METER_EVERY_N_TICKS = 4;
/** dB above threshold at which FM's capture effect has essentially silenced the background noise. */
const FM_CAPTURE_RANGE_DB = 26;
/** dB margin within which two competing FM signals are "too close to call" -- the discriminator flip-flops between them instead of cleanly capturing one. */
const FM_CAPTURE_CONTEST_DB = 4;

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
  private ssbShifterByPair = new Map<string, SsbFrequencyShifter>();
  private beaconOscByStation = new Map<string, BeaconToneOscillator>();
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
    for (const key of [...this.ssbShifterByPair.keys()]) {
      if (key.startsWith(`${id}:`) || key.endsWith(`:${id}`)) this.ssbShifterByPair.delete(key);
    }
    this.beaconOscByStation.delete(id);
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

  private getSsbShifter(tx: Station, rx: Station): SsbFrequencyShifter {
    const key = `${tx.id}:${rx.id}`;
    const existing = this.ssbShifterByPair.get(key);
    if (existing) return existing;
    const shifter = new SsbFrequencyShifter(this.sampleRate);
    this.ssbShifterByPair.set(key, shifter);
    return shifter;
  }

  private getBeaconOscillator(rx: Station): BeaconToneOscillator {
    const existing = this.beaconOscByStation.get(rx.id);
    if (existing) return existing;
    const osc = new BeaconToneOscillator();
    this.beaconOscByStation.set(rx.id, osc);
    return osc;
  }

  private getNoiseGenerator(rx: Station, band: Band): BandNoiseGenerator {
    const existing = this.noiseByStation.get(rx.id);
    if (existing && existing.bandId === band.id) {
      // Retune in place rather than rebuilding -- a fresh generator would
      // reset the pink noise filter to silence (an audible warm-up
      // transient) and re-roll every random timer, making the same band
      // sound inconsistent every time the mode changes.
      if (!existing.generator.matches(rx.mode)) existing.generator.retune(rx.mode);
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

    // The keying on/off timing is identical for every listener, so it's
    // computed once per tick; the tone pitch itself is rendered separately
    // per listener below, since real CW's beat-note pitch depends on each
    // listener's own tuning relative to the beacon's carrier.
    const beaconEnvelope = this.beacon.nextEnvelope(nowMs, this.sampleRate, FRAME_SAMPLES);
    const beaconGain = dbToLinear(Math.min(BEACON_SIGNAL_DB, 0));

    for (const rx of all) {
      // Even tuned into a gap between amateur allocations, a real receiver
      // still hears *something* rather than dead silence -- fall back to
      // the nearest band's characteristics instead of skipping entirely.
      const rxBand = nearestBand(rx.freqKHz);

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
        // Real CW's pitch is the beat note between the carrier and each
        // listener's own tuning -- it slides as you tune and passes through
        // silence exactly on frequency (zero beat), instead of a fixed tone.
        const beaconToneHz = Math.abs((rx.freqKHz - BEACON_CARRIER_KHZ) * 1000);
        const beaconFrame = this.getBeaconOscillator(rx).renderTone(beaconEnvelope, this.sampleRate, beaconToneHz);
        for (let i = 0; i < output.length; i++) output[i] += beaconFrame[i] * beaconGain;
      }

      // FM has a real "capture effect": the discriminator locks onto
      // whichever signal is strongest and suppresses the rest entirely,
      // unlike AM/SSB/CW where every audible signal blends together
      // additively. Collected here instead of mixed immediately so the
      // winner can be picked after seeing every candidate.
      const fmCandidates: { tx: Station; result: PropagationResult; audio: Float32Array }[] = [];

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

        int16ToFloat32(tx.pendingFrame!, scratch);

        // Band-limit to the transmitter's own mode bandwidth (every listener
        // hears the same occupied bandwidth regardless of their own filter),
        // then -- for SSB -- shift the recovered audio by the listener's BFO
        // mismatch (their tuning vs. the transmitter's real frequency), then
        // layer sweeping frequency-selective multipath fading, then (if this
        // path is arriving as adjacent-channel splatter rather than cleanly
        // in-passband) a soft-clip to make it read as distorted bleed-through
        // rather than a clean quiet copy.
        this.getTxBandwidthFilter(tx).processInPlace(scratch);
        if (rx.mode === "USB" || rx.mode === "LSB") {
          const offsetHz = (rx.freqKHz - tx.txFreqKHz) * 1000;
          const shiftHz = rx.mode === "USB" ? -offsetHz : offsetHz;
          this.getSsbShifter(tx, rx).processInPlace(scratch, shiftHz);
        }
        this.getMultipathFilter(tx, rx).processInPlace(scratch, result.multipathDepth);
        if (result.splatterZone) applySplatterColorInPlace(scratch);

        if (rx.mode === "FM") {
          fmCandidates.push({ tx, result, audio: scratch.slice() });
          continue;
        }

        const gain = dbToLinear(Math.min(result.signalDb, 0));
        for (let i = 0; i < output.length; i++) output[i] += scratch[i] * gain;
      }

      if (fmCandidates.length > 0) {
        fmCandidates.sort((a, b) => b.result.signalDb - a.result.signalDb);
        const strongest = fmCandidates[0];
        const runnerUp = fmCandidates[1];
        if (runnerUp && strongest.result.signalDb - runnerUp.result.signalDb < FM_CAPTURE_CONTEST_DB) {
          // Too close to call: the discriminator flip-flops rapidly between
          // the two signals, producing fluttering, distorted audio instead
          // of a clean capture.
          const chunkSamples = 24;
          let useStrongest = true;
          for (let i = 0; i < output.length; i++) {
            if (i % chunkSamples === 0) useStrongest = Math.random() < 0.5;
            const winner = useStrongest ? strongest : runnerUp;
            const gain = dbToLinear(Math.min(winner.result.signalDb, 0));
            output[i] += winner.audio[i] * gain * 0.85;
          }
        } else {
          const gain = dbToLinear(Math.min(strongest.result.signalDb, 0));
          for (let i = 0; i < output.length; i++) output[i] += strongest.audio[i] * gain;
        }
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
