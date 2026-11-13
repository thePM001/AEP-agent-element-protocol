#!/usr/bin/env node
// Egress vector run in node: exits 0 when egress-address.mjs gives every row of the shared
// vector file its answer and 1 otherwise. Usage: node AEP-Components/egress-address/bin/run-vectors.mjs
import { loadEgressVectors, runEgressVectors } from "../lib/egress-vectors.mjs";

const vectors = loadEgressVectors();
const wrong = runEgressVectors(vectors);
for (const line of wrong) process.stdout.write(`wrong ${line}\n`);
process.stdout.write(
  `egress vectors: ${vectors.addresses.length} addresses, ${vectors.urls.length} urls, ${wrong.length} wrong\n`,
);
process.exit(wrong.length === 0 ? 0 : 1);
