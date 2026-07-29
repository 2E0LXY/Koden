/**
 * Small synthesized UI sound effects for the radio panel -- no external
 * audio files, everything generated on the fly with a couple of oscillators
 * and noise bursts so every physical control feels like it "clicks".
 */
let ctx: AudioContext | null = null;
let enabled = true;

/** Global on/off switch for all synthesized UI sounds (from the setup panel). */
export function setSfxEnabled(value: boolean): void {
  enabled = value;
}

function getCtx(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function envGain(c: AudioContext, attack: number, hold: number, release: number, peak = 0.3) {
  const gain = c.createGain();
  const t0 = c.currentTime;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + attack);
  gain.gain.setValueAtTime(peak, t0 + attack + hold);
  gain.gain.linearRampToValueAtTime(0, t0 + attack + hold + release);
  return gain;
}

function noiseBurst(c: AudioContext, durationSec: number): AudioBufferSourceNode {
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * durationSec), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
  return src;
}

/** A crisp mechanical button click. */
export function click(): void {
  const c = getCtx();
  if (!c) return;
  const src = noiseBurst(c, 0.02);
  const filter = c.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 2500;
  const gain = envGain(c, 0.001, 0.005, 0.03, 0.25);
  src.connect(filter).connect(gain).connect(c.destination);
  src.start();
  src.stop(c.currentTime + 0.06);
}

/** A short confirmation beep, e.g. for mode/band changes. */
export function beep(freq = 880, durationMs = 90): void {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  const gain = envGain(c, 0.005, durationMs / 1000, 0.05, 0.2);
  osc.connect(gain).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + durationMs / 1000 + 0.06);
}

/** A relay "clunk" for engaging/disengaging transmit. */
export function relay(engage: boolean): void {
  const c = getCtx();
  if (!c) return;
  const src = noiseBurst(c, 0.03);
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = engage ? 900 : 600;
  filter.Q.value = 2;
  const gain = envGain(c, 0.001, 0.01, 0.06, 0.35);
  src.connect(filter).connect(gain).connect(c.destination);
  src.start();
  src.stop(c.currentTime + 0.08);
}

/** Power on/off sweep. */
export function power(on: boolean): void {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  osc.type = "sine";
  const t0 = c.currentTime;
  if (on) {
    osc.frequency.setValueAtTime(220, t0);
    osc.frequency.exponentialRampToValueAtTime(660, t0 + 0.25);
  } else {
    osc.frequency.setValueAtTime(660, t0);
    osc.frequency.exponentialRampToValueAtTime(180, t0 + 0.3);
  }
  const gain = envGain(c, 0.02, 0.2, 0.15, 0.2);
  osc.connect(gain).connect(c.destination);
  osc.start();
  osc.stop(t0 + 0.5);
}

/** The characteristic "thump" when squelch opens or closes on a noisy channel. */
export function squelchTail(): void {
  const c = getCtx();
  if (!c) return;
  const src = noiseBurst(c, 0.08);
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1200;
  filter.Q.value = 0.6;
  const gain = envGain(c, 0.001, 0.02, 0.12, 0.3);
  src.connect(filter).connect(gain).connect(c.destination);
  src.start();
  src.stop(c.currentTime + 0.15);
}

interface RotorState {
  fundamental: OscillatorNode;
  harmonic: OscillatorNode;
  noise: AudioBufferSourceNode;
  gain: GainNode;
}
let rotor: RotorState | null = null;

/**
 * Start the continuous antenna rotator hum -- a steady 60Hz mains-frequency
 * buzz with a strong 120Hz second harmonic (the classic transformer-core
 * sound of an AC/DC supply and motor sitting energized), not a wobbling or
 * revving motor tone. A faint, steady whirr underneath adds motor texture
 * without disturbing the steady hum.
 */
export function startRotor(): void {
  const c = getCtx();
  if (!c || rotor) return;

  const gain = c.createGain();
  gain.gain.setValueAtTime(0, c.currentTime);
  gain.gain.linearRampToValueAtTime(0.1, c.currentTime + 0.1);
  gain.connect(c.destination);

  const fundamental = c.createOscillator();
  fundamental.type = "sine";
  fundamental.frequency.value = 60;
  const fundamentalGain = c.createGain();
  fundamentalGain.gain.value = 0.5;
  fundamental.connect(fundamentalGain).connect(gain);

  const harmonic = c.createOscillator();
  harmonic.type = "sine";
  harmonic.frequency.value = 120;
  const harmonicGain = c.createGain();
  harmonicGain.gain.value = 1;
  harmonic.connect(harmonicGain).connect(gain);

  const noise = noiseBurst(c, 0.5);
  noise.loop = true;
  const noiseFilter = c.createBiquadFilter();
  noiseFilter.type = "lowpass";
  noiseFilter.frequency.value = 300;
  const noiseGain = c.createGain();
  noiseGain.gain.value = 0.08;
  noise.connect(noiseFilter).connect(noiseGain).connect(gain);

  fundamental.start();
  harmonic.start();
  noise.start();
  rotor = { fundamental, harmonic, noise, gain };
}

/** Stop the rotator hum with a short fade, if running. */
export function stopRotor(): void {
  if (!rotor || !ctx) {
    rotor = null;
    return;
  }
  const c = ctx;
  const { fundamental, harmonic, noise, gain } = rotor;
  gain.gain.cancelScheduledValues(c.currentTime);
  gain.gain.setValueAtTime(gain.gain.value, c.currentTime);
  gain.gain.linearRampToValueAtTime(0, c.currentTime + 0.15);
  const stopAt = c.currentTime + 0.2;
  fundamental.stop(stopAt);
  harmonic.stop(stopAt);
  noise.stop(stopAt);
  rotor = null;
}

/** Detent tick for rotary knobs while dragging. */
export function detent(): void {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  osc.type = "square";
  osc.frequency.value = 1800;
  const gain = envGain(c, 0.0005, 0.003, 0.015, 0.06);
  osc.connect(gain).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + 0.03);
}
