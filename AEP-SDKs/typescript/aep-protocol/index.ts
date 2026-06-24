/**
 * AEP 2.8 TypeScript SDK - unified export surface (Phase 8).
 */

export * from "./src/index.js";

export {
  loadAEPConfigsBrowser,
  validateLatticeScene,
  validateJIT,
  type AEPConfig,
  type AEPScene,
  type AEPTheme,
} from "./sdk/sdk-aep-core.js";

export {
  BaseNodeDockingClient,
  createDockingClient,
  resolveSocketBase,
  validationDockPath,
  type DockFrameResponse,
  type DockingClientOptions,
} from "./sdk/sdk-aep-docking-client.js";

export {
  BaseNodeLatticeLogger,
  resolveLatticeLogCliPath,
  type DynAepLatticeEvent,
  type DynAepEventRecord,
} from "./sdk/sdk-aep-base-node-bridge.js";

export {
  BaseNodeMemoryFabric,
  resolveMemoryCliPath,
} from "./sdk/sdk-aep-memory-base-node.js";

export { createMemoryEntry } from "./sdk/sdk-aep-memory.js";