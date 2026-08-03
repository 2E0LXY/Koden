import { useRef } from "react";
import { click } from "../audio/sfx.js";

interface PanelButtonProps {
  label: string;
  active?: boolean;
  small?: boolean;
  disabled?: boolean;
  onClick: () => void;
  /** Fires instead of onClick if the button is held for ~1 second, matching the radio's "touch-and-hold" convention (e.g. A/B's hold-to-equalize). */
  onHold?: () => void;
  title?: string;
}

const HOLD_MS = 700;

export function PanelButton({ label, active, small, disabled, onClick, onHold, title }: PanelButtonProps) {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);

  const clearTimer = () => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  if (!onHold) {
    return (
      <button
        type="button"
        title={title}
        disabled={disabled}
        className={`panel-btn ${small ? "panel-btn--small" : ""} ${active ? "panel-btn--active" : ""}`}
        onClick={() => {
          if (disabled) return;
          click();
          onClick();
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className={`panel-btn ${small ? "panel-btn--small" : ""} ${active ? "panel-btn--active" : ""}`}
      onPointerDown={() => {
        if (disabled) return;
        held.current = false;
        clearTimer();
        holdTimer.current = setTimeout(() => {
          held.current = true;
          click();
          onHold();
        }, HOLD_MS);
      }}
      onPointerUp={() => {
        if (disabled) return;
        const wasHeld = held.current;
        clearTimer();
        if (!wasHeld) {
          click();
          onClick();
        }
      }}
      onPointerLeave={clearTimer}
    >
      {label}
    </button>
  );
}
