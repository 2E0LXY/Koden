// AudioWorklet processors. Kept as plain JS (not TS) because AudioWorklet
// modules are loaded directly by the browser's audio rendering thread via
// audioContext.audioWorklet.addModule(url) and are not run through the
// app's normal module graph. Frame size must match @koden/shared's
// FRAME_SAMPLES (320 samples = 20ms @ 16kHz).
const FRAME_SAMPLES = 320;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(FRAME_SAMPLES);
    this.index = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.index++] = channel[i];
        if (this.index === FRAME_SAMPLES) {
          const int16 = new Int16Array(FRAME_SAMPLES);
          for (let j = 0; j < FRAME_SAMPLES; j++) {
            // Soft-clip rather than hard-clamp: transparent well under 1.0,
            // but an occasional loud peak or plosive saturates smoothly like
            // a real transmitter's ALC instead of chopping the waveform flat.
            const s = Math.tanh(this.buffer[j]);
            int16[j] = s < 0 ? s * 32768 : s * 32767;
          }
          this.port.postMessage(int16.buffer, [int16.buffer]);
          this.index = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("koden-capture-processor", CaptureProcessor);

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.readOffset = 0;
    this.port.onmessage = (event) => {
      this.queue.push(new Int16Array(event.data));
      // Keep latency bounded if the network stalls and frames pile up.
      let queuedSamples = 0;
      for (const f of this.queue) queuedSamples += f.length;
      while (queuedSamples > FRAME_SAMPLES * 25 && this.queue.length > 1) {
        queuedSamples -= this.queue.shift().length;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0][0];
    if (!output) return true;
    for (let i = 0; i < output.length; i++) {
      if (this.queue.length === 0) {
        output[i] = 0;
        continue;
      }
      const current = this.queue[0];
      output[i] = current[this.readOffset] / 32768;
      this.readOffset++;
      if (this.readOffset >= current.length) {
        this.queue.shift();
        this.readOffset = 0;
      }
    }
    return true;
  }
}
registerProcessor("koden-playback-processor", PlaybackProcessor);
