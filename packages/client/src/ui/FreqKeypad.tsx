import { click } from "../audio/sfx.js";

interface FreqKeypadProps {
  onDigit: (d: string) => void;
  onDecimal: () => void;
  onBackspace: () => void;
  onEnter: () => void;
  active: boolean;
}

const KEYS: { label: string; kind: "digit" | "decimal" | "back" | "enter" }[] = [
  { label: "1", kind: "digit" },
  { label: "2", kind: "digit" },
  { label: "3", kind: "digit" },
  { label: "4", kind: "digit" },
  { label: "5", kind: "digit" },
  { label: "6", kind: "digit" },
  { label: "7", kind: "digit" },
  { label: "8", kind: "digit" },
  { label: "9", kind: "digit" },
  { label: "⌫", kind: "back" },
  { label: "0", kind: "digit" },
  { label: ".", kind: "decimal" },
];

/** Direct frequency entry (MHz) -- type digits, ENT confirms, just like a real radio's keypad. */
export function FreqKeypad({ onDigit, onDecimal, onBackspace, onEnter, active }: FreqKeypadProps) {
  return (
    <div className="freq-keypad">
      <div className="freq-keypad__label">DIRECT FREQ ENTRY (MHz)</div>
      <div className="freq-keypad__grid">
        {KEYS.map(({ label, kind }) => (
          <button
            key={label}
            type="button"
            className="freq-keypad__key"
            onClick={() => {
              click();
              if (kind === "digit") onDigit(label);
              else if (kind === "decimal") onDecimal();
              else onBackspace();
            }}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className={`freq-keypad__key freq-keypad__key--enter ${active ? "freq-keypad__key--active" : ""}`}
          onClick={() => {
            click();
            onEnter();
          }}
        >
          ENT
        </button>
      </div>
    </div>
  );
}
