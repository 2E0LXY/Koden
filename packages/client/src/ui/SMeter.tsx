import { useMemo } from "react";
import { MeterBar } from "./MeterBar.js";

interface SMeterProps {
  signalDb: number;
  minDb?: number;
  maxDb?: number;
}

/** Fraction along the scale where "S9" sits, matching the old analog gauge's tick layout. */
const S9_AT = 0.571;

function sColor(pos: number): string {
  if (pos < S9_AT) return "#28d17c";
  if (pos < 0.857) return "#e8c73a";
  return "#e14b3a";
}

function sReadout(normalized: number): string {
  if (normalized <= S9_AT) {
    const s = Math.max(1, Math.round((normalized / S9_AT) * 9));
    return `S${s}`;
  }
  const overDb = Math.round(((normalized - S9_AT) / (1 - S9_AT)) * 60);
  return `S9+${overDb}`;
}

export function SMeter({ signalDb, minDb = -95, maxDb = 40 }: SMeterProps) {
  const normalized = useMemo(() => {
    const t = (signalDb - minDb) / (maxDb - minDb);
    return Math.max(0, Math.min(1, t));
  }, [signalDb, minDb, maxDb]);

  return <MeterBar label="S-METER" value={normalized} colorAt={sColor} readout={sReadout(normalized)} />;
}
