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
  /** How prone this band is to short, random sporadic-E / meteor-scatter style openings. */
  meteorScatterProne: boolean;
  /** Baseline atmospheric/thermal noise floor in dB above a common reference; lower HF is noisier. */
  baseNoiseFloorDb: number;
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
  },
];

export function findBand(freqKHz: number): Band | undefined {
  return BANDS.find(
    (b) => freqKHz >= b.rangeKHz[0] && freqKHz <= b.rangeKHz[1],
  );
}

export function bandById(id: string): Band | undefined {
  return BANDS.find((b) => b.id === id);
}
