#!/usr/bin/env node
/**
 * AEP 2.8 Composer Lite - WASM visual canvas (node graph + optional CCA).
 * Composer Lite IS the public WASM Composer. Not the internal NLA Agent Composer.
 *
 * Fail-closed publish: non-loopback bind requires COMPOSER_LITE_SETUP_TOKEN.
 */

import { resolveComposerLitePort } from "./lib/nla-ports.mjs";
import { createComposerLiteServer } from "./lib/http-api.mjs";
import { assertComposerLitePublishSafe } from "./lib/composer-lite-auth.mjs";

assertComposerLitePublishSafe(process.env);

const PORT = resolveComposerLitePort();
const HOST = process.env.COMPOSER_LITE_HOST || "127.0.0.1";

const server = createComposerLiteServer();

server.listen(PORT, HOST, () => {
  console.log(`AEP Composer Lite (WASM canvas) listening on http://${HOST}:${PORT}`);
});
