/**
 * Audio wire format shared by client and server. Control messages travel as
 * JSON text WebSocket frames (see protocol.ts); raw audio travels as binary
 * WebSocket frames containing mono 16-bit PCM (little-endian) at a fixed
 * sample rate, one frame per tick.
 */
export const SAMPLE_RATE = 16000;
export const FRAME_MS = 20;
export const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000; // 320
export const FRAME_BYTES = FRAME_SAMPLES * 2; // Int16 = 2 bytes/sample
