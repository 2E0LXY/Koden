import { click } from "../audio/sfx.js";

interface PanelButtonProps {
  label: string;
  active?: boolean;
  small?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
}

export function PanelButton({ label, active, small, disabled, onClick, title }: PanelButtonProps) {
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
