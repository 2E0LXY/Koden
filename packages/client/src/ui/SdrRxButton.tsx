import type { Mode } from "@koden/shared";
import { sdrRxUrl } from "./sdrLink.js";

interface SdrRxButtonProps {
  freqKHz: number;
  mode: Mode;
}

/** Fixed corner button that opens the real SDR receiver tuned to match the dial, so whatever's actually on the air at that frequency can be heard alongside the simulation. */
export function SdrRxButton({ freqKHz, mode }: SdrRxButtonProps) {
  return (
    <a
      className="sdr-rx-fab"
      href={sdrRxUrl(freqKHz, mode)}
      target="_blank"
      rel="noopener noreferrer"
      title={`Listen on the real SDR receiver (${(freqKHz / 1000).toFixed(3)} MHz ${mode})`}
      aria-label="Listen on real SDR receiver"
    >
      RX
    </a>
  );
}
