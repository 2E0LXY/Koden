import { useCallback, useRef, useState } from "react";
import type { Band } from "@koden/shared";

interface VfoDialProps {
  freqKHz: number;
  band: Band | undefined;
  onChange: (freqKHz: number) => void;
}

function formatFreq(freqKHz: number): string {
  const khz = Math.floor(freqKHz);
  const hz = Math.round((freqKHz - khz) * 1000);
  return `${khz.toLocaleString()}.${hz.toString().padStart(3, "0")}`;
}

export function VfoDial({ freqKHz, band, onChange }: VfoDialProps) {
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ y: number; freq: number } | null>(null);

  const clamp = useCallback(
    (value: number) => {
      if (!band) return value;
      return Math.max(band.rangeKHz[0], Math.min(band.rangeKHz[1], value));
    },
    [band],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragStart.current = { y: e.clientY, freq: freqKHz };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    const deltaY = dragStart.current.y - e.clientY;
    // 100px of drag = 10 kHz fine tune; shift for coarser tuning.
    const scale = e.shiftKey ? 0.5 : 0.1;
    const next = clamp(dragStart.current.freq + deltaY * scale);
    onChange(next);
  };

  const onPointerUp = () => {
    dragStart.current = null;
    setDragging(false);
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const step = e.shiftKey ? 1 : 0.1;
    onChange(clamp(freqKHz - Math.sign(e.deltaY) * step));
  };

  return (
    <div className="vfo">
      <div className="vfo__readout">
        {formatFreq(freqKHz)} <span className="vfo__unit">kHz</span>
      </div>
      <div
        className={`vfo__knob ${dragging ? "vfo__knob--active" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        title="Drag vertically to tune, hold Shift to tune faster, or scroll"
      >
        <div className="vfo__knob-marker" />
      </div>
      <div className="vfo__buttons">
        <button onClick={() => onChange(clamp(freqKHz - 1))}>-1</button>
        <button onClick={() => onChange(clamp(freqKHz - 0.1))}>-0.1</button>
        <button onClick={() => onChange(clamp(freqKHz + 0.1))}>+0.1</button>
        <button onClick={() => onChange(clamp(freqKHz + 1))}>+1</button>
      </div>
    </div>
  );
}
