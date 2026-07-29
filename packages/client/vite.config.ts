import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    // The AudioWorklet module (pcm-worklet.js) must stay a real, fetchable
    // file: AudioWorkletGlobalScope can't reliably load a module from a
    // data: URL, but Vite's default inlining would turn it into exactly
    // that since it's a small file. Disabling inlining keeps it (and any
    // other small asset) emitted as a normal hashed file instead.
    assetsInlineLimit: 0,
  },
});
