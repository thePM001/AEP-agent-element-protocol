#!/usr/bin/env node
/**
 * Setup agent install plan: where/how to deploy AEP + dynAEP and validation engine choice.
 */

export const INSTALL_METHODS = [
  {
    id: "docker-compose",
    label: "Docker Compose (recommended)",
    description:
      "Full offline protocol image. Base Node, dynAEP, Composer Lite (:8424) and registry in one container.",
  },
  {
    id: "docker-run",
    label: "Docker run (single container)",
    description: "Manual `docker run` with a persistent /data/aep volume.",
  },
  {
    id: "local-source",
    label: "Local source (clone + cargo + source build)",
    description:
      "Build Rust workspace and TypeScript SDK from this repository. Run wizard then setup-agent on the host. No npm registry installs.",
  },
  {
    id: "already-installed",
    label: "Already installed (activate only)",
    description: "Protocol binaries and image are present. Run setup-agent to activate configuration.",
  },
];

export const VALIDATION_ENGINE_MODES = [
  {
    id: "nla-built",
    label: "Acquire NLA-built AEP Validation Engine",
    advantages: [
      "Production-grade 15-step evaluation chain on the validation dock",
      "Conformance-certified against CC-01..CC-12 public tier checks",
      "Full scanner bundle and policy lattice integration out of the box",
      "Operator support and upgrade path from NLA",
      "Highest trust score defaults for dynAEP wire events",
    ],
    note: "Contact NLA for acquisition. Dock via validation_engine per AEP-Docks/docs/DOCKING-PORTS.md.",
  },
  {
    id: "build-own",
    label: "Build your own validation engine",
    advantages: [
      "Full source control and custom scanner modules",
      "Air-gapped deployment without vendor dependency",
      "Integrate proprietary policy modules and org-specific gates",
      "Wire to the validation_engine dock socket on your Base Node",
      "Tune eval chain steps to your risk model",
    ],
    note: "See docs/DOCKING-PORTS.md and AEP-Components/dynAEP/ for wire protocol. SDKs: AEP-SDKs/. Register on validation dock at activation.",
  },
  {
    id: "none",
    label: "Try without a dedicated validation engine",
    advantages: [
      "Fastest path to explore AEP 2.8 and Composer Lite",
      "Base Node self-test, lattice memory and inference dock still work",
      "Good for local development and learning dynAEP wiring",
      "No extra binary or license to procure before first run",
    ],
    limitations: [
      "No full 15-step evaluation chain enforcement",
      "Reduced policy depth on validation dock (dynAEP events only)",
      "Not suitable for production governance without adding an engine later",
    ],
    note: "You can add an NLA-built or custom engine later without reinstalling Base Node.",
  },
];

export function normalizeInstallMethod(raw) {
  const id = String(raw ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (id === "npm-package") {
    return "local-source";
  }
  const match = INSTALL_METHODS.find((m) => m.id === id);
  return match?.id ?? "docker-compose";
}

export function normalizeValidationEngineMode(raw) {
  const id = String(raw ?? "").trim().toLowerCase().replace(/_/g, "-");
  const match = VALIDATION_ENGINE_MODES.find((m) => m.id === id);
  return match?.id ?? "none";
}

export function resolveInstallPlan(env = process.env, paths = {}) {
  const method = normalizeInstallMethod(env.AEP_INSTALL_METHOD);
  const validationEngine = normalizeValidationEngineMode(env.AEP_VALIDATION_ENGINE);
  const dataDir = env.AEP_DATA || paths.dataDir || "/data/aep";
  const inDocker = env.AEP_IN_DOCKER === "1" || env.AEP_IN_DOCKER === "true";

  const validation_engine = buildValidationEnginePlan(validationEngine);

  return {
    method,
    validation_engine,
    data_dir: dataDir,
    dynaep_included: true,
    install_target: inDocker ? "container" : "host",
    notes: env.AEP_INSTALL_NOTES || null,
    configured_by: "env",
    configured_at: new Date().toISOString(),
  };
}

export function buildValidationEnginePlan(mode) {
  const normalized = normalizeValidationEngineMode(mode);
  const meta = VALIDATION_ENGINE_MODES.find((m) => m.id === normalized);
  return {
    mode: normalized,
    dock: "validation_engine",
    dedicated_engine: normalized !== "none",
    label: meta?.label ?? normalized,
    advantages: meta?.advantages ?? [],
    limitations: meta?.limitations ?? [],
    note: meta?.note ?? null,
  };
}

export function printInstallMethodMenu() {
  console.log("\nWhere and how do you want to install AEP + dynAEP?\n");
  for (const [index, method] of INSTALL_METHODS.entries()) {
    console.log(`  ${index + 1}. ${method.label}`);
    console.log(`     ${method.description}`);
  }
  console.log("");
}

export function printValidationEngineMenu() {
  console.log("\nAEP Validation Engine plan\n");
  console.log(
    "The validation engine docks on the Base Node validation_engine port and runs the",
  );
  console.log(
    "evaluation chain, scanners and policy lattice checks for dynAEP wire events.\n",
  );
  for (const [index, mode] of VALIDATION_ENGINE_MODES.entries()) {
    console.log(`  ${index + 1}. ${mode.label}`);
    for (const advantage of mode.advantages) {
      console.log(`     + ${advantage}`);
    }
    if (mode.limitations?.length) {
      for (const limitation of mode.limitations) {
        console.log(`     - ${limitation}`);
      }
    }
    if (mode.note) {
      console.log(`     → ${mode.note}`);
    }
    console.log("");
  }
}

export async function promptInstallPlan(rl, prompt, paths = {}) {
  printInstallMethodMenu();
  const methodAnswer = await prompt(
    rl,
    "Install method (1-4 or id)",
    process.env.AEP_IN_DOCKER === "1" ? "1" : "3",
  );
  const method = resolveMethodFromAnswer(methodAnswer);

  let dataDir = paths.dataDir;
  if (method === "docker-compose" || method === "docker-run") {
    dataDir = await prompt(rl, "Persistent data volume path", paths.dataDir || "/data/aep");
  } else if (method === "local-source") {
    dataDir = await prompt(
      rl,
      "Local AEP data directory",
      paths.dataDir || joinHome(".aep"),
    );
  }

  const notes = await prompt(rl, "Install notes (optional)", "");

  return {
    method,
    validation_engine: null,
    data_dir: dataDir,
    dynaep_included: true,
    install_target:
      method === "docker-compose" || method === "docker-run" ? "container" : "host",
    notes: notes || null,
    configured_by: "setup-agent",
    configured_at: new Date().toISOString(),
  };
}

export async function promptValidationEnginePlan(rl, prompt) {
  printValidationEngineMenu();
  const answer = await prompt(rl, "Validation engine plan (1-3 or id)", "3");
  const mode = resolveValidationEngineFromAnswer(answer);
  return buildValidationEnginePlan(mode);
}

function resolveMethodFromAnswer(answer) {
  const trimmed = String(answer ?? "").trim().toLowerCase();
  const asNumber = Number.parseInt(trimmed, 10);
  if (Number.isFinite(asNumber) && asNumber >= 1 && asNumber <= INSTALL_METHODS.length) {
    return INSTALL_METHODS[asNumber - 1].id;
  }
  return normalizeInstallMethod(trimmed);
}

function resolveValidationEngineFromAnswer(answer) {
  const trimmed = String(answer ?? "").trim().toLowerCase();
  const asNumber = Number.parseInt(trimmed, 10);
  if (Number.isFinite(asNumber) && asNumber >= 1 && asNumber <= VALIDATION_ENGINE_MODES.length) {
    return VALIDATION_ENGINE_MODES[asNumber - 1].id;
  }
  return normalizeValidationEngineMode(trimmed);
}

function joinHome(segment) {
  const home = process.env.HOME || "/root";
  return `${home}/${segment}`.replace(/\/+/g, "/").replace(/\/$/, "");
}

export function applyValidationEngineToConfig(config, validationPlan) {
  if (!validationPlan) return config;
  return {
    ...config,
    validation_engine: {
      mode: validationPlan.mode,
      dock: validationPlan.dock,
      dedicated_engine: validationPlan.dedicated_engine,
    },
  };
}

export function recommendedLrpAdjustments(validationPlan, lrps) {
  const next = [...lrps];
  if (!validationPlan || validationPlan.mode === "none") {
    return next;
  }
  if (!next.includes("aep-275-eval-chain")) {
    next.push("aep-275-eval-chain");
  }
  return next;
}
