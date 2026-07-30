export const BEACON_ID = "beacon";
export const BEACON_CALLSIGN = "BEACON";
export const BEACON_GRID = "IO91WM";
export const BEACON_FREQ_KHZ = 7000;
/** Fixed signal strength (this app's internal dB scale, not real dBm) -- comfortably above the -38dB audible-threshold floor, landing as a weak-but-reliably-copyable "S3-ish" reference signal, independent of any station's distance/propagation. */
export const BEACON_SIGNAL_DB = -34;

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
 */
export class MorseBeacon {
  private segments: KeySegment[];
  private ditSeconds: number;
  private phase = 0;
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

  /** Generate the next `nSamples` of keyed CW tone at `toneHz`, with a short attack/release ramp to avoid key-click. */
  nextFrame(nowMs: number, sampleRate: number, nSamples: number, toneHz = 700): Float32Array {
    const out = new Float32Array(nSamples);
    const phaseStep = (2 * Math.PI * toneHz) / sampleRate;
    const envStep = 1 / (0.005 * sampleRate);
    for (let i = 0; i < nSamples; i++) {
      const tSec = nowMs / 1000 + i / sampleRate;
      const keyed = this.isKeyedAt(tSec);
      if (keyed && this.envelope < 1) this.envelope = Math.min(1, this.envelope + envStep);
      else if (!keyed && this.envelope > 0) this.envelope = Math.max(0, this.envelope - envStep);
      out[i] = Math.sin(this.phase) * this.envelope * 0.8;
      this.phase += phaseStep;
      if (this.phase > Math.PI * 2) this.phase -= Math.PI * 2;
    }
    return out;
  }
}
