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
  /** Click/tap anywhere on the display to tune directly to that frequency, like a real panadapter. */
  onTuneTo?: (freqKHz: number) => void;
  /**
   * Live receive audio level (0..1 RMS/peak), read directly off actual
   * playback rather than the server's slower periodic meter reports -- lets
   * real interference (crackle, buzz, whistle) show up on the display as it
   * happens instead of only a steady, averaged glow.
   */
  getLiveLevel?: () => { rms: number; peak: number };
}

const WIDTH = 320;
const HEIGHT = 120;
const SCOPE_HEIGHT = 26;
const FALL_TOP = SCOPE_HEIGHT + 2;
const FALL_HEIGHT = HEIGHT - FALL_TOP;

/**
 * A stylized panadapter/waterfall combo styled after a typical HF
 * transceiver's blue-purple spectrum display: a live scope trace on top, a
 * scrolling waterfall below, and a red tuning line. There's no real per-bin
 * FFT to draw (the server doesn't ship one) -- every bump on screen instead
 * comes from real data: the actual noise floor level, the real signal
 * you're receiving (including live playback level, so real interference
 * flickers show up as it's actually heard), and every other roster station
 * plotted at its real frequency offset, sized by whether the mixer actually
 * reports it as audible right now. The only randomness is a faint per-pixel
 * dither for texture, not fabricated activity.
 *
 * Like a real "CENTER" panadapter mode, the tuning line always sits dead
 * centre and the frequency window scrolls continuously to track it, so
 * stations and activity slide smoothly across the display as you tune
 * instead of the display staying fixed underneath a moving tuning line.
 */
export function Waterfall({
  signalDb,
  noiseFloorDb,
  active,
  centerFreqKHz = 0,
  spanKHz = 6,
  stations = [],
  onTuneTo,
  getLiveLevel,
}: WaterfallProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const signalRef = useRef(signalDb);
  const noiseFloorRef = useRef(noiseFloorDb);
  const activeRef = useRef(active);
  const stationsRef = useRef(stations);
  const tunedRef = useRef(centerFreqKHz);
  const getLiveLevelRef = useRef(getLiveLevel);
  signalRef.current = signalDb;
  noiseFloorRef.current = noiseFloorDb;
  activeRef.current = active;
  stationsRef.current = stations;
  tunedRef.current = centerFreqKHz;
  getLiveLevelRef.current = getLiveLevel;

  // The tuning line always sits at centre; the frequency window tracks the
  // tuned frequency continuously (a "CENTER" panadapter mode), so activity
  // slides smoothly across the display as you tune rather than the window
  // only jumping once you drift near its edge.
  const windowCenterKHz = centerFreqKHz;
  const windowCenterRef = useRef(windowCenterKHz);
  windowCenterRef.current = windowCenterKHz;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;

    const intensityAt = (x: number, level: number, ownX: number, floorLevel: number, liveActivity: number): number => {
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
      const ownFalloff = Math.exp(-(ownD * ownD) / (2 * ownSpread * ownSpread));
      intensity += ownFalloff * level * (activeRef.current ? 1.2 : 1);
      // Real-time playback activity -- actual interference (crackle, buzz,
      // whistle) or signal as it's actually heard right now, not just the
      // server's slower averaged meter reading -- flashes at the tuning
      // line, the same spot the audio is actually coming from.
      intensity += ownFalloff * liveActivity;

      return Math.min(1, intensity);
    };

    const draw = () => {
      // The server reports the S-meter as the band's own noise floor (not
      // "no signal") whenever nothing is actually audible, so a real bump
      // has to be sized by how far the signal rises *above* that floor --
      // using the raw absolute level would paint a permanent hot spot at
      // the tuned frequency even with nothing there.
      const level = Math.max(0, Math.min(1, (signalRef.current - noiseFloorRef.current) / 40));
      const floorLevel = Math.max(0, Math.min(1, (noiseFloorRef.current + 95) / 110));
      const ownOffsetKHz = tunedRef.current - windowCenterRef.current;
      const ownX = WIDTH / 2 + (ownOffsetKHz / spanKHz) * WIDTH;
      const live = getLiveLevelRef.current?.() ?? { rms: 0, peak: 0 };
      // Peak catches brief transients (a single crackle pop) that an RMS
      // average would smooth away; RMS reflects sustained buzz/whistle
      // presence. Blend both so either kind of activity shows up.
      const liveActivity = Math.min(1, Math.max(live.peak * 0.85, live.rms * 1.4));

      // Scroll the waterfall region down by one row, then paint a fresh one.
      const image = ctx.getImageData(0, FALL_TOP, WIDTH, FALL_HEIGHT - 1);
      ctx.putImageData(image, 0, FALL_TOP + 1);

      const row = ctx.createImageData(WIDTH, 1);
      for (let x = 0; x < WIDTH; x++) {
        const intensity = intensityAt(x, level, ownX, floorLevel, liveActivity);
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
        const intensity = intensityAt(x, level, ownX, floorLevel, liveActivity);
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
      <div className="waterfall__tuneline" style={{ left: "50%" }} />
      <div className="waterfall__scale">
        <span>{(windowCenterKHz - half).toFixed(1)}</span>
        <span>{centerFreqKHz.toFixed(1)} kHz</span>
        <span>{(windowCenterKHz + half).toFixed(1)}</span>
      </div>
    </div>
  );
}
