/** BL-08: dead re-export stub fails loudly instead of silent no-op success. */
const MSG =
  "gap-constrained-engine.mjs is deprecated and removed. Use AEP-Composer-Lite/lib/hyperlattice/gap-constrained-engine.mjs explicitly.";

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
