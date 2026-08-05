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
export class Biquad {
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

  static highpass(sampleRate: number, freq: number, q: number): Biquad {
    const w0 = (2 * Math.PI * freq) / sampleRate;
    const alpha = Math.sin(w0) / (2 * q);
    const cosw0 = Math.cos(w0);
    const b1 = -(1 + cosw0);
    const b0 = -b1 / 2;
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
  private intensityAtTrigger = 1;
  // A slow LFO so activity waxes and wanes over minutes -- distant storm
  // cells and propagation conditions drift, rather than the same band
  // sounding statistically identical for as long as you stay tuned to it.
  private activityPhase = Math.random() * Math.PI * 2;

  constructor(
    private sampleRate: number,
    private cracklesPerSecond: number,
    private intensity: number,
  ) {
    this.scheduleNext(1);
  }

  private scheduleNext(activity: number): void {
    const meanGapSamples = this.sampleRate / Math.max(this.cracklesPerSecond * activity, 0.001);
    // Exponential inter-arrival time for a Poisson process.
    this.samplesUntilNext = Math.round(-Math.log(1 - Math.random()) * meanGapSamples);
  }

  setRate(cracklesPerSecond: number): void {
    this.cracklesPerSecond = cracklesPerSecond;
  }

  fillAdd(out: Float32Array): void {
    const activityStep = (2 * Math.PI * 0.006) / this.sampleRate; // ~3 min period
    for (let i = 0; i < out.length; i++) {
      this.activityPhase += activityStep;
      if (this.activityPhase > Math.PI * 2) this.activityPhase -= Math.PI * 2;
      const activity = 0.35 + 0.9 * (0.5 + 0.5 * Math.sin(this.activityPhase));

      if (this.decayRemaining > 0) {
        // A real static crash has an audible decaying "tail," not just an
        // instantaneous tick -- 0.75/sample dies out in well under a
        // millisecond, too brief to register as a discrete "pop" at all.
        out[i] += this.decayGain * this.intensityAtTrigger;
        this.decayGain *= 0.96;
        this.decayRemaining--;
      }
      if (this.samplesUntilNext <= 0) {
        this.decayGain = 0.6 + Math.random() * 0.4;
        this.intensityAtTrigger = this.intensity * (0.6 + activity * 0.6);
        this.decayRemaining = Math.round(this.sampleRate * (0.008 + Math.random() * 0.015));
        this.scheduleNext(activity);
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

/**
 * A tone whose pitch wanders slowly and randomly within a range -- the
 * classic AM-dial heterodyne whistle from a nearby channel's carrier
 * beating against your own as you tune near it, or a general unstable
 * interference wobble (unlike Birdie's perfectly fixed pitch).
 */
export class WanderingTone {
  private phase = 0;
  private freqHz: number;
  private targetHz: number;

  constructor(
    private sampleRate: number,
    private minHz: number,
    private maxHz: number,
    private amplitude: number,
    private driftHzPerSec: number,
    /** 0..1, picks the starting pitch deterministically instead of fully at random, so the same band/mode sounds like the same station each time instead of a new random pitch on every switch. */
    startFrac = Math.random(),
  ) {
    this.freqHz = minHz + startFrac * (maxHz - minHz);
    this.targetHz = this.freqHz;
  }

  fillAdd(out: Float32Array): void {
    const maxStep = this.driftHzPerSec / this.sampleRate;
    for (let i = 0; i < out.length; i++) {
      // Wander gently around wherever it currently sits rather than
      // occasionally jumping to a wholly new pitch anywhere in the range --
      // recognizably "the same" whistle wobbling, not a different random
      // tone every time.
      if (Math.random() < 0.0003) {
        const localSpan = (this.maxHz - this.minHz) * 0.25;
        const next = this.freqHz + (Math.random() - 0.5) * localSpan;
        this.targetHz = Math.max(this.minHz, Math.min(this.maxHz, next));
      }
      const delta = this.targetHz - this.freqHz;
      this.freqHz += Math.sign(delta) * Math.min(Math.abs(delta), maxStep);
      out[i] += Math.sin(this.phase) * this.amplitude;
      this.phase += (2 * Math.PI * this.freqHz) / this.sampleRate;
      if (this.phase > Math.PI * 2) this.phase -= Math.PI * 2;
    }
  }
}

/**
 * Rhythmic power-line/ignition-style interference: a fast, regular train of
 * harsh clicks, unlike AtmosphericCrackle's randomly-timed atmospheric
 * crashes -- the "jackhammer" buzz of nearby electrical noise picked up on
 * HF. Arrives in occasional bursts rather than continuously.
 */
export class IgnitionBuzz {
  private phaseSamples = 0;
  private periodSamples: number;
  private burstRemaining = 0;
  private nextCheckSamples: number;
  // Slow activity LFO (different period/phase than AtmosphericCrackle's, so
  // the various interference sources don't all wax and wane in lockstep) --
  // some stretches of time have more nearby electrical noise than others.
  private activityPhase = Math.random() * Math.PI * 2;

  constructor(
    private sampleRate: number,
    pulsesPerSecond: number,
    private intensity: number,
  ) {
    this.periodSamples = Math.round(sampleRate / pulsesPerSecond);
    this.nextCheckSamples = Math.round(sampleRate * (2 + Math.random() * 6));
  }

  fillAdd(out: Float32Array): void {
    const activityStep = (2 * Math.PI * 0.0045) / this.sampleRate; // ~3.7 min period
    for (let i = 0; i < out.length; i++) {
      this.activityPhase += activityStep;
      if (this.activityPhase > Math.PI * 2) this.activityPhase -= Math.PI * 2;
      const activity = 0.3 + 1.0 * (0.5 + 0.5 * Math.sin(this.activityPhase));

      if (this.burstRemaining > 0) {
        this.burstRemaining--;
      } else if (this.nextCheckSamples <= 0) {
        this.nextCheckSamples = Math.round(this.sampleRate * (2 + Math.random() * 6));
        if (Math.random() < 0.4 * activity) {
          this.burstRemaining = Math.round(this.sampleRate * (0.3 + Math.random() * 1.2));
        }
      } else {
        this.nextCheckSamples--;
      }

      if (this.burstRemaining > 0) {
        this.phaseSamples = (this.phaseSamples + 1) % this.periodSamples;
        // Each click needs real duration (a few ms) to read as an audible
        // "tick" at all -- the previous 6-sample width (under half a
        // millisecond) was too brief to perceive as a discrete event.
        const clickSamples = 40;
        if (this.phaseSamples < clickSamples) {
          const t = this.phaseSamples / clickSamples;
          out[i] += (1 - t) * this.intensity * activity * (Math.random() * 2 - 1);
        }
      }
    }
  }
}

/**
 * VDSL/broadband-over-powerline "quasi-white" noise -- the RSGB's own noise
 * leaflet specifically calls this out as a distinct, now-common signature:
 * unlike SmpsHash's rough buzzy harmonics, this reads as a *smoother*,
 * simply-elevated noise floor (the leaflet's own diagnostic is "the S-meter
 * reads higher than expected but the noise sounds smoother than it should").
 * Modeled as gently low-passed pink noise -- no discrete harmonic
 * structure at all -- with a slow presence wobble. Only some receive
 * locations happen to sit near a VDSL modem or powerline adaptor, so this
 * is present in a fraction of instances, not universally.
 */
export class VdslHum {
  private pink = new PinkNoise();
  private lowpass: Biquad;
  private activityPhase = Math.random() * Math.PI * 2;
  private centerKHz: number;
  private targetKHz: number;
  private readonly rangeLoKHz: number;
  private readonly rangeHiKHz: number;
  private readonly driftKHzPerSec: number;
  private readonly halfWidthKHz: number;

  constructor(private sampleRate: number, private intensity: number, band: Band) {
    this.lowpass = Biquad.lowpass(sampleRate, 2200, 0.7);
    const [lo, hi] = band.rangeKHz;
    this.rangeLoKHz = lo;
    this.rangeHiKHz = hi;
    // Real VDSL/powerline ingress couples in strongest over some chunk of
    // the band, not uniformly across all of it -- so it's something you can
    // tune away from, like a real "buzz that's bad over here" rather than a
    // permanent fixture of the whole band.
    this.halfWidthKHz = Math.max(25, (hi - lo) * 0.3);
    this.centerKHz = lo + hashFrac(`vdsl-center:${band.id}:${Math.round(sampleRate)}`) * (hi - lo);
    this.targetKHz = this.centerKHz;
    // Wanders to a new spot over many minutes -- a real installation's
    // noise profile shifts with load, temperature, or a sync retrain
    // elsewhere on the line -- instead of sitting nailed to one dial
    // position forever.
    this.driftKHzPerSec = (hi - lo) / (600 + Math.random() * 900);
  }

  fillAdd(out: Float32Array, rxFreqKHz: number): void {
    if (Math.random() < 0.0004) {
      this.targetKHz = this.rangeLoKHz + Math.random() * (this.rangeHiKHz - this.rangeLoKHz);
    }
    const dtSec = out.length / this.sampleRate;
    const delta = this.targetKHz - this.centerKHz;
    this.centerKHz += Math.sign(delta) * Math.min(Math.abs(delta), this.driftKHzPerSec * dtSec);

    const offsetKHz = Math.abs(rxFreqKHz - this.centerKHz);
    const t = Math.min(1, offsetKHz / this.halfWidthKHz);
    const levelScale = Math.max(0, 1 - t * t);
    if (levelScale <= 0.01) return;

    const scratch = new Float32Array(out.length);
    const activityStep = (2 * Math.PI * 0.003) / this.sampleRate; // ~5.5 min period
    for (let i = 0; i < out.length; i++) {
      this.activityPhase += activityStep;
      if (this.activityPhase > Math.PI * 2) this.activityPhase -= Math.PI * 2;
      const activity = 0.85 + 0.15 * (0.5 + 0.5 * Math.sin(this.activityPhase));
      scratch[i] = this.pink.next() * activity;
    }
    this.lowpass.processInPlace(scratch);
    for (let i = 0; i < out.length; i++) out[i] += scratch[i] * this.intensity * levelScale;
  }
}

/**
 * Switch-mode power supply "hash": the rough, buzzy harmonic noise thrown
 * off by cheap SMPS/LED-driver/charger switching regulators. Unlike
 * atmospheric static (worst on the low bands), this gets *more* noticeable
 * on the higher HF bands, where it isn't masked by atmospheric noise the
 * way it is lower down. Modeled as a handful of harmonically-related tones
 * (each instance's fundamental picked randomly, so different receive
 * locations sound like they're near a different switcher) with a fast,
 * small random flutter on the overall level -- a steady chord of tones
 * would read as a birdie, not a rough hash.
 */
export class SmpsHash {
  private phases: number[];
  private readonly harmonics = [1, 3, 5, 7, 9];
  private envelope = 0.75;
  private fundamentalHz: number;
  private targetHz: number;
  private readonly minHz = 60;
  private readonly maxHz = 180;
  // A slow LFO on overall activity, like a switcher's load (and how loud its
  // hash reads) drifting over time rather than sitting at one fixed level
  // for as long as you're tuned to the band.
  private activityPhase = Math.random() * Math.PI * 2;

  constructor(private sampleRate: number, private intensity: number) {
    this.fundamentalHz = this.minHz + Math.random() * (this.maxHz - this.minHz);
    this.targetHz = this.fundamentalHz;
    this.phases = this.harmonics.map(() => Math.random() * Math.PI * 2);
  }

  fillAdd(out: Float32Array): void {
    const driftHzPerSec = 8;
    const maxStepPerSample = driftHzPerSec / this.sampleRate;
    const activityStep = (2 * Math.PI * 0.008) / this.sampleRate; // ~2 min period

    for (let i = 0; i < out.length; i++) {
      this.envelope = Math.max(0.5, Math.min(1, this.envelope + (Math.random() - 0.5) * 0.08));

      // Wander the fundamental gently, occasionally re-picking a target
      // within range -- a real switcher's frequency isn't perfectly fixed.
      if (Math.random() < 0.0002) {
        this.targetHz = this.minHz + Math.random() * (this.maxHz - this.minHz);
      }
      const delta = this.targetHz - this.fundamentalHz;
      this.fundamentalHz += Math.sign(delta) * Math.min(Math.abs(delta), maxStepPerSample);

      this.activityPhase += activityStep;
      if (this.activityPhase > Math.PI * 2) this.activityPhase -= Math.PI * 2;
      const activity = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this.activityPhase));

      let sum = 0;
      for (let h = 0; h < this.phases.length; h++) {
        const harmonic = this.harmonics[h];
        sum += Math.sin(this.phases[h]) / (harmonic + 1);
        this.phases[h] += (2 * Math.PI * this.fundamentalHz * harmonic) / this.sampleRate;
        if (this.phases[h] > Math.PI * 2) this.phases[h] -= Math.PI * 2;
      }
      // A fixed, modest drive into the soft-clip keeps the waveform only
      // lightly saturated -- enough to add some rough edge, but not so much
      // that the distinct harmonics smear into generic broadband mush (an
      // earlier version drove this directly with `intensity`, which at the
      // levels needed to survive AGC compression crushed the tone into
      // characterless extra noise instead of a recognizable buzz).
      // `intensity` instead scales the *output* directly, so it can still be
      // pushed as loud as needed without touching the waveshape.
      out[i] += Math.tanh(sum * this.envelope * 1.3) * this.intensity * activity;
    }
  }
}

/**
 * Over-the-horizon-radar "woodpecker": the distinctive rhythmic ~10Hz knock
 * train left by sweep radars that occasionally pass through 20m/15m --
 * unlike IgnitionBuzz's fast irregular click train, this is a slow, steady,
 * unmistakable rhythm. Arrives in rare multi-second episodes rather than
 * continuously.
 */
export class OthrWoodpecker {
  private samplesUntilNext = 0;
  private episodeRemaining = 0;
  private knockPhaseSamples = 0;
  private knockPeriodSamples: number;

  constructor(private sampleRate: number, private intensity: number) {
    this.knockPeriodSamples = Math.round(sampleRate / (9 + Math.random() * 2));
    this.scheduleNext();
  }

  private scheduleNext(): void {
    const meanGapSamples = this.sampleRate * (6 + Math.random() * 14);
    this.samplesUntilNext = Math.round(-Math.log(1 - Math.random()) * meanGapSamples);
  }

  fillAdd(out: Float32Array): void {
    for (let i = 0; i < out.length; i++) {
      if (this.episodeRemaining > 0) {
        this.episodeRemaining--;
      } else if (this.samplesUntilNext <= 0) {
        this.episodeRemaining = Math.round(this.sampleRate * (3 + Math.random() * 6));
        this.scheduleNext();
      } else {
        this.samplesUntilNext--;
      }

      if (this.episodeRemaining > 0) {
        this.knockPhaseSamples = (this.knockPhaseSamples + 1) % this.knockPeriodSamples;
        const knockSamples = 45;
        if (this.knockPhaseSamples < knockSamples) {
          const t = this.knockPhaseSamples / knockSamples;
          out[i] += (1 - t) * this.intensity * (Math.random() * 2 - 1);
        }
      }
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

/** Deterministic 0..1 hash of a string, used to pick "random" starting values that stay the same for the same band/mode instead of differing on every retune. */
export function hashFrac(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Per-band, per-mode ambient noise generator combining pink noise, crackle, and birdies. */
export class BandNoiseGenerator {
  private pink = new PinkNoise();
  private crackle: AtmosphericCrackle;
  private birdies: Birdie[];
  private heterodyne: WanderingTone | null = null;
  private whistle: WanderingTone | null = null;
  private whistlePresencePhase = Math.random() * Math.PI * 2;
  private ignition: IgnitionBuzz;
  private smpsHash: SmpsHash;
  private vdslHum: VdslHum | null = null;
  private woodpecker: OthrWoodpecker | null = null;
  private brightener: Biquad | null = null;
  private shaper: Biquad | null = null;
  private shaperHighpass: Biquad | null = null;
  private shaperMakeupGain = 1;
  private baseCracklesPerSecond: number;
  private bandId: string;

  constructor(
    band: Band,
    private sampleRate: number,
    private mode: Mode,
    _filterWidth: FilterWidth,
  ) {
    this.bandId = band.id;

    // Lower bands pick up far more atmospheric/lightning static. Intensities
    // here are chosen to survive the client's AGC compressor, which runs an
    // ~3:1 ratio at a very low (-60dB) threshold -- meaning it's compressing
    // almost everything almost all the time, shrinking a "clearly audible in
    // the raw signal" boost down to a barely-there bump by the time it
    // reaches the ear. These need to be loud in absolute terms, not just
    // proportionally present, to still read as distinct events post-AGC.
    const lowBandBoost = Math.max(0, (7000 - band.rangeKHz[0]) / 7000);
    // Rate stays modest even though each event now has real duration
    // (~8-23ms): overlapping events at a high rate would blur into a
    // continuous wash instead of standing out as discrete pops.
    this.baseCracklesPerSecond = 0.7 + lowBandBoost * 3.5;
    const crackleIntensity = 1.2 + lowBandBoost * 1.8;
    this.crackle = new AtmosphericCrackle(sampleRate, this.baseCracklesPerSecond, crackleIntensity);

    // Power-line/ignition-style buzz is a local-noise phenomenon, not an
    // atmospheric one, but it's still worse on the lower bands in practice
    // (mains harmonics and ignition noise fall off with frequency).
    this.ignition = new IgnitionBuzz(sampleRate, 100 + Math.random() * 20, 1.8 + lowBandBoost * 1.0);

    // SMPS/switching-supply hash is the mirror image of the atmospheric/
    // power-line noise above: it's present everywhere but only becomes
    // really noticeable on the higher HF bands, where it isn't buried under
    // atmospheric static the way it is down low. Each instance's random
    // fundamental/severity stands in for "how close you are to some noisy
    // switcher," so different bands (and different connections) don't all
    // sound identically hashy. This one is continuous (unlike the sparse
    // events above), so it directly sets the ambient floor -- kept more
    // modest than the transient events to leave headroom for them to stand
    // out clearly rather than just raising a wall of noise.
    const highBandBoost = Math.max(0, Math.min(1, (band.rangeKHz[0] - 14000) / 14000));
    const smpsSeverity = 0.7 + Math.random() * 0.6;
    this.smpsHash = new SmpsHash(sampleRate, (0.4 + highBandBoost * 2.0) * smpsSeverity);

    // VDSL/powerline-adaptor noise is a local-installation coincidence
    // (some receive locations are near one, most aren't), not a band or
    // atmospheric characteristic, so it's gated purely by chance rather
    // than band position.
    if (Math.random() < 0.4) {
      this.vdslHum = new VdslHum(sampleRate, 1.0 + Math.random() * 1.4, band);
    }

    // Over-the-horizon radar sweeps are specific to 20m/15m, not a general
    // band characteristic -- most connections on those bands won't catch an
    // episode at all, but the ones that do get the unmistakable ~10Hz knock.
    this.woodpecker =
      band.id === "20m" || band.id === "15m" ? new OthrWoodpecker(sampleRate, 1.4 + Math.random() * 0.6) : null;

    // A general heterodyne "whistle" -- a nearby station's carrier beating
    // against your own as you tune near it -- independent of AM's own
    // heterodyne above, so USB/LSB/CW/FM connections get a real whistle too,
    // not just AM. Not every connection has a station sitting close enough
    // to produce one, so it's only present some of the time. Kept within
    // 400-1000Hz so it survives CW's narrow bandpass as well as SSB's wider
    // window instead of being filtered out entirely on some modes.
    if (Math.random() < 0.65) {
      this.whistle = new WanderingTone(sampleRate, 400, 1000, 0.5 + Math.random() * 0.4, 60);
    }

    // A couple of faint fixed birdies scattered across the band, as if from
    // internal oscillator harmonics -- cosmetic realism, not tied to any tx.
    // Kept small relative to the pink noise's own pre-gain amplitude (~0.1)
    // so they read as faint accents, not a dominant tone.
    this.birdies = [
      new Birdie(sampleRate * 0.11, sampleRate, 0.02),
      new Birdie(sampleRate * 0.27, sampleRate, 0.01),
    ];

    this.configureForMode(mode);
  }

  /**
   * (Re)configure just the mode-dependent shaping in place, leaving the
   * pink noise filter, crackle timing, birdies, and ignition buzz running
   * uninterrupted. Switching modes used to tear down and rebuild the whole
   * generator from scratch, which reset the pink noise filter's internal
   * state to zero (an audible warm-up transient) and re-rolled every random
   * timer, so the same band could sound noticeably different -- and the
   * AM heterodyne whistle picked a brand new random pitch -- every single
   * time you switched modes.
   *
   * CW is heard through a narrow filter centered on the sidetone pitch, so
   * its noise is thinner than broadband SSB hiss -- but the Q has to stay
   * low enough that it still sounds like textured (if narrow) hiss rather
   * than a pure ringing tone. USB/LSB's detector only ever passes a real
   * SSB filter's ~300-2700Hz window (same band-limiting the actual voice
   * audio gets elsewhere), giving their noise its characteristic narrower,
   * "toppy" hiss -- distinct from FM's full-bandwidth brightness below.
   * AM's wider, symmetric double-sideband detector tends to sound a little
   * duller/warmer than that sharp SSB filter, and picks up the classic
   * wandering heterodyne whistle from a nearby channel's carrier beating
   * against your own as you tune near it -- seeded from the band so it
   * starts at the same recognizable pitch each time rather than a new
   * random one. FM's discriminator has no such warmth -- unsquelched FM is
   * a loud, bright, full-bandwidth hiss (closer to broadcast "TV static"
   * than SSB's textured pink noise), so it gets a presence boost instead
   * of a lowpass.
   */
  private configureForMode(mode: Mode): void {
    this.mode = mode;
    this.shaper = null;
    this.shaperHighpass = null;
    this.brightener = null;
    this.shaperMakeupGain = 1;
    if (!(mode === "AM" && this.heterodyne)) this.heterodyne = null;

    if (mode === "CW" || mode === "RTTY") {
      this.shaper = Biquad.bandpass(this.sampleRate, 700, 0.9);
      this.shaperMakeupGain = 2.6; // narrow bandpass throws away most of the energy
    } else if (mode === "USB" || mode === "LSB" || mode === "DATA") {
      this.shaperHighpass = Biquad.highpass(this.sampleRate, 300, 0.7);
      this.shaper = Biquad.lowpass(this.sampleRate, 2700, 0.7);
      this.shaperMakeupGain = 1.6;
    } else if (mode === "AM") {
      this.shaper = Biquad.lowpass(this.sampleRate, 3200, 0.7);
      this.shaperMakeupGain = 1.3;
      if (!this.heterodyne) {
        const startFrac = hashFrac(this.bandId);
        this.heterodyne = new WanderingTone(this.sampleRate, 800, 2200, 0.03, 40, startFrac);
      }
    } else if (mode === "FM") {
      this.brightener = Biquad.highpass(this.sampleRate, 250, 0.7);
    }
  }

  /** Switch this generator to a new mode in place -- see configureForMode for why this matters. */
  retune(mode: Mode): void {
    if (this.mode === mode) return;
    this.configureForMode(mode);
  }

  /** True if this generator can keep serving the given mode/filter without being rebuilt. */
  matches(mode: Mode): boolean {
    return this.mode === mode;
  }

  /**
   * Generate one frame of ambient band noise. `noiseFloorDb` should already
   * include any mode-bandwidth and day/night adjustments; `rxFreqKHz` lets
   * frequency-localized components (like VDSL hum) know how close the
   * listener's dial is to their own trouble spot; `crackleRateMultiplier`
   * lets callers boost atmospheric crashes at night without rebuilding the generator.
   */
  generate(nSamples: number, noiseFloorDb: number, rxFreqKHz: number, crackleRateMultiplier = 1): Float32Array {
    const out = new Float32Array(nSamples);
    this.pink.fill(out);

    this.crackle.setRate(this.baseCracklesPerSecond * crackleRateMultiplier);
    this.crackle.fillAdd(out);
    this.ignition.fillAdd(out);
    this.smpsHash.fillAdd(out);
    if (this.vdslHum) this.vdslHum.fillAdd(out, rxFreqKHz);
    if (this.woodpecker) this.woodpecker.fillAdd(out);
    for (const b of this.birdies) b.fillAdd(out);
    if (this.heterodyne) this.heterodyne.fillAdd(out);
    if (this.whistle) {
      // A real heterodyne whistle comes and goes as the nearby station's
      // signal fades in and out of range, rather than sitting there at a
      // fixed presence for as long as you're tuned to the band -- gate it
      // with a slow envelope that includes genuine near-silent stretches.
      const whistleStep = (2 * Math.PI * 0.004) / this.sampleRate; // ~4 min period
      const scratch = new Float32Array(nSamples);
      this.whistle.fillAdd(scratch);
      for (let i = 0; i < nSamples; i++) {
        this.whistlePresencePhase += whistleStep;
        if (this.whistlePresencePhase > Math.PI * 2) this.whistlePresencePhase -= Math.PI * 2;
        const presence = Math.pow(Math.max(0, Math.sin(this.whistlePresencePhase)), 0.6);
        out[i] += scratch[i] * presence;
      }
    }

    // The mode filter shapes *everything* reaching the ear (atmospheric
    // noise, crackle, birdies alike), not just the raw pink noise -- and the
    // final noiseFloorDb-derived gain has to apply after that, to the whole
    // combined signal, so accents stay proportional to the ambient floor
    // instead of sitting at a fixed loudness regardless of band/mode.
    if (this.shaperHighpass) this.shaperHighpass.processInPlace(out);
    if (this.shaper) this.shaper.processInPlace(out);
    if (this.brightener) this.brightener.processInPlace(out);

    const gain = dbToLinear(noiseFloorDb) * this.shaperMakeupGain;
    for (let i = 0; i < out.length; i++) {
      // A final soft-clip safety net: transparent for anything in the normal
      // quiet range (tanh(x) ~= x for small x), but guarantees interference
      // intensities can be pushed as hard as needed for real audibility
      // without fragile manual headroom arithmetic for every combination of
      // band/mode/simultaneous-effects risking clipping downstream.
      out[i] = Math.tanh(out[i] * gain);
    }
    return out;
  }
}
