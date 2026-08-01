export const BEACON_ID = "beacon";
export const BEACON_CALLSIGN = "BEACON";
export const BEACON_GRID = "IO91WM";
export const BEACON_FREQ_KHZ = 7000;
/** The beacon's actual "carrier" for beat-frequency purposes -- 700Hz below the nominal tuning spot, so tuning exactly to BEACON_FREQ_KHZ produces the classic 700Hz CW sidetone rather than zero beat. */
export const BEACON_CARRIER_KHZ = BEACON_FREQ_KHZ - 0.7;
/** Fixed signal strength (this app's internal dB scale, not real dBm) -- a strong, easily-copyable reference tone well clear of the noise floor, independent of any station's distance/propagation. */
export const BEACON_SIGNAL_DB = -12;

const MORSE: Record<string, string> = {
  A: ".-",
  B: "-...",
  C: "-.-.",
  D: "-..",
  E: ".",
  F: "..-.",
  G: "--.",
  H: "....",
  I: "..",
  J: ".---",
  K: "-.-",
  L: ".-..",
  M: "--",
  N: "-.",
  O: "---",
  P: ".--.",
  Q: "--.-",
  R: ".-.",
  S: "...",
  T: "-",
  U: "..-",
  V: "...-",
  W: ".--",
  X: "-..-",
  Y: "-.--",
  Z: "--..",
  "0": "-----",
  "1": ".----",
  "2": "..---",
  "3": "...--",
  "4": "....-",
  "5": ".....",
  "6": "-....",
  "7": "--...",
  "8": "---..",
  "9": "----.",
};

/** One keyed tone, in dit-units, followed by a gap (also in dit-units) before the next tone or the end of the message. */
interface KeySegment {
  onUnits: number;
  gapUnits: number;
}

/** Standard Morse timing: dit=1 unit, dah=3, intra-character gap=1, inter-character gap=3, inter-word gap=7. */
function buildKeying(message: string): KeySegment[] {
  const segments: KeySegment[] = [];
  const words = message.toUpperCase().trim().split(/\s+/);
  words.forEach((word, wordIndex) => {
    for (const ch of word) {
      const code = MORSE[ch];
      if (!code) continue;
      for (let i = 0; i < code.length; i++) {
        const onUnits = code[i] === "-" ? 3 : 1;
        const isLastSymbol = i === code.length - 1;
        segments.push({ onUnits, gapUnits: isLastSymbol ? 3 : 1 });
      }
    }
    if (wordIndex < words.length - 1 && segments.length > 0) {
      segments[segments.length - 1].gapUnits = 7;
    }
  });
  return segments;
}

/**
 * A server-side CW beacon: keys a steady sidetone on/off spelling out
 * `message` in Morse, repeating every `repeatEverySec`, aiming to fit the
 * message itself into roughly `messageTargetSec` (the remainder of the
 * cycle is silence before it repeats). Used as a fixed, always-on test
 * signal independent of propagation -- useful for checking the receive
 * chain (squelch, AGC, filters) against a known-good reference.
 *
 * Real CW is heard by beating an unmodulated carrier against a receiver's
 * local BFO: the audible pitch is simply the difference between the two
 * frequencies, sliding smoothly as you tune and passing through silence at
 * "zero beat" when they exactly coincide. The keying on/off timing is the
 * same for every listener (computed once per tick), but the actual tone
 * pitch is per-listener -- see toneHzFor() -- so each listener hears their
 * own tuning reflected in the pitch, the way a real CW signal would.
 */
export class MorseBeacon {
  private segments: KeySegment[];
  private ditSeconds: number;
  private envelope = 0;

  constructor(
    message: string,
    private repeatEverySec: number,
    messageTargetSec: number,
  ) {
    this.segments = buildKeying(message);
    const totalUnits = this.segments.reduce((sum, s) => sum + s.onUnits + s.gapUnits, 0);
    this.ditSeconds = messageTargetSec / Math.max(1, totalUnits);
  }

  private isKeyedAt(tSec: number): boolean {
    const tInCycle = ((tSec % this.repeatEverySec) + this.repeatEverySec) % this.repeatEverySec;
    let cursor = 0;
    for (const seg of this.segments) {
      const onEnd = cursor + seg.onUnits * this.ditSeconds;
      if (tInCycle < onEnd) return true;
      const gapEnd = onEnd + seg.gapUnits * this.ditSeconds;
      if (tInCycle < gapEnd) return false;
      cursor = gapEnd;
    }
    return false;
  }

  /**
   * The shared keying envelope (0..1) for the next `nSamples`, with a short
   * attack/release ramp to avoid key-clicks. Advances this beacon's keying
   * state -- call exactly once per tick, not once per listener, since the
   * on/off timing is identical for everyone.
   */
  nextEnvelope(nowMs: number, sampleRate: number, nSamples: number): Float32Array {
    const out = new Float32Array(nSamples);
    const envStep = 1 / (0.005 * sampleRate);
    for (let i = 0; i < nSamples; i++) {
      const tSec = nowMs / 1000 + i / sampleRate;
      const keyed = this.isKeyedAt(tSec);
      if (keyed && this.envelope < 1) this.envelope = Math.min(1, this.envelope + envStep);
      else if (!keyed && this.envelope > 0) this.envelope = Math.max(0, this.envelope - envStep);
      out[i] = this.envelope;
    }
    return out;
  }

}

/**
 * Renders one listener's beacon tone at whatever pitch their tuning implies
 * (see BEACON_CARRIER_KHZ), sharing a keying envelope from MorseBeacon but
 * tracking its own oscillator phase. Phase is accumulated sample-by-sample
 * rather than computed from absolute wall-clock time: `setInterval`-driven
 * ticks don't land at *exactly* 20ms apart, and computing phase as
 * `2*Math.PI*toneHz*(nowMs/1000)` for a real epoch-scale nowMs both loses
 * meaningful floating-point precision (the product's magnitude is large
 * enough that its ULP is a non-trivial fraction of a radian) and produces a
 * real phase discontinuity at every frame boundary when the actual elapsed
 * time drifts from the nominal frame length -- audible as a steady crackle
 * riding on the tone. One instance per (beacon, listener) pair, matching how
 * a real BFO would behave: continuous phase, with pitch sliding smoothly as
 * the listener retunes.
 */
export class BeaconToneOscillator {
  private phase = 0;

  renderTone(envelope: Float32Array, sampleRate: number, toneHz: number): Float32Array {
    const out = new Float32Array(envelope.length);
    const phaseStep = (2 * Math.PI * toneHz) / sampleRate;
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.sin(this.phase) * envelope[i] * 0.8;
      this.phase += phaseStep;
      if (this.phase > Math.PI * 2) this.phase -= Math.PI * 2;
      else if (this.phase < -Math.PI * 2) this.phase += Math.PI * 2;
    }
    return out;
  }
}
