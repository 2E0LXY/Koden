import type { Mode } from "@koden/shared";
import { Biquad } from "./noise.js";

/**
 * Frequency-selective ("multipath") fading: the classic "underwater" SSB
 * sound caused by a direct and a slightly delayed skywave path arriving
 * together and interfering. Modelled as a comb filter blending the signal
 * with a copy of itself delayed by a few hundred microseconds to a couple
 * of milliseconds, with the delay slowly drifting via an LFO so the comb's
 * notches sweep across the passband over time instead of sitting still.
 */
export class MultipathFilter {
  private buffer: Float32Array;
  private writeIndex = 0;
  private lfoPhase = Math.random() * Math.PI * 2;

  constructor(private sampleRate: number) {
    this.buffer = new Float32Array(Math.ceil(sampleRate * 0.004));
  }

  /** `depth` 0 = no effect, 1 = strong, sweeping multipath notches. */
  processInPlace(buf: Float32Array, depth: number): void {
    if (depth <= 0) return;
    const lfoHz = 0.15;
    const minDelaySamples = Math.max(1, Math.round(this.sampleRate * 0.0003));
    const maxDelaySamples = Math.min(this.buffer.length - 1, Math.round(this.sampleRate * 0.002));
    const lfoStep = (2 * Math.PI * lfoHz) / this.sampleRate;

    for (let i = 0; i < buf.length; i++) {
      this.lfoPhase += lfoStep;
      if (this.lfoPhase > 2 * Math.PI) this.lfoPhase -= 2 * Math.PI;
      const lfo = (Math.sin(this.lfoPhase) + 1) / 2;
      const delaySamples = minDelaySamples + lfo * (maxDelaySamples - minDelaySamples);

      const readPos = (this.writeIndex - delaySamples + this.buffer.length * 2) % this.buffer.length;
      const i0 = Math.floor(readPos);
      const i1 = (i0 + 1) % this.buffer.length;
      const frac = readPos - i0;
      const delayed = this.buffer[i0] * (1 - frac) + this.buffer[i1] * frac;

      const x = buf[i];
      this.buffer[this.writeIndex] = x;
      this.writeIndex = (this.writeIndex + 1) % this.buffer.length;

      buf[i] = x * (1 - depth * 0.5) + delayed * depth * 0.5;
    }
  }
}

const MODE_BAND_EDGES: Record<Mode, { lowHz: number; highHz: number }> = {
  CW: { lowHz: 500, highHz: 900 },
  RTTY: { lowHz: 400, highHz: 1600 },
  DATA: { lowHz: 300, highHz: 2700 },
  USB: { lowHz: 300, highHz: 2700 },
  LSB: { lowHz: 300, highHz: 2700 },
  AM: { lowHz: 100, highHz: 4500 },
  FM: { lowHz: 100, highHz: 4000 },
};

/**
 * Band-limits transmitted audio to the transmitting station's actual mode
 * bandwidth (a real SSB rig only passes ~300-2700Hz regardless of what
 * filter width the listener has selected; CW/RTTY are far narrower still).
 * One instance per transmitting station -- it depends only on the
 * transmitter's mode, so every listener hears the same band-limited audio.
 */
export class TxBandwidthFilter {
  private highpass: Biquad;
  private lowpass: Biquad;

  constructor(sampleRate: number, mode: Mode) {
    const edges = MODE_BAND_EDGES[mode];
    this.highpass = Biquad.highpass(sampleRate, edges.lowHz, 0.707);
    this.lowpass = Biquad.lowpass(sampleRate, edges.highHz, 0.707);
  }

  processInPlace(buf: Float32Array): void {
    this.highpass.processInPlace(buf);
    this.lowpass.processInPlace(buf);
  }
}

/**
 * Adjacent-channel splatter: a station transmitting just outside a
 * listener's passband still leaks in, distorted and attenuated, the way an
 * overdriven or simply nearby-in-frequency signal bleeds past a receiver
 * filter's skirt in real life. Applies a gentle soft-clip so it reads as
 * "trashy" splatter rather than a clean quiet copy of the signal.
 */
export function applySplatterColorInPlace(buf: Float32Array): void {
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i] * 2.2;
    buf[i] = Math.tanh(x) * 0.6;
  }
}
