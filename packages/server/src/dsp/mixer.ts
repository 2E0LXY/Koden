import { WebSocket } from "ws";
import {
  BANDS,
  FRAME_SAMPLES,
  type Band,
  type Mode,
  type ServerMessage,
  antennaById,
  antennaGainDb,
  bandById,
  daylightFactor,
  nearestBand,
  gridToLatLon,
  localSolarHour,
} from "@koden/shared";
import type { Station } from "../stationManager.js";
import { StationManager } from "../stationManager.js";
import { PropagationEngine, passbandKHz } from "./propagation.js";
import { SporadicEEngine } from "./sporadicE.js";
import { AtmosphericCrackle, BandNoiseGenerator, PinkNoise, dbToLinear, hashFrac, modeNoiseGainDb } from "./noise.js";
import { qrmLevelDb, qrmSpursForBand } from "./qrm.js";
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
import { PARROT_FREQ_KHZ, PARROT_ID, ParrotEcho } from "./parrot.js";
import { AiStationEngine, M0AI_FREQ_KHZ, M0AI_ID, M0AI_SIGNAL_DB } from "./aiStation.js";
import {
  NUMBERS_STATION_FREQ_KHZ,
  NUMBERS_STATION_ID,
  NUMBERS_STATION_SIGNAL_DB,
  NumbersStation,
  TIME_STATION_CARRIER_KHZ,
  TIME_STATION_FREQ_KHZ,
  TIME_STATION_ID,
  TIME_STATION_SIGNAL_DB,
  TimeTicker,
  VOLMET_FREQ_KHZ,
  VOLMET_ID,
  VOLMET_SIGNAL_DB,
  VoiceMurmur,
} from "./utilityStations.js";
import { ChirpSounder, ChirpVoice, CHIRP_SOUNDER_ID, CHIRP_SOUNDER_SIGNAL_DB } from "./chirpSounder.js";

/** Fixed reference level for the parrot's played-back audio -- strong, like the beacon, but with headroom left below full scale for its own static (see PARROT_STATIC_LEVEL) to actually be audible against it. */
const PARROT_SIGNAL_DB = -15;
/**
 * Real transmissions get frequency-selective multipath fading scaled by
 * distance -- the parrot has no such distance to draw from (it isn't
 * routed through the propagation engine at all), but real RF never arrives
 * through a perfectly flat, multipath-free channel either, even at short
 * range. A modest fixed depth keeps the echo test useful for actually
 * judging your own audio quality while no longer sounding like a locally
 * played-back file -- present but well short of a real fading signal's
 * strongest depth (see propagation.ts's own distance-scaled multipathDepth).
 */
const PARROT_MULTIPATH_DEPTH = 0.22;
/**
 * The parrot lives on 6m, whose modeled noise floor is the quietest of any
 * band (baseNoiseFloorDb -55) -- so relying on the general per-band ambient
 * noise layer alone left the parrot's own signal towering over it,
 * regardless of the multipath texture above. Mixed in directly, at a level
 * comparable to a *typical* band's ambient floor elsewhere in the sim, so
 * the echo test reads as genuine over-the-air audio no matter which band
 * it happens to sit on, not a clean local file with a faint wobble on top.
 */
const PARROT_STATIC_LEVEL = 0.09;

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
  /** One independent multipath sweep per listener, so the parrot's playback -- like a real transmission -- doesn't reach every listener as an identical, perfectly clean copy. */
  private parrotMultipathByStation = new Map<string, MultipathFilter>();
  /** One independent hiss/crackle generator per listener backing the parrot's own always-present static -- see PARROT_STATIC_LEVEL. */
  private parrotStaticByStation = new Map<string, { pink: PinkNoise; crackle: AtmosphericCrackle }>();
  /** One oscillator per (station, band, spur index), so its phase stays continuous while a listener sits tuned near a spur. */
  private qrmOscByStation = new Map<string, Map<string, BeaconToneOscillator>>();
  /** QRM spurs are always "keyed" -- a steady carrier, not Morse -- so every listener shares this same constant envelope. */
  private readonly qrmEnvelope = new Float32Array(FRAME_SAMPLES).fill(1);
  private tickCount = 0;
  private beacon = new MorseBeacon("KODEN BEACON", 10, 7);
  private parrot: ParrotEcho;
  private aiStation = new AiStationEngine();
  private timeTicker = new TimeTicker();
  private timeOscByStation = new Map<string, BeaconToneOscillator>();
  private volmet: VoiceMurmur;
  private numbersStation: NumbersStation;
  private chirpSounder: ChirpSounder;
  private chirpVoiceByStation = new Map<string, ChirpVoice>();

  constructor(
    private stations: StationManager,
    private sampleRate: number,
    private send: (ws: WebSocket, message: ServerMessage) => void,
  ) {
    this.parrot = new ParrotEcho(sampleRate, FRAME_SAMPLES);
    this.volmet = new VoiceMurmur(sampleRate);
    this.numbersStation = new NumbersStation(sampleRate);
    this.chirpSounder = new ChirpSounder(sampleRate);
  }

  onDisconnect(id: string, nowMs: number): void {
    this.propagation.forget(id);
    this.noiseByStation.delete(id);
    this.txBandwidthByStation.delete(id);
    this.qrmOscByStation.delete(id);
    for (const key of [...this.multipathByPair.keys()]) {
      if (key.startsWith(`${id}:`) || key.endsWith(`:${id}`)) this.multipathByPair.delete(key);
    }
    for (const key of [...this.ssbShifterByPair.keys()]) {
      if (key.startsWith(`${id}:`) || key.endsWith(`:${id}`)) this.ssbShifterByPair.delete(key);
    }
    this.beaconOscByStation.delete(id);
    this.parrotMultipathByStation.delete(id);
    this.parrotStaticByStation.delete(id);
    this.timeOscByStation.delete(id);
    this.chirpVoiceByStation.delete(id);
    this.parrot.handleDisconnect(id, nowMs);
    this.aiStation.onDisconnect(id);
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

  private getParrotMultipathFilter(rx: Station): MultipathFilter {
    const existing = this.parrotMultipathByStation.get(rx.id);
    if (existing) return existing;
    const filter = new MultipathFilter(this.sampleRate);
    this.parrotMultipathByStation.set(rx.id, filter);
    return filter;
  }

  private getParrotStatic(rx: Station): { pink: PinkNoise; crackle: AtmosphericCrackle } {
    const existing = this.parrotStaticByStation.get(rx.id);
    if (existing) return existing;
    const state = { pink: new PinkNoise(), crackle: new AtmosphericCrackle(this.sampleRate, 1.8, 0.15) };
    this.parrotStaticByStation.set(rx.id, state);
    return state;
  }

  private getQrmOscillator(rx: Station, spurKey: string): BeaconToneOscillator {
    let byKey = this.qrmOscByStation.get(rx.id);
    if (!byKey) {
      byKey = new Map();
      this.qrmOscByStation.set(rx.id, byKey);
    }
    const existing = byKey.get(spurKey);
    if (existing) return existing;
    const osc = new BeaconToneOscillator();
    byKey.set(spurKey, osc);
    return osc;
  }

  private getTimeOscillator(rx: Station): BeaconToneOscillator {
    const existing = this.timeOscByStation.get(rx.id);
    if (existing) return existing;
    const osc = new BeaconToneOscillator();
    this.timeOscByStation.set(rx.id, osc);
    return osc;
  }

  private getChirpVoice(rx: Station): ChirpVoice {
    const existing = this.chirpVoiceByStation.get(rx.id);
    if (existing) return existing;
    const voice = new ChirpVoice(this.sampleRate);
    this.chirpVoiceByStation.set(rx.id, voice);
    return voice;
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

    // Anyone keyed (PTT held) into the parrot's own passband this tick is a
    // candidate to record; advancing/recording happens once per tick here
    // (not per listener), same reasoning as the beacon's envelope above.
    // Keyed status and frame availability are tracked separately -- a
    // single tick's mic frame can legitimately go missing (network/
    // scheduling jitter) without the station's PTT actually releasing, and
    // the parrot must not mistake that for "recording finished."
    const inParrotPassband = (s: { txFreqKHz: number; mode: Station["mode"]; filterWidth: Station["filterWidth"] }) =>
      Math.abs(s.txFreqKHz - PARROT_FREQ_KHZ) <= passbandKHz(s.mode, s.filterWidth) / 2;
    const keyedIntoParrot = new Set(
      all.filter((s) => s.transmitting && inParrotPassband(s)).map((s) => s.id),
    );
    const parrotModesById = new Map<string, Station["mode"]>();
    for (const s of all) {
      if (keyedIntoParrot.has(s.id)) parrotModesById.set(s.id, s.mode);
    }
    const parrotFramesById = new Map<string, Float32Array>();
    for (const tx of transmitters) {
      if (!inParrotPassband(tx)) continue;
      const frame = new Float32Array(FRAME_SAMPLES);
      int16ToFloat32(tx.pendingFrame!, frame);
      parrotFramesById.set(tx.id, frame);
    }
    this.parrot.tick(nowMs, keyedIntoParrot, parrotFramesById, parrotModesById);
    const parrotFrame = this.parrot.nextFrame();
    const parrotGain = dbToLinear(Math.min(PARROT_SIGNAL_DB, 0));

    // M0AI: unlike the parrot's single shared slot, every station gets its
    // own independent Gemini Live conversation, so this drives one session
    // per station rather than one shared piece of state. Every connected
    // station (not just this tick's transmitters) needs a tick call so PTT
    // release is caught promptly even on a tick with no fresh audio frame.
    const inM0aiPassband = (s: { txFreqKHz: number; mode: Station["mode"]; filterWidth: Station["filterWidth"] }) =>
      Math.abs(s.txFreqKHz - M0AI_FREQ_KHZ) <= passbandKHz(s.mode, s.filterWidth) / 2;
    const m0aiFrameByStation = new Map<string, Float32Array>();
    if (this.aiStation.enabled) {
      for (const s of all) {
        const keyed = s.transmitting && inM0aiPassband(s);
        let frame: Float32Array | null = null;
        if (keyed && s.pendingFrame) {
          frame = new Float32Array(FRAME_SAMPLES);
          int16ToFloat32(s.pendingFrame, frame);
        }
        this.aiStation.tick(s.id, nowMs, keyed, frame);
      }
      this.aiStation.sweepIdle(nowMs);
      for (const s of all) {
        const frame = this.aiStation.nextFrame(s.id);
        if (frame) m0aiFrameByStation.set(s.id, frame);
      }
    }
    const m0aiGain = dbToLinear(Math.min(M0AI_SIGNAL_DB, 0));

    // Same reasoning as the beacon above: the tick pattern is identical for
    // every listener, so it's computed once here; each listener still gets
    // their own oscillator for the beat-note pitch.
    const timeEnvelope = this.timeTicker.nextEnvelope(nowMs, this.sampleRate, FRAME_SAMPLES);
    const timeGain = dbToLinear(Math.min(TIME_STATION_SIGNAL_DB, 0));

    // VOLMET and the numbers station are simulated "broadcast" content --
    // every listener hears the identical audio (there's no beat-note
    // pitch dependent on individual tuning the way CW has), so each is
    // rendered once per tick and shared.
    const volmetFrame = this.volmet.render(FRAME_SAMPLES);
    const volmetGain = dbToLinear(Math.min(VOLMET_SIGNAL_DB, 0));
    const numbersFrame = this.numbersStation.render(FRAME_SAMPLES);
    const numbersActive = this.numbersStation.active;
    const numbersGain = dbToLinear(Math.min(NUMBERS_STATION_SIGNAL_DB, 0));

    // The sounder's own sweep state only needs updating once per tick; see
    // ChirpSounder's own comment for why this returns a swept *range*
    // rather than an instantaneous frequency.
    const chirpBracket = this.chirpSounder.tick(FRAME_SAMPLES);
    const chirpGain = dbToLinear(Math.min(CHIRP_SOUNDER_SIGNAL_DB, 0));

    for (const rx of all) {
      // Even tuned into a gap between amateur allocations, a real receiver
      // still hears *something* rather than dead silence -- fall back to
      // the nearest band's characteristics instead of skipping entirely.
      const rxBand = nearestBand(rx.freqKHz);

      const output = new Float32Array(FRAME_SAMPLES);
      const scratch = new Float32Array(FRAME_SAMPLES);
      const audibleIds: string[] = [];
      let peakSignalDb = -Infinity;

      // FM has a real "capture effect": the discriminator locks onto
      // whichever signal is strongest and suppresses the rest entirely,
      // unlike AM/SSB/CW where every audible signal blends together
      // additively. Every audio source a listener could hear this tick --
      // fixed stations (beacon, parrot, QRM, time signal, VOLMET, numbers
      // station, chirp sounder) exactly as much as real transmitting
      // stations -- gets collected here when the listener is in FM instead
      // of being mixed immediately, so the winner can be picked after
      // seeing every candidate; a captured QSO on FM shouldn't also have a
      // persistent beacon or QRM spur playing underneath it, any more than
      // a real FM discriminator would let two carriers through at once.
      const fmCandidates: { id: string; signalDb: number; audio: Float32Array }[] = [];

      // The test beacon bypasses propagation entirely: a fixed, always-on
      // reference signal at BEACON_SIGNAL_DB for anyone tuned within their
      // passband of BEACON_FREQ_KHZ, regardless of distance or band conditions.
      // Measured against whichever of the nominal "dial" frequency or the
      // actual carrier is closer, since a listener sliding down to true
      // zero beat ends up tuned to the carrier itself (700Hz below the
      // nominal spot) -- using only the nominal frequency here would gate
      // the beacon out of the passband exactly where zero beat is meant to
      // be reachable, since CW's passband is far narrower than that offset.
      const beaconOffsetKHz = Math.min(
        Math.abs(BEACON_FREQ_KHZ - rx.freqKHz),
        Math.abs(BEACON_CARRIER_KHZ - rx.freqKHz),
      );
      if (beaconOffsetKHz <= passbandKHz(rx.mode, rx.filterWidth) / 2) {
        audibleIds.push(BEACON_ID);
        peakSignalDb = Math.max(peakSignalDb, BEACON_SIGNAL_DB);
        // Real CW's pitch is the beat note between the carrier and each
        // listener's own tuning -- it slides as you tune and passes through
        // silence exactly on frequency (zero beat), instead of a fixed tone.
        const beaconToneHz = Math.abs((rx.freqKHz - BEACON_CARRIER_KHZ) * 1000);
        const beaconFrame = this.getBeaconOscillator(rx).renderTone(beaconEnvelope, this.sampleRate, beaconToneHz);
        if (rx.mode === "FM") {
          fmCandidates.push({ id: BEACON_ID, signalDb: BEACON_SIGNAL_DB, audio: beaconFrame });
        } else {
          for (let i = 0; i < output.length; i++) output[i] += beaconFrame[i] * beaconGain;
        }
      }

      // The parrot echo test: audible (like a real repeater's parrot
      // function) to anyone tuned to it while a recording is replaying,
      // not just whoever recorded it. Unlike a real transmission, the
      // parrot never goes through the propagation engine (no distance to
      // model), so it gets its own modest fixed multipath sweep here --
      // otherwise it's the one signal in the whole sim that always arrives
      // as a perfectly clean copy, undermining its whole point as a "how do
      // I actually sound over the air" test. Each listener gets their own
      // filter instance (not a shared one) so the sweep isn't identical for
      // everyone tuned in at once, the same way two listeners of a real
      // transmission hear independently-drifting fading.
      if (parrotFrame && Math.abs(PARROT_FREQ_KHZ - rx.freqKHz) <= passbandKHz(rx.mode, rx.filterWidth) / 2) {
        audibleIds.push(PARROT_ID);
        peakSignalDb = Math.max(peakSignalDb, PARROT_SIGNAL_DB);
        const parrotFiltered = parrotFrame.slice();
        this.getParrotMultipathFilter(rx).processInPlace(parrotFiltered, PARROT_MULTIPATH_DEPTH);
        if (rx.mode === "FM") {
          fmCandidates.push({ id: PARROT_ID, signalDb: PARROT_SIGNAL_DB, audio: parrotFiltered });
        } else {
          for (let i = 0; i < output.length; i++) output[i] += parrotFiltered[i] * parrotGain;
          // Mixed in at a fixed absolute level (not scaled by parrotGain) --
          // this represents the channel's own noise, not something that
          // gets stronger or weaker with the transmitted signal itself.
          const parrotStatic = this.getParrotStatic(rx);
          const staticFrame = new Float32Array(output.length);
          for (let i = 0; i < staticFrame.length; i++) staticFrame[i] = parrotStatic.pink.next() * PARROT_STATIC_LEVEL;
          parrotStatic.crackle.fillAdd(staticFrame);
          for (let i = 0; i < output.length; i++) output[i] += staticFrame[i];
        }
      }

      // M0AI: a private, per-station reply -- only the station that's
      // actually in a QSO with it (m0aiFrameByStation is keyed by rx.id)
      // ever gets audio here, unlike every other fixed station above whose
      // single shared frame is audible to everyone tuned in at once.
      const m0aiFrame = m0aiFrameByStation.get(rx.id);
      if (m0aiFrame && Math.abs(M0AI_FREQ_KHZ - rx.freqKHz) <= passbandKHz(rx.mode, rx.filterWidth) / 2) {
        audibleIds.push(M0AI_ID);
        peakSignalDb = Math.max(peakSignalDb, M0AI_SIGNAL_DB);
        if (rx.mode === "FM") {
          fmCandidates.push({ id: M0AI_ID, signalDb: M0AI_SIGNAL_DB, audio: m0aiFrame });
        } else {
          for (let i = 0; i < output.length; i++) output[i] += m0aiFrame[i] * m0aiGain;
        }
      }

      // Fixed-frequency QRM/birdie spurs: unlike the ambient band noise
      // floor (uniform across the whole band), these sit at real dial
      // frequencies, so tuning toward or away from one moves the S-meter
      // and waterfall the way a real birdie or bleed-through carrier would.
      qrmSpursForBand(rxBand).forEach((spurFreqKHz, i) => {
        const levelDb = qrmLevelDb(spurFreqKHz, rx.freqKHz);
        if (levelDb < AUDIBLE_THRESHOLD_DB) return;
        audibleIds.push(`qrm:${rxBand.id}:${i}`);
        peakSignalDb = Math.max(peakSignalDb, levelDb);
        const toneHz = Math.abs((rx.freqKHz - spurFreqKHz) * 1000);
        const qrmFrame = this.getQrmOscillator(rx, `${rxBand.id}:${i}`).renderTone(this.qrmEnvelope, this.sampleRate, toneHz);
        if (rx.mode === "FM") {
          fmCandidates.push({ id: `qrm:${rxBand.id}:${i}`, signalDb: levelDb, audio: qrmFrame });
        } else {
          const qrmGain = dbToLinear(Math.min(levelDb, 0));
          for (let j = 0; j < output.length; j++) output[j] += qrmFrame[j] * qrmGain;
        }
      });

      // A WWV/WWVH-style time-standard station: a steady tick, same
      // beat-note treatment as the beacon above.
      const timeOffsetKHz = Math.abs(TIME_STATION_FREQ_KHZ - rx.freqKHz);
      if (timeOffsetKHz <= passbandKHz(rx.mode, rx.filterWidth) / 2) {
        audibleIds.push(TIME_STATION_ID);
        peakSignalDb = Math.max(peakSignalDb, TIME_STATION_SIGNAL_DB);
        const timeToneHz = Math.abs((rx.freqKHz - TIME_STATION_CARRIER_KHZ) * 1000);
        const timeFrame = this.getTimeOscillator(rx).renderTone(timeEnvelope, this.sampleRate, timeToneHz);
        if (rx.mode === "FM") {
          fmCandidates.push({ id: TIME_STATION_ID, signalDb: TIME_STATION_SIGNAL_DB, audio: timeFrame });
        } else {
          for (let i = 0; i < output.length; i++) output[i] += timeFrame[i] * timeGain;
        }
      }

      // A VOLMET-style droning weather announcer -- simulated program
      // content, so unlike CW/QRM it's the same demodulated audio for
      // every listener, just gated by passband.
      if (Math.abs(VOLMET_FREQ_KHZ - rx.freqKHz) <= passbandKHz(rx.mode, rx.filterWidth) / 2) {
        audibleIds.push(VOLMET_ID);
        peakSignalDb = Math.max(peakSignalDb, VOLMET_SIGNAL_DB);
        if (rx.mode === "FM") {
          fmCandidates.push({ id: VOLMET_ID, signalDb: VOLMET_SIGNAL_DB, audio: volmetFrame });
        } else {
          for (let i = 0; i < output.length; i++) output[i] += volmetFrame[i] * volmetGain;
        }
      }

      // A numbers-station Easter egg -- only actually on the air during
      // its own rare, scheduled episodes.
      if (numbersActive && Math.abs(NUMBERS_STATION_FREQ_KHZ - rx.freqKHz) <= passbandKHz(rx.mode, rx.filterWidth) / 2) {
        audibleIds.push(NUMBERS_STATION_ID);
        peakSignalDb = Math.max(peakSignalDb, NUMBERS_STATION_SIGNAL_DB);
        if (rx.mode === "FM") {
          fmCandidates.push({ id: NUMBERS_STATION_ID, signalDb: NUMBERS_STATION_SIGNAL_DB, audio: numbersFrame });
        } else {
          for (let i = 0; i < output.length; i++) output[i] += numbersFrame[i] * numbersGain;
        }
      }

      // Ionospheric chirp sounder: trigger this listener's own brief chirp
      // voice if the sweep crossed through their passband this tick, then
      // keep rendering whatever's already playing regardless of the
      // sweep's current position -- the chirp itself has a fixed, short
      // duration once triggered (see ChirpVoice).
      if (chirpBracket) {
        const halfPassband = passbandKHz(rx.mode, rx.filterWidth) / 2;
        const [lowKHz, highKHz] = chirpBracket;
        if (rx.freqKHz + halfPassband >= lowKHz && rx.freqKHz - halfPassband <= highKHz) {
          const voice = this.getChirpVoice(rx);
          if (!voice.active) voice.trigger();
        }
      }
      const chirpVoice = this.chirpVoiceByStation.get(rx.id);
      if (chirpVoice?.active) {
        audibleIds.push(CHIRP_SOUNDER_ID);
        peakSignalDb = Math.max(peakSignalDb, CHIRP_SOUNDER_SIGNAL_DB);
        const chirpFrame = chirpVoice.render(FRAME_SAMPLES);
        if (rx.mode === "FM") {
          fmCandidates.push({ id: CHIRP_SOUNDER_ID, signalDb: CHIRP_SOUNDER_SIGNAL_DB, audio: chirpFrame });
        } else {
          for (let i = 0; i < output.length; i++) output[i] += chirpFrame[i] * chirpGain;
        }
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
          fmCandidates.push({ id: tx.id, signalDb: result.signalDb, audio: scratch.slice() });
          continue;
        }

        const gain = dbToLinear(Math.min(result.signalDb, 0));
        for (let i = 0; i < output.length; i++) output[i] += scratch[i] * gain;
      }

      if (fmCandidates.length > 0) {
        fmCandidates.sort((a, b) => b.signalDb - a.signalDb);
        const strongest = fmCandidates[0];
        const runnerUp = fmCandidates[1];
        if (runnerUp && strongest.signalDb - runnerUp.signalDb < FM_CAPTURE_CONTEST_DB) {
          // Too close to call: the discriminator flip-flops rapidly between
          // the two signals, producing fluttering, distorted audio instead
          // of a clean capture.
          const chunkSamples = 24;
          let useStrongest = true;
          for (let i = 0; i < output.length; i++) {
            if (i % chunkSamples === 0) useStrongest = Math.random() < 0.5;
            const winner = useStrongest ? strongest : runnerUp;
            const gain = dbToLinear(Math.min(winner.signalDb, 0));
            output[i] += winner.audio[i] * gain * 0.85;
          }
        } else {
          const gain = dbToLinear(Math.min(strongest.signalDb, 0));
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
      const rxAntennaMeta = antennaById(rx.antenna);
      const antennaNoiseAdjustDb = rxAntennaMeta?.noiseFloorAdjustDb ?? 0;
      // A directional beam can partially null background QRM/static by
      // pointing away from wherever it's mostly coming from, the way real
      // hams "rotate off the noise." Each band gets its own fixed noise
      // bearing so it's consistent as you swing the beam back and forth.
      // Omnidirectional antennas can't discriminate by heading at all --
      // antennaGainDb returns their flat gain regardless of bearing, so
      // this nets to exactly 0 for them automatically.
      const noiseBearingDeg = hashFrac(`noise-bearing:${rxBand.id}`) * 360;
      const directionalNoiseDb = rxAntennaMeta
        ? Math.max(-8, antennaGainDb(rxAntennaMeta, rx.headingDeg, noiseBearingDeg) - rxAntennaMeta.gainDbi)
        : 0;
      const effectiveNoiseFloorDb =
        rxBand.baseNoiseFloorDb +
        modeNoiseGainDb(rx.mode, rx.filterWidth) +
        nightQrnBoostDb +
        antennaNoiseAdjustDb +
        directionalNoiseDb;
      const noiseFrame = noiseGen.generate(FRAME_SAMPLES, effectiveNoiseFloorDb, rx.freqKHz, crackleRateMultiplier);

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
          // The no-signal fallback must match noiseFloorDb's own reference
          // frame (mode/night/antenna-adjusted), not the raw band base --
          // otherwise the two diverge by however much those adjustments
          // shift the floor (up to ~9dB for CW's narrow-bandwidth gain
          // alone), which read as a false "signal present" margin to any
          // client comparing the two (e.g. the waterfall's own-signal bump).
          sMeterDb: peakSignalDb === -Infinity ? effectiveNoiseFloorDb : peakSignalDb,
          noiseFloorDb: effectiveNoiseFloorDb,
          audibleStationIds: audibleIds,
        });
      }
    }

    for (const s of all) s.pendingFrame = null;
  }
}
