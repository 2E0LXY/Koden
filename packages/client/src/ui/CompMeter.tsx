import { MeterBar } from "./MeterBar.js";

interface CompMeterProps {
  enabled: boolean;
  level: number;
}

export function CompMeter({ enabled, level }: CompMeterProps) {
  const normalized = enabled ? Math.max(0, Math.min(10, level)) / 10 : 0;
  return (
    <MeterBar
      label="COMP"
      value={normalized}
      colorAt={(pos) => (pos < 0.6 ? "#3a9be8" : pos < 0.85 ? "#e8c73a" : "#e14b3a")}
      readout={enabled ? `${level}` : "OFF"}
    />
  );
}
