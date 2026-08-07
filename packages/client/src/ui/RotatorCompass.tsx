import { useEffect, useRef, useState } from "react";
import { gridBearingDeg, gridDistanceKm, isValidGrid, type StationInfo } from "@koden/shared";
import { click } from "../audio/sfx.js";

interface RotatorCompassProps {
  headingDeg: number;
  onChangeHeading: (deg: number) => void;
  /** True for a fixed omnidirectional antenna -- no beam heading to point. */
  disabled?: boolean;
  ownGrid: string;
  roster: StationInfo[];
  ownId: string | null;
  onPointAt: (grid: string) => void;
}

const CENTER = 100;
/** Where station dots/distance rings live -- inside the tick/degree bezel. */
const MAX_RADIUS = 60;
const NEEDLE_LENGTH = 64;
const TICK_INNER = 68;
const TICK_MINOR_OUTER = 72;
const TICK_MAJOR_OUTER = 77;
const LABEL_RADIUS = 87;
const CARDINAL_BY_DEG: Record<number, string> = { 0: "N", 90: "E", 180: "S", 270: "W" };
/** Every 10 degrees, matching a real bezel-style rotator dial. */
const TICK_DEGREES = Array.from({ length: 36 }, (_, i) => i * 10);

/** Step per button press; holding repeats this every REPEAT_MS for a continuous slew. */
const STEP_DEG = 5;
const REPEAT_DELAY_MS = 350;
const REPEAT_MS = 90;

function radiusForDistance(distanceKm: number): number {
  return Math.min(MAX_RADIUS, 10 + 16 * Math.log10(distanceKm + 1));
}

function pointOnCircle(radius: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: CENTER + radius * Math.sin(rad), y: CENTER - radius * Math.cos(rad) };
}

/**
 * Combined rotator heading dial and station-position map: drag to slew the
 * beam, click the CW/CCW buttons to nudge or hold to slew continuously
 * (wrapping through the full 360 degrees, not clamped to any hemisphere),
 * or click a plotted station to point straight at it. A numbered bezel ring
 * (10-degree ticks, labelled every 30, cardinals at N/E/S/W) makes the
 * current heading and any station's true bearing readable at a glance, the
 * way a real rotator controller's dial is. Distance rings and station dots
 * come from the same real bearing/distance math as the old standalone
 * station map, just layered onto the one compass widget; stations currently
 * transmitting flash so a live QSO is obvious without reading callsigns.
 */
export function RotatorCompass({
  headingDeg,
  onChangeHeading,
  disabled,
  ownGrid,
  roster,
  ownId,
  onPointAt,
}: RotatorCompassProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState(false);
  const headingRef = useRef(headingDeg);
  const repeatTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    headingRef.current = headingDeg;
  }, [headingDeg]);

  const clearRepeat = () => {
    if (repeatTimeout.current !== null) {
      clearTimeout(repeatTimeout.current);
      repeatTimeout.current = null;
    }
    if (repeatInterval.current !== null) {
      clearInterval(repeatInterval.current);
      repeatInterval.current = null;
    }
  };
  useEffect(() => clearRepeat, []);

  const step = (dir: 1 | -1) => {
    const next = ((headingRef.current + dir * STEP_DEG) % 360 + 360) % 360;
    headingRef.current = next;
    onChangeHeading(Math.round(next));
  };

  const startRepeat = (dir: 1 | -1) => {
    if (disabled) return;
    click();
    step(dir);
    clearRepeat();
    repeatTimeout.current = setTimeout(() => {
      repeatInterval.current = setInterval(() => step(dir), REPEAT_MS);
    }, REPEAT_DELAY_MS);
  };

  const angleFromEvent = (e: React.PointerEvent<SVGSVGElement>): number => {
    const svg = svgRef.current;
    if (!svg) return headingDeg;
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    return ((deg % 360) + 360) % 360;
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (disabled) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    setDragging(true);
    onChangeHeading(Math.round(angleFromEvent(e)));
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging || disabled) return;
    onChangeHeading(Math.round(angleFromEvent(e)));
  };
  const onPointerUp = () => {
    setDragging(false);
  };

  const needleTip = pointOnCircle(NEEDLE_LENGTH, headingDeg);

  const validOwnGrid = isValidGrid(ownGrid);
  const others = roster.filter((s) => s.id !== ownId && isValidGrid(s.grid));

  return (
    <div className={`rotator ${disabled ? "rotator--disabled" : ""}`}>
      <svg
        ref={svgRef}
        viewBox="0 0 200 200"
        className="rotator__dial"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <circle cx={CENTER} cy={CENTER} r={MAX_RADIUS} className="antenna-map__ring" />
        <circle cx={CENTER} cy={CENTER} r={MAX_RADIUS * 0.66} className="antenna-map__ring antenna-map__ring--faint" />
        <circle cx={CENTER} cy={CENTER} r={MAX_RADIUS * 0.33} className="antenna-map__ring antenna-map__ring--faint" />

        {TICK_DEGREES.map((deg) => {
          const isMajor = deg % 30 === 0;
          const p1 = pointOnCircle(TICK_INNER, deg);
          const p2 = pointOnCircle(isMajor ? TICK_MAJOR_OUTER : TICK_MINOR_OUTER, deg);
          return (
            <line
              key={`tick-${deg}`}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              className={`rotator__tick ${isMajor ? "rotator__tick--major" : ""}`}
            />
          );
        })}
        {TICK_DEGREES.filter((deg) => deg % 30 === 0).map((deg) => {
          const cardinal = CARDINAL_BY_DEG[deg];
          const p = pointOnCircle(LABEL_RADIUS, deg);
          return (
            <text
              key={`label-${deg}`}
              x={p.x}
              y={p.y}
              className={cardinal ? "rotator__tick-label rotator__tick-label--cardinal" : "rotator__tick-label"}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {cardinal ?? deg}
            </text>
          );
        })}

        {!disabled && (
          <>
            <defs>
              <marker id="rotator-arrowhead" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
              </marker>
            </defs>
            <line
              x1={CENTER}
              y1={CENTER}
              x2={needleTip.x}
              y2={needleTip.y}
              className="rotator__needle"
              markerEnd="url(#rotator-arrowhead)"
            />
          </>
        )}

        {validOwnGrid &&
          others.map((s) => {
            const bearing = gridBearingDeg(ownGrid, s.grid);
            const distanceKm = gridDistanceKm(ownGrid, s.grid);
            const r = radiusForDistance(distanceKm);
            const { x, y } = pointOnCircle(r, bearing);
            return (
              <g
                key={s.id}
                className="antenna-map__station"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onPointAt(s.grid)}
              >
                <circle cx={x} cy={y} r={s.transmitting ? 5 : 3.5} className={`antenna-map__dot ${s.transmitting ? "antenna-map__dot--tx" : ""}`} />
                <text x={x} y={y - 7} className="antenna-map__label" textAnchor="middle">
                  {s.callsign}
                </text>
              </g>
            );
          })}

        <circle cx={CENTER} cy={CENTER} r={4} className="rotator__hub" />
      </svg>
      <div className="rotator__heading">{disabled ? "OMNI" : `${Math.round(headingDeg).toString().padStart(3, "0")}°`}</div>
      <div className="rotator__nudge-row">
        <button
          type="button"
          className="panel-btn panel-btn--small rotator__nudge-btn"
          disabled={disabled}
          onPointerDown={() => startRepeat(-1)}
          onPointerUp={clearRepeat}
          onPointerLeave={clearRepeat}
          onPointerCancel={clearRepeat}
          title="Rotate counter-clockwise (hold to slew)"
        >
          ◄ CCW
        </button>
        <button
          type="button"
          className="panel-btn panel-btn--small rotator__nudge-btn"
          disabled={disabled}
          onPointerDown={() => startRepeat(1)}
          onPointerUp={clearRepeat}
          onPointerLeave={clearRepeat}
          onPointerCancel={clearRepeat}
          title="Rotate clockwise (hold to slew)"
        >
          CW ►
        </button>
      </div>
      {!validOwnGrid && <div className="antenna-map__note">Set a valid grid locator to see other stations.</div>}
    </div>
  );
}
