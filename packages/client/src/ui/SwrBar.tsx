interface SwrBarProps {
  swr: number;
  tuning: boolean;
}

export function SwrBar({ swr, tuning }: SwrBarProps) {
  const clamped = Math.max(1, Math.min(6, swr));
  const normalized = (clamped - 1) / 5;
  const hue = Math.max(0, 120 - normalized * 120);

  return (
    <div className={`swr-bar ${tuning ? "swr-bar--tuning" : ""}`}>
      <div className="swr-bar__label">
        SWR {clamped.toFixed(1)}:1{tuning ? " – TUNING" : ""}
      </div>
      <div className="swr-bar__track">
        <div
          className="swr-bar__fill"
          style={{ width: `${normalized * 100}%`, background: `hsl(${hue}, 80%, 50%)` }}
        />
      </div>
    </div>
  );
}
