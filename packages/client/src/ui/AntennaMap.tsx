import { gridBearingDeg, gridDistanceKm, isValidGrid, type StationInfo } from "@koden/shared";

interface AntennaMapProps {
  ownGrid: string;
  roster: StationInfo[];
  ownId: string | null;
  headingDeg: number;
  showHeading: boolean;
  onPointAt: (grid: string) => void;
}

const CENTER = 100;
const MAX_RADIUS = 82;

function radiusForDistance(distanceKm: number): number {
  return Math.min(MAX_RADIUS, 12 + 24 * Math.log10(distanceKm + 1));
}

export function AntennaMap({ ownGrid, roster, ownId, headingDeg, showHeading, onPointAt }: AntennaMapProps) {
  const validOwnGrid = isValidGrid(ownGrid);
  const others = roster.filter((s) => s.id !== ownId && isValidGrid(s.grid));

  const headingRad = (headingDeg * Math.PI) / 180;
  const headingX = CENTER + (MAX_RADIUS + 8) * Math.sin(headingRad);
  const headingY = CENTER - (MAX_RADIUS + 8) * Math.cos(headingRad);

  return (
    <div className="antenna-map">
      <svg viewBox="0 0 200 200" className="antenna-map__svg">
        <circle cx={CENTER} cy={CENTER} r={MAX_RADIUS} className="antenna-map__ring" />
        <circle cx={CENTER} cy={CENTER} r={MAX_RADIUS * 0.66} className="antenna-map__ring antenna-map__ring--faint" />
        <circle cx={CENTER} cy={CENTER} r={MAX_RADIUS * 0.33} className="antenna-map__ring antenna-map__ring--faint" />
        <text x={CENTER} y={16} className="antenna-map__compass-label" textAnchor="middle">N</text>
        <text x={CENTER} y={192} className="antenna-map__compass-label" textAnchor="middle">S</text>
        <text x={12} y={CENTER + 4} className="antenna-map__compass-label" textAnchor="middle">W</text>
        <text x={188} y={CENTER + 4} className="antenna-map__compass-label" textAnchor="middle">E</text>

        {showHeading && (
          <line
            x1={CENTER}
            y1={CENTER}
            x2={headingX}
            y2={headingY}
            className="antenna-map__heading-arrow"
            markerEnd="url(#antenna-map-arrowhead)"
          />
        )}

        <defs>
          <marker id="antenna-map-arrowhead" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
          </marker>
        </defs>

        <circle cx={CENTER} cy={CENTER} r={4} className="antenna-map__self" />

        {validOwnGrid &&
          others.map((s) => {
            const bearing = gridBearingDeg(ownGrid, s.grid);
            const distanceKm = gridDistanceKm(ownGrid, s.grid);
            const r = radiusForDistance(distanceKm);
            const rad = (bearing * Math.PI) / 180;
            const x = CENTER + r * Math.sin(rad);
            const y = CENTER - r * Math.cos(rad);
            return (
              <g
                key={s.id}
                className="antenna-map__station"
                onClick={() => onPointAt(s.grid)}
              >
                <circle cx={x} cy={y} r={s.transmitting ? 5 : 3.5} className={`antenna-map__dot ${s.transmitting ? "antenna-map__dot--tx" : ""}`} />
                <text x={x} y={y - 7} className="antenna-map__label" textAnchor="middle">
                  {s.callsign}
                </text>
              </g>
            );
          })}
      </svg>
      {!validOwnGrid && <div className="antenna-map__note">Set a valid grid locator to see the map.</div>}
    </div>
  );
}
