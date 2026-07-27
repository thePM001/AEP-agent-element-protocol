import { fetchUcbHealth } from "./runtime.mjs";
import { ingestForeignPayload, rollbackForeignIntegrations } from "./bridge.mjs";
import { delegateToForeignModel } from "./delegate.mjs";
import { listDiffRecords } from "./diff-journal.mjs";

const TOOLS = [
  {
    name: "ucb_ingest",
    description:
      "Ingest structured output from a non-AEP agent stack through UCB validation into the AEP action lattice.",
    inputSchema: {
      type: "object",
      properties: {
        protocol: { type: "string", description: "Foreign stack id (langgraph, mcp, autogen, custom)" },
        session_id: { type: "string" },
        agent_id: { type: "string" },
        event_type: { type: "string" },
        payload: { type: "object" },
        provenance: { type: "object" },
      },
      required: ["protocol", "payload"],
    },
  },
  {
    name: "ucb_delegate",
    description:
      "Delegate a prompt to the configured inference engine via lattice-gated fetch (outer orchestration layer).",
    inputSchema: {
      type: "object",
      properties: {
        protocol: { type: "string" },
        prompt: { type: "string" },
        schema: { type: "object" },
        ingest_result: { type: "boolean" },
        capability_scope: { type: "string" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "ucb_rollback",
    description: "Rollback the last N UCB Extend-Write integrations and record UCB_ROLLBACK on the lattice.",
    inputSchema: {
      type: "object",
      properties: {
        steps: { type: "integer", minimum: 1, default: 1 },
      },
    },
  },
  {
    name: "ucb_health",
    description: "UCB and lattice dock health snapshot.",
    inputSchema: { type: "object", properties: {} },
  },
];

export function mcpCapabilities() {
  return {
    protocol: "mcp/1.0",
    bridge: "ucb/2.8.0",
    transport: "http+json-rpc",
    tools: TOOLS.map((t) => t.name),
  };
}

export async function handleMcpRequest(body, runtime, env) {
  const id = body.id ?? null;
  const method = body.method;
  const params = body.params ?? {};

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "ucb-universal-connect-bridge", version: "2.8.0" },
        capabilities: { tools: {} },
      },
    };
  }

  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  }

  if (method === "tools/call") {
    const name = params.name;
    const args = params.arguments ?? {};
    let result;
    switch (name) {
      case "ucb_ingest":
        result = await ingestForeignPayload(args, runtime);
        break;
      case "ucb_delegate":
        result = await delegateToForeignModel(args, runtime, env);
        break;
      case "ucb_rollback":
        result = await rollbackForeignIntegrations(Number(args.steps ?? 1), runtime);
        break;
      case "ucb_health":
        result = await fetchUcbHealth(runtime);
        break;
      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `unknown tool: ${name}` },
        };
    }
    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      },
    };
  }

  if (method === "ucb/diff/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: { diffs: listDiffRecords(runtime.dataDir, { limit: params.limit ?? 20 }) },
    };
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `unsupported method: ${method}` },
  };
}