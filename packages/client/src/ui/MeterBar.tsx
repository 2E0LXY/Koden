interface MeterBarProps {
  label: string;
  /** 0..1 normalized level. */
  value: number;
  /** Color for the segment sitting at normalized position `pos` (0..1) along the scale. */
  colorAt: (pos: number) => string;
  readout: string;
  segments?: number;
  pulsing?: boolean;
}

/** A digital LED-style bar-graph meter: a row of coloured segments lighting up left-to-right with a numeric readout. */
export function MeterBar({ label, value, colorAt, readout, segments = 20, pulsing }: MeterBarProps) {
  return (
    <div className={`meter-bar ${pulsing ? "meter-bar--pulsing" : ""}`}>
      <div className="meter-bar__row">
        <span className="meter-bar__label">{label}</span>
        <span className="meter-bar__readout">{readout}</span>
      </div>
      <div className="meter-bar__track">
        {Array.from({ length: segments }, (_, i) => {
          const pos = (i + 1) / segments;
          const lit = pos <= value + 1e-6;
          return (
            <div
              key={i}
              className="meter-bar__seg"
              style={lit ? { background: colorAt(pos) } : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
