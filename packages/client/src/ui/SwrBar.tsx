import { MeterBar } from "./MeterBar.js";

interface SwrBarProps {
  swr: number;
  tuning: boolean;
}

export function SwrBar({ swr, tuning }: SwrBarProps) {
  const clamped = Math.max(1, Math.min(6, swr));
  const normalized = (clamped - 1) / 5;

  return (
    <MeterBar
      label={tuning ? "SWR -- TUNING" : "SWR"}
      value={normalized}
      colorAt={(pos) => `hsl(${Math.max(0, 120 - pos * 120)}, 80%, 50%)`}
      readout={`${clamped.toFixed(1)}:1`}
      pulsing={tuning}
    />
  );
}
