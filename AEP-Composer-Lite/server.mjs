#!/usr/bin/env node
/**
 * AEP 2.8 Composer Lite - WASM visual canvas (node graph + optional CCA).
 * Composer Lite IS the public WASM Composer. Not the internal NLA Agent Composer.
 */

import { resolveComposerLitePort } from "./lib/nla-ports.mjs";
import { createComposerLiteServer } from "./lib/http-api.mjs";

const PORT = resolveComposerLitePort();
const HOST = process.env.COMPOSER_LITE_HOST || "127.0.0.1";

const server = createComposerLiteServer();

server.listen(PORT, HOST, () => {
  console.log(`AEP Composer Lite (WASM canvas) listening on http://${HOST}:${PORT}`);
});