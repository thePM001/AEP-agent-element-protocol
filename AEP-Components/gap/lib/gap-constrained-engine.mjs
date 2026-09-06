/** Layer 1 stays optional authoring. Constrained decoding is not Admit. This file is unwired. */
const MSG =
  "gap-constrained-engine.mjs is unwired. Layer 1 stays optional authoring. Constrained decoding is not Admit. Live Admit is collect-all after freeze-at-seal.";

export function createGapConstrainedEngine() {
  throw new Error(MSG);
}

export default new Proxy(
  {},
  {
    get() {
      throw new Error(MSG);
    },
    apply() {
      throw new Error(MSG);
    },
  }
);
