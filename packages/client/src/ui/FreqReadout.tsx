import { useEffect, useRef, useState } from "react";

interface FreqSegment {
  char: string;
  /** kHz value of one increment at this digit's place, or null for separator characters. */
  placeKHz: number | null;
}

/** Breaks a kHz frequency into individual digit/separator characters, each digit tagged with the kHz step one click of it represents (e.g. the "1" in 14,195.000 is the 10,000 kHz place). */
function freqSegments(freqKHz: number): FreqSegment[] {
  const khz = Math.floor(freqKHz);
  const hz = Math.round((freqKHz - khz) * 1000);
  const intDigits = Math.abs(khz).toString().split("");
  const n = intDigits.length;
  const segments: FreqSegment[] = [];
  if (khz < 0) segments.push({ char: "-", placeKHz: null });
  intDigits.forEach((d, i) => {
    if (i > 0 && (n - i) % 3 === 0) segments.push({ char: ".", placeKHz: null });
    segments.push({ char: d, placeKHz: 10 ** (n - 1 - i) });
  });
  segments.push({ char: ".", placeKHz: null });
  hz
    .toString()
    .padStart(3, "0")
    .split("")
    .forEach((d, j) => {
      segments.push({ char: d, placeKHz: 10 ** (-1 - j) });
    });
  return segments;
}

interface FreqReadoutProps {
  freqKHz: number;
  onStep: (dir: 1 | -1, customStepKHz?: number) => void;
}

/**
 * Main LCD frequency readout: mouse wheel over it tunes up/down, and
 * clicking a digit picks that digit's place value as the scroll step
 * (click again to release it back to the normal STEP setting) -- the same
 * "select a digit, then spin" tuning real transceivers offer.
 */
export function FreqReadout({ freqKHz, onStep }: FreqReadoutProps) {
  const [selectedPlace, setSelectedPlace] = useState<number | null>(null);
  const elRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    // React's synthetic onWheel is registered as a passive listener, so
    // e.preventDefault() inside it silently fails -- the page itself
    // scrolls underneath the cursor, eventually carrying this element away
    // from a stationary mouse and dropping later wheel events on whatever
    // scrolled into its place. A real, non-passive native listener is the
    // only way to actually stop that native scroll.
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      onStep(e.deltaY < 0 ? 1 : -1, selectedPlace ?? undefined);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [onStep, selectedPlace]);

  return (
    <div
      ref={elRef}
      className="panel__freq-main"
      title="Scroll to tune -- click a digit to set the scroll step to that digit's place"
    >
      {freqSegments(freqKHz).map((seg, i) =>
        seg.placeKHz === null ? (
          <span key={i}>{seg.char}</span>
        ) : (
          <span
            key={i}
            className={`freq-digit${selectedPlace === seg.placeKHz ? " freq-digit--selected" : ""}`}
            onClick={() => setSelectedPlace((prev) => (prev === seg.placeKHz ? null : seg.placeKHz))}
          >
            {seg.char}
          </span>
        ),
      )}
    </div>
  );
}
