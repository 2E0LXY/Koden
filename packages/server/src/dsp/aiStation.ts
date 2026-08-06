import { WebSocket } from "ws";
import { FRAME_SAMPLES, SAMPLE_RATE } from "@koden/shared";
import { MultipathFilter, TxBandwidthFilter } from "./audioEffects.js";
import { float32ToInt16 } from "./pcm.js";

/**
 * M0AI: a fixed "station" you can actually have a real conversation with --
 * every other fixed station (beacon, parrot, time signal, VOLMET, numbers)
 * plays back canned or synthesised audio, but M0AI's replies are live speech
 * from Google's Gemini Live API, one independent voice conversation per
 * calling operator (unlike the parrot's single shared recording slot -- two
 * hams can call M0AI at once and each gets their own private QSO, the same
 * way calling a real DXpedition station on split doesn't queue you behind
 * whoever called a second before you).
 */
export const M0AI_ID = "m0ai";
export const M0AI_CALLSIGN = "M0AI";
export const M0AI_GRID = "IO91OJ";
/** Sits in 20m's SSB phone segment, like a normal contact you'd tune across rather than a fixed reference off in a utility slot. */
export const M0AI_FREQ_KHZ = 14275.0;
/** A believable, workable DX signal -- not the towering fixed reference level of the beacon/parrot. */
export const M0AI_SIGNAL_DB = -18;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
/** Overridable in case this default ever falls out of date -- see deploy/README.md. */
const GEMINI_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-2.0-flash-live-001";
const GEMINI_WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;

/** Gemini Live's documented input rate happens to equal this sim's own SAMPLE_RATE exactly -- uplink audio needs no resampling, only the 24kHz reply audio does. */
const GEMINI_INPUT_RATE = 16000;
const GEMINI_OUTPUT_RATE = 24000;

/** Whether a station is even reachable -- gates roster visibility (no point advertising a contact that can't reply) as well as all the per-tick work below. */
export function isM0aiEnabled(): boolean {
  return GEMINI_API_KEY.length > 0;
}

/** A forgotten/abandoned QSO tears down its live API connection after this long with nothing said and nothing left to play back, rather than holding a paid session open forever. */
const IDLE_TIMEOUT_MS = 3 * 60 * 1000;
/** Same reasoning as the parrot's fixed multipath: M0AI isn't routed through the propagation engine (no real transmitter position to model), but a perfectly clean local-sounding voice would undercut the whole "you're on the radio" illusion. */
const M0AI_MULTIPATH_DEPTH = 0.2;

const SYSTEM_INSTRUCTION = `You are M0AI, an amateur radio operator in England (grid locator ${M0AI_GRID}) taking part in a live HF voice QSO over simulated SSB. You are a real, automatic AI-operated station -- if asked directly whether you're an AI, say yes, cheerfully; otherwise just be a normal, friendly ham having a contact, without bringing it up unprompted.

Ham radio conventions matter here: keep every reply SHORT -- one or two spoken sentences, like an actual over-the-air transmission, never a paragraph. Exchange the basics naturally over the course of the chat: callsigns, a signal report ("you're five nine" style), your grid square, maybe the rig/antenna or the weather. Occasionally use standard phonetics (Alpha, Bravo, ...) when spelling a callsign. You may end a transmission with "over" when it fits, but don't do it every single time -- real ops don't.

You're hearing the other station over a real, sometimes-noisy HF link, so if something is garbled or you're not sure what they said, ask them to say again rather than guessing. Stay in character as a normal human-sounding op the whole time; keep it warm, brief, and authentic to real ham radio chat.`;

function downsample24kTo16k(int16: Int16Array): Float32Array {
  const ratio = GEMINI_OUTPUT_RATE / GEMINI_INPUT_RATE; // 1.5
  const outLen = Math.floor(int16.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, int16.length - 1);
    const frac = srcPos - i0;
    out[i] = (int16[i0] * (1 - frac) + int16[i1] * frac) / 32768;
  }
  return out;
}

type QsoState = "connecting" | "open" | "closed";

/**
 * One live Gemini Bidi session per calling station. Turn-taking is driven
 * manually off this sim's own PTT edges (automatic VAD disabled server-side
 * via realtimeInputConfig) rather than Gemini's own silence detection --
 * half-duplex PTT already tells us exactly when a transmission starts and
 * ends, so there's no reason to wait on a VAD timeout for a snappy reply.
 */
class AiQsoSession {
  private ws: WebSocket | null = null;
  private state: QsoState = "connecting";
  private setupComplete = false;
  private closed = false;
  private pendingOutgoing: object[] = [];
  private wasKeyed = false;
  private lastActivityMs: number;
  /** Flat queue of not-yet-delivered downlink samples at the sim's own 16kHz, chunked into FRAME_SAMPLES-sized frames on demand. */
  private downlinkQueue: number[] = [];
  private readonly modeFilter = new TxBandwidthFilter(SAMPLE_RATE, "USB");
  private readonly multipath = new MultipathFilter(SAMPLE_RATE);

  constructor(nowMs: number) {
    this.lastActivityMs = nowMs;
    this.connect();
  }

  private connect(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(GEMINI_WS_URL);
    } catch {
      this.state = "closed";
      return;
    }
    this.ws = ws;

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          setup: {
            model: `models/${GEMINI_MODEL}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
            },
            systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
            // Manual turn control -- see class doc.
            realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
          },
        }),
      );
    });

    ws.on("message", (data) => this.handleMessage(data));
    ws.on("close", () => {
      this.state = "closed";
    });
    ws.on("error", () => {
      this.state = "closed";
    });
  }

  private handleMessage(data: unknown): void {
    let msg: any;
    try {
      const text = typeof data === "string" ? data : (data as Buffer).toString("utf8");
      msg = JSON.parse(text);
    } catch {
      return;
    }

    if (msg.setupComplete) {
      this.setupComplete = true;
      this.state = "open";
      for (const m of this.pendingOutgoing) this.ws?.send(JSON.stringify(m));
      this.pendingOutgoing = [];
      return;
    }

    const parts = msg.serverContent?.modelTurn?.parts as
      | Array<{ inlineData?: { data: string; mimeType: string } }>
      | undefined;
    if (parts) {
      for (const part of parts) {
        if (!part.inlineData?.data || !part.inlineData.mimeType?.startsWith("audio/")) continue;
        const pcm = Buffer.from(part.inlineData.data, "base64");
        const int16 = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
        const floats = downsample24kTo16k(int16);
        for (let i = 0; i < floats.length; i++) this.downlinkQueue.push(floats[i]);
      }
    }

    // A barge-in on Gemini's side (shouldn't normally happen given manual
    // turn control, but handled defensively): drop whatever's still queued
    // rather than let a superseded reply keep playing.
    if (msg.serverContent?.interrupted) this.downlinkQueue.length = 0;
  }

  private send(message: object): void {
    if (this.closed) return;
    if (this.setupComplete && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else if (this.state !== "closed") {
      this.pendingOutgoing.push(message);
    }
  }

  /** Call once per tick with this station's current keyed-into-M0AI state and (if keyed) this tick's mic frame. */
  tick(nowMs: number, keyed: boolean, frame: Float32Array | null): void {
    if (this.closed) return;
    if (keyed) this.lastActivityMs = nowMs;

    if (keyed && !this.wasKeyed) {
      this.send({ realtimeInput: { activityStart: {} } });
    } else if (!keyed && this.wasKeyed) {
      this.send({ realtimeInput: { activityEnd: {} } });
    }
    this.wasKeyed = keyed;

    if (keyed && frame) {
      const int16 = float32ToInt16(frame);
      const b64 = Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength).toString("base64");
      this.send({
        realtimeInput: { audio: { data: b64, mimeType: `audio/pcm;rate=${GEMINI_INPUT_RATE}` } },
      });
    }
  }

  /** This tick's downlink frame (band-limited + faded), or null if not enough reply audio has arrived yet. */
  nextFrame(): Float32Array | null {
    if (this.downlinkQueue.length < FRAME_SAMPLES) return null;
    const out = new Float32Array(FRAME_SAMPLES);
    for (let i = 0; i < FRAME_SAMPLES; i++) out[i] = this.downlinkQueue[i];
    this.downlinkQueue.splice(0, FRAME_SAMPLES);
    this.modeFilter.processInPlace(out);
    this.multipath.processInPlace(out, M0AI_MULTIPATH_DEPTH);
    return out;
  }

  idleTooLong(nowMs: number): boolean {
    return this.downlinkQueue.length === 0 && nowMs - this.lastActivityMs > IDLE_TIMEOUT_MS;
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}

export class AiStationEngine {
  private sessions = new Map<string, AiQsoSession>();
  readonly enabled = isM0aiEnabled();

  onDisconnect(id: string): void {
    this.sessions.get(id)?.close();
    this.sessions.delete(id);
  }

  /**
   * Call once per tick for every connected station, whether or not it's
   * currently keyed into M0AI's passband -- lazily opens a session the
   * first time a station keys up into it, edge-detects PTT release (so the
   * turn ends promptly instead of waiting on VAD), and is a no-op for any
   * station that has never called M0AI.
   */
  tick(stationId: string, nowMs: number, keyedIntoM0ai: boolean, frame: Float32Array | null): void {
    if (!this.enabled) return;
    let session = this.sessions.get(stationId);
    if (!session) {
      if (!keyedIntoM0ai) return;
      session = new AiQsoSession(nowMs);
      this.sessions.set(stationId, session);
    }
    session.tick(nowMs, keyedIntoM0ai, frame);
  }

  /** This station's next queued reply frame, if it has an active session and enough audio has arrived. */
  nextFrame(stationId: string): Float32Array | null {
    if (!this.enabled) return null;
    return this.sessions.get(stationId)?.nextFrame() ?? null;
  }

  /** Tear down sessions nobody's spoken to (or heard back from) in a while. Cheap to call every tick. */
  sweepIdle(nowMs: number): void {
    if (this.sessions.size === 0) return;
    for (const [id, session] of this.sessions) {
      if (session.idleTooLong(nowMs)) {
        session.close();
        this.sessions.delete(id);
      }
    }
  }
}
