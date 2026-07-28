/**
 * A real solar cycle runs ~11 years -- far too slow to ever observe in a
 * live session. This simulates a compressed "solar flux index" (0..1) that
 * oscillates on a much shorter period so band openings/closings are
 * actually observable over a longer session, while still being a smooth,
 * deterministic (shared across all stations) function of time.
 *
 * This is deliberately a *secondary* modifier on top of the real day/night
 * cycle (see daylightFactor/localSolarHour), not a replacement for it --
 * the period is slow enough (tens of minutes) that it reads as "today's
 * conditions are a bit better/worse than usual" rather than a band
 * flickering open and closed every few minutes regardless of the actual
 * time of day at either station.
 */
const DEFAULT_PERIOD_MS = 40 * 60 * 1000;

export function solarFluxIndex(nowMs: number, periodMs = DEFAULT_PERIOD_MS): number {
  const t = nowMs / periodMs;
  const s =
    0.5 +
    0.3 * Math.sin(2 * Math.PI * t) +
    0.15 * Math.sin(2 * Math.PI * t * 2.7 + 1.3) +
    0.1 * Math.sin(2 * Math.PI * t * 0.37);
  return Math.min(1, Math.max(0, s));
}
