import { click } from "../audio/sfx.js";

interface PanelButtonProps {
  label: string;
  active?: boolean;
  small?: boolean;
  onClick: () => void;
  title?: string;
}

export function PanelButton({ label, active, small, onClick, title }: PanelButtonProps) {
  return (
    <button
      type="button"
      title={title}
      className={`panel-btn ${small ? "panel-btn--small" : ""} ${active ? "panel-btn--active" : ""}`}
      onClick={() => {
        click();
        onClick();
      }}
    >
      {label}
    </button>
  );
}
