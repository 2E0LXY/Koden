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

  constructor(sampleRate: number, frameSamples: number) {
    this.maxFrames = Math.ceil((MAX_RECORD_SECONDS * sampleRate) / frameSamples);
  }

  /**
   * Call once per tick (not per listener) with whichever stations are
   * currently transmitting into the parrot's passband this tick. Claims
   * the first such station as the current recording when idle, appends
   * its frame while that same station keeps transmitting, and starts the
   * replay countdown once it stops.
   */
  tick(nowMs: number, transmittingIntoParrot: { id: string; frame: Float32Array }[]): void {
    if (this.state === "idle") {
      const first = transmittingIntoParrot[0];
      if (first) {
        this.state = "recording";
        this.recordingStationId = first.id;
        this.frames = [first.frame.slice()];
      }
      return;
    }

    if (this.state === "recording") {
      const mine = transmittingIntoParrot.find((c) => c.id === this.recordingStationId);
      if (mine) {
        if (this.frames.length < this.maxFrames) this.frames.push(mine.frame.slice());
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
