import { useEffect, useMemo, useRef, useState } from "react";
import { MeterBar } from "./MeterBar.js";

interface SMeterProps {
  signalDb: number;
  minDb?: number;
  maxDb?: number;
  /**
   * Live receive audio level (0..1 RMS/peak), read directly off actual
   * playback. Blended in on top of the server-reported signalDb so the
   * needle visibly reacts to real interference and signal peaks as they're
   * actually heard, not just the server's slower periodic meter updates.
   */
  getLiveLevel?: () => { rms: number; peak: number };
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

export function SMeter({ signalDb, minDb = -95, maxDb = 40, getLiveLevel }: SMeterProps) {
  const baseline = useMemo(() => {
    const t = (signalDb - minDb) / (maxDb - minDb);
    return Math.max(0, Math.min(1, t));
  }, [signalDb, minDb, maxDb]);

  const [liveBoost, setLiveBoost] = useState(0);
  const getLiveLevelRef = useRef(getLiveLevel);
  getLiveLevelRef.current = getLiveLevel;

  useEffect(() => {
    if (!getLiveLevel) {
      setLiveBoost(0);
      return;
    }
    let raf = 0;
    let smoothed = 0;
    const poll = () => {
      const live = getLiveLevelRef.current?.() ?? { rms: 0, peak: 0 };
      const raw = Math.min(1, Math.max(live.peak * 0.85, live.rms * 1.4));
      // Real meter ballistics: snap up instantly on a peak, fall off
      // gently afterward -- otherwise every sample-level fluctuation would
      // make the readout flicker rather than read as a real needle.
      smoothed = raw > smoothed ? raw : smoothed * 0.85 + raw * 0.15;
      setLiveBoost(smoothed);
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [getLiveLevel]);

  const normalized = Math.max(baseline, liveBoost);

  return <MeterBar label="S-METER" value={normalized} colorAt={sColor} readout={sReadout(normalized)} />;
}
