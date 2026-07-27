/**
 * WebSocket transport with auto-reconnect hooks (connection lifecycle only).
 */

export interface WSTransportConfig {
  url?: string;
  reconnectBaseMs?: number;
}

export class WSTransport {
  private connected = false;
  private readonly config: Required<WSTransportConfig>;

  constructor(config: WSTransportConfig = {}) {
    this.config = {
      url: config.url ?? "",
      reconnectBaseMs: config.reconnectBaseMs ?? 1000,
    };
  }

  async connect(url?: string): Promise<void> {
    this.config.url = url ?? this.config.url;
    this.connected = Boolean(this.config.url);
  }

  async close(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getReconnectDelay(attempt: number): number {
    return this.config.reconnectBaseMs * Math.min(attempt, 30);
  }
}