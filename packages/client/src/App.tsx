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
import { beep, power, relay, squelchTail } from "./audio/sfx.js";
import { JoinForm } from "./ui/JoinForm.js";
import { RadioPanel } from "./ui/RadioPanel.js";

const WS_URL = import.meta.env.VITE_SERVER_WS_URL ?? "ws://localhost:8787/ws";
const MAX_EVENTS = 12;
const VOX_THRESHOLD = 0.02;
const VOX_HANG_MS = 700;

interface VfoState {
  freqKHz: number;
  mode: Mode;
}

type MemorySlot = VfoState | null;

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

  const [ritEnabled, setRitEnabled] = useState(false);
  const [ritHz, setRitHz] = useState(0);

  const [filterWidth, setFilterWidth] = useState<FilterWidth>("normal");

  const [memory, setMemory] = useState<MemorySlot[]>(() => Array(10).fill(null));
  const [vfoMMode, setVfoMMode] = useState<"VFO" | "M">("VFO");
  const [pendingMemSlot, setPendingMemSlot] = useState<number | null>(null);
  const [memScanOnly, setMemScanOnly] = useState(false);
  const [memIndex, setMemIndex] = useState(0);

  const [mox, setMox] = useState(false);
  const [vox, setVox] = useState(false);
  const [voxActive, setVoxActive] = useState(false);

  const [rx, setRx] = useState<ReceiveParams>(DEFAULT_RX);
  const [compLevel, setCompLevel] = useState(0);
  const [moni, setMoni] = useState(false);
  const [bkIn, setBkIn] = useState(false);

  const [dim, setDim] = useState(false);
  const [mScope, setMScope] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [compact, setCompact] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [scanDir, setScanDir] = useState<1 | -1>(1);

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
  const listenFreqKHz = activeVfoState.freqKHz + (ritEnabled ? ritHz / 1000 : 0);
  const txFreqKHz = split ? (activeVfo === "A" ? vfoB.freqKHz : vfoA.freqKHz) : activeVfoState.freqKHz;

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

  // Push VFO/mode/RIT/split/filter changes to the server whenever they change.
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

  // Keep the audio engine's DSP graph in sync with the rx knob state.
  useEffect(() => {
    audioEngineRef.current?.updateReceiveParams(rx);
  }, [rx]);

  useEffect(() => {
    audioEngineRef.current?.setCompLevel(compLevel);
  }, [compLevel]);

  useEffect(() => {
    audioEngineRef.current?.setMonitor(moni && transmitting);
  }, [moni, transmitting]);

  // Squelch gating: mute/unmute based on current signal vs threshold, with the
  // characteristic "tail" thump when it opens or closes.
  useEffect(() => {
    const thresholdDb = meter.noiseFloorDb + rx.squelch * 4;
    const open = rx.squelch === 0 || meter.sMeterDb >= thresholdDb;
    audioEngineRef.current?.setSquelchOpen(open);
    if (open !== squelchOpenRef.current) {
      squelchOpenRef.current = open;
      if (audioEngineRef.current) squelchTail();
    }
  }, [meter.sMeterDb, meter.noiseFloorDb, rx.squelch]);

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

  // VOX: poll mic level and auto-key transmit with a short hang time.
  useEffect(() => {
    if (!vox) {
      setVoxActive(false);
      return;
    }
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
        hangTimeout = window.setTimeout(() => setVoxActive(false), VOX_HANG_MS);
      }
    }, 50);
    return () => {
      window.clearInterval(interval);
      if (hangTimeout) window.clearTimeout(hangTimeout);
    };
  }, [vox]);

  // Band scan: sweep across the current band, or step through memory channels.
  useEffect(() => {
    if (!scanning) return;
    const id = window.setInterval(
      () => {
        if (memScanOnly) {
          const filled = memory
            .map((m, idx) => ({ m, idx }))
            .filter((entry): entry is { m: VfoState; idx: number } => entry.m !== null);
          if (filled.length === 0) return;
          setMemIndex((i) => {
            const next = (i + 1) % filled.length;
            setActiveVfoState(filled[next].m);
            return next;
          });
        } else {
          setActiveVfoState((prev) => {
            const b = findBand(prev.freqKHz);
            if (!b) return prev;
            let next = prev.freqKHz + scanDir * 0.5;
            if (next > b.rangeKHz[1]) next = b.rangeKHz[0];
            if (next < b.rangeKHz[0]) next = b.rangeKHz[1];
            return { ...prev, freqKHz: next };
          });
        }
      },
      memScanOnly ? 900 : 150,
    );
    return () => window.clearInterval(id);
  }, [scanning, scanDir, memScanOnly, memory, setActiveVfoState]);

  const onTuneKnob = useCallback(
    (freqKHz: number) => {
      setActiveVfoState((prev) => ({ ...prev, freqKHz }));
    },
    [setActiveVfoState],
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

  const onDigit = useCallback(
    (n: number) => {
      if (vfoMMode === "M") {
        const slot = memory[n];
        if (slot) {
          setActiveVfoState(slot);
          beep(660, 80);
        } else {
          beep(220, 150);
        }
      } else {
        setPendingMemSlot(n);
        beep(1200, 50);
      }
    },
    [vfoMMode, memory, setActiveVfoState],
  );

  const onEnt = useCallback(() => {
    if (vfoMMode === "VFO" && pendingMemSlot !== null) {
      setMemory((prev) => {
        const next = [...prev];
        next[pendingMemSlot] = activeVfoState;
        return next;
      });
      setPendingMemSlot(null);
      beep(1500, 100);
    }
  }, [vfoMMode, pendingMemSlot, activeVfoState]);

  const onDeltaTx = useCallback(() => {
    if (activeVfo === "A") setVfoB((prev) => ({ ...prev, freqKHz: vfoA.freqKHz }));
    else setVfoA((prev) => ({ ...prev, freqKHz: vfoB.freqKHz }));
    setSplit(true);
    beep(1000, 60);
  }, [activeVfo, vfoA.freqKHz, vfoB.freqKHz]);

  const onDeltaRx = useCallback(() => {
    if (activeVfo === "A") setVfoA((prev) => ({ ...prev, freqKHz: vfoB.freqKHz }));
    else setVfoB((prev) => ({ ...prev, freqKHz: vfoA.freqKHz }));
    beep(1000, 60);
  }, [activeVfo, vfoA.freqKHz, vfoB.freqKHz]);

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
      mScope={mScope}
      menuOpen={menuOpen}
      helpOpen={helpOpen}
      compact={compact}
      vfoA={vfoA}
      vfoB={vfoB}
      activeVfo={activeVfo}
      onSelectVfo={(v) => {
        setActiveVfo(v);
        beep(500, 50);
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
      ritEnabled={ritEnabled}
      onToggleRit={() => setRitEnabled((s) => !s)}
      ritHz={ritHz}
      onChangeRitHz={setRitHz}
      onClearRit={() => {
        setRitHz(0);
        beep(400, 60);
      }}
      onDeltaTx={onDeltaTx}
      onDeltaRx={onDeltaRx}
      filterWidth={filterWidth}
      onSelectFilterWidth={(w) => {
        setFilterWidth(w);
        beep(800, 50);
      }}
      vfoMMode={vfoMMode}
      onToggleVfoM={() => setVfoMMode((m) => (m === "VFO" ? "M" : "VFO"))}
      pendingMemSlot={pendingMemSlot}
      onDigit={onDigit}
      onEnt={onEnt}
      mox={mox}
      onToggleMox={toggleMox}
      vox={vox}
      onToggleVox={toggleVox}
      transmitting={transmitting}
      rx={rx}
      onUpdateRx={updateRx}
      agcMode={rx.agcMode}
      onSelectAgc={(m: AgcMode) => updateRx({ agcMode: m })}
      compLevel={compLevel}
      onChangeCompLevel={setCompLevel}
      moni={moni}
      onToggleMoni={() => setMoni((s) => !s)}
      bkIn={bkIn}
      onToggleBkIn={() => setBkIn((s) => !s)}
      onToggleDim={() => setDim((s) => !s)}
      onToggleMScope={() => setMScope((s) => !s)}
      onToggleMenu={() => setMenuOpen((s) => !s)}
      onToggleHelp={() => setHelpOpen((s) => !s)}
      onToggleCompact={() => setCompact((s) => !s)}
      onExit={() => {
        setMenuOpen(false);
        setHelpOpen(false);
      }}
      scanning={scanning}
      onToggleScan={() => setScanning((s) => !s)}
      onToggleScanDir={() => setScanDir((d) => (d === 1 ? -1 : 1))}
      memScanOnly={memScanOnly}
      onToggleMemScan={() => setMemScanOnly((s) => !s)}
      signalDb={meter.sMeterDb}
      audibleStationIds={meter.audibleStationIds}
      roster={roster}
      ownId={ownId}
      events={events}
    />
  );
}
