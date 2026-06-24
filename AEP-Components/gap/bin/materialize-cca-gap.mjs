#!/usr/bin/env node
/** @deprecated Use AEP-Composer-Lite/bin/materialize-cca-gap.mjs */
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "../../../AEP-Composer-Lite/bin/materialize-cca-gap.mjs");
const r = spawnSync(process.execPath, [script], { stdio: "inherit" });
process.exit(r.status ?? 1);