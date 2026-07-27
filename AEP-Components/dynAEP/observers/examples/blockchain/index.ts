// @PAD: /root/dynAEP/observers/examples/blockchain/index.ts
// =============================================================================
// observers/examples/blockchain/index.ts
// Blockchain event listener - reference implementation.
//
// Connects to an Ethereum JSON-RPC endpoint, polls for new event logs at
// a configurable contract address, and normalises Transfer, Mint, and Burn
// events into LatticeEvents.
//
// This adapter demonstrates the observer pattern for a real-world data source:
//   - Uses eth_getLogs to poll for new logs.
//   - Tracks the last-seen block number to avoid re-processing.
//   - Decodes Transfer (ERC-20 / ERC-721), Mint, and Burn event signatures.
//   - Normalises each log into a canonical LatticeEvent.
//
// Example usage:
// ```
// const adapter = new BlockchainObserverAdapter({
//   rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/<api-key>",
//   contractAddress: "0x..."",
//   pollIntervalMs: 12_000,       // every ~12s (one Ethereum block)
// });
// adapter.onEvent((event) => console.log(event));
// await adapter.start();
// ```
// =============================================================================

import { LatticeEvent, ObserverAdapter } from "../../interface";
import { observerLatticeFetch } from "../../lib/outbound-fetch";

// ── Configuration ──────────────────────────────────────────────────────────

export interface BlockchainObserverConfig {
  /** Ethereum JSON-RPC endpoint (e.g. Infura, Alchemy, local node). */
  rpcUrl: string;

  /** Contract address to watch (checksummed or lowercase hex). */
  contractAddress: string;

  /** Poll interval in milliseconds.  (default: 12_000 - one block on Ethereum) */
  pollIntervalMs?: number;

  /**
   * Optional starting block number.  If omitted, the adapter starts from the
   * latest block on first poll.
   */
  fromBlock?: number;

  /** Block range chunk size per eth_getLogs call.  (default: 100) */
  blockChunkSize?: number;

  /** Adapter name for logging.  (default: "eth:<short-address>") */
  name?: string;

  /** Source identifier for produced events.  (default: "eth:<short-address>") */
  source?: string;

  /** AbortSignal for external cancellation. */
  signal?: AbortSignal;
}

// ── Defaults ───────────────────────────────────────────────────────────────

const DEFAULTS = {
  pollIntervalMs: 12_000,
  blockChunkSize: 100,
};

// ── Event signature hashes ─────────────────────────────────────────────────
// keccak256("Transfer(address,address,uint256)")
const TRANSFER_EVENT_SIG =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// keccak256("Mint(address,uint256)")
const MINT_EVENT_SIG =
  "0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f";

// keccak256("Burn(address,uint256)")
const BURN_EVENT_SIG =
  "0xcc16f5dbb4873280815c1ee09dbd06736cffcc184412cf7a71a0fdb75d397ca5";

// ── Typed event shapes ─────────────────────────────────────────────────────

export interface TransferEvent {
  type: "transfer";
  from: string;
  to: string;
  tokenId: string;
  txHash: string;
  blockNumber: number;
  logIndex: number;
}

export interface MintEvent {
  type: "mint";
  to: string;
  tokenId: string;
  txHash: string;
  blockNumber: number;
  logIndex: number;
}

export interface BurnEvent {
  type: "burn";
  from: string;
  tokenId: string;
  txHash: string;
  blockNumber: number;
  logIndex: number;
}

export type BlockchainEvent = TransferEvent | MintEvent | BurnEvent;

// ── JSON-RPC types ─────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params: unknown[];
  id: number;
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

interface EthLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string; // hex
  transactionHash: string;
  logIndex: string; // hex
  removed?: boolean;
}

interface EthBlockNumberResult {
  blockNumber: string; // hex
}

// ── Adapter ────────────────────────────────────────────────────────────────

export class BlockchainObserverAdapter implements ObserverAdapter {
  readonly name: string;
  private config: Required<
    Omit<BlockchainObserverConfig, "fromBlock" | "signal">
  > & { fromBlock?: number; signal?: AbortSignal };
  private eventCallback: ((event: LatticeEvent) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastProcessedBlock: number;
  private rpcIdCounter = 0;
  private started = false;

  constructor(config: BlockchainObserverConfig) {
    const shortAddr = config.contractAddress.slice(0, 10) + "...";

    this.config = {
      rpcUrl: config.rpcUrl,
      contractAddress: config.contractAddress.toLowerCase(),
      pollIntervalMs: config.pollIntervalMs ?? DEFAULTS.pollIntervalMs,
      blockChunkSize: config.blockChunkSize ?? DEFAULTS.blockChunkSize,
      name: config.name ?? `eth:${shortAddr}`,
      source: config.source ?? `eth:${shortAddr}`,
      fromBlock: config.fromBlock,
      signal: config.signal,
    };
    this.name = this.config.name;

    // Start from the configured block or latest on first poll.
    this.lastProcessedBlock = config.fromBlock ?? 0;
  }

  // ── ObserverAdapter ──────────────────────────────────────────────────────

  /** Start the blockchain poller.  Idempotent. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    if (this.config.signal) {
      this.config.signal.addEventListener(
        "abort",
        () => this.stop(),
        { once: true }
      );
    }

    console.log(
      `[${this.name}] Starting blockchain poll every ${this.config.pollIntervalMs}ms ` +
        `contract=${this.config.contractAddress}`
    );

    // Fire immediately, then on interval
    await this.poll();
    this.timer = setInterval(() => this.poll(), this.config.pollIntervalMs);
  }

  /** Stop the blockchain poller.  Idempotent. */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    console.log(`[${this.name}] Blockchain poller stopped`);
  }

  /** Register the event callback.  Replaces any previous callback. */
  onEvent(callback: (event: LatticeEvent) => void): void {
    this.eventCallback = callback;
  }

  // ── Polling ──────────────────────────────────────────────────────────────

  /**
   * Execute a single poll cycle:
   * 1. Get the current block number from the node.
   * 2. If the lastProcessedBlock is 0 (not yet initialised), set it and return.
   * 3. Fetch logs from lastProcessedBlock+1 to current block.
   * 4. Decode and emit events for each matching log.
   */
  private async poll(): Promise<void> {
    try {
      const currentBlockHex = await this.rpcCall<string>(
        "eth_blockNumber",
        []
      );
      const currentBlock = parseInt(currentBlockHex, 16);

      if (this.lastProcessedBlock === 0) {
        // First poll - just record the current block head.
        this.lastProcessedBlock = currentBlock;
        console.log(
          `[${this.name}] Starting from block ${currentBlock}`
        );
        return;
      }

      if (currentBlock <= this.lastProcessedBlock) {
        // No new blocks yet.
        return;
      }

      // Fetch logs in chunks to avoid oversized response.
      const fromBlock = this.lastProcessedBlock + 1;
      const logs = await this.getLogsInRange(fromBlock, currentBlock);

      if (logs.length > 0) {
        console.log(
          `[${this.name}] Blocks ${fromBlock}-${currentBlock}: ` +
            `${logs.length} log(s)`
        );

        for (const log of logs) {
          const decoded = this.decodeLog(log);
          if (decoded) {
            this.emitEvent(decoded);
          }
        }
      }

      this.lastProcessedBlock = currentBlock;
    } catch (err: unknown) {
      if (!this.started) return;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${this.name}] Poll error: ${message}`);
    }
  }

  // ── JSON-RPC ─────────────────────────────────────────────────────────────

  /**
   * Make a JSON-RPC call to the configured endpoint.
   */
  private async rpcCall<T>(method: string, params: unknown[]): Promise<T> {
    const id = ++this.rpcIdCounter;
    const body: JsonRpcRequest = {
      jsonrpc: "2.0",
      method,
      params,
      id,
    };

    const response = await observerLatticeFetch(
      this.config.rpcUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      {
        adapter: "blockchain",
        observer: this.name,
        payloadExtra: { method, jsonrpc_id: id },
      },
    );

    if (!response.ok) {
      throw new Error(
        `JSON-RPC HTTP ${response.status}: ${response.statusText}`
      );
    }

    const json = (await response.json()) as JsonRpcResponse<T>;

    if (json.error) {
      throw new Error(
        `JSON-RPC error [${json.error.code}]: ${json.error.message}`
      );
    }

    return json.result as T;
  }

  /**
   * Fetch event logs for a contract within a block range.
   * The range is split into chunks to stay within node limits.
   */
  private async getLogsInRange(
    fromBlock: number,
    toBlock: number
  ): Promise<EthLog[]> {
    const allLogs: EthLog[] = [];
    const chunkSize = this.config.blockChunkSize;

    let chunkStart = fromBlock;
    while (chunkStart <= toBlock) {
      const chunkEnd = Math.min(chunkStart + chunkSize - 1, toBlock);

      const logs = await this.rpcCall<EthLog[]>("eth_getLogs", [
        {
          address: this.config.contractAddress,
          fromBlock: `0x${chunkStart.toString(16)}`,
          toBlock: `0x${chunkEnd.toString(16)}`,
        },
      ]);

      // Filter out removed logs (chain re-org protection)
      for (const log of logs) {
        if (!log.removed) {
          allLogs.push(log);
        }
      }

      chunkStart = chunkEnd + 1;
    }

    return allLogs;
  }

  // ── Log decoding ─────────────────────────────────────────────────────────

  /**
   * Decode a raw Ethereum log into a typed BlockchainEvent.
   * Returns null if the log doesn't match a known event signature.
   */
  private decodeLog(log: EthLog): BlockchainEvent | null {
    const topic0 = log.topics[0]?.toLowerCase();

    switch (topic0) {
      case TRANSFER_EVENT_SIG: {
        // topics: [sig, from (indexed), to (indexed)]
        // data: tokenId (hex-encoded uint256)
        const from = this.decodeAddress(log.topics[1]);
        const to = this.decodeAddress(log.topics[2]);
        const tokenId = this.decodeUint256(log.data);
        return {
          type: "transfer",
          from,
          to,
          tokenId,
          txHash: log.transactionHash,
          blockNumber: parseInt(log.blockNumber, 16),
          logIndex: parseInt(log.logIndex, 16),
        };
      }

      case MINT_EVENT_SIG: {
        // topics: [sig, to (indexed)]
        // data: tokenId
        const to = this.decodeAddress(log.topics[1]);
        const tokenId = this.decodeUint256(log.data);
        return {
          type: "mint",
          to,
          tokenId,
          txHash: log.transactionHash,
          blockNumber: parseInt(log.blockNumber, 16),
          logIndex: parseInt(log.logIndex, 16),
        };
      }

      case BURN_EVENT_SIG: {
        // topics: [sig, from (indexed)]
        // data: tokenId
        const from = this.decodeAddress(log.topics[1]);
        const tokenId = this.decodeUint256(log.data);
        return {
          type: "burn",
          from,
          tokenId,
          txHash: log.transactionHash,
          blockNumber: parseInt(log.blockNumber, 16),
          logIndex: parseInt(log.logIndex, 16),
        };
      }

      default:
        // Unknown event - skip.
        return null;
    }
  }

  // ── Hex decoding helpers ─────────────────────────────────────────────────

  /**
   * Decode a hex-encoded address from a topic (32 bytes, right-padded).
   * Returns the address as a lowercase 0x-prefixed hex string.
   */
  private decodeAddress(topic: string): string {
    // Topic is 0x-prefixed 32 bytes; the address is the last 20 bytes.
    const raw = topic.startsWith("0x") ? topic.slice(2) : topic;
    return "0x" + raw.slice(24).toLowerCase();
  }

  /**
   * Decode a hex-encoded uint256 value to its decimal string representation.
   */
  private decodeUint256(hexData: string): string {
    const raw = hexData.startsWith("0x") ? hexData.slice(2) : hexData;
    // BigInt can handle up to uint256
    return BigInt("0x" + raw).toString(10);
  }

  // ── Emission ─────────────────────────────────────────────────────────────

  /**
   * Normalise a typed BlockchainEvent into a LatticeEvent and forward to
   * the registered callback.
   */
  private emitEvent(blockchainEvent: BlockchainEvent): void {
    const actionPath = `blockchain:${blockchainEvent.type}`;

    const event: LatticeEvent = {
      source: this.config.source,
      action_path: actionPath,
      payload: {
        ...blockchainEvent,
        contract: this.config.contractAddress,
      } as Record<string, unknown>,
      bridge_timestamp: Date.now(),
    };

    this.eventCallback?.(event);
  }
}
