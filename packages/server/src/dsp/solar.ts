/**
 * A real solar cycle runs ~11 years -- far too slow to ever observe in a
 * live session. This simulates a compressed "solar flux index" (0..1) that
 * oscillates on a much shorter period so band openings/closings are
 * actually observable during a demo/test session, while still being a
 * smooth, deterministic (shared across all stations) function of time.
 */
const DEFAULT_PERIOD_MS = 8 * 60 * 1000;

export function solarFluxIndex(nowMs: number, periodMs = DEFAULT_PERIOD_MS): number {
  const t = nowMs / periodMs;
  const s =
    0.5 +
    0.3 * Math.sin(2 * Math.PI * t) +
    0.15 * Math.sin(2 * Math.PI * t * 2.7 + 1.3) +
    0.1 * Math.sin(2 * Math.PI * t * 0.37);
  return Math.min(1, Math.max(0, s));
}
