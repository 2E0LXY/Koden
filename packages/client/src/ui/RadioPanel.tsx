import { BANDS, type Band, type FilterWidth, type Mode, type StationInfo } from "@koden/shared";
import type { AgcMode, ReceiveParams } from "../audio/engine.js";
import { SMeter } from "./SMeter.js";
import { Waterfall } from "./Waterfall.js";
import { VfoDial } from "./VfoDial.js";
import { Knob } from "./Knob.js";
import { PanelButton } from "./PanelButton.js";

interface VfoDisplay {
  freqKHz: number;
  mode: Mode;
}

interface RadioPanelProps {
  callsign: string;
  connectionStatus: string;
  onPowerOff: () => void;
  dim: boolean;
  mScope: boolean;
  menuOpen: boolean;
  helpOpen: boolean;
  compact: boolean;

  vfoA: VfoDisplay;
  vfoB: VfoDisplay;
  activeVfo: "A" | "B";
  onSelectVfo: (v: "A" | "B") => void;
  split: boolean;
  onToggleSplit: () => void;

  band: Band | undefined;
  onTuneKnob: (freqKHz: number) => void;
  onModeSelect: (mode: Mode) => void;
  onBandSelect: (band: Band) => void;

  ritEnabled: boolean;
  onToggleRit: () => void;
  ritHz: number;
  onChangeRitHz: (hz: number) => void;
  onClearRit: () => void;
  onDeltaTx: () => void;
  onDeltaRx: () => void;

  filterWidth: FilterWidth;
  onSelectFilterWidth: (w: FilterWidth) => void;

  vfoMMode: "VFO" | "M";
  onToggleVfoM: () => void;
  pendingMemSlot: number | null;
  onDigit: (n: number) => void;
  onEnt: () => void;

  mox: boolean;
  onToggleMox: () => void;
  vox: boolean;
  onToggleVox: () => void;
  transmitting: boolean;

  rx: ReceiveParams;
  onUpdateRx: (p: Partial<ReceiveParams>) => void;
  agcMode: AgcMode;
  onSelectAgc: (m: AgcMode) => void;
  compLevel: number;
  onChangeCompLevel: (v: number) => void;
  moni: boolean;
  onToggleMoni: () => void;
  bkIn: boolean;
  onToggleBkIn: () => void;

  onToggleDim: () => void;
  onToggleMScope: () => void;
  onToggleMenu: () => void;
  onToggleHelp: () => void;
  onToggleCompact: () => void;
  onExit: () => void;

  scanning: boolean;
  onToggleScan: () => void;
  onToggleScanDir: () => void;
  memScanOnly: boolean;
  onToggleMemScan: () => void;

  signalDb: number;
  audibleStationIds: string[];
  roster: StationInfo[];
  ownId: string | null;
  events: string[];
}

const MEMORY_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

export function RadioPanel(props: RadioPanelProps) {
  const {
    callsign,
    connectionStatus,
    onPowerOff,
    dim,
    mScope,
    menuOpen,
    helpOpen,
    compact,
    vfoA,
    vfoB,
    activeVfo,
    onSelectVfo,
    split,
    onToggleSplit,
    band,
    onTuneKnob,
    onModeSelect,
    onBandSelect,
    ritEnabled,
    onToggleRit,
    ritHz,
    onChangeRitHz,
    onClearRit,
    onDeltaTx,
    onDeltaRx,
    filterWidth,
    onSelectFilterWidth,
    vfoMMode,
    onToggleVfoM,
    pendingMemSlot,
    onDigit,
    onEnt,
    mox,
    onToggleMox,
    vox,
    onToggleVox,
    transmitting,
    rx,
    onUpdateRx,
    agcMode,
    onSelectAgc,
    compLevel,
    onChangeCompLevel,
    moni,
    onToggleMoni,
    bkIn,
    onToggleBkIn,
    onToggleDim,
    onToggleMScope,
    onToggleMenu,
    onToggleHelp,
    onToggleCompact,
    onExit,
    scanning,
    onToggleScan,
    onToggleScanDir,
    memScanOnly,
    onToggleMemScan,
    signalDb,
    audibleStationIds,
    roster,
    ownId,
    events,
  } = props;

  const activeVfoState = activeVfo === "A" ? vfoA : vfoB;
  const audibleSet = new Set(audibleStationIds);

  return (
    <div className={`panel ${dim ? "panel--dim" : ""}`}>
      <div className="panel__top">
        <div className="panel__quick-col">
          <PanelButton label="POWER" onClick={onPowerOff} title="Power off and disconnect" />
          <PanelButton label="MOX" active={mox} onClick={onToggleMox} title="Manual transmit (push-to-talk toggle)" />
          <PanelButton label="VOX" active={vox} onClick={onToggleVox} title="Voice-activated transmit" />
          <PanelButton label="DIM" active={dim} onClick={onToggleDim} title="Dim the display" />
        </div>

        <div className="panel__meter-block">
          <SMeter signalDb={signalDb} />
          <div className="panel__meter-labels">P.AMP&nbsp;&nbsp;SWR&nbsp;&nbsp;COMP&nbsp;&nbsp;ALC</div>
        </div>

        <div className="panel__display">
          <div className="panel__display-row">
            <span className={`panel__indicator panel__indicator--tx ${transmitting ? "panel__indicator--on" : ""}`}>TX</span>
            <span className={`panel__indicator panel__indicator--rx ${!transmitting ? "panel__indicator--on" : ""}`}>RX</span>
            <span className="panel__vfo-tag">VFO-{activeVfo}</span>
            <span className="panel__mode-tag">{activeVfoState.mode}</span>
          </div>
          <div className="panel__freq-main">{formatFreq(activeVfoState.freqKHz)}</div>
          <div className="panel__display-row panel__display-row--secondary">
            <span>{activeVfo === "A" ? "B" : "A"}: VFO-{activeVfo === "A" ? "B" : "A"} {(activeVfo === "A" ? vfoB : vfoA).mode}</span>
            <span>{formatFreq((activeVfo === "A" ? vfoB : vfoA).freqKHz)}</span>
            <span>RIT {ritEnabled ? (ritHz >= 0 ? "+" : "") + (ritHz / 1000).toFixed(2) : "OFF"}</span>
            <span>IF {rx.ifShiftHz}</span>
          </div>
          <div className="panel__display-row panel__display-row--tertiary">
            <span>BAND {band?.id.toUpperCase() ?? "--"}</span>
            <span>FIL {filterWidth === "narrow" ? "1" : filterWidth === "normal" ? "2" : "3"}</span>
            <span>M.CH {pendingMemSlot ?? "--"}</span>
            <span>{split ? "SPLIT" : ""}</span>
          </div>
        </div>

        <div className="panel__nameplate">
          <span className="panel__brand">KODEN</span>
          <span className="panel__model">DX-9000</span>
          <span className="panel__subtitle">MULTIBAND TRANSCEIVER · MADE IN JAPAN</span>
          <span className={`panel__status panel__status--${connectionStatus}`}>{connectionStatus.toUpperCase()}</span>
        </div>
      </div>

      <div className="panel__buttonrow">
        <PanelButton label="MENU" active={menuOpen} onClick={onToggleMenu} />
        <PanelButton label="FUNCTION" active={helpOpen} onClick={onToggleHelp} />
        <PanelButton label="M.SCOPE" active={mScope} onClick={onToggleMScope} />
        <PanelButton label="QUICK" active={compact} onClick={onToggleCompact} />
        <PanelButton label="EXIT" onClick={onExit} />
      </div>

      {helpOpen && (
        <div className="panel__overlay">
          Drag knobs vertically (or scroll) to adjust. MOX toggles transmit on/off; VOX keys
          automatically when you speak. Tune the big knob or click a BAND button, then pick a
          MODE. SQUELCH mutes the channel until a signal breaks through; NOTCH/IF SHIFT/NB/NR
          shape what you hear. RIT offsets your receive frequency without moving your transmit
          frequency; SPLIT transmits on the other VFO.
        </div>
      )}
      {menuOpen && (
        <div className="panel__overlay">
          Connected to <code>{callsign}</code>&apos;s session. Server: multiplayer HF propagation
          simulator -- static, QSB fading, meteor scatter, and band conditions are computed
          server-side and are unique to every listener.
        </div>
      )}

      <div className="panel__body">
        <div className="panel__knob-col">
          <div className="knob-row">
            <Knob label="AF GAIN" value={rx.afGain} min={0} max={10} onChange={(v) => onUpdateRx({ afGain: v })} />
            <Knob label="RF GAIN" value={rx.rfGain} min={0} max={10} onChange={(v) => onUpdateRx({ rfGain: v })} />
            <Knob label="SQUELCH" value={rx.squelch} min={0} max={10} onChange={(v) => onUpdateRx({ squelch: v })} />
          </div>
          <div className="knob-row">
            <Knob label="NB LEVEL" value={rx.nbLevel} min={0} max={10} onChange={(v) => onUpdateRx({ nbLevel: v })} />
            <Knob label="NR LEVEL" value={rx.nrLevel} min={0} max={10} onChange={(v) => onUpdateRx({ nrLevel: v })} />
            <Knob label="NOTCH" value={rx.notchDepth} min={0} max={10} onChange={(v) => onUpdateRx({ notchDepth: v })} />
            <div className="agc-switch">
              <div className="agc-switch__label">AGC</div>
              <div className="agc-switch__options">
                {(["OFF", "FAST", "SLOW"] as AgcMode[]).map((m) => (
                  <PanelButton key={m} label={m} small active={agcMode === m} onClick={() => onSelectAgc(m)} />
                ))}
              </div>
            </div>
          </div>
          <div className="knob-row">
            <Knob label="COMP" value={compLevel} min={0} max={10} onChange={onChangeCompLevel} />
            <PanelButton label="BK-IN" active={bkIn} onClick={onToggleBkIn} />
            <PanelButton label="MONI" active={moni} onClick={onToggleMoni} />
          </div>
          <div className="panel__jacks">
            <div className="panel__jack">PHONES</div>
            <div className={`panel__jack panel__jack--mic ${transmitting ? "panel__jack--live" : ""}`}>MIC</div>
          </div>
        </div>

        <div className="panel__center-col">
          <div className="panel__vfo-row">
            <div className="mode-col">
              {(["LSB", "USB", "CW", "AM", "FM", "RTTY", "DATA"] as Mode[]).map((m) => (
                <PanelButton
                  key={m}
                  label={m}
                  active={activeVfoState.mode === m}
                  onClick={() => onModeSelect(m)}
                  title={band && !band.allowedModes.includes(m) ? "Not typically used on this band" : undefined}
                />
              ))}
            </div>

            <VfoDial freqKHz={activeVfoState.freqKHz} band={band} onChange={onTuneKnob} />

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
              <PanelButton label="ENT" small onClick={onEnt} />
            </div>
          </div>

          <div className="panel__vfo-controls-row">
            <PanelButton label="RIT" active={ritEnabled} onClick={onToggleRit} />
            <PanelButton label="ΔTX" onClick={onDeltaTx} title="Copy this VFO to the other and enable split" />
            <PanelButton label="CLEAR" onClick={onClearRit} title="Clear RIT offset" />
            <PanelButton label="IF SHIFT" onClick={() => onUpdateRx({ ifShiftHz: 0 })} title="Reset IF shift" />
            <PanelButton label="ΔRX" onClick={onDeltaRx} title="Copy the other VFO's frequency to this one" />
          </div>
        </div>

        <div className="panel__right-col">
          <div className="panel__memory-row">
            <div className="memory-keypad">
              {MEMORY_KEYS.map((n) => (
                <PanelButton key={n} small label={String(n)} active={pendingMemSlot === n} onClick={() => onDigit(n)} />
              ))}
              <PanelButton small label="." onClick={() => {}} />
              <PanelButton small label="ENT" onClick={onEnt} />
            </div>
            <div className="vfo-select">
              <PanelButton small label="A" active={activeVfo === "A"} onClick={() => onSelectVfo("A")} />
              <PanelButton small label="B" active={activeVfo === "B"} onClick={() => onSelectVfo("B")} />
              <PanelButton small label="VFO/M" active={vfoMMode === "M"} onClick={onToggleVfoM} />
              <PanelButton small label="SPLIT" active={split} onClick={onToggleSplit} />
            </div>
          </div>

          <div className="knob-row">
            <Knob label="RIT" value={ritHz} min={-1500} max={1500} onChange={onChangeRitHz} />
            <Knob label="IF SHIFT" value={rx.ifShiftHz} min={-1500} max={1500} onChange={(v) => onUpdateRx({ ifShiftHz: v })} />
            <Knob label="NOTCH" value={rx.notchFreqHz} min={300} max={3000} onChange={(v) => onUpdateRx({ notchFreqHz: v })} />
          </div>
          <div className="knob-row">
            <Knob size="small" label="PBT" value={rx.pbtQ} min={0} max={10} onChange={(v) => onUpdateRx({ pbtQ: v })} />
            <Knob size="small" label="WIDTH" value={rx.width} min={0} max={10} onChange={(v) => onUpdateRx({ width: v })} />
            <Knob size="small" label="WIDTH" value={rx.notchWidth} min={0} max={10} onChange={(v) => onUpdateRx({ notchWidth: v })} />
          </div>

          <div className="panel__scan-filter-row">
            <div className="button-group">
              <div className="button-group__label">SCAN</div>
              <PanelButton small label="SCAN" active={scanning} onClick={onToggleScan} />
              <PanelButton small label="PROG" onClick={onToggleScanDir} title="Reverse scan direction" />
              <PanelButton small label="MEM" active={memScanOnly} onClick={onToggleMemScan} />
            </div>
            <div className="button-group">
              <div className="button-group__label">FILTER</div>
              <PanelButton small label="FIL1" active={filterWidth === "narrow"} onClick={() => onSelectFilterWidth("narrow")} />
              <PanelButton small label="FIL2" active={filterWidth === "normal"} onClick={() => onSelectFilterWidth("normal")} />
              <PanelButton small label="FIL3" active={filterWidth === "wide"} onClick={() => onSelectFilterWidth("wide")} />
            </div>
          </div>
        </div>
      </div>

      <div className={`panel__monitor-bay ${mScope ? "panel__monitor-bay--scope" : ""}`}>
        <Waterfall signalDb={signalDb} active={transmitting} />
        {!compact && (
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
            <div className="panel__log-title">BAND LOG</div>
            <ul className="panel__log">
              {events.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
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
