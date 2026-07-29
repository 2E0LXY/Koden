import { ClientMessage, ServerMessage } from "@koden/shared";

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface KodenSocketHandlers {
  onStatus: (status: ConnectionStatus) => void;
  onServerMessage: (message: ServerMessage) => void;
  onAudioFrame: (frame: ArrayBuffer) => void;
}

export class KodenSocket {
  private ws: WebSocket | null = null;

  constructor(
    private url: string,
    private handlers: KodenSocketHandlers,
  ) {}

  connect(): void {
    this.handlers.onStatus("connecting");
    const ws = new WebSocket(this.url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.addEventListener("open", () => this.handlers.onStatus("open"));
    ws.addEventListener("close", () => this.handlers.onStatus("closed"));
    ws.addEventListener("error", () => this.handlers.onStatus("closed"));
    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        try {
          const parsed = ServerMessage.parse(JSON.parse(event.data));
          this.handlers.onServerMessage(parsed);
        } catch {
          // Ignore malformed server messages rather than crashing the UI.
        }
      } else if (event.data instanceof ArrayBuffer) {
        this.handlers.onAudioFrame(event.data);
      }
    });
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  sendAudioFrame(frame: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(frame);
    }
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
