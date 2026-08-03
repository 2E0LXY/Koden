import { useEffect, useMemo, useRef, useState } from "react";
import { MeterBar } from "./MeterBar.js";

interface SMeterProps {
  signalDb: number;
  /** The band's current ambient noise floor (same reference frame as signalDb). */
  noiseFloorDb: number;
  /**
   * Live receive audio level (0..1 RMS/peak), read directly off actual
   * playback. Blended in on top of the server-reported signalDb as a small,
   * bounded amount of extra flutter so the needle visibly kicks on real
   * interference/voice peaks -- capped low enough that AGC-normalized
   * background noise (which is loud in its own right) can't swamp the
   * reading and mask whether a real signal is actually present.
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

export function SMeter({ signalDb, noiseFloorDb, getLiveLevel }: SMeterProps) {
  // Matches the waterfall's own-signal bump: read relative to the band's
  // actual noise floor (not a fixed absolute dB scale), so an empty
  // frequency reads near the bottom of the scale and the two displays never
  // disagree about whether a real signal is present.
  const baseline = useMemo(() => {
    const t = (signalDb - noiseFloorDb) / 40;
    return Math.max(0, Math.min(1, t));
  }, [signalDb, noiseFloorDb]);

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

  const normalized = Math.max(0, Math.min(1, baseline + liveBoost * 0.12));

  return <MeterBar label="S-METER" value={normalized} colorAt={sColor} readout={sReadout(normalized)} />;
}
