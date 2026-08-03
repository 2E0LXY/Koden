import { SAMPLE_RATE } from "@koden/shared";

const WORKLET_URL = new URL("./pcm-worklet.js", import.meta.url);

export type AgcMode = "OFF" | "FAST" | "SLOW";

export interface ReceiveParams {
  /** 0..10 master volume. */
  afGain: number;
  /** 0..10 receiver sensitivity/gain. */
  rfGain: number;
  /** 0..10; audio is muted unless the signal exceeds a threshold derived from this. */
  squelch: number;
  /** 0..10 noise blanker strength (soft-clips sharp impulse noise). */
  nbLevel: number;
  /** 0..10 noise reduction strength (attenuates high-frequency hiss). */
  nrLevel: number;
  /** 0..10 manual notch depth; 0 disables the notch filter. */
  notchDepth: number;
  /** Hz, center frequency of the manual notch filter. */
  notchFreqHz: number;
  /** 0..10 notch width/Q. */
  notchWidth: number;
  /** Hz, -1500..1500 IF shift offset. */
  ifShiftHz: number;
  /** 0..10 passband tuning (Q of the IF shift filter). */
  pbtQ: number;
  /** 0..10 receive bandwidth (10 = full width, 0 = very narrow/muffled). */
  width: number;
  agcMode: AgcMode;
  /** Front-end attenuator: cuts gain to handle very strong signals. */
  attEnabled: boolean;
  /** Intercept-point-optimized mode: preamp bypassed (less gain, better strong-signal handling). */
  ipoEnabled: boolean;
  /** Audio peak filter: narrow CW-tone peaking filter around 700Hz. */
  apfEnabled: boolean;
  /** Extra "digital" noise reduction pass, stacked on top of nrLevel. */
  dnrEnabled: boolean;
  /** 0..10 balance trim applied to both AF and RF gain together. */
  afRfBalance: number;
}

const DEFAULT_RECEIVE_PARAMS: ReceiveParams = {
  afGain: 7,
  rfGain: 10,
  squelch: 0,
  nbLevel: 0,
  nrLevel: 0,
  notchDepth: 0,
  notchFreqHz: 1000,
  notchWidth: 5,
  ifShiftHz: 0,
  pbtQ: 5,
  width: 10,
  agcMode: "FAST",
  attEnabled: false,
  ipoEnabled: false,
  apfEnabled: false,
  dnrEnabled: false,
  afRfBalance: 5,
};

function makeSoftClipCurve(amount: number): Float32Array {
  // amount 0 = transparent, 1 = aggressively limits peaks (noise-blanker-ish).
  const n = 1024;
  const curve = new Float32Array(n);
  const k = 1 + amount * 40;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

/**
 * A plain tanh curve: transparent (≈identity) for quiet audio, gracefully
 * saturating instead of hard-clipping for anything loud. Sits permanently
 * at the very end of the RX chain as a safety net -- most usefully, it's
 * what lets AGC-off use a much larger fixed makeup gain (see below) without
 * a strong signal turning into harsh digital clipping.
 */
function makeTanhLimiterCurve(): Float32Array {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x);
  }
  return curve;
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private captureNode: AudioWorkletNode | null = null;
  private playbackNode: AudioWorkletNode | null = null;
  private micStream: MediaStream | null = null;
  private onFrame: ((frame: ArrayBuffer) => void) | null = null;

  // Receive chain nodes.
  private ifShiftFilter: BiquadFilterNode | null = null;
  private notchFilter: BiquadFilterNode | null = null;
  private apfFilter: BiquadFilterNode | null = null;
  private widthFilter: BiquadFilterNode | null = null;
  private nrFilter: BiquadFilterNode | null = null;
  private nbShaper: WaveShaperNode | null = null;
  private agcCompressor: DynamicsCompressorNode | null = null;
  private rfGainNode: GainNode | null = null;
  private afGainNode: GainNode | null = null;
  private squelchGate: GainNode | null = null;
  private outputMakeupGain: GainNode | null = null;
  private outputLimiter: WaveShaperNode | null = null;
  private rxAnalyser: AnalyserNode | null = null;

  // Transmit chain nodes.
  private micGainNode: GainNode | null = null;
  private compCompressor: DynamicsCompressorNode | null = null;
  private txGainNode: GainNode | null = null;
  private voxAnalyser: AnalyserNode | null = null;
  private monitorGain: GainNode | null = null;
  private moniLevel = 0;
  private moniEnabled = false;
  private currentCompLevel = 0;
  private currentMicGain = 5;
  private currentTxPower = 10;

  private params: ReceiveParams = { ...DEFAULT_RECEIVE_PARAMS };

  async init(): Promise<void> {
    if (this.context) return;
    const context = new AudioContext({ sampleRate: SAMPLE_RATE });
    await context.audioWorklet.addModule(WORKLET_URL);
    this.context = context;

    this.playbackNode = new AudioWorkletNode(context, "koden-playback-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });

    this.ifShiftFilter = new BiquadFilterNode(context, {
      type: "peaking",
      frequency: 1500,
      Q: 1,
      gain: 6,
    });
    this.notchFilter = new BiquadFilterNode(context, {
      type: "notch",
      frequency: 1000,
      Q: 1,
    });
    this.apfFilter = new BiquadFilterNode(context, {
      type: "peaking",
      frequency: 700,
      Q: 8,
      gain: 0,
    });
    this.widthFilter = new BiquadFilterNode(context, {
      type: "lowpass",
      frequency: 3800,
      Q: 0.707,
    });
    this.nrFilter = new BiquadFilterNode(context, {
      type: "lowpass",
      frequency: 3800,
      Q: 0.707,
    });
    this.nbShaper = new WaveShaperNode(context, {
      curve: makeSoftClipCurve(0),
      oversample: "2x",
    });
    this.agcCompressor = new DynamicsCompressorNode(context, {
      threshold: 0,
      ratio: 1,
      attack: 0.01,
      release: 0.3,
      knee: 6,
    });
    this.rfGainNode = new GainNode(context, { gain: 1 });
    this.afGainNode = new GainNode(context, { gain: 0.7 });
    this.squelchGate = new GainNode(context, { gain: 1 });
    // Web Audio's DynamicsCompressorNode only ever attenuates -- it never
    // applies makeup gain -- so the ~3:1 compression above needs a large
    // fixed boost afterward to bring the whole compressed 55dB input range
    // back up to a normal listening level. Sized so the quietest bands'
    // ambient noise floor becomes audible without the loudest realistic
    // signals clipping (see AGC settings above for the full reasoning).
    this.outputMakeupGain = new GainNode(context, { gain: 65 });
    // A permanent safety net at the very end of the chain: transparent at
    // normal listening levels, but saturates gracefully instead of hard-
    // clipping if the gain stages above ever push a peak past ±1 -- most
    // importantly, this is what lets AGC-off use a fixed makeup gain large
    // enough to actually hear weak signals without a strong one turning
    // into harsh digital clipping (see AGC-off gain below).
    this.outputLimiter = new WaveShaperNode(context, { curve: makeTanhLimiterCurve(), oversample: "2x" });
    // Tapped after everything else (including the squelch gate and output
    // limiter), so the level it reports is exactly what's actually audible
    // right now -- real signal, real interference, correctly silent when
    // squelched -- rather than a synthetic/estimated value.
    this.rxAnalyser = new AnalyserNode(context, { fftSize: 512 });

    this.playbackNode
      .connect(this.ifShiftFilter)
      .connect(this.notchFilter)
      .connect(this.apfFilter)
      .connect(this.widthFilter)
      .connect(this.nrFilter)
      .connect(this.nbShaper)
      .connect(this.agcCompressor)
      .connect(this.rfGainNode)
      .connect(this.afGainNode)
      .connect(this.squelchGate)
      .connect(this.outputMakeupGain)
      .connect(this.outputLimiter)
      .connect(context.destination);
    this.outputLimiter.connect(this.rxAnalyser);

    this.applyReceiveParams();
  }

  /** Feed a mixed audio frame received from the server into the playback graph. */
  playFrame(frame: ArrayBuffer): void {
    this.playbackNode?.port.postMessage(frame, [frame]);
  }

/** Start capturing the mic. `onFrame` is invoked with each encoded 20ms PCM frame regardless of transmit state; the caller decides whether to actually send it. `deviceId` selects a specific input device (see enumerateDevices). */
  async startCapture(onFrame: (frame: ArrayBuffer) => void, deviceId?: string): Promise<void> {
    if (!this.context) throw new Error("AudioEngine not initialized");
    const context = this.context;
    this.onFrame = onFrame;
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: true,
        channelCount: 1,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    });
    const source = context.createMediaStreamSource(this.micStream);

    this.micGainNode = new GainNode(context, { gain: 1 });
    this.compCompressor = new DynamicsCompressorNode(context, {
      threshold: -20,
      ratio: 1,
      attack: 0.003,
      release: 0.25,
      knee: 6,
    });
    this.txGainNode = new GainNode(context, { gain: 1 });
    this.voxAnalyser = new AnalyserNode(context, { fftSize: 512 });
    this.monitorGain = new GainNode(context, { gain: 0 });

    const captureNode = new AudioWorkletNode(context, "koden-capture-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
    });
    captureNode.port.onmessage = (event) => {
      this.onFrame?.(event.data as ArrayBuffer);
    };

    source
      .connect(this.micGainNode)
      .connect(this.compCompressor)
      .connect(this.txGainNode);
    this.txGainNode.connect(this.voxAnalyser);
    this.txGainNode.connect(captureNode);
    this.txGainNode.connect(this.monitorGain);
    this.monitorGain.connect(context.destination);

    this.captureNode = captureNode;
    // Re-apply whatever the operator already had dialed in, rather than
    // resetting to defaults (important when switching microphones mid-session).
    this.setCompLevel(this.currentCompLevel);
    this.setMicGain(this.currentMicGain);
    this.setTxPower(this.currentTxPower);
  }

  /** Switch to a different input device without losing the current onFrame callback or DSP settings. */
  async switchMicrophone(deviceId: string): Promise<void> {
    const cb = this.onFrame;
    this.stopCapture();
    if (cb) await this.startCapture(cb, deviceId);
  }

  /** Route playback to a specific output device, where the browser supports AudioContext.setSinkId. Returns false if unsupported. */
  async setOutputDevice(deviceId: string): Promise<boolean> {
    const ctx = this.context as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (!ctx || typeof ctx.setSinkId !== "function") return false;
    await ctx.setSinkId(deviceId);
    return true;
  }

  stopCapture(): void {
    this.captureNode?.disconnect();
    this.captureNode = null;
    this.micGainNode?.disconnect();
    this.micGainNode = null;
    this.compCompressor?.disconnect();
    this.compCompressor = null;
    this.txGainNode?.disconnect();
    this.txGainNode = null;
    this.voxAnalyser?.disconnect();
    this.voxAnalyser = null;
    this.monitorGain?.disconnect();
    this.monitorGain = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.onFrame = null;
  }

  async resume(): Promise<void> {
    if (this.context?.state === "suspended") await this.context.resume();
  }

  /** Current mic input RMS level (0..1), used for VOX detection. */
  getMicLevel(): number {
    if (!this.voxAnalyser) return 0;
    const buf = new Float32Array(this.voxAnalyser.fftSize);
    this.voxAnalyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    return Math.sqrt(sum / buf.length);
  }

  /**
   * Current receive playback level -- RMS (0..1, general loudness) and peak
   * (0..1, catches brief transients an RMS average would smooth over, like
   * a single crackle pop) -- read directly off the actual audio being
   * played back, so the S-meter and waterfall can reflect real signal and
   * interference activity as it happens rather than only the server's
   * periodic (and comparatively coarse) meter reports.
   */
  getRxLevel(): { rms: number; peak: number } {
    if (!this.rxAnalyser) return { rms: 0, peak: 0 };
    const buf = new Float32Array(this.rxAnalyser.fftSize);
    this.rxAnalyser.getFloatTimeDomainData(buf);
    let sum = 0;
    let peak = 0;
    for (const v of buf) {
      sum += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    return { rms: Math.sqrt(sum / buf.length), peak };
  }

  setCompLevel(level: number): void {
    this.currentCompLevel = level;
    if (!this.compCompressor) return;
    const t = level / 10;
    this.compCompressor.threshold.value = -20 - t * 25;
    this.compCompressor.ratio.value = 1 + t * 11;
  }

  setMicGain(level: number): void {
    this.currentMicGain = level;
    if (!this.micGainNode) return;
    // Calibrated so the dial's middle (5) sits at unity gain -- the browser's
    // own autoGainControl already normalizes mic input close to full scale,
    // so a middle-of-the-road default shouldn't itself add any overdrive.
    this.micGainNode.gain.value = 0.1 + (level / 10) * 1.8;
  }

  /** RF output power (watts) -- feeds the server's propagation/SWR model and the wattmeter only. It must never touch the transmitted audio's gain: a real rig's output power stage doesn't add distortion to its baseband audio, so txGainNode stays fixed at unity. */
  setTxPower(level: number): void {
    this.currentTxPower = level;
  }

  /** 0..10 monitor/sidetone volume; call whenever the level or the enabled toggle changes. */
  setMonitor(level: number, enabled: boolean): void {
    this.moniLevel = level;
    this.moniEnabled = enabled;
    if (!this.monitorGain) return;
    this.monitorGain.gain.value = enabled ? (level / 10) * 0.8 : 0;
  }

  updateReceiveParams(partial: Partial<ReceiveParams>): void {
    this.params = { ...this.params, ...partial };
    this.applyReceiveParams();
  }

  private applyReceiveParams(): void {
    const p = this.params;
    if (!this.ifShiftFilter || !this.notchFilter || !this.apfFilter || !this.widthFilter || !this.nrFilter ||
        !this.nbShaper || !this.agcCompressor || !this.rfGainNode || !this.afGainNode || !this.squelchGate) {
      return;
    }

    this.ifShiftFilter.frequency.value = Math.max(200, Math.min(2900, 1500 + p.ifShiftHz));
    this.ifShiftFilter.Q.value = 0.4 + (p.pbtQ / 10) * 8;

    this.notchFilter.frequency.value = p.notchFreqHz;
    // Depth 0 -> essentially bypassed (very low Q, negligible cut).
    this.notchFilter.Q.value = 0.01 + (p.notchDepth / 10) * (0.5 + (p.notchWidth / 10) * 15);

    // Peaking filter's gain is the bypass switch: 0dB = transparent.
    this.apfFilter.gain.value = p.apfEnabled ? 14 : 0;

    this.widthFilter.frequency.value = 700 + (p.width / 10) * 3300;
    const dnrPull = p.dnrEnabled ? 900 : 0;
    this.nrFilter.frequency.value = Math.max(500, 4000 - (p.nrLevel / 10) * 3000 - dnrPull);

    const nbAmount = p.nbLevel / 10 + (p.dnrEnabled ? 0.1 : 0);
    this.nbShaper.curve = makeSoftClipCurve(Math.min(1, nbAmount)) as Float32Array<ArrayBuffer>;

    if (p.agcMode === "OFF") {
      this.agcCompressor.threshold.value = 0;
      this.agcCompressor.ratio.value = 1;
      this.agcCompressor.knee.value = 0;
      // The 65x makeup gain below exists to compensate for AGC's ~3:1
      // compression of the ~55dB propagation range -- with AGC off there's
      // no compression to compensate for, so that same fixed gain would
      // overdrive a strong signal hard. But too conservative a value here
      // left weak/moderate signals effectively silent (a real radio with
      // AGC off does need manual RF/AF gain riding, but should still be
      // audible at the default settings first). The output limiter above
      // now saturates gracefully instead of hard-clipping, so this can be
      // sized for weak-signal audibility -- a strong signal will sound
      // loud and compressed/overloaded with AGC off, which is realistic,
      // rather than the whole band being silent.
      if (this.outputMakeupGain) this.outputMakeupGain.gain.value = 20;
    } else {
      if (this.outputMakeupGain) this.outputMakeupGain.gain.value = 65;
      // The propagation model's dB scale spans a huge range: from the
      // quietest bands' ambient noise floor (down around -55dB) up to a
      // strong nearby signal (near 0dB) -- roughly 55dB. A real receiver's
      // AGC compresses that whole range down to a comfortable listening
      // window rather than only kicking in above some threshold, which is
      // why the threshold sits low enough to catch essentially everything,
      // including the quietest bands' static, not just strong signals.
      // A real ratio around 3:1 still leaves fades, antenna directionality,
      // and interference clearly audible as relative level changes, just
      // compressed into a narrower window -- unlike a steep near-limiter
      // ratio, which would iron them flat. FAST vs SLOW differ mainly in
      // how quickly they react and recover, same as a real radio's AGC.
      this.agcCompressor.threshold.value = -60;
      this.agcCompressor.ratio.value = 3;
      this.agcCompressor.knee.value = p.agcMode === "FAST" ? 10 : 16;
      this.agcCompressor.attack.value = p.agcMode === "FAST" ? 0.008 : 0.03;
      this.agcCompressor.release.value = p.agcMode === "FAST" ? 0.25 : 1.4;
    }

    const balance = 0.5 + p.afRfBalance / 10;
    const attMul = p.attEnabled ? 0.35 : 1;
    const ipoMul = p.ipoEnabled ? 0.8 : 1.25;
    this.rfGainNode.gain.value = Math.max(0, p.rfGain / 10) * 1.2 * attMul * ipoMul * balance;
    this.afGainNode.gain.value = Math.max(0, p.afGain / 10) * 1.5 * balance;
  }

  setSquelchOpen(open: boolean): void {
    if (!this.squelchGate || !this.context) return;
    const target = open ? 1 : 0;
    this.squelchGate.gain.setTargetAtTime(target, this.context.currentTime, 0.01);
  }
}
