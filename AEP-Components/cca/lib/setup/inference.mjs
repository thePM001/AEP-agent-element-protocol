#!/usr/bin/env node
/**
 * Setup agent LLM / Inference Engine configuration.
 * Canonical env vars - see AEP-User-Experience/docs/SETUP-AGENT.md
 */

import {
  writeFileSync,
  readFileSync,
  chmodSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { latticeDockRequest } from "../../../lattice-channels/lib/lattice-transport.mjs";

export const INFERENCE_PROVIDERS = [
  "llama_cpp",
  "openrouter",
  "deepseek",
  "anthropic",
  "custom",
];

const LEGACY_PROVIDER_ALIASES = {
  ollama: "llama_cpp",
  openai: "custom",
};

export const INFERENCE_CONFIG_FILE = "inference-config.json";
export const INFERENCE_SECRETS_FILE = "inference-secrets.env";

export const PROVIDER_DEFAULTS = {
  llama_cpp: {
    model: "local",
    base_url: "http://127.0.0.1:8080/v1",
    api_key_env: null,
  },
  anthropic: {
    model: "claude-sonnet-4-20250514",
    base_url: "https://api.anthropic.com",
    api_key_env: "ANTHROPIC_API_KEY",
  },
  openrouter: {
    model: "anthropic/claude-sonnet-4",
    base_url: "https://openrouter.ai/api/v1",
    api_key_env: "OPENROUTER_API_KEY",
  },
  deepseek: {
    model: "deepseek-chat",
    base_url: "https://api.deepseek.com/v1",
    api_key_env: "DEEPSEEK_API_KEY",
  },
  custom: {
    model: "default",
    base_url: "http://127.0.0.1:8080/v1",
    api_key_env: "AEP_INFERENCE_API_KEY",
  },
};

export function normalizeInferenceProvider(provider) {
  const raw = String(provider ?? "").toLowerCase();
  return LEGACY_PROVIDER_ALIASES[raw] ?? raw;
}

export function providerNeedsApiKey(provider) {
  return Boolean(PROVIDER_DEFAULTS[normalizeInferenceProvider(provider)]?.api_key_env);
}

export function maskApiKey(value) {
  if (!value || typeof value !== "string") return null;
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function inferenceConfigPath(dataDir) {
  return join(dataDir, INFERENCE_CONFIG_FILE);
}

function inferenceSecretsPath(dataDir) {
  return join(dataDir, INFERENCE_SECRETS_FILE);
}

export function parseEnvFile(content) {
  const out = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

export function readInferenceSecrets(dataDir) {
  const path = inferenceSecretsPath(dataDir);
  if (!existsSync(path)) return {};
  try {
    return parseEnvFile(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

export function writeInferenceSecrets(dataDir, entries) {
  const path = inferenceSecretsPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  const lines = Object.entries(entries)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `${key}=${value}`);
  writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* windows */
  }
}

export function loadSavedInferenceConfig(dataDir) {
  if (!dataDir) return null;

  const configPath = inferenceConfigPath(dataDir);
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      /* fall through */
    }
  }

  const baseNodePath = join(dataDir, "base-node.json");
  if (existsSync(baseNodePath)) {
    try {
      const baseNode = JSON.parse(readFileSync(baseNodePath, "utf8"));
      if (baseNode.inference_engine) {
        return {
          ...baseNode.inference_engine,
          source: "base-node.json",
        };
      }
    } catch {
      /* fall through */
    }
  }

  return null;
}

export function hydrateInferenceApiKey(inference, dataDir, env = process.env) {
  if (!inference?.api_key_env || !dataDir) return inference;
  if (env[inference.api_key_env]) return inference;

  const secrets = readInferenceSecrets(dataDir);
  const fromFile = secrets[inference.api_key_env];
  if (fromFile) {
    env[inference.api_key_env] = fromFile;
  }
  return inference;
}

export function getInferencePublicState(dataDir) {
  const saved = loadSavedInferenceConfig(dataDir);
  const provider = normalizeInferenceProvider(saved?.provider ?? "llama_cpp");
  const defaults = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.llama_cpp;
  const model = saved?.model ?? defaults.model;
  const base_url = saved?.base_url ?? defaults.base_url;
  const api_key_env = saved?.api_key_env ?? defaults.api_key_env;
  const secrets = readInferenceSecrets(dataDir);
  const apiKeyValue = api_key_env ? secrets[api_key_env] ?? null : null;

  return {
    provider,
    model,
    base_url,
    api_key_env,
    api_key_configured: Boolean(apiKeyValue),
    api_key_hint: maskApiKey(apiKeyValue),
    configured_by: saved?.configured_by ?? null,
    updated_at: saved?.updated_at ?? null,
    providers: INFERENCE_PROVIDERS.map((id) => ({
      id,
      ...PROVIDER_DEFAULTS[id],
      needs_api_key: providerNeedsApiKey(id),
    })),
  };
}

export function saveInferenceConfig(
  dataDir,
  { provider, model, base_url, api_key },
  { configured_by = "composer-lite" } = {},
) {
  const normalized = normalizeInferenceProvider(provider);
  if (!INFERENCE_PROVIDERS.includes(normalized)) {
    throw new Error(
      `Invalid inference provider "${provider}". Use: ${INFERENCE_PROVIDERS.join(", ")}`,
    );
  }

  const defaults = PROVIDER_DEFAULTS[normalized];
  const resolvedModel = model?.trim() || defaults.model;
  const resolvedBaseUrl = base_url?.trim() || defaults.base_url;
  const api_key_env = defaults.api_key_env;

  const record = {
    provider: normalized,
    model: resolvedModel,
    base_url: resolvedBaseUrl,
    api_key_env,
    dock: "inference_engine",
    configured_by,
    updated_at: new Date().toISOString(),
  };

  const configPath = inferenceConfigPath(dataDir);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
  });
  try {
    chmodSync(configPath, 0o600);
  } catch {
    /* windows */
  }

  if (api_key_env) {
    const secrets = readInferenceSecrets(dataDir);
    const nextKey =
      typeof api_key === "string" && api_key.trim()
        ? api_key.trim()
        : secrets[api_key_env];
    if (!nextKey) {
      throw new Error(
        `API key required for provider "${normalized}". Set ${api_key_env}.`,
      );
    }
    writeInferenceSecrets(dataDir, { ...secrets, [api_key_env]: nextKey });
  }

  return record;
}

export function resolveInferenceConfig(env = process.env, dataDir = null) {
  const saved = dataDir ? loadSavedInferenceConfig(dataDir) : null;

  if (saved?.provider) {
    const inference = {
      provider: normalizeInferenceProvider(saved.provider),
      model: saved.model,
      base_url: saved.base_url,
      api_key_env: saved.api_key_env ?? PROVIDER_DEFAULTS[saved.provider]?.api_key_env ?? null,
      dock: "inference_engine",
      configured_by: saved.configured_by ?? "inference-config.json",
    };
    return hydrateInferenceApiKey(inference, dataDir, env);
  }

  const provider = normalizeInferenceProvider(
    env.AEP_SETUP_LLM_PROVIDER || env.AEP_INFERENCE_PROVIDER || "llama_cpp",
  );

  if (!INFERENCE_PROVIDERS.includes(provider)) {
    throw new Error(
      `Invalid inference provider "${provider}". Use: ${INFERENCE_PROVIDERS.join(", ")}`,
    );
  }

  const defaults = PROVIDER_DEFAULTS[provider];
  const model =
    env.AEP_SETUP_LLM_MODEL || env.AEP_INFERENCE_MODEL || defaults.model;
  const base_url =
    env.AEP_SETUP_LLM_BASE_URL ||
    env.AEP_INFERENCE_BASE_URL ||
    defaults.base_url;
  const api_key_env =
    env.AEP_SETUP_LLM_API_KEY_ENV ||
    env.AEP_INFERENCE_API_KEY_ENV ||
    defaults.api_key_env;

  const inference = {
    provider,
    model,
    base_url,
    api_key_env,
    dock: "inference_engine",
    configured_by: "setup-agent",
  };
  return hydrateInferenceApiKey(inference, dataDir, env);
}

export async function promptInferenceConfig(rl, prompt, _promptYesNo) {
  const env = process.env;
  const hasEnv =
    env.AEP_SETUP_LLM_PROVIDER ||
    env.AEP_INFERENCE_PROVIDER ||
    env.AEP_SETUP_LLM_MODEL ||
    env.AEP_INFERENCE_MODEL;

  if (hasEnv) {
    return resolveInferenceConfig(env);
  }

  console.log("\nInference Engine (LLM) for setup agent:");
  const provider = (
    await prompt(
      rl,
      "Provider (llama_cpp/openrouter/anthropic/custom)",
      "llama_cpp",
    )
  ).toLowerCase();
  process.env.AEP_SETUP_LLM_PROVIDER = provider;

  const cfg = resolveInferenceConfig(process.env);
  const model = await prompt(rl, "Model", cfg.model);
  const base_url = await prompt(rl, "Base URL", cfg.base_url);

  process.env.AEP_SETUP_LLM_MODEL = model;
  process.env.AEP_SETUP_LLM_BASE_URL = base_url;

  if (cfg.api_key_env) {
    const hasKey = Boolean(process.env[cfg.api_key_env]);
    if (!hasKey) {
      console.log(
        `WARNING: ${cfg.api_key_env} is not set. LLM calls will fail until you export it.`,
      );
    }
  }

  return resolveInferenceConfig(process.env);
}

export function writeInferenceEnv(envPath, inference) {
  const lines = [
    `AEP_INFERENCE_PROVIDER=${inference.provider}`,
    `AEP_INFERENCE_MODEL=${inference.model}`,
    `AEP_INFERENCE_BASE_URL=${inference.base_url}`,
  ];
  if (inference.api_key_env) {
    lines.push(`AEP_INFERENCE_API_KEY_ENV=${inference.api_key_env}`);
  }
  writeFileSync(envPath, `${lines.join("\n")}\n`, { mode: 0o600 });
  try {
    chmodSync(envPath, 0o600);
  } catch {
    /* windows */
  }
}

export function buildInferenceRegisterEvent(inference) {
  return {
    agent_id: "AG-SETUP-AGENT",
    channel_id: "ch-inference-engine",
    contract_id: "dynaep-action-lattice",
    event_type: "INFERENCE_ENGINE_REGISTER",
    session_id: "setup-session",
    docking_port: "validation_engine",
    trust_score: 850,
    payload: {
      target_dock: "inference_engine",
      provider: inference.provider,
      model: inference.model,
      base_url: inference.base_url,
      api_key_env: inference.api_key_env,
      configured_by: inference.configured_by,
    },
  };
}

export function registerInferenceEngineWithDock(socketBase, inference, opts = {}) {
  return latticeDockRequest(
    socketBase,
    "validation_engine",
    buildInferenceRegisterEvent(inference),
    opts,
  );
}