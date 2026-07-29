import { useRef, useState } from "react";
import { startRotor, stopRotor } from "../audio/sfx.js";

interface RotatorCompassProps {
  headingDeg: number;
  onChangeHeading: (deg: number) => void;
  disabled?: boolean;
}

export function RotatorCompass({ headingDeg, onChangeHeading, disabled }: RotatorCompassProps) {
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
    startRotor();
    onChangeHeading(Math.round(angleFromEvent(e)));
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging || disabled) return;
    onChangeHeading(Math.round(angleFromEvent(e)));
  };
  const onPointerUp = () => {
    setDragging(false);
    stopRotor();
  };

  const rad = (headingDeg * Math.PI) / 180;
  const needleX = 50 + 38 * Math.sin(rad);
  const needleY = 50 - 38 * Math.cos(rad);

  return (
    <div className={`rotator ${disabled ? "rotator--disabled" : ""}`}>
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        className="rotator__dial"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <circle cx="50" cy="50" r="46" className="rotator__ring" />
        <text x="50" y="11" className="rotator__tick-label" textAnchor="middle">N</text>
        <text x="90" y="54" className="rotator__tick-label" textAnchor="middle">E</text>
        <text x="50" y="97" className="rotator__tick-label" textAnchor="middle">S</text>
        <text x="10" y="54" className="rotator__tick-label" textAnchor="middle">W</text>
        {!disabled && (
          <line x1="50" y1="50" x2={needleX} y2={needleY} className="rotator__needle" />
        )}
        <circle cx="50" cy="50" r="3" className="rotator__hub" />
      </svg>
      <div className="rotator__heading">{disabled ? "OMNI" : `${Math.round(headingDeg).toString().padStart(3, "0")}°`}</div>
    </div>
  );
}
