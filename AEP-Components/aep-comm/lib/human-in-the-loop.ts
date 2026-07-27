/**
 * Human-in-the-Loop - Approval gates for agent task pipelines.
 * Tasks requiring human approval are held until explicitly approved or rejected.
 * Part of AEP-Comm v2.75 - Universal Orchestration.
 */
// @PAD: p0-v275-h1-hitl-unique-approval-id-v1
// @GCDE: document_sha256=p0-v275-h1-approval-uuid

import { randomUUID } from 'node:crypto';

export type ApprovalStatus = "awaiting_approval" | "approved" | "rejected";

export interface ApprovalRequest {
  id: string;
  taskId: string;
  action: string;
  description: string;
  agentId: string;
  status: ApprovalStatus;
  requestedAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
  reason?: string;
}

export class HumanInTheLoop {
  private approvals: Map<string, ApprovalRequest> = new Map();
  private onApprovalCallbacks: Map<string, (request: ApprovalRequest) => void> = new Map();
  // M-1: multi-listener support for resolved approvals
  private onApprovalListeners: Array<(request: ApprovalRequest) => void> = [];

  /**
   * Request human approval for an agent action.
   */
  requestApproval(params: {
    taskId: string;
    action: string;
    description: string;
    agentId: string;
  }): ApprovalRequest {
    const id = `approval-${randomUUID()}`;
    const request: ApprovalRequest = {
      id,
      taskId: params.taskId,
      action: params.action,
      description: params.description,
      agentId: params.agentId,
      status: "awaiting_approval",
      requestedAt: Date.now(),
    };

    this.approvals.set(id, request);
    return request;
  }

  /**
   * Approve a pending request.
   */
  approve(requestId: string, approvedBy: string, reason?: string): ApprovalRequest | null {
    const request = this.approvals.get(requestId);
    if (!request || request.status !== "awaiting_approval") return null;

    request.status = "approved";
    request.resolvedAt = Date.now();
    request.resolvedBy = approvedBy;
    request.reason = reason;
    this.approvals.set(requestId, request);

    this.notify(request);
    return request;
  }

  /**
   * Reject a pending request.
   */
  reject(requestId: string, rejectedBy: string, reason?: string): ApprovalRequest | null {
    const request = this.approvals.get(requestId);
    if (!request || request.status !== "awaiting_approval") return null;

    request.status = "rejected";
    request.resolvedAt = Date.now();
    request.resolvedBy = rejectedBy;
    request.reason = reason;
    this.approvals.set(requestId, request);

    this.notify(request);
    return request;
  }

  /**
   * Get all pending approvals.
   */
  getPending(): ApprovalRequest[] {
    return Array.from(this.approvals.values()).filter(
      (r) => r.status === "awaiting_approval"
    );
  }

  /**
   * Get approval by ID.
   */
  getApproval(requestId: string): ApprovalRequest | null {
    return this.approvals.get(requestId) ?? null;
  }

  /**
   * Register callback for approval status changes.
   */
  onApprovalResolved(callback: (request: ApprovalRequest) => void): void {
    // M-1: append listener (do not overwrite prior registrations)
    this.onApprovalListeners.push(callback);
    this.onApprovalCallbacks.set("global", callback); // last also on legacy key
  }

  private notify(request: ApprovalRequest): void {
    for (const callback of this.onApprovalListeners) {
      try { callback(request); } catch { /* isolate listener failures */ }
    }
  }
}
