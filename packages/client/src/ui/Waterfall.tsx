import { useEffect, useRef } from "react";

interface WaterfallProps {
  signalDb: number;
  active: boolean;
}

const WIDTH = 320;
const HEIGHT = 120;

/**
 * A stylized, decorative waterfall display. It is not a real FFT of the
 * audio (the server doesn't ship per-bin spectrum data), but reacts to the
 * current signal strength and transmit state so it still feels alive and
 * reinforces what the ear is hearing.
 */
export function Waterfall({ signalDb, active }: WaterfallProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const signalRef = useRef(signalDb);
  const activeRef = useRef(active);
  signalRef.current = signalDb;
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const draw = () => {
      const image = ctx.getImageData(0, 0, WIDTH, HEIGHT - 1);
      ctx.putImageData(image, 0, 1);

      const level = Math.max(0, Math.min(1, (signalRef.current + 95) / 110));
      const center = WIDTH / 2 + (Math.random() - 0.5) * 6;
      const spread = 10 + level * 40;

      const row = ctx.createImageData(WIDTH, 1);
      for (let x = 0; x < WIDTH; x++) {
        const distance = Math.abs(x - center);
        const falloff = Math.exp(-(distance * distance) / (2 * spread * spread));
        const noise = Math.random() * 0.15;
        const intensity = Math.min(1, level * falloff * (activeRef.current ? 1.3 : 1) + noise * 0.3);

        const idx = x * 4;
        row.data[idx] = 20 + intensity * 235;
        row.data[idx + 1] = 60 + intensity * 140;
        row.data[idx + 2] = 40 + intensity * 40;
        row.data[idx + 3] = 255;
      }
      ctx.putImageData(row, 0, 0);
      raf = requestAnimationFrame(draw);
    };

    ctx.fillStyle = "#001a0a";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="waterfall">
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} />
    </div>
  );
}
