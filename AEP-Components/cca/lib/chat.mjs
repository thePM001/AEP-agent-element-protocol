#!/usr/bin/env node

import {
  resolveInferenceConfig,
  getInferencePublicState,
  providerNeedsApiKey,
} from "./setup/inference.mjs";
import { latticeGatedFetch } from "../../lattice-channels/lib/lattice-transport.mjs";
import { defaultPaths } from "../../wizard/lib/paths.mjs";
import { buildRegistryContext } from "./registry-context.mjs";
import { buildCcaSystemPrompt } from "./cca-prompt.mjs";
import { generatePlanFromIntent, extractPlanFromLlmReply } from "./plan-generator.mjs";
import { validatePlanAgainstRegistry } from "./plan-schema.mjs";
import { planToGraph } from "./plan-to-graph.mjs";
import {
  epscomEnforceWritingValue,
  EPSCOM_WRITING_RULES,
} from "../../lattice-channels/lib/lattice-transport.mjs";
import { assertCcaChatWritingDraft } from "../../../AEP-Composer-Lite/lib/hyperlattice/cca-writing-validator.mjs";
import {
  releaseCcaTextToChatBox,
  validateCcaTopologyViaHyperlattice,
} from "../../../AEP-Composer-Lite/lib/hyperlattice/cca-governed-release.mjs";
import { ensureCcaTaskManifest } from "../../../AEP-Composer-Lite/lib/ensure-cca-task-manifest.mjs";

const DEFAULT_WRITING_RETRY_MAX = 8;

function resolveWritingRetryMax(env = process.env) {
  const n = Number(env.CCA_WRITING_RETRY_MAX ?? DEFAULT_WRITING_RETRY_MAX);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_WRITING_RETRY_MAX;
  return Math.min(Math.floor(n), 16);
}

function formatViolationFeedback(violations = []) {
  if (!violations.length) return "- release_blocked: output failed EPSCOM writing.gap";
  const seen = new Set();
  return violations
    .filter((v) => {
      const key = `${v.rule}:${v.line ?? 0}:${v.message ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((v) => `- ${v.rule}: ${v.message}${v.line ? ` (line ${v.line})` : ""}`)
    .join("\n");
}

const WRITING_MODE_RULE_FIXES = {
  space_before_spaced_signs:
    'Add one space BEFORE ? ! [ ] ( ) after the word. Write "building ?" and "Hello [ hola ]" not "building?" or "Hello[hola]".',
  spaced_sign_word_space:
    'Add one space AFTER ? ! [ ] ( ) before the next word or bracket content. Write "ready ? I" and "[ hola ]" not "ready ?I" or "[hola]".',
  punctuation_word_space:
    'Add one space AFTER ? ! [ ] ( ) before the next word or bracket content. Write "ready ? I" not "ready ?I".',
  attach_comma_semicolon:
    'Attach comma and semicolon directly to the preceding word. Write "foo, bar" not "foo , bar".',
  attach_double_colon:
    'Attach double colon directly. Write "word::field" not "word ::field".',
  cca_writing_help_symbol_refs:
    "Name each discussed sign with backtick refs: `?` `!` `[` `]` `(` `)`.",
  cca_no_instruction_echo:
    "Do not repeat prompt instructions. Explain the rule in natural prose only.",
  cca_declarative_closing:
    'End with declarative prose ("Tell me what you would like to do.") never a closing question.',
  no_oxford_comma: 'Remove the Oxford comma. Write "foo, bar and baz" not "foo, bar, and baz".',
  no_em_dashes: "Remove em-dashes. Rewrite with a hyphen or short sentences.",
  no_en_dashes: "Remove en-dashes. Use a plain hyphen or rewrite.",
  no_double_hyphen: 'Remove double-hyphen separators. Use a hyphen or rewrite.',
};

/** Per-violation EPSCOM writing mode fix instructions sent to the LLM on retry. */
export function formatWritingModeViolationCorrections(violations = [], opts = {}) {
  const lines = [
    "HOW TO WRITE CORRECTLY (EPSCOM writing mode - apply on this retry):",
    "- Put one space BEFORE ? ! [ ] ( ) and one space AFTER them before the next word or bracket content.",
    "- Commas, semicolons and :: are exceptions: attach directly (foo, bar not foo , bar).",
    '- Translations: "Hello [ hola ]."',
    '- Models: "Are you ready ? I am here." "Great ! Let me help." "Hello [ hola ]."',
  ];
  const seen = new Set();
  for (const v of violations) {
    const rule = v?.rule;
    if (!rule || seen.has(rule)) continue;
    seen.add(rule);
    const fix = WRITING_MODE_RULE_FIXES[rule];
    if (fix) lines.push(`- Fix ${rule}: ${fix}`);
  }
  if (opts.isWritingHelp && opts.userMessage) {
    lines.push(
      "- Answer the user's writing-mode question. Teach the rule. If their message is already compliant, say so.",
    );
    lines.push(`- Compliant reference reply (rewrite in your own words, must pass validation): ${buildCcaPunctuationHelpReply(opts.userMessage)}`);
  }
  return lines.join("\n");
}

export function buildWritingRetryUserMessage(draft, violations, opts = {}) {
  const { isPlanMode = false, isWritingHelp = false, userMessage = "" } = opts;
  const modeRules = isPlanMode
    ? "Keep the ImplementationPlan JSON block intact and valid. Fix violations only in human-readable prose outside the JSON fence."
    : "Plain conversational prose only. No JSON blocks.";
  return [
    "HYPERLATTICE REJECTED your previous CCA output. EPSCOM writing.gap validation failed.",
    "",
    formatWritingModeViolationCorrections(violations, { isWritingHelp, userMessage }),
    "",
    "Violations detected:",
    formatViolationFeedback(violations),
    "",
    modeRules,
    "End with declarative prose (Tell me what you would like to do.) never a closing question (What would you like to do?).",
    "",
    EPSCOM_WRITING_RULES,
    "",
    "Rejected draft:",
    draft,
    "",
    "Respond with ONLY the corrected full reply that passes every rule above.",
  ].join("\n");
}

function blockedCcaResult({
  mode,
  error,
  writingRetries = 0,
  writingRetryMax = DEFAULT_WRITING_RETRY_MAX,
  writingValidation = null,
  hyperlatticeValidation = null,
  provider = null,
  model = null,
  writingCorrectionGuide = null,
  isWritingHelp = false,
  userMessage = "",
}) {
  const violations = writingValidation?.violations ?? [{ rule: "release_blocked", message: error }];
  const correctionGuide =
    writingCorrectionGuide
    ?? formatWritingModeViolationCorrections(violations, { isWritingHelp, userMessage });
  return {
    ok: false,
    mode,
    error,
    reply: null,
    writing_retries: writingRetries,
    writing_correction_guide: correctionGuide,
    writing_validation: writingValidation ?? {
      ok: false,
      authority: "epscom-core",
      violations,
    },
    hyperlattice_validation: hyperlatticeValidation ?? {
      ok: false,
      topology: "hyperlattice",
      agent_id: "cca",
      governed_by: ["writing.gap", "epscom-core", "validation_engine_dock"],
      error,
      dock_audit_ok: false,
    },
    provider,
    model,
  };
}

const DEPLOYMENT_INTENT_RE =
  /\b(deploy|deployment|architect|architecture|implementation\s*plan|generate\s+(a\s+)?plan|build\s+(a\s+)?(system|stack|setup)|setup\s+agent|enable\s+component|add\s+component|configure\s+(aep|stack|system)|topology|compliance\s+stack|lrp|eu-ai-act|hipaa|soc2|nist-ai-rmf)\b/i;

const GREETING_RE =
  /^(hi|hello|hey|yo|howdy|greetings|good\s+(morning|afternoon|evening)|cca[,!\s]|are\s+you\s+there|you\s+there|anyone\s+there|test|ping)[\s!?.]*$/i;

/** Casual hello even with extra banter (must not trigger full plan generation). */
const GREETING_PREFIX_RE =
  /^(hi|hello|hey|yo|howdy|greetings|good\s+(morning|afternoon|evening)|cca)\b/i;

const CASUAL_READY_RE =
  /\b(are\s+you\s+(here|there|ready)|ready\s+for\s+building|ready\s+to\s+build|here\??|ping)\b/i;

/** Questions about rules, punctuation, or how things work — chat, not deployment plan. */
const CHAT_QUESTION_RE =
  /\b(how do (you|i|we) write|how (to|do i) write|what (is|are)|explain|tell me (about|how)|describe|correctly|punctuation|writing\.gap|epscom|em[\s-]?dash|oxford comma|exclamation|question mark|!\s*and\s*\?)\b/i;

export function classifyCcaMessage(message) {
  const text = String(message ?? "").trim();
  if (!text) return "chat";
  if (DEPLOYMENT_INTENT_RE.test(text)) return "plan";
  if (CHAT_QUESTION_RE.test(text) && !/\b(deploy|generate\s+(a\s+)?plan|implementation\s*plan|add\s+component|enable\s+component)\b/i.test(text)) {
    return "chat";
  }
  if (text.length <= 80 && GREETING_RE.test(text)) return "chat";
  if (
    text.length <= 200
    && GREETING_PREFIX_RE.test(text)
    && CASUAL_READY_RE.test(text)
    && !/\b(add|enable|deploy|configure|postgres|compliance|lrp|topology)\b/i.test(text)
  ) {
    return "chat";
  }
  if (text.length <= 48 && !DEPLOYMENT_INTENT_RE.test(text) && !/\b(node|component|policy|deploy)\b/i.test(text)) {
    return "chat";
  }
  return "plan";
}

/** True when the user is saying hello or ping, not asking for canvas audit or a plan. */
export function isCcaGreetingMessage(message) {
  const text = String(message ?? "").trim();
  if (!text || classifyCcaMessage(text) !== "chat") return false;
  if (DEPLOYMENT_INTENT_RE.test(text)) return false;
  if (GREETING_RE.test(text)) return true;
  if (
    text.length <= 200
    && GREETING_PREFIX_RE.test(text)
    && (CASUAL_READY_RE.test(text) || text.length <= 96)
    && !/\b(add|enable|deploy|configure|postgres|compliance|lrp|topology|what is|how do|explain|show me|describe|list)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  if (
    text.length <= 48
    && !/\b(node|component|policy|deploy|what|how|why|explain|canvas|graph)\b/i.test(text)
  ) {
    return true;
  }
  return false;
}

function formatChatGraphContext(graph, { greeting = false } = {}) {
  if (!graph) return "";
  if (greeting) {
    const nodes = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
    const edges = Array.isArray(graph.edges) ? graph.edges.length : 0;
    return `Canvas snapshot (${nodes} nodes, ${edges} edges). Internal context only: do not inventory or summarize the canvas in a greeting reply.\n\n`;
  }
  return `Current canvas graph:\n${JSON.stringify(graph, null, 2)}\n\n`;
}

const GREETING_RESPONSE_HINT =
  "\n\nThis is a casual greeting. Reply in one or two short sentences only. Be warm and ready. Use your own wording, not a canned script. Do not list or summarize canvas nodes, the lattice hub, docks, agents, UCB or storage. Do not use plan-mode phrases like \"governed for secure building\". Do not echo or repeat the user's slang or joke phrases. End with a brief declarative invite to continue.";

/** Detect EPSCOM spacing issues in the user's message (for writing-help context only). */
export function detectUserPunctuationIssues(message) {
  const text = String(message ?? "");
  const issues = [];
  if (/[A-Za-z0-9][?!\[\]\(\)]/.test(text)) {
    issues.push("missing space before ? ! [ ] ( )");
  }
  for (let i = 0; i < text.length - 1; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if ("?![]()".includes(ch) && /[A-Za-z0-9]/.test(next)) {
      issues.push("missing space after a sign before the next word");
      break;
    }
  }
  if (/\s[,;]/.test(text)) {
    issues.push("space before comma or semicolon");
  }
  if (/\s::/.test(text)) {
    issues.push("space before double colon");
  }
  return issues;
}

export function formatUserPunctuationIssueNote(message) {
  const issues = detectUserPunctuationIssues(message);
  if (!issues.length) return "";
  return `\n\n[User message spacing issues: ${issues.join("; ")}.]`;
}

/** User asked how to write ? ! [ ] ( ) spacing (EPSCOM writing mode). */
export function isCcaPunctuationSignQuestion(message) {
  return /[?!\[\]\(\)]|question mark|exclamation|bracket|parenthes/i.test(String(message ?? ""));
}

/**
 * Deterministic EPSCOM punctuation help. No LLM: governed text built from rules,
 * then released only through hyperlattice + kernel validation.
 */
export function buildCcaPunctuationHelpReply(message) {
  const issues = detectUserPunctuationIssues(message);
  const issuePart = issues.includes("missing space before ? ! [ ] ( )")
    ? "Your message was missing a space before a sign. "
    : issues.includes("missing space after a sign before the next word")
      ? "Your message was missing a space after a sign before the next word. "
      : issues.length
        ? ""
        : "Your sign spacing in that message already matches EPSCOM writing mode. ";
  return [
    "EPSCOM writing mode puts a single space before `?` `!` `[` `]` `(` `)` and after them before the next word or bracket content.",
    "Commas, semicolons and double colons (`::`) are exceptions: attach them directly to the preceding word with no space before.",
    "Translations go in brackets with spaces: \"Hello [ hola ].\"",
    issuePart.trim(),
    'Models: "Are you ready ? I am here." "Great ! Let me help." and "Hello [ hola ]."',
    "Tell me what you would like to do.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function isCcaWritingHelpMessage(message) {
  const text = String(message ?? "").trim();
  if (!text || classifyCcaMessage(text) !== "chat") return false;
  return CHAT_QUESTION_RE.test(text);
}

function providerExtraHeaders(provider) {
  if (provider === "openrouter") {
    return {
      "HTTP-Referer": process.env.AEP_OPENROUTER_REFERRER || "https://composer-lite.aep",
      "X-Title": process.env.AEP_OPENROUTER_TITLE || "AEP Composer Lite CCA",
    };
  }
  return {};
}

async function chatOpenAiCompatible({ baseUrl, apiKey, model, messages, socketBase, provider }) {
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const headers = {
    "Content-Type": "application/json",
    ...providerExtraHeaders(provider),
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const init = {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages, temperature: 0.3 }),
  };

  let res;
  try {
    res = await latticeGatedFetch(
      socketBase,
      {
        agentId: "cca",
        channelId: "ch-cca-inference",
        gateway: "llm",
        eventType: "CCA_INFERENCE_REQUEST",
      },
      url,
      init,
    );
  } catch {
    res = await fetch(url, init);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM request failed (${res.status}): ${text.slice(0, 400)}`);
  }
  const body = await res.json();
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty response");
  return content;
}

export function extractGraphSuggestion(text) {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (parsed?.plan_version === "1") {
      return planToGraph(parsed);
    }
    if (parsed && (Array.isArray(parsed.nodes) || Array.isArray(parsed.edges))) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

export async function getCcaPublicState(dataDir, env = process.env) {
  const inference = getInferencePublicState(dataDir);
  const context = await buildRegistryContext(dataDir, env);
  return {
    enabled: true,
    name: "CCA",
    description: "Central Setup Agent: environment probe, registry knowledge, implementation planning",
    inference,
    providers_supported: ["openrouter", "deepseek", "llama_cpp", "anthropic", "custom", "rule-based"],
    environment: context.environment,
    component_count: context.components.length,
    installed_count: context.components.filter((c) => c.installed).length,
    gap_policies: context.gap?.reference_policies?.length ?? 0,
    active_plan: null,
  };
}

/**
 * @param {string} dataDir
 * @param {{ message: string, graph?: object, history?: object[], useLlm?: boolean }} opts
 */
function formatLiteContext(liteContext, attachments = []) {
  const ctx = liteContext && typeof liteContext === "object" ? liteContext : {};
  const parts = [];
  if (ctx.surface) parts.push(`Composer surface: ${ctx.surface}`);
  if (ctx.mode) parts.push(`Canvas mode: ${ctx.mode}`);
  if (ctx.selectedNode) {
    parts.push(`Selected node:\n${JSON.stringify(ctx.selectedNode, null, 2)}`);
  } else if (ctx.selectedEdge) {
    parts.push(`Selected edge:\n${JSON.stringify(ctx.selectedEdge, null, 2)}`);
  } else {
    parts.push("No canvas selection.");
  }
  if (ctx.policyStage) {
    parts.push(`Policy panel stage: ${ctx.policyStage}`);
  }
  if (attachments.length) {
    parts.push(
      `Uploaded files: ${attachments.map((a) => `${a.name} (id=${a.id || a.file_id})`).join(", ")}`,
    );
  }
  return parts.length ? `${parts.join("\n")}\n\n` : "";
}

export async function runCcaChat(
  dataDir,
  {
    message,
    graph = null,
    history = [],
    context: liteContext = null,
    attachments = [],
    useLlm = true,
    lattice = null,
  },
) {
  if (!message?.trim()) throw new Error("message is required");

  const env = { ...process.env };
  ensureCcaTaskManifest(dataDir);
  const context = await buildRegistryContext(dataDir, env);
  const mode = classifyCcaMessage(message.trim());
  const isPlanMode = mode === "plan";
  const isGreeting = !isPlanMode && isCcaGreetingMessage(message.trim());
  const isWritingHelp = !isPlanMode && isCcaWritingHelpMessage(message.trim());
  let reply;
  let plan = null;
  let usedLlm = false;
  let writingRetries = 0;
  let writingValidation = { ok: true, authority: "epscom-core", violations: [] };
  let hyperlatticeValidation = null;
  const writingRetryMax = resolveWritingRetryMax(env);

  const inference = resolveInferenceConfig(env, dataDir);
  const apiKey = inference.api_key_env ? env[inference.api_key_env] : null;
  const canUseLlm = useLlm && (!providerNeedsApiKey(inference.provider) || apiKey);
  const latticeOpts = { ...(lattice ?? {}), env };
  const paths = defaultPaths();
  const writingDraftOpts = {
    ccaChat: !isPlanMode,
    greeting: isGreeting,
    writingHelp: isWritingHelp,
    userMessage: message.trim(),
    latticeLogBin: latticeOpts.latticeLogBin ?? paths.latticeLogBin,
    configPath: latticeOpts.configPath ?? paths.configPath,
  };

  if (canUseLlm) {
    try {
      const systemPrompt = buildCcaSystemPrompt(context, {
        lite: true,
        mode,
        greeting: isGreeting,
        writingHelp: isWritingHelp,
      });
      const minimalCtx = isGreeting || isWritingHelp;
      const graphCtx = formatChatGraphContext(graph, { greeting: minimalCtx });
      const selectionCtx = minimalCtx ? "" : formatLiteContext(liteContext, attachments);
      const userSuffix = isPlanMode
        ? "User deployment request: "
        : "User message: ";
      const punctNote = isWritingHelp ? formatUserPunctuationIssueNote(message.trim()) : "";

      const messages = [
        { role: "system", content: systemPrompt },
        ...history.slice(-6).map((h) => ({
          role: h.role === "assistant" ? "assistant" : "user",
          content: String(h.content ?? ""),
        })),
        {
          role: "user",
          content: `${graphCtx}${selectionCtx}${userSuffix}${message.trim()}${punctNote}`,
        },
      ];
      for (let attempt = 0; attempt <= writingRetryMax; attempt += 1) {
        reply = await chatOpenAiCompatible({
          baseUrl: inference.base_url,
          apiKey,
          model: inference.model,
          messages,
          socketBase: paths.socketBase,
          provider: inference.provider,
        });
        usedLlm = true;
        if (attempt > 0) writingRetries = attempt;

        try {
          assertCcaChatWritingDraft(reply, writingDraftOpts);
          break;
        } catch (err) {
          if (attempt >= writingRetryMax) {
            const violations = err.violations ?? [{ rule: "release_blocked", message: err.message }];
            const correctionGuide = formatWritingModeViolationCorrections(violations, {
              isWritingHelp,
              userMessage: message.trim(),
            });
            return blockedCcaResult({
              mode,
              error: `${err.message} (exhausted ${writingRetryMax} LLM retries)\n\n${correctionGuide}`,
              writingRetries,
              writingRetryMax,
              writingCorrectionGuide: correctionGuide,
              isWritingHelp,
              userMessage: message.trim(),
              writingValidation: {
                ok: false,
                authority: "epscom-core",
                violations,
              },
              hyperlatticeValidation: {
                ok: false,
                topology: "hyperlattice",
                agent_id: "cca",
                governed_by: ["writing.gap", "epscom-core"],
                error: err.message,
                dock_audit_ok: false,
              },
              provider: inference.provider,
              model: inference.model,
            });
          }
          messages.push({ role: "assistant", content: reply });
          messages.push({
            role: "user",
            content: buildWritingRetryUserMessage(reply, err.violations, {
              isPlanMode,
              isWritingHelp,
              userMessage: message.trim(),
            }),
          });
        }
      }

      if (isPlanMode) {
        const llmPlan = extractPlanFromLlmReply(reply);
        if (llmPlan) {
          const v = validatePlanAgainstRegistry(llmPlan, context.components, context.environment);
          if (v.valid) {
            plan = llmPlan;
          }
        }
      }
    } catch (err) {
      if (
        err.hyperlattice_validation
        || err.violations?.length
        || /fail-closed|hyperlattice dock/i.test(String(err.message ?? ""))
      ) {
        return blockedCcaResult({
          mode,
          error: err.message,
          writingRetries,
          writingRetryMax,
          isWritingHelp,
          userMessage: message.trim(),
          writingValidation: err.writing_validation,
          hyperlatticeValidation: err.hyperlattice_validation,
          provider: inference.provider,
          model: inference.model,
        });
      }
      if (isPlanMode) {
        const ruleBased = await generatePlanFromIntent(message.trim(), dataDir, env);
        plan = ruleBased.plan;
        reply = `Could not reach the LLM (${err.message}). Showing a rule-based draft instead.\n\n${summarizePlan(plan, { includeJson: false })}`;
      } else {
        reply = `I could not reach the LLM right now (${err.message}). Check Settings → CCA / LLM Inference and confirm your API key is saved.`;
      }
    }
  }

  if (isPlanMode && !plan) {
    const ruleBased = await generatePlanFromIntent(message.trim(), dataDir, env);
    plan = ruleBased.plan;
    if (!reply) {
      reply = summarizePlan(plan, { includeJson: !usedLlm });
    }
  }

  if (!reply) {
    reply = isPlanMode
      ? summarizePlan(plan, { includeJson: true })
      : "Hello. I am CCA. Ask me about the canvas, policies, or describe a deployment and I will generate a plan.";
  }

  if (plan) {
    plan = epscomEnforceWritingValue(plan);
  }

  if (!reply?.trim()) {
    return blockedCcaResult({
      mode,
      error: "CCA output blocked: empty reply after inference (fail-closed)",
      writingRetries,
      writingRetryMax,
      provider: usedLlm ? inference.provider : isPlanMode ? "rule-based" : "none",
      model: usedLlm ? inference.model : isPlanMode ? "cca-rules-v1" : null,
    });
  }

  const replyProvider = usedLlm
    ? inference.provider
    : isPlanMode
      ? "rule-based"
      : "none";
  const replyModel = usedLlm
    ? inference.model
    : isPlanMode
      ? "cca-rules-v1"
      : null;

  try {
    const released = await releaseCcaTextToChatBox(reply, {
      ...latticeOpts,
      mode,
      ccaChat: !isPlanMode,
      greeting: isGreeting,
      writingHelp: isWritingHelp,
      sessionId: "cca-chat-release",
      inferenceMessage: message.trim(),
      provider: replyProvider,
      model: replyModel,
      recordInference: true,
    });
    reply = released.text;
    writingValidation = released.writing_validation;
    hyperlatticeValidation = {
      ...released.hyperlattice_validation,
      writing_retries: writingRetries,
      writing_retry_max: writingRetryMax,
    };
  } catch (err) {
    return blockedCcaResult({
      mode,
      error: err.message,
      writingRetries,
      writingRetryMax,
      isWritingHelp,
      userMessage: message.trim(),
      writingValidation: err.writing_validation,
      hyperlatticeValidation: err.hyperlattice_validation,
      provider: replyProvider,
      model: replyModel,
    });
  }

  const result = {
    ok: true,
    mode,
    reply,
    writing_validation: writingValidation,
    hyperlattice_validation: hyperlatticeValidation,
    writing_retries: writingRetries,
    provider: replyProvider,
    model: replyModel,
  };

  if (isPlanMode && plan) {
    result.plan = plan;
    result.validation = validatePlanAgainstRegistry(plan, context.components, context.environment);
    if (result.validation.valid) {
      try {
        const suggestion = planToGraph(plan);
        const topoReleased = validateCcaTopologyViaHyperlattice(suggestion, {
          ...latticeOpts,
          sessionId: "cca-topology-suggestion",
        });
        result.suggestion = suggestion;
        result.topology_validation = topoReleased.validation;
        result.topology_hyperlattice_validation = topoReleased.hyperlattice_validation;
      } catch (err) {
        result.validation = {
          valid: false,
          errors: [
            ...(result.validation.errors ?? []),
            err.message,
            ...(err.topology_validation?.errors ?? []),
          ],
        };
        result.topology_validation = err.topology_validation ?? { ok: false, error: err.message };
      }
    }
  }

  return result;
}

function summarizePlan(plan, { includeJson = true } = {}) {
  const enabled = plan.components.filter((c) => c.enabled).map((c) => c.id);
  const lines = [
    "CCA Implementation Plan Summary",
    `Intent: ${plan.user_intent}`,
    `Components (${enabled.length}): ${enabled.join(", ")}`,
    `LRPs: ${plan.lrps.join(", ")}`,
    `Inference: ${plan.inference.provider} / ${plan.inference.model}`,
    `Topology: ${plan.topology.nodes.length} nodes, ${plan.topology.edges.length} edges`,
  ];
  if (plan.warnings?.length) {
    lines.push(`Warnings: ${plan.warnings.join("; ")}`);
  }
  if (includeJson) {
    lines.push("", "```json", JSON.stringify(plan, null, 2), "```");
  }
  return lines.join("\n");
}