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
  tick(bands: Band[], dtMs: number): SporadicEEvent[] {
    const events: SporadicEEvent[] = [];
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
      } else if (Math.random() < ES_CHANCE_PER_SECOND * (dtMs / 1000)) {
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
