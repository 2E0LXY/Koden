import { useEffect, useRef } from "react";

interface WaterfallStation {
  id: string;
  freqKHz: number;
  transmitting: boolean;
}

interface WaterfallProps {
  signalDb: number;
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

interface Blip {
  x: number;
  driftPerSec: number;
  spread: number;
  baseIntensity: number;
  phase: number;
}

function makeBlip(): Blip {
  return {
    x: Math.random() * WIDTH,
    driftPerSec: (Math.random() - 0.5) * 3,
    spread: 3 + Math.random() * 7,
    baseIntensity: 0.2 + Math.random() * 0.45,
    phase: Math.random() * Math.PI * 2,
  };
}

const NUM_AMBIENT_BLIPS = 8;

/**
 * A stylized panadapter/waterfall combo, styled after a typical HF
 * transceiver's blue-purple spectrum display: a live scope trace on top,
 * a scrolling waterfall below, and a red tuning line at centre. It isn't a
 * real FFT of the audio (the server doesn't ship per-bin spectrum data) --
 * the ambient "band activity" blips are decorative, but any other station
 * on the roster is plotted at its real frequency offset from centre.
 */
export function Waterfall({ signalDb, active, centerFreqKHz = 0, spanKHz = 6, stations = [] }: WaterfallProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const signalRef = useRef(signalDb);
  const activeRef = useRef(active);
  const centerRef = useRef(centerFreqKHz);
  const stationsRef = useRef(stations);
  signalRef.current = signalDb;
  activeRef.current = active;
  centerRef.current = centerFreqKHz;
  stationsRef.current = stations;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const blips = Array.from({ length: NUM_AMBIENT_BLIPS }, makeBlip);
    let lastTime = performance.now();
    let raf = 0;

    const intensityAt = (x: number, level: number, ownX: number): number => {
      let intensity = 0.03 + Math.random() * 0.02;

      for (const b of blips) {
        const d = x - b.x;
        const falloff = Math.exp(-(d * d) / (2 * b.spread * b.spread));
        intensity += falloff * b.baseIntensity * (0.7 + 0.3 * Math.sin(b.phase));
      }

      for (const s of stationsRef.current) {
        const offsetKHz = s.freqKHz - centerRef.current;
        const sx = WIDTH / 2 + (offsetKHz / spanKHz) * WIDTH;
        if (sx < -10 || sx > WIDTH + 10) continue;
        const d = x - sx;
        const spread = s.transmitting ? 5 : 3;
        const falloff = Math.exp(-(d * d) / (2 * spread * spread));
        intensity += falloff * (s.transmitting ? 0.9 : 0.35);
      }

      const ownD = x - ownX;
      const ownSpread = 6 + level * 20;
      intensity += Math.exp(-(ownD * ownD) / (2 * ownSpread * ownSpread)) * level * (activeRef.current ? 1.2 : 1);

      return Math.min(1, intensity);
    };

    const draw = (now: number) => {
      const dtSec = Math.min(0.2, (now - lastTime) / 1000);
      lastTime = now;

      for (const b of blips) {
        b.x += b.driftPerSec * dtSec;
        if (b.x < -10 || b.x > WIDTH + 10 || Math.random() < 0.002) Object.assign(b, makeBlip());
        b.phase += dtSec * 2;
      }

      const level = Math.max(0, Math.min(1, (signalRef.current + 95) / 110));
      const ownX = WIDTH / 2 + (Math.random() - 0.5) * 3;

      // Scroll the waterfall region down by one row, then paint a fresh one.
      const image = ctx.getImageData(0, FALL_TOP, WIDTH, FALL_HEIGHT - 1);
      ctx.putImageData(image, 0, FALL_TOP + 1);

      const row = ctx.createImageData(WIDTH, 1);
      for (let x = 0; x < WIDTH; x++) {
        const intensity = intensityAt(x, level, ownX);
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
        const intensity = intensityAt(x, level, ownX);
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
