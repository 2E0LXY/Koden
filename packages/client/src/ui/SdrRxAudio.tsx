import { useEffect, useState } from "react";
import type { Mode } from "@koden/shared";
import { sdrRxUrl } from "./sdrLink.js";

interface SdrRxAudioProps {
  freqKHz: number;
  mode: Mode;
}

const RETUNE_DEBOUNCE_MS = 2000;

/**
 * Hidden iframe carrying the real SDR receiver's audio, kept in sync with
 * the Koden dial. Mounts pointed at whatever's on the dial right now, then
 * re-tunes (by navigating the iframe to a new hash-tuned URL) 2 seconds
 * after the last frequency/mode change settles -- so spinning the VFO
 * doesn't thrash the receiver with a reconnect on every intermediate step,
 * only once tuning actually stops. Visually hidden rather than
 * display:none, since some browsers suspend media in display:none iframes.
 */
export function SdrRxAudio({ freqKHz, mode }: SdrRxAudioProps) {
  const [url, setUrl] = useState(() => sdrRxUrl(freqKHz, mode));

  useEffect(() => {
    const next = sdrRxUrl(freqKHz, mode);
    const timer = setTimeout(() => setUrl(next), RETUNE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [freqKHz, mode]);

  return (
    <iframe
      className="sdr-rx-audio-frame"
      src={url}
      title="Live SDR audio"
      allow="autoplay"
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
