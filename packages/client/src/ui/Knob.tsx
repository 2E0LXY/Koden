import { useRef, useState } from "react";
import { detent } from "../audio/sfx.js";

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  size?: "normal" | "small";
  /** Double-click/tap to reset, e.g. a push-to-clear encoder like "TWIN PBT (CLR)". */
  onReset?: () => void;
  title?: string;
}

const SWEEP_DEG = 270;

export function Knob({ label, value, min, max, onChange, format, size = "normal", onReset, title }: KnobProps) {
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ y: number; value: number } | null>(null);
  const lastDetentStep = useRef(0);

  const normalized = (value - min) / (max - min);
  const angle = -SWEEP_DEG / 2 + normalized * SWEEP_DEG;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragStart.current = { y: e.clientY, value };
    lastDetentStep.current = Math.round(normalized * 20);
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    const deltaY = dragStart.current.y - e.clientY;
    const range = max - min;
    const next = Math.max(min, Math.min(max, dragStart.current.value + (deltaY / 120) * range));
    onChange(next);
    const step = Math.round(((next - min) / range) * 20);
    if (step !== lastDetentStep.current) {
      lastDetentStep.current = step;
      detent();
    }
  };

  const onPointerUp = () => {
    dragStart.current = null;
    setDragging(false);
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const range = max - min;
    const step = range / 40;
    onChange(Math.max(min, Math.min(max, value - Math.sign(e.deltaY) * step)));
  };

  return (
    <div className={`knob knob--${size}`}>
      <div
        className={`knob__dial ${dragging ? "knob__dial--active" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={onReset}
        title={title ?? (onReset ? "Double-click to reset" : undefined)}
      >
        <div className="knob__indicator" style={{ transform: `rotate(${angle}deg)` }} />
      </div>
      <div className="knob__label">{label}</div>
      {format && <div className="knob__value">{format(value)}</div>}
    </div>
  );
}
