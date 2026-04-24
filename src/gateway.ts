import { SessionManager } from "./session/session-manager.js";
import { Session, type SessionReport } from "./session/session.js";
import { PolicyEvaluator } from "./policy/evaluator.js";
import { loadPolicy } from "./policy/loader.js";
import type { Policy, AgentAction, Verdict } from "./policy/types.js";
import { EvidenceLedger } from "./ledger/ledger.js";
import { RollbackManager } from "./rollback/manager.js";
import type { RollbackResult } from "./rollback/types.js";

export interface GatewayOptions {
  ledgerDir: string;
  onStateChange?: (
    sessionId: string,
    oldState: string,
    newState: string
  ) => void;
}

export interface ActionResult {
  success: boolean;
  output?: unknown;
  error?: string;
  filesChanged?: number;
  costUsd?: number;
}

export interface AEPValidationResult {
  valid: boolean;
  errors: string[];
  elementId?: string;
}

export interface AEPElement {
  id: string;
  type: string;
  z: number;
  parent: string | null;
  label?: string;
  skin_binding?: string;
  [key: string]: unknown;
}

export class AgentGateway {
  private sessionManager: SessionManager;
  private ledgers: Map<string, EvidenceLedger> = new Map();
  private evaluators: Map<string, PolicyEvaluator> = new Map();
  private rollbackManager: RollbackManager;
  private options: GatewayOptions;

  constructor(options: GatewayOptions) {
    this.options = options;
    this.sessionManager = new SessionManager();
    this.rollbackManager = new RollbackManager();
  }

  createSession(
    policyPath: string,
    metadata?: Record<string, string>
  ): Session {
    const policy = loadPolicy(policyPath);
    return this.createSessionFromPolicy(policy, metadata);
  }

  createSessionFromPolicy(
    policy: Policy,
    metadata?: Record<string, string>
  ): Session {
    const session = this.sessionManager.createSessionFromPolicy(
      policy,
      metadata
    );
    const ledger = new EvidenceLedger({
      dir: this.options.ledgerDir,
      sessionId: session.id,
    });
    this.ledgers.set(session.id, ledger);
    this.rollbackManager.setLedger(ledger);

    const evaluator = new PolicyEvaluator(policy);
    this.evaluators.set(session.id, evaluator);

    ledger.append("session:start", {
      sessionId: session.id,
      policyName: policy.name,
      policyVersion: policy.version,
      metadata: metadata ?? {},
    });

    return session;
  }

  evaluate(sessionId: string, action: AgentAction): Verdict {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found.`);
    }
    const evaluator = this.evaluators.get(sessionId);
    if (!evaluator) {
      throw new Error(`No evaluator for session "${sessionId}".`);
    }
    const ledger = this.ledgers.get(sessionId);

    const verdict = evaluator.evaluate(action, session);

    // Log to ledger
    if (verdict.decision === "gate") {
      ledger?.append("action:gate", {
        actionId: verdict.actionId,
        tool: action.tool,
        reasons: verdict.reasons,
      });
      // Pause session on gate
      const oldState = session.state;
      if (session.state === "active") {
        session.pause();
        this.options.onStateChange?.(sessionId, oldState, session.state);
      }
    } else {
      ledger?.append("action:evaluate", {
        actionId: verdict.actionId,
        tool: action.tool,
        decision: verdict.decision,
        reasons: verdict.reasons,
        input: action.input,
      });
    }

    return verdict;
  }

  validateAEP(
    sessionId: string,
    actionId: string,
    element: AEPElement
  ): AEPValidationResult {
    const ledger = this.ledgers.get(sessionId);
    const errors: string[] = [];

    // ID format validation (check first)
    const idPattern = /^[A-Z]{2}-\d{5}$/;
    if (!idPattern.test(element.id)) {
      errors.push(
        `Element ID "${element.id}" does not match required format XX-NNNNN.`
      );
    }

    // Z-band validation
    const prefix = element.id.split("-")[0];
    const zBands: Record<string, [number, number]> = {
      SH: [0, 9],
      PN: [10, 19],
      NV: [10, 19],
      CP: [20, 29],
      FM: [20, 29],
      IC: [20, 29],
      WD: [20, 29],
      CZ: [30, 39],
      TB: [30, 39],
      TT: [40, 49],
      OV: [50, 59],
      MD: [60, 69],
      NT: [70, 79],
      DD: [70, 79],
    };

    const band = zBands[prefix];
    if (!band) {
      errors.push(
        `Unknown element prefix "${prefix}". Valid prefixes: ${Object.keys(zBands).join(", ")}.`
      );
    } else if (element.z < band[0] || element.z > band[1]) {
      errors.push(
        `Z-index ${element.z} outside allowed band [${band[0]}-${band[1]}] for prefix "${prefix}".`
      );
    }

    // Parent validation
    if (prefix !== "SH" && element.parent === null) {
      errors.push(
        `Non-shell element "${element.id}" must have a parent.`
      );
    }
    if (prefix === "SH" && element.parent !== null) {
      errors.push(
        `Shell element "${element.id}" must have null parent.`
      );
    }

    const valid = errors.length === 0;

    if (valid) {
      ledger?.append("aep:validate", {
        actionId,
        elementId: element.id,
        type: element.type,
        z: element.z,
      });
    } else {
      ledger?.append("aep:reject", {
        actionId,
        elementId: element.id,
        errors,
      });
    }

    return { valid, errors, elementId: element.id };
  }

  recordResult(
    sessionId: string,
    actionId: string,
    result: ActionResult
  ): void {
    const ledger = this.ledgers.get(sessionId);
    ledger?.append("action:result", {
      actionId,
      success: result.success,
      output: result.output,
      error: result.error,
      filesChanged: result.filesChanged,
      costUsd: result.costUsd,
    });
  }

  storeCompensation(
    sessionId: string,
    actionId: string,
    tool: string,
    input: Record<string, unknown>,
    previousState?: Record<string, unknown>
  ): void {
    const plan = RollbackManager.buildAEPCompensation(
      actionId,
      tool,
      input,
      previousState
    );
    this.rollbackManager.recordCompensation(sessionId, plan);
  }

  rollback(sessionId: string, actionId: string): RollbackResult {
    return this.rollbackManager.rollback(actionId);
  }

  rollbackSession(sessionId: string): RollbackResult[] {
    return this.rollbackManager.rollbackSession(sessionId);
  }

  terminateSession(sessionId: string, reason: string): SessionReport {
    const ledger = this.ledgers.get(sessionId);
    const report = this.sessionManager.terminateSession(sessionId, reason);

    ledger?.append("session:terminate", {
      sessionId,
      reason,
      duration: report.duration,
      totalActions: report.totalActions,
      allowed: report.allowed,
      denied: report.denied,
      gated: report.gated,
    });

    return report;
  }

  getSession(sessionId: string): Session | null {
    return this.sessionManager.getSession(sessionId);
  }

  getLedger(sessionId: string): EvidenceLedger | null {
    return this.ledgers.get(sessionId) ?? null;
  }

  resumeSession(sessionId: string): void {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found.`);
    }
    const oldState = session.state;
    session.activate();
    this.options.onStateChange?.(sessionId, oldState, session.state);
  }

  listActiveSessions(): Session[] {
    return this.sessionManager.listActiveSessions();
  }
}
