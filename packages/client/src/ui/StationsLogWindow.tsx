import { useRef, useState } from "react";
import type { StationInfo } from "@koden/shared";

interface StationsLogWindowProps {
  roster: StationInfo[];
  ownId: string | null;
  audibleStationIds: string[];
  events: string[];
}

const WINDOW_WIDTH = 340;

// Defaults near the top-right corner of the viewport -- roughly over the
// decorative nameplate photo rather than any live instrument. The panel
// fills nearly the whole viewport at typical widths, so there's no truly
// empty spot to default into, but overlapping a photo costs nothing
// functionally. Computed from the viewport (not a fixed pixel guess) so it
// stays sensible across different window sizes.
function defaultPos(): { x: number; y: number } {
  return { x: Math.max(8, window.innerWidth - WINDOW_WIDTH - 20), y: 4 };
}

/**
 * The station roster and band log, in their own floating window instead of
 * fixed inside the radio body -- drag the title bar to move it anywhere on
 * screen, including out over the page margin next to the radio.
 */
export function StationsLogWindow({ roster, ownId, audibleStationIds, events }: StationsLogWindowProps) {
  const [pos, setPos] = useState(defaultPos);
  const [collapsed, setCollapsed] = useState(false);
  const dragStart = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);
  const audibleSet = new Set(audibleStationIds);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragStart.current = { x: e.clientX, y: e.clientY, posX: pos.x, posY: pos.y };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPos({
      x: Math.max(0, dragStart.current.posX + dx),
      y: Math.max(0, dragStart.current.posY + dy),
    });
  };
  const onPointerUp = () => {
    dragStart.current = null;
  };

  return (
    <div className="float-win" style={{ left: pos.x, top: pos.y }}>
      <div className="float-win__titlebar" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <span className="float-win__title">STATIONS &amp; LOG</span>
        <button
          type="button"
          className="float-win__collapse"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "▢" : "_"}
        </button>
      </div>
      {!collapsed && (
        <div className="float-win__body">
          <div className="panel__side-info">
            <div className="panel__roster-title">STATIONS ON FREQ</div>
            <ul className="panel__roster">
              {roster.map((s) => (
                <li
                  key={s.id}
                  className={[
                    s.id === ownId ? "panel__roster-item--self" : "",
                    s.transmitting ? "panel__roster-item--tx" : "",
                    audibleSet.has(s.id) ? "panel__roster-item--audible" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span className="panel__roster-call">{s.callsign}</span>
                  <span className="panel__roster-freq">
                    {s.txFreqKHz.toFixed(1)} {s.mode}
                  </span>
                  {s.transmitting && <span className="panel__roster-tx-dot">TX</span>}
                </li>
              ))}
              {roster.length === 0 && <li className="panel__roster-empty">No stations connected</li>}
            </ul>
          </div>
          <div className="panel__side-info">
            <div className="panel__log-title">BAND LOG</div>
            <ul className="panel__log">
              {events.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
