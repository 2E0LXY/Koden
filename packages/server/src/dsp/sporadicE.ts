import type { Band } from "@koden/shared";

interface BandEsState {
  active: boolean;
  remainingMs: number;
  boostDb: number;
}

const ES_MIN_RANGE_KM = 400;
const ES_MAX_RANGE_KM = 2200;
const ES_CHANCE_PER_SECOND = 0.0006;
const ES_MIN_DURATION_MS = 4 * 60 * 1000;
const ES_MAX_DURATION_MS = 35 * 60 * 1000;

/**
 * Real sporadic-E is strongly seasonal: it peaks hard in Northern-hemisphere
 * summer (roughly late May-August, when most of the world's Es-chasing ham
 * population sees it) and is markedly rarer the rest of the year. A single
 * global calendar curve is a simplification (the Southern hemisphere's own
 * summer peak six months later is real too), but a single dominant peak
 * beats no seasonality at all. Returns a multiplier on the base per-second
 * chance: ~0.35x in deep winter, 1x at the equinoxes, ~1.9x at the summer
 * peak.
 */
function seasonalEsFactor(nowMs: number): number {
  const date = new Date(nowMs);
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const daysThisYear = Math.round((Date.UTC(date.getUTCFullYear() + 1, 0, 1) - startOfYear) / 86_400_000);
  const dayOfYear = Math.floor((nowMs - startOfYear) / 86_400_000);
  const phase = (dayOfYear / daysThisYear) * 2 * Math.PI - (172 / 365) * 2 * Math.PI; // peak ~June 21
  return 1.125 + 0.775 * Math.cos(phase);
}

export interface SporadicEEvent {
  bandId: string;
  kind: "band_opening" | "band_closing";
}

/**
 * Tracks sporadic-E band openings independently per band. Unlike meteor
 * scatter (a per-station-pair, sub-second ping off a single meteor trail),
 * Es forms as a regional ionised patch: while one is active, every station
 * pair 400-2200km apart on a prone band gets a strong, sustained boost, as
 * if the band had briefly opened for everyone in range.
 */
export class SporadicEEngine {
  private states = new Map<string, BandEsState>();

  private stateFor(bandId: string): BandEsState {
    let state = this.states.get(bandId);
    if (!state) {
      state = { active: false, remainingMs: 0, boostDb: 0 };
      this.states.set(bandId, state);
    }
    return state;
  }

  /** Advance every Es-prone band's state by one tick; returns any open/close transitions to announce. */
  tick(bands: Band[], dtMs: number, nowMs: number): SporadicEEvent[] {
    const events: SporadicEEvent[] = [];
    const seasonalFactor = seasonalEsFactor(nowMs);
    for (const band of bands) {
      if (!band.sporadicEProne) continue;
      const state = this.stateFor(band.id);
      if (state.active) {
        state.remainingMs -= dtMs;
        if (state.remainingMs <= 0) {
          state.active = false;
          state.boostDb = 0;
          events.push({ bandId: band.id, kind: "band_closing" });
        }
      } else if (Math.random() < ES_CHANCE_PER_SECOND * seasonalFactor * (dtMs / 1000)) {
        state.active = true;
        state.remainingMs =
          ES_MIN_DURATION_MS + Math.random() * (ES_MAX_DURATION_MS - ES_MIN_DURATION_MS);
        state.boostDb = 22 + Math.random() * 14;
        events.push({ bandId: band.id, kind: "band_opening" });
      }
    }
    return events;
  }

  /** Signal boost (dB) a path on this band should get from an active Es opening, given the path distance. */
  boostDb(bandId: string, distanceKm: number): number {
    const state = this.states.get(bandId);
    if (!state?.active) return 0;
    if (distanceKm < ES_MIN_RANGE_KM || distanceKm > ES_MAX_RANGE_KM) return 0;
    return state.boostDb;
  }
}
