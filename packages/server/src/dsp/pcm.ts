export function int16ToFloat32(input: Int16Array, out: Float32Array): void {
  for (let i = 0; i < input.length; i++) out[i] = input[i] / 32768;
}

export function float32ToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const clamped = Math.max(-1, Math.min(1, input[i]));
    out[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
  }
  return out;
}

export function bufferToInt16Array(buf: Buffer): Int16Array {
  return new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
}
