export type Mode = "USB" | "LSB" | "CW" | "AM" | "FM" | "RTTY" | "DATA";

export interface Band {
  id: string;
  name: string;
  /** Inclusive frequency range in kHz. */
  rangeKHz: [number, number];
  defaultMode: Mode;
  allowedModes: Mode[];
  /** Relative ionospheric absorption during daylight (0 = none, 1 = severe). Lower bands suffer more D-layer absorption by day. */
  daytimeAbsorption: number;
  /** Relative skip/DX potential at night (0 = poor, 1 = excellent). */
  nighttimeDx: number;
  /** How prone this band is to short, random meteor-scatter pings off meteor trails. */
  meteorScatterProne: boolean;
  /** Baseline atmospheric/thermal noise floor in dB above a common reference; lower HF is noisier. */
  baseNoiseFloorDb: number;
  /** Typical range (km) within which groundwave (not skywave) carries the signal. */
  groundwaveRangeKm: number;
  /** Typical distance (km) to the first skywave hop; closer than this is the "skip zone" dead spot between groundwave and skywave. */
  skipDistanceKm: number;
  /** Whether this band gets sporadic-E short-skip openings (distinct from meteor scatter): a regional ionised patch that suddenly opens the band for everyone within range, for minutes at a time. */
  sporadicEProne: boolean;
}

export const BANDS: Band[] = [
  {
    id: "160m",
    name: "160 Meters",
    rangeKHz: [1800, 2000],
    defaultMode: "LSB",
    allowedModes: ["LSB", "CW", "RTTY", "DATA"],
    daytimeAbsorption: 0.95,
    nighttimeDx: 0.8,
    meteorScatterProne: false,
    baseNoiseFloorDb: -25,
    groundwaveRangeKm: 60,
    skipDistanceKm: 150,
    sporadicEProne: false,
  },
  {
    id: "80m",
    name: "80 Meters",
    rangeKHz: [3500, 4000],
    defaultMode: "LSB",
    allowedModes: ["LSB", "CW", "RTTY", "DATA"],
    daytimeAbsorption: 0.85,
    nighttimeDx: 0.85,
    meteorScatterProne: false,
    baseNoiseFloorDb: -30,
    groundwaveRangeKm: 45,
    skipDistanceKm: 200,
    sporadicEProne: false,
  },
  {
    id: "40m",
    name: "40 Meters",
    rangeKHz: [7000, 7300],
    defaultMode: "LSB",
    allowedModes: ["LSB", "CW", "AM", "RTTY", "DATA"],
    daytimeAbsorption: 0.6,
    nighttimeDx: 0.9,
    meteorScatterProne: false,
    baseNoiseFloorDb: -35,
    groundwaveRangeKm: 35,
    skipDistanceKm: 300,
    sporadicEProne: false,
  },
  {
    id: "30m",
    name: "30 Meters",
    rangeKHz: [10100, 10150],
    defaultMode: "CW",
    allowedModes: ["CW", "RTTY", "DATA"],
    daytimeAbsorption: 0.4,
    nighttimeDx: 0.88,
    meteorScatterProne: false,
    baseNoiseFloorDb: -37,
    groundwaveRangeKm: 25,
    skipDistanceKm: 500,
    sporadicEProne: false,
  },
  {
    id: "20m",
    name: "20 Meters",
    rangeKHz: [14000, 14350],
    defaultMode: "USB",
    allowedModes: ["USB", "CW", "RTTY", "DATA"],
    daytimeAbsorption: 0.25,
    nighttimeDx: 0.5,
    meteorScatterProne: false,
    baseNoiseFloorDb: -40,
    groundwaveRangeKm: 20,
    skipDistanceKm: 800,
    sporadicEProne: false,
  },
  {
    id: "17m",
    name: "17 Meters",
    rangeKHz: [18068, 18168],
    defaultMode: "USB",
    allowedModes: ["USB", "CW", "RTTY", "DATA"],
    daytimeAbsorption: 0.2,
    nighttimeDx: 0.35,
    meteorScatterProne: false,
    baseNoiseFloorDb: -43,
    groundwaveRangeKm: 18,
    skipDistanceKm: 1000,
    sporadicEProne: false,
  },
  {
    id: "15m",
    name: "15 Meters",
    rangeKHz: [21000, 21450],
    defaultMode: "USB",
    allowedModes: ["USB", "CW", "RTTY", "DATA"],
    daytimeAbsorption: 0.15,
    nighttimeDx: 0.2,
    meteorScatterProne: false,
    baseNoiseFloorDb: -45,
    groundwaveRangeKm: 15,
    skipDistanceKm: 1200,
    sporadicEProne: false,
  },
  {
    id: "12m",
    name: "12 Meters",
    rangeKHz: [24890, 24990],
    defaultMode: "USB",
    allowedModes: ["USB", "CW", "RTTY", "DATA"],
    daytimeAbsorption: 0.1,
    nighttimeDx: 0.1,
    meteorScatterProne: true,
    baseNoiseFloorDb: -47,
    groundwaveRangeKm: 12,
    skipDistanceKm: 1500,
    sporadicEProne: false,
  },
  {
    id: "10m",
    name: "10 Meters",
    rangeKHz: [28000, 29700],
    defaultMode: "USB",
    allowedModes: ["USB", "CW", "FM", "AM", "RTTY", "DATA"],
    daytimeAbsorption: 0.05,
    nighttimeDx: 0.05,
    meteorScatterProne: true,
    baseNoiseFloorDb: -50,
    groundwaveRangeKm: 10,
    skipDistanceKm: 1800,
    sporadicEProne: true,
  },
  {
    id: "6m",
    name: "6 Meters",
    rangeKHz: [50000, 54000],
    defaultMode: "USB",
    allowedModes: ["USB", "CW", "FM", "DATA"],
    daytimeAbsorption: 0.02,
    nighttimeDx: 0.02,
    meteorScatterProne: true,
    baseNoiseFloorDb: -55,
    groundwaveRangeKm: 8,
    skipDistanceKm: 1500,
    sporadicEProne: true,
  },
];

export function findBand(freqKHz: number): Band | undefined {
  return BANDS.find(
    (b) => freqKHz >= b.rangeKHz[0] && freqKHz <= b.rangeKHz[1],
  );
}

/**
 * Like findBand, but never returns undefined -- falls back to whichever
 * band's range is closest when tuned into a gap between amateur
 * allocations. A real receiver still picks up *something* (broadcast
 * stations, other services, at minimum residual noise) everywhere across
 * the RF spectrum; it doesn't go dead silent between ham bands the way
 * skipping noise generation entirely would.
 */
export function nearestBand(freqKHz: number): Band {
  const exact = findBand(freqKHz);
  if (exact) return exact;
  let best = BANDS[0];
  let bestDistance = Infinity;
  for (const b of BANDS) {
    const distance =
      freqKHz < b.rangeKHz[0] ? b.rangeKHz[0] - freqKHz : freqKHz - b.rangeKHz[1];
    if (distance < bestDistance) {
      bestDistance = distance;
      best = b;
    }
  }
  return best;
}

export function bandById(id: string): Band | undefined {
  return BANDS.find((b) => b.id === id);
}
