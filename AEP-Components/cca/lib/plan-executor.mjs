#!/usr/bin/env node

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expandHome, defaultPaths } from "../../wizard/lib/paths.mjs";
import { loadLrpCatalog } from "../../wizard/lib/lrp.mjs";
import {
  loadComponentRegistry,
  loadInstalledExtensions,
  writeInstalledExtensions,
  syncLrpsFromComponents,
} from "../../../AEP-Base-Node/registry/lib/registry.mjs";
import {
  collectSetupHooks,
  mergePolicySections,
  componentIdsFromPlan,
  connectorsFromPlan,
} from "../../../AEP-Base-Node/registry/lib/setup-hooks.mjs";
import {
  buildBaseNodeConfig,
  writeConfig,
  writeLatticeEnv,
  runHealthCheck,
} from "../../wizard/lib/config-io.mjs";
import {
  waitForDocks,
  pingAllDocks,
  recordActivationEvent,
} from "../../wizard/lib/docking.mjs";
import { flushManifestRegistry } from "./setup/reload.mjs";
import { registerBaseNodeWithLattice } from "./setup/register.mjs";
import {
  resolveInferenceConfig,
  writeInferenceEnv,
  registerInferenceEngineWithDock,
} from "./setup/inference.mjs";
import {
  applyValidationEngineToConfig,
  recommendedLrpAdjustments,
} from "./setup/install-plan.mjs";
import { validatePlanAgainstRegistry } from "./plan-schema.mjs";
import { buildRegistryContext } from "./registry-context.mjs";
import { planToGraph } from "./plan-to-graph.mjs";
import { saveGraph } from "../../../AEP-Composer-Lite/lib/graph-store.mjs";
import { ensureCawConfig, probeCawHost } from "../../caw-framework/lib/caw-service.mjs";
import {
  buildCawFrameworkConfig,
  recordCawLatticeEvent,
} from "../../caw-framework/lib/lattice-bridge.mjs";
import { runHcseInstallIfNeeded } from "../../hcse/lib/install.mjs";
import { buildRegulationPolicySections } from "./policy-sections.mjs";
import { synthesizeTaskManifestsFromPlan } from "./task-manifest-synthesis.mjs";

function joinData(dataDir, name) {
  return `${dataDir.replace(/\/$/, "")}/${name}`;
}

function plansDir(dataDir) {
  return joinData(dataDir, "plans");
}

function activePlanPath(dataDir) {
  return join(plansDir(dataDir), "active.json");
}

export function loadActivePlan(dataDir) {
  const path = activePlanPath(dataDir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function writeActivePlan(dataDir, plan) {
  const dir = plansDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const path = activePlanPath(dataDir);
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* windows */
  }
  return path;
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

/**
 * Apply a CCA plan after Base Node activation without rotating lattice secrets or rewriting config.
 */
export async function executeCcaPlanOverlay(plan, options = {}) {
  const paths = defaultPaths();
  const dataDir = expandHome(options.dataDir ?? paths.dataDir);
  const env = options.env ?? process.env;
  const socketBase = options.socketBase ?? env.AEP_SOCKET_BASE ?? joinData(dataDir, "sockets");
  const configPath = options.configPath ?? joinData(dataDir, "base-node.json");
  const waitMs = options.waitMs ?? 30000;
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

  const context = await buildRegistryContext(dataDir, env);
  const validation = validatePlanAgainstRegistry(plan, context.components, context.environment);
  if (!validation.valid && !options.force) {
    throw new Error(`Plan validation failed: ${validation.errors.join("; ")}`);
  }

  const ready = await waitForDocks(socketBase, waitMs);
  if (!ready) {
    throw new Error(`Docking sockets not ready under ${socketBase} after ${waitMs}ms`);
  }

  const componentIds = componentIdsFromPlan(plan);
  const registry = await loadComponentRegistry(env);
  const existingInstalled = loadInstalledExtensions(dataDir);
  const mergedIds = new Set([
    ...(existingInstalled.installed ?? []).map((e) => e.id),
    ...componentIds,
  ]);
  writeInstalledExtensions(
    dataDir,
    [...mergedIds].map((id) => ({ id, enabled_at: new Date().toISOString() })),
  );

  if (componentIds.includes("caw-framework") || componentIds.includes("ucb") || plan.security?.ucb_enabled) {
    try {
      synthesizeTaskManifestsFromPlan(plan, dataDir, repoRoot);
    } catch (err) {
      plan.warnings = [...(plan.warnings ?? []), `task manifest synthesis: ${err.message}`];
    }
  }

  writeActivePlan(dataDir, plan);
  try {
    const graph = planToGraph(plan);
    saveGraph(dataDir, graph);
  } catch {
    /* graph save optional */
  }

  const reload = flushManifestRegistry(dataDir, options);
  const report = {
    status: "cca_overlay",
    overlay_at: new Date().toISOString(),
    activated_by: "cca-plan-overlay",
    config_path: configPath,
    data_dir: dataDir,
    plan_id: plan.created_at,
    user_intent: plan.user_intent,
    components: componentIds,
    registry_components: registry.components.length,
  };
  return { report, reload, plan_path: activePlanPath(dataDir), overlay: true };
}

/**
 * Execute a validated ImplementationPlan.
 * @param {object} plan
 * @param {object} [options]
 */
export async function executeImplementationPlan(plan, options = {}) {
  const paths = defaultPaths();
  const dataDir = expandHome(options.dataDir ?? paths.dataDir);
  const env = options.env ?? process.env;
  const socketBase = options.socketBase ?? env.AEP_SOCKET_BASE ?? joinData(dataDir, "sockets");
  const latticeDb = expandHome(options.latticeDb ?? joinData(dataDir, "action-lattice.db"));
  const configPath = options.configPath ?? joinData(dataDir, "base-node.json");
  const activationPath = joinData(dataDir, "activation.json");
  const envPath = joinData(dataDir, "lattice-channel.env");
  const waitMs = options.waitMs ?? 30000;
  const skipHealth = options.skipHealth ?? false;
  const binaryPath = paths.baseNodeBin;
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

  if (
    options.overlayOnly
    || (options.preserveExistingConfig && existsSync(activationPath) && existsSync(configPath))
  ) {
    return executeCcaPlanOverlay(plan, options);
  }

  const context = await buildRegistryContext(dataDir, env);
  const validation = validatePlanAgainstRegistry(plan, context.components, context.environment);
  if (!validation.valid && !options.force) {
    throw new Error(`Plan validation failed: ${validation.errors.join("; ")}`);
  }

  if (!existsSync(binaryPath)) {
    throw new Error(`Base Node binary not found: ${binaryPath}`);
  }

  const ready = await waitForDocks(socketBase, waitMs);
  if (!ready) {
    throw new Error(`Docking sockets not ready under ${socketBase} after ${waitMs}ms`);
  }

  const dockResults = pingAllDocks(socketBase, { configPath });
  const notListening = dockResults.filter((d) => !d.listening);
  if (notListening.length) {
    throw new Error(
      `Dock sockets not listening: ${notListening.map((d) => d.port).join(", ")}`,
    );
  }
  const pingFailed = dockResults.filter((d) => d.listening && !d.pong);
  if (pingFailed.length && !options.allowDockPingFailure) {
    throw new Error(`Dock ping failed: ${pingFailed.map((d) => d.port).join(", ")}`);
  }

  const componentIds = componentIdsFromPlan(plan);
  const registry = await loadComponentRegistry(env);
  const hookData = collectSetupHooks(componentIds, registry.components);

  if (componentIds.includes("hcse")) {
    await runHcseInstallIfNeeded({
      dataDir,
      socketBase,
      componentIds,
      cwd: options.cwd ?? process.cwd(),
      force: options.forceHcseInstall === true,
    });
  }

  let lrps = [...new Set([...(plan.lrps ?? []), ...hookData.lrps])];
  lrps = syncLrpsFromComponents(componentIds, registry.components, lrps);

  const validationEnginePlan = options.validationEngine ?? {
    id: "none",
    label: "Try without dedicated validation engine",
  };
  lrps = recommendedLrpAdjustments(validationEnginePlan, lrps);

  writeInstalledExtensions(
    dataDir,
    componentIds.map((id) => ({ id, enabled_at: new Date().toISOString() })),
  );

  const catalog = loadLrpCatalog();
  const latticeSecret = randomBytes(32).toString("hex");
  const internetUp = plan.security?.internet_up ?? true;

  const inference = plan.inference ?? resolveInferenceConfig(env, dataDir);

  const signaturesPath =
    env.AEP_EPSCOM_SIGNATURES_PATH ??
    join(dirname(fileURLToPath(import.meta.url)), "../../../AEP-Base-Node/signatures");

  let config = buildBaseNodeConfig({
    socketBase,
    latticeDb,
    binaryPath,
    catalog,
    lrps,
    latticeSecret,
    internetUp,
    meshPeers: componentIds.includes("potomitan") ? 1 : 0,
    inferenceEngine: inference,
    signaturesPath,
  });

  config.epscom_signatures = {
    enabled: true,
    path: signaturesPath,
    trust_bundle: "trust-bundle/manifest.json",
    sync_interval_hours: 24,
    signature_ids: (context.epscom_signatures?.signatures ?? []).map((s) => s.id),
  };

  config = applyValidationEngineToConfig(config, validationEnginePlan);

  const policySections = mergePolicySections(hookData.policy_sections, plan.policy_overrides);
  if (componentIds.includes("commerce-subprotocol")) {
    policySections.commerce = {
      ...(policySections.commerce ?? {}),
      enabled: true,
    };
  }
  if (componentIds.includes("coding-governance")) {
    const cg = plan.policy_overrides?.coding_governance ?? {};
    policySections.coding_governance = {
      enabled: true,
      require_propose: cg.require_propose !== false,
      git_integration: cg.git_integration !== false,
      auto_git_refs: cg.auto_git_refs !== false,
      semantic_strict: cg.semantic_strict === true,
      subprotocol: "coding-governance",
      reference_policies: cg.reference_policies ?? [],
      workflow: cg.workflow ?? [],
      agent_instructions: cg.agent_instructions ?? [],
    };
    config.coding_governance = {
      enabled: true,
      git_integration: policySections.coding_governance.git_integration,
      semantic_strict: policySections.coding_governance.semantic_strict,
      data_dir: dataDir,
    };
    const workflowPath = join(dataDir, "coding-agent-workflow.md");
    const lines = [
      "# AEP Coding Agent Workflow (CCA-generated)",
      "",
      "Git stays substrate. AEP governs agent intent; solidify links to git commits.",
      "",
      "## Environment",
      "",
      "```bash",
      "export AEP_SEMANTIC_STRICT=1",
      "export AEP_GIT_INTEGRATION=1",
      "export AEP_REPO_ROOT=$(git rev-parse --show-toplevel)",
      "export AEP_DATA=" + dataDir,
      "```",
      "",
      "## Loop",
      "",
    ];
    let n = 1;
    for (const step of policySections.coding_governance.workflow ?? []) {
      if (step.startsWith("#")) {
        lines.push("", step.slice(1).trim());
        continue;
      }
      lines.push(`${n}. \`${step}\``);
      n += 1;
    }
    for (const note of policySections.coding_governance.agent_instructions ?? []) {
      lines.push(`- ${note}`);
    }
    if (componentIds.includes("hcse")) {
      lines.push(
        "",
        "## HCSE (code graph)",
        "",
        "- MCP server: `aep-hcse`",
        "- Team artifact: `.aep-hcse/graph.db.zst`",
        "- `aep-hcse cli index_repository` after clone",
      );
    }
    writeFileSync(workflowPath, `${lines.join("\n")}\n`);
  }
  if (componentIds.includes("hcse")) {
    policySections.hcse = {
      enabled: true,
      module_dir: join(dataDir, "modules", "aep-hcse"),
      cache_dir: join(dataDir, "cache", "hcse"),
      artifact_dir: ".aep-hcse",
      mcp_name: "aep-hcse",
      upstream: "DeusData/codebase-memory-mcp",
    };
    config.hcse = { ...policySections.hcse };
    if (!componentIds.includes("coding-governance")) {
      const workflowPath = join(dataDir, "coding-agent-workflow.md");
      appendFileSync(
        workflowPath,
        "\n## HCSE (code graph)\n\n- MCP: `aep-hcse`\n- Artifact: `.aep-hcse/graph.db.zst`\n",
      );
    }
  }
  if (componentIds.includes("dynaep-core") && plan.policy_overrides?.dynaep) {
    policySections.dynaep = {
      ...(policySections.dynaep ?? {}),
      ...plan.policy_overrides.dynaep,
      enabled: true,
    };
    const dyn = plan.policy_overrides.dynaep;
    config.dynaep = {
      enabled: true,
      protocol_root: dyn.protocol_root,
      lattice_registry: dyn.lattice_registry,
      governance_mode: dyn.governance_mode,
      kernel_contract: dyn.kernel_contract,
      validation_hook: dyn.validation_hook,
      agent_interest_enabled: dyn.agent_interest_enabled,
      sdk_paths: dyn.sdk_paths,
      enabled_sdks: dyn.enabled_sdks,
      produce_command: dyn.produce_command,
      observers: dyn.observers,
      bridge: {
        lattice: {
          registry: dyn.lattice_registry,
          governance: dyn.governance_mode,
          hook: dyn.validation_hook ?? "mle",
          agent_interest_enabled: dyn.agent_interest_enabled ?? true,
        },
      },
    };
  }
  if (componentIds.includes("caw-framework")) {
    const cawConfigPath = ensureCawConfig(dataDir, repoRoot);
    const cawOv = plan.policy_overrides?.caw_framework ?? {};
    policySections.caw_framework = {
      ...(policySections.caw_framework ?? {}),
      enabled: true,
      mode: "enforce",
      shell_shim: true,
      lattice_audit: true,
      policy_name: cawOv.policy_name ?? "default",
      mount_profile: cawOv.mount_profile ?? "agent-sandbox",
      gap_address: cawOv.gap_address ?? "dev.aep.caw/agent-sandbox.v1",
      config_path: cawConfigPath,
    };
    config.caw_framework = buildCawFrameworkConfig({
      env,
      config_path: cawConfigPath,
      enabled: true,
      policy_name: policySections.caw_framework.policy_name,
      mount_profile: policySections.caw_framework.mount_profile,
      gap_address: policySections.caw_framework.gap_address,
      compiled_runtime: cawOv.compiled_runtime === true,
      llm_proxy: cawOv.llm_proxy !== false,
    });
    try {
      const cawProbe = probeCawHost(env);
      if (cawProbe.ok) {
        recordCawLatticeEvent(socketBase, {
          component: "caw-framework",
          event: "CAW_HOST_DETECT",
          detect: cawProbe.detect,
        });
      }
    } catch {
      /* CAW lattice audit optional when docks unavailable */
    }
  }

  if (componentIds.includes("caw-framework") || componentIds.includes("ucb") || plan.security?.ucb_enabled) {
    try {
      synthesizeTaskManifestsFromPlan(plan, dataDir, repoRoot);
    } catch (err) {
      plan.warnings = [...(plan.warnings ?? []), `task manifest synthesis: ${err.message}`];
    }
  }

  const finalPolicySections = buildRegulationPolicySections(plan, policySections, lrps);
  if (Object.keys(finalPolicySections).length) {
    config.policy_sections = finalPolicySections;
  }

  const connectors = connectorsFromPlan(plan);
  if (Object.keys(connectors).length) {
    config.connectors = connectors;
  }

  config.implementation_plan = {
    plan_version: plan.plan_version,
    created_at: plan.created_at,
    user_intent: plan.user_intent,
    component_count: componentIds.length,
  };

  config.install_plan = {
    method: "docker-compose",
    install_target: "cca-plan-executor",
    dynaep_included: componentIds.includes("dynaep-core"),
    notes: "Activated via CCA ImplementationPlan",
  };

  writeConfig(configPath, config, { repoRoot, dataDir });
  mkdirSync(dirname(expandHome(latticeDb)), { recursive: true });
  mkdirSync(socketBase, { recursive: true });
  writeLatticeEnv(envPath, latticeSecret);

  const inferenceEnvPath = joinData(dataDir, "inference-engine.env");
  writeInferenceEnv(inferenceEnvPath, inference);

  const latticeOpts = { configPath };
  const dockEvent = recordActivationEvent(socketBase, "setup-agent", latticeOpts);
  const registerEvent = registerBaseNodeWithLattice(socketBase, {
    ...latticeOpts,
    version: "2.8.0",
    registeredBy: "cca-plan-executor",
    lrps,
  });
  const inferenceEvent = registerInferenceEngineWithDock(socketBase, inference, latticeOpts);

  writeActivePlan(dataDir, plan);

  try {
    const graph = planToGraph(plan);
    saveGraph(dataDir, graph);
  } catch {
    /* graph save optional */
  }

  let health = null;
  if (!skipHealth) {
    health = runHealthCheck(binaryPath, config, configPath);
    if (health.status !== "ok") {
      throw new Error(`Unexpected health status: ${health.status}`);
    }
  }

  const report = {
    status: "activated",
    version: "2.8.0",
    activated_at: new Date().toISOString(),
    activated_by: "cca-plan-executor",
    config_path: configPath,
    data_dir: dataDir,
    socket_base: socketBase,
    plan_id: plan.created_at,
    user_intent: plan.user_intent,
    lrps,
    components: componentIds,
    policy_sections: finalPolicySections,
    connectors,
    docking: dockResults,
    activation_event_id: dockEvent.event_id ?? null,
    registration_event_id: registerEvent.event_id ?? null,
    inference_register_event_id: inferenceEvent.event_id ?? null,
    health,
  };

  writeActivation(activationPath, report);

  let conformance = null;
  if (componentIds.includes("conformance-runner") && options.runConformance !== false) {
    const runSh = join(dirname(binaryPath), "../../AEP-Components/conformance/runner/run.sh");
    const repoRunSh = join(dirname(fileURLToPath(import.meta.url)), "../../conformance/runner/run.sh");
    const runnerPath = existsSync(runSh) ? runSh : repoRunSh;
    if (existsSync(runnerPath)) {
      let cargoAvailable = false;
      try {
        execFileSync("bash", ["-lc", "command -v cargo >/dev/null"], { encoding: "utf8" });
        cargoAvailable = true;
      } catch {
        cargoAvailable = false;
      }
      if (!cargoAvailable) {
        conformance = {
          status: "skipped",
          runner: runnerPath,
          reason: "cargo not available in runtime image",
        };
      } else {
        try {
          const output = execFileSync("bash", [runnerPath], {
            cwd: join(dirname(runnerPath), "../.."),
            encoding: "utf8",
            timeout: options.conformanceTimeoutMs ?? 300000,
            env: { ...env, AEP_DATA_DIR: dataDir },
          });
          conformance = { status: "passed", runner: runnerPath, output_tail: output.slice(-2000) };
        } catch (err) {
          conformance = {
            status: "failed",
            runner: runnerPath,
            message: err.message,
            output_tail: String(err.stdout ?? err.stderr ?? "").slice(-2000),
          };
          if (!options.forceConformance) {
            throw new Error(`Conformance runner failed: ${err.message}`);
          }
        }
      }
    }
  }

  const reload = flushManifestRegistry(dataDir, options);
  return { report, reload, plan_path: activePlanPath(dataDir), conformance };
}