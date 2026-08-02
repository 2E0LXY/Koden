import { useState } from "react";
import { ANTENNAS, BANDS, antennaById, type AntennaId, type Band, type FilterWidth, type Mode, type StationInfo } from "@koden/shared";
import type { AgcMode, ReceiveParams } from "../audio/engine.js";
import type { TuneStep } from "../App.js";
import { click } from "../audio/sfx.js";
import { SMeter } from "./SMeter.js";
import { SwrBar } from "./SwrBar.js";
import { CompMeter } from "./CompMeter.js";
import { WattMeter } from "./WattMeter.js";
import { Waterfall } from "./Waterfall.js";
import { VfoDial } from "./VfoDial.js";
import { Knob } from "./Knob.js";
import { PanelButton } from "./PanelButton.js";
import { RotatorCompass } from "./RotatorCompass.js";
import { AntennaMap } from "./AntennaMap.js";
import { SetupPanel } from "./SetupPanel.js";
import { FreqKeypad } from "./FreqKeypad.js";
import { MemoryBank } from "./MemoryBank.js";

interface VfoDisplay {
  freqKHz: number;
  mode: Mode;
}

/** Labels for the server-link badge -- distinct from any band-condition wording, since "OPEN" alone reads as a band-opening report rather than a WebSocket state. */
const CONNECTION_LABELS: Record<string, string> = {
  open: "LINK: ONLINE",
  connecting: "LINK: CONNECTING",
  closed: "LINK: OFFLINE",
};

interface RadioPanelProps {
  callsign: string;
  connectionStatus: string;
  onPowerOff: () => void;
  dim: boolean;
  onToggleDim: () => void;
  mScope: boolean;
  onToggleMScope: () => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  tunerActive: boolean;
  swr: number;
  onTuner: () => void;
  moniEnabled: boolean;
  onToggleMoni: () => void;

  antenna: AntennaId;
  onSelectAntenna: (id: AntennaId) => void;
  heading: number;
  onChangeHeading: (deg: number) => void;
  ownGrid: string;
  onPointAt: (grid: string) => void;

  pttHeld: boolean;
  onPttDown: () => void;
  onPttUp: () => void;

  micDevices: MediaDeviceInfo[];
  speakerDevices: MediaDeviceInfo[];
  selectedMicId: string;
  onSelectMic: (id: string) => void;
  selectedSpeakerId: string;
  onSelectSpeaker: (id: string) => void;
  speakerSelectionSupported: boolean;
  sfxEnabled: boolean;
  onToggleSfx: () => void;
  onSaveProfile: (callsign: string, grid: string) => void;
  solar: { sfi: number; kp: number } | null;

  vfoA: VfoDisplay;
  vfoB: VfoDisplay;
  activeVfo: "A" | "B";
  onSelectVfo: (v: "A" | "B") => void;
  onSwapVfos: () => void;
  split: boolean;
  onToggleSplit: () => void;

  band: Band | undefined;
  onTuneKnob: (freqKHz: number) => void;
  onModeSelect: (mode: Mode) => void;
  onBandSelect: (band: Band) => void;
  vfoLocked: boolean;
  onToggleLock: () => void;
  tuneStep: TuneStep;
  onSetTuneStep: (step: TuneStep) => void;
  onStepUp: () => void;
  onStepDown: () => void;

  ritEnabled: boolean;
  onToggleRit: () => void;
  xitEnabled: boolean;
  onToggleXit: () => void;
  offsetHz: number;
  onChangeOffsetHz: (hz: number) => void;
  onClear: () => void;

  filterWidth: FilterWidth;
  onCycleFilterWidth: () => void;

  vfoMMode: "VFO" | "M";
  onToggleVfoM: () => void;
  memIndex: number;
  onMemToVfo: () => void;
  onMemIn: () => void;
  memory: (VfoDisplay | null)[];
  onMemoryProgram: (idx: number) => void;
  onMemoryRecall: (idx: number) => void;
  memScanActive: boolean;
  onToggleMemScan: () => void;

  mox: boolean;
  onToggleMox: () => void;
  vox: boolean;
  onToggleVox: () => void;
  transmitting: boolean;

  rx: ReceiveParams;
  onUpdateRx: (p: Partial<ReceiveParams>) => void;
  agcMode: AgcMode;
  onSelectAgc: (m: AgcMode) => void;
  onToggleNb: () => void;
  onToggleNr: () => void;
  onToggleAtt: () => void;
  onToggleIpo: () => void;
  onToggleApf: () => void;
  onToggleDnr: () => void;

  compEnabled: boolean;
  onToggleComp: () => void;
  procLevel: number;
  onChangeProcLevel: (v: number) => void;
  moniLevel: number;
  onChangeMoniLevel: (v: number) => void;
  voxDelayKnob: number;
  onChangeVoxDelayKnob: (v: number) => void;
  micGain: number;
  onChangeMicGain: (v: number) => void;
  txPower: number;
  onChangeTxPower: (v: number) => void;
  keySpeed: number;
  onChangeKeySpeed: (v: number) => void;

  scanning: boolean;
  onToggleScan: () => void;

  signalDb: number;
  audibleStationIds: string[];
  noiseFloorDb: number;
  txModLevel: number;
  roster: StationInfo[];
  ownId: string | null;
  events: string[];
  /** Live receive audio level, read directly off actual playback -- see AudioEngine.getRxLevel(). */
  getLiveLevel?: () => { rms: number; peak: number };
}

const MODE_BUTTONS: { label: string; mode: Mode }[] = [
  { label: "LSB", mode: "LSB" },
  { label: "USB", mode: "USB" },
  { label: "CW", mode: "CW" },
  { label: "AM", mode: "AM" },
  { label: "FM", mode: "FM" },
  { label: "DIG", mode: "DATA" },
];

export function RadioPanel(props: RadioPanelProps) {
  const {
    callsign,
    connectionStatus,
    onPowerOff,
    dim,
    onToggleDim,
    mScope,
    onToggleMScope,
    menuOpen,
    onToggleMenu,
    onCloseMenu,
    tunerActive,
    swr,
    onTuner,
    moniEnabled,
    onToggleMoni,
    antenna,
    onSelectAntenna,
    heading,
    onChangeHeading,
    ownGrid,
    onPointAt,
    pttHeld,
    onPttDown,
    onPttUp,
    micDevices,
    speakerDevices,
    selectedMicId,
    onSelectMic,
    selectedSpeakerId,
    onSelectSpeaker,
    speakerSelectionSupported,
    sfxEnabled,
    onToggleSfx,
    onSaveProfile,
    solar,
    vfoA,
    vfoB,
    activeVfo,
    onSelectVfo,
    onSwapVfos,
    split,
    onToggleSplit,
    band,
    onTuneKnob,
    onModeSelect,
    onBandSelect,
    vfoLocked,
    onToggleLock,
    tuneStep,
    onSetTuneStep,
    onStepUp,
    onStepDown,
    ritEnabled,
    onToggleRit,
    xitEnabled,
    onToggleXit,
    offsetHz,
    onChangeOffsetHz,
    onClear,
    filterWidth,
    onCycleFilterWidth,
    vfoMMode,
    onToggleVfoM,
    memIndex,
    onMemToVfo,
    onMemIn,
    memory,
    onMemoryProgram,
    onMemoryRecall,
    memScanActive,
    onToggleMemScan,
    mox,
    onToggleMox,
    vox,
    onToggleVox,
    transmitting,
    rx,
    onUpdateRx,
    agcMode,
    onSelectAgc,
    onToggleNb,
    onToggleNr,
    onToggleAtt,
    onToggleIpo,
    onToggleApf,
    onToggleDnr,
    compEnabled,
    onToggleComp,
    procLevel,
    onChangeProcLevel,
    moniLevel,
    onChangeMoniLevel,
    voxDelayKnob,
    onChangeVoxDelayKnob,
    micGain,
    onChangeMicGain,
    txPower,
    onChangeTxPower,
    keySpeed,
    onChangeKeySpeed,
    scanning,
    onToggleScan,
    signalDb,
    audibleStationIds,
    noiseFloorDb,
    txModLevel,
    getLiveLevel,
    roster,
    ownId,
    events,
  } = props;

  const [keypadBuffer, setKeypadBuffer] = useState("");
  const keypadActive = keypadBuffer.length > 0;

  const onKeypadDigit = (d: string) => {
    setKeypadBuffer((prev) => (prev.length >= 9 ? prev : prev + d));
  };
  const onKeypadDecimal = () => {
    setKeypadBuffer((prev) => (prev.includes(".") ? prev : prev + "."));
  };
  const onKeypadBackspace = () => {
    setKeypadBuffer((prev) => prev.slice(0, -1));
  };
  const onKeypadEnter = () => {
    const mhz = parseFloat(keypadBuffer);
    if (Number.isFinite(mhz) && mhz > 0) {
      onTuneKnob(mhz * 1000);
    }
    setKeypadBuffer("");
  };

  const activeVfoState = activeVfo === "A" ? vfoA : vfoB;
  const otherVfo = activeVfo === "A" ? vfoB : vfoA;
  const audibleSet = new Set(audibleStationIds);
  // SSB carries no RF between syllables -- the wattmeter should swing with
  // actual voice peaks. CW/AM/FM/RTTY/DATA transmit a continuous carrier, so
  // it holds near full power with just a touch of realistic needle jitter.
  const isVoiceMode = activeVfoState.mode === "USB" || activeVfoState.mode === "LSB";
  const txEnvelope = isVoiceMode
    ? Math.max(0.04, txModLevel)
    : 0.94 + Math.sin(performance.now() / 137) * 0.05;
  const filterLabel = filterWidth === "narrow" ? "NAR" : filterWidth === "normal" ? "MID" : "WIDE";
  const antennaMeta = antennaById(antenna);
  const antennaLabel = antennaMeta
    ? `${antennaMeta.name}${antennaMeta.rotatable ? ` ${Math.round(heading).toString().padStart(3, "0")}°` : ""}`
    : antenna;

  return (
    <div className={`panel ${dim ? "panel--dim" : ""}`}>
      <div className="panel__top">
        <div className="panel__quick-col">
          <PanelButton label="POWER" onClick={onPowerOff} title="Power off and disconnect" />
          <PanelButton label="TUNER" active={tunerActive} onClick={onTuner} title="Run the antenna tuner" />
          <PanelButton label="MONI" active={moniEnabled} onClick={onToggleMoni} title="Monitor/sidetone" />
          <PanelButton label="VOX" active={vox} onClick={onToggleVox} title="Voice-activated transmit" />
          <PanelButton label="MOX" active={mox} onClick={onToggleMox} title="Manual transmit (push-to-talk toggle)" />
          <button
            className={`panel-btn panel-btn--ptt ${pttHeld ? "panel-btn--active" : ""}`}
            onPointerDown={(e) => {
              e.preventDefault();
              click();
              onPttDown();
            }}
            onPointerUp={onPttUp}
            onPointerLeave={() => pttHeld && onPttUp()}
            title="Push and hold to transmit"
          >
            PTT
          </button>
        </div>

        <div className="panel__lcd-col">
          <div className="panel__dual-display">
            <div className="panel__scope-display">
              <span
                className={`panel__status panel__status--${connectionStatus}`}
                title="Connection to the Koden server -- not a band condition"
              >
                {CONNECTION_LABELS[connectionStatus] ?? connectionStatus.toUpperCase()}
              </span>
              <SMeter signalDb={signalDb} getLiveLevel={getLiveLevel} />
              <SwrBar swr={swr} tuning={tunerActive} />
              <CompMeter enabled={compEnabled} level={procLevel} />
              <WattMeter watts={txPower * 10 * txEnvelope} transmitting={transmitting} />
            </div>

            <div className={`panel__display ${mScope ? "panel__display--big-scope" : ""}`}>
              <div className="panel__display-row">
                <span className={`panel__indicator panel__indicator--tx ${transmitting ? "panel__indicator--on" : ""}`}>TX</span>
                <span className={`panel__indicator panel__indicator--rx ${!transmitting ? "panel__indicator--on" : ""}`}>RX</span>
                <span className="panel__vfo-tag">VFO-{activeVfo}</span>
                <span className="panel__mode-tag">{activeVfoState.mode}</span>
                {vfoLocked && <span className="panel__mode-tag">LOCK</span>}
              </div>
              <div className="panel__freq-main">
                {keypadActive ? `${keypadBuffer}_` : formatFreq(activeVfoState.freqKHz)}
              </div>
              <div className="panel__display-row panel__display-row--secondary">
                <span>
                  VFO-{activeVfo === "A" ? "B" : "A"} {otherVfo.mode}
                </span>
                <span>{formatFreq(otherVfo.freqKHz)}</span>
                <span>RIT {ritEnabled ? (offsetHz >= 0 ? "+" : "") + (offsetHz / 1000).toFixed(2) : "OFF"}</span>
                <span>XIT {xitEnabled ? (offsetHz >= 0 ? "+" : "") + (offsetHz / 1000).toFixed(2) : "OFF"}</span>
              </div>
              <div className="panel__display-row panel__display-row--tertiary">
                <span>BAND {band?.id.toUpperCase() ?? "--"}</span>
                <span>R.FLT {filterLabel}</span>
                <span>M.CH {memIndex}</span>
                <span>{split ? "SPLIT" : ""}</span>
                <span>{antennaLabel}</span>
              </div>
              <Waterfall
                signalDb={signalDb}
                noiseFloorDb={noiseFloorDb}
                getLiveLevel={getLiveLevel}
                active={transmitting}
                centerFreqKHz={activeVfoState.freqKHz}
                bandRangeKHz={band?.rangeKHz}
                stations={roster
                  .filter((s) => s.id !== ownId)
                  .map((s) => ({ id: s.id, freqKHz: s.freqKHz, transmitting: s.transmitting, audible: audibleSet.has(s.id) }))}
                onTuneTo={onTuneKnob}
              />
            </div>
          </div>

          <MemoryBank memory={memory} activeIndex={memIndex} onProgram={onMemoryProgram} onRecall={onMemoryRecall} />
        </div>

        <div className="panel__top-right-col">
          <div className="panel__nameplate">
            <img className="panel__nameplate-img" src="/koden-nameplate.jpg" alt="KODEN DX-9000 - Multiband Transceiver - Made in Japan" />
          </div>
          <div className="knob-row">
            <Knob label="AF GAIN" value={rx.afGain} min={0} max={10} onChange={(v) => onUpdateRx({ afGain: v })} />
            <Knob label="RF GAIN" value={rx.rfGain} min={0} max={10} onChange={(v) => onUpdateRx({ rfGain: v })} />
            <Knob label="SQL" value={rx.squelch} min={0} max={10} onChange={(v) => onUpdateRx({ squelch: v })} />
          </div>
          <FreqKeypad
            active={keypadActive}
            onDigit={onKeypadDigit}
            onDecimal={onKeypadDecimal}
            onBackspace={onKeypadBackspace}
            onEnter={onKeypadEnter}
          />
        </div>
      </div>

      <div className="panel__buttonrow">
        <PanelButton label="MENU" active={menuOpen} onClick={onToggleMenu} />
        <PanelButton label="DISP" active={dim} onClick={onToggleDim} title="Dim the display" />
        <PanelButton label="SCOPE" active={mScope} onClick={onToggleMScope} />
        <PanelButton label="ATT" active={rx.attEnabled} onClick={onToggleAtt} title="Front-end attenuator" />
        <PanelButton label="IPO" active={rx.ipoEnabled} onClick={onToggleIpo} title="Preamp bypass" />
        <PanelButton label="NB" active={rx.nbLevel > 0} onClick={onToggleNb} title="Noise blanker" />
        <PanelButton label="NR" active={rx.nrLevel > 0} onClick={onToggleNr} title="Noise reduction" />
        <PanelButton label="APF" active={rx.apfEnabled} onClick={onToggleApf} title="Audio peak filter (CW)" />
        <PanelButton label="R.FLT" onClick={onCycleFilterWidth} title={`Roofing filter: ${filterLabel}`} />
        <PanelButton label="CMP" active={compEnabled} onClick={onToggleComp} title="Speech processor" />
        <PanelButton label="DNR" active={rx.dnrEnabled} onClick={onToggleDnr} title="Digital noise reduction" />
        <div className="agc-switch agc-switch--inline">
          <div className="agc-switch__label">AGC</div>
          <div className="agc-switch__options">
            {(["OFF", "FAST", "SLOW"] as AgcMode[]).map((m) => (
              <PanelButton
                key={m}
                label={m}
                small
                active={agcMode === m}
                disabled={activeVfoState.mode === "FM"}
                onClick={() => onSelectAgc(m)}
                title={activeVfoState.mode === "FM" ? "AGC time constant isn't adjustable in FM" : undefined}
              />
            ))}
          </div>
        </div>
      </div>

      {menuOpen && (
        <div className="panel__overlay">
          <button className="panel__overlay-close" onClick={onCloseMenu} title="Close">
            ×
          </button>
          <div className="panel__overlay-intro">
            Connected to <code>{callsign}</code>&apos;s session on a multiplayer HF propagation
            simulator. Drag knobs vertically (or scroll) to adjust. MOX toggles transmit on/off; VOX
            keys automatically when you speak, and PTT transmits only while held. RIT offsets your
            receive frequency, XIT offsets your transmit frequency; SPLIT transmits on the other VFO.
            TUNER runs a simulated antenna match. Static, QSB fading, meteor scatter, and band
            conditions are computed server-side and are unique to every listener.
          </div>
          <div className="panel__overlay-solar">
            Solar conditions:{" "}
            {solar ? (
              <>
                SFI <strong>{solar.sfi}</strong> &middot; K-index <strong>{solar.kp}</strong>
              </>
            ) : (
              "loading..."
            )}{" "}
            (live NOAA SWPC data, refreshed every few minutes)
          </div>
          <SetupPanel
            callsign={callsign}
            grid={ownGrid}
            onSaveProfile={onSaveProfile}
            micDevices={micDevices}
            speakerDevices={speakerDevices}
            selectedMicId={selectedMicId}
            onSelectMic={onSelectMic}
            selectedSpeakerId={selectedSpeakerId}
            onSelectSpeaker={onSelectSpeaker}
            speakerSelectionSupported={speakerSelectionSupported}
            sfxEnabled={sfxEnabled}
            onToggleSfx={onToggleSfx}
          />
        </div>
      )}

      <div className="panel__body">
        <div className="panel__knob-col">
          <div className="knob-row">
            <Knob label="MIC GAIN" value={micGain} min={0} max={10} onChange={onChangeMicGain} />
            <Knob label="RF POWER" value={txPower} min={0} max={10} onChange={onChangeTxPower} />
            <Knob label="KEY SPEED" value={keySpeed} min={0} max={10} onChange={onChangeKeySpeed} />
          </div>
          <div className="knob-row">
            <Knob label="PROC" value={procLevel} min={0} max={10} onChange={onChangeProcLevel} />
            <Knob label="MONI" value={moniLevel} min={0} max={10} onChange={onChangeMoniLevel} />
            <Knob label="VOX DELAY" value={voxDelayKnob} min={0} max={10} onChange={onChangeVoxDelayKnob} />
          </div>
          <div className="panel__antenna-section">
            <div className="button-group__label">ANTENNA</div>
            <div className="antenna-grid">
              {ANTENNAS.map((a) => (
                <PanelButton
                  key={a.id}
                  small
                  label={a.name}
                  active={antenna === a.id}
                  onClick={() => onSelectAntenna(a.id)}
                  title={a.description}
                />
              ))}
            </div>
            <RotatorCompass headingDeg={heading} onChangeHeading={onChangeHeading} disabled={!antennaMeta?.rotatable} />
          </div>

          <div className="panel__jacks">
            <div className="panel__jack">PHONES</div>
            <div className={`panel__jack panel__jack--mic ${transmitting ? "panel__jack--live" : ""}`}>MIC</div>
          </div>
        </div>

        <div className="panel__center-col">
          <div className="panel__vfo-row">
            <div className="mode-col">
              {MODE_BUTTONS.map(({ label, mode }) => (
                <PanelButton
                  key={label}
                  label={label}
                  active={activeVfoState.mode === mode}
                  onClick={() => onModeSelect(mode)}
                  title={band && !band.allowedModes.includes(mode) ? "Not typically used on this band" : undefined}
                />
              ))}
            </div>

            <div className="tuning-block">
              <div className="tuning-block__side">
                <PanelButton label="FAST" active={tuneStep === "FAST"} onClick={() => onSetTuneStep("FAST")} />
                <PanelButton label="LOCK" active={vfoLocked} onClick={onToggleLock} />
                <PanelButton label="SCAN" active={scanning} onClick={onToggleScan} />
                <PanelButton label="CLEAR" onClick={onClear} title="Clear RIT/XIT offset" />
              </div>

              <VfoDial freqKHz={activeVfoState.freqKHz} band={band} onChange={onTuneKnob} />

              <div className="tuning-block__side">
                <PanelButton label="▲" small onClick={onStepUp} />
                <PanelButton label="▼" small onClick={onStepDown} />
                <PanelButton label="FINE" active={tuneStep === "FINE"} onClick={() => onSetTuneStep("FINE")} />
                <PanelButton label="COARSE" active={tuneStep === "COARSE"} onClick={() => onSetTuneStep("COARSE")} />
              </div>
            </div>

            <div className="band-grid">
              {BANDS.map((b) => (
                <PanelButton
                  key={b.id}
                  label={(b.rangeKHz[0] / 1000).toString().replace(/\.0$/, "")}
                  active={band?.id === b.id}
                  onClick={() => onBandSelect(b)}
                  title={b.name}
                />
              ))}
            </div>
          </div>

          <div className="panel__monitor-bay">
            <div className="panel__side-info">
              <div className="panel__roster-title">STATIONS ON FREQ</div>
              <ul className="panel__roster">
                {roster.map((s) => (
                  <li
                    key={s.id}
                    className={[
                      s.id === ownId ? "panel__roster-item--self" : "",
                      s.transmitting ? "panel__roster-item--tx" : "",
                      audibleSet.has(s.id) ? "panel__roster-item--audible" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <span className="panel__roster-call">{s.callsign}</span>
                    <span className="panel__roster-freq">
                      {s.txFreqKHz.toFixed(1)} {s.mode}
                    </span>
                    {s.transmitting && <span className="panel__roster-tx-dot">TX</span>}
                  </li>
                ))}
                {roster.length === 0 && <li className="panel__roster-empty">No stations connected</li>}
              </ul>
            </div>
            <div className="panel__side-info">
              <div className="panel__log-title">BAND LOG</div>
              <ul className="panel__log">
                {events.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
            <div className="panel__side-info panel__side-info--map">
              <div className="panel__roster-title">STATION MAP{antennaMeta?.rotatable ? " · click to point beam" : ""}</div>
              <AntennaMap
                ownGrid={ownGrid}
                roster={roster}
                ownId={ownId}
                headingDeg={heading}
                showHeading={!!antennaMeta?.rotatable}
                onPointAt={onPointAt}
              />
            </div>
          </div>
        </div>

        <div className="panel__right-col">
          <div className="panel__memory-row">
            <div className="button-group">
              <div className="button-group__label">MEMORY {memIndex}</div>
              <PanelButton small label="M&gt;VFO" onClick={onMemToVfo} title="Recall next memory channel" />
              <PanelButton small label="M.IN" onClick={onMemIn} title="Store this VFO to the current memory channel" />
              <PanelButton small label="MW" active={memScanActive} onClick={onToggleMemScan} title="Memory scan" />
            </div>
            <div className="vfo-select">
              <PanelButton small label="A/B" active={activeVfo === "B"} onClick={() => onSelectVfo(activeVfo === "A" ? "B" : "A")} />
              <PanelButton small label="A⇄B" onClick={onSwapVfos} title="Swap VFO A and B" />
              <PanelButton small label="SPLIT" active={split} onClick={onToggleSplit} />
              <PanelButton small label="VFO/M" active={vfoMMode === "M"} onClick={onToggleVfoM} />
            </div>
          </div>

          <div className="knob-row">
            <Knob
              label="TWIN PBT"
              value={rx.width}
              min={0}
              max={10}
              onChange={(v) => onUpdateRx({ width: v })}
              onReset={() => onUpdateRx({ width: 10 })}
            />
            <Knob label="NOTCH" value={rx.notchFreqHz} min={300} max={3000} onChange={(v) => onUpdateRx({ notchFreqHz: v })} />
            <Knob size="small" label="PBT" value={rx.pbtQ} min={0} max={10} onChange={(v) => onUpdateRx({ pbtQ: v })} />
            <Knob size="small" label="NOTCH WIDTH" value={rx.notchWidth} min={0} max={10} onChange={(v) => onUpdateRx({ notchWidth: v })} />
          </div>

          <div className="button-group">
            <div className="button-group__label">RIT/XIT</div>
            <PanelButton small label="RIT" active={ritEnabled} onClick={onToggleRit} />
            <PanelButton small label="XIT" active={xitEnabled} onClick={onToggleXit} />
          </div>

          <div className="knob-row">
            <Knob size="small" label="OFFSET" value={offsetHz} min={-9990} max={9990} onChange={onChangeOffsetHz} />
            <Knob label="IF SHIFT" value={rx.ifShiftHz} min={-1500} max={1500} onChange={(v) => onUpdateRx({ ifShiftHz: v })} />
            <Knob label="AF⇒RF" value={rx.afRfBalance} min={0} max={10} onChange={(v) => onUpdateRx({ afRfBalance: v })} />
          </div>
        </div>
      </div>

      <div className="panel__footer">
        Operating as <strong>{callsign}</strong> on {band?.name ?? "unknown band"}
      </div>
    </div>
  );
}

function formatFreq(freqKHz: number): string {
  const khz = Math.floor(freqKHz);
  const hz = Math.round((freqKHz - khz) * 1000);
  return `${khz.toLocaleString()}.${hz.toString().padStart(3, "0")}`;
}
