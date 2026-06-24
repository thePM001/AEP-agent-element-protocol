/**
 * Periodic peer health exchange over the in-memory DHT.
 */

import type { DHTLite } from "./dht.js";

export interface GossipPeerState {
  peerId: string;
  healthy: boolean;
  lastExchange: number;
}

export class GossipProtocol {
  private peers = new Map<string, GossipPeerState>();

  constructor(private readonly dht: DHTLite) {}

  async exchange(peerId: string, knownPeers: string[]): Promise<GossipPeerState> {
    const state: GossipPeerState = {
      peerId,
      healthy: true,
      lastExchange: Date.now(),
    };
    this.peers.set(peerId, state);
    this.dht.put(`gossip:${peerId}`, { knownPeers, state }, 120_000);
    return state;
  }

  tick(): number {
    const now = Date.now();
    let stale = 0;
    for (const [peerId, state] of this.peers) {
      if (now - state.lastExchange > 300_000) {
        state.healthy = false;
        this.peers.set(peerId, state);
        stale++;
      }
    }
    this.dht.prune();
    return stale;
  }

  getPeer(peerId: string): GossipPeerState | undefined {
    return this.peers.get(peerId);
  }

  listPeers(): GossipPeerState[] {
    return Array.from(this.peers.values());
  }
}