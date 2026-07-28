import { useState } from "react";

interface SetupPanelProps {
  callsign: string;
  grid: string;
  onSaveProfile: (callsign: string, grid: string) => void;
  micDevices: MediaDeviceInfo[];
  speakerDevices: MediaDeviceInfo[];
  selectedMicId: string;
  onSelectMic: (id: string) => void;
  selectedSpeakerId: string;
  onSelectSpeaker: (id: string) => void;
  speakerSelectionSupported: boolean;
  sfxEnabled: boolean;
  onToggleSfx: () => void;
}

export function SetupPanel(props: SetupPanelProps) {
  const {
    callsign,
    grid,
    onSaveProfile,
    micDevices,
    speakerDevices,
    selectedMicId,
    onSelectMic,
    selectedSpeakerId,
    onSelectSpeaker,
    speakerSelectionSupported,
    sfxEnabled,
    onToggleSfx,
  } = props;

  const [callsignInput, setCallsignInput] = useState(callsign);
  const [gridInput, setGridInput] = useState(grid);
  const dirty = callsignInput !== callsign || gridInput.toUpperCase() !== grid.toUpperCase();

  return (
    <div className="setup-panel">
      <div className="setup-panel__section">
        <div className="setup-panel__label">Callsign / grid locator</div>
        <div className="setup-panel__row">
          <input
            className="setup-panel__input"
            value={callsignInput}
            maxLength={12}
            onChange={(e) => setCallsignInput(e.target.value.toUpperCase())}
          />
          <input
            className="setup-panel__input"
            value={gridInput}
            maxLength={6}
            onChange={(e) => setGridInput(e.target.value)}
          />
          <button
            className="setup-panel__button"
            disabled={!dirty}
            onClick={() => onSaveProfile(callsignInput.trim(), gridInput.trim())}
          >
            Save
          </button>
        </div>
      </div>

      <div className="setup-panel__section">
        <div className="setup-panel__label">Microphone</div>
        <select
          className="setup-panel__select"
          value={selectedMicId}
          onChange={(e) => onSelectMic(e.target.value)}
        >
          {micDevices.length === 0 && <option value="">Default microphone</option>}
          {micDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Microphone ${d.deviceId.slice(0, 6)}`}
            </option>
          ))}
        </select>
      </div>

      <div className="setup-panel__section">
        <div className="setup-panel__label">Speaker</div>
        {speakerSelectionSupported ? (
          <select
            className="setup-panel__select"
            value={selectedSpeakerId}
            onChange={(e) => onSelectSpeaker(e.target.value)}
          >
            {speakerDevices.length === 0 && <option value="">Default speaker</option>}
            {speakerDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Speaker ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        ) : (
          <div className="setup-panel__note">
            This browser doesn&apos;t support choosing an output device -- audio plays on your system default.
          </div>
        )}
      </div>

      <div className="setup-panel__section">
        <label className="setup-panel__checkbox">
          <input type="checkbox" checked={sfxEnabled} onChange={onToggleSfx} />
          Panel click/beep sound effects
        </label>
      </div>
    </div>
  );
}
