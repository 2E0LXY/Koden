import { useEffect, useRef, useState } from "react";
import type { Mode } from "@koden/shared";
import { sdrRxEmbedUrl } from "./sdrLink.js";

interface SdrRxAudioProps {
  freqKHz: number;
  mode: Mode;
}

const RETUNE_DEBOUNCE_MS = 2000;

/**
 * Hidden iframe carrying the real SDR receiver's audio, kept in sync with
 * the Koden dial. Mounts pointed at whatever's on the dial right now, then
 * re-tunes (by navigating the iframe to a new URL) 2 seconds after the last
 * frequency/mode change settles -- so spinning the VFO doesn't thrash the
 * receiver with a reconnect on every intermediate step, only once tuning
 * actually stops. Visually hidden rather than display:none, since some
 * browsers suspend media in display:none iframes.
 *
 * Only rendered when canEmbedSdrAudio() is true -- callers must check that
 * first, since the receiver is plain http and embedding it in an https page
 * is blocked as mixed content.
 */
export function SdrRxAudio({ freqKHz, mode }: SdrRxAudioProps) {
  const seqRef = useRef(0);
  const [url, setUrl] = useState(() => sdrRxEmbedUrl(freqKHz, mode, seqRef.current));

  useEffect(() => {
    const timer = setTimeout(() => {
      seqRef.current += 1;
      setUrl(sdrRxEmbedUrl(freqKHz, mode, seqRef.current));
    }, RETUNE_DEBOUNCE_MS);
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
