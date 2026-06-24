import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/rego/*.test.ts",
      "tests/scanners/*.test.ts",
      "tests/chain/*.test.ts",
      "tests/lattice/action-lattice.test.ts",
      "tests/hyperlattice/*.test.ts",
    ],
    globals: true,
    testTimeout: 15000,
  },
});