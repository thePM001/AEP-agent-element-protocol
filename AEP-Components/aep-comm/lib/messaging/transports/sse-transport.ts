/**
 * SSE transport with HTTP POST fallback metadata.
 */

export interface SSETransportConfig {
  url?: string;
  postFallbackUrl?: string;
}

export class SSETransport {
  private connected = false;
  private readonly config: SSETransportConfig;

  constructor(config: SSETransportConfig = {}) {
    this.config = { ...config };
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

  getPostFallbackUrl(): string | undefined {
    return this.config.postFallbackUrl;
  }
}