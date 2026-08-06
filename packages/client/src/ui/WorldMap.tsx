import { useRef, useState } from "react";
import { antennaById, gridToLatLon, isValidGrid, type AntennaId, type StationInfo } from "@koden/shared";

interface WorldMapProps {
  roster: StationInfo[];
  ownId: string | null;
  ownGrid: string;
  antenna: AntennaId;
  headingDeg: number;
}

const WINDOW_WIDTH = 340;
const MAP_W = 360;
const MAP_H = 180;

function defaultPos(): { x: number; y: number } {
  return { x: Math.max(8, window.innerWidth - WINDOW_WIDTH - 20), y: 4 };
}

/** Equirectangular projection: straight lon/lat -> x/y, same convention gridToLatLon's callers already assume elsewhere in the app. */
function project(lon: number, lat: number): [number, number] {
  return [lon + 180, 90 - lat];
}

function pathFor(points: [number, number][]): string {
  return points.map(([lon, lat], i) => `${i === 0 ? "M" : "L"}${project(lon, lat).join(",")}`).join(" ") + " Z";
}

// Deliberately simplified coastlines (a few dozen points per landmass, not
// survey-accurate) -- legible as a world map at the panel's small scale
// without pulling in a real geo-data dependency.
const CONTINENTS: [number, number][][] = [
  // North America
  [
    [-165, 65], [-155, 71], [-140, 70], [-125, 70], [-95, 70], [-80, 73], [-70, 60], [-65, 50],
    [-70, 45], [-75, 35], [-80, 25], [-97, 26], [-90, 20], [-84, 9], [-85, 12], [-105, 20],
    [-115, 30], [-124, 40], [-125, 49], [-130, 55], [-140, 60], [-160, 60],
  ],
  // Greenland
  [
    [-45, 83], [-20, 82], [-25, 70], [-40, 60], [-55, 60], [-65, 70], [-60, 80],
  ],
  // South America
  [
    [-77, 8], [-80, 0], [-81, -5], [-70, -18], [-70, -30], [-73, -42], [-68, -55], [-65, -53],
    [-58, -38], [-48, -25], [-35, -8], [-45, 0], [-50, 5], [-60, 8], [-70, 10],
  ],
  // Africa
  [
    [-17, 21], [-17, 15], [-10, 6], [3, 5], [9, 4], [12, -6], [13, -17], [18, -34], [32, -29],
    [40, -15], [43, 0], [51, 12], [43, 12], [37, 15], [33, 27], [25, 32], [10, 37], [0, 36], [-6, 35],
  ],
  // Europe
  [
    [-9, 43], [-9, 38], [-5, 36], [3, 42], [7, 44], [13, 45], [19, 40], [28, 41], [30, 46],
    [40, 50], [30, 60], [25, 65], [10, 71], [5, 61], [8, 54], [0, 51], [-5, 48],
  ],
  // Asia
  [
    [28, 41], [45, 40], [52, 42], [60, 45], [60, 55], [60, 70], [90, 75], [140, 73], [170, 68],
    [178, 65], [160, 60], [145, 43], [130, 42], [122, 30], [108, 22], [100, 8], [95, 5], [80, 8],
    [72, 20], [68, 24], [57, 26], [48, 30], [35, 30], [33, 33],
  ],
  // Australia
  [
    [113, -22], [114, -34], [138, -35], [146, -38], [150, -33], [145, -17], [132, -12], [122, -18],
  ],
];

const GRATICULE_LONS = [-180, -120, -60, 0, 60, 120, 180];
const GRATICULE_LATS = [-60, -30, 0, 30, 60];

/**
 * Floating world map showing every online station -- real operators and the
 * fixed reference stations (beacon, parrot, time signal, VOLMET) alike, all
 * plotted from the same grid locator math used elsewhere in the app -- plus
 * a compass overlay at the operator's own position showing which way a
 * rotatable (Yagi-type) antenna is currently pointed.
 */
export function WorldMap({ roster, ownId, ownGrid, antenna, headingDeg }: WorldMapProps) {
  const [pos, setPos] = useState(defaultPos);
  const [collapsed, setCollapsed] = useState(false);
  const dragStart = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);

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

  const stations = roster.filter((s) => isValidGrid(s.grid));
  const ownAntenna = antennaById(antenna);
  const showHeading = ownAntenna?.rotatable && isValidGrid(ownGrid);
  const ownLatLon = showHeading ? gridToLatLon(ownGrid) : null;
  const [ownX, ownY] = ownLatLon ? project(ownLatLon.lon, ownLatLon.lat) : [0, 0];
  const headingRad = (headingDeg * Math.PI) / 180;
  const arrowLen = 14;
  const arrowX = ownX + arrowLen * Math.sin(headingRad);
  const arrowY = ownY - arrowLen * Math.cos(headingRad);

  return (
    <div className="float-win" style={{ left: pos.x, top: pos.y }}>
      <div className="float-win__titlebar" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <span className="float-win__title">STATION MAP</span>
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
        <div className="float-win__body world-map__body">
          <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="world-map__svg">
            <rect x={0} y={0} width={MAP_W} height={MAP_H} className="world-map__ocean" />
            {GRATICULE_LONS.map((lon) => (
              <line key={`lon${lon}`} x1={project(lon, 90)[0]} y1={0} x2={project(lon, -90)[0]} y2={MAP_H} className="world-map__graticule" />
            ))}
            {GRATICULE_LATS.map((lat) => (
              <line key={`lat${lat}`} x1={0} y1={project(-180, lat)[1]} x2={MAP_W} y2={project(180, lat)[1]} className="world-map__graticule" />
            ))}
            {CONTINENTS.map((points, i) => (
              <path key={i} d={pathFor(points)} className="world-map__land" />
            ))}

            {stations.map((s) => {
              const { lat, lon } = gridToLatLon(s.grid);
              const [x, y] = project(lon, lat);
              const isSelf = s.id === ownId;
              return (
                <g key={s.id} className="antenna-map__station">
                  <circle
                    cx={x}
                    cy={y}
                    r={isSelf ? 4.5 : s.transmitting ? 4 : 3}
                    className={`antenna-map__dot ${s.transmitting ? "antenna-map__dot--tx" : ""} ${isSelf ? "world-map__dot--self" : ""}`}
                  />
                  <text x={x} y={y - 6} className="antenna-map__label" textAnchor="middle">
                    {s.callsign}
                  </text>
                </g>
              );
            })}

            {showHeading && (
              <g className="world-map__heading-overlay">
                <defs>
                  <marker id="world-map-arrowhead" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                    <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
                  </marker>
                </defs>
                <circle cx={ownX} cy={ownY} r={11} className="world-map__compass-ring" />
                <circle cx={ownX} cy={ownY} r={6} className="world-map__compass-ring world-map__compass-ring--faint" />
                <line x1={ownX} y1={ownY} x2={arrowX} y2={arrowY} className="world-map__heading-line" markerEnd="url(#world-map-arrowhead)" />
              </g>
            )}
          </svg>
          {stations.length === 0 && <div className="antenna-map__note">No stations online</div>}
        </div>
      )}
    </div>
  );
}
