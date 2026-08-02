import { useEffect, useRef, useState } from "react";
import { PanelButton } from "./PanelButton.js";

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
  /** The current band's edges, used as the visible window in Fixed mode. */
  bandRangeKHz?: [number, number];
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

// Selectable scope spans, kHz -- a trimmed version of the IC-7300's
// ±2.5/5/10/25/50/100/250/500 kHz list, scaled down to what's meaningful for
// this simulator's station density (a real HF band here rarely has more
// than a handful of simultaneous roster stations to spread across).
const SPAN_PRESETS = [3, 6, 12, 25, 50];
const DEFAULT_SPAN_IDX = 1; // 6 kHz, matches the previous fixed default

const SPEED_PRESETS = ["FAST", "MID", "SLOW"] as const;
type Speed = (typeof SPEED_PRESETS)[number];
// Frames (at ~60fps) between waterfall/scope refreshes -- controls both the
// FFT scope refresh and waterfall scroll speed together, same as a real
// IC-7300's SPEED setting.
const SPEED_FRAME_DIVISOR: Record<Speed, number> = { FAST: 1, MID: 2, SLOW: 4 };

const REF_LEVELS = [-20, -10, 0, 10, 20];

// How long a first touch stays "zoomed in" (magnified, awaiting a
// confirming second touch) before automatically reverting -- mirrors the
// IC-7300 closing its zoom popup if you don't touch the signal.
const ZOOM_TIMEOUT_MS = 4000;
const ZOOM_FACTOR = 3;
// Peak/max-hold trace decays to near-zero after ~10s, matching the
// IC-7300's default "10s Hold" option.
const HOLD_DECAY_PER_FRAME = 0.992;

/**
 * A stylized panadapter/waterfall combo modeled on the IC-7300's spectrum
 * scope: a live scope trace on top, a scrolling waterfall below, a tuning
 * marker, and the same Center/Fixed mode split, adjustable span, sweep
 * speed, peak hold and reference level controls, plus its touch-to-zoom-
 * then-tune interaction. There's no real per-bin FFT to draw (the server
 * doesn't ship one) -- every bump on screen instead comes from real data:
 * the actual noise floor level, the real signal you're receiving (including
 * live playback level, so real interference flickers show up as it's
 * actually heard), and every other roster station plotted at its real
 * frequency offset, sized by whether the mixer actually reports it as
 * audible right now. The only randomness is a faint per-pixel dither for
 * texture, not fabricated activity.
 *
 * Center mode (default): the tuning line always sits dead centre and the
 * frequency window scrolls continuously to track it. Fixed mode: the window
 * stays anchored to the current band's edges and the tuning marker moves
 * within it instead -- exactly the IC-7300's Center/Fixed split.
 */
export function Waterfall({
  signalDb,
  noiseFloorDb,
  active,
  centerFreqKHz = 0,
  bandRangeKHz,
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

  const [scopeMode, setScopeMode] = useState<"CENTER" | "FIXED">("CENTER");
  const [spanIdx, setSpanIdx] = useState(DEFAULT_SPAN_IDX);
  const [speed, setSpeed] = useState<Speed>("MID");
  const [holdOn, setHoldOn] = useState(false);
  const [refIdx, setRefIdx] = useState(2); // 0 dB
  const [zoom, setZoom] = useState<{ atKHz: number; spanKHz: number } | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const holdOnRef = useRef(holdOn);
  holdOnRef.current = holdOn;
  const refGainRef = useRef(1);
  refGainRef.current = 1 + REF_LEVELS[refIdx] / 40;

  useEffect(() => {
    if (!zoom) return;
    const t = setTimeout(() => setZoom(null), ZOOM_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [zoom]);

  const baseSpanKHz = SPAN_PRESETS[spanIdx];
  // Fixed mode shows the whole band, Center mode shows the selected span
  // around the tuned frequency -- unless a zoom is active, which magnifies
  // around the touched point regardless of mode.
  const bandSpanKHz = bandRangeKHz ? bandRangeKHz[1] - bandRangeKHz[0] : baseSpanKHz;
  const bandCenterKHz = bandRangeKHz ? (bandRangeKHz[0] + bandRangeKHz[1]) / 2 : centerFreqKHz;
  const effectiveSpanKHz = zoom ? zoom.spanKHz : scopeMode === "FIXED" ? bandSpanKHz : baseSpanKHz;
  const windowCenterKHz = zoom ? zoom.atKHz : scopeMode === "FIXED" ? bandCenterKHz : centerFreqKHz;
  const windowCenterRef = useRef(windowCenterKHz);
  windowCenterRef.current = windowCenterKHz;
  const effectiveSpanRef = useRef(effectiveSpanKHz);
  effectiveSpanRef.current = effectiveSpanKHz;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let frameCount = 0;
    const holdTrace = new Float32Array(WIDTH);

    const intensityAt = (x: number, level: number, ownX: number, floorLevel: number, liveActivity: number): number => {
      const span = effectiveSpanRef.current;
      // Real ambient noise floor, not a fabricated wander -- plus a faint
      // per-pixel dither so it reads as static texture rather than a flat
      // band.
      let intensity = floorLevel * 0.35 + Math.random() * 0.05;

      for (const s of stationsRef.current) {
        const offsetKHz = s.freqKHz - windowCenterRef.current;
        const sx = WIDTH / 2 + (offsetKHz / span) * WIDTH;
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

      // Reference level: a purely cosmetic contrast adjustment, just like
      // the real REF control -- it doesn't touch the actual receive chain.
      intensity *= refGainRef.current;

      return Math.min(1, intensity);
    };

    const draw = () => {
      frameCount++;
      const divisor = SPEED_FRAME_DIVISOR[speed];
      const shouldUpdate = frameCount % divisor === 0;

      // The server reports the S-meter as the band's own noise floor (not
      // "no signal") whenever nothing is actually audible, so a real bump
      // has to be sized by how far the signal rises *above* that floor --
      // using the raw absolute level would paint a permanent hot spot at
      // the tuned frequency even with nothing there.
      const level = Math.max(0, Math.min(1, (signalRef.current - noiseFloorRef.current) / 40));
      const floorLevel = Math.max(0, Math.min(1, (noiseFloorRef.current + 95) / 110));
      const span = effectiveSpanRef.current;
      const ownOffsetKHz = tunedRef.current - windowCenterRef.current;
      const ownX = WIDTH / 2 + (ownOffsetKHz / span) * WIDTH;
      const live = getLiveLevelRef.current?.() ?? { rms: 0, peak: 0 };
      // Peak catches brief transients (a single crackle pop) that an RMS
      // average would smooth away; RMS reflects sustained buzz/whistle
      // presence. Blend both so either kind of activity shows up.
      const liveActivity = Math.min(1, Math.max(live.peak * 0.85, live.rms * 1.4));

      if (shouldUpdate) {
        // Scroll the waterfall region down by one row, then paint a fresh one.
        const image = ctx.getImageData(0, FALL_TOP, WIDTH, FALL_HEIGHT - 1);
        ctx.putImageData(image, 0, FALL_TOP + 1);
      }

      const row = shouldUpdate ? ctx.createImageData(WIDTH, 1) : null;
      const scopeIntensities = new Float32Array(WIDTH);
      for (let x = 0; x < WIDTH; x++) {
        const intensity = intensityAt(x, level, ownX, floorLevel, liveActivity);
        scopeIntensities[x] = intensity;
        if (row) {
          const idx = x * 4;
          // Deep blue -> purple -> pink/white as intensity rises.
          row.data[idx] = 20 + intensity * 210;
          row.data[idx + 1] = 10 + intensity * 55;
          row.data[idx + 2] = 70 + intensity * 185;
          row.data[idx + 3] = 255;
        }
        if (holdOnRef.current) {
          holdTrace[x] = Math.max(holdTrace[x] * HOLD_DECAY_PER_FRAME, intensity);
        } else {
          holdTrace[x] = 0;
        }
      }
      if (row) ctx.putImageData(row, 0, FALL_TOP);

      // Redraw the scope trace fresh every frame (an instantaneous snapshot,
      // not scrolled) as a filled silhouette above the waterfall.
      ctx.fillStyle = "#0a0420";
      ctx.fillRect(0, 0, WIDTH, SCOPE_HEIGHT);
      ctx.beginPath();
      ctx.moveTo(0, SCOPE_HEIGHT);
      for (let x = 0; x < WIDTH; x++) {
        ctx.lineTo(x, SCOPE_HEIGHT - scopeIntensities[x] * (SCOPE_HEIGHT - 2));
      }
      ctx.lineTo(WIDTH, SCOPE_HEIGHT);
      ctx.closePath();
      ctx.fillStyle = "rgba(150, 110, 255, 0.35)";
      ctx.fill();
      ctx.strokeStyle = "#c9a8ff";
      ctx.lineWidth = 1;
      ctx.stroke();

      if (holdOnRef.current) {
        ctx.beginPath();
        for (let x = 0; x < WIDTH; x++) {
          const y = SCOPE_HEIGHT - holdTrace[x] * (SCOPE_HEIGHT - 2);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = "#ffcf5c";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };

    ctx.fillStyle = "#05011a";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [speed]);

  const half = effectiveSpanKHz / 2;
  const markerX =
    scopeMode === "FIXED" && !zoom
      ? WIDTH / 2 + ((centerFreqKHz - windowCenterKHz) / effectiveSpanKHz) * WIDTH
      : WIDTH / 2;
  const markerFrac = Math.max(0, Math.min(100, (markerX / WIDTH) * 100));

  const freqAtClick = (e: React.MouseEvent<HTMLCanvasElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xFrac = (e.clientX - rect.left) / rect.width;
    const offsetKHz = (Math.max(0, Math.min(1, xFrac)) - 0.5) * effectiveSpanKHz;
    return Math.round((windowCenterKHz + offsetKHz) * 100) / 100;
  };

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onTuneTo) return;
    const clickedFreq = freqAtClick(e);
    if (!zoomRef.current) {
      // First touch: magnify around the touched point, like the IC-7300's
      // "touch the scope zone to zoom in" -- doesn't tune yet.
      setZoom({ atKHz: clickedFreq, spanKHz: effectiveSpanKHz / ZOOM_FACTOR });
      return;
    }
    // Second touch inside the zoomed view: commit the tune, then close the
    // zoom (Center mode recentres on it automatically; Fixed mode just
    // moves the marker).
    onTuneTo(clickedFreq);
    setZoom(null);
  };

  return (
    <div className="waterfall-block">
      <div className="waterfall">
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          onClick={onClick}
          className={onTuneTo ? "waterfall__canvas--clickable" : undefined}
        />
        <div className="waterfall__tuneline" style={{ left: `${markerFrac}%` }} />
        <div className="waterfall__scale">
          <span>{(windowCenterKHz - half).toFixed(1)}</span>
          <span>
            {scopeMode} {zoom ? "ZOOM" : ""} {holdOn ? "HOLD" : ""}
          </span>
          <span>{(windowCenterKHz + half).toFixed(1)}</span>
        </div>
      </div>
      <div className="waterfall__controls">
        <PanelButton
          small
          label="SPAN"
          disabled={scopeMode === "FIXED"}
          onClick={() => setSpanIdx((i) => (i + 1) % SPAN_PRESETS.length)}
          title={`Scope span: ±${(baseSpanKHz / 2).toFixed(1)} kHz`}
        />
        <PanelButton
          small
          label="CENT/FIX"
          active={scopeMode === "FIXED"}
          onClick={() => setScopeMode((m) => (m === "CENTER" ? "FIXED" : "CENTER"))}
          title="Center mode (tracks tuning) or Fixed mode (shows the whole band, marker moves)"
        />
        <PanelButton
          small
          label="HOLD"
          active={holdOn}
          onClick={() => setHoldOn((h) => !h)}
          title="Peak hold: overlay the highest level seen per position, decaying over ~10s"
        />
        <PanelButton
          small
          label="REF"
          onClick={() => setRefIdx((i) => (i + 1) % REF_LEVELS.length)}
          title={`Reference level: ${REF_LEVELS[refIdx] >= 0 ? "+" : ""}${REF_LEVELS[refIdx]} dB`}
        />
        <PanelButton
          small
          label="SPEED"
          onClick={() => setSpeed((s) => SPEED_PRESETS[(SPEED_PRESETS.indexOf(s) + 1) % SPEED_PRESETS.length])}
          title={`Sweep/waterfall speed: ${speed}`}
        />
      </div>
    </div>
  );
}
