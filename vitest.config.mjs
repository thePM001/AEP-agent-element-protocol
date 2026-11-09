import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["AEP-Components/**/*.test.{ts,mjs}"],
    // The conformance battery in AEP-Components/conformance/tests runs through
    // conformance/runner/run.sh with its own harness and kernel fixtures.
    exclude: ["**/node_modules/**", "**/target/**", "**/dist/**", "AEP-Components/conformance/tests/**"],
  },
});
