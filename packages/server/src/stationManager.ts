import type { WebSocket } from "ws";
import type { FilterWidth, Mode } from "@koden/shared";

export interface Station {
  id: string;
  ws: WebSocket;
  callsign: string;
  grid: string;
  /** Effective listening frequency (VFO + RIT, computed client-side). */
  freqKHz: number;
  /** Frequency other stations hear this station transmit on (differs from freqKHz when operating split). */
  txFreqKHz: number;
  mode: Mode;
  filterWidth: FilterWidth;
  transmitting: boolean;
  /** Latest audio frame received this tick from this station, if any. */
  pendingFrame: Int16Array | null;
  connectedAt: number;
}

export class StationManager {
  private stations = new Map<string, Station>();

  add(station: Station): void {
    this.stations.set(station.id, station);
  }

  remove(id: string): void {
    this.stations.delete(id);
  }

  get(id: string): Station | undefined {
    return this.stations.get(id);
  }

  all(): Station[] {
    return [...this.stations.values()];
  }

  count(): number {
    return this.stations.size;
  }
}
