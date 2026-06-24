import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const harnessDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(harnessDir, "../../..");

export default defineConfig({
  root: repoRoot,
  resolve: {
    alias: {
      "@aep/core": path.resolve(repoRoot, "AEP-SDKs/typescript/aep-protocol/sdk/sdk-aep-core.ts"),
      ws: path.resolve(harnessDir, "node_modules/ws/wrapper.mjs"),
    },
  },
  test: {
    include: [
      "AEP-NOSHIP/tests/conformance/**/*.test.ts",
      "AEP-NOSHIP/tests/conformance/**/*.test.mjs",
      "AEP-NOSHIP/tests/composer-lite*.test.mjs",
      "AEP-NOSHIP/tests/wasm-composer.test.mjs",
      "AEP-NOSHIP/tests/setup-agent.test.mjs",
      "AEP-NOSHIP/tests/ucb.test.mjs",
      "AEP-NOSHIP/tests/subprotocols/commerce/**/*.test.ts",
      "AEP-NOSHIP/tests/schema-builder/**/*.test.ts",
      "AEP-NOSHIP/tests/policy-builder/**/*.test.ts",
      "AEP-NOSHIP/tests/conformance/manifest-coverage.test.mjs",
      "AEP-NOSHIP/tests/conformance/cca-plan-generation.test.mjs",
      "AEP-NOSHIP/tests/conformance/cca-writing-gap.test.mjs",
      "AEP-NOSHIP/tests/conformance/epscom-writing-kernel.test.mjs",
    ],
    globals: true,
    testTimeout: 120000,
  },
});