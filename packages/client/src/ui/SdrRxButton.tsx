import type { Mode } from "@koden/shared";
import { canEmbedSdrAudio, sdrRxUrl } from "./sdrLink.js";

interface SdrRxButtonProps {
  freqKHz: number;
  mode: Mode;
  enabled: boolean;
  onToggle: () => void;
}

/**
 * Fixed corner button for the real SDR receiver, tuned to match the dial.
 * Where embedding is actually possible (canEmbedSdrAudio -- see sdrLink.ts
 * for why it usually isn't on the deployed https site), a plain click
 * toggles live embedded audio on/off, styled and exposed as a real toggle
 * (role="button" + aria-pressed, since aria-pressed isn't valid on the
 * anchor's default link role). Otherwise it's just a link: click opens the
 * receiver's own page in a new tab, same as before embedding existed. A
 * ctrl/cmd-click or middle-click always falls through to that native
 * "open in new tab" behavior regardless (our click handler never runs for
 * those), so the receiver's own page is reachable directly either way.
 */
export function SdrRxButton({ freqKHz, mode, enabled, onToggle }: SdrRxButtonProps) {
  const embeddable = canEmbedSdrAudio();
  return (
    <a
      className={`sdr-rx-fab${enabled ? " sdr-rx-fab--active" : ""}`}
      href={sdrRxUrl(freqKHz, mode)}
      target="_blank"
      rel="noopener noreferrer"
      role={embeddable ? "button" : undefined}
      onClick={(e) => {
        if (!embeddable) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onToggle();
      }}
      title={
        embeddable
          ? enabled
            ? `Live SDR audio on (${(freqKHz / 1000).toFixed(3)} MHz ${mode}) -- click to stop; ctrl/cmd-click to open the receiver page`
            : `Listen on the real SDR receiver (${(freqKHz / 1000).toFixed(3)} MHz ${mode}) -- click for live audio; ctrl/cmd-click to open the receiver page`
          : `Open the real SDR receiver in a new tab (${(freqKHz / 1000).toFixed(3)} MHz ${mode})`
      }
      aria-label={embeddable ? "Toggle live SDR receiver audio" : "Open real SDR receiver"}
      aria-pressed={embeddable ? enabled : undefined}
    >
      RX
    </a>
  );
}
