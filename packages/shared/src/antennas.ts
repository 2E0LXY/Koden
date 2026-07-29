export type AntennaId =
  | "longwire"
  | "vertical"
  | "dipole"
  | "g5rv"
  | "yagi-small"
  | "yagi-3el"
  | "yagi-5el";

export interface AntennaType {
  id: AntennaId;
  name: string;
  rotatable: boolean;
  /** Peak gain in dBi (boresight gain for beams, overall gain for omni types). */
  gainDbi: number;
  /** -3dB beamwidth of the main lobe, degrees. Only set for rotatable (directional) antennas. */
  beamwidthDeg?: number;
  /** How much weaker the backlobe (180 deg off boresight) is, in dB. Only set for directional antennas. */
  frontToBackDb?: number;
  /** Relative adjustment to the ambient noise floor when receiving on this antenna (dB); verticals/longwires are noisier, beams and dipoles are quieter. */
  noiseFloorAdjustDb: number;
  /** Typical mounting height above ground, metres. Higher antennas radiate at a lower takeoff angle (better long-haul DX); lower antennas favour steep NVIS-angle regional propagation instead. */
  heightM: number;
  description: string;
}

export const DEFAULT_ANTENNA: AntennaId = "dipole";

export const ANTENNAS: AntennaType[] = [
  {
    id: "longwire",
    name: "Longwire",
    rotatable: false,
    gainDbi: 0,
    noiseFloorAdjustDb: 2,
    heightM: 8,
    description:
      "End-fed random wire. Works after a fashion on every band and hears everything -- including all the local noise.",
  },
  {
    id: "vertical",
    name: "Vertical",
    rotatable: false,
    gainDbi: 1,
    noiseFloorAdjustDb: 3,
    heightM: 0,
    description:
      "Omnidirectional ground-mounted vertical. Low take-off angle is good for DX, but verticals are notoriously noisy.",
  },
  {
    id: "dipole",
    name: "Dipole",
    rotatable: false,
    gainDbi: 2.1,
    noiseFloorAdjustDb: -2,
    heightM: 10,
    description: "Classic centre-fed half-wave dipole. Quiet and effective, cut for one band.",
  },
  {
    id: "g5rv",
    name: "G5RV",
    rotatable: false,
    gainDbi: 2,
    noiseFloorAdjustDb: -1,
    heightM: 12,
    description:
      "Multi-band centre-fed dipole fed with ladder line. A solid all-rounder from 80m through 10m.",
  },
  {
    id: "yagi-small",
    name: "2-el Yagi",
    rotatable: true,
    gainDbi: 5.5,
    beamwidthDeg: 76,
    frontToBackDb: 12,
    noiseFloorAdjustDb: -3,
    heightM: 15,
    description: "Compact 2-element beam. Modest gain and a wide beamwidth, easy to swing around.",
  },
  {
    id: "yagi-3el",
    name: "3-el Yagi",
    rotatable: true,
    gainDbi: 7.5,
    beamwidthDeg: 56,
    frontToBackDb: 20,
    noiseFloorAdjustDb: -4,
    heightM: 18,
    description: "The classic tribander. Solid gain and front-to-back ratio.",
  },
  {
    id: "yagi-5el",
    name: "5-el Yagi",
    rotatable: true,
    gainDbi: 9.5,
    beamwidthDeg: 42,
    frontToBackDb: 26,
    noiseFloorAdjustDb: -5,
    heightM: 20,
    description: "Long monobander. Sharp pattern and serious gain for serious DX.",
  },
];

export function antennaById(id: string): AntennaType | undefined {
  return ANTENNAS.find((a) => a.id === id);
}

function angularDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Effective gain of `antenna` in the direction `bearingDeg`, given it's
 * currently pointed at `headingDeg`. Omnidirectional antennas ignore both
 * angles and just return their flat gain. Directional (Yagi) antennas get a
 * quadratic taper across the main lobe out to its -3dB beamwidth edge, a
 * linear glide through the sidelobe region, and a fixed front-to-back
 * attenuation once you're within 30 degrees of the backlobe.
 */
export function antennaGainDb(antenna: AntennaType, headingDeg: number, bearingDeg: number): number {
  if (!antenna.rotatable || antenna.beamwidthDeg === undefined) {
    return antenna.gainDbi;
  }
  const diff = angularDiffDeg(headingDeg, bearingDeg);
  const halfBeamwidth = antenna.beamwidthDeg / 2;
  const frontToBack = antenna.frontToBackDb ?? 15;

  if (diff <= halfBeamwidth) {
    const t = diff / halfBeamwidth;
    return antenna.gainDbi - 3 * t * t;
  }
  if (diff >= 150) {
    return antenna.gainDbi - frontToBack;
  }
  const t = (diff - halfBeamwidth) / (150 - halfBeamwidth);
  const edgeGain = antenna.gainDbi - 3;
  const backGain = antenna.gainDbi - frontToBack;
  return edgeGain + t * (backGain - edgeGain);
}

const HEIGHT_REFERENCE_M = 12;

/**
 * Extra gain/loss (dB) from mounting height, relative to a 12m baseline.
 * A high antenna radiates at a lower takeoff angle, which favours the
 * shallow-angle skywave hops long-haul DX depends on; a low antenna radiates
 * more energy straight up, which favours the steep NVIS-angle hop used for
 * shorter regional contacts. The two effects fade into each other between
 * ~300km (all NVIS) and ~2300km (all DX).
 */
export function antennaHeightGainDb(antenna: AntennaType, distanceKm: number): number {
  const delta = antenna.heightM - HEIGHT_REFERENCE_M;
  const dxWeight = Math.max(0, Math.min(1, (distanceKm - 300) / 2000));
  const nvisWeight = 1 - dxWeight;
  return delta * 0.15 * dxWeight - delta * 0.05 * nvisWeight;
}
