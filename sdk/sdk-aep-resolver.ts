// ===========================================================================
// @aep/resolver - AEP Basic Resolver v2.0
// Stateless, read-only resolver that routes proposals to the correct
// validation domain, collects constraints, and optionally queries the
// memory fabric for fast-path attractors.
// ===========================================================================

import type {
  AEPConfig,
  AEPElement,
  AEPRegistryEntry,
  AEPScene,
  AEPTheme,
} from "./sdk-aep-core";
import { Z_BANDS, prefixFromId, zBandForPrefix } from "./sdk-aep-core";
import type { MemoryEntry, MemoryFabric } from "./sdk-aep-memory";

// ---------------------------------------------------------------------------
// Route Constants
// ---------------------------------------------------------------------------

/** The five canonical AEP routing domains. */
const ROUTE_MAP: Record<string, string> = {
  ui_element: "ui",
  workflow_step: "workflow",
  api_call: "api",
  event: "event",
  iac_resource: "iac",
};

/** All valid proposal types accepted by the resolver. */
type ProposalType =
  | "ui_element"
  | "workflow_step"
  | "api_call"
  | "event"
  | "iac_resource";

// ---------------------------------------------------------------------------
// Request / Result Interfaces
// ---------------------------------------------------------------------------

/**
 * A proposal submitted to the resolver for routing and constraint collection.
 *
 * The resolver does NOT execute the proposal -- it determines where the
 * proposal should be routed, what constraints apply, and whether a
 * memory-based fast-path shortcut is available.
 */
export interface ResolveRequest {
  /** The kind of proposal being submitted. Determines the routing domain. */
  proposalType: ProposalType;

  /**
   * AEP element ID (e.g. "CP-00001"). Required for `ui_element` proposals;
   * optional for other proposal types.
   */
  elementId?: string;

  /** The action being performed (e.g. "click", "submit", "deploy"). */
  action?: string;

  /** Arbitrary payload data associated with the proposal. */
  payload: Record<string, any>;

  /** Current state of the element or resource, if applicable. */
  currentState?: string;

  /** Identifier of the agent submitting the proposal. */
  agentId?: string;
}

/**
 * The resolver's output for a given proposal.
 *
 * Contains routing information, applicable constraints, policy validation
 * status, and an optional memory-based attractor for fast-path decisions.
 */
export interface ResolveResult {
  /** The canonical routing domain: "ui", "workflow", "api", "event", or "iac". */
  route: string;

  /** Constraints collected from the registry entry and z-band validation. */
  constraints: string[];

  /** Whether all policy checks passed. */
  policyPass: boolean;

  /** Specific policy errors encountered during resolution. */
  policyErrors: string[];

  /** Actions available on the target element (from the registry). */
  availableActions: string[];

  /**
   * The nearest accepted memory entry if the memory fabric found a
   * high-similarity match. `null` when memory is not active or no
   * attractor was found.
   */
  nearestAttractor: MemoryEntry | null;

  /**
   * Whether a fast-path hit was found in the memory fabric, indicating
   * that this proposal closely matches a previously accepted one.
   */
  fastPath: boolean;
}

// ---------------------------------------------------------------------------
// BasicResolver
// ---------------------------------------------------------------------------

/**
 * Stateless, read-only resolver for AEP proposals.
 *
 * The resolver performs three functions:
 *
 * 1. **Routing** -- maps the proposal type to a canonical domain
 *    (`"ui"`, `"workflow"`, `"api"`, `"event"`, `"iac"`).
 *
 * 2. **Constraint collection** -- for `ui_element` proposals, extracts the
 *    element prefix, validates z-band compliance, looks up the registry
 *    entry, and collects declared constraints.
 *
 * 3. **Memory lookup** (optional) -- if a `MemoryFabric` is provided,
 *    queries `getFastPathHit()` to check whether the proposal closely
 *    matches a previously accepted one.
 *
 * Design invariants:
 * - The resolver NEVER modifies `config` or `memory` (read-only).
 * - The resolver is fully stateless -- no internal mutation between calls.
 * - If no memory fabric is provided, attractor lookup is skipped entirely.
 * - If an element is not found, the result includes empty constraints with
 *   an informational note in `policyErrors`.
 */
export class BasicResolver {
  private readonly config: AEPConfig | null;
  private readonly memory: MemoryFabric | null;

  /**
   * Create a new BasicResolver.
   *
   * @param config - AEP configuration (scene, registry, theme). If omitted,
   *   UI constraint resolution and registry lookups will be unavailable.
   * @param memory - Memory fabric for fast-path attractor lookups. If omitted,
   *   all memory-related fields in the result will be null/false.
   */
  constructor(config?: AEPConfig, memory?: MemoryFabric) {
    this.config = config ?? null;
    this.memory = memory ?? null;
  }

  /**
   * Resolve a proposal to a routing result.
   *
   * Routes the proposal by its `proposalType`, collects applicable
   * constraints for UI elements, validates z-band compliance, and
   * optionally queries memory for a fast-path attractor.
   *
   * @param request - The resolve request describing the proposal.
   * @returns A `ResolveResult` with routing, constraints, and attractor info.
   */
  resolve(request: ResolveRequest): ResolveResult {
    const route = ROUTE_MAP[request.proposalType] ?? "ui";
    const constraints: string[] = [];
    const policyErrors: string[] = [];
    let availableActions: string[] = [];
    let policyPass = true;
    let nearestAttractor: MemoryEntry | null = null;
    let fastPath = false;

    // ----- UI Element resolution -----
    if (request.proposalType === "ui_element" && request.elementId) {
      const uiResult = this.resolveUIElement(request.elementId, request.action);
      constraints.push(...uiResult.constraints);
      policyErrors.push(...uiResult.policyErrors);
      availableActions = uiResult.availableActions;
      policyPass = uiResult.policyErrors.length === 0;
    }

    // ----- Validate action against available actions -----
    if (
      request.action &&
      availableActions.length > 0 &&
      !availableActions.includes(request.action)
    ) {
      policyErrors.push(
        `Action "${request.action}" is not in the available actions: [${availableActions.join(", ")}]`,
      );
      policyPass = false;
    }

    // ----- Memory fast-path lookup -----
    if (this.memory) {
      const embedding = (request.payload as any)?.embedding as
        | number[]
        | undefined;
      if (embedding && Array.isArray(embedding)) {
        const hit = this.memory.getFastPathHit(embedding);
        if (hit) {
          nearestAttractor = hit;
          fastPath = true;
        }
      }
    }

    return {
      route,
      constraints,
      policyPass,
      policyErrors,
      availableActions,
      nearestAttractor,
      fastPath,
    };
  }

  /**
   * Return all available routing domains.
   *
   * @returns An array of route strings: `["ui", "workflow", "api", "event", "iac"]`.
   */
  getAvailableRoutes(): string[] {
    return Object.values(ROUTE_MAP);
  }

  /**
   * Get the constraints declared for a UI element in the registry.
   *
   * If the element is not found in the registry, or if no config is loaded,
   * returns an empty array.
   *
   * @param elementId - The AEP element ID (e.g. "CP-00001").
   * @returns An array of constraint strings from the registry entry.
   */
  getUIConstraints(elementId: string): string[] {
    if (!this.config) {
      return [];
    }

    const entry = this.config.registry[elementId];
    if (!entry) {
      return [];
    }

    return [...entry.constraints];
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Resolve constraints and policy for a single UI element.
   *
   * Extracts the prefix, validates z-band compliance, looks up the
   * registry entry, and collects constraints and available actions.
   */
  private resolveUIElement(
    elementId: string,
    action?: string,
  ): {
    constraints: string[];
    policyErrors: string[];
    availableActions: string[];
  } {
    const constraints: string[] = [];
    const policyErrors: string[] = [];
    let availableActions: string[] = [];

    // No config -- cannot resolve UI elements
    if (!this.config) {
      policyErrors.push(
        "No AEP config loaded; unable to resolve UI element constraints",
      );
      return { constraints, policyErrors, availableActions };
    }

    // Extract prefix and validate ID format
    let prefix: string;
    try {
      prefix = prefixFromId(elementId);
    } catch {
      policyErrors.push(`Invalid element ID format: "${elementId}"`);
      return { constraints, policyErrors, availableActions };
    }

    // Z-band validation against scene element
    const sceneElement = this.config.scene.elements[elementId];
    if (sceneElement) {
      const [minZ, maxZ] = zBandForPrefix(prefix);
      if (sceneElement.z < minZ || sceneElement.z > maxZ) {
        policyErrors.push(
          `${elementId} z=${sceneElement.z} outside band ${minZ}-${maxZ} for prefix "${prefix}"`,
        );
      }
      constraints.push(`z-band:${prefix}[${minZ}-${maxZ}]`);
    }

    // Registry lookup
    const registryEntry = this.config.registry[elementId];
    if (registryEntry) {
      // Collect declared constraints
      if (registryEntry.constraints && registryEntry.constraints.length > 0) {
        constraints.push(...registryEntry.constraints);
      }

      // Collect available actions
      if (registryEntry.actions && registryEntry.actions.length > 0) {
        availableActions = [...registryEntry.actions];
      }

      // Skin binding exists in theme
      if (
        registryEntry.skin_binding &&
        this.config.theme.component_styles &&
        !this.config.theme.component_styles[registryEntry.skin_binding]
      ) {
        policyErrors.push(
          `Skin binding "${registryEntry.skin_binding}" for ${elementId} not found in theme`,
        );
      }
    } else if (!sceneElement) {
      // Element not found in either scene or registry
      policyErrors.push(
        `Element "${elementId}" not found in registry or scene (informational)`,
      );
    }

    return { constraints, policyErrors, availableActions };
  }
}
