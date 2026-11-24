import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// The lattice channel client sends outbound HTTP only as a dock request of
// latticeGatedFetch. Every way of reaching the built-in fetch is a lint error here. The
// one dev path of AEP_LATTICE_STRICT_DEV carries a named disable comment.
const GATED_FETCH_MESSAGE =
  "The lattice channel client calls no fetch of its own. Outbound HTTP is a dock request of latticeGatedFetch.";
const FETCH_HOLDERS = ["globalThis", "global", "self", "window"];

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/target/**", "**/dist/**"] },
  {
    files: ["AEP-Components/**/*.{ts,mjs,js,cjs}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
  {
    // The conformance battery runs with vitest globals (conformance/harness).
    files: ["AEP-Components/conformance/tests/**/*.mjs"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        vi: "readonly",
      },
    },
  },
  {
    files: ["AEP-Components/**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: [
      "AEP-Components/lattice-channels/lib/**/*.{ts,mjs,js}",
      "AEP-Components/lattice-channels/client/**/*.{ts,mjs,js}",
    ],
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      // fetch(url) and const f = fetch; f(url)
      "no-restricted-globals": ["error", { name: "fetch", message: GATED_FETCH_MESSAGE }],
      // globalThis.fetch(url) and globalThis["fetch"](url)
      "no-restricted-properties": [
        "error",
        ...FETCH_HOLDERS.map((object) => ({ object, property: "fetch", message: GATED_FETCH_MESSAGE })),
      ],
      // Reflect.get(globalThis, "fetch") and any other lookup of the name as text
      "no-restricted-syntax": [
        "error",
        { selector: "Literal[value='fetch']", message: GATED_FETCH_MESSAGE },
        { selector: "TemplateLiteral[expressions.length=0][quasis.0.value.cooked='fetch']", message: GATED_FETCH_MESSAGE },
      ],
    },
  },
);
