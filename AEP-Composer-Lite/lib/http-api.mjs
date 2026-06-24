import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import {
  resolveRuntime,
  fetchHealth,
  fetchDocking,
  fetchLatticeEvents,
} from "./runtime.mjs";
import { buildPolicyLatticeView } from "./policy-lattice.mjs";
import { buildHyperlatticeView } from "./hyperlattice/hyperlattice.mjs";
import { validateComposerTopology } from "./hyperlattice/composer-protocol.mjs";
import { createAgentMeshBundle } from "./agentmesh-preview.mjs";
import {
  getInferencePublicState,
  saveInferenceConfig,
} from "../../AEP-Components/cca/lib/setup/inference.mjs";
import {
  getMeshPublicState,
  upsertMeshPeer,
  removeMeshPeer,
} from "../../AEP-Components/wizard/lib/mesh.mjs";
import {
  loadGraph,
  saveGraph,
  validateGraph,
  NODE_PALETTE,
  mergePalette,
} from "./graph-store.mjs";
import {
  loadComponentRegistry,
  loadInstalledExtensions,
  writeInstalledExtensions,
  resolvePaletteExtensions,
} from "../../AEP-Base-Node/registry/lib/registry.mjs";
import { getCcaPublicState, runCcaChat } from "./cca.mjs";
import { buildRegistryContext } from "../../AEP-Components/cca/lib/registry-context.mjs";
import { probeEnvironment } from "../../AEP-Components/cca/lib/environment-probe.mjs";
import {
  loadActivePlan,
  writeActivePlan,
  executeImplementationPlan,
} from "../../AEP-Components/cca/lib/plan-executor.mjs";
import { validatePlanAgainstRegistry } from "../../AEP-Components/cca/lib/plan-schema.mjs";
import { graphToPlan } from "../../AEP-Components/cca/lib/graph-to-plan.mjs";
import { attachTerminalWebSocket } from "./terminal-ws.mjs";
import { getIntegrationsState, resolveAgentstreamUrl } from "./integrations.mjs";
import { readMultipartUpload } from "./cca-upload.mjs";
import { latticeGatedFetch } from "../../AEP-Components/lattice-channels/lib/lattice-transport.mjs";
import { wasmLatticeEvaluate, probeWasmSandbox } from "./wasm-lattice.mjs";
import { buildLatticeBlastOverlay } from "../../AEP-Components/semantic-topology/lib/lattice-overlay.mjs";
import { listIntentSnapshots } from "../../AEP-Components/intent-ledger/lib/ledger.mjs";
import { invokePolicyBuilder } from "./policy-builder-service.mjs";
import {
  buildSetupWizardCatalog,
  buildSetupWizardStatus,
  runSetupAgentActivation,
  saveWizardInferenceConfig,
  runCcaBootstrapFromIntent,
} from "./setup-wizard-api.mjs";
import { authorizeComposerLiteRequest, isLocalComposerRequest } from "./composer-lite-auth.mjs";
import { composerLiteBasePath, stripComposerLiteBasePath } from "./composer-lite-paths.mjs";
import { readUcbRecoveryKey } from "./ucb-status.mjs";
import { ensureComposerLiteTaskManifest } from "./ensure-setup-manifests.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

export function jsonResponse(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

const MAX_JSON_BODY_BYTES = 512 * 1024;

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_JSON_BODY_BYTES) {
        reject(new Error("request body exceeds 256KB limit"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

export function runSetupAgent(dataDir, options = {}) {
  return runSetupAgentActivation(dataDir, {
    skip_if_activated: options.skip_if_activated ?? true,
    force: options.force ?? false,
    lrps: options.lrps,
    components: options.components,
    validation_engine: options.validation_engine,
  }, process.env);
}

function serveStatic(res, relPath) {
  const safe = String(relPath).replace(/^\/+/, "");
  if (!safe || safe.includes("..")) {
    jsonResponse(res, 404, { error: "not found" });
    return;
  }
  const path = resolve(PUBLIC_DIR, safe);
  const publicRoot = resolve(PUBLIC_DIR);
  if ((path !== publicRoot && !path.startsWith(`${publicRoot}/`)) || !existsSync(path)) {
    jsonResponse(res, 404, { error: "not found" });
    return;
  }
  const ext = extname(path);
  res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
  res.end(readFileSync(path));
}

function serveInstallWizard(res) {
  const path = join(PUBLIC_DIR, "install-wizard.html");
  if (!existsSync(path)) {
    jsonResponse(res, 404, { error: "install wizard not found" });
    return;
  }
  let html = readFileSync(path, "utf8");
  const base = composerLiteBasePath();
  const baseHref = base ? `${base}/` : "/";
  if (!html.includes("<base ")) {
    html = html.replace("<head>", `<head>\n  <base href="${baseHref}" />`);
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
}

function serveIndex(res) {
  const path = join(PUBLIC_DIR, "index.html");
  if (!existsSync(path)) {
    jsonResponse(res, 404, { error: "not found" });
    return;
  }
  let html = readFileSync(path, "utf8");
  const base = composerLiteBasePath();
  const baseHref = base ? `${base}/` : "/";
  if (!html.includes("<base ")) {
    html = html.replace("<head>", `<head>\n  <base href="${baseHref}" />`);
  }
  const terminalCwd = process.env.COMPOSER_LITE_TERMINAL_CWD || "/opt/aep";
  const wsPath = base ? `${base}/api/terminal/ws` : "/api/terminal/ws";
  if (!html.includes("data-terminal-cwd")) {
    html = html.replace(
      "<html ",
      `<html data-terminal-cwd="${terminalCwd}" data-terminal-ws="" `,
    );
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
}

export async function buildSnapshot() {
  const runtime = resolveRuntime();
  const health = fetchHealth(runtime, { selfTest: false });
  const docking = fetchDocking(runtime);
  const events = fetchLatticeEvents(runtime, 40);
  const lrps = runtime.config?.base_node?.lrps ?? [];
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const composerGraph = loadGraph(runtime.dataDir);
  const hyperlattice = buildHyperlatticeView({
    repoRoot,
    activeRegulationLrps: lrps,
    composerGraph,
  });
  const policyLattice = hyperlattice;
  const agentmesh = createAgentMeshBundle(
    "AG-COMPOSER-LITE",
    runtime.activation ? 750 : 500,
  );
  const integrations = await getIntegrationsState(runtime);

  return {
    generated_at: new Date().toISOString(),
    activation: runtime.activation,
    integrations,
    config_present: Boolean(runtime.config),
    health,
    docking,
    lattice: {
      events,
      event_count: health?.action_lattice_events ?? events.length,
      memory_attractors: health?.lattice_memory_attractors ?? 0,
      memory_dim: health?.lattice_memory_dim ?? 128,
      vector_store: health?.vector_store ?? "sqlite-vec+usearch",
    },
    hyperlattice,
    /** @deprecated Use hyperlattice. Same object; policy_lattice name is legacy. */
    policy_lattice: policyLattice,
    agentmesh,
    inference: getInferencePublicState(runtime.dataDir),
    paths: {
      data_dir: runtime.dataDir,
      socket_base: runtime.socketBase,
      lattice_db: runtime.latticeDb,
    },
  };
}

export async function handleComposerLiteRequest(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  url.pathname = stripComposerLiteBasePath(url.pathname);

  const auth = authorizeComposerLiteRequest(req, url.pathname, req.method ?? "GET");
  if (!auth.allowed) {
    jsonResponse(res, 403, { ok: false, error: auth.message, reason: auth.reason });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/snapshot") {
    jsonResponse(res, 200, await buildSnapshot());
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/health") {
    const runtime = resolveRuntime();
    const baseNode = fetchHealth(runtime, { selfTest: false });
    jsonResponse(res, 200, {
      service: "aep-composer-lite",
      wasm_composer: true,
      status: baseNode.status === "ok" ? "ok" : baseNode.status ?? "ok",
      version: "2.8.0",
      port_policy: "NLA-84xx",
      standalone: true,
      internal_agent_composer: false,
      base_node: baseNode,
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/integrations") {
    const runtime = resolveRuntime();
    jsonResponse(res, 200, await getIntegrationsState(runtime));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/registry") {
    const runtime = resolveRuntime();
    const registry = await loadComponentRegistry(process.env);
    const installed = loadInstalledExtensions(runtime.dataDir);
    jsonResponse(res, 200, {
      registry,
      installed,
      repository: registry.repository,
      offline: process.env.AEP_COMPONENTS_FETCH !== "1",
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/registry/install") {
    const runtime = resolveRuntime();
    const body = await readJsonBody(req);
    const componentId = String(body.component_id || "").trim();
    if (!componentId) {
      jsonResponse(res, 400, { error: "component_id required" });
      return;
    }
    const registry = await loadComponentRegistry(process.env);
    const comp = registry.components.find((c) => c.id === componentId);
    if (!comp) {
      jsonResponse(res, 404, { error: "unknown component_id" });
      return;
    }
    const installed = loadInstalledExtensions(runtime.dataDir);
    const ids = new Set(installed.installed.map((e) => e.id));
    ids.add(componentId);
    const saved = writeInstalledExtensions(
      runtime.dataDir,
      [...ids].map((id) => ({ id, enabled_at: new Date().toISOString() })),
    );
    jsonResponse(res, 200, { ok: true, installed: saved, component: comp });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/palette") {
    const runtime = resolveRuntime();
    const palette = mergePalette(
      NODE_PALETTE,
      resolvePaletteExtensions(runtime.dataDir),
    );
    jsonResponse(res, 200, { palette });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/graph") {
    const runtime = resolveRuntime();
    jsonResponse(res, 200, loadGraph(runtime.dataDir));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/intents") {
    const runtime = resolveRuntime();
    const limit = Math.min(
      50,
      Math.max(1, Number(url.searchParams.get("limit") ?? "20") || 20),
    );
    jsonResponse(res, 200, { intents: listIntentSnapshots(runtime.dataDir, limit) });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/graph/blast-overlay") {
    const runtime = resolveRuntime();
    const intentId = url.searchParams.get("intent_id")?.trim();
    if (!intentId) {
      jsonResponse(res, 400, { error: "intent_id query parameter required" });
      return;
    }
    const lrpsRaw = url.searchParams.get("lrps");
    const activeLrps = lrpsRaw
      ? lrpsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    try {
      const overlay = buildLatticeBlastOverlay({
        intentId,
        dataDir: runtime.dataDir,
        activeLrps,
      });
      jsonResponse(res, 200, overlay);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      jsonResponse(res, 404, { error: message });
    }
    return;
  }
  if (req.method === "PUT" && url.pathname === "/api/graph") {
    const runtime = resolveRuntime();
    const body = await readJsonBody(req);
    validateGraph(body);
    const topo = validateComposerTopology(body);
    if (!topo.valid) {
      jsonResponse(res, 400, {
        ok: false,
        error: "composer protocol validation failed",
        topology_validation: topo,
      });
      return;
    }
    const saved = saveGraph(runtime.dataDir, body);
    if (body.plan_sync) {
      const existing = loadActivePlan(runtime.dataDir);
      if (existing) {
        const ctx = await buildRegistryContext(runtime.dataDir, process.env);
        writeActivePlan(
          runtime.dataDir,
          graphToPlan(existing, saved, ctx.components),
        );
      }
    }
    jsonResponse(res, 200, { ok: true, graph: saved });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/cca") {
    const runtime = resolveRuntime();
    const state = await getCcaPublicState(runtime.dataDir);
    const plan = loadActivePlan(runtime.dataDir);
    jsonResponse(res, 200, { ...state, active_plan: plan ? { created_at: plan.created_at, user_intent: plan.user_intent } : null });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/cca/context") {
    const runtime = resolveRuntime();
    const context = await buildRegistryContext(runtime.dataDir, process.env);
    jsonResponse(res, 200, context);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/cca/environment") {
    const env = await probeEnvironment(process.env);
    jsonResponse(res, 200, env);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/cca/plan") {
    const runtime = resolveRuntime();
    const plan = loadActivePlan(runtime.dataDir);
    jsonResponse(res, 200, { plan });
    return;
  }
  if (req.method === "PUT" && url.pathname === "/api/cca/plan") {
    const runtime = resolveRuntime();
    const body = await readJsonBody(req);
    if (!body?.plan_version) {
      jsonResponse(res, 400, { error: "plan object required" });
      return;
    }
    const path = writeActivePlan(runtime.dataDir, body);
    jsonResponse(res, 200, { ok: true, path });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/cca/plan/validate") {
    const runtime = resolveRuntime();
    const body = await readJsonBody(req);
    const plan = body.plan ?? loadActivePlan(runtime.dataDir);
    if (!plan) {
      jsonResponse(res, 400, { error: "no plan to validate" });
      return;
    }
    const context = await buildRegistryContext(runtime.dataDir, process.env);
    const validation = validatePlanAgainstRegistry(plan, context.components, context.environment);
    jsonResponse(res, 200, validation);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/cca/plan/execute") {
    const runtime = resolveRuntime();
    const body = await readJsonBody(req);
    const plan = body.plan ?? loadActivePlan(runtime.dataDir);
    if (!plan) {
      jsonResponse(res, 400, { error: "no plan to execute" });
      return;
    }
    try {
      const result = await executeImplementationPlan(plan, { dataDir: runtime.dataDir });
      jsonResponse(res, 200, { ok: true, report: result.report, plan_path: result.plan_path });
    } catch (err) {
      jsonResponse(res, 400, { ok: false, error: err.message });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/cca/upload") {
    const runtime = resolveRuntime();
    try {
      const uploaded = await readMultipartUpload(req, { dataDir: runtime.dataDir });
      jsonResponse(res, 200, uploaded);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("4MB") ? 413 : 400;
      jsonResponse(res, status, { error: message });
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/fabric/traces") {
    const runtime = resolveRuntime();
    const limit = Math.min(256, Math.max(1, Number(url.searchParams.get("limit") ?? "50") || 50));
    const events = fetchLatticeEvents(runtime, limit);
    const traces = events.map((ev, idx) => ({
      id: ev.id || ev.event_id || `trace-${idx}`,
      stage: ev.stage || ev.pad_stage || null,
      kind: ev.kind || ev.type || "lattice_event",
      payload: ev,
      emitted_at: ev.timestamp || ev.emitted_at || ev.created_at || null,
    }));
    jsonResponse(res, 200, {
      count: traces.length,
      buffer_total: traces.length,
      traces,
    });
    return;
  }
  if (req.method === "POST" && /^\/api\/integration\/hub\/[^/]+\/action$/.test(url.pathname)) {
    const runtime = resolveRuntime();
    const connectorId = decodeURIComponent(url.pathname.split("/")[4] || "");
    const body = await readJsonBody(req);
    const action = String(body.action || "").trim();
    const payload = body.payload ?? {};
    if (connectorId === "conn-agentstream" && action === "store_memory") {
      const agentstreamUrl = resolveAgentstreamUrl(runtime);
      if (!agentstreamUrl) {
        jsonResponse(res, 200, { ok: false, skipped: true, reason: "agentstream_unconfigured" });
        return;
      }
      try {
        const probe = await getIntegrationsState(runtime);
        if (!probe.agentstream?.connected) {
          jsonResponse(res, 200, { ok: false, skipped: true, reason: "agentstream_offline" });
          return;
        }
        const asRes = await latticeGatedFetch(
          runtime.socketBase,
          {
            agentId: "composer-lite",
            channelId: "ch-agentstream-policy-traces",
            gateway: "agentstream",
            eventType: "POLICY_TRACE_BUFFER",
          },
          `${agentstreamUrl}/api/memory`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(payload),
          },
        );
        if (!asRes.ok) {
          const errBody = await asRes.json().catch(() => ({}));
          jsonResponse(res, 502, { ok: false, error: errBody.error || `agentstream_${asRes.status}` });
          return;
        }
        jsonResponse(res, 200, { ok: true, stored: true });
      } catch (err) {
        jsonResponse(res, 502, { ok: false, error: err.message || "agentstream_store_failed" });
      }
      return;
    }
    jsonResponse(res, 404, { error: `unsupported connector action: ${connectorId}/${action}` });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/cca/chat") {
    const runtime = resolveRuntime();
    const body = await readJsonBody(req);
    try {
      const result = await runCcaChat(runtime.dataDir, {
        message: body.message,
        graph: body.graph ?? loadGraph(runtime.dataDir),
        history: body.history ?? [],
        context: body.context ?? {},
        attachments: body.attachments ?? [],
        lattice: {
          socketBase: runtime.socketBase,
          latticeDb: runtime.latticeDb,
          configPath: runtime.configPath,
        },
      });
      jsonResponse(res, 200, result);
    } catch (err) {
      jsonResponse(res, 400, { ok: false, error: err.message });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/wasm/evaluate") {
    const runtime = resolveRuntime();
    const body = await readJsonBody(req);
    try {
      const wasmBody = await wasmLatticeEvaluate(runtime, body);
      jsonResponse(res, wasmBody.ok ? 200 : 400, wasmBody);
    } catch (err) {
      jsonResponse(res, 503, { ok: false, error: err.message });
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/docking") {
    const runtime = resolveRuntime();
    jsonResponse(res, 200, { ports: fetchDocking(runtime) });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/schema-builder/validate") {
    const body = await readJsonBody(req);
    const schema = body?.schema;
    if (!schema?.schemaId || !schema?.domain) {
      jsonResponse(res, 400, { ok: false, error: "schema.schemaId and schema.domain required" });
      return;
    }
    const out = invokePolicyBuilder({
      action: "validate_schema",
      schema: {
        schemaId: String(schema.schemaId),
        domain: String(schema.domain),
        definition: schema.definition && typeof schema.definition === "object" ? schema.definition : {},
        source: schema.source || "human",
        sourceModel: schema.sourceModel,
      },
      historicalData: Array.isArray(body.historicalData) ? body.historicalData : undefined,
      regoRules: Array.isArray(body.regoRules) ? body.regoRules.map(String) : undefined,
    });
    jsonResponse(res, out.ok ? 200 : 500, out);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/policy-builder/build") {
    const body = await readJsonBody(req);
    const schema = body?.schema;
    if (!schema?.schemaId || !schema?.domain) {
      jsonResponse(res, 400, { ok: false, error: "schema.schemaId and schema.domain required" });
      return;
    }
    const out = invokePolicyBuilder({
      action: "build_policy",
      schema: {
        schemaId: String(schema.schemaId),
        domain: String(schema.domain),
        definition: schema.definition && typeof schema.definition === "object" ? schema.definition : {},
        source: schema.source || "human",
      },
      domain: String(body.domain || schema.domain),
      historicalData: Array.isArray(body.historicalData) ? body.historicalData : undefined,
      manifest: body.manifest,
    });
    jsonResponse(res, out.ok ? 200 : 500, out);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/policy-builder/validate") {
    const body = await readJsonBody(req);
    const schema = body?.schema;
    if (!schema?.schemaId || !schema?.domain) {
      jsonResponse(res, 400, { ok: false, error: "schema.schemaId and schema.domain required" });
      return;
    }
    const rules = Array.isArray(body.rules) ? body.rules.map(String) : [];
    const out = invokePolicyBuilder({
      action: "validate_policy",
      schema: {
        schemaId: String(schema.schemaId),
        domain: String(schema.domain),
        definition: schema.definition && typeof schema.definition === "object" ? schema.definition : {},
        source: schema.source || "human",
      },
      rules,
      manifest: body.manifest,
      historicalData: Array.isArray(body.historicalData) ? body.historicalData : undefined,
    });
    jsonResponse(res, out.ok ? 200 : 500, out);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/policy-lattice") {
    const runtime = resolveRuntime();
    const lrps = runtime.config?.base_node?.lrps ?? [];
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    jsonResponse(
      res,
      200,
      buildHyperlatticeView({
        repoRoot,
        activeRegulationLrps: lrps,
        composerGraph: loadGraph(runtime.dataDir),
      }),
    );
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/hyperlattice") {
    const runtime = resolveRuntime();
    const lrps = runtime.config?.base_node?.lrps ?? [];
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    jsonResponse(
      res,
      200,
      buildHyperlatticeView({
        repoRoot,
        activeRegulationLrps: lrps,
        composerGraph: loadGraph(runtime.dataDir),
      }),
    );
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/agentmesh") {
    jsonResponse(res, 200, createAgentMeshBundle());
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/inference") {
    const runtime = resolveRuntime();
    jsonResponse(res, 200, getInferencePublicState(runtime.dataDir));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/inference") {
    const runtime = resolveRuntime();
    const body = await readJsonBody(req);
    const saved = saveInferenceConfig(
      runtime.dataDir,
      {
        provider: body.provider ?? "llama_cpp",
        model: body.model,
        base_url: body.base_url,
        api_key: body.api_key,
      },
      { configured_by: "composer-lite" },
    );
    jsonResponse(res, 200, {
      ok: true,
      inference: getInferencePublicState(runtime.dataDir),
      saved,
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/mesh") {
    const runtime = resolveRuntime();
    const health = fetchHealth(runtime, { selfTest: false });
    jsonResponse(res, 200, getMeshPublicState(runtime.dataDir, health));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/mesh") {
    const runtime = resolveRuntime();
    const body = await readJsonBody(req);
    if (body.remove) {
      jsonResponse(res, 200, {
        ok: true,
        mesh: removeMeshPeer(runtime.dataDir, String(body.remove)),
      });
      return;
    }
    if (!body.node_id || !body.endpoint) {
      jsonResponse(res, 400, { error: "node_id and endpoint required" });
      return;
    }
    jsonResponse(res, 200, {
      ok: true,
      mesh: upsertMeshPeer(runtime.dataDir, body),
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/wasm-sandbox/health") {
    const runtime = resolveRuntime();
    const body = probeWasmSandbox(runtime);
    jsonResponse(res, body.ok ? 200 : 503, body);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/setup/catalog") {
    const catalog = await buildSetupWizardCatalog(process.env);
    jsonResponse(res, 200, catalog);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/setup/status") {
    const runtime = resolveRuntime();
    jsonResponse(res, 200, buildSetupWizardStatus(runtime));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/setup/ucb-key") {
    if (!isLocalComposerRequest(req)) {
      jsonResponse(res, 403, {
        ok: false,
        error: "UCB recovery key is only available to loopback clients.",
      });
      return;
    }
    const runtime = resolveRuntime();
    const key = readUcbRecoveryKey(runtime.dataDir);
    if (!key) {
      jsonResponse(res, 404, {
        ok: false,
        error: "UCB recovery key not available. Set UCB_API_KEY or check container logs.",
      });
      return;
    }
    jsonResponse(res, 200, {
      ok: true,
      api_key: key,
      hint: "Store this key securely. Prefer UCB_API_KEY in docker-compose for production.",
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/setup/inference") {
    const runtime = resolveRuntime();
    const body = await readJsonBody(req);
    try {
      const saved = saveWizardInferenceConfig(runtime.dataDir, body);
      jsonResponse(res, 200, { ok: true, inference: saved });
    } catch (err) {
      jsonResponse(res, 400, { ok: false, error: err.message });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/setup/cca-bootstrap") {
    const runtime = resolveRuntime();
    const body = await readJsonBody(req);
    try {
      const result = await runCcaBootstrapFromIntent(
        runtime.dataDir,
        body.intent,
        process.env,
      );
      jsonResponse(res, 200, result);
    } catch (err) {
      jsonResponse(res, 400, { ok: false, error: err.message });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/setup/activate") {
    const runtime = resolveRuntime();
    const body = await readJsonBody(req).catch(() => ({}));
    const activation = runtime.activation;
    const force = Boolean(body.force);
    if (activation?.status === "activated" && !force) {
      jsonResponse(res, 200, {
        ok: true,
        already_activated: true,
        activated_at: activation.activated_at,
        activation,
      });
      return;
    }
    const result = runSetupAgent(runtime.dataDir, {
      skip_if_activated: !force,
      force,
      lrps: Array.isArray(body.lrps) ? body.lrps : undefined,
      components: Array.isArray(body.components) ? body.components : undefined,
      validation_engine: body.validation_engine,
    });
    if (!result.ok) {
      jsonResponse(res, 500, {
        ok: false,
        error: result.stderr || result.stdout || "setup agent failed",
        stdout: result.stdout,
        stderr: result.stderr,
      });
      return;
    }
    const refreshed = resolveRuntime();
    jsonResponse(res, 200, {
      ok: true,
      stdout: result.stdout,
      report: result.report,
      activation: refreshed.activation,
      status: buildSetupWizardStatus(refreshed),
    });
    return;
  }
  if (
    req.method === "GET"
    && (url.pathname === "/install" || url.pathname === "/install/" || url.pathname === "/install-wizard.html")
  ) {
    serveInstallWizard(res);
    return;
  }
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    serveIndex(res);
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
    serveStatic(res, url.pathname.slice(1));
    return;
  }
  jsonResponse(res, 404, { error: "not found" });
}

export function createComposerLiteServer() {
  try {
    const runtime = resolveRuntime();
    if (runtime.dataDir) {
      ensureComposerLiteTaskManifest(runtime.dataDir, { configPath: runtime.configPath });
    }
  } catch {
    /* manifests materialize after first activation */
  }
  const server = http.createServer(async (req, res) => {
    try {
      await handleComposerLiteRequest(req, res);
    } catch (err) {
      jsonResponse(res, 500, { error: err.message ?? "internal error" });
    }
  });
  attachTerminalWebSocket(server);
  return server;
}