// @PAD: p0-v275-h24-h25-h26-model-gateway-v1
// @GCDE: document_sha256=p0-v275-h24-h26-gateway
// AEP 2.75 - Governed Model Gateway
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
import type { Policy } from "../../policy-engine/lib/policy/types.js";
import type { EvidenceLedger } from "../../evidence-ledger/lib/ledger/ledger.js";
import type { ScannerPipeline } from "../../scanners/lib/pipeline.js";
import type { RecoveryEngine } from "../../recovery/lib/engine.js";
import type { PromptOptimizer } from "../../optimization/lib/optimizer.js";
import type { AEPTelemetryExporter } from "../../telemetry/lib/otel-exporter.js";
import type { Violation } from "../../recovery/lib/types.js";
import type { Finding, ScanResult } from "../../scanners/lib/types.js";

function collectHardFindings(scan: { findings?: Finding[] } | null | undefined): Finding[] {
  return (scan?.findings ?? []).filter((f) => f.severity === "hard");
}
function uniqueCategories(findings: Finding[]): string[] {
  const out: string[] = [];
  for (const f of findings) {
    if (f.category && !out.includes(f.category)) out.push(f.category);
  }
  return out;
}
import {
  EconomicsGatewayHooks,
  type EconomicsGatewayDeps,
} from "../../economics/lib/gateway-integration.js";

export interface GatewayDependencies {
  policy: Policy;
  ledger?: EvidenceLedger;
  scanner?: ScannerPipeline;
  recovery?: RecoveryEngine;
  optimizer?: PromptOptimizer;
  telemetry?: AEPTelemetryExporter;
  registry?: ProviderRegistry;
  economics?: EconomicsGatewayDeps;
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
  private economics: EconomicsGatewayHooks | null;

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
    this.economics = deps.economics ? new EconomicsGatewayHooks(deps.economics) : null;
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
    let economicsPrecheck: Awaited<ReturnType<EconomicsGatewayHooks["preDispatch"]>> | undefined;

    if (this.economics) {
      economicsPrecheck = await this.economics.preDispatch(request, this.config);
    }

    let economicsRecorded = false;
    const releaseEconomicsOnError = (err: unknown) => {
      if (!economicsRecorded && this.economics) {
        this.economics.recordFailure(this.config, err);
        economicsRecorded = true;
      }
    };

    try {
    // Step 1: Validate request structure
    const messages = [...request.messages];

    // MEDIUM: scanInput/scanOutput required without a scanner => fail closed
    if (this.scanInput && !this.scanner) {
      const err = new Error(
        "GovernedModelGateway: scanInput enabled but scanner dependency is missing (fail-closed)",
      );
      releaseEconomicsOnError(err);
      throw err;
    }
    if (this.scanOutput && !this.scanner) {
      const err = new Error(
        "GovernedModelGateway: scanOutput enabled but scanner dependency is missing (fail-closed)",
      );
      releaseEconomicsOnError(err);
      throw err;
    }

    // Step 2: Scan input messages
    if (this.scanInput && this.scanner) {
      const inputContent = messages.map(m => m.content).join("\n");
      const inputScan = this.scanner.scan(inputContent);
      if (!inputScan.passed) {
        const hardFindings = collectHardFindings(inputScan);
        if (hardFindings.length > 0) {
          const err = new Error(
            `Input blocked by scanner: ${hardFindings.map(f => f.category).join(", ")}`
          );
          releaseEconomicsOnError(err);
          this.logToLedger("model:call", {
            provider: this.config.provider,
            model: this.config.model,
            decision: "deny",
            reason: "input_scan_hard_violation",
            findings: hardFindings.map(f => `${f.scanner}:${f.category}`),
          });
          throw err;
        }
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
      releaseEconomicsOnError(err);
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

        const hardFindings = collectHardFindings(outputScan);
        if (hardFindings.length > 0) {
          // Hard violation in output - deny
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
          const outErr = new Error(
            `Output blocked by scanner: ${hardFindings.map(f => f.category).join(", ")}`
          );
          releaseEconomicsOnError(outErr);
          throw outErr;
        }

        // Step 6: Soft violations - attempt recovery
        if (this.recovery) {
          recoveryAttempted = true;
          const softViolation = this.findingsToViolation(outputScan.findings);

          const result = this.recovery.attemptRecovery(
            softViolation,
            (correctionPrompt: string) => {
              // H-24: correction prompt is not model output
              void correctionPrompt;
              return "";
            },
            (newOutput: string) => {
              // Re-validate the new output
              if (!this.scanner) return null;
              const reScan = this.scanner.scan(newOutput);
              if (reScan.passed) return null;
              return this.findingsToViolation(reScan.findings);
            },
          );

          // H-24: re-call with buildCorrectionPrompt (never treat prompt as finalOutput)
          {
            const correctionPrompt = this.recovery.buildCorrectionPrompt(softViolation);
            try {
              const recoveryRequest: ModelRequest = {
                ...enrichedRequest,
                messages: [
                  ...enrichedRequest.messages,
                  { role: "assistant", content: response.content },
                  { role: "user", content: correctionPrompt },
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

          // M-18: soft penalty only once when recovery fails (not doubled with hard path)
          if (!recoverySucceeded && trustDelta >= 0) {
            trustDelta -= outputScan.findings.length * 10;
          }
        }
      }
    }

    // Step 7: Compute cost
    const cost = this.computeCost(response);
    if (this.economics) {
      this.economics.recordSuccess(response, this.config);
      economicsRecorded = true;
    }

    // Step 8: Record to ledger
    // M-19: soft-fail without recovery is deny, not allow
    const softDenied = scanFindings.length > 0 && !recoverySucceeded;
    this.logToLedger("model:call", {
      sessionId: this.sessionId,
      provider: this.config.provider,
      model: response.model,
      decision: softDenied ? "deny" : "allow",
      usage: response.usage,
      cost,
      latencyMs: response.latencyMs,
      scanPassed: scanFindings.length === 0,
      scanFindings,
      recoveryAttempted,
      recoverySucceeded,
      promptOptimised,
      finishReason: response.finishReason,
      economicsPrecheck: economicsPrecheck
        ? {
            budgetWarning: economicsPrecheck.budgetWarning ?? false,
            estimatedMicroUsd: economicsPrecheck.estimate
              ? economicsPrecheck.estimate.estimated_prompt_micro_usd +
                (economicsPrecheck.estimate.estimated_completion_micro_usd ?? 0)
              : undefined,
          }
        : undefined,
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
          decision: softDenied ? "deny" : "allow",
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

    // Step 10: Return governed response (soft deny redacts content)
    if (softDenied) {
      return {
        content: "",
        model: response.model,
        provider: this.config.provider,
        usage: response.usage,
        cost,
        governance: {
          sessionId: this.sessionId,
          scanPassed: false,
          scanFindings,
          recoveryAttempted,
          recoverySucceeded,
          trustDelta,
          promptOptimised,
          aborted: true,
          softDenied: true,
        },
        finishReason: "content_filter",
        latencyMs: response.latencyMs ?? (Date.now() - start),
      };
    }
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
      // H-25: keep provider latency when present
      latencyMs: response.latencyMs ?? (Date.now() - start),
    };
    } catch (err) {
      releaseEconomicsOnError(err);
      throw err;
    }
  }

  /**
   * Stream a governed model call. Validates chunks mid-stream.
   * Yields GovernedChunk objects. Collects every hard finding on the accumulated stream then refuses the yield.
   */
  async *stream(request: ModelRequest): AsyncGenerator<GovernedChunk, void, unknown> {
    // TM-13: parity with call() - economics + scanner fail-closed + per-chunk scan before yield
    let economicsRecorded = false;
    const releaseEconomicsOnError = (err: unknown) => {
      if (!economicsRecorded && this.economics) {
        this.economics.recordFailure(this.config, err);
        economicsRecorded = true;
      }
    };

    if (this.economics) {
      try {
        await this.economics.preDispatch(request, this.config);
      } catch (err) {
        releaseEconomicsOnError(err);
        yield {
          content: "",
          done: true,
          accumulated: "",
          index: 0,
          governance: {
            aborted: true,
            reason: err instanceof Error ? err.message : String(err),
          },
        };
        return;
      }
    }

    if (this.scanInput && !this.scanner) {
      const err = new Error(
        "GovernedModelGateway.stream: scanInput enabled but scanner dependency is missing (fail-closed)",
      );
      releaseEconomicsOnError(err);
      throw err;
    }
    if (this.scanOutput && !this.scanner) {
      const err = new Error(
        "GovernedModelGateway.stream: scanOutput enabled but scanner dependency is missing (fail-closed)",
      );
      releaseEconomicsOnError(err);
      throw err;
    }

    const messages = [...request.messages];

    if (this.scanInput && this.scanner) {
      const inputContent = messages.map(m => m.content).join("\n");
      const inputScan = this.scanner.scan(inputContent);
      if (!inputScan.passed) {
        const hardFindings = collectHardFindings(inputScan);
        if (hardFindings.length > 0) {
          yield {
            content: "",
            done: true,
            accumulated: "",
            index: 0,
            governance: {
              aborted: true,
              reason: `Input blocked: ${uniqueCategories(hardFindings).join(", ")}`,
              findings: hardFindings.map(f => `${f.scanner}:${f.category}`),
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

    let accumulated = "";
    let index = 0;
    let aborted = false;

    try {
      for await (const chunk of this.adapter.stream(enrichedRequest, this.config)) {
        accumulated += chunk.content;
        index++;

        // Scan accumulated output BEFORE yielding each chunk (fail closed).
        if (this.scanOutput && this.scanner) {
          const midScan = this.scanner.scan(accumulated);
          const hardFindings = collectHardFindings(midScan);
          if (hardFindings.length > 0) {
            aborted = true;
            yield {
              content: "",
              done: true,
              accumulated: "",
              index,
              governance: {
                aborted: true,
                reason: `Stream aborted: ${uniqueCategories(hardFindings).join(", ")}`,
                findings: hardFindings.map(f => `${f.scanner}:${f.category}`),
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
      releaseEconomicsOnError(err);
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
        const hardFindings = collectHardFindings(finalScan);
        const softFindings = finalScan.findings.filter(f => f.severity === "soft");
        if (hardFindings.length > 0 || softFindings.length > 0) {
          const findings = hardFindings.length > 0 ? hardFindings : softFindings;
          yield {
            content: "",
            done: true,
            accumulated: "",
            index: index + 1,
            governance: {
              aborted: true,
              softDenied: softFindings.length > 0 && hardFindings.length === 0,
              reason: `Post-stream scan failed: ${uniqueCategories(findings).join(", ")}`,
              findings: findings.map(f => `${f.scanner}:${f.category}`),
            },
          };
          this.logToLedger("model:call", {
            sessionId: this.sessionId,
            provider: this.config.provider,
            model: this.config.model,
            findings: findings.map(f => `${f.scanner}:${f.category}`),
            decision: "deny",
            streaming: true,
            chunksProcessed: index,
            contentLength: 0,
          });
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

  // -- Private Helpers ----------------------------------------------

  private computeCost(response: ModelResponse): GovernedModelResponse["cost"] {
    if (!this.costTracking) {
      return { inputCost: 0, outputCost: 0, totalCost: 0, currency: "USD" };
    }

    const tracking = this.policy.tracking;
    const currency = tracking?.currency ?? "USD";

    const catalog = this.economics?.getPriceCatalog();
    const priceEntry = catalog?.lookup(this.config.provider, response.model);
    if (priceEntry) {
      const inputCost =
        (response.usage.inputTokens / 1_000_000) * priceEntry.price.prompt;
      const outputCost =
        (response.usage.outputTokens / 1_000_000) * priceEntry.price.completion;
      return {
        inputCost: Math.round(inputCost * 1_000_000) / 1_000_000,
        outputCost: Math.round(outputCost * 1_000_000) / 1_000_000,
        totalCost: Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000,
        currency,
      };
    }

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
    const hard = collectHardFindings({ findings });
    const use = hard.length > 0 ? hard : findings;
    const cats = uniqueCategories(use);
    return {
      rule: cats.join(", ") || (use[0]?.scanner ?? "scanner"),
      severity: (hard.length > 0 ? "hard" : use[0]?.severity) ?? "soft",
      source: "scanner",
      details: use.map(f => `${f.scanner}: ${f.match} (${f.category})`).join("; "),
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
