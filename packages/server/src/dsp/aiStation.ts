import { WebSocket } from "ws";
import { FRAME_SAMPLES, SAMPLE_RATE } from "@koden/shared";
import { TxBandwidthFilter } from "./audioEffects.js";
import { float32ToInt16 } from "./pcm.js";

/**
 * M0AI: a fixed "station" you can actually have a real conversation with --
 * every other fixed station (beacon, parrot, time signal, VOLMET, numbers)
 * plays back canned or synthesised audio, but M0AI's replies are live speech
 * from Google's Gemini Live API. Like a real DX station worked simplex, it's
 * a single shared frequency: whoever it's currently in a QSO with is heard
 * by everyone tuned in, and -- per IARU Region 1's operating rules on
 * pileups ("never call before an ongoing QSO is completely finished", no
 * tail-ending -- see the ethics/operating manual at
 * https://www.iaru-r1.org/on-the-air/code-of-conduct/) -- anyone else keying
 * up while M0AI is mid-exchange with another station simply isn't heard
 * until that exchange wraps up, same as a real pileup. One caller at a time,
 * correctly addressed by their real callsign both ways.
 */
export const M0AI_ID = "m0ai";
export const M0AI_CALLSIGN = "M0AI";
/** Leeds, UK. */
export const M0AI_GRID = "IO93FT";
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

/** Whether M0AI is even reachable -- gates roster visibility (no point advertising a contact that can't reply) as well as all the per-tick work below. */
export function isM0aiEnabled(): boolean {
  return GEMINI_API_KEY.length > 0;
}

/** With nobody calling and nothing left to say, tear down the live API connection after this long rather than holding a paid session open forever. Reconnects fresh (a new "operating session") the next time someone calls. */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

const SYSTEM_INSTRUCTION = `You are the operator behind M0AI, an amateur radio station in Leeds, England (grid locator ${M0AI_GRID}), taking live HF voice contacts (QSOs) over simulated 20m SSB. Your first name is Alex. Your station is an Icom IC-7610 running 400W to a 5-element Yagi beam at 18 metres. You are a real, automatic AI-operated station -- if someone directly asks whether you're an AI, say yes, cheerfully; otherwise just be a normal, friendly ham having a contact, without bringing it up unprompted.

You must follow real amateur radio operating convention, per the IARU Region 1 "Ethics and Operating Procedures for the Radio Amateur" manual:
- Always give the OTHER station's callsign first, then your own -- e.g. "[their callsign] from M0AI" -- never lead with your own call.
- Always identify with your FULL callsign, "M0AI" -- never a partial or a nickname for the callsign itself. Identify every single time you transmit, not just occasionally.
- Immediately before you hear each transmission, you'll be given a short bracketed system note naming exactly which callsign is calling. That note is ground truth from the station log, not a guess -- always use that exact callsign, said phonetically if it helps, even if what you hear spoken sounds different or unclear.
- If it fits naturally, exchange a signal report using the real convention: Readability 1 to 5, Strength 1 to 9 (e.g. "you're five nine", or "readability five, strength seven" if it's not perfect) -- never invent other numbers.
- If you spell anything out, use ONLY the standard ITU phonetic alphabet (Alpha, Bravo, Charlie, Delta, Echo, Foxtrot, Golf, Hotel, India, Juliett, Kilo, Lima, Mike, November, Oscar, Papa, Quebec, Romeo, Sierra, Tango, Uniform, Victor, Whiskey, X-ray, Yankee, Zulu) -- never a made-up substitute.
- Address people by their first name once they've given it, never "Mister" or a surname. Sign off with "73", never "regards" or "sincerely".
- Stay strictly to ham-radio-appropriate subject matter: rigs, antennas, propagation, signal reports, grid squares, weather, general pleasantries. Never religion, politics, or advertising -- and always be polite; never rude, abusive, or sarcastic, no matter what.
- Keep every reply SHORT -- one or two spoken sentences, like a real over-the-air transmission, never a monologue.
- You are on a single shared frequency, like a real pileup: only ever address the one station you're currently in a QSO with. Once you've properly wrapped that exchange up (report given, pleasantries done, 73s exchanged), it's good practice to invite the next call, e.g. "QRZ, this is M0AI" or "any other calls, M0AI standing by".
- If the audio is garbled or unclear, ask them to say again rather than guessing at what they said.

Stay in character as a normal, warm, human-sounding op the whole time.`;

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

/** One station currently keyed into M0AI's passband this tick. */
export interface M0aiCaller {
  id: string;
  callsign: string;
  /** This tick's mic frame, or null if they're still keyed but no fresh frame arrived this particular tick (network/scheduling jitter -- not a PTT release). */
  frame: Float32Array | null;
}

type ConnectionState = "disconnected" | "connecting" | "open";

/**
 * The single, shared Gemini Bidi session behind M0AI -- like a real DX
 * station worked simplex, there's only ever one QSO in progress at a time,
 * claimed on a first-keyed basis (see tick()). Turn-taking is driven
 * manually off this sim's own PTT edges (automatic VAD disabled
 * server-side via realtimeInputConfig) rather than Gemini's own silence
 * detection -- half-duplex PTT already tells us exactly when a
 * transmission starts and ends, so there's no reason to wait on a VAD
 * timeout for a snappy reply.
 */
class AiQsoSession {
  private ws: WebSocket | null = null;
  private connectionState: ConnectionState = "disconnected";
  private setupComplete = false;
  private pendingOutgoing: object[] = [];

  /** The station M0AI is currently listening to, if any -- null means the frequency is free for the next caller. */
  private capturedId: string | null = null;
  /** Set once that station's turn is closed off (PTT released/disconnected); cleared once Gemini's reply is fully generated. While true, the frequency stays occupied even though capturedId is already null. */
  private awaitingReply = false;
  private lastActivityMs = 0;

  /** Flat queue of not-yet-delivered downlink samples at the sim's own 16kHz, chunked into FRAME_SAMPLES-sized frames on demand. */
  private downlinkQueue: number[] = [];
  /** Owned by M0AI's own (invariant) transmitted mode, not any particular listener -- shared by every listener the same way mixer.ts's per-transmitter TxBandwidthFilter is. */
  private readonly modeFilter = new TxBandwidthFilter(SAMPLE_RATE, "USB");

  private ensureConnected(nowMs: number): void {
    if (this.connectionState !== "disconnected") return;
    this.connectionState = "connecting";
    this.setupComplete = false;
    this.pendingOutgoing = [];
    this.lastActivityMs = nowMs;

    let ws: WebSocket;
    try {
      ws = new WebSocket(GEMINI_WS_URL);
    } catch {
      this.connectionState = "disconnected";
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
    ws.on("close", () => this.handleConnectionLost());
    ws.on("error", () => this.handleConnectionLost());
  }

  private handleConnectionLost(): void {
    this.connectionState = "disconnected";
    this.ws = null;
    // Whoever we were mid-QSO with is now unreachable -- free the frequency
    // rather than wedge it open forever waiting for a reply that's never coming.
    this.capturedId = null;
    this.awaitingReply = false;
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
      this.connectionState = "open";
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

    if (msg.serverContent?.turnComplete) this.awaitingReply = false;

    // A barge-in on Gemini's side (shouldn't normally happen given manual
    // turn control, but handled defensively): drop whatever's still queued
    // rather than let a superseded reply keep playing.
    if (msg.serverContent?.interrupted) this.downlinkQueue.length = 0;
  }

  private send(message: object): void {
    if (this.setupComplete && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else if (this.connectionState !== "disconnected") {
      this.pendingOutgoing.push(message);
    }
  }

  /** Grounds the model in the real callsign before it hears any audio from them -- see SYSTEM_INSTRUCTION. Sent as an incomplete turn so it doesn't itself provoke a reply; the audio that follows completes the turn. */
  private sendCallsignContext(callsign: string): void {
    this.send({
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [
              {
                text: `[The station now calling is ${callsign}. Address them by exactly this callsign, both when you speak to them and when confirming their call -- this is confirmed from the station log, not a guess.]`,
              },
            ],
          },
        ],
        turnComplete: false,
      },
    });
  }

  private sendAudio(frame: Float32Array): void {
    const int16 = float32ToInt16(frame);
    const b64 = Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength).toString("base64");
    this.send({ realtimeInput: { audio: { data: b64, mimeType: `audio/pcm;rate=${GEMINI_INPUT_RATE}` } } });
  }

  /**
   * Call once per tick with every station currently keyed into M0AI's
   * passband. If nobody's currently being heard and the previous reply (if
   * any) has fully finished, claims the first caller in the list -- exactly
   * like the parrot's single-slot claim, just handed off to a live
   * conversation instead of a recording. Everyone else in the list is
   * simply not heard until that QSO wraps up (real half-duplex doubling
   * would garble them anyway, and IARU pileup etiquette is explicit: never
   * call before an ongoing QSO is completely finished).
   */
  tick(nowMs: number, keyed: M0aiCaller[]): void {
    if (this.capturedId !== null) {
      const still = keyed.find((k) => k.id === this.capturedId);
      if (still) {
        this.lastActivityMs = nowMs;
        if (still.frame) this.sendAudio(still.frame);
      } else {
        // Released PTT (or disconnected) -- close their turn and wait for the reply.
        this.send({ realtimeInput: { activityEnd: {} } });
        this.capturedId = null;
        this.awaitingReply = true;
      }
      return;
    }

    // The frequency is occupied until the previous reply is fully delivered.
    if (this.awaitingReply || this.downlinkQueue.length > 0) return;

    const next = keyed[0];
    if (!next) return;

    this.ensureConnected(nowMs);
    this.capturedId = next.id;
    this.lastActivityMs = nowMs;
    this.sendCallsignContext(next.callsign);
    this.send({ realtimeInput: { activityStart: {} } });
    if (next.frame) this.sendAudio(next.frame);
  }

  /** Called when a station disconnects outright (not just PTT release) -- if it was mid-QSO, free the frequency the same way a PTT release would. */
  handleDisconnect(stationId: string): void {
    if (this.capturedId !== stationId) return;
    this.send({ realtimeInput: { activityEnd: {} } });
    this.capturedId = null;
    this.awaitingReply = true;
  }

  /** This tick's downlink frame (band-limited to M0AI's own mode), or null if not enough reply audio has arrived yet. Shared verbatim by every listener -- mixer.ts applies its own per-listener multipath, the same way it does for the parrot. */
  nextFrame(): Float32Array | null {
    if (this.downlinkQueue.length < FRAME_SAMPLES) return null;
    const out = new Float32Array(FRAME_SAMPLES);
    for (let i = 0; i < FRAME_SAMPLES; i++) out[i] = this.downlinkQueue[i];
    this.downlinkQueue.splice(0, FRAME_SAMPLES);
    this.modeFilter.processInPlace(out);
    return out;
  }

  sweepIdle(nowMs: number): void {
    if (this.connectionState === "disconnected") return;
    if (this.capturedId !== null || this.awaitingReply || this.downlinkQueue.length > 0) return;
    if (nowMs - this.lastActivityMs > IDLE_TIMEOUT_MS) {
      this.ws?.close();
      this.connectionState = "disconnected";
      this.ws = null;
    }
  }
}

export class AiStationEngine {
  private session = new AiQsoSession();
  readonly enabled = isM0aiEnabled();

  onDisconnect(id: string): void {
    if (!this.enabled) return;
    this.session.handleDisconnect(id);
  }

  /** Call once per tick with every station currently keyed into M0AI's passband (transmitting and tuned within its passband), in station order. */
  tick(nowMs: number, keyed: M0aiCaller[]): void {
    if (!this.enabled) return;
    this.session.tick(nowMs, keyed);
    this.session.sweepIdle(nowMs);
  }

  /** M0AI's shared downlink frame for this tick, if any -- broadcast to every listener tuned within its passband, same as the parrot or beacon. */
  nextFrame(): Float32Array | null {
    if (!this.enabled) return null;
    return this.session.nextFrame();
  }
}
