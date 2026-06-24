#!/usr/bin/env node

/**
 * Dynamic component catalog for CCA plan generation.
 * Derives intent rules and topology from all registry manifests.
 */

export const FULL_STACK_PATTERN =
  /full\s*aep|everything|all\s*components|complete\s*stack|100%\s*coverage|entire\s*platform|deploy\s*all|maximum\s*coverage/i;

export const CAW_INTENT_PATTERN =
  /caw|containerized\s*agentic|execution[\s-]*layer|shell\s*enforc|aep-caw|coding\s*agent/i;

export const GAP_INTENT_PATTERN =
  /\bgap\b|governed\s*agentic|\.gap\b|gap\s*polic|instruction\s*lattice|subprotocol|coding[\s-]*govern|aep\s*propose|blast\s*radius|semantic\s*impact/i;

export const DYNAEP_INTENT_PATTERN =
  /\bdynaep\b|action\s*lattice|lattice\s*filter|event\s*governance|pad\s*router|causal\s*log|webhook\s*observer|sse\s*observer|poll\s*observer|blockchain\s*event/i;

export const HCSE_INTENT_PATTERN =
  /code\s*graph|codebase\s*parser|call\s*graph|symbol\s*blast|hcse|code\s*intelligence|codebase\s*memory|universal\s*codebase/i;

/** Kernel lattice contracts - always registered by Base Node bootstrap. NOT regulation LRPs. */
export const KERNEL_LATTICE_CONTRACTS = [
  "epscom-core",
  "dynaep-action-lattice",
  "lattice-channel-default",
];

/** Platform feature lrp_ids synced at execute time — never in plan.lrps. */
export const PLATFORM_FEATURE_LRP_IDS = new Set([
  "gap-runtime-scanners",
  "commerce-subprotocol",
  "aep-275-eval-chain",
  ...KERNEL_LATTICE_CONTRACTS,
]);

/**
 * plan.lrps must list regulation LRPs only (catalog.lrps compliance entries).
 * @param {string[]} lrpIds
 * @param {object} [catalog]
 */
export function filterRegulationLrps(lrpIds, catalog) {
  const regulationIds = new Set((catalog?.lrps ?? []).map((l) => l.id));
  return [...new Set(lrpIds ?? [])].filter((id) => regulationIds.has(id));
}

/**
 * Registry components represented by runtime/lattice — never duplicate as canvas rectangles.
 * dynaep-core is the Action Lattice protocol; the funnel `lattice` hub is the visual node.
 */
export const CANVAS_SKIP_COMPONENT_IDS = new Set([
  "dynaep-core",
  "lattice-channels",
  "lattice-crypto",
  "lattice-memory",
  "aep-base-node",
  "composer-lite",
  "cca",
  "epscom-signatures",
  "aep-typescript-sdk",
  "aep-dynaep-typescript",
  "aep-python-sdk",
  "session",
  "policy-engine",
  "evidence-ledger",
  "coding-governance",
  "gap",
  "agentmesh",
  "caw-framework",
]);

const TOPOLOGY_SKIP_IDS = CANVAS_SKIP_COMPONENT_IDS;

const KIND_NODE_DEFAULTS = {
  connector: "connector",
  bridge: "ucb",
  wasm_extension: "wasm_policy",
  compliance: "regulation",
  regulation: "regulation",
  daemon: "component",
  agent: "agent",
  ui: "component",
  tooling: "component",
  library: "component",
  protocol: "component",
  wizard: "component",
};

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phraseToPattern(phrase) {
  const normalized = String(phrase).trim();
  if (!normalized) return null;
  if (normalized.length < 4) return escapeRegex(normalized);
  const words = normalized.split(/\s+/).filter(
    (w) => w.length > 1 || /^\d+$/.test(w) || /^[IVXLC]+$/i.test(w),
  );
  if (!words.length) return escapeRegex(normalized);
  const full = words.map(escapeRegex).join("[\\s-]+");
  const tail = words.slice(-4).map(escapeRegex).join("[\\s-]*");
  return tail.length >= 4 ? `${full}|${tail}` : full;
}

function idToSearchTerms(id) {
  const terms = [escapeRegex(id)];
  const spaced = id.replace(/-/g, " ");
  terms.push(phraseToPattern(spaced));
  for (const part of id.split("-")) {
    if (part.length >= 3) terms.push(escapeRegex(part));
  }
  return terms;
}

/**
 * Build intent match rules from registry component manifests.
 * @param {object[]} components
 */
export function buildIntentRulesFromComponents(components) {
  const rules = [];
  for (const c of components) {
    if (!c.cca?.summary) continue;

    const terms = new Set();
    for (const t of idToSearchTerms(c.id)) terms.add(t);
    if (c.name) terms.add(phraseToPattern(c.name));
    if (c.lrp_id) {
      terms.add(escapeRegex(c.lrp_id));
      terms.add(phraseToPattern(c.lrp_id.replace(/-/g, " ")));
    }

    for (const phrase of c.cca.use_when ?? []) {
      const p = phraseToPattern(phrase);
      if (p) terms.add(p);
    }

    for (const cap of c.capabilities ?? []) {
      const segment = cap.split(":").pop();
      if (segment && segment.length >= 4) {
        terms.add(escapeRegex(segment));
        terms.add(phraseToPattern(segment.replace(/-/g, " ")));
      }
    }

    const joined = [...terms].filter(Boolean).join("|");
    if (!joined) continue;

    rules.push({
      componentId: c.id,
      pattern: new RegExp(joined, "i"),
      lrps: c.lrp_id ? [c.lrp_id] : [],
      pairs_with: c.cca.pairs_with ?? [],
    });
  }
  return rules;
}

/**
 * Resolve composer node type for a registry component.
 * @param {object} component
 */
export function resolveComposerNodeType(component) {
  if (component.composer_node?.type) return component.composer_node.type;
  if (component.composer?.node_type) return component.composer.node_type;
  if (component.id === "ucb") return "ucb";
  if (component.id === "caw-framework") return "component";
  if (component.id?.startsWith("connector-")) return "connector";
  if (component.id === "wasm-policy-node") return "wasm_policy";
  return KIND_NODE_DEFAULTS[component.kind] ?? "component";
}

/**
 * Match user intent against full component catalog.
 * @param {string} userIntent
 * @param {object} context - buildRegistryContext() result
 */
export function matchIntentFromCatalog(userIntent, context) {
  const text = String(userIntent);
  const components = context.components ?? [];
  const matched = new Set(
    components.filter((c) => c.default_enabled || c.installed).map((c) => c.id),
  );
  const matchedLrps = new Set();
  const warnings = [];
  let inferenceOverride = null;

  if (FULL_STACK_PATTERN.test(text)) {
    for (const c of components) {
      if (c.kind === "template") continue;
      matched.add(c.id);
      if (c.lrp_id) matchedLrps.add(c.lrp_id);
    }
  } else {
    const rules = buildIntentRulesFromComponents(components);
    for (const rule of rules) {
      if (!rule.pattern.test(text)) continue;
      matched.add(rule.componentId);
      for (const lrp of rule.lrps) matchedLrps.add(lrp);
      for (const pair of rule.pairs_with) matched.add(pair);
    }

    if (/local\s*llm|llama|ollama|llama\.cpp/i.test(text)) {
      inferenceOverride = {
        provider: "llama_cpp",
        model: "llama-3.1-8b",
        base_url: "http://127.0.0.1:8080/v1",
      };
    }
    if (/openrouter|cloud\s*llm|\bgpt\b|claude/i.test(text)) {
      matched.add("economics");
      inferenceOverride = {
        provider: "openrouter",
        model: "anthropic/claude-3.5-sonnet",
        base_url: "https://openrouter.ai/api/v1",
      };
    }
    if (/\bconformance\b|cc-0\d|pre-release\s*hardening/i.test(text)) {
      matched.add("conformance-runner");
    }
    if (CAW_INTENT_PATTERN.test(text)) {
      matched.add("caw-framework");
      matched.add("proxy");
      matched.add("session");
      matched.add("mcp-security");
      matched.add("gap");
      matched.add("coding-governance");
    }
    if (HCSE_INTENT_PATTERN.test(text)) {
      matched.add("hcse");
      matched.add("coding-governance");
      matched.add("intent-ledger");
    }
    if (DYNAEP_INTENT_PATTERN.test(text)) {
      matched.add("dynaep-core");
      matched.add("aep-dynaep-typescript");
      if (/python|py\b/i.test(text)) {
        matched.add("aep-dynaep-python");
      }
      if (/content\s*scanner|runtime\s*scanner|\bscanner\b/i.test(text)) {
        matched.add("gap-runtime-scanners");
      }
    }
    if (GAP_INTENT_PATTERN.test(text)) {
      matched.add("gap");
      matched.add("dynaep-core");
      matched.add("policy-engine");
      if (/propose|blast\s*radius|solidify|coding[\s-]*govern|nool/i.test(text)) {
        matched.add("coding-governance");
        matched.add("intent-ledger");
        matched.add("semantic-topology");
      }
      if (/wasm|sandbox.*gap|gap\s*eval/i.test(text)) {
        matched.add("wasm-policy-sandbox");
        matched.add("wasm-policy-node");
      }
    }
  }

  const env = context.environment;
  if (env?.constraints?.includes("memory_below_8gb") && inferenceOverride?.provider === "llama_cpp") {
    warnings.push("Low RAM: recommend cloud inference (openrouter) instead of local llama.cpp");
    inferenceOverride = {
      provider: "openrouter",
      model: "meta-llama/llama-3.1-8b-instruct",
      base_url: "https://openrouter.ai/api/v1",
    };
  }

  const componentIds = [...matched];
  if (componentIds.some((id) => id.startsWith("connector-")) && !componentIds.includes("ucb")) {
    componentIds.push("ucb");
    warnings.push("Connectors require UCB: auto-enabled ucb");
  }

  const catalog = context.policy_system?.catalog;
  const lrps = filterRegulationLrps([...matchedLrps], catalog);

  return {
    componentIds,
    lrps,
    inferenceOverride,
    warnings,
  };
}

/**
 * Build plan components array from matched ids.
 * @param {object[]} registryComponents
 * @param {string[]} componentIds
 * @param {string} userIntent
 * @param {object} env
 */
export function buildPlanComponents(registryComponents, componentIds, userIntent, env = process.env) {
  const idSet = new Set(componentIds);
  return registryComponents
    .map((c) => {
      const enabled = idSet.has(c.id) || c.default_enabled;
      let config;
      if (c.id === "connector-postgres" && enabled && /postgres|postgresql/i.test(userIntent)) {
        config = {
          host: env.AEP_POSTGRES_HOST || "postgres",
          port: Number(env.AEP_POSTGRES_PORT || 5432),
          database: env.AEP_POSTGRES_DB || "aep_evidence",
          user: env.AEP_POSTGRES_USER || "aep",
          ssl_mode: "require",
        };
      } else if (c.id?.startsWith("connector-") && enabled) {
        const svc = c.id.replace(/^connector-/, "");
        const envPrefix = `AEP_${svc.replace(/-/g, "_").toUpperCase()}`;
        const upstreamEnv = env[`${envPrefix}_UPSTREAM`];
        config = {
          ...(upstreamEnv ? { upstream: upstreamEnv } : {}),
          auth_token_env: c.implementation?.auth_token_env || `${envPrefix}_TOKEN`,
          ucb_egress_prefix: c.implementation?.ucb_egress_prefix || `/ucb/v1/egress/${svc}`,
        };
      }
      return {
        id: c.id,
        enabled,
        reason: enabled ? `Matched user intent: ${userIntent.slice(0, 80)}` : undefined,
        config,
      };
    })
    .filter((c) => c.enabled);
}

/**
 * Build full topology for all enabled components.
 * @param {string[]} componentIds
 * @param {string} intent
 * @param {object[]} registryComponents
 */
export function buildTopologyFromCatalog(componentIds, intent, registryComponents) {
  const nodes = [
    {
      id: "lattice-hub",
      type: "lattice",
      label: "Action Lattice Hub",
      x: 360,
      y: 220,
      data: { catalog_id: "builtin-lattice", channel_id: "lattice-channel-default" },
    },
    {
      id: "dock-validation",
      type: "dock_validation",
      label: "Validation Dock",
      x: 120,
      y: 140,
    },
    {
      id: "dock-inference",
      type: "dock_inference",
      label: "Inference Dock",
      x: 120,
      y: 300,
    },
  ];
  const edges = [
    {
      id: "e-val-hub",
      from: "dock-validation",
      to: "lattice-hub",
      channel: "lattice-channel-default",
    },
    {
      id: "e-inf-hub",
      from: "dock-inference",
      to: "lattice-hub",
      channel: "lattice-channel-default",
    },
  ];

  const hasRegulation = componentIds.some((id) => {
    const c = registryComponents.find((r) => r.id === id);
    return c?.lrp_id || c?.kind === "compliance" || c?.kind === "regulation";
  });
  if (hasRegulation) {
    nodes.push({
      id: "dock-regulation",
      type: "dock_regulation",
      label: "Regulation Dock",
      x: 120,
      y: 460,
    });
    edges.push({
      id: "e-reg-hub",
      from: "dock-regulation",
      to: "lattice-hub",
      channel: "lattice-channel-default",
    });
  }

  let agentCount = 1;
  const agentMatch = intent.match(/(\d+)\s*(coding\s*)?agent/i);
  if (agentMatch) agentCount = Math.min(Number(agentMatch[1]) || 1, 8);

  for (let i = 0; i < agentCount; i++) {
    const id = `agent-${i + 1}`;
    nodes.push({
      id,
      type: "agent",
      label: `Agent ${i + 1}`,
      x: 520 + i * 40,
      y: 180 + i * 30,
    });
    edges.push({
      id: `e-${id}-hub`,
      from: id,
      to: "lattice-hub",
      channel: "lattice-channel-default",
    });
  }

  const topoComponents = componentIds.filter((id) => !TOPOLOGY_SKIP_IDS.has(id));
  let col = 0;
  const rowBaseY = 520;
  for (const id of topoComponents) {
    const comp = registryComponents.find((c) => c.id === id);
    if (!comp) continue;

    const nodeType = resolveComposerNodeType(comp);
    if (nodeType === "agent") continue;

    const nodeId = `comp-${id}`;
    if (nodes.some((n) => n.id === nodeId)) continue;

    const row = Math.floor(col / 4);
    const colIdx = col % 4;
    col += 1;

    const data = {
      component_id: id,
      registry_id: id,
      kind: comp.kind,
    };
    if (comp.composer_node) Object.assign(data, comp.composer_node);
    if (id?.startsWith("connector-")) {
      data.service = id.replace(/^connector-/, "");
      data.ucb_only = true;
      data.component_id = id;
      if (comp.composer_node?.service) data.service = comp.composer_node.service;
    }
    if (id === "ucb") data.port = 8412;

    nodes.push({
      id: nodeId,
      type: nodeType,
      label: comp.composer_node?.label ?? comp.name ?? id,
      x: 200 + colIdx * 160,
      y: rowBaseY + row * 100,
      data,
    });

    const channel =
      comp.kind === "connector" ? "evidence_export" : "lattice-channel-default";
    const hubToComp = comp.kind === "connector";
    edges.push({
      id: `e-${nodeId}-hub`,
      from: hubToComp ? "lattice-hub" : nodeId,
      to: hubToComp ? nodeId : "lattice-hub",
      channel,
    });
  }

  return { nodes, edges };
}

/**
 * Map graph nodes back to component ids.
 * @param {object} graph
 * @param {object[]} registryComponents
 */
export function componentIdsFromGraph(graph, registryComponents) {
  const ids = new Set();
  const byType = new Map(registryComponents.map((c) => [resolveComposerNodeType(c), c.id]));

  for (const node of graph.nodes ?? []) {
    const data = node.data ?? {};
    if (data.component_id) ids.add(data.component_id);
    if (data.registry_id) ids.add(data.registry_id);
    if (node.type === "ucb") ids.add("ucb");
    if (node.type === "wasm_policy") {
      ids.add("wasm-policy-node");
      ids.add("wasm-policy-sandbox");
    }
    const mapped = byType.get(node.type);
    if (mapped && node.type !== "component" && node.type !== "regulation") {
      ids.add(mapped);
    }
  }

  return ids;
}

/**
 * Return all bundled component ids selectable by CCA.
 * @param {object[]} components
 */
export function allSelectableComponentIds(components) {
  return components.filter((c) => c.kind !== "template").map((c) => c.id);
}