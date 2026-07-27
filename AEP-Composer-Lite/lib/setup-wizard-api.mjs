#!/usr/bin/env node

import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadLrpCatalog, listComplianceModules, listPlatformContracts } from "../../AEP-Components/wizard/lib/lrp.mjs";
import {
  INSTALL_METHODS,
  VALIDATION_ENGINE_MODES,
} from "../../AEP-Components/cca/lib/setup/install-plan.mjs";
import { loadComponentRegistry } from "../../AEP-Base-Node/registry/lib/registry.mjs";
import {
  INFERENCE_PROVIDERS,
  PROVIDER_DEFAULTS,
  saveInferenceConfig,
} from "../../AEP-Components/cca/lib/setup/inference.mjs";
import { resolveRuntime, fetchHealth, fetchDocking } from "./runtime.mjs";
import { ensureInstallWizardManifests } from "./ensure-setup-manifests.mjs";
import { buildUcbPublicStatus } from "./ucb-status.mjs";
import { generatePlanFromIntent } from "../../AEP-Components/cca/lib/plan-generator.mjs";
import {
  executeImplementationPlan,
  writeActivePlan,
} from "../../AEP-Components/cca/lib/plan-executor.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SETUP_AGENT_SCRIPT = join(__dirname, "../../AEP-Components/cca/setup-agent.mjs");

export async function buildSetupWizardCatalog(env = process.env) {
  const catalog = loadLrpCatalog();
  const registry = await loadComponentRegistry(env);
  return {
    version: "2.8.0",
    install_methods: INSTALL_METHODS,
    validation_engines: VALIDATION_ENGINE_MODES.map((m) => ({
      id: m.id,
      label: m.label,
      note: m.note ?? null,
      advantages: m.advantages ?? [],
      limitations: m.limitations ?? [],
    })),
    epscom: catalog.epscom,
    platform_contracts: listPlatformContracts(catalog),
    compliance_lrps: listComplianceModules(catalog),
    components: registry.components
      .filter((c) => c.bundled !== false || c.kind !== "template")
      .map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        default_enabled: Boolean(c.default_enabled),
        description: c.description ?? "",
        bundled: c.bundled !== false,
      })),
    inference: {
      providers: INFERENCE_PROVIDERS,
      defaults: PROVIDER_DEFAULTS,
    },
    caw_framework: {
      id: "caw-framework",
      gap_profiles: [
        "agent-sandbox",
        "coding-agent",
        "restricted",
        "dev-multi-repo",
        "compiled-runtime",
      ],
      note: "CAW sandboxes are authored in GAP (caw-*.gap) and compiled to $AEP_DATA/caw-framework/",
    },
  };
}

export function buildSetupWizardStatus(runtime = resolveRuntime()) {
  const health = fetchHealth(runtime, { selfTest: false });
  const docking = fetchDocking(runtime);
  return {
    activated: runtime.activation?.status === "activated",
    activation: runtime.activation,
    config_present: Boolean(runtime.config),
    health,
    docking,
    paths: {
      data_dir: runtime.dataDir,
      socket_base: runtime.socketBase,
      config_path: runtime.configPath,
      activation_path: runtime.activationPath,
    },
    ucb: buildUcbPublicStatus(runtime.dataDir),
  };
}

export function runSetupAgentActivation(dataDir, options = {}, env = process.env) {
  const manifestOpts = { configPath: options.config_path ?? join(dataDir, "base-node.json") };
  ensureInstallWizardManifests(dataDir, manifestOpts);
  const args = [SETUP_AGENT_SCRIPT, "--non-interactive"];
  if (options.force) args.push("--force");
  if (options.skip_if_activated) args.push("--skip-if-activated");
  if (options.lrps?.length) args.push(`--lrps=${options.lrps.join(",")}`);
  if (options.components?.length) args.push(`--components=${options.components.join(",")}`);
  if (options.validation_engine) args.push(`--validation-engine=${options.validation_engine}`);

  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: { ...env, AEP_DATA: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let report = null;
  const stdout = (result.stdout || "").trim();
  const jsonLine = stdout.split("\n").reverse().find((line) => line.trim().startsWith("{"));
  if (jsonLine) {
    try {
      report = JSON.parse(jsonLine);
    } catch {
      report = null;
    }
  }

  return {
    ok: result.status === 0,
    status: result.status,
    stdout,
    stderr: (result.stderr || "").trim(),
    report,
  };
}

export function saveWizardInferenceConfig(dataDir, inference) {
  if (!inference?.provider) {
    throw new Error("inference.provider is required");
  }
  return saveInferenceConfig(dataDir, inference, { configured_by: "install-wizard" });
}

export async function runCcaBootstrapFromIntent(dataDir, intent, env = process.env) {
  const text = String(intent ?? "").trim();
  if (!text) {
    throw new Error("cca_intent is required");
  }
  const activationPath = join(dataDir, "activation.json");
  const alreadyActivated = existsSync(activationPath);
  const generated = await generatePlanFromIntent(text, dataDir, env);
  writeActivePlan(dataDir, generated.plan);
  const result = await executeImplementationPlan(generated.plan, {
    dataDir,
    runConformance: false,
    overlayOnly: alreadyActivated,
    preserveExistingConfig: alreadyActivated,
  });
  return {
    ok: true,
    plan: generated.plan,
    report: result.report,
    overlay: Boolean(result.overlay),
  };
}