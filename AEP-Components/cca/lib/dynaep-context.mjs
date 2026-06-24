#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";
import { loadLrpCatalog, listPlatformContracts } from "../../wizard/lib/lrp.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../..");

export const DYNAEP_ROOT = "AEP-Components/dynAEP";

export const DYNAEP_SDK_PATHS = {
  typescript: "AEP-SDKs/typescript/dynaep/",
  typescript_cli: "AEP-SDKs/typescript/dynaep/cli/dynaep-cli.ts",
  python: "AEP-SDKs/python/dynaep/",
  react: "AEP-SDKs/react/dynaep-react.tsx",
  react_copilotkit: "AEP-SDKs/react/dynaep-copilotkit.tsx",
  produce_script: "AEP-User-Experience/scripts/produce-aep-sdks.mjs",
  dist_manifest: "AEP-SDKs/dist/sdk-manifest.json",
};

export const DYNAEP_GOVERNANCE_MODES = [
  "filter_all",
  "events_only",
  "ui_only",
  "disabled",
];

export const DYNAEP_OBSERVER_ADAPTERS = [
  {
    id: "webhook",
    path: "AEP-Components/dynAEP/observers/webhook/",
    entry: "AEP-Components/dynAEP/observers/webhook/index.ts",
    use_when: "inbound HTTP POST events with optional HMAC signing",
  },
  {
    id: "sse",
    path: "AEP-Components/dynAEP/observers/sse/",
    entry: "AEP-Components/dynAEP/observers/sse/index.ts",
    use_when: "Server-Sent Events streams with auto-reconnect",
  },
  {
    id: "poll",
    path: "AEP-Components/dynAEP/observers/poll/",
    entry: "AEP-Components/dynAEP/observers/poll/index.ts",
    use_when: "REST API polling with diff-based change detection",
  },
  {
    id: "blockchain",
    path: "AEP-Components/dynAEP/observers/examples/blockchain/",
    entry: "AEP-Components/dynAEP/observers/examples/blockchain/index.ts",
    use_when: "Ethereum event log polling (reference implementation)",
  },
];

const PROTOCOL_ENTRYPOINTS = [
  {
    id: "action-lattice",
    path: "AEP-Components/dynAEP/bridge/lattice/index.ts",
    role: "Canonical Action Lattice filter (LatticeFilter, ActionLattice)",
  },
  {
    id: "observer-interface",
    path: "AEP-Components/dynAEP/observers/interface.ts",
    role: "ObserverAdapter and LatticeEvent types",
  },
  {
    id: "hooks-interface",
    path: "AEP-Components/dynAEP/hooks/interface.ts",
    role: "Validation hook plugin interface",
  },
  {
    id: "lattice-registry",
    path: "AEP-Components/dynAEP/registries/aep-lattice.yaml",
    role: "Partial-order action registry and trust floors",
  },
  {
    id: "dynaep-config",
    path: "AEP-Components/dynAEP/dynaep-config.yaml",
    role: "Bridge transport, lattice governance mode, validation chain",
  },
];

function loadLatticeConfigSection(repoRoot) {
  const configPath = join(repoRoot, DYNAEP_ROOT, "dynaep-config.yaml");
  if (!existsSync(configPath)) {
    return {
      registry: "./registries/aep-lattice.yaml",
      governance: "filter_all",
      agent_interest_enabled: true,
      hook: "mle",
    };
  }
  try {
    const doc = yaml.parse(readFileSync(configPath, "utf8"));
    const lattice = doc?.lattice ?? {};
    return {
      registry: lattice.registry ?? "./registries/aep-lattice.yaml",
      governance: lattice.governance ?? "filter_all",
      agent_interest_enabled: lattice.agent_interest_enabled !== false,
      hook: lattice.hook ?? "mle",
    };
  } catch {
    return {
      registry: "./registries/aep-lattice.yaml",
      governance: "filter_all",
      agent_interest_enabled: true,
      hook: "mle",
    };
  }
}

function resolveLatticeRegistryPath(repoRoot, relativePath) {
  const normalized = String(relativePath ?? "./registries/aep-lattice.yaml").replace(/^\.\//, "");
  return `${DYNAEP_ROOT}/${normalized}`;
}

function listHooks(repoRoot) {
  const hooksDir = join(repoRoot, DYNAEP_ROOT, "hooks");
  if (!existsSync(hooksDir)) return [];
  return readdirSync(hooksDir)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".md"))
    .map((file) => ({
      file,
      path: `${DYNAEP_ROOT}/hooks/${file}`,
    }));
}

/**
 * @param {string} [repoRoot]
 */
export function loadDynaepContext(repoRoot = REPO_ROOT) {
  const catalog = loadLrpCatalog();
  const latticeConfig = loadLatticeConfigSection(repoRoot);
  const latticeRegistryPath = resolveLatticeRegistryPath(repoRoot, latticeConfig.registry);

  return {
    root: DYNAEP_ROOT,
    component_id: "dynaep-core",
    kernel_contract: "dynaep-action-lattice",
    protocol_version: "1.0",
    entrypoints: PROTOCOL_ENTRYPOINTS,
    lattice_registry: latticeRegistryPath,
    lattice_config: latticeConfig,
    governance_modes: DYNAEP_GOVERNANCE_MODES,
    observers: DYNAEP_OBSERVER_ADAPTERS,
    hooks: listHooks(repoRoot),
    sdks: DYNAEP_SDK_PATHS,
    produce_command: `node ${DYNAEP_SDK_PATHS.produce_script}`,
    bridge_config_builder: "AEP-Components/cca/lib/dynaep-bridge-config.mjs",
    platform_contracts: listPlatformContracts(catalog).filter((c) =>
      c.id === "dynaep-action-lattice" || c.kind === "kernel_contract",
    ),
    taxonomy: {
      protocol_component: "dynaep-core",
      kernel_contract: "dynaep-action-lattice",
      not_lrp: ["dynaep-action-lattice", "epscom-core", "lattice-channel-default"],
      sdk_registry_ids: ["aep-dynaep-typescript", "aep-dynaep-python"],
    },
    cca_guidance: {
      always_enable: true,
      pairs_with: ["gap", "lattice-channels", "aep-base-node"],
      policy_overrides_key: "dynaep",
      plan_lrps_rule: "plan.lrps lists regulation LRPs only (catalog.lrps). Kernel contracts are Base Node bootstrap.",
    },
  };
}

/**
 * Detect observer adapters from user intent text.
 * @param {string} userIntent
 * @param {ReturnType<typeof loadDynaepContext>} [ctx]
 */
export function resolveObserversFromIntent(userIntent, ctx = loadDynaepContext()) {
  const text = String(userIntent ?? "");
  const observers = {};

  if (/webhook/i.test(text)) {
    observers.webhook = {
      enabled: true,
      adapter: "webhook",
      path: ctx.observers.find((o) => o.id === "webhook")?.entry,
      config: { port: 9000, endpoint: "/events" },
    };
  }
  if (/\bsse\b|server[\s-]*sent/i.test(text)) {
    observers.sse = {
      enabled: true,
      adapter: "sse",
      path: ctx.observers.find((o) => o.id === "sse")?.entry,
    };
  }
  if (/\bpoll\b|polling\s*rest|rest\s*api\s*poll/i.test(text)) {
    observers.poll = {
      enabled: true,
      adapter: "poll",
      path: ctx.observers.find((o) => o.id === "poll")?.entry,
    };
  }
  if (/blockchain|ethereum|on[\s-]*chain/i.test(text)) {
    observers.blockchain = {
      enabled: true,
      adapter: "blockchain",
      path: ctx.observers.find((o) => o.id === "blockchain")?.entry,
    };
  }

  return observers;
}

/**
 * Build policy_overrides.dynaep template for ImplementationPlan.
 * @param {object} plan
 * @param {ReturnType<typeof loadDynaepContext>} [ctx]
 */
export function buildDynaepPolicyOverrides(plan, ctx = loadDynaepContext()) {
  const intent = plan?.user_intent ?? "";
  const observers = resolveObserversFromIntent(intent, ctx);
  const sdkComponents = (plan?.components ?? [])
    .filter((c) => c.enabled)
    .map((c) => c.id)
    .filter((id) => ctx.taxonomy.sdk_registry_ids.includes(id));

  return {
    enabled: true,
    protocol_root: ctx.root,
    kernel_contract: ctx.kernel_contract,
    lattice_registry: ctx.lattice_registry,
    governance_mode: ctx.lattice_config.governance,
    validation_hook: ctx.lattice_config.hook,
    agent_interest_enabled: ctx.lattice_config.agent_interest_enabled,
    sdk_paths: {
      typescript: ctx.sdks.typescript,
      python: ctx.sdks.python,
      react: ctx.sdks.react,
      cli: ctx.sdks.typescript_cli,
    },
    enabled_sdks: sdkComponents.length ? sdkComponents : ["aep-dynaep-typescript"],
    produce_command: ctx.produce_command,
    observers: Object.keys(observers).length ? observers : undefined,
  };
}

/**
 * @param {ReturnType<typeof loadDynaepContext>} ctx
 */
export function formatDynaepForPrompt(ctx) {
  const lines = [
    "",
    "dynAEP Action Lattice (protocol: AEP-Components/dynAEP/; SDKs: AEP-SDKs/ only):",
    `Kernel contract ${ctx.kernel_contract} is registered by Base Node bootstrap — NOT an LRP. Do not put it in plan.lrps.`,
    `Component dynaep-core (${ctx.root}) holds protocol only. Language SDKs live under AEP-SDKs/, built via produce-aep-sdks.mjs.`,
    "",
    "Protocol entrypoints:",
  ];

  for (const ep of ctx.entrypoints) {
    lines.push(`- ${ep.id}: ${ep.path} — ${ep.role}`);
  }

  lines.push(
    "",
    `Lattice registry: ${ctx.lattice_registry}`,
    `Governance modes (dynaep-config.yaml lattice.governance): ${ctx.governance_modes.join(", ")}`,
    `Default governance: ${ctx.lattice_config.governance}`,
    `Validation hook: ${ctx.lattice_config.hook}`,
    "",
    "Observer adapters (protocol; configure via policy_overrides.dynaep.observers):",
  );
  for (const obs of ctx.observers) {
    lines.push(`- ${obs.id}: ${obs.path} — ${obs.use_when}`);
  }

  lines.push(
    "",
    "Canonical SDK paths (no npm registry; lattice-gated artifacts):",
    `- TypeScript: ${ctx.sdks.typescript} (bridge.ts, protocol/action-lattice.ts)`,
    `- Python: ${ctx.sdks.python}`,
    `- React: ${ctx.sdks.react}, ${ctx.sdks.react_copilotkit}`,
    `- CLI: ${ctx.sdks.typescript_cli}`,
    `- Build: ${ctx.produce_command}`,
    "",
    "CCA planning rules:",
    "- dynaep-core is default_enabled on every deployment. Pair with gap for GAP instruction evaluation on the lattice.",
    "- Enable aep-dynaep-typescript and/or aep-dynaep-python when user needs compiled AI client libraries.",
    "- Set policy_overrides.dynaep with lattice_registry, governance_mode, sdk_paths, and optional observers from intent.",
    "- plan.lrps = regulation LRPs only (eu-ai-act, gdpr, hipaa, soc2-type2, nist-ai-rmf, iso-42001).",
    "- gap-runtime-scanners, commerce-subprotocol, epscom-core are platform features — enable as components, not plan.lrps.",
    "- GAP evaluates instructions; dynAEP Action Lattice evaluates runtime events. Do not route dynAEP through validation dock unless a validation engine is installed.",
  );

  return lines.join("\n");
}