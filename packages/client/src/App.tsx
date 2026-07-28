import { useCallback, useEffect, useRef, useState } from "react";
import {
  findBand,
  type Band,
  type FilterWidth,
  type Mode,
  type StationInfo,
} from "@koden/shared";
import { KodenSocket, type ConnectionStatus } from "./net/wsClient.js";
import { AudioEngine, type AgcMode, type ReceiveParams } from "./audio/engine.js";
import { beep, detent, power, relay, squelchTail } from "./audio/sfx.js";
import { JoinForm } from "./ui/JoinForm.js";
import { RadioPanel } from "./ui/RadioPanel.js";

const WS_URL = import.meta.env.VITE_SERVER_WS_URL ?? "ws://localhost:8787/ws";
const MAX_EVENTS = 12;
const VOX_THRESHOLD = 0.02;

interface VfoState {
  freqKHz: number;
  mode: Mode;
}

type MemorySlot = VfoState | null;
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

export function App() {
  const [joined, setJoined] = useState(false);
  const [callsign, setCallsign] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("closed");
  const [ownId, setOwnId] = useState<string | null>(null);

  const [vfoA, setVfoA] = useState<VfoState>({ freqKHz: 14195.0, mode: "USB" });
  const [vfoB, setVfoB] = useState<VfoState>({ freqKHz: 14200.0, mode: "USB" });
  const [activeVfo, setActiveVfo] = useState<"A" | "B">("A");
  const [split, setSplit] = useState(false);
  const [vfoLocked, setVfoLocked] = useState(false);
  const [tuneStep, setTuneStep] = useState<TuneStep>("NORMAL");

  const [ritEnabled, setRitEnabled] = useState(false);
  const [xitEnabled, setXitEnabled] = useState(false);
  const [offsetHz, setOffsetHz] = useState(0);

  const [filterWidth, setFilterWidth] = useState<FilterWidth>("normal");

  const [memory, setMemory] = useState<MemorySlot[]>(() => Array(10).fill(null));
  const [memIndex, setMemIndex] = useState(0);
  const [vfoMMode, setVfoMMode] = useState<"VFO" | "M">("VFO");
  const [memScanActive, setMemScanActive] = useState(false);

  const [mox, setMox] = useState(false);
  const [vox, setVox] = useState(false);
  const [voxActive, setVoxActive] = useState(false);
  const [voxDelayKnob, setVoxDelayKnob] = useState(4); // -> ~800ms

  const [rx, setRx] = useState<ReceiveParams>(DEFAULT_RX);
  const [compEnabled, setCompEnabled] = useState(false);
  const [procLevel, setProcLevel] = useState(4);
  const [moniEnabled, setMoniEnabled] = useState(false);
  const [moniLevel, setMoniLevel] = useState(5);
  const [micGain, setMicGain] = useState(5);
  const [txPower, setTxPower] = useState(10);
  const [keySpeed, setKeySpeed] = useState(5);

  const [dim, setDim] = useState(false);
  const [mScope, setMScope] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tunerActive, setTunerActive] = useState(false);
  const [swr, setSwr] = useState(2.8);
  const [ant, setAnt] = useState<"ANT1" | "ANT2">("ANT1");

  const [scanning, setScanning] = useState(false);

  const [roster, setRoster] = useState<StationInfo[]>([]);
  const [meter, setMeter] = useState({ sMeterDb: -95, noiseFloorDb: -70, audibleStationIds: [] as string[] });
  const [events, setEvents] = useState<string[]>([]);

  const socketRef = useRef<KodenSocket | null>(null);
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const pttRef = useRef(false);
  const squelchOpenRef = useRef(true);
  const transmitting = mox || (vox && voxActive);

  const activeVfoState = activeVfo === "A" ? vfoA : vfoB;
  const setActiveVfoState = useCallback(
    (updater: VfoState | ((prev: VfoState) => VfoState)) => {
      if (activeVfo === "A") setVfoA(updater);
      else setVfoB(updater);
    },
    [activeVfo],
  );
  const band = findBand(activeVfoState.freqKHz);
  const listenFreqKHz = activeVfoState.freqKHz + (ritEnabled ? offsetHz / 1000 : 0);
  const txFreqBase = split ? (activeVfo === "A" ? vfoB.freqKHz : vfoA.freqKHz) : activeVfoState.freqKHz;
  const txFreqKHz = txFreqBase + (xitEnabled ? offsetHz / 1000 : 0);

  const logEvent = useCallback((message: string) => {
    setEvents((prev) => [message, ...prev].slice(0, MAX_EVENTS));
  }, []);

  const handleJoin = useCallback(async (callsignInput: string, gridInput: string) => {
    setCallsign(callsignInput);
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
            audioEngine
              .startCapture((frame) => {
                if (pttRef.current) socket.sendAudioFrame(frame);
              })
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
          case "band_event":
            logEvent(message.message);
            break;
          case "error":
            logEvent(`Error: ${message.message}`);
            break;
        }
      },
      onAudioFrame: (frame) => audioEngine.playFrame(frame),
    });
    socketRef.current = socket;
    socket.connect();
    setJoined(true);
  }, [logEvent]);

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
    let hangTimeout: number | undefined;
    const interval = window.setInterval(() => {
      const level = audioEngineRef.current?.getMicLevel() ?? 0;
      if (level > VOX_THRESHOLD) {
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
  }, [vox, voxDelayKnob]);

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

  const onTuneKnob = useCallback(
    (freqKHz: number) => {
      if (vfoLocked) return;
      setActiveVfoState((prev) => ({ ...prev, freqKHz }));
    },
    [vfoLocked, setActiveVfoState],
  );

  const stepFreq = useCallback(
    (dir: 1 | -1) => {
      if (vfoLocked) return;
      if (vfoMMode === "M") {
        cycleMemory(dir);
        return;
      }
      const stepKHz = STEP_KHZ[tuneStep];
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

  const onModeSelect = useCallback(
    (mode: Mode) => {
      setActiveVfoState((prev) => ({ ...prev, mode }));
      beep(700, 60);
    },
    [setActiveVfoState],
  );

  const onBandSelect = useCallback(
    (b: Band) => {
      setActiveVfoState({ freqKHz: b.rangeKHz[0] + 50, mode: b.defaultMode });
      // A real antenna's match is frequency-dependent, so hopping bands
      // knocks the SWR back out of tune until the tuner is re-run.
      setSwr(1.8 + Math.random() * 2.7);
      beep(900, 70);
    },
    [setActiveVfoState],
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

    // Sweep the SWR through a jittery search (relays clicking through L/C
    // combinations) before settling on a good match, like a real ATU.
    const finalSwr = 1.05 + Math.random() * 0.25;
    const sweep: { atMs: number; value: number }[] = [
      { atMs: 150, value: 2.4 + Math.random() * 1.6 },
      { atMs: 350, value: 1.9 + Math.random() * 1.3 },
      { atMs: 550, value: 3.0 + Math.random() * 1.5 },
      { atMs: 750, value: 1.4 + Math.random() * 0.7 },
      { atMs: 950, value: finalSwr + 0.2 + Math.random() * 0.3 },
    ];
    const timeouts = sweep.map(({ atMs, value }) =>
      window.setTimeout(() => {
        setSwr(value);
        detent();
      }, atMs),
    );
    const relayOff = window.setTimeout(() => relay(false), 900);
    const done = window.setTimeout(() => {
      setSwr(finalSwr);
      setTunerActive(false);
      logEvent(`ATU: match found, SWR ${finalSwr.toFixed(1)}:1 on ${band?.name ?? "current band"}`);
    }, 1200);

    return () => [...timeouts, relayOff, done].forEach(window.clearTimeout);
  }, [tunerActive, band, logEvent]);

  const updateRx = useCallback((partial: Partial<ReceiveParams>) => {
    setRx((prev) => ({ ...prev, ...partial }));
  }, []);

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
    return <JoinForm onJoin={handleJoin} />;
  }

  return (
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
      ant={ant}
      onToggleAnt={() => {
        setAnt((a) => (a === "ANT1" ? "ANT2" : "ANT1"));
        relay(true);
      }}
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
      ritEnabled={ritEnabled}
      onToggleRit={() => setRitEnabled((s) => !s)}
      xitEnabled={xitEnabled}
      onToggleXit={() => setXitEnabled((s) => !s)}
      offsetHz={offsetHz}
      onChangeOffsetHz={setOffsetHz}
      onClear={() => {
        setOffsetHz(0);
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
      onMemToVfo={() => cycleMemory(1)}
      onMemIn={onMemIn}
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
      compEnabled={compEnabled}
      onToggleComp={() => setCompEnabled((s) => !s)}
      procLevel={procLevel}
      onChangeProcLevel={setProcLevel}
      moniLevel={moniLevel}
      onChangeMoniLevel={setMoniLevel}
      voxDelayKnob={voxDelayKnob}
      onChangeVoxDelayKnob={setVoxDelayKnob}
      micGain={micGain}
      onChangeMicGain={setMicGain}
      txPower={txPower}
      onChangeTxPower={setTxPower}
      keySpeed={keySpeed}
      onChangeKeySpeed={setKeySpeed}
      scanning={scanning}
      onToggleScan={() => setScanning((s) => !s)}
      signalDb={meter.sMeterDb}
      audibleStationIds={meter.audibleStationIds}
      roster={roster}
      ownId={ownId}
      events={events}
    />
  );
}
