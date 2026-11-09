import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const conformance = join(dirname(fileURLToPath(import.meta.url)), "..");

// The checks live in conformance/tests and import the components they check by
// relative path. Globals keep the test files free of a vitest import, which would
// not resolve from outside this harness folder.
export default defineConfig({
  test: {
    root: conformance,
    include: ["tests/**/*.test.mjs"],
    globals: true,
    pool: "forks",
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
