#!/usr/bin/env node
/**
 * DEPRECATED: Use the Rust binary `aep-ucb` instead.
 * This MJS server is retained for reference and validator imports only.
 *
 * AEP 2.8 Universal Connect Bridge (UCB) - secured dock for non-AEP agent stacks.
 * NLA port 8412. Reference: NLA Research Paper 005.
 */
console.error(
  "WARNING: ucb/server.mjs is deprecated. Use `aep-ucb` (Rust) - see AEP-Docks/ucb/README.md",
);

import { resolveUcbPort } from "./lib/nla-ports.mjs";
import { createUcbServer } from "./lib/http-api.mjs";
import { createUcbAuthGuard } from "./lib/auth.mjs";
import { defaultPaths } from "../wizard/lib/paths.mjs";

const PORT = resolveUcbPort();
const HOST = process.env.UCB_HOST || "0.0.0.0";
const paths = defaultPaths();
const auth = createUcbAuthGuard(paths.dataDir);

if (auth.material.key && auth.material.source === "generated") {
  console.error(
    `UCB API key generated (${auth.material.path}). Use Authorization: Bearer <key> for protected endpoints.`,
  );
  console.error(`UCB key preview: ${auth.material.key.slice(0, 8)}…${auth.material.key.slice(-4)}`);
}

const server = createUcbServer();

server.listen(PORT, HOST, () => {
  console.log(`AEP Universal Connect Bridge (UCB) listening on http://${HOST}:${PORT}`);
  console.log("Secured dock for non-AEP agent protocols (ingest / delegate / rollback / MCP)");
});