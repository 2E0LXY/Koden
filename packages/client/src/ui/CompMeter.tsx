import { useEffect, useRef, useState } from "react";
import { MeterBar } from "./MeterBar.js";

interface CompMeterProps {
  enabled: boolean;
  level: number;
  /** Live speech-processor gain reduction (dB), read straight off the actual compressor -- see AudioEngine.getCompReductionDb(). */
  getReductionDb?: () => number;
}

// A real ALC/COMP meter swings with actual gain reduction as the operator
// talks, not a static readout of the PROC dial's configured ceiling --
// -20dB of instantaneous reduction reads as a solidly-pinned meter.
const FULL_SCALE_REDUCTION_DB = 20;

export function CompMeter({ enabled, level, getReductionDb }: CompMeterProps) {
  const [liveNormalized, setLiveNormalized] = useState(0);
  const getReductionRef = useRef(getReductionDb);
  getReductionRef.current = getReductionDb;

  useEffect(() => {
    if (!enabled || !getReductionDb) {
      setLiveNormalized(0);
      return;
    }
    let raf = 0;
    let smoothed = 0;
    const poll = () => {
      const reductionDb = getReductionRef.current?.() ?? 0;
      const raw = Math.max(0, Math.min(1, reductionDb / FULL_SCALE_REDUCTION_DB));
      // Real meter ballistics: snap up instantly on a peak, fall off gently.
      smoothed = raw > smoothed ? raw : smoothed * 0.8 + raw * 0.2;
      setLiveNormalized(smoothed);
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [enabled, getReductionDb]);

  const normalized = enabled ? liveNormalized : 0;
  return (
    <MeterBar
      label="COMP"
      value={normalized}
      colorAt={(pos) => (pos < 0.6 ? "#3a9be8" : pos < 0.85 ? "#e8c73a" : "#e14b3a")}
      readout={enabled ? `${level}` : "OFF"}
    />
  );
}
