#!/usr/bin/env node
/**
 * AEP 2.8 Setup Agent
 * Activation and configuration after Docker deploy. Full protocol is already in the image.
 */

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { expandHome, defaultPaths } from "../wizard/lib/paths.mjs";
import { loadLrpCatalog, selectLrpsDefault, selectLrpsInteractive } from "../wizard/lib/lrp.mjs";
import {
  loadComponentRegistry,
  selectComponentsInteractive,
  defaultEnabledComponentIds,
  writeInstalledExtensions,
  syncLrpsFromComponents,
} from "../../AEP-Base-Node/registry/lib/registry.mjs";
import {
  buildBaseNodeConfig,
  writeConfig,
  writeLatticeEnv,
  runHealthCheck,
} from "../wizard/lib/config-io.mjs";
import {
  waitForDocks,
  pingAllDocks,
  recordActivationEvent,
} from "../wizard/lib/docking.mjs";
import { flushManifestRegistry } from "./lib/setup/reload.mjs";
import { registerBaseNodeWithLattice } from "./lib/setup/register.mjs";
import {
  resolveInferenceConfig,
  promptInferenceConfig,
  writeInferenceEnv,
  registerInferenceEngineWithDock,
} from "./lib/setup/inference.mjs";
import { collectSetupHooks, mergePolicySections } from "../../AEP-Base-Node/registry/lib/setup-hooks.mjs";
import { loadGapContext } from "./lib/gap-context.mjs";
import {
  loadPolicySystemContext,
  resolveComplianceModulesForLrps,
} from "./lib/policy-system-context.mjs";
import { buildRegulationPolicySections } from "./lib/policy-sections.mjs";
import { loadDynaepContext, buildDynaepPolicyOverrides } from "./lib/dynaep-context.mjs";
import { buildHyperlatticeConfig } from "../hyperlattice/lib/hyperlattice.mjs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  resolveInstallPlan,
  promptInstallPlan,
  promptValidationEnginePlan,
  applyValidationEngineToConfig,
  recommendedLrpAdjustments,
  VALIDATION_ENGINE_MODES,
} from "./lib/setup/install-plan.mjs";
import { generatePlanFromIntent } from "../cca/lib/plan-generator.mjs";
import {
  executeImplementationPlan,
  loadActivePlan,
  writeActivePlan,
} from "../cca/lib/plan-executor.mjs";

function parseCsvArg(argv, prefix) {
  const raw = argv.find((a) => a.startsWith(`${prefix}=`))?.split("=")[1];
  if (!raw) return null;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const intentIdx = argv.indexOf("--intent");
  return {
    nonInteractive: argv.includes("--non-interactive"),
    skipIfActivated: argv.includes("--skip-if-activated"),
    force: argv.includes("--force"),
    skipHealth: argv.includes("--skip-health"),
    fromPlan: argv.includes("--from-plan"),
    cca: argv.includes("--cca"),
    intent: intentIdx >= 0 ? argv.slice(intentIdx + 1).join(" ").trim() : null,
    configOut: argv.find((a) => a.startsWith("--config="))?.split("=")[1],
    waitMs: Number(argv.find((a) => a.startsWith("--wait-ms="))?.split("=")[1] || 30000),
    lrps: parseCsvArg(argv, "--lrps"),
    components: parseCsvArg(argv, "--components"),
    validationEngine:
      argv.find((a) => a.startsWith("--validation-engine="))?.split("=")[1]?.trim() || null,
  };
}

async function prompt(rl, question, defaultValue) {
  const suffix = defaultValue !== undefined ? ` [${defaultValue}]` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || String(defaultValue ?? "");
}

async function promptYesNo(rl, question, defaultYes = true) {
  const hint = defaultYes ? "Y/n" : "y/N";
  const answer = (await rl.question(`${question} (${hint}): `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === "y" || answer === "yes";
}

function loadActivation(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeActivation(path, report) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* windows */
  }
}

function setupEmbedding(dim = 128) {
  const embedding = new Array(dim).fill(0);
  embedding[0] = 1;
  return embedding;
}

function smokeMemory(memoryBin, configPath, latticeDb) {
  const embedding = setupEmbedding();
  const entry = {
    id: `setup-${Date.now()}`,
    timestamp: new Date().toISOString(),
    element_id: "AG-SETUP",
    domain: "event",
    proposal: { source: "setup-agent", phase: "activation" },
    result: "accepted",
    errors: [],
    traversal_path: [],
    embedding,
    metadata: { source: "setup-agent" },
  };
  const record = spawnSync(
    memoryBin,
    ["--config", configPath, "record"],
    { input: JSON.stringify(entry), encoding: "utf8" },
  );
  if (record.status !== 0) {
    throw new Error(record.stderr || record.stdout || "aep-memory record failed");
  }
  const searchReq = { embedding, limit: 1, threshold: 0.0, accepted_only: false };
  const search = spawnSync(
    memoryBin,
    ["--db", expandHome(latticeDb), "search"],
    { input: JSON.stringify(searchReq), encoding: "utf8" },
  );
  if (search.status !== 0) {
    throw new Error(search.stderr || search.stdout || "aep-memory search failed");
  }
  const matches = JSON.parse(search.stdout.trim());
  if (!Array.isArray(matches) || matches.length === 0) {
    throw new Error("aep-memory search returned no matches");
  }
  return { matches };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const paths = defaultPaths();

  try {
    const { ensureInstallWizardManifests } = await import(
      "../../AEP-Composer-Lite/lib/ensure-setup-manifests.mjs"
    );
    ensureInstallWizardManifests(expandHome(process.env.AEP_DATA ?? paths.dataDir));
  } catch {
    /* CLI path outside Composer Lite */
  }

  if (opts.fromPlan || opts.cca) {
    const dataDir = expandHome(process.env.AEP_DATA ?? paths.dataDir);
    let plan = loadActivePlan(dataDir);
    if (opts.cca && opts.intent) {
      const generated = await generatePlanFromIntent(opts.intent, dataDir, process.env);
      plan = generated.plan;
      writeActivePlan(dataDir, plan);
      console.log("CCA generated ImplementationPlan:");
      console.log(JSON.stringify({ user_intent: plan.user_intent, components: plan.components.filter((c) => c.enabled).map((c) => c.id) }, null, 2));
    }
    if (!plan) {
      throw new Error("No active ImplementationPlan. Run: aep-cca plan --intent \"...\"");
    }
    const result = await executeImplementationPlan(plan, {
      dataDir,
      skipHealth: opts.skipHealth,
      waitMs: opts.waitMs,
    });
    console.log("CCA plan executed successfully.");
    console.log(JSON.stringify({ status: result.report.status, plan_id: result.report.plan_id, components: result.report.components }, null, 2));
    return;
  }

  const catalog = loadLrpCatalog();

  let dataDir = paths.dataDir;
  let activationPath = paths.activationPath;
  let envPath = paths.envPath;

  console.log("AEP 2.8 Setup Agent");
  console.log("===================");
  console.log("Activates and configures the protocol already loaded in this container.\n");

  const existing = loadActivation(activationPath);
  if (existing?.status === "activated" && opts.skipIfActivated && !opts.force) {
    console.log(`Already activated at ${existing.activated_at}`);
    console.log(JSON.stringify(existing, null, 2));
    return;
  }

  const rl = opts.nonInteractive ? null : createInterface({ input, output });

  const installPlan = opts.nonInteractive
    ? resolveInstallPlan(process.env, paths)
    : await promptInstallPlan(rl, prompt, paths);

  let validationEnginePlan = opts.nonInteractive
    ? installPlan.validation_engine
    : await promptValidationEnginePlan(rl, prompt);

  if (opts.validationEngine) {
    const match = VALIDATION_ENGINE_MODES.find((m) => m.id === opts.validationEngine);
    if (match) validationEnginePlan = match;
  }

  installPlan.validation_engine = validationEnginePlan;

  console.log(`\nInstall plan: ${installPlan.method} (${installPlan.install_target})`);
  console.log(`Validation engine: ${validationEnginePlan.label}`);

  dataDir = opts.nonInteractive
    ? expandHome(installPlan.data_dir || paths.dataDir)
    : expandHome(installPlan.data_dir || (await prompt(rl, "Data directory", paths.dataDir)));

  installPlan.data_dir = dataDir;

  activationPath = joinData(dataDir, "activation.json");
  envPath = joinData(dataDir, "lattice-channel.env");

  const socketBase = opts.nonInteractive
    ? resolveSocketBaseForData(dataDir)
    : await prompt(rl, "Base Node socket base", resolveSocketBaseForData(dataDir));

  const latticeDb = expandHome(
    opts.nonInteractive
      ? joinData(dataDir, "action-lattice.db")
      : await prompt(rl, "Action Lattice SQLite path", joinData(dataDir, "action-lattice.db")),
  );

  const resolvedConfigPath = opts.configOut || joinData(dataDir, "base-node.json");

  const binaryPath = paths.baseNodeBin;
  if (!existsSync(binaryPath)) {
    throw new Error(`Base Node binary not found: ${binaryPath}`);
  }

  console.log("\nWaiting for Base Node docking sockets...");
  const ready = await waitForDocks(socketBase, opts.waitMs);
  if (!ready) {
    throw new Error(
      `Docking sockets not ready under ${socketBase} after ${opts.waitMs}ms. Is aep-base-node --daemon running?`,
    );
  }

  const dockResults = pingAllDocks(socketBase, { configPath: resolvedConfigPath });
  const missing = dockResults.filter((d) => !d.listening);
  if (missing.length) {
    throw new Error(
      `Dock sockets not listening: ${missing.map((d) => d.port).join(", ")}`,
    );
  }
  const pingFailed = dockResults.filter((d) => d.listening && !d.pong);
  if (pingFailed.length) {
    console.log(
      `WARNING: ${pingFailed.length} dock(s) listening but health ping not registered yet (pre-activation is OK): ${pingFailed.map((d) => d.port).join(", ")}`,
    );
  } else {
    console.log(`All ${dockResults.length} docking ports responded to ping.`);
  }

  const componentRegistry = await loadComponentRegistry(process.env);
  const componentIds = opts.components?.length
    ? opts.components
    : opts.nonInteractive
      ? defaultEnabledComponentIds(componentRegistry.components)
      : await selectComponentsInteractive(
          componentRegistry.components,
          rl,
          promptYesNo,
        );

  let lrps = opts.lrps?.length
    ? opts.lrps
    : opts.nonInteractive
      ? selectLrpsDefault(catalog)
      : await selectLrpsInteractive(catalog, rl, promptYesNo);
  lrps = syncLrpsFromComponents(componentIds, componentRegistry.components, lrps);
  lrps = recommendedLrpAdjustments(validationEnginePlan, lrps);

  writeInstalledExtensions(dataDir, componentIds.map((id) => ({ id, enabled_at: new Date().toISOString() })));

  const latticeSecret = randomBytes(32).toString("hex");
  const internetUp = opts.nonInteractive
    ? true
    : await promptYesNo(rl, "Normal internet available?", true);

  const inference = opts.nonInteractive
    ? resolveInferenceConfig(process.env, dataDir)
    : await promptInferenceConfig(rl, prompt, promptYesNo);

  console.log(
    `\nInference Engine: ${inference.provider} / ${inference.model} @ ${inference.base_url}`,
  );
  if (inference.api_key_env && !process.env[inference.api_key_env]) {
    console.log(
      `WARNING: ${inference.api_key_env} not set - cloud provider calls will fail.`,
    );
  }

  let config = buildBaseNodeConfig({
    socketBase,
    latticeDb,
    binaryPath,
    catalog,
    lrps,
    latticeSecret,
    internetUp,
    meshPeers: 0,
    inferenceEngine: inference,
  });
  config = applyValidationEngineToConfig(config, validationEnginePlan);
  config.install_plan = {
    method: installPlan.method,
    install_target: installPlan.install_target,
    dynaep_included: installPlan.dynaep_included,
    notes: installPlan.notes,
  };

  const hookData = collectSetupHooks(componentIds, componentRegistry.components);
  const policySystem = loadPolicySystemContext();
  const policyOverrides = {
    regulation_lrps: {
      enabled: lrps.length > 0,
      modules: resolveComplianceModulesForLrps(lrps, policySystem.catalog),
    },
    policy_lattice: {
      enabled: true,
      hierarchy: policySystem.hierarchy.map((h) => h.label),
      mandatory_gap: policySystem.mandatory_gap,
      reference_policy_paths: policySystem.reference_policies.map((p) => p.path),
      yaml_presets: policySystem.yaml_presets.map((p) => p.path),
    },
  };
  if (componentIds.includes("gap")) {
    const gap = loadGapContext();
    policyOverrides.gap = {
      enabled: true,
      meta_schema: "AEP-Components/gap/schemas/gap-meta-schema-v1.2.json",
      policy_system_root: "AEP-Policy-System",
      reference_policies: gap.reference_policies.map((p) => p.file),
    };
  }
  const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
  const planStub = {
    components: componentIds.map((id) => ({ id, enabled: true })),
    user_intent: "",
    lrps,
    policy_overrides: policyOverrides,
  };
  if (componentIds.includes("dynaep-core") || componentIds.includes("gap")) {
    policyOverrides.dynaep = buildDynaepPolicyOverrides(planStub, loadDynaepContext(repoRoot));
  }
  policyOverrides.hyperlattice = buildHyperlatticeConfig(planStub, {
    policy_system: policySystem,
    dynaep: loadDynaepContext(repoRoot),
  });
  planStub.policy_overrides = policyOverrides;
  const policySections = buildRegulationPolicySections(
    { lrps, policy_overrides: policyOverrides },
    mergePolicySections(hookData.policy_sections, policyOverrides),
    lrps,
  );
  if (Object.keys(policySections).length) {
    config.policy_sections = policySections;
  }

  writeConfig(resolvedConfigPath, config, { repoRoot, dataDir });
  console.log(`\nWrote ${resolvedConfigPath}`);

  mkdirSync(dirname(expandHome(latticeDb)), { recursive: true });
  mkdirSync(socketBase, { recursive: true });

  writeLatticeEnv(envPath, latticeSecret);
  console.log(`Wrote ${envPath}`);

  const inferenceEnvPath = joinData(dataDir, "inference-engine.env");
  writeInferenceEnv(inferenceEnvPath, inference);
  console.log(`Wrote ${inferenceEnvPath}`);

  const latticeOpts = { configPath: resolvedConfigPath, env: process.env };

  console.log("\nRecording activation event on validation dock...");
  const dockEvent = recordActivationEvent(socketBase, "setup-agent", latticeOpts);
  console.log(`Activation event recorded (event_id=${dockEvent.event_id ?? "n/a"}).`);

  console.log("Registering Base Node with dynAEP Action Lattice...");
  const registerEvent = registerBaseNodeWithLattice(socketBase, {
    ...latticeOpts,
    version: "2.8.0",
    registeredBy: "setup-agent",
    lrps,
  });
  console.log(
    `Base Node registered (event_id=${registerEvent.event_id ?? "n/a"}, agent=AG-BASE-NODE).`,
  );

  console.log("Registering Inference Engine on inference dock...");
  const inferenceEvent = registerInferenceEngineWithDock(socketBase, inference, latticeOpts);
  console.log(
    `Inference Engine registered (event_id=${inferenceEvent.event_id ?? "n/a"}, ${inference.provider}/${inference.model}).`,
  );

  if (existsSync(paths.memoryBin)) {
    console.log("\nSmoke-testing lattice memory fabric...");
    const memoryResult = smokeMemory(paths.memoryBin, resolvedConfigPath, latticeDb);
    console.log(`Memory search OK (${memoryResult.matches.length} match).`);
  }

  let health = null;
  if (!opts.skipHealth) {
    console.log("\nRunning Base Node health check...");
    health = runHealthCheck(binaryPath, config, resolvedConfigPath);
    if (health.status !== "ok") {
      throw new Error(`Unexpected health status: ${health.status}`);
    }
    console.log("Health: OK");
    console.log(`Docking ports listening: ${health.docking_ports_listening}`);
  }

  const report = {
    status: "activated",
    version: "2.8.0",
    activated_at: new Date().toISOString(),
    config_path: resolvedConfigPath,
    data_dir: dataDir,
    socket_base: socketBase,
    lattice_db: latticeDb,
    install_plan: installPlan,
    validation_engine: validationEnginePlan,
    lrps,
    components: componentIds,
    component_registry_version: componentRegistry.version,
    docking: dockResults,
    activation_event_id: dockEvent.event_id ?? null,
    registration_event_id: registerEvent.event_id ?? null,
    base_node_agent_id: "AG-BASE-NODE",
    inference_engine: inference,
    inference_register_event_id: inferenceEvent.event_id ?? null,
    health,
  };

  writeActivation(activationPath, report);
  console.log(`\nWrote ${activationPath}`);

  const reload = flushManifestRegistry(dataDir);
  if (reload.daemon?.reloaded) {
    console.log("Signaled Base Node daemon reload to apply configuration.");
  } else if (reload.stamp) {
    console.log("Manifest registry reload stamp written for immediate dock pickup.");
  }

  if (rl) rl.close();
  console.log("\nAEP 2.8 setup complete. Base Node is activated and configured.");
  console.log(JSON.stringify({ status: report.status, activated_at: report.activated_at }));
}

function joinData(dataDir, name) {
  return `${dataDir.replace(/\/$/, "")}/${name}`;
}

function resolveSocketBaseForData(dataDir) {
  return process.env.AEP_SOCKET_BASE || joinData(dataDir, "sockets");
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});