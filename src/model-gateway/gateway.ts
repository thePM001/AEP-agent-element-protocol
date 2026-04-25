// AEP 2.5 -- Governed Model Gateway
// Wraps every LLM call with the full AEP evaluation chain:
// input scanning, prompt optimisation, model dispatch, output scanning,
// recovery, token/cost tracking, OTEL telemetry and ledger recording.

import type {
  ModelConfig,
  ModelRequest,
  ModelResponse,
  GovernedModelResponse,
  GovernedChunk,
  ModelGatewayOptions,
} from "./types.js";
import type { ProviderAdapter } from "./types.js";
import { ProviderRegistry } from "./registry.js";
import type { Policy } from "../policy/types.js";
import type { EvidenceLedger } from "../ledger/ledger.js";
import type { ScannerPipeline } from "../scanners/pipeline.js";
import type { RecoveryEngine } from "../recovery/engine.js";
import type { PromptOptimizer } from "../optimization/optimizer.js";
import type { AEPTelemetryExporter } from "../telemetry/otel-exporter.js";
import type { Violation } from "../recovery/types.js";
import type { Finding, ScanResult } from "../scanners/types.js";

export interface GatewayDependencies {
  policy: Policy;
  ledger?: EvidenceLedger;
  scanner?: ScannerPipeline;
  recovery?: RecoveryEngine;
  optimizer?: PromptOptimizer;
  telemetry?: AEPTelemetryExporter;
  registry?: ProviderRegistry;
}

export class GovernedModelGateway {
  private config: ModelConfig;
  private sessionId: string;
  private policy: Policy;
  private ledger: EvidenceLedger | null;
  private scanner: ScannerPipeline | null;
  private recovery: RecoveryEngine | null;
  private optimizer: PromptOptimizer | null;
  private telemetry: AEPTelemetryExporter | null;
  private registry: ProviderRegistry;
  private adapter: ProviderAdapter;

  private scanOutput: boolean;
  private scanInput: boolean;
  private optimisePrompts: boolean;
  private costTracking: boolean;

  constructor(options: ModelGatewayOptions, deps: GatewayDependencies) {
    this.config = options.config;
    this.sessionId = options.sessionId;
    this.policy = deps.policy;
    this.ledger = deps.ledger ?? null;
    this.scanner = deps.scanner ?? null;
    this.recovery = deps.recovery ?? null;
    this.optimizer = deps.optimizer ?? null;
    this.telemetry = deps.telemetry ?? null;
    this.registry = deps.registry ?? new ProviderRegistry();
    this.adapter = this.registry.resolve(this.config);

    this.scanOutput = options.scanOutput ?? true;
    this.scanInput = options.scanInput ?? true;
    this.optimisePrompts = options.optimisePrompts ?? true;
    this.costTracking = options.costTracking ?? true;
  }

  /**
   * Execute a governed model call. Full evaluation chain:
   *
   * 1. Validate request
   * 2. Scan input messages (if enabled)
   * 3. Optimise prompts with governance context (if enabled)
   * 4. Dispatch to provider adapter
   * 5. Scan output content (if enabled)
   * 6. Recovery on soft violations
   * 7. Compute token usage and cost
   * 8. Record to evidence ledger
   * 9. Export to OTEL telemetry
   * 10. Return governed response
   */
  async call(request: ModelRequest): Promise<GovernedModelResponse> {
    const start = Date.now();
    let trustDelta = 0;
    let recoveryAttempted = false;
    let recoverySucceeded = false;
    let promptOptimised = false;

    // Step 1: Validate request structure
    const messages = [...request.messages];

    // Step 2: Scan input messages
    if (this.scanInput && this.scanner) {
      const inputContent = messages.map(m => m.content).join("\n");
      const inputScan = this.scanner.scan(inputContent);
      if (!inputScan.passed) {
        const hardFindings = inputScan.findings.filter(f => f.severity === "hard");
        if (hardFindings.length > 0) {
          this.logToLedger("model:call", {
            provider: this.config.provider,
            model: this.config.model,
            decision: "deny",
            reason: "input_scan_hard_violation",
            findings: hardFindings.map(f => `${f.scanner}:${f.category}`),
          });
          throw new Error(
            `Input blocked by scanner: ${hardFindings.map(f => f.category).join(", ")}`
          );
        }
        // Soft findings on input are logged but not blocked
        trustDelta -= inputScan.findings.length * 5;
      }
    }

    // Step 3: Optimise prompts
    if (this.optimisePrompts && this.optimizer) {
      const systemIdx = messages.findIndex(m => m.role === "system");
      if (systemIdx >= 0) {
        messages[systemIdx] = {
          ...messages[systemIdx],
          content: this.optimizer.injectGovernanceContext(messages[systemIdx].content),
        };
        promptOptimised = true;
      } else {
        // Prepend a governance-aware system message
        messages.unshift({
          role: "system",
          content: this.optimizer.injectGovernanceContext(""),
        });
        promptOptimised = true;
      }
    }

    // Step 4: Dispatch to provider
    const enrichedRequest: ModelRequest = {
      ...request,
      messages,
    };

    let response: ModelResponse;
    try {
      response = await this.adapter.complete(enrichedRequest, this.config);
    } catch (err) {
      this.logToLedger("model:call", {
        provider: this.config.provider,
        model: this.config.model,
        decision: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    // Step 5: Scan output
    let scanFindings: string[] = [];
    if (this.scanOutput && this.scanner) {
      const outputScan = this.scanner.scan(response.content);
      if (!outputScan.passed) {
        scanFindings = outputScan.findings.map(f => `${f.scanner}:${f.category}`);

        const hardFindings = outputScan.findings.filter(f => f.severity === "hard");
        if (hardFindings.length > 0) {
          // Hard violation in output -- deny
          trustDelta -= hardFindings.length * 50;
          this.logToLedger("model:call", {
            provider: this.config.provider,
            model: response.model,
            decision: "deny",
            reason: "output_scan_hard_violation",
            findings: scanFindings,
            usage: response.usage,
            latencyMs: response.latencyMs,
          });
          throw new Error(
            `Output blocked by scanner: ${hardFindings.map(f => f.category).join(", ")}`
          );
        }

        // Step 6: Soft violations -- attempt recovery
        if (this.recovery) {
          recoveryAttempted = true;
          const softViolation = this.findingsToViolation(outputScan.findings);

          const result = this.recovery.attemptRecovery(
            softViolation,
            (correctionPrompt: string) => {
              // Synchronous recovery callback: build corrected prompt
              // The actual re-call happens in the recovery loop
              return correctionPrompt;
            },
            (newOutput: string) => {
              // Re-validate the new output
              if (!this.scanner) return null;
              const reScan = this.scanner.scan(newOutput);
              if (reScan.passed) return null;
              return this.findingsToViolation(reScan.findings);
            },
          );

          if (result.recovered && result.finalOutput) {
            // Recovery path: re-call the model with correction prompt
            try {
              const recoveryRequest: ModelRequest = {
                ...enrichedRequest,
                messages: [
                  ...enrichedRequest.messages,
                  { role: "assistant", content: response.content },
                  { role: "user", content: result.finalOutput },
                ],
              };
              const recoveredResponse = await this.adapter.complete(recoveryRequest, this.config);

              // Re-scan the recovered output
              if (this.scanner) {
                const finalScan = this.scanner.scan(recoveredResponse.content);
                if (finalScan.passed) {
                  response = recoveredResponse;
                  recoverySucceeded = true;
                  trustDelta += 10;
                  scanFindings = [];
                }
              }
            } catch {
              // Recovery re-call failed, keep original response
            }
          }

          if (!recoverySucceeded) {
            trustDelta -= outputScan.findings.length * 10;
          }
        }
      }
    }

    // Step 7: Compute cost
    const cost = this.computeCost(response);

    // Step 8: Record to ledger
    this.logToLedger("model:call", {
      sessionId: this.sessionId,
      provider: this.config.provider,
      model: response.model,
      decision: "allow",
      usage: response.usage,
      cost,
      latencyMs: response.latencyMs,
      scanPassed: scanFindings.length === 0,
      scanFindings,
      recoveryAttempted,
      recoverySucceeded,
      promptOptimised,
      finishReason: response.finishReason,
    });

    // Step 9: OTEL telemetry
    if (this.telemetry) {
      this.telemetry.exportEntry({
        seq: 0,
        ts: new Date().toISOString(),
        hash: "",
        prev: "",
        type: "model:call",
        data: {
          sessionId: this.sessionId,
          provider: this.config.provider,
          model: response.model,
          decision: "allow",
          latencyMs: response.latencyMs,
        },
        tokens: {
          input: response.usage.inputTokens,
          output: response.usage.outputTokens,
          total: response.usage.totalTokens,
        },
        cost: {
          input_cost: cost.inputCost,
          output_cost: cost.outputCost,
          total_cost: cost.totalCost,
          currency: cost.currency,
        },
      });
    }

    trustDelta += 5; // Successful call reward

    // Step 10: Return governed response
    return {
      content: response.content,
      model: response.model,
      provider: this.config.provider,
      usage: response.usage,
      cost,
      governance: {
        sessionId: this.sessionId,
        scanPassed: scanFindings.length === 0,
        scanFindings,
        recoveryAttempted,
        recoverySucceeded,
        trustDelta,
        promptOptimised,
      },
      finishReason: response.finishReason,
      latencyMs: Date.now() - start,
    };
  }

  /**
   * Stream a governed model call. Validates chunks mid-stream.
   * Yields GovernedChunk objects. Aborts on hard violations.
   */
  async *stream(request: ModelRequest): AsyncGenerator<GovernedChunk, void, unknown> {
    // Step 1-3: Input scanning and prompt optimisation (same as call)
    const messages = [...request.messages];

    if (this.scanInput && this.scanner) {
      const inputContent = messages.map(m => m.content).join("\n");
      const inputScan = this.scanner.scan(inputContent);
      if (!inputScan.passed) {
        const hardFindings = inputScan.findings.filter(f => f.severity === "hard");
        if (hardFindings.length > 0) {
          yield {
            content: "",
            done: true,
            accumulated: "",
            index: 0,
            governance: {
              aborted: true,
              reason: `Input blocked: ${hardFindings.map(f => f.category).join(", ")}`,
            },
          };
          return;
        }
      }
    }

    if (this.optimisePrompts && this.optimizer) {
      const systemIdx = messages.findIndex(m => m.role === "system");
      if (systemIdx >= 0) {
        messages[systemIdx] = {
          ...messages[systemIdx],
          content: this.optimizer.injectGovernanceContext(messages[systemIdx].content),
        };
      } else {
        messages.unshift({
          role: "system",
          content: this.optimizer.injectGovernanceContext(""),
        });
      }
    }

    const enrichedRequest: ModelRequest = { ...request, messages };

    // Step 4: Stream from provider
    let accumulated = "";
    let index = 0;
    let aborted = false;

    try {
      for await (const chunk of this.adapter.stream(enrichedRequest, this.config)) {
        accumulated += chunk.content;
        index++;

        // Mid-stream scanning every 10 chunks
        if (this.scanOutput && this.scanner && index % 10 === 0) {
          const midScan = this.scanner.scan(accumulated);
          const hardFindings = midScan.findings.filter(f => f.severity === "hard");
          if (hardFindings.length > 0) {
            aborted = true;
            yield {
              content: "",
              done: true,
              accumulated,
              index,
              governance: {
                aborted: true,
                reason: `Stream aborted: ${hardFindings.map(f => f.category).join(", ")}`,
              },
            };

            this.logToLedger("stream:abort", {
              sessionId: this.sessionId,
              provider: this.config.provider,
              model: this.config.model,
              reason: "hard_violation_mid_stream",
              findings: hardFindings.map(f => `${f.scanner}:${f.category}`),
              chunksProcessed: index,
            });
            return;
          }
        }

        yield {
          content: chunk.content,
          done: chunk.done,
          accumulated,
          index,
        };

        if (chunk.done) break;
      }
    } catch (err) {
      yield {
        content: "",
        done: true,
        accumulated,
        index,
        governance: {
          aborted: true,
          reason: err instanceof Error ? err.message : String(err),
        },
      };
      return;
    }

    // Final output scan after stream completes
    if (!aborted && this.scanOutput && this.scanner) {
      const finalScan = this.scanner.scan(accumulated);
      if (!finalScan.passed) {
        const hardFindings = finalScan.findings.filter(f => f.severity === "hard");
        if (hardFindings.length > 0) {
          yield {
            content: "",
            done: true,
            accumulated,
            index: index + 1,
            governance: {
              aborted: true,
              reason: `Post-stream scan failed: ${hardFindings.map(f => f.category).join(", ")}`,
            },
          };
          return;
        }
      }
    }

    // Record to ledger
    this.logToLedger("model:call", {
      sessionId: this.sessionId,
      provider: this.config.provider,
      model: this.config.model,
      decision: "allow",
      streaming: true,
      chunksProcessed: index,
      contentLength: accumulated.length,
    });
  }

  /**
   * Get the current provider adapter.
   */
  getAdapter(): ProviderAdapter {
    return this.adapter;
  }

  /**
   * Get the session ID.
   */
  getSessionId(): string {
    return this.sessionId;
  }

  // ── Private Helpers ──────────────────────────────────────────────

  private computeCost(response: ModelResponse): GovernedModelResponse["cost"] {
    if (!this.costTracking) {
      return { inputCost: 0, outputCost: 0, totalCost: 0, currency: "USD" };
    }

    const tracking = this.policy.tracking;
    const currency = tracking?.currency ?? "USD";

    // Check policy-level provider costs
    const gwConfig = this.policy.model_gateway;
    const providerCosts = gwConfig?.providers?.[this.config.provider];

    const inputRate = providerCosts?.cost_per_million_input
      ?? tracking?.cost_per_million_input
      ?? 0;
    const outputRate = providerCosts?.cost_per_million_output
      ?? tracking?.cost_per_million_output
      ?? 0;

    const inputCost = (response.usage.inputTokens / 1_000_000) * inputRate;
    const outputCost = (response.usage.outputTokens / 1_000_000) * outputRate;

    return {
      inputCost: Math.round(inputCost * 1_000_000) / 1_000_000,
      outputCost: Math.round(outputCost * 1_000_000) / 1_000_000,
      totalCost: Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000,
      currency,
    };
  }

  private findingsToViolation(findings: Finding[]): Violation {
    const first = findings[0];
    return {
      rule: first?.scanner ?? "scanner",
      severity: first?.severity ?? "soft",
      source: "scanner",
      details: findings.map(f => `${f.scanner}: ${f.match} (${f.category})`).join("; "),
    };
  }

  private logToLedger(type: string, data: Record<string, unknown>): void {
    if (!this.ledger) return;
    try {
      this.ledger.append(type as "model:call", data);
    } catch {
      // Ledger write failure should not break model calls
    }
  }
}
