import type { Band } from "@koden/shared";
import { hashFrac } from "./noise.js";

/** Fixed signal level of a QRM spur at its exact frequency -- weak, well below the beacon/parrot, but clearly above the noise floor once tuned onto it. */
export const QRM_SIGNAL_DB = -30;
/** How far a spur's level tapers before it fades below the audible threshold -- narrow, so it reads as a specific frequency you tune into and out of, not a wide splash. */
export const QRM_BANDWIDTH_KHZ = 0.6;

const QRM_SPURS_PER_BAND = 2;

/**
 * Deterministic fixed-frequency interference spurs within a band -- like a
 * birdie or a bleed-through carrier, present at the same real dial frequency
 * every time (not per-listener random), unlike the ambient noise floor which
 * is uniform across the whole band regardless of exact tuning. Kept clear of
 * the band edges.
 */
export function qrmSpursForBand(band: Band): number[] {
  const [lo, hi] = band.rangeKHz;
  const span = hi - lo;
  const spurs: number[] = [];
  for (let i = 0; i < QRM_SPURS_PER_BAND; i++) {
    const frac = 0.15 + hashFrac(`qrm:${band.id}:${i}`) * 0.7;
    spurs.push(lo + frac * span);
  }
  return spurs;
}

/** Signal level (this app's internal dB scale) for a spur at `spurFreqKHz` given a receiver tuned to `rxFreqKHz` -- a quadratic taper from QRM_SIGNAL_DB at dead centre down to well below threshold at the edge of QRM_BANDWIDTH_KHZ. */
export function qrmLevelDb(spurFreqKHz: number, rxFreqKHz: number): number {
  const offsetKHz = Math.abs(spurFreqKHz - rxFreqKHz);
  const halfWidth = QRM_BANDWIDTH_KHZ / 2;
  if (offsetKHz > halfWidth) return -999;
  const t = offsetKHz / halfWidth;
  return QRM_SIGNAL_DB - t * t * 15;
}
