import type { Mode } from "@koden/shared";
import { sdrRxUrl } from "./sdrLink.js";

interface SdrRxButtonProps {
  freqKHz: number;
  mode: Mode;
  enabled: boolean;
  onToggle: () => void;
}

/**
 * Fixed corner button toggling the real SDR receiver's live audio, tuned to
 * match the dial. A plain click toggles the embedded audio on/off; a
 * ctrl/cmd-click or middle-click falls through to the browser's native
 * "open in new tab" behavior instead (our click handler never runs for
 * those), so the receiver's own page is still reachable directly if the
 * embedded audio doesn't work.
 */
export function SdrRxButton({ freqKHz, mode, enabled, onToggle }: SdrRxButtonProps) {
  return (
    <a
      className={`sdr-rx-fab${enabled ? " sdr-rx-fab--active" : ""}`}
      href={sdrRxUrl(freqKHz, mode)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onToggle();
      }}
      title={
        enabled
          ? `Live SDR audio on (${(freqKHz / 1000).toFixed(3)} MHz ${mode}) -- click to stop; ctrl/cmd-click to open the receiver page`
          : `Listen on the real SDR receiver (${(freqKHz / 1000).toFixed(3)} MHz ${mode}) -- click for live audio; ctrl/cmd-click to open the receiver page`
      }
      aria-label="Toggle live SDR receiver audio"
      aria-pressed={enabled}
    >
      RX
    </a>
  );
}
