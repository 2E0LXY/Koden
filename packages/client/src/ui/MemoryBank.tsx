import { useRef } from "react";
import type { Mode } from "@koden/shared";
import { click } from "../audio/sfx.js";

interface MemoryBankProps {
  memory: ({ freqKHz: number; mode: Mode } | null)[];
  activeIndex: number;
  onProgram: (idx: number) => void;
  onRecall: (idx: number) => void;
}

/** How long a press must be held before it counts as "program" instead of a quick "select". */
const HOLD_MS = 600;

function formatMHz(freqKHz: number): string {
  return (freqKHz / 1000).toFixed(3);
}

/**
 * Direct-access memory channels, same convention as a real rig's memory
 * keypad: a quick tap selects (recalls) a channel, press-and-hold programs
 * the current VFO into it. Right-click also selects, for desktop users
 * without a touchscreen. Each key shows the frequency it holds instead of
 * just its slot number, so you can see what's stored at a glance.
 */
export function MemoryBank({ memory, activeIndex, onProgram, onRecall }: MemoryBankProps) {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);

  const clearTimer = () => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  const startPress = (idx: number) => {
    held.current = false;
    clearTimer();
    holdTimer.current = setTimeout(() => {
      held.current = true;
      click();
      onProgram(idx);
    }, HOLD_MS);
  };

  const endPress = (idx: number) => {
    const wasHeld = held.current;
    clearTimer();
    if (!wasHeld) {
      click();
      onRecall(idx);
    }
  };

  return (
    <div className="memory-bank">
      <div className="memory-bank__label">MEMORY (tap=select, hold=program, right-click=select)</div>
      <div className="memory-bank__grid">
        {memory.map((slot, idx) => (
          <button
            key={idx}
            type="button"
            className={`memory-bank__key ${idx === activeIndex ? "memory-bank__key--active" : ""} ${slot ? "memory-bank__key--filled" : ""}`}
            title={
              slot
                ? `${slot.freqKHz.toFixed(1)} kHz ${slot.mode} -- tap to select, hold to reprogram`
                : "Empty -- press and hold to store current VFO here"
            }
            onPointerDown={() => startPress(idx)}
            onPointerUp={() => endPress(idx)}
            onPointerLeave={clearTimer}
            onContextMenu={(e) => {
              e.preventDefault();
              click();
              onRecall(idx);
            }}
          >
            <span className="memory-bank__key-idx">{idx}</span>
            <span className="memory-bank__key-freq">{slot ? formatMHz(slot.freqKHz) : "----.---"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
