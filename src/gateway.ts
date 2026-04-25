import { SessionManager } from "./session/session-manager.js";
import { Session, type SessionReport } from "./session/session.js";
import { PolicyEvaluator } from "./policy/evaluator.js";
import { loadPolicy } from "./policy/loader.js";
import type { Policy, AgentAction, Verdict } from "./policy/types.js";
import { EvidenceLedger } from "./ledger/ledger.js";
import { RollbackManager } from "./rollback/manager.js";
import type { RollbackResult } from "./rollback/types.js";
import { TrustManager } from "./trust/manager.js";
import { RingManager } from "./rings/manager.js";
import type { RingConfig } from "./rings/types.js";
import { parseCovenant } from "./covenant/parser.js";
import { IntentDriftDetector } from "./intent/detector.js";
import { KillSwitch } from "./session/kill-switch.js";
import { TaskDecompositionManager } from "./decomposition/manager.js";
import type { TaskTree, TaskScope } from "./decomposition/types.js";
import { ProofBundleBuilder } from "./proof-bundle/builder.js";
import type { ProofBundle } from "./proof-bundle/types.js";
import type { AgentIdentity } from "./identity/types.js";
import { RecoveryEngine } from "./recovery/engine.js";
import type { Violation, RecoveryCallback } from "./recovery/types.js";
import { ScannerPipeline, createDefaultPipeline } from "./scanners/pipeline.js";
import type { Finding } from "./scanners/types.js";
import type { TokenUsage, CostRecord } from "./ledger/types.js";

export interface GatewayOptions {
  ledgerDir: string;
  onStateChange?: (
    sessionId: string,
    oldState: string,
    newState: string
  ) => void;
  trustConfig?: Record<string, unknown>;
  ringConfig?: Record<string, unknown>;
  covenantSource?: string;
  intentConfig?: Record<string, unknown>;
  identityConfig?: Record<string, unknown>;
  quantumConfig?: Record<string, unknown>;
  timestampConfig?: Record<string, unknown>;
  systemConfig?: Record<string, unknown>;
}

export interface ActionResult {
  success: boolean;
  output?: unknown;
  error?: string;
  filesChanged?: number;
  costUsd?: number;
  tokens?: TokenUsage;
  cost?: CostRecord;
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
  _version?: number;
  [key: string]: unknown;
}

export class AgentGateway {
  private sessionManager: SessionManager;
  private ledgers: Map<string, EvidenceLedger> = new Map();
  private evaluators: Map<string, PolicyEvaluator> = new Map();
  private rollbackManager: RollbackManager;
  private options: GatewayOptions;
  private trustManagers: Map<string, TrustManager> = new Map();
  private ringManagers: Map<string, RingManager> = new Map();
  private intentDetectors: Map<string, IntentDriftDetector> = new Map();
  private elementVersions: Map<string, number> = new Map();
  private systemRateCounter: { count: number; windowStart: number } = {
    count: 0,
    windowStart: Date.now(),
  };
  private killSwitch: KillSwitch;
  private decompositionManagers: Map<string, TaskDecompositionManager> = new Map();
  private activeTaskIds: Map<string, string> = new Map(); // sessionId -> active taskId
  private sessionAgents: Map<string, AgentIdentity> = new Map();
  private sessionCovenants: Map<string, import("./covenant/types.js").CovenantSpec> = new Map();
  private recoveryEngines: Map<string, RecoveryEngine> = new Map();
  private scannerPipelines: Map<string, ScannerPipeline> = new Map();
  private sessionTokenTotals: Map<string, { input: number; output: number }> = new Map();
  private sessionCostTotals: Map<string, { input: number; output: number; currency: string }> = new Map();
  private sessionCompletedOutputTokens: Map<string, number[]> = new Map();
  private sessionRejectedCount: Map<string, number> = new Map();

  constructor(options: GatewayOptions) {
    this.options = options;
    this.sessionManager = new SessionManager();
    this.rollbackManager = new RollbackManager();
    this.killSwitch = new KillSwitch(
      this.sessionManager,
      this.rollbackManager,
      this.trustManagers
    );
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
    // Check max concurrent sessions
    const maxConcurrent = policy.system?.max_concurrent_sessions ?? 20;
    const activeSessions = this.sessionManager.listActiveSessions();
    if (activeSessions.length >= maxConcurrent) {
      throw new Error(
        `Maximum concurrent sessions reached: ${activeSessions.length}/${maxConcurrent}.`
      );
    }

    const session = this.sessionManager.createSessionFromPolicy(
      policy,
      metadata
    );
    const ledger = new EvidenceLedger({
      dir: this.options.ledgerDir,
      sessionId: session.id,
      stateProvider: () => ({
        sessionId: session.id,
        state: session.state,
        stats: { ...session.stats },
        metadata: { ...session.metadata },
      }),
    });
    this.ledgers.set(session.id, ledger);
    this.rollbackManager.setLedger(ledger);

    const evaluator = new PolicyEvaluator(policy, {
      systemRateCounter: this.systemRateCounter,
      systemRateLimit: policy.system?.max_actions_per_minute,
    });
    this.evaluators.set(session.id, evaluator);

    // Wire trust manager if policy has trust config
    if (policy.trust) {
      const tm = new TrustManager(policy.trust);
      this.trustManagers.set(session.id, tm);
      evaluator.setTrustManager(tm);
    }

    // Wire ring manager if policy has ring config
    if (policy.ring) {
      const rm = new RingManager(policy.ring as unknown as RingConfig);
      this.ringManagers.set(session.id, rm);
      evaluator.setRingManager(rm);
    }

    // Wire covenant if policy has a covenant source
    if (policy.covenant) {
      try {
        const spec = parseCovenant(policy.covenant);
        evaluator.setCovenant(spec);
      } catch {
        // Invalid covenant source is logged but not fatal
      }
    }

    // Wire intent drift detector if policy has intent tracking enabled
    if (policy.intent?.tracking) {
      const detector = new IntentDriftDetector(policy.intent);
      this.intentDetectors.set(session.id, detector);
      evaluator.setIntentDetector(detector);
    }

    // Wire task decomposition manager if policy has decomposition enabled
    if (policy.decomposition?.enabled) {
      const dm = new TaskDecompositionManager(policy.decomposition);
      this.decompositionManagers.set(session.id, dm);
    }

    // Wire recovery engine if policy has recovery config
    if (policy.recovery?.enabled) {
      const re = new RecoveryEngine({
        enabled: true,
        maxAttempts: policy.recovery.max_attempts ?? 2,
      });
      this.recoveryEngines.set(session.id, re);
    }

    // Wire scanner pipeline if policy has scanners config
    if (policy.scanners?.enabled !== false) {
      const scannerConfig = policy.scanners;
      const pipeline = createDefaultPipeline(
        scannerConfig
          ? {
              enabled: scannerConfig.enabled,
              pii: scannerConfig.pii,
              injection: scannerConfig.injection,
              secrets: scannerConfig.secrets,
              jailbreak: scannerConfig.jailbreak,
              toxicity: scannerConfig.toxicity,
              urls: scannerConfig.urls,
            }
          : undefined
      );
      this.scannerPipelines.set(session.id, pipeline);
    }

    // Store covenant for proof bundle generation
    if (policy.covenant) {
      try {
        const spec = parseCovenant(policy.covenant);
        this.sessionCovenants.set(session.id, spec);
      } catch {
        // Already parsed above; store only if successful
      }
    }

    ledger.append("session:start", {
      sessionId: session.id,
      policyName: policy.name,
      policyVersion: policy.version,
      policyHash: evaluator.getPolicyHash(),
      metadata: metadata ?? {},
      policyDeclaration: {
        capabilities: policy.capabilities,
        forbidden: policy.forbidden,
        gates: policy.gates,
        limits: policy.limits,
        session: policy.session,
        trust: policy.trust,
        ring: policy.ring,
        intent: policy.intent,
        streaming: policy.streaming,
        decomposition: policy.decomposition,
        system: policy.system,
      },
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

    // Step 0: Task scope check (if task decomposition active)
    const dm = this.decompositionManagers.get(sessionId);
    const activeTaskId = this.activeTaskIds.get(sessionId);
    if (dm && activeTaskId) {
      const scopeDenial = dm.validateActionScope(
        activeTaskId,
        action.tool,
        action.input
      );
      if (scopeDenial) {
        session.recordAction("deny");
        ledger?.append("action:evaluate", {
          actionId: "task-scope-deny",
          tool: action.tool,
          decision: "deny",
          reasons: [scopeDenial],
          input: action.input,
        });
        return {
          decision: "deny",
          actionId: "task-scope-deny",
          reasons: [scopeDenial],
        };
      }
    }

    const verdict = evaluator.evaluate(action, session);

    // Trust-ring demotion on denial
    if (verdict.decision === "deny") {
      const trust = this.trustManagers.get(sessionId);
      const ring = this.ringManagers.get(sessionId);
      if (trust && ring) {
        ring.demoteOnTrustDrop(trust.getTier());
      }
    }

    // Log to ledger
    const policyHash = evaluator.getPolicyHash();
    if (verdict.decision === "gate") {
      ledger?.append("action:gate", {
        actionId: verdict.actionId,
        tool: action.tool,
        reasons: verdict.reasons,
        policyHash,
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
        policyHash,
      });
    }

    return verdict;
  }

  /**
   * Scans agent output content through the scanner pipeline.
   * Returns scan result with findings. Hard findings reject immediately.
   * Soft findings trigger recovery if a recovery engine is configured.
   *
   * @param sessionId - Active session ID
   * @param content - Agent output to scan
   * @param regenerate - Optional callback for recovery (soft violations)
   * @returns Object with passed status, findings and optional recovered output
   */
  scanContent(
    sessionId: string,
    content: string,
    regenerate?: RecoveryCallback
  ): { passed: boolean; findings: Finding[]; recoveredOutput?: string } {
    const pipeline = this.scannerPipelines.get(sessionId);
    if (!pipeline) {
      return { passed: true, findings: [] };
    }

    const ledger = this.ledgers.get(sessionId);
    const trustManager = this.trustManagers.get(sessionId);
    const result = pipeline.scan(content);

    if (result.passed) {
      return { passed: true, findings: [] };
    }

    // Log findings
    for (const finding of result.findings) {
      ledger?.append("scanner:finding", {
        scanner: finding.scanner,
        severity: finding.severity,
        category: finding.category,
        match: finding.match,
        position: finding.position,
      });
    }

    // Separate hard and soft findings
    const hardFindings = result.findings.filter((f) => f.severity === "hard");
    const softFindings = result.findings.filter((f) => f.severity === "soft");

    // Hard findings: immediate reject, no recovery
    if (hardFindings.length > 0) {
      trustManager?.penalize("Content scanner hard violation", "forbidden_match");
      return { passed: false, findings: result.findings };
    }

    // Soft findings: attempt recovery if available
    if (softFindings.length > 0) {
      const recoveryEngine = this.recoveryEngines.get(sessionId);
      if (recoveryEngine && regenerate) {
        const violation: Violation = {
          rule: softFindings[0].category,
          severity: "soft",
          source: "scanner",
          details: `Scanner "${softFindings[0].scanner}" found: ${softFindings[0].match}`,
        };

        const recoveryResult = recoveryEngine.attemptRecovery(
          violation,
          regenerate,
          (newOutput: string) => {
            const recheck = pipeline.scan(newOutput);
            if (recheck.passed) return null;
            const firstFinding = recheck.findings[0];
            return {
              rule: firstFinding.category,
              severity: firstFinding.severity,
              source: "scanner" as const,
              details: `Scanner "${firstFinding.scanner}" found: ${firstFinding.match}`,
            };
          }
        );

        // Log recovery attempts
        for (const attempt of recoveryResult.attempts) {
          ledger?.append("recovery:attempt", {
            attemptNumber: attempt.attemptNumber,
            violation: attempt.violation,
            result: attempt.result,
          });
        }

        if (recoveryResult.recovered) {
          ledger?.append("recovery:success", {
            attempts: recoveryResult.attempts.length,
            source: "scanner",
          });
          trustManager?.penalize("Soft violation recovered", undefined);
          // Apply -10 trust for recovered soft violation
          // (penalize applies default -50, so reward back +40)
          trustManager?.reward("Recovery success offset", 40);
          return {
            passed: true,
            findings: softFindings,
            recoveredOutput: recoveryResult.finalOutput,
          };
        }

        // Recovery exhausted - escalate to hard reject
        ledger?.append("recovery:exhausted", {
          attempts: recoveryResult.attempts.length,
          source: "scanner",
        });
        trustManager?.penalize("Soft violation recovery exhausted", "policy_violation");
        return { passed: false, findings: result.findings };
      }

      // No recovery engine - soft findings still fail
      trustManager?.penalize("Content scanner soft violation", "structural_violation");
      return { passed: false, findings: softFindings };
    }

    return { passed: true, findings: [] };
  }

  /**
   * Attempts recovery for a soft violation from any source (covenant, policy or scanner).
   * Returns recovery result with recovered output if successful.
   */
  attemptRecovery(
    sessionId: string,
    violation: Violation,
    regenerate: RecoveryCallback,
    validate: (output: string) => Violation | null
  ): { recovered: boolean; finalOutput?: string } {
    const recoveryEngine = this.recoveryEngines.get(sessionId);
    const ledger = this.ledgers.get(sessionId);
    const trustManager = this.trustManagers.get(sessionId);

    if (!recoveryEngine) {
      return { recovered: false };
    }

    const result = recoveryEngine.attemptRecovery(violation, regenerate, validate);

    for (const attempt of result.attempts) {
      ledger?.append("recovery:attempt", {
        attemptNumber: attempt.attemptNumber,
        violation: attempt.violation,
        result: attempt.result,
      });
    }

    if (result.recovered) {
      ledger?.append("recovery:success", {
        attempts: result.attempts.length,
        source: violation.source,
      });
      // -10 trust for recovered soft violation
      trustManager?.penalize("Soft violation recovered", undefined);
      trustManager?.reward("Recovery success offset", 40);
      return { recovered: true, finalOutput: result.finalOutput };
    }

    ledger?.append("recovery:exhausted", {
      attempts: result.attempts.length,
      source: violation.source,
    });
    // -50 trust for exhausted recovery
    trustManager?.penalize("Soft violation recovery exhausted", "policy_violation");
    return { recovered: false };
  }

  getRecoveryEngine(sessionId: string): RecoveryEngine | null {
    return this.recoveryEngines.get(sessionId) ?? null;
  }

  getScannerPipeline(sessionId: string): ScannerPipeline | null {
    return this.scannerPipelines.get(sessionId) ?? null;
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

  /**
   * Validates an AEP element with optimistic concurrency control.
   * Checks the element._version against the tracked version in elementVersions.
   * If a version mismatch is detected, the mutation is denied to prevent conflicts.
   * On success the tracked version is incremented.
   */
  validateAEPWithVersion(
    sessionId: string,
    actionId: string,
    element: AEPElement
  ): AEPValidationResult {
    // Optimistic concurrency version check
    const currentVersion = this.elementVersions.get(element.id) ?? 0;
    const providedVersion = element._version ?? 0;

    if (
      this.elementVersions.has(element.id) &&
      providedVersion !== currentVersion
    ) {
      const conflictError = `Optimistic concurrency conflict: expected version ${currentVersion}, received ${providedVersion}.`;
      const ledger = this.ledgers.get(sessionId);
      ledger?.append("aep:reject", {
        actionId,
        elementId: element.id,
        errors: [conflictError],
      });
      return {
        valid: false,
        errors: [conflictError],
        elementId: element.id,
      };
    }

    // Delegate to standard AEP validation
    const result = this.validateAEP(sessionId, actionId, element);

    // On success, increment the tracked version
    if (result.valid) {
      this.elementVersions.set(element.id, currentVersion + 1);
    }

    return result;
  }

  getElementVersion(elementId: string): number {
    return this.elementVersions.get(elementId) ?? 0;
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
    }, {
      tokens: result.tokens,
      cost: result.cost,
    });

    // Accumulate token and cost totals for the session
    if (result.tokens) {
      const existing = this.sessionTokenTotals.get(sessionId) ?? { input: 0, output: 0 };
      existing.input += result.tokens.input;
      existing.output += result.tokens.output;
      this.sessionTokenTotals.set(sessionId, existing);

      // Track completed output tokens for costSaved estimation
      const outputs = this.sessionCompletedOutputTokens.get(sessionId) ?? [];
      outputs.push(result.tokens.output);
      this.sessionCompletedOutputTokens.set(sessionId, outputs);
    }

    if (result.cost) {
      const existing = this.sessionCostTotals.get(sessionId) ?? { input: 0, output: 0, currency: result.cost.currency };
      existing.input += result.cost.input_cost;
      existing.output += result.cost.output_cost;
      existing.currency = result.cost.currency;
      this.sessionCostTotals.set(sessionId, existing);
    }
  }

  /**
   * Record that an action was rejected or aborted (for costSaved estimation).
   */
  recordRejection(sessionId: string): void {
    const count = this.sessionRejectedCount.get(sessionId) ?? 0;
    this.sessionRejectedCount.set(sessionId, count + 1);
  }

  getSessionTokenTotals(sessionId: string): { input: number; output: number } | null {
    return this.sessionTokenTotals.get(sessionId) ?? null;
  }

  getSessionCostTotals(sessionId: string): { input: number; output: number; currency: string } | null {
    return this.sessionCostTotals.get(sessionId) ?? null;
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
    const session = this.sessionManager.getSession(sessionId);
    const report = this.sessionManager.terminateSession(sessionId, reason);

    // Compute token totals and cost saved
    const tokenTotals = this.sessionTokenTotals.get(sessionId);
    const costTotals = this.sessionCostTotals.get(sessionId);
    if (tokenTotals) {
      report.totalTokens = tokenTotals.input + tokenTotals.output;
    }
    if (costTotals) {
      report.totalCost = costTotals.input + costTotals.output;
    }

    // Estimate cost saved: rejected/aborted actions * average output tokens
    const rejectedCount = this.sessionRejectedCount.get(sessionId) ?? 0;
    const completedOutputs = this.sessionCompletedOutputTokens.get(sessionId) ?? [];
    if (rejectedCount > 0 && completedOutputs.length > 0 && costTotals) {
      const avgOutputTokens = completedOutputs.reduce((a, b) => a + b, 0) / completedOutputs.length;
      const totalTokensEst = tokenTotals ? tokenTotals.input + tokenTotals.output : 0;
      const costPerToken = totalTokensEst > 0 ? (costTotals.input + costTotals.output) / totalTokensEst : 0;
      report.costSaved = rejectedCount * avgOutputTokens * costPerToken;
    }

    ledger?.append("session:terminate", {
      sessionId,
      reason,
      duration: report.duration,
      totalActions: report.totalActions,
      allowed: report.allowed,
      denied: report.denied,
      gated: report.gated,
      totalTokens: report.totalTokens,
      totalCost: report.totalCost,
      costSaved: report.costSaved,
    });

    // Clean up per-session resources
    this.trustManagers.delete(sessionId);
    this.ringManagers.delete(sessionId);
    this.intentDetectors.delete(sessionId);
    this.decompositionManagers.delete(sessionId);
    this.activeTaskIds.delete(sessionId);
    this.sessionAgents.delete(sessionId);
    this.sessionCovenants.delete(sessionId);
    this.recoveryEngines.delete(sessionId);
    this.scannerPipelines.delete(sessionId);
    this.sessionTokenTotals.delete(sessionId);
    this.sessionCostTotals.delete(sessionId);
    this.sessionCompletedOutputTokens.delete(sessionId);
    this.sessionRejectedCount.delete(sessionId);

    return report;
  }

  getSession(sessionId: string): Session | null {
    return this.sessionManager.getSession(sessionId);
  }

  getLedger(sessionId: string): EvidenceLedger | null {
    return this.ledgers.get(sessionId) ?? null;
  }

  getTrustManager(sessionId: string): TrustManager | null {
    return this.trustManagers.get(sessionId) ?? null;
  }

  getRingManager(sessionId: string): RingManager | null {
    return this.ringManagers.get(sessionId) ?? null;
  }

  getIntentDetector(sessionId: string): IntentDriftDetector | null {
    return this.intentDetectors.get(sessionId) ?? null;
  }

  getKillSwitch(): KillSwitch {
    return this.killSwitch;
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

  // --- Task Decomposition ---

  getDecompositionManager(sessionId: string): TaskDecompositionManager | null {
    return this.decompositionManagers.get(sessionId) ?? null;
  }

  setActiveTask(sessionId: string, taskId: string): void {
    this.activeTaskIds.set(sessionId, taskId);
  }

  getActiveTaskId(sessionId: string): string | null {
    return this.activeTaskIds.get(sessionId) ?? null;
  }

  setSessionAgent(sessionId: string, agent: AgentIdentity): void {
    this.sessionAgents.set(sessionId, agent);
  }

  // --- Proof Bundle ---

  generateProofBundle(
    sessionId: string,
    privateKey: string
  ): ProofBundle | null {
    const session = this.sessionManager.getSession(sessionId);
    const ledger = this.ledgers.get(sessionId);
    if (!session || !ledger) return null;

    const agent = this.sessionAgents.get(sessionId);
    if (!agent) return null;

    const trust = this.trustManagers.get(sessionId);
    const ring = this.ringManagers.get(sessionId);
    const drift = this.intentDetectors.get(sessionId);
    const dm = this.decompositionManagers.get(sessionId);
    const covenant = this.sessionCovenants.get(sessionId) ?? null;

    const report: SessionReport = {
      sessionId: session.id,
      duration: Date.now() - session.createdAt.getTime(),
      totalActions: session.stats.actionsEvaluated,
      allowed: session.stats.actionsAllowed,
      denied: session.stats.actionsDenied,
      gated: session.stats.actionsGated,
      terminationReason: session.state === "terminated" ? "terminated" : "active",
    };

    const builder = new ProofBundleBuilder();
    const bundle = builder.build(
      {
        sessionReport: report,
        agent,
        covenant,
        trustScore: {
          score: trust?.getScore() ?? 500,
          tier: trust?.getTier() ?? "standard",
        },
        ring: (ring?.getRing() ?? 2) as import("./rings/types.js").ExecutionRing,
        driftScore: 0, // Drift score is cumulative; use 0 if no detector
        ledger,
        taskTree: dm ? dm.getTree(sessionId) : null,
      },
      privateKey
    );

    // Log bundle creation to the ledger
    ledger.append("bundle:created", {
      bundleId: bundle.bundleId,
      merkleRoot: bundle.merkleRoot,
      ledgerHash: bundle.ledgerHash,
    });

    return bundle;
  }
}
