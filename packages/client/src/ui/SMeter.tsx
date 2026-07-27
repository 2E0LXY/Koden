import { useMemo } from "react";

interface SMeterProps {
  signalDb: number;
  minDb?: number;
  maxDb?: number;
}

const TICKS = [
  { label: "1", at: 0 },
  { label: "3", at: 0.143 },
  { label: "5", at: 0.286 },
  { label: "7", at: 0.429 },
  { label: "9", at: 0.571 },
  { label: "+20", at: 0.714 },
  { label: "+40", at: 0.857 },
  { label: "+60dB", at: 1 },
];

export function SMeter({ signalDb, minDb = -95, maxDb = 40 }: SMeterProps) {
  const normalized = useMemo(() => {
    const t = (signalDb - minDb) / (maxDb - minDb);
    return Math.max(0, Math.min(1, t));
  }, [signalDb, minDb, maxDb]);

  const angleDeg = -90 + normalized * 180;

  return (
    <div className="s-meter">
      <svg viewBox="0 0 200 120" className="s-meter__face">
        <path d="M 15 105 A 85 85 0 0 1 185 105" className="s-meter__arc" />
        {TICKS.map((tick) => {
          const a = (-90 + tick.at * 180) * (Math.PI / 180);
          const x1 = 100 + Math.sin(a) * 78;
          const y1 = 105 - Math.cos(a) * 78;
          const x2 = 100 + Math.sin(a) * 90;
          const y2 = 105 - Math.cos(a) * 90;
          const lx = 100 + Math.sin(a) * 65;
          const ly = 105 - Math.cos(a) * 65;
          return (
            <g key={tick.label}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} className="s-meter__tick" />
              <text x={lx} y={ly} className="s-meter__label" textAnchor="middle">
                {tick.label}
              </text>
            </g>
          );
        })}
        <g style={{ transform: `rotate(${angleDeg}deg)`, transformOrigin: "100px 105px" }}>
          <line x1="100" y1="105" x2="100" y2="30" className="s-meter__needle" />
        </g>
        <circle cx="100" cy="105" r="5" className="s-meter__hub" />
      </svg>
      <div className="s-meter__caption">S-METER</div>
    </div>
  );
}
