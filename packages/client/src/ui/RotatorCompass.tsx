import { useRef, useState } from "react";
import { gridBearingDeg, gridDistanceKm, isValidGrid, type StationInfo } from "@koden/shared";

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
const MAX_RADIUS = 82;

function radiusForDistance(distanceKm: number): number {
  return Math.min(MAX_RADIUS, 12 + 24 * Math.log10(distanceKm + 1));
}

/**
 * Combined rotator heading dial and station-position map: drag to slew the
 * beam, or click a plotted station to point straight at it. Distance rings
 * and station dots come from the same real bearing/distance math as the
 * old standalone station map, just layered onto the one compass widget.
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

  const rad = (headingDeg * Math.PI) / 180;
  const needleX = CENTER + (MAX_RADIUS + 8) * Math.sin(rad);
  const needleY = CENTER - (MAX_RADIUS + 8) * Math.cos(rad);

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
        <text x={CENTER} y={20} className="antenna-map__compass-label" textAnchor="middle">N</text>
        <text x={CENTER} y={186} className="antenna-map__compass-label" textAnchor="middle">S</text>
        <text x={16} y={CENTER + 4} className="antenna-map__compass-label" textAnchor="middle">W</text>
        <text x={184} y={CENTER + 4} className="antenna-map__compass-label" textAnchor="middle">E</text>

        {!disabled && (
          <>
            <defs>
              <marker id="rotator-arrowhead" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
              </marker>
            </defs>
            <line x1={CENTER} y1={CENTER} x2={needleX} y2={needleY} className="rotator__needle" markerEnd="url(#rotator-arrowhead)" />
          </>
        )}

        {validOwnGrid &&
          others.map((s) => {
            const bearing = gridBearingDeg(ownGrid, s.grid);
            const distanceKm = gridDistanceKm(ownGrid, s.grid);
            const r = radiusForDistance(distanceKm);
            const stationRad = (bearing * Math.PI) / 180;
            const x = CENTER + r * Math.sin(stationRad);
            const y = CENTER - r * Math.cos(stationRad);
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
      {!validOwnGrid && <div className="antenna-map__note">Set a valid grid locator to see other stations.</div>}
    </div>
  );
}
