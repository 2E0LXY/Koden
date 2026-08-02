import type { Mode } from "@koden/shared";
import { TxBandwidthFilter } from "./audioEffects.js";

/**
 * A "parrot" test frequency: key up and talk, un-key, and after a short
 * pause it plays back exactly what you sent -- the classic ham radio way
 * to check your own TX audio (and the whole RX chain) without needing
 * another station to confirm for you. Modeled as a single shared slot
 * (like a real analog repeater's parrot function only holds one
 * recording at a time), audible to anyone tuned to it, not just whoever
 * recorded it -- a nearby station's echo test is something you'd
 * genuinely overhear in real life too.
 */
export const PARROT_FREQ_KHZ = 50999.9;
export const PARROT_ID = "parrot";
export const PARROT_CALLSIGN = "PARROT";
export const PARROT_GRID = "IO91WM";

/** Cap how long a single recording can run, so a stuck/forgotten PTT can't grow the buffer forever. */
const MAX_RECORD_SECONDS = 20;
/** Real repeater parrots pause briefly before playing back, rather than echoing instantly. */
const REPLAY_DELAY_MS = 1000;

type ParrotState = "idle" | "recording" | "waiting" | "playing";

export class ParrotEcho {
  private state: ParrotState = "idle";
  private recordingStationId: string | null = null;
  private frames: Float32Array[] = [];
  private playbackIndex = 0;
  private waitUntilMs = 0;
  private readonly maxFrames: number;
  private readonly sampleRate: number;
  /**
   * A real station's transmitted audio is band-limited to its mode's actual
   * occupied bandwidth (narrow ~300-2700Hz for SSB, wider for FM) -- see
   * TxBandwidthFilter's use for every other station's audio in mixer.ts.
   * Recording raw, unfiltered mic PCM here would make the parrot always
   * sound identically "wideband" regardless of which mode you recorded in,
   * so the same per-mode filter is applied here too, continuously across
   * the whole recording (one instance per session, not reset per frame).
   */
  private modeFilter: TxBandwidthFilter | null = null;

  constructor(sampleRate: number, frameSamples: number) {
    this.sampleRate = sampleRate;
    this.maxFrames = Math.ceil((MAX_RECORD_SECONDS * sampleRate) / frameSamples);
  }

  /**
   * Call once per tick (not per listener) with whichever stations are
   * currently keyed (PTT held) into the parrot's passband this tick, plus
   * whichever of those actually had a fresh audio frame arrive this tick,
   * plus the mode each keyed station is using. Keyed status and frame
   * availability are deliberately kept separate: a station's mic frame can
   * legitimately miss a single 20ms tick window (network/scheduling
   * jitter) without its PTT actually having been released, and treating a
   * missed frame as "released" would truncate the recording essentially
   * at random -- exactly what made this intermittent. Recording only ends
   * when the station's PTT itself goes false (or it disconnects).
   *
   * Claims the first keyed station as the current recording when idle,
   * appends its frame while that same station keeps transmitting (or
   * simply holds the gap if this particular tick had no frame yet), and
   * starts the replay countdown once its PTT actually releases.
   */
  tick(
    nowMs: number,
    keyedIntoParrot: Set<string>,
    framesById: ReadonlyMap<string, Float32Array>,
    modesById: ReadonlyMap<string, Mode>,
  ): void {
    if (this.state === "idle") {
      const [firstId] = keyedIntoParrot;
      if (firstId !== undefined) {
        this.state = "recording";
        this.recordingStationId = firstId;
        this.modeFilter = new TxBandwidthFilter(this.sampleRate, modesById.get(firstId) ?? "USB");
        const frame = framesById.get(firstId);
        this.frames = frame ? [this.shapeFrame(frame)] : [];
      }
      return;
    }

    if (this.state === "recording") {
      if (keyedIntoParrot.has(this.recordingStationId!)) {
        const frame = framesById.get(this.recordingStationId!);
        if (frame && this.frames.length < this.maxFrames) this.frames.push(this.shapeFrame(frame));
        return;
      }
      // The recording station released PTT (or dropped) -- queue the replay.
      this.state = "waiting";
      this.waitUntilMs = nowMs + REPLAY_DELAY_MS;
      return;
    }

    if (this.state === "waiting" && nowMs >= this.waitUntilMs) {
      this.state = "playing";
      this.playbackIndex = 0;
    }
  }

  private shapeFrame(frame: Float32Array): Float32Array {
    const shaped = frame.slice();
    this.modeFilter!.processInPlace(shaped);
    return shaped;
  }

  /** If a disconnect interrupts an in-progress recording, queue the replay of whatever was captured rather than leaving the slot stuck. */
  handleDisconnect(stationId: string, nowMs: number): void {
    if (this.state === "recording" && this.recordingStationId === stationId) {
      this.state = "waiting";
      this.waitUntilMs = nowMs + REPLAY_DELAY_MS;
    }
  }

  /** True while actively replaying a recording this tick. */
  isPlaying(): boolean {
    return this.state === "playing";
  }

  /** Advances playback by one frame; call exactly once per tick (shared across all listeners), same as the beacon's envelope. */
  nextFrame(): Float32Array | null {
    if (this.state !== "playing") return null;
    const frame = this.frames[this.playbackIndex] ?? null;
    this.playbackIndex++;
    if (this.playbackIndex >= this.frames.length) {
      this.state = "idle";
      this.recordingStationId = null;
      this.frames = [];
    }
    return frame;
  }
}
