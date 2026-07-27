/**
 * Per-agent priority message queue.
 */

import type { MessageEnvelope } from "./envelope.js";

interface QueuedMessage {
  envelope: MessageEnvelope;
  priority: number;
  enqueuedAt: number;
}

export class AgentInbox {
  private queue: QueuedMessage[] = [];

  enqueue(envelope: MessageEnvelope, priority = 0): void {
    this.queue.push({ envelope, priority, enqueuedAt: Date.now() });
    this.queue.sort((a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt);
  }

  dequeue(): MessageEnvelope | null {
    const item = this.queue.shift();
    return item?.envelope ?? null;
  }

  peek(): MessageEnvelope | null {
    return this.queue[0]?.envelope ?? null;
  }

  size(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
  }
}