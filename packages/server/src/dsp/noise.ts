import type { Band } from "@koden/shared";

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
 * Atmospheric "crash" static: sparse impulses (Poisson arrivals) with a
 * short, sharp exponential decay, like distant lightning strokes riding on
 * HF -- much more prominent on the lower bands (160m/80m/40m).
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

/** Per-band ambient noise generator combining pink noise, crackle, and birdies. */
export class BandNoiseGenerator {
  private pink = new PinkNoise();
  private crackle: AtmosphericCrackle;
  private birdies: Birdie[];

  constructor(band: Band, sampleRate: number) {
    // Lower bands pick up far more atmospheric/lightning static.
    const lowBandBoost = Math.max(0, (7000 - band.rangeKHz[0]) / 7000);
    const cracklesPerSecond = 0.5 + lowBandBoost * 6;
    const crackleIntensity = 0.15 + lowBandBoost * 0.35;
    this.crackle = new AtmosphericCrackle(sampleRate, cracklesPerSecond, crackleIntensity);

    // A couple of faint fixed birdies scattered across the band, as if from
    // internal oscillator harmonics -- cosmetic realism, not tied to any tx.
    this.birdies = [
      new Birdie(sampleRate * 0.11, sampleRate, 0.01),
      new Birdie(sampleRate * 0.27, sampleRate, 0.006),
    ];
  }

  /** Generate one frame of ambient band noise scaled by the given noise floor in dB. */
  generate(nSamples: number, noiseFloorDb: number): Float32Array {
    const out = new Float32Array(nSamples);
    this.pink.fill(out);
    const gain = dbToLinear(noiseFloorDb);
    for (let i = 0; i < out.length; i++) out[i] *= gain;
    this.crackle.fillAdd(out);
    for (const b of this.birdies) b.fillAdd(out);
    return out;
  }
}
