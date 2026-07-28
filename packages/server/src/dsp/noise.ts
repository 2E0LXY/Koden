import type { Band, FilterWidth, Mode } from "@koden/shared";
import { passbandKHz } from "./propagation.js";

/** dBFS-ish gain helper: convert a dB value to a linear amplitude multiplier. */
export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

export function linearToDb(linear: number): number {
  return 20 * Math.log10(Math.max(linear, 1e-9));
}

/**
 * Paul Kellet's refined pink noise filter. Pink (1/f) noise is a much closer
 * match to real atmospheric HF static than plain white noise.
 */
export class PinkNoise {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private b3 = 0;
  private b4 = 0;
  private b5 = 0;
  private b6 = 0;

  next(): number {
    const white = Math.random() * 2 - 1;
    this.b0 = 0.99886 * this.b0 + white * 0.0555179;
    this.b1 = 0.99332 * this.b1 + white * 0.0750759;
    this.b2 = 0.969 * this.b2 + white * 0.153852;
    this.b3 = 0.8665 * this.b3 + white * 0.3104856;
    this.b4 = 0.55 * this.b4 + white * 0.5329522;
    this.b5 = -0.7616 * this.b5 - white * 0.016898;
    const pink =
      this.b0 +
      this.b1 +
      this.b2 +
      this.b3 +
      this.b4 +
      this.b5 +
      this.b6 +
      white * 0.5362;
    this.b6 = white * 0.115926;
    return pink * 0.11; // roughly normalize to [-1, 1]
  }

  fill(out: Float32Array): void {
    for (let i = 0; i < out.length; i++) out[i] = this.next();
  }
}

/**
 * Minimal RBJ-cookbook biquad, used server-side (no Web Audio API in Node)
 * to shape noise per-mode: a narrow bandpass to make CW noise sound thin
 * and "whistly" through a narrow filter, and a gentle lowpass to make AM
 * noise sound duller/warmer than broadband SSB hiss.
 */
class Biquad {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  static bandpass(sampleRate: number, freq: number, q: number): Biquad {
    const w0 = (2 * Math.PI * freq) / sampleRate;
    const alpha = Math.sin(w0) / (2 * q);
    const b0 = alpha;
    const b1 = 0;
    const b2 = -alpha;
    const a0 = 1 + alpha;
    const a1 = -2 * Math.cos(w0);
    const a2 = 1 - alpha;
    return Biquad.normalized(b0, b1, b2, a0, a1, a2);
  }

  static lowpass(sampleRate: number, freq: number, q: number): Biquad {
    const w0 = (2 * Math.PI * freq) / sampleRate;
    const alpha = Math.sin(w0) / (2 * q);
    const cosw0 = Math.cos(w0);
    const b1 = 1 - cosw0;
    const b0 = b1 / 2;
    const b2 = b0;
    const a0 = 1 + alpha;
    const a1 = -2 * cosw0;
    const a2 = 1 - alpha;
    return Biquad.normalized(b0, b1, b2, a0, a1, a2);
  }

  private static normalized(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Biquad {
    const f = new Biquad();
    f.b0 = b0 / a0;
    f.b1 = b1 / a0;
    f.b2 = b2 / a0;
    f.a1 = a1 / a0;
    f.a2 = a2 / a0;
    return f;
  }

  processInPlace(buf: Float32Array): void {
    for (let i = 0; i < buf.length; i++) {
      const x0 = buf[i];
      const y0 = this.b0 * x0 + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1;
      this.x1 = x0;
      this.y2 = this.y1;
      this.y1 = y0;
      buf[i] = y0;
    }
  }
}

/**
 * Atmospheric "crash" static: sparse impulses (Poisson arrivals) with a
 * short, sharp exponential decay, like distant lightning strokes riding on
 * HF -- much more prominent on the lower bands (160m/80m/40m), and worse at
 * night once the D-layer stops absorbing distant thunderstorm noise.
 */
export class AtmosphericCrackle {
  private samplesUntilNext = 0;
  private decayRemaining = 0;
  private decayGain = 0;

  constructor(
    private sampleRate: number,
    private cracklesPerSecond: number,
    private intensity: number,
  ) {
    this.scheduleNext();
  }

  private scheduleNext(): void {
    const meanGapSamples = this.sampleRate / Math.max(this.cracklesPerSecond, 0.001);
    // Exponential inter-arrival time for a Poisson process.
    this.samplesUntilNext = Math.round(-Math.log(1 - Math.random()) * meanGapSamples);
  }

  setRate(cracklesPerSecond: number): void {
    this.cracklesPerSecond = cracklesPerSecond;
  }

  fillAdd(out: Float32Array): void {
    for (let i = 0; i < out.length; i++) {
      if (this.decayRemaining > 0) {
        out[i] += this.decayGain * this.intensity;
        this.decayGain *= 0.75;
        this.decayRemaining--;
      }
      if (this.samplesUntilNext <= 0) {
        this.decayGain = 0.6 + Math.random() * 0.4;
        this.decayRemaining = 20 + Math.floor(Math.random() * 60);
        this.scheduleNext();
      } else {
        this.samplesUntilNext--;
      }
    }
  }
}

/** A fixed low-level heterodyne tone ("birdie") at a constant offset. */
export class Birdie {
  private phase = 0;

  constructor(
    private freqHz: number,
    private sampleRate: number,
    private amplitude: number,
  ) {}

  fillAdd(out: Float32Array): void {
    const step = (2 * Math.PI * this.freqHz) / this.sampleRate;
    for (let i = 0; i < out.length; i++) {
      out[i] += Math.sin(this.phase) * this.amplitude;
      this.phase += step;
      if (this.phase > Math.PI * 2) this.phase -= Math.PI * 2;
    }
  }
}

/** Bandwidth of a "reference" SSB receiver, kHz -- the band noise floors in bands.ts are tuned around this. */
const REFERENCE_BANDWIDTH_KHZ = 3;

/**
 * Per-mode noise floor gain adjustment. Real receiver noise power scales
 * with the receiver's passband bandwidth: a 500Hz CW filter admits far less
 * atmospheric/thermal noise than a 15kHz FM filter, so a narrower mode
 * should sound quieter (and a wider one louder) even on the same band.
 */
export function modeNoiseGainDb(mode: Mode, filterWidth: FilterWidth): number {
  const bandwidthKHz = passbandKHz(mode, filterWidth);
  const gain = 10 * Math.log10(bandwidthKHz / REFERENCE_BANDWIDTH_KHZ);
  return Math.max(-9, Math.min(8, gain));
}

/** Per-band, per-mode ambient noise generator combining pink noise, crackle, and birdies. */
export class BandNoiseGenerator {
  private pink = new PinkNoise();
  private crackle: AtmosphericCrackle;
  private birdies: Birdie[];
  private shaper: Biquad | null = null;
  private shaperMakeupGain = 1;
  private baseCracklesPerSecond: number;

  constructor(
    band: Band,
    sampleRate: number,
    private mode: Mode,
    _filterWidth: FilterWidth,
  ) {
    // Lower bands pick up far more atmospheric/lightning static.
    const lowBandBoost = Math.max(0, (7000 - band.rangeKHz[0]) / 7000);
    this.baseCracklesPerSecond = 0.5 + lowBandBoost * 6;
    const crackleIntensity = 0.15 + lowBandBoost * 0.35;
    this.crackle = new AtmosphericCrackle(sampleRate, this.baseCracklesPerSecond, crackleIntensity);

    // A couple of faint fixed birdies scattered across the band, as if from
    // internal oscillator harmonics -- cosmetic realism, not tied to any tx.
    // Kept small relative to the pink noise's own pre-gain amplitude (~0.1)
    // so they read as faint accents, not a dominant tone.
    this.birdies = [
      new Birdie(sampleRate * 0.11, sampleRate, 0.02),
      new Birdie(sampleRate * 0.27, sampleRate, 0.01),
    ];

    // CW is heard through a narrow filter centered on the sidetone pitch,
    // so its noise is thinner than broadband SSB hiss -- but the Q has to
    // stay low enough that it still sounds like textured (if narrow) hiss
    // rather than a pure ringing tone. AM's wider, symmetric double-sideband
    // detector tends to sound a little duller/warmer than a sharp SSB filter.
    if (mode === "CW" || mode === "RTTY") {
      this.shaper = Biquad.bandpass(sampleRate, 700, 0.9);
      this.shaperMakeupGain = 2.6; // narrow bandpass throws away most of the energy
    } else if (mode === "AM") {
      this.shaper = Biquad.lowpass(sampleRate, 3200, 0.7);
      this.shaperMakeupGain = 1.3;
    }
  }

  /** True if this generator can keep serving the given mode/filter without being rebuilt. */
  matches(mode: Mode): boolean {
    return this.mode === mode;
  }

  /**
   * Generate one frame of ambient band noise. `noiseFloorDb` should already
   * include any mode-bandwidth and day/night adjustments; `crackleRateMultiplier`
   * lets callers boost atmospheric crashes at night without rebuilding the generator.
   */
  generate(nSamples: number, noiseFloorDb: number, crackleRateMultiplier = 1): Float32Array {
    const out = new Float32Array(nSamples);
    this.pink.fill(out);

    this.crackle.setRate(this.baseCracklesPerSecond * crackleRateMultiplier);
    this.crackle.fillAdd(out);
    for (const b of this.birdies) b.fillAdd(out);

    // The mode filter shapes *everything* reaching the ear (atmospheric
    // noise, crackle, birdies alike), not just the raw pink noise -- and the
    // final noiseFloorDb-derived gain has to apply after that, to the whole
    // combined signal, so accents stay proportional to the ambient floor
    // instead of sitting at a fixed loudness regardless of band/mode.
    if (this.shaper) this.shaper.processInPlace(out);

    const gain = dbToLinear(noiseFloorDb) * this.shaperMakeupGain;
    for (let i = 0; i < out.length; i++) out[i] *= gain;
    return out;
  }
}
