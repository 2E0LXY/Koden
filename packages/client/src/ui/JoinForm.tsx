import { useState } from "react";
import { isValidGrid } from "@koden/shared";

interface JoinFormProps {
  onJoin: (callsign: string, grid: string) => void;
  defaultCallsign?: string;
  defaultGrid?: string;
}

export function JoinForm({ onJoin, defaultCallsign = "", defaultGrid = "" }: JoinFormProps) {
  const [callsign, setCallsign] = useState(defaultCallsign);
  const [grid, setGrid] = useState(defaultGrid);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (callsign.trim().length === 0) {
      setError("Enter a callsign (can be anything, e.g. a nickname).");
      return;
    }
    if (!isValidGrid(grid.trim())) {
      setError("Enter a valid Maidenhead grid locator, e.g. FN31 or IO91wm.");
      return;
    }
    setError(null);
    onJoin(callsign.trim().toUpperCase(), grid.trim().toUpperCase());
  };

  return (
    <form className="join-form" onSubmit={submit}>
      <div className="join-form__nameplate">
        <span>KODEN DX-9000</span>
        <small>MULTIBAND TRANSCEIVER</small>
      </div>
      <label>
        Callsign
        <input
          value={callsign}
          onChange={(e) => setCallsign(e.target.value)}
          placeholder="e.g. W1AW"
          maxLength={12}
        />
      </label>
      <label>
        Grid locator
        <input
          value={grid}
          onChange={(e) => setGrid(e.target.value)}
          placeholder="e.g. FN31pr"
          maxLength={6}
        />
      </label>
      {error && <div className="join-form__error">{error}</div>}
      <button type="submit">Power On</button>
    </form>
  );
}
