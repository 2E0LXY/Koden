import {
  type AntennaId,
  type Band,
  type FilterWidth,
  type Mode,
  DEFAULT_ANTENNA,
  antennaById,
  antennaGainDb,
  daylightFactor,
  gridBearingDeg,
  gridDistanceKm,
  gridToLatLon,
  localSolarHour,
} from "@koden/shared";
import { solarFluxIndex } from "./solar.js";

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

function gaussianRandom(): number {
  // Box-Muller transform.
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Simplified propagation simulation. This is not a physically accurate
 * ionospheric model -- it's a set of tunable heuristics chosen to *feel*
 * like real HF: distance-based path loss, day/night + band-dependent
 * absorption/skip, a compressed "solar cycle" driving how well the high
 * bands open up, slow QSB fading per station pair, and random meteor
 * scatter bursts on the bands prone to them.
 */
export class PropagationEngine {
  private fades = new Map<string, FadeProcess>();
  private meteors = new Map<string, MeteorScatterState>();

  private keyFor(txId: string, rxId: string): string {
    return `${txId}:${rxId}`;
  }

  compute(input: PropagationInput, nowMs: number, dtMs: number): PropagationResult {
    const passband = passbandKHz(input.rxMode, input.rxFilterWidth);
    const inPassband = Math.abs(input.txFreqKHz - input.rxFreqKHz) <= passband / 2;
    if (!inPassband) {
      return {
        inPassband: false,
        signalDb: -999,
        meteorScatterActive: false,
        meteorScatterJustStarted: false,
      };
    }

    const key = this.keyFor(input.txId, input.rxId);
    const distanceKm = gridDistanceKm(input.txGrid, input.rxGrid);

    const txLoc = gridToLatLon(input.txGrid);
    const rxLoc = gridToLatLon(input.rxGrid);
    const txDaylight = daylightFactor(localSolarHour(txLoc.lon, nowMs));
    const rxDaylight = daylightFactor(localSolarHour(rxLoc.lon, nowMs));
    const avgDaylight = (txDaylight + rxDaylight) / 2;

    const flux = solarFluxIndex(nowMs);
    const band = input.band;

    // Baseline path loss: gentle log falloff, tuned so "local" (<50km)
    // contacts are essentially full-strength and DX (thousands of km)
    // contacts depend heavily on band/propagation conditions.
    const pathLossDb = -18 * Math.log10(1 + distanceKm / 40);

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

    const signalDb =
      pathLossDb -
      dayAbsorptionPenalty +
      nightBonus +
      skipBonus +
      fadeDb +
      meteorBoostDb +
      txAntennaGainDb +
      rxAntennaGainDb;

    return { inPassband: true, signalDb, meteorScatterActive, meteorScatterJustStarted };
  }

  /** Drop cached fade/meteor state for a station pair, e.g. on disconnect. */
  forget(id: string): void {
    for (const key of [...this.fades.keys()]) {
      if (key.startsWith(`${id}:`) || key.endsWith(`:${id}`)) this.fades.delete(key);
    }
    for (const key of [...this.meteors.keys()]) {
      if (key.startsWith(`${id}:`) || key.endsWith(`:${id}`)) this.meteors.delete(key);
    }
  }
}
