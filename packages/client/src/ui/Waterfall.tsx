import { useEffect, useRef, useState } from "react";

interface WaterfallStation {
  id: string;
  freqKHz: number;
  transmitting: boolean;
  /** Whether the mixer actually reported this station as audible right now. */
  audible: boolean;
}

interface WaterfallProps {
  signalDb: number;
  noiseFloorDb: number;
  active: boolean;
  centerFreqKHz?: number;
  spanKHz?: number;
  stations?: WaterfallStation[];
  /** Click/tap anywhere on the display to tune directly to that frequency, like a real panadapter. */
  onTuneTo?: (freqKHz: number) => void;
}

const WIDTH = 320;
const HEIGHT = 120;
const SCOPE_HEIGHT = 26;
const FALL_TOP = SCOPE_HEIGHT + 2;
const FALL_HEIGHT = HEIGHT - FALL_TOP;
/** Recenter the fixed window once the tuned frequency drifts this far (as a fraction of the span) from its middle. */
const RECENTER_THRESHOLD = 0.4;

/**
 * A stylized panadapter/waterfall combo styled after a typical HF
 * transceiver's blue-purple spectrum display: a live scope trace on top, a
 * scrolling waterfall below, and a red tuning line. There's no real per-bin
 * FFT to draw (the server doesn't ship one) -- every bump on screen instead
 * comes from real data: the actual noise floor level, the real signal
 * you're receiving, and every other roster station plotted at its real
 * frequency offset, sized by whether the mixer actually reports it as
 * audible right now. The only randomness is a faint per-pixel dither for
 * texture, not fabricated activity.
 *
 * Like a real "FIX" panadapter mode, the frequency window only recenters
 * once your tuned frequency drifts near its edge -- small tuning moves
 * (turning the VFO knob, clicking elsewhere on the display) instead slide
 * the red tuning line and your own signal bump visibly across the screen,
 * rather than always snapping back to dead centre.
 */
export function Waterfall({
  signalDb,
  noiseFloorDb,
  active,
  centerFreqKHz = 0,
  spanKHz = 6,
  stations = [],
  onTuneTo,
}: WaterfallProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const signalRef = useRef(signalDb);
  const noiseFloorRef = useRef(noiseFloorDb);
  const activeRef = useRef(active);
  const stationsRef = useRef(stations);
  const tunedRef = useRef(centerFreqKHz);
  signalRef.current = signalDb;
  noiseFloorRef.current = noiseFloorDb;
  activeRef.current = active;
  stationsRef.current = stations;
  tunedRef.current = centerFreqKHz;

  const [windowCenterKHz, setWindowCenterKHz] = useState(centerFreqKHz);
  const windowCenterRef = useRef(windowCenterKHz);
  windowCenterRef.current = windowCenterKHz;

  useEffect(() => {
    setWindowCenterKHz((prev) =>
      Math.abs(centerFreqKHz - prev) > spanKHz * RECENTER_THRESHOLD ? centerFreqKHz : prev,
    );
  }, [centerFreqKHz, spanKHz]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;

    const intensityAt = (x: number, level: number, ownX: number, floorLevel: number): number => {
      // Real ambient noise floor, not a fabricated wander -- plus a faint
      // per-pixel dither so it reads as static texture rather than a flat
      // band.
      let intensity = floorLevel * 0.35 + Math.random() * 0.05;

      for (const s of stationsRef.current) {
        const offsetKHz = s.freqKHz - windowCenterRef.current;
        const sx = WIDTH / 2 + (offsetKHz / spanKHz) * WIDTH;
        if (sx < -10 || sx > WIDTH + 10) continue;
        const d = x - sx;
        const spread = s.transmitting ? 5 : 3;
        const falloff = Math.exp(-(d * d) / (2 * spread * spread));
        // A station that's really audible right now shows as a strong
        // peak; one that's merely on the roster (out of your passband, or
        // too weak to copy) still shows as a faint presence marker, the
        // way a real panadapter shows signals you can see but not yet hear.
        const peak = s.transmitting ? 0.95 : s.audible ? 0.75 : 0.25;
        intensity += falloff * peak;
      }

      const ownD = x - ownX;
      const ownSpread = 6 + level * 20;
      intensity += Math.exp(-(ownD * ownD) / (2 * ownSpread * ownSpread)) * level * (activeRef.current ? 1.2 : 1);

      return Math.min(1, intensity);
    };

    const draw = () => {
      const level = Math.max(0, Math.min(1, (signalRef.current + 95) / 110));
      const floorLevel = Math.max(0, Math.min(1, (noiseFloorRef.current + 95) / 110));
      const ownOffsetKHz = tunedRef.current - windowCenterRef.current;
      const ownX = WIDTH / 2 + (ownOffsetKHz / spanKHz) * WIDTH;

      // Scroll the waterfall region down by one row, then paint a fresh one.
      const image = ctx.getImageData(0, FALL_TOP, WIDTH, FALL_HEIGHT - 1);
      ctx.putImageData(image, 0, FALL_TOP + 1);

      const row = ctx.createImageData(WIDTH, 1);
      for (let x = 0; x < WIDTH; x++) {
        const intensity = intensityAt(x, level, ownX, floorLevel);
        const idx = x * 4;
        // Deep blue -> purple -> pink/white as intensity rises.
        row.data[idx] = 20 + intensity * 210;
        row.data[idx + 1] = 10 + intensity * 55;
        row.data[idx + 2] = 70 + intensity * 185;
        row.data[idx + 3] = 255;
      }
      ctx.putImageData(row, 0, FALL_TOP);

      // Redraw the scope trace fresh every frame (an instantaneous snapshot,
      // not scrolled) as a filled silhouette above the waterfall.
      ctx.fillStyle = "#0a0420";
      ctx.fillRect(0, 0, WIDTH, SCOPE_HEIGHT);
      ctx.beginPath();
      ctx.moveTo(0, SCOPE_HEIGHT);
      for (let x = 0; x < WIDTH; x++) {
        const intensity = intensityAt(x, level, ownX, floorLevel);
        ctx.lineTo(x, SCOPE_HEIGHT - intensity * (SCOPE_HEIGHT - 2));
      }
      ctx.lineTo(WIDTH, SCOPE_HEIGHT);
      ctx.closePath();
      ctx.fillStyle = "rgba(150, 110, 255, 0.35)";
      ctx.fill();
      ctx.strokeStyle = "#c9a8ff";
      ctx.lineWidth = 1;
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };

    ctx.fillStyle = "#05011a";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [spanKHz]);

  const half = spanKHz / 2;
  const tuneLinePercent = Math.max(2, Math.min(98, 50 + ((centerFreqKHz - windowCenterKHz) / spanKHz) * 100));

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onTuneTo) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xFrac = (e.clientX - rect.left) / rect.width;
    const offsetKHz = (Math.max(0, Math.min(1, xFrac)) - 0.5) * spanKHz;
    const freqKHz = Math.round((windowCenterKHz + offsetKHz) * 100) / 100;
    onTuneTo(freqKHz);
  };

  return (
    <div className="waterfall">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        onClick={onClick}
        className={onTuneTo ? "waterfall__canvas--clickable" : undefined}
      />
      <div className="waterfall__tuneline" style={{ left: `${tuneLinePercent}%` }} />
      <div className="waterfall__scale">
        <span>{(windowCenterKHz - half).toFixed(1)}</span>
        <span>{centerFreqKHz.toFixed(1)} kHz</span>
        <span>{(windowCenterKHz + half).toFixed(1)}</span>
      </div>
    </div>
  );
}
