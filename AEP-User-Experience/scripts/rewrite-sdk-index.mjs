#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const INDEX = join(REPO, "AEP-SDKs/typescript/aep-protocol/src/index.ts");

const MAP = {
  "./session/": "../../../../AEP-Components/session/lib/",
  "./policy/": "../../../../AEP-Components/policy-engine/lib/policy/",
  "./ledger/": "../../../../AEP-Components/evidence-ledger/lib/ledger/",
  "./rollback/": "../../../../AEP-Components/evidence-ledger/lib/rollback/",
  "./trust/": "../../../../AEP-Components/trust-rings/lib/trust/",
  "./rings/": "../../../../AEP-Components/trust-rings/lib/rings/",
  "./covenant/": "../../../../AEP-Components/covenant/lib/",
  "./intent/": "../../../../AEP-Components/intent/lib/",
  "./decomposition/": "../../../../AEP-Components/decomposition/lib/",
  "./proof-bundle/": "../../../../AEP-Components/proof-bundle/lib/",
  "./identity/": "../../../../AEP-Components/identity/lib/",
  "./recovery/": "../../../../AEP-Components/recovery/lib/",
  "./scanners/": "../../../../AEP-Components/scanners/lib/",
  "./knowledge/": "../../../../AEP-Components/knowledge-base/lib/knowledge/",
  "./fleet/": "../../../../AEP-Components/fleet/lib/",
  "./evaluation-chain/": "../../../../AEP-Components/evaluation-chain/lib/",
  "./model-gateway/": "../../../../AEP-Components/model-gateway/lib/",
  "./workflow/": "../../../../AEP-Components/workflow/lib/",
  "./telemetry/": "../../../../AEP-Components/telemetry/lib/",
  "./proxy/": "../../../../AEP-Components/proxy/lib/",
  "./datasets/": "../../../../AEP-Components/datasets/lib/",
  "./graph/": "../../../../AEP-Components/graph-engine/lib/graph/",
  "./verification/": "../../../../AEP-Components/verification/lib/",
  "./streaming/": "../../../../AEP-Components/streaming/lib/",
  "./aepassist/": "../../../../AEP-Components/aepassist/lib/aepassist/",
  "./assist/": "../../../../AEP-Components/aepassist/lib/assist/",
  "./eval/": "../../../../AEP-Components/eval/lib/",
  "./optimization/": "../../../../AEP-Components/optimization/lib/",
  "./permissions/": "../../../../AEP-Components/permissions/lib/",
  "./intercept/": "../../../../AEP-Components/intercept/lib/",
  "./lattice/": "../../../../AEP-Components/lattice-channels/client/lib/lattice/",
  "./aep-comm/": "../../../../AEP-Components/aep-comm/lib/",
  "./evidence/": "../../../../AEP-Components/evidence-ledger/lib/evidence/",
};

let text = readFileSync(INDEX, "utf8");
text = text.replace(/^\/\/ AEP 2\.75[\s\S]*?\n\n/, `// AEP 2.8 TypeScript SDK - thin re-export surface only.\n// All subsystems live in sibling component folders.\n\n`);

for (const [from, to] of Object.entries(MAP)) {
  text = text.split(from).join(to);
}

writeFileSync(INDEX, text);
console.log("Rewrote AEP-SDKs/typescript/aep-protocol/src/index.ts");