import type { Mode } from "@koden/shared";
import { click } from "../audio/sfx.js";

interface MemoryBankProps {
  memory: ({ freqKHz: number; mode: Mode } | null)[];
  activeIndex: number;
  onProgram: (idx: number) => void;
  onRecall: (idx: number) => void;
}

/** Direct-access memory channels: left-click programs the current VFO into a slot, right-click selects (recalls) it -- same convention as a real rig's memory keypad. */
export function MemoryBank({ memory, activeIndex, onProgram, onRecall }: MemoryBankProps) {
  return (
    <div className="memory-bank">
      <div className="memory-bank__label">MEMORY (click=program, right-click=select)</div>
      <div className="memory-bank__grid">
        {memory.map((slot, idx) => (
          <button
            key={idx}
            type="button"
            className={`memory-bank__key ${idx === activeIndex ? "memory-bank__key--active" : ""} ${slot ? "memory-bank__key--filled" : ""}`}
            title={slot ? `${slot.freqKHz.toFixed(1)} kHz ${slot.mode} -- right-click to select, left-click to reprogram` : "Empty -- left-click to store current VFO here"}
            onClick={() => {
              click();
              onProgram(idx);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              click();
              onRecall(idx);
            }}
          >
            {idx}
          </button>
        ))}
      </div>
    </div>
  );
}
