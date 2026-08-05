import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  findBand,
  antennaById,
  gridBearingDeg,
  isValidGrid,
  type AntennaId,
  type Band,
  type FilterWidth,
  type Mode,
  type StationInfo,
} from "@koden/shared";
import { KodenSocket, type ConnectionStatus } from "./net/wsClient.js";
import { AudioEngine, type AgcMode, type ReceiveParams } from "./audio/engine.js";
import { beep, detent, power, relay, setSfxEnabled, squelchTail, startRotor, stopRotor } from "./audio/sfx.js";
import { JoinForm } from "./ui/JoinForm.js";
import { StationsLogWindow } from "./ui/StationsLogWindow.js";
import { RadioPanel } from "./ui/RadioPanel.js";

/**
 * A real S-meter reads the receiver's actual front-end sensitivity, not just
 * the raw over-the-air signal -- backing off RF GAIN, engaging ATT, or
 * bypassing the preamp (IPO) all desensitize the receiver and pull the
 * needle down, same as they quiet the audio. Mirrors the dB deltas used for
 * AudioEngine's rfGainNode so what you see and what you hear agree.
 */
/**
 * Real transceivers ship with these AGC time-constant defaults per mode:
 * slow for SSB/AM (smoother on voice), fast for CW/digital (keeps up with
 * rapid keying) -- and FM's AGC isn't user-adjustable at all.
 */
function defaultAgcForMode(mode: Mode): AgcMode {
  return mode === "CW" || mode === "RTTY" || mode === "DATA" ? "FAST" : "SLOW";
}

function rfSensitivityAdjustDb(rfGain: number, attEnabled: boolean, ipoEnabled: boolean): number {
  const gainDb = 20 * Math.log10(Math.max(0.001, rfGain / 10));
  const attDb = attEnabled ? -9 : 0;
  const ipoDb = ipoEnabled ? -2 : 2;
  return gainDb + attDb + ipoDb;
}

const WS_URL = import.meta.env.VITE_SERVER_WS_URL ?? "ws://localhost:8787/ws";
const MAX_EVENTS = 12;
/** 0..10 VOX GAIN knob -> trigger threshold: higher gain = more sensitive (lower threshold), matching the real radio's VOX GAIN parameter. */
function voxThreshold(voxGainKnob: number): number {
  return 0.06 - (voxGainKnob / 10) * 0.055;
}
const SPEAKER_SELECTION_SUPPORTED =
  typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;

interface VfoState {
  freqKHz: number;
  mode: Mode;
}

type MemorySlot = VfoState | null;
interface BandMemoryEntry extends VfoState {
  attEnabled: boolean;
  ipoEnabled: boolean;
}
export type TuneStep = "FINE" | "NORMAL" | "COARSE" | "FAST";

const STEP_KHZ: Record<TuneStep, number> = {
  FINE: 0.01,
  NORMAL: 0.1,
  COARSE: 1,
  FAST: 10,
};

const DEFAULT_RX: ReceiveParams = {
  afGain: 7,
  rfGain: 10,
  squelch: 0,
  nbLevel: 0,
  nrLevel: 0,
  notchDepth: 0,
  notchFreqHz: 1000,
  notchWidth: 5,
  notchMode: "off",
  ifShiftHz: 0,
  pbtQ: 5,
  width: 10,
  agcMode: "SLOW", // matches the default starting mode (USB)
  attEnabled: false,
  ipoEnabled: false,
  apfEnabled: false,
  dnrEnabled: false,
  afRfBalance: 5,
};

export function App() {
  const [joined, setJoined] = useState(false);
  const [callsign, setCallsign] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("closed");
  const [ownId, setOwnId] = useState<string | null>(null);
  const [savedCallsign] = useState(() => {
    try {
      return localStorage.getItem("koden.callsign") ?? "";
    } catch {
      return "";
    }
  });
  const [savedGrid] = useState(() => {
    try {
      return localStorage.getItem("koden.grid") ?? "";
    } catch {
      return "";
    }
  });

  const [vfoA, setVfoA] = useState<VfoState>({ freqKHz: 14195.0, mode: "USB" });
  const [vfoB, setVfoB] = useState<VfoState>({ freqKHz: 14200.0, mode: "USB" });
  const [activeVfo, setActiveVfo] = useState<"A" | "B">("A");
  const [split, setSplit] = useState(false);
  const [vfoLocked, setVfoLocked] = useState(false);
  const [tuneStep, setTuneStep] = useState<TuneStep>("NORMAL");

  const [ritEnabled, setRitEnabled] = useState(false);
  const [xitEnabled, setXitEnabled] = useState(false);
  const [offsetHz, setOffsetHz] = useState(0);
  const [xfcHeld, setXfcHeld] = useState(false);

  // Twin PBT's real mechanism: two physical controls (PBT1/PBT2). Rotating
  // them the *same* direction shifts the passband (our existing IF shift);
  // rotating them in *opposite* directions narrows it instead (rejecting
  // interference on both sides at once) -- so both derive from the same
  // pair of raw positions rather than being independent knobs.
  const [pbt1Hz, setPbt1Hz] = useState(0);
  const [pbt2Hz, setPbt2Hz] = useState(0);
  const ifShiftHz = (pbt1Hz + pbt2Hz) / 2;
  const pbtQ = Math.max(0, Math.min(10, Math.abs(pbt1Hz - pbt2Hz) / 300));

  const [filterWidth, setFilterWidth] = useState<FilterWidth>("normal");

  const [memory, setMemory] = useState<MemorySlot[]>(() => Array(10).fill(null));
  const [memIndex, setMemIndex] = useState(0);
  const [vfoMMode, setVfoMMode] = useState<"VFO" | "M">("VFO");
  const [memScanActive, setMemScanActive] = useState(false);

  const [mox, setMox] = useState(false);
  const [vox, setVox] = useState(false);
  const [voxActive, setVoxActive] = useState(false);
  const [voxDelayKnob, setVoxDelayKnob] = useState(4); // -> ~800ms
  const [voxGainKnob, setVoxGainKnob] = useState(5);
  const [txModLevel, setTxModLevel] = useState(0);

  const [rx, setRx] = useState<ReceiveParams>(DEFAULT_RX);
  const [compEnabled, setCompEnabled] = useState(false);
  const [procLevel, setProcLevel] = useState(4);
  const [moniEnabled, setMoniEnabled] = useState(false);
  const [moniLevel, setMoniLevel] = useState(5);
  const [micGain, setMicGain] = useState(5);
  /** RF output power, watts (0.5-200W) -- fed straight to the server's propagation model, not just a cosmetic local level. */
  const [txPower, setTxPower] = useState(100);
  const [keySpeed, setKeySpeed] = useState(5);

  const [dim, setDim] = useState(false);
  const [mScope, setMScope] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tunerActive, setTunerActive] = useState(false);
  const [swr, setSwr] = useState(2.8);

  const [antenna, setAntennaState] = useState<AntennaId>("dipole");
  const [heading, setHeadingState] = useState(0);
  const headingRef = useRef(heading);
  useEffect(() => {
    headingRef.current = heading;
  }, [heading]);
  const slewAnimRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (slewAnimRef.current !== null) cancelAnimationFrame(slewAnimRef.current);
      stopRotor();
    },
    [],
  );
  const [ownGrid, setOwnGrid] = useState("");
  const [pttHeld, setPttHeld] = useState(false);

  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [speakerDevices, setSpeakerDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState("");
  const [selectedSpeakerId, setSelectedSpeakerId] = useState("");
  const [sfxEnabled, setSfxEnabledState] = useState(true);

  const [scanning, setScanning] = useState(false);

  const [roster, setRoster] = useState<StationInfo[]>([]);
  const [solar, setSolar] = useState<{ sfi: number; kp: number } | null>(null);
  const [meter, setMeter] = useState({ sMeterDb: -95, noiseFloorDb: -70, audibleStationIds: [] as string[] });
  const [events, setEvents] = useState<string[]>([]);

  const socketRef = useRef<KodenSocket | null>(null);
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const pttRef = useRef(false);
  const squelchOpenRef = useRef(true);
  const transmitting = mox || pttHeld || (vox && voxActive);

  const activeVfoState = activeVfo === "A" ? vfoA : vfoB;
  const otherVfo = activeVfo === "A" ? vfoB : vfoA;
  const setActiveVfoState = useCallback(
    (updater: VfoState | ((prev: VfoState) => VfoState)) => {
      if (activeVfo === "A") setVfoA(updater);
      else setVfoB(updater);
    },
    [activeVfo],
  );
  const setOtherVfoState = useCallback(
    (updater: VfoState | ((prev: VfoState) => VfoState)) => {
      if (activeVfo === "A") setVfoB(updater);
      else setVfoA(updater);
    },
    [activeVfo],
  );
  const band = findBand(activeVfoState.freqKHz);
  // Remembers the active VFO's frequency/mode per band -- a simplified,
  // single-register version of the real radio's 3-deep band stacking
  // registers -- so reselecting a band later returns to where you left
  // off instead of always resetting to the band edge. Also remembers each
  // band's preamp/attenuator setting independently, same as a real radio.
  const [bandMemory, setBandMemory] = useState<Record<string, BandMemoryEntry>>({});
  useEffect(() => {
    if (!band) return;
    setBandMemory((prev) => ({
      ...prev,
      [band.id]: { ...activeVfoState, attEnabled: rx.attEnabled, ipoEnabled: rx.ipoEnabled },
    }));
  }, [band, activeVfoState, rx.attEnabled, rx.ipoEnabled]);
  const txFreqBase = split ? otherVfo.freqKHz : activeVfoState.freqKHz;
  const txFreqKHz = txFreqBase + (xitEnabled ? offsetHz / 1000 : 0);
  // XFC (transmit frequency check): held, it monitors the actual operating
  // (transmit) frequency instead of the normal receive frequency --
  // whether that's because RIT is shifting receive away from where you'd
  // actually transmit, or because SPLIT means you're listening on a
  // different VFO than you'd key up on. txFreqKHz already accounts for
  // both, so XFC just switches to it while held.
  const listenFreqKHz = xfcHeld ? txFreqKHz : activeVfoState.freqKHz + (ritEnabled ? offsetHz / 1000 : 0);
  // The other VFO's offset from the active one, purely for SPLIT's shift
  // knob/readout -- 0 whenever SPLIT is off, since there's no TX/RX
  // relationship to show.
  const splitShiftHz = split ? (otherVfo.freqKHz - activeVfoState.freqKHz) * 1000 : 0;
  const onChangeSplitShiftHz = useCallback(
    (hz: number) => {
      setOtherVfoState((prev) => ({ ...prev, freqKHz: activeVfoState.freqKHz + hz / 1000 }));
    },
    [activeVfoState.freqKHz, setOtherVfoState],
  );

  const logEvent = useCallback((message: string) => {
    setEvents((prev) => [message, ...prev].slice(0, MAX_EVENTS));
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMicDevices(devices.filter((d) => d.kind === "audioinput"));
      setSpeakerDevices(devices.filter((d) => d.kind === "audiooutput"));
    } catch {
      // Devices unavailable (no permission yet, or unsupported); leave lists empty.
    }
  }, []);

  useEffect(() => {
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
  }, [refreshDevices]);

  const handleJoin = useCallback(async (callsignInput: string, gridInput: string) => {
    setCallsign(callsignInput);
    setOwnGrid(gridInput);
    try {
      localStorage.setItem("koden.callsign", callsignInput);
      localStorage.setItem("koden.grid", gridInput);
    } catch {
      // localStorage unavailable (private browsing etc.) -- not essential.
    }
    power(true);

    const audioEngine = new AudioEngine();
    audioEngineRef.current = audioEngine;
    await audioEngine.init();
    await audioEngine.resume();
    audioEngine.updateReceiveParams(DEFAULT_RX);

    const socket = new KodenSocket(WS_URL, {
      onStatus: (status) => {
        setConnectionStatus(status);
        if (status === "open") {
          socket.send({ type: "hello", callsign: callsignInput, grid: gridInput });
        }
      },
      onServerMessage: (message) => {
        switch (message.type) {
          case "welcome":
            setOwnId(message.id);
            socket.send({
              type: "tune",
              freqKHz: 14195.0,
              mode: "USB",
              txFreqKHz: 14195.0,
              filterWidth: "normal",
            });
            socket.send({ type: "antenna", antenna: "dipole", headingDeg: 0 });
            audioEngine
              .startCapture((frame) => {
                if (pttRef.current) socket.sendAudioFrame(frame);
              })
              .then(refreshDevices)
              .catch((err) => {
                logEvent(`Microphone error: ${String(err)}`);
              });
            break;
          case "roster":
            setRoster(message.stations);
            break;
          case "meter":
            setMeter(message);
            break;
          case "solar":
            setSolar({ sfi: message.sfi, kp: message.kp });
            break;
          case "band_event":
            logEvent(message.message);
            break;
          case "error":
            logEvent(`Error: ${message.message}`);
            break;
        }
      },
      // Real transceivers are simplex -- the receiver is deaf while keyed.
      // (Sidetone/monitor audio, if enabled, is a separate path handled by
      // AudioEngine.setMonitor, not this receive playback.)
      onAudioFrame: (frame) => {
        if (!pttRef.current) audioEngine.playFrame(frame);
      },
    });
    socketRef.current = socket;
    socket.connect();
    setJoined(true);
  }, [logEvent, refreshDevices]);

  // Push VFO/mode/RIT/XIT/split/filter changes to the server whenever they change.
  useEffect(() => {
    if (!joined) return;
    socketRef.current?.send({
      type: "tune",
      freqKHz: listenFreqKHz,
      mode: activeVfoState.mode,
      txFreqKHz,
      filterWidth,
    });
  }, [joined, listenFreqKHz, activeVfoState.mode, txFreqKHz, filterWidth]);

  // Push antenna type/heading changes to the server whenever they change.
  useEffect(() => {
    if (!joined) return;
    socketRef.current?.send({ type: "antenna", antenna, headingDeg: heading });
  }, [joined, antenna, heading]);

  // Twin PBT's derived shift/narrowing values feed straight into the
  // existing ifShiftHz/pbtQ receive params -- the DSP itself doesn't need
  // to know it's driven by two raw dial positions instead of one.
  useEffect(() => {
    setRx((prev) => ({ ...prev, ifShiftHz, pbtQ }));
  }, [ifShiftHz, pbtQ]);

  useEffect(() => {
    audioEngineRef.current?.updateReceiveParams(rx);
  }, [rx]);

  useEffect(() => {
    audioEngineRef.current?.setCompLevel(compEnabled ? procLevel : 0);
  }, [compEnabled, procLevel]);

  useEffect(() => {
    audioEngineRef.current?.setMonitor(moniLevel, moniEnabled && transmitting);
  }, [moniLevel, moniEnabled, transmitting]);

  useEffect(() => {
    audioEngineRef.current?.setMicGain(micGain);
  }, [micGain]);

  useEffect(() => {
    audioEngineRef.current?.setTxPower(txPower);
  }, [txPower]);

  // Push RF output power to the server whenever the RF POWER knob changes --
  // it now actually affects what other stations hear, not just local audio gain.
  useEffect(() => {
    if (!joined) return;
    socketRef.current?.send({ type: "power", watts: txPower });
  }, [joined, txPower]);

  // Push the antenna match (SWR) to the server whenever it changes -- a bad
  // match now really does attenuate the transmitted signal for everyone else.
  useEffect(() => {
    if (!joined) return;
    socketRef.current?.send({ type: "swr", swr });
  }, [joined, swr]);

  // Squelch gating: mute/unmute based on current signal vs threshold, with the
  // characteristic "tail" thump when it opens or closes.
  useEffect(() => {
    if (tunerActive) return;
    const thresholdDb = meter.noiseFloorDb + rx.squelch * 4;
    const open = rx.squelch === 0 || meter.sMeterDb >= thresholdDb;
    audioEngineRef.current?.setSquelchOpen(open);
    if (open !== squelchOpenRef.current) {
      squelchOpenRef.current = open;
      if (audioEngineRef.current) squelchTail();
    }
  }, [meter.sMeterDb, meter.noiseFloorDb, rx.squelch, tunerActive]);

  // What the S-meter/waterfall actually display: the raw over-the-air
  // signal adjusted for the receiver's own front-end sensitivity, so RF
  // GAIN/ATT/IPO visibly move the needle the same way they change what you
  // hear, instead of only affecting local audio loudness invisibly. The
  // noise floor gets the *same* adjustment -- otherwise the waterfall's own
  // "is there a real signal here" comparison (signal minus floor) would see
  // a spurious margin from the front-end adjustment alone, showing a false
  // hot spot at the tuned frequency even with nothing actually there.
  const rfAdjustDb = rfSensitivityAdjustDb(rx.rfGain, rx.attEnabled, rx.ipoEnabled);
  const displaySignalDb = useMemo(() => meter.sMeterDb + rfAdjustDb, [meter.sMeterDb, rfAdjustDb]);
  const displayNoiseFloorDb = useMemo(
    () => meter.noiseFloorDb + rfAdjustDb,
    [meter.noiseFloorDb, rfAdjustDb],
  );

  const getLiveLevel = useCallback(
    () => audioEngineRef.current?.getRxLevel() ?? { rms: 0, peak: 0 },
    [],
  );

  // Push transmit state to the server whenever MOX or VOX-triggered state changes.
  const prevTransmittingRef = useRef(false);
  useEffect(() => {
    if (transmitting !== prevTransmittingRef.current) {
      prevTransmittingRef.current = transmitting;
      pttRef.current = transmitting;
      socketRef.current?.send({ type: "ptt", active: transmitting });
      relay(transmitting);
    }
  }, [transmitting]);

  // VOX: poll mic level and auto-key transmit with a configurable hang time.
  useEffect(() => {
    if (!vox) {
      setVoxActive(false);
      return;
    }
    const hangMs = 100 + (voxDelayKnob / 10) * 1900;
    const threshold = voxThreshold(voxGainKnob);
    let hangTimeout: number | undefined;
    const interval = window.setInterval(() => {
      const level = audioEngineRef.current?.getMicLevel() ?? 0;
      if (level > threshold) {
        setVoxActive(true);
        if (hangTimeout) {
          window.clearTimeout(hangTimeout);
          hangTimeout = undefined;
        }
      } else if (!hangTimeout) {
        hangTimeout = window.setTimeout(() => setVoxActive(false), hangMs);
      }
    }, 50);
    return () => {
      window.clearInterval(interval);
      if (hangTimeout) window.clearTimeout(hangTimeout);
    };
  }, [vox, voxDelayKnob, voxGainKnob]);

  // Live TX modulation envelope (real mic level, not a fabricated wiggle) --
  // drives the WATT meter so it swings with actual voice peaks like a real
  // PEP wattmeter, instead of sitting at a static bar for the whole transmission.
  useEffect(() => {
    if (!transmitting) {
      setTxModLevel(0);
      return;
    }
    const interval = window.setInterval(() => {
      const level = audioEngineRef.current?.getMicLevel() ?? 0;
      setTxModLevel(Math.max(0, Math.min(1, level / 0.15)));
    }, 50);
    return () => window.clearInterval(interval);
  }, [transmitting]);

  // Band scan: sweep upward across the current band.
  useEffect(() => {
    if (!scanning || vfoLocked) return;
    const id = window.setInterval(() => {
      setActiveVfoState((prev) => {
        const b = findBand(prev.freqKHz);
        if (!b) return prev;
        let next = prev.freqKHz + 0.5;
        if (next > b.rangeKHz[1]) next = b.rangeKHz[0];
        return { ...prev, freqKHz: next };
      });
    }, 150);
    return () => window.clearInterval(id);
  }, [scanning, vfoLocked, setActiveVfoState]);

  // Memory scan (MW): cycle through populated memory channels.
  useEffect(() => {
    if (!memScanActive) return;
    const id = window.setInterval(() => {
      setMemory((currentMemory) => {
        const filled = currentMemory
          .map((m, idx) => ({ m, idx }))
          .filter((entry): entry is { m: VfoState; idx: number } => entry.m !== null);
        if (filled.length > 0) {
          setMemIndex((i) => {
            const pos = filled.findIndex((f) => f.idx === i);
            const next = filled[(pos + 1) % filled.length];
            setActiveVfoState(next.m);
            return next.idx;
          });
        }
        return currentMemory;
      });
    }, 900);
    return () => window.clearInterval(id);
  }, [memScanActive, setActiveVfoState]);

  const cycleMemory = useCallback(
    (dir: 1 | -1) => {
      const filled = memory
        .map((m, idx) => ({ m, idx }))
        .filter((entry): entry is { m: VfoState; idx: number } => entry.m !== null);
      if (filled.length === 0) {
        beep(220, 150);
        return;
      }
      const pos = filled.findIndex((f) => f.idx === memIndex);
      const nextPos = ((pos < 0 ? 0 : pos) + dir + filled.length) % filled.length;
      const next = filled[nextPos];
      setMemIndex(next.idx);
      setActiveVfoState(next.m);
      beep(660, 80);
    },
    [memory, memIndex, setActiveVfoState],
  );

  const onMemIn = useCallback(() => {
    setMemory((prev) => {
      const next = [...prev];
      next[memIndex] = activeVfoState;
      return next;
    });
    beep(1500, 100);
  }, [memIndex, activeVfoState]);

  /** Left-click on a memory bank button: program the current VFO into that slot. */
  const onMemoryProgram = useCallback(
    (idx: number) => {
      setMemory((prev) => {
        const next = [...prev];
        next[idx] = activeVfoState;
        return next;
      });
      setMemIndex(idx);
      beep(1500, 100);
    },
    [activeVfoState],
  );

  /** Right-click on a memory bank button: recall that slot into the active VFO. */
  const onMemoryRecall = useCallback(
    (idx: number) => {
      const slot = memory[idx];
      if (!slot) {
        beep(220, 150);
        return;
      }
      setActiveVfoState(slot);
      setMemIndex(idx);
      beep(660, 80);
    },
    [memory, setActiveVfoState],
  );

  const onTuneKnob = useCallback(
    (freqKHz: number) => {
      if (vfoLocked) return;
      // The main dial (and its equivalents -- waterfall click-to-tune,
      // direct keypad entry) only tunes the working VFO when VFO mode is
      // selected; in Memory mode the dial browses memory channels instead
      // (see stepFreq below), so it shouldn't silently overwrite whichever
      // memory is currently displayed.
      if (vfoMMode === "M") return;
      setActiveVfoState((prev) => ({ ...prev, freqKHz }));
    },
    [vfoLocked, vfoMMode, setActiveVfoState],
  );

  const stepFreq = useCallback(
    (dir: 1 | -1, customStepKHz?: number) => {
      if (vfoLocked) return;
      if (vfoMMode === "M") {
        cycleMemory(dir);
        return;
      }
      const stepKHz = customStepKHz ?? STEP_KHZ[tuneStep];
      setActiveVfoState((prev) => {
        const b = findBand(prev.freqKHz);
        const next = prev.freqKHz + dir * stepKHz;
        if (!b) return { ...prev, freqKHz: next };
        return { ...prev, freqKHz: Math.max(b.rangeKHz[0], Math.min(b.rangeKHz[1], next)) };
      });
      detent();
    },
    [vfoLocked, vfoMMode, tuneStep, cycleMemory, setActiveVfoState],
  );

  const onAutoTune = useCallback(() => {
    if (activeVfoState.mode !== "CW") {
      beep(220, 150);
      return;
    }
    // Snaps to the nearest audible CW signal's actual dial frequency
    // within ±500Hz, same range and behavior as the real radio's CW
    // auto-tune -- a weak/inaudible one is treated as too unreliable to
    // lock onto, same as the manual's "may cause mistuning" warning.
    const candidates = roster.filter(
      (s) =>
        s.id !== ownId &&
        s.mode === "CW" &&
        meter.audibleStationIds.includes(s.id) &&
        Math.abs(s.freqKHz - listenFreqKHz) <= 0.5,
    );
    if (candidates.length === 0) {
      beep(220, 150);
      logEvent("AUTO TUNE: no CW signal found within range.");
      return;
    }
    const target = candidates.reduce((a, b) =>
      Math.abs(a.freqKHz - listenFreqKHz) < Math.abs(b.freqKHz - listenFreqKHz) ? a : b,
    );
    if (ritEnabled) {
      setOffsetHz(Math.round((target.freqKHz - activeVfoState.freqKHz) * 1000));
    } else {
      setActiveVfoState((prev) => ({ ...prev, freqKHz: target.freqKHz }));
    }
    beep(900, 100);
    logEvent(`AUTO TUNE: locked to ${target.callsign} on ${target.freqKHz.toFixed(1)} kHz.`);
  }, [activeVfoState, roster, ownId, meter.audibleStationIds, listenFreqKHz, ritEnabled, setActiveVfoState, logEvent]);

  const onModeSelect = useCallback(
    (mode: Mode) => {
      setActiveVfoState((prev) => ({ ...prev, mode }));
      if (mode !== "FM") setRx((prev) => ({ ...prev, agcMode: defaultAgcForMode(mode) }));
      beep(700, 60);
    },
    [setActiveVfoState],
  );

  const onBandSelect = useCallback(
    (b: Band) => {
      const remembered = bandMemory[b.id];
      setActiveVfoState(remembered ?? { freqKHz: b.rangeKHz[0] + 50, mode: b.defaultMode });
      const mode = remembered?.mode ?? b.defaultMode;
      // Each band remembers its own preamp/attenuator setting, same as a
      // real radio -- a band you haven't visited yet starts at the
      // factory default (both off) rather than carrying over whatever the
      // band you're leaving had set.
      setRx((prev) => ({
        ...prev,
        agcMode: mode !== "FM" ? defaultAgcForMode(mode) : prev.agcMode,
        attEnabled: remembered?.attEnabled ?? false,
        ipoEnabled: remembered?.ipoEnabled ?? false,
      }));
      // A real antenna's match is frequency-dependent, so hopping bands
      // knocks the SWR back out of tune until the tuner is re-run.
      setSwr(1.8 + Math.random() * 2.7);
      beep(900, 70);
    },
    [setActiveVfoState, bandMemory],
  );

  const toggleMox = useCallback(() => {
    setMox((prev) => {
      const next = !prev;
      if (next) setVox(false);
      return next;
    });
  }, []);

  const toggleVox = useCallback(() => {
    setVox((prev) => {
      const next = !prev;
      if (next) setMox(false);
      return next;
    });
  }, []);

  const onTuner = useCallback(() => {
    if (tunerActive) return;
    setTunerActive(true);
    logEvent("ATU: searching for match...");
    relay(true);
    audioEngineRef.current?.setSquelchOpen(false);

    // A real ATU steps its L/C relay network through many combinations very
    // fast while searching, then slows down as it converges on a match --
    // a rapid chatter of clicks with the SWR reading swinging wildly, easing
    // into a few slower, closer-together readings before it settles.
    const finalSwr = 1.05 + Math.random() * 0.25;
    const chatterSteps = 42;
    const chatterMs = 950;
    const settleSteps = 7;
    const settleMs = 950;
    const totalMs = chatterMs + settleMs + 300;

    const chatter: { atMs: number; value: number }[] = Array.from({ length: chatterSteps }, (_, i) => ({
      atMs: 100 + (i * chatterMs) / chatterSteps + Math.random() * 8,
      value: 1.4 + Math.random() * 3.6,
    }));
    const settle: { atMs: number; value: number }[] = Array.from({ length: settleSteps }, (_, i) => {
      const t = i / (settleSteps - 1);
      const isLast = i === settleSteps - 1;
      return {
        atMs: 100 + chatterMs + t * t * settleMs,
        value: isLast ? finalSwr : finalSwr + (1 - t) * (0.8 + Math.random() * 0.6),
      };
    });
    const sweep = [...chatter, ...settle];

    const timeouts = sweep.map(({ atMs, value }, i) =>
      window.setTimeout(() => {
        setSwr(value);
        relay(i % 2 === 0);
      }, atMs),
    );
    const relayOff = window.setTimeout(() => relay(false), totalMs - 100);
    const done = window.setTimeout(() => {
      setSwr(finalSwr);
      setTunerActive(false);
      logEvent(`ATU: match found, SWR ${finalSwr.toFixed(1)}:1 on ${band?.name ?? "current band"}`);
    }, totalMs);

    return () => [...timeouts, relayOff, done].forEach(window.clearTimeout);
  }, [tunerActive, band, logEvent]);

  const updateRx = useCallback((partial: Partial<ReceiveParams>) => {
    setRx((prev) => ({ ...prev, ...partial }));
  }, []);

  const onSelectAntenna = useCallback((id: AntennaId) => {
    setAntennaState(id);
    beep(750, 60);
  }, []);

  /** Animate the rotator heading to `targetDeg`, like a real rotator turning, with a motor hum for the duration. */
  const slewHeadingTo = useCallback((targetDeg: number) => {
    if (slewAnimRef.current !== null) {
      cancelAnimationFrame(slewAnimRef.current);
      slewAnimRef.current = null;
      stopRotor();
    }
    const from = headingRef.current;
    const delta = ((targetDeg - from + 540) % 360) - 180;
    if (Math.abs(delta) < 0.5) return;

    const DEG_PER_SEC = 45;
    const durationMs = (Math.abs(delta) / DEG_PER_SEC) * 1000;
    const startTime = performance.now();
    detent();
    startRotor();

    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / durationMs);
      const deg = ((from + delta * t) % 360 + 360) % 360;
      setHeadingState(deg);
      headingRef.current = deg;
      if (t < 1) {
        slewAnimRef.current = requestAnimationFrame(step);
      } else {
        slewAnimRef.current = null;
        stopRotor();
      }
    };
    slewAnimRef.current = requestAnimationFrame(step);
  }, []);

  // Dragging the compass commands a new heading the same way clicking a
  // station on the map does -- the rotator turns there at its real turn
  // rate rather than snapping instantly, so a second drag right after an
  // auto-point doesn't visually jump.
  const onChangeHeading = useCallback(
    (deg: number) => slewHeadingTo(((deg % 360) + 360) % 360),
    [slewHeadingTo],
  );

  /** Slew the rotator to point at another station on the map, if the current antenna is a beam. */
  const onPointAt = useCallback(
    (targetGrid: string) => {
      const ant = antennaById(antenna);
      if (!ant?.rotatable || !isValidGrid(ownGrid) || !isValidGrid(targetGrid)) return;
      slewHeadingTo(Math.round(gridBearingDeg(ownGrid, targetGrid)));
    },
    [antenna, ownGrid, slewHeadingTo],
  );

  const onPttDown = useCallback(() => setPttHeld(true), []);
  const onPttUp = useCallback(() => setPttHeld(false), []);

  const onXfcDown = useCallback(() => {
    setXfcHeld(true);
    audioEngineRef.current?.setXfcBypass(true);
  }, []);
  const onXfcUp = useCallback(() => {
    setXfcHeld(false);
    audioEngineRef.current?.setXfcBypass(false);
  }, []);

  const onSelectMic = useCallback((deviceId: string) => {
    setSelectedMicId(deviceId);
    audioEngineRef.current
      ?.switchMicrophone(deviceId)
      .then(refreshDevices)
      .catch((err) => logEvent(`Microphone switch failed: ${String(err)}`));
  }, [refreshDevices, logEvent]);

  const onSelectSpeaker = useCallback((deviceId: string) => {
    setSelectedSpeakerId(deviceId);
    audioEngineRef.current?.setOutputDevice(deviceId).catch(() => {
      logEvent("Speaker selection failed for that device.");
    });
  }, [logEvent]);

  const onToggleSfx = useCallback(() => {
    setSfxEnabledState((prev) => {
      const next = !prev;
      setSfxEnabled(next);
      return next;
    });
  }, []);

  const onSaveProfile = useCallback(
    (newCallsign: string, newGrid: string) => {
      if (!newCallsign || !isValidGrid(newGrid)) {
        logEvent("Setup: enter a callsign and a valid grid locator.");
        return;
      }
      setCallsign(newCallsign);
      setOwnGrid(newGrid);
      socketRef.current?.send({ type: "profile", callsign: newCallsign, grid: newGrid });
      try {
        localStorage.setItem("koden.callsign", newCallsign);
        localStorage.setItem("koden.grid", newGrid);
      } catch {
        // localStorage unavailable -- not essential.
      }
      beep(1000, 80);
    },
    [logEvent],
  );

  const handlePowerOff = useCallback(() => {
    power(false);
    audioEngineRef.current?.stopCapture();
    socketRef.current?.close();
    socketRef.current = null;
    audioEngineRef.current = null;
    pttRef.current = false;
    setJoined(false);
    setOwnId(null);
    setRoster([]);
    setEvents([]);
  }, []);

  if (!joined) {
    return <JoinForm onJoin={handleJoin} defaultCallsign={savedCallsign} defaultGrid={savedGrid} />;
  }

  return (
    <>
      <StationsLogWindow roster={roster} ownId={ownId} audibleStationIds={meter.audibleStationIds} events={events} />
      <RadioPanel
        callsign={callsign}
        connectionStatus={connectionStatus}
        onPowerOff={handlePowerOff}
        dim={dim}
        onToggleDim={() => setDim((s) => !s)}
        mScope={mScope}
        onToggleMScope={() => setMScope((s) => !s)}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((s) => !s)}
        onCloseMenu={() => setMenuOpen(false)}
        tunerActive={tunerActive}
        swr={swr}
        onTuner={onTuner}
        antenna={antenna}
        onSelectAntenna={onSelectAntenna}
        heading={heading}
        onChangeHeading={onChangeHeading}
        ownGrid={ownGrid}
        onPointAt={onPointAt}
        pttHeld={pttHeld}
        onPttDown={onPttDown}
        onPttUp={onPttUp}
        micDevices={micDevices}
        speakerDevices={speakerDevices}
        selectedMicId={selectedMicId}
        onSelectMic={onSelectMic}
        selectedSpeakerId={selectedSpeakerId}
        onSelectSpeaker={onSelectSpeaker}
        speakerSelectionSupported={SPEAKER_SELECTION_SUPPORTED}
        sfxEnabled={sfxEnabled}
        onToggleSfx={onToggleSfx}
        onSaveProfile={onSaveProfile}
        solar={solar}
        moniEnabled={moniEnabled}
        onToggleMoni={() => setMoniEnabled((s) => !s)}
        vfoA={vfoA}
        vfoB={vfoB}
        activeVfo={activeVfo}
        onSelectVfo={(v) => {
          setActiveVfo(v);
          beep(500, 50);
        }}
        onSwapVfos={() => {
          setVfoA(vfoB);
          setVfoB(vfoA);
          beep(600, 80);
        }}
        onEqualizeVfos={() => {
          // Copies the displayed VFO's frequency/mode onto the other one,
          // same as holding A/B on a real rig -- two short beeps confirm it.
          setOtherVfoState(activeVfoState);
          beep(700, 60);
          window.setTimeout(() => beep(700, 60), 120);
        }}
        split={split}
        onToggleSplit={() => {
          setSplit((s) => !s);
          beep(600, 60);
        }}
        band={band}
        onTuneKnob={onTuneKnob}
        onModeSelect={onModeSelect}
        onBandSelect={onBandSelect}
        vfoLocked={vfoLocked}
        onToggleLock={() => setVfoLocked((s) => !s)}
        tuneStep={tuneStep}
        onSetTuneStep={(s) => setTuneStep((prev) => (prev === s ? "NORMAL" : s))}
        onStepUp={() => stepFreq(1)}
        onStepDown={() => stepFreq(-1)}
        onStepFreq={stepFreq}
        onAutoTune={onAutoTune}
        ritEnabled={ritEnabled}
        onToggleRit={() => setRitEnabled((s) => !s)}
        xitEnabled={xitEnabled}
        onToggleXit={() => setXitEnabled((s) => !s)}
        offsetHz={offsetHz}
        onChangeOffsetHz={(hz) => setOffsetHz(Math.round(hz / 10) * 10)}
        splitShiftHz={splitShiftHz}
        onChangeSplitShiftHz={(hz) => onChangeSplitShiftHz(Math.round(hz / 10) * 10)}
        onClear={() => {
          setOffsetHz(0);
          beep(400, 60);
        }}
        xfcHeld={xfcHeld}
        onXfcDown={onXfcDown}
        onXfcUp={onXfcUp}
        pbt1Hz={pbt1Hz}
        pbt2Hz={pbt2Hz}
        onChangePbt1Hz={(hz) => setPbt1Hz(Math.round(hz / 10) * 10)}
        onChangePbt2Hz={(hz) => setPbt2Hz(Math.round(hz / 10) * 10)}
        onClearPbt={() => {
          setPbt1Hz(0);
          setPbt2Hz(0);
          beep(400, 60);
        }}
        filterWidth={filterWidth}
        onCycleFilterWidth={() => {
          setFilterWidth((w) => (w === "narrow" ? "normal" : w === "normal" ? "wide" : "narrow"));
          beep(800, 50);
        }}
        vfoMMode={vfoMMode}
        onToggleVfoM={() => setVfoMMode((m) => (m === "VFO" ? "M" : "VFO"))}
        memIndex={memIndex}
        onMemToVfo={() => {
          // Recalls whichever memory is currently selected -- it must not
          // itself pick a different memory (that's what the dial/step
          // buttons are for in Memory mode); it just copies the one already
          // shown into the working VFO and switches back to VFO mode, same
          // as a real rig's M>VFO.
          onMemoryRecall(memIndex);
          setVfoMMode("VFO");
        }}
        onMemIn={onMemIn}
        memory={memory}
        onMemoryProgram={onMemoryProgram}
        onMemoryRecall={onMemoryRecall}
        memScanActive={memScanActive}
        onToggleMemScan={() => setMemScanActive((s) => !s)}
        mox={mox}
        onToggleMox={toggleMox}
        vox={vox}
        onToggleVox={toggleVox}
        transmitting={transmitting}
        rx={rx}
        onUpdateRx={updateRx}
        agcMode={rx.agcMode}
        onSelectAgc={(m: AgcMode) => updateRx({ agcMode: m })}
        onToggleNb={() => updateRx({ nbLevel: rx.nbLevel > 0 ? 0 : 6 })}
        onToggleNr={() => updateRx({ nrLevel: rx.nrLevel > 0 ? 0 : 6 })}
        onToggleAtt={() => updateRx({ attEnabled: !rx.attEnabled })}
        onToggleIpo={() => updateRx({ ipoEnabled: !rx.ipoEnabled })}
        onToggleApf={() => updateRx({ apfEnabled: !rx.apfEnabled })}
        onToggleDnr={() => updateRx({ dnrEnabled: !rx.dnrEnabled })}
        onCycleNotchMode={() => {
          const next = rx.notchMode === "off" ? "auto" : rx.notchMode === "auto" ? "manual" : "off";
          updateRx({ notchMode: next, notchDepth: next === "manual" ? 8 : 0 });
          beep(next === "off" ? 500 : 700, 50);
        }}
        onCycleNotchWidth={() => {
          // WIDE cuts a broader chunk of spectrum (easier to find/silence
          // interference with), NAR cuts only a sliver (less collateral
          // damage to the wanted signal) -- WIDE -> MID -> NAR -> WIDE.
          const next = rx.notchWidth <= 3 ? 5 : rx.notchWidth <= 7 ? 9 : 2;
          updateRx({ notchWidth: next });
          beep(600, 50);
        }}
        compEnabled={compEnabled}
        onToggleComp={() => setCompEnabled((s) => !s)}
        procLevel={procLevel}
        onChangeProcLevel={setProcLevel}
        moniLevel={moniLevel}
        onChangeMoniLevel={setMoniLevel}
        voxDelayKnob={voxDelayKnob}
        onChangeVoxDelayKnob={setVoxDelayKnob}
        voxGainKnob={voxGainKnob}
        onChangeVoxGainKnob={setVoxGainKnob}
        micGain={micGain}
        onChangeMicGain={setMicGain}
        txPower={txPower}
        onChangeTxPower={setTxPower}
        keySpeed={keySpeed}
        onChangeKeySpeed={setKeySpeed}
        scanning={scanning}
        onToggleScan={() => setScanning((s) => !s)}
        signalDb={displaySignalDb}
        noiseFloorDb={displayNoiseFloorDb}
        getLiveLevel={getLiveLevel}
        txModLevel={txModLevel}
        audibleStationIds={meter.audibleStationIds}
        roster={roster}
        ownId={ownId}
      />
    </>
  );
}
