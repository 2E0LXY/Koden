import { Biquad } from "./noise.js";

export const TIME_STATION_ID = "time-station";
export const TIME_STATION_CALLSIGN = "TIME SIG";
export const TIME_STATION_GRID = "FN31pr";
export const TIME_STATION_FREQ_KHZ = 14100.0;
/** 1kHz tick at nominal tuning, matching real WWV's actual 1000Hz tick tone. */
export const TIME_STATION_CARRIER_KHZ = TIME_STATION_FREQ_KHZ - 1.0;
export const TIME_STATION_SIGNAL_DB = -14;

/**
 * A WWV/WWVH/CHU-style time-standard station: a steady 1000Hz tick once a
 * second, with a longer marker tone at the top of each UTC minute. Real
 * time stations also carry a spoken announcement, but without a speech
 * synthesiser available, the tick pattern -- genuinely the most
 * recognisable, identifying part of the real signal -- carries the effect
 * on its own.
 */
export class TimeTicker {
  private envelope = 0;

  nextEnvelope(nowMs: number, sampleRate: number, nSamples: number): Float32Array {
    const out = new Float32Array(nSamples);
    const envStep = 1 / (0.003 * sampleRate);
    for (let i = 0; i < nSamples; i++) {
      const tSec = nowMs / 1000 + i / sampleRate;
      const secFrac = ((tSec % 1) + 1) % 1;
      const minuteFrac = ((tSec % 60) + 60) % 60;
      const isMinuteMarker = minuteFrac < 0.75;
      const tickOn = isMinuteMarker || secFrac < 0.015;
      if (tickOn && this.envelope < 1) this.envelope = Math.min(1, this.envelope + envStep);
      else if (!tickOn && this.envelope > 0) this.envelope = Math.max(0, this.envelope - envStep);
      out[i] = this.envelope;
    }
    return out;
  }
}

export const VOLMET_ID = "volmet";
export const VOLMET_CALLSIGN = "VOLMET";
/** Maidenhead locator for Dublin Airport (EIDW, 53.42N -6.27W), the real-world VOLMET source this stands in for -- not the ICAO airport code itself, which isn't a valid grid locator and would silently fail isValidGrid everywhere a grid is expected (station map, rotator bearing/distance). */
export const VOLMET_GRID = "IO63UK";
export const VOLMET_FREQ_KHZ = 18100.0;
export const VOLMET_SIGNAL_DB = -20;

/**
 * A droning, looping "voice" standing in for a VOLMET-style aviation
 * weather broadcast. No speech synthesiser is available, so this is
 * band-limited noise shaped with a speech-like amplitude cadence (short
 * "syllable" bursts separated by brief gaps, with occasional longer
 * pauses for "sentence" breaks) rather than actual words -- close enough
 * to read, at a glance, as someone reading a list in a flat monotone.
 * One shared instance for the whole station (like a real broadcast, every
 * listener hears the identical content), not one per listener.
 */
export class VoiceMurmur {
  // Three rough vowel-formant bands (F1/F2/F3), summed in parallel -- not
  // cascaded. Chaining bandpass filters in series multiplies their
  // responses together, which (even though each one alone is fairly wide)
  // collapses the combined passband down to little more than the single
  // frequency where both happen to overlap, i.e. a near-pure ringing tone
  // -- indistinguishable from CW. Parallel summation keeps each formant's
  // own width intact, giving a genuinely broadband, textured colour.
  private bp1: Biquad;
  private bp2: Biquad;
  private bp3: Biquad;
  private envelope = 0;
  private inBurst = true;
  private segmentSamplesLeft = 0;

  constructor(private sampleRate: number) {
    this.bp1 = Biquad.bandpass(sampleRate, 500, 0.8);
    this.bp2 = Biquad.bandpass(sampleRate, 1200, 0.8);
    this.bp3 = Biquad.bandpass(sampleRate, 2400, 0.7);
    this.scheduleBurst();
  }

  private scheduleBurst(): void {
    this.segmentSamplesLeft = Math.round(this.sampleRate * (0.06 + Math.random() * 0.18));
    this.inBurst = true;
  }

  private scheduleGap(): void {
    const sentencePause = Math.random() < 0.12;
    this.segmentSamplesLeft = Math.round(this.sampleRate * (sentencePause ? 0.4 + Math.random() * 0.6 : 0.03 + Math.random() * 0.09));
    this.inBurst = false;
  }

  render(nSamples: number): Float32Array {
    const noise = new Float32Array(nSamples);
    for (let i = 0; i < nSamples; i++) {
      if (this.segmentSamplesLeft <= 0) {
        if (this.inBurst) this.scheduleGap();
        else this.scheduleBurst();
      }
      this.segmentSamplesLeft--;
      const target = this.inBurst ? 1 : 0;
      this.envelope += (target - this.envelope) * 0.02;
      noise[i] = (Math.random() * 2 - 1) * this.envelope;
    }
    const f1 = noise.slice();
    const f2 = noise.slice();
    const f3 = noise.slice();
    this.bp1.processInPlace(f1);
    this.bp2.processInPlace(f2);
    this.bp3.processInPlace(f3);
    const out = new Float32Array(nSamples);
    for (let i = 0; i < nSamples; i++) out[i] = (f1[i] + f2[i] * 0.85 + f3[i] * 0.5) * 0.55;
    return out;
  }
}

export const NUMBERS_STATION_ID = "numbers";
export const NUMBERS_STATION_CALLSIGN = "??????";
export const NUMBERS_STATION_GRID = "JO65";
export const NUMBERS_STATION_FREQ_KHZ = 21300.0;
export const NUMBERS_STATION_SIGNAL_DB = -18;

const INTERVAL_TONE_HZ = 950;
const digitHz = (d: number) => 300 + d * 70;

/**
 * A classic "numbers station" Easter egg: a repeating interval-signal
 * chime, then groups of five distinct-pitch tones standing in for spoken
 * digits (no speech synthesiser available) -- appears only in rare,
 * scheduled episodes rather than being on the air continuously, the way
 * real numbers stations only transmit on their own schedule.
 */
export class NumbersStation {
  private samplesUntilNext = 0;
  private episodeRemaining = 0;
  private segmentSamplesLeft = 0;
  private segmentHz = 0;
  private segmentIsGap = true;
  private phase = 0;
  private mode: "interval" | "digits" = "interval";
  private intervalTonesLeft = 0;
  private digitsLeftInGroup = 0;

  constructor(private sampleRate: number) {
    this.scheduleNext();
  }

  get active(): boolean {
    return this.episodeRemaining > 0;
  }

  private scheduleNext(): void {
    const gapSec = 8 * 60 + Math.random() * 12 * 60;
    this.samplesUntilNext = Math.round(this.sampleRate * gapSec);
  }

  private beginSegment(hz: number, durationSec: number, isGap: boolean): void {
    this.segmentHz = hz;
    this.segmentSamplesLeft = Math.max(1, Math.round(this.sampleRate * durationSec));
    this.segmentIsGap = isGap;
  }

  private startEpisode(): void {
    this.episodeRemaining = Math.round(this.sampleRate * (45 + Math.random() * 45));
    this.mode = "interval";
    this.intervalTonesLeft = 6;
    this.beginSegment(INTERVAL_TONE_HZ, 0.3, false);
  }

  private nextSegment(): void {
    if (this.mode === "interval") {
      if (!this.segmentIsGap) {
        this.beginSegment(0, 0.15, true);
        return;
      }
      this.intervalTonesLeft--;
      if (this.intervalTonesLeft <= 0) {
        this.mode = "digits";
        this.digitsLeftInGroup = 5;
        this.beginSegment(digitHz(Math.floor(Math.random() * 10)), 0.35, false);
      } else {
        this.beginSegment(INTERVAL_TONE_HZ, 0.3, false);
      }
      return;
    }
    if (!this.segmentIsGap) {
      this.digitsLeftInGroup--;
      const groupDone = this.digitsLeftInGroup <= 0;
      this.beginSegment(0, groupDone ? 0.7 : 0.15, true);
      if (groupDone) this.digitsLeftInGroup = 5;
    } else {
      this.beginSegment(digitHz(Math.floor(Math.random() * 10)), 0.35, false);
    }
  }

  render(nSamples: number): Float32Array {
    const out = new Float32Array(nSamples);
    for (let i = 0; i < nSamples; i++) {
      if (this.episodeRemaining > 0) {
        this.episodeRemaining--;
      } else if (this.samplesUntilNext <= 0) {
        this.startEpisode();
      } else {
        this.samplesUntilNext--;
        continue;
      }

      if (this.segmentSamplesLeft <= 0) this.nextSegment();
      this.segmentSamplesLeft--;

      if (!this.segmentIsGap && this.segmentHz > 0) {
        out[i] = Math.sin(this.phase) * 0.8;
        this.phase += (2 * Math.PI * this.segmentHz) / this.sampleRate;
        if (this.phase > Math.PI * 2) this.phase -= Math.PI * 2;
      }
    }
    return out;
  }
}
