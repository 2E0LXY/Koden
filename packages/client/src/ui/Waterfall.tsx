import { useEffect, useRef } from "react";

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
}

const WIDTH = 320;
const HEIGHT = 120;
const SCOPE_HEIGHT = 26;
const FALL_TOP = SCOPE_HEIGHT + 2;
const FALL_HEIGHT = HEIGHT - FALL_TOP;

/**
 * A stylized panadapter/waterfall combo styled after a typical HF
 * transceiver's blue-purple spectrum display: a live scope trace on top, a
 * scrolling waterfall below, and a red tuning line at centre. There's no
 * real per-bin FFT to draw (the server doesn't ship one) -- every bump on
 * screen instead comes from real data: the actual noise floor level, the
 * real signal you're receiving at the tuned frequency, and every other
 * roster station plotted at its real frequency offset, sized by whether
 * the mixer actually reports it as audible right now. The only randomness
 * is a faint per-pixel dither for texture, not fabricated activity.
 */
export function Waterfall({
  signalDb,
  noiseFloorDb,
  active,
  centerFreqKHz = 0,
  spanKHz = 6,
  stations = [],
}: WaterfallProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const signalRef = useRef(signalDb);
  const noiseFloorRef = useRef(noiseFloorDb);
  const activeRef = useRef(active);
  const centerRef = useRef(centerFreqKHz);
  const stationsRef = useRef(stations);
  signalRef.current = signalDb;
  noiseFloorRef.current = noiseFloorDb;
  activeRef.current = active;
  centerRef.current = centerFreqKHz;
  stationsRef.current = stations;

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
        const offsetKHz = s.freqKHz - centerRef.current;
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
      const ownX = WIDTH / 2;

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

  return (
    <div className="waterfall">
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} />
      <div className="waterfall__tuneline" />
      <div className="waterfall__scale">
        <span>-{half.toFixed(1)}</span>
        <span>{centerFreqKHz.toFixed(1)} kHz</span>
        <span>+{half.toFixed(1)}</span>
      </div>
    </div>
  );
}
