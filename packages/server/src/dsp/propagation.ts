import {
  type AntennaId,
  type Band,
  type FilterWidth,
  type Mode,
  DEFAULT_ANTENNA,
  antennaById,
  antennaGainDb,
  antennaHeightGainDb,
  daylightFactor,
  gridBearingDeg,
  gridDistanceKm,
  gridToLatLon,
  localSolarHour,
} from "@koden/shared";
import { getNormalizedSolarFlux, getSolarConditions } from "./solar.js";
import type { SporadicEEngine } from "./sporadicE.js";

const FILTER_WIDTH_MULTIPLIER: Record<FilterWidth, number> = {
  narrow: 0.5,
  normal: 1,
  wide: 1.6,
};

export function passbandKHz(mode: Mode, filterWidth: FilterWidth = "normal"): number {
  const base = (() => {
    switch (mode) {
      case "CW":
        return 0.5;
      case "RTTY":
        return 0.5;
      case "DATA":
        return 2.7;
      case "USB":
      case "LSB":
        return 3;
      case "AM":
        return 6;
      case "FM":
        return 15;
    }
  })();
  return base * FILTER_WIDTH_MULTIPLIER[filterWidth];
}

export interface PropagationInput {
  txId: string;
  rxId: string;
  txGrid: string;
  rxGrid: string;
  txFreqKHz: number;
  rxFreqKHz: number;
  rxMode: Mode;
  rxFilterWidth: FilterWidth;
  band: Band;
  txAntenna: AntennaId;
  txHeadingDeg: number;
  rxAntenna: AntennaId;
  rxHeadingDeg: number;
  /** Transmitter's RF output power, watts. */
  txPowerWatts: number;
  /** Transmitter's current antenna match (SWR); 1.0 = perfect match. */
  txSwr: number;
}

export interface PropagationResult {
  /** Whether the tx frequency falls within the rx's receiver passband. */
  inPassband: boolean;
  /** Effective received signal strength in dB (roughly S-meter-like; can be very negative = inaudible). */
  signalDb: number;
  /** True while a meteor-scatter burst is actively boosting this path. */
  meteorScatterActive: boolean;
  /** True on the single tick a new meteor scatter burst begins. */
  meteorScatterJustStarted: boolean;
  /** True while rapid flutter fading (disturbed-ionosphere fast fading) is active on this path. */
  flutterActive: boolean;
  /** True on the single tick a new flutter episode begins. */
  flutterJustStarted: boolean;
  /** 0-1: how strongly frequency-selective ("underwater") multipath fading should colour this path's audio. */
  multipathDepth: number;
  /** True when the tx is outside the rx's exact passband but close enough to leak in as distorted adjacent-channel splatter. */
  splatterZone: boolean;
}

/** Slow mean-reverting random walk (Ornstein-Uhlenbeck) used for QSB fading. */
class FadeProcess {
  private value = 0;

  step(dtSeconds: number, theta: number, sigma: number): number {
    const drift = theta * (0 - this.value) * dtSeconds;
    const diffusion = sigma * Math.sqrt(dtSeconds) * gaussianRandom();
    this.value += drift + diffusion;
    this.value = Math.max(-25, Math.min(10, this.value));
    return this.value;
  }
}

class MeteorScatterState {
  private burstRemainingMs = 0;
  private boostDb = 0;

  step(
    dtMs: number,
    chancePerSecond: number,
  ): { active: boolean; boostDb: number; justStarted: boolean } {
    if (this.burstRemainingMs > 0) {
      this.burstRemainingMs -= dtMs;
      // Exponential decay back to baseline over the burst.
      this.boostDb *= Math.exp(-dtMs / 250);
      return { active: true, boostDb: this.boostDb, justStarted: false };
    }
    const p = chancePerSecond * (dtMs / 1000);
    if (Math.random() < p) {
      this.burstRemainingMs = 200 + Math.random() * 1500;
      this.boostDb = 22 + Math.random() * 14;
      return { active: true, boostDb: this.boostDb, justStarted: true };
    }
    return { active: false, boostDb: 0, justStarted: false };
  }
}

/**
 * Rapid, shallow amplitude flutter -- the fast jittery fading heard on
 * disturbed-ionosphere/high-latitude paths, distinct from slow QSB. Bursts
 * are more frequent the more disturbed geomagnetic conditions are (higher
 * real-world Kp).
 */
class FlutterState {
  private remainingMs = 0;
  private phase = 0;

  step(
    dtMs: number,
    chancePerSecond: number,
    kpFactor: number,
  ): { active: boolean; deltaDb: number; justStarted: boolean } {
    if (this.remainingMs > 0) {
      this.remainingMs -= dtMs;
      this.phase += dtMs * (0.006 + kpFactor * 0.01);
      const deltaDb = Math.sin(this.phase * 2 * Math.PI) * (3 + kpFactor * 4);
      return { active: true, deltaDb, justStarted: false };
    }
    const p = chancePerSecond * (dtMs / 1000);
    if (Math.random() < p) {
      this.remainingMs = 3000 + Math.random() * 12000;
      this.phase = 0;
      return { active: true, deltaDb: 0, justStarted: true };
    }
    return { active: false, deltaDb: 0, justStarted: false };
  }
}

function gaussianRandom(): number {
  // Box-Muller transform.
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Groundwave signal: strong out to `rangeKm`, then rolls off steeply once past it. */
export function groundwaveDb(distanceKm: number, rangeKm: number): number {
  const t = distanceKm / rangeKm;
  return -6 * t - Math.max(0, t - 1) * 40;
}

/**
 * Skywave signal: the usual distance-based log falloff, but heavily
 * attenuated inside `skipDistanceKm` -- there's no ionospheric reflection
 * point that close in, so a real skywave hop can't land there yet.
 */
export function skywaveDb(distanceKm: number, skipDistanceKm: number): number {
  const base = -18 * Math.log10(1 + distanceKm / 40);
  const skipPenalty =
    distanceKm < skipDistanceKm ? (1 - distanceKm / skipDistanceKm) * 35 : 0;
  return base - skipPenalty;
}

/** How noticeably each mode's demodulator reveals frequency-selective multipath fading (SSB most, FM's capture effect least). */
const MULTIPATH_SUSCEPTIBILITY: Record<Mode, number> = {
  USB: 1,
  LSB: 1,
  AM: 0.6,
  CW: 0.15,
  RTTY: 0.2,
  DATA: 0.3,
  FM: 0.05,
};

const REFERENCE_POWER_WATTS = 100;

/** dB contribution of transmit power relative to a 100W reference (10dB per decade). */
function txPowerGainDb(watts: number): number {
  const clamped = Math.max(1, watts);
  return 10 * Math.log10(clamped / REFERENCE_POWER_WATTS);
}

/**
 * dB of signal lost to a mismatched antenna: the real reflected-power loss
 * from the VSWR, plus (above 3:1) the extra foldback a transceiver applies
 * to protect its finals from a bad match.
 */
function swrLossDb(swr: number): number {
  const s = Math.max(1, swr);
  const reflectionCoeff = (s - 1) / (s + 1);
  const reflectedFraction = reflectionCoeff * reflectionCoeff;
  const mismatchLossDb = -10 * Math.log10(Math.max(1e-6, 1 - reflectedFraction));
  const foldbackDb = s > 3 ? (s - 3) * 2.5 : 0;
  return mismatchLossDb + foldbackDb;
}

/**
 * Simplified propagation simulation. This is not a physically accurate
 * ionospheric model -- it's a set of tunable heuristics chosen to *feel*
 * like real HF: groundwave/skywave path loss (with a genuine skip-zone dead
 * spot between them), day/night + band-dependent absorption/skip, real
 * NOAA solar flux/K-index driving how well the high bands open up, slow
 * QSB fading and rapid Kp-linked flutter per station pair, random meteor
 * scatter bursts and band-wide sporadic-E openings on the bands prone to
 * them, and each transmitter's actual power/antenna/SWR.
 */
export class PropagationEngine {
  private fades = new Map<string, FadeProcess>();
  private meteors = new Map<string, MeteorScatterState>();
  private flutters = new Map<string, FlutterState>();

  constructor(private sporadicE: SporadicEEngine) {}

  private keyFor(txId: string, rxId: string): string {
    return `${txId}:${rxId}`;
  }

  compute(input: PropagationInput, nowMs: number, dtMs: number): PropagationResult {
    const passband = passbandKHz(input.rxMode, input.rxFilterWidth);
    const halfPassband = passband / 2;
    const offsetKHz = Math.abs(input.txFreqKHz - input.rxFreqKHz);
    // A signal outside the exact passband isn't just silenced -- a station
    // close enough in frequency still leaks in as distorted adjacent-channel
    // splatter, the way a real receiver filter's skirt (or an overdriven tx)
    // lets nearby signals bleed through. Only genuinely out-of-range signals
    // are fully silent.
    const splatterRangeKHz = halfPassband * 3;
    if (offsetKHz > halfPassband + splatterRangeKHz) {
      return {
        inPassband: false,
        signalDb: -999,
        meteorScatterActive: false,
        meteorScatterJustStarted: false,
        flutterActive: false,
        flutterJustStarted: false,
        multipathDepth: 0,
        splatterZone: false,
      };
    }
    const inPassband = offsetKHz <= halfPassband;
    const splatterZone = !inPassband;
    const splatterPenaltyDb = splatterZone
      ? ((offsetKHz - halfPassband) / splatterRangeKHz) * 45
      : 0;

    const key = this.keyFor(input.txId, input.rxId);
    const distanceKm = gridDistanceKm(input.txGrid, input.rxGrid);

    const txLoc = gridToLatLon(input.txGrid);
    const rxLoc = gridToLatLon(input.rxGrid);
    const txDaylight = daylightFactor(localSolarHour(txLoc.lon, nowMs));
    const rxDaylight = daylightFactor(localSolarHour(rxLoc.lon, nowMs));
    const avgDaylight = (txDaylight + rxDaylight) / 2;

    const flux = getNormalizedSolarFlux();
    const band = input.band;

    // On bands whose regular skip depends on reaching an unusually high MUF
    // (17m upward), the real F10.7cm flux either supports that or it
    // doesn't -- there's no amount of "well, it's a bit better at night" that
    // gets 10m open on a dead solar-minimum day. Ramp the skywave path
    // itself out as flux falls short of the band's threshold (groundwave is
    // untouched -- local/regional contacts don't care about the MUF), so
    // these bands genuinely go silent for skip rather than just quieter,
    // matching how real ops describe them as "closed" outside sporadic-E or
    // meteor-scatter pings (both separate, additive boosts below that still
    // get through even while the band is otherwise dead).
    const sfi = getSolarConditions().sfi;
    const mufOpenFraction = band.minSfiForSkip
      ? Math.max(0, Math.min(1, (sfi - (band.minSfiForSkip - 15)) / 30))
      : 1;
    const mufShutdownDb = (1 - mufOpenFraction) * 45;

    // Baseline path loss is the stronger of groundwave (dominant close in,
    // rolls off steeply past the band's typical groundwave range) or
    // skywave (heavily attenuated inside the band's typical skip distance,
    // then the usual gentle log falloff beyond it, and further crushed by
    // mufShutdownDb if the MUF can't support it). Between the two lies the
    // classic "skip zone" dead spot: too far for groundwave, too close for
    // the first skywave hop to land.
    const pathLossDb = Math.max(
      groundwaveDb(distanceKm, band.groundwaveRangeKm),
      skywaveDb(distanceKm, band.skipDistanceKm) - mufShutdownDb,
    );

    // Low bands (160/80/40) suffer daytime D-layer absorption but open up
    // for DX at night. High bands (15/12/10/6) need daylight to support
    // long skip, and are close to dead at night without a meteor scatter
    // assist. The real day/night cycle (avgDaylight, driven by each
    // station's actual local time) is the dominant term; the compressed
    // solar-flux index only nudges the daytime skip bonus up or down a
    // little, so a band's fate is never flipped purely by the fast flux
    // cycle -- only by whether it's actually day or night.
    const nightBonus = band.nighttimeDx * (1 - avgDaylight) * 14;
    const dayAbsorptionPenalty = band.daytimeAbsorption * avgDaylight * 10;
    const highBandDaylightNeed = band.meteorScatterProne ? 1 : 1 - band.daytimeAbsorption;
    const skipBonus = highBandDaylightNeed * avgDaylight * (4 + (flux - 0.35) * 10);

    let fade = this.fades.get(key);
    if (!fade) {
      fade = new FadeProcess();
      this.fades.set(key, fade);
    }
    // Fade a little faster/deeper the further the signal has to travel.
    const fadeSigma = 1.2 + Math.min(distanceKm / 2000, 1) * 2.5;
    const fadeDb = fade.step(dtMs / 1000, 0.08, fadeSigma);

    let meteor = this.meteors.get(key);
    if (!meteor) {
      meteor = new MeteorScatterState();
      this.meteors.set(key, meteor);
    }
    const meteorChancePerSecond = band.meteorScatterProne ? 0.03 : 0.002;
    const {
      active: meteorScatterActive,
      boostDb: meteorBoostDb,
      justStarted: meteorScatterJustStarted,
    } = meteor.step(dtMs, meteorChancePerSecond);

    // Sporadic-E: a band-wide opening (tracked centrally, not per station
    // pair) rather than a per-pair random process -- distinct from meteor
    // scatter above.
    const sporadicEBoostDb = this.sporadicE.boostDb(band.id, distanceKm);

    // Flutter: rapid, shallow fast-fading distinct from the slow QSB fade
    // above. More frequent when real-world geomagnetic conditions (Kp) are
    // disturbed.
    let flutter = this.flutters.get(key);
    if (!flutter) {
      flutter = new FlutterState();
      this.flutters.set(key, flutter);
    }
    const kp = getSolarConditions().kp;
    const kpFactor = Math.max(0, Math.min(1, (kp - 3) / 6));
    const flutterChancePerSecond = 0.0004 + kpFactor * 0.004;
    const {
      active: flutterActive,
      deltaDb: flutterDb,
      justStarted: flutterJustStarted,
    } = flutter.step(dtMs, flutterChancePerSecond, kpFactor);

    // Directional antenna gain: how much each end's antenna actually favors
    // the bearing toward the other station, given where it's pointed.
    // Omnidirectional types (wire antennas, verticals) ignore heading
    // entirely and just contribute their flat gain.
    const txAntenna = antennaById(input.txAntenna) ?? antennaById(DEFAULT_ANTENNA)!;
    const rxAntenna = antennaById(input.rxAntenna) ?? antennaById(DEFAULT_ANTENNA)!;
    const bearingTxToRx = gridBearingDeg(input.txGrid, input.rxGrid);
    const bearingRxToTx = gridBearingDeg(input.rxGrid, input.txGrid);
    const txAntennaGainDb = antennaGainDb(txAntenna, input.txHeadingDeg, bearingTxToRx);
    const rxAntennaGainDb = antennaGainDb(rxAntenna, input.rxHeadingDeg, bearingRxToTx);

    // Mounting height shifts the takeoff angle: tall antennas favour the
    // shallow-angle hop long DX needs, low antennas favour the steep NVIS
    // hop shorter regional contacts use instead.
    const txHeightGainDb = antennaHeightGainDb(txAntenna, distanceKm);
    const rxHeightGainDb = antennaHeightGainDb(rxAntenna, distanceKm);

    // The actual RF power knob setting and the transmitter's antenna match
    // now really do change what the far end hears, instead of only being
    // cosmetic client-side state.
    const powerDb = txPowerGainDb(input.txPowerWatts);
    const swrLoss = swrLossDb(input.txSwr);

    const signalDb =
      pathLossDb -
      dayAbsorptionPenalty +
      nightBonus +
      skipBonus +
      fadeDb +
      meteorBoostDb +
      sporadicEBoostDb +
      flutterDb +
      txAntennaGainDb +
      rxAntennaGainDb +
      txHeightGainDb +
      rxHeightGainDb +
      powerDb -
      swrLoss -
      splatterPenaltyDb;

    // Frequency-selective ("underwater") multipath fading gets more
    // pronounced the further the signal has travelled, and is far more
    // audible on some demodulators (SSB) than others (FM's capture effect).
    const multipathDepth =
      Math.min(1, distanceKm / 3000) * MULTIPATH_SUSCEPTIBILITY[input.rxMode];

    return {
      inPassband,
      signalDb,
      meteorScatterActive,
      meteorScatterJustStarted,
      flutterActive,
      flutterJustStarted,
      multipathDepth,
      splatterZone,
    };
  }

  /** Drop cached fade/meteor/flutter state for a station pair, e.g. on disconnect. */
  forget(id: string): void {
    for (const key of [...this.fades.keys()]) {
      if (key.startsWith(`${id}:`) || key.endsWith(`:${id}`)) this.fades.delete(key);
    }
    for (const key of [...this.meteors.keys()]) {
      if (key.startsWith(`${id}:`) || key.endsWith(`:${id}`)) this.meteors.delete(key);
    }
    for (const key of [...this.flutters.keys()]) {
      if (key.startsWith(`${id}:`) || key.endsWith(`:${id}`)) this.flutters.delete(key);
    }
  }
}
