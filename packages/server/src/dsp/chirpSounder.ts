export const CHIRP_SOUNDER_ID = "chirp-sounder";
export const CHIRP_SOUNDER_SIGNAL_DB = -22;

const SWEEP_START_KHZ = 1700;
const SWEEP_END_KHZ = 30000;
const SWEEP_DURATION_SEC = 15;
const MEAN_GAP_SEC = 8 * 60;

/**
 * An ionospheric "chirp" sounder: sweeps its transmit frequency across the
 * whole HF range every several minutes. Real sweeps are fast enough that a
 * per-tick (20ms) sample of "where is it right now" would usually skip
 * straight over any given listener's narrow passband between one tick and
 * the next -- so instead of checking an instantaneous frequency, `tick()`
 * returns the *range* the sweep crossed since the last call, and the
 * caller checks whether their own tuned frequency fell inside that range.
 */
export class ChirpSounder {
  private samplesUntilNext = 0;
  private sweepElapsedSamples = -1;
  private prevFreqKHz = SWEEP_START_KHZ;

  constructor(private sampleRate: number) {
    this.scheduleNext();
  }

  private scheduleNext(): void {
    this.samplesUntilNext = Math.round(this.sampleRate * MEAN_GAP_SEC * (0.6 + Math.random() * 0.8));
  }

  /** Advance by one tick's worth of samples. Returns the [lowKHz, highKHz] range swept through this tick, or null if not currently sweeping. */
  tick(nSamples: number): [number, number] | null {
    if (this.sweepElapsedSamples < 0) {
      if (this.samplesUntilNext <= nSamples) {
        this.sweepElapsedSamples = 0;
        this.prevFreqKHz = SWEEP_START_KHZ;
      } else {
        this.samplesUntilNext -= nSamples;
        return null;
      }
    }
    this.sweepElapsedSamples += nSamples;
    const t = Math.min(1, this.sweepElapsedSamples / (this.sampleRate * SWEEP_DURATION_SEC));
    const newFreqKHz = SWEEP_START_KHZ + t * (SWEEP_END_KHZ - SWEEP_START_KHZ);
    const bracket: [number, number] = [Math.min(this.prevFreqKHz, newFreqKHz), Math.max(this.prevFreqKHz, newFreqKHz)];
    this.prevFreqKHz = newFreqKHz;
    if (t >= 1) {
      this.sweepElapsedSamples = -1;
      this.scheduleNext();
    }
    return bracket;
  }
}

const CHIRP_VOICE_SEC = 0.25;
const CHIRP_START_HZ = 300;
const CHIRP_END_HZ = 2200;

/** One listener's brief, self-contained "whoosh" when the sounder's sweep crosses their tuned frequency -- decoupled from the sweep's own coarse tick timing so it always plays out as a real, audible chirp once triggered. */
export class ChirpVoice {
  private remainingSamples = 0;
  private readonly totalSamples: number;
  private phase = 0;

  constructor(private sampleRate: number) {
    this.totalSamples = Math.round(sampleRate * CHIRP_VOICE_SEC);
  }

  get active(): boolean {
    return this.remainingSamples > 0;
  }

  trigger(): void {
    this.remainingSamples = this.totalSamples;
    this.phase = 0;
  }

  render(nSamples: number): Float32Array {
    const out = new Float32Array(nSamples);
    const n = Math.min(nSamples, this.remainingSamples);
    for (let i = 0; i < n; i++) {
      const t = 1 - this.remainingSamples / this.totalSamples;
      const hz = CHIRP_START_HZ + t * (CHIRP_END_HZ - CHIRP_START_HZ);
      const fadeIn = Math.min(1, (this.totalSamples - this.remainingSamples) / (this.sampleRate * 0.02));
      const fadeOut = Math.min(1, this.remainingSamples / (this.sampleRate * 0.05));
      out[i] = Math.sin(this.phase) * fadeIn * fadeOut * 0.8;
      this.phase += (2 * Math.PI * hz) / this.sampleRate;
      if (this.phase > Math.PI * 2) this.phase -= Math.PI * 2;
      this.remainingSamples--;
    }
    return out;
  }
}
