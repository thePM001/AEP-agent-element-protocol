import { latticeGatedFetch } from "../../lattice-channels/lib/lattice-transport.mjs";
import { resolveInferenceConfig, readInferenceSecrets } from "../setup/inference.mjs";
import { translateDelegateRequest } from "./translator.mjs";
import { ingestForeignPayload } from "./bridge.mjs";

function resolveApiKey(inference, dataDir, env) {
  if (!inference.api_key_env) return null;
  const secrets = readInferenceSecrets(dataDir);
  return secrets[inference.api_key_env] ?? env[inference.api_key_env] ?? null;
}

async function callOpenAiCompatible(runtime, inference, apiKey, prompt, schema, meta) {
  const url = `${inference.base_url.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model: inference.model,
    messages: [{ role: "user", content: prompt }],
  };
  if (schema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "ucb_delegate_response",
        strict: true,
        schema,
      },
    };
  }
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await latticeGatedFetch(
    runtime.socketBase,
    meta,
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
    {
      configPath: runtime.configPath,
      latticeLogBin: runtime.latticeLogBin,
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`delegate LLM HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  if (schema) {
    try {
      return JSON.parse(content);
    } catch {
      throw new Error("delegate LLM returned non-JSON content for schema request");
    }
  }
  return { content, raw: data };
}

export async function delegateToForeignModel(body, runtime, env = process.env) {
  const req = translateDelegateRequest(body);
  if (!req.prompt) {
    return { ok: false, error: "prompt or message required for delegation" };
  }

  const inference = resolveInferenceConfig(env, runtime.dataDir);
  const apiKey = resolveApiKey(inference, runtime.dataDir, env);
  const meta = {
    agentId: req.agent_id,
    channelId: `ch-ucb-delegate-${req.protocol}`,
    contractId: "lattice-channel-default",
    eventType: "UCB_DELEGATE",
    sessionId: req.session_id,
    gateway: inference.provider,
    trustScore: 720,
    payloadExtra: {
      capability_scope: req.capability_scope,
      model: inference.model,
      protocol: req.protocol,
    },
  };

  let modelOutput;
  try {
    modelOutput = await callOpenAiCompatible(
      runtime,
      inference,
      apiKey,
      req.prompt,
      req.schema,
      meta,
    );
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      inference: {
        provider: inference.provider,
        model: inference.model,
        base_url: inference.base_url,
      },
    };
  }

  let ingest = null;
  if (req.ingest_result) {
    ingest = await ingestForeignPayload(
      {
        protocol: req.protocol,
        session_id: req.session_id,
        agent_id: req.agent_id,
        event_type: "UCB_DELEGATE_RESULT",
        provenance: {
          source: req.protocol,
          protocol: "ucb/1.0",
          session_id: req.session_id,
          timestamp_ms: Date.now(),
        },
        payload: typeof modelOutput === "object" ? modelOutput : { content: modelOutput },
      },
      runtime,
    );
    if (!ingest.ok) {
      return {
        ok: false,
        status: "delegate_ingest_failed",
        session_id: req.session_id,
        protocol: req.protocol,
        inference: {
          provider: inference.provider,
          model: inference.model,
          base_url: inference.base_url,
        },
        result: modelOutput,
        ingest,
        error: ingest.error ?? "delegate result ingest rejected",
      };
    }
  }

  return {
    ok: true,
    status: "delegated",
    session_id: req.session_id,
    protocol: req.protocol,
    capability_scope: req.capability_scope,
    inference: {
      provider: inference.provider,
      model: inference.model,
      base_url: inference.base_url,
    },
    result: modelOutput,
    ingest,
  };
}