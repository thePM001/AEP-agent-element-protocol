/**
 * AEP Astro SDK - lattice-gated transport + core config loaders for islands.
 */
export {
  loadAEPConfigsBrowser,
  validateLatticeScene,
  validateJIT,
  type AEPConfig,
  type AEPScene,
  type AEPTheme,
} from "../typescript/aep-protocol/sdk/sdk-aep-core.js";

export {
  buildLatticeFrame,
  latticeGatedFetch,
  latticeStrictEnabled,
  resolveSocketBase,
} from "../javascript/lattice-gated-fetch.mjs";

export {
  BaseNodeDockingClient,
  createDockingClient,
  type DockingClientOptions,
} from "../typescript/aep-protocol/sdk/sdk-aep-docking-client.js";