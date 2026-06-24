import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@aep/core": path.resolve(repoRoot, "AEP-SDKs/typescript/aep-protocol/sdk/sdk-aep-core.ts"),
    },
  },
  test: {
    include: ["AEP-NOSHIP/tests/**/*.test.ts", "AEP-NOSHIP/tests/**/*.test.mjs"],
    globals: true,
    testTimeout: 10000,
  },
});
