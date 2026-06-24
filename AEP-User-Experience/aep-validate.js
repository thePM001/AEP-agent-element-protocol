#!/usr/bin/env node
/**
 * AEP 2.8 harness entry - delegates to aep-2.8-agent-harness validator.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const script = join(__dirname, "aep-2.8-agent-harness/harness/aep-validate.js");
const result = spawnSync(process.execPath, [script, ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);