/**
 * Real solar-terrestrial conditions from NOAA SWPC (the same public data
 * real HF operators check before a session), refreshed periodically and
 * cached in memory. This replaces an earlier fake, artificially fast solar
 * cycle -- band openings are now driven by whatever the ionosphere is
 * actually doing right now.
 *
 * - F10.7cm solar flux (SFU, roughly 65 at solar minimum to 250+ near solar
 *   maximum): higher flux means more ionization, supporting higher MUF and
 *   better high-band (15/12/10/6m) skip.
 * - Planetary K-index (0-9): higher means more geomagnetically disturbed.
 *   Above quiet levels it increasingly suppresses high-band skip and
 *   degrades high-latitude/polar paths.
 */

export interface SolarConditions {
  sfi: number;
  kp: number;
  updatedAt: number;
}

const FLUX_URL = "https://services.swpc.noaa.gov/products/summary/10cm-flux.json";
const KP_URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json";
const REFRESH_MS = 10 * 60 * 1000;

// Reasonable "moderate, quiet" defaults so the sim behaves sensibly before
// the first successful fetch, or indefinitely if NOAA is unreachable.
let current: SolarConditions = { sfi: 120, kp: 2, updatedAt: 0 };

function sfiNormalized(sfi: number): number {
  return Math.max(0, Math.min(1, (sfi - 70) / (220 - 70)));
}

function kpPenalty(kp: number): number {
  // Quiet-to-unsettled (Kp <= 2) has negligible impact; rising geomagnetic
  // activity beyond that increasingly suppresses high-band skip.
  return Math.max(0, Math.min(1, (kp - 2) / 6));
}

/** Normalized 0..1 "how favorable is high-band skip right now" score, combining real flux and geomagnetic activity. */
export function getNormalizedSolarFlux(): number {
  const base = sfiNormalized(current.sfi);
  const penalty = kpPenalty(current.kp) * 0.6;
  return Math.max(0, base * (1 - penalty));
}

export function getSolarConditions(): SolarConditions {
  return current;
}

interface FluxEntry {
  flux: number;
  time_tag: string;
}
interface KpEntry {
  Kp: number;
  time_tag: string;
}

async function refresh(): Promise<void> {
  try {
    const [fluxRes, kpRes] = await Promise.all([fetch(FLUX_URL), fetch(KP_URL)]);
    if (!fluxRes.ok || !kpRes.ok) {
      throw new Error(`NOAA responded ${fluxRes.status}/${kpRes.status}`);
    }
    const fluxData = (await fluxRes.json()) as FluxEntry[];
    const kpData = (await kpRes.json()) as KpEntry[];
    const sfi = fluxData[0]?.flux;
    const kp = kpData[kpData.length - 1]?.Kp;
    if (typeof sfi === "number" && typeof kp === "number") {
      current = { sfi, kp, updatedAt: Date.now() };
      console.log(`[solar] SFI ${sfi}, Kp ${kp.toFixed(1)} (favorability ${getNormalizedSolarFlux().toFixed(2)})`);
    }
  } catch (err) {
    console.warn("[solar] Failed to refresh NOAA solar data, keeping last known values:", err);
  }
}

/** Kick off the initial fetch and periodic refresh. Call once at server startup. */
export function startSolarDataRefresh(): void {
  void refresh();
  setInterval(() => void refresh(), REFRESH_MS);
}
