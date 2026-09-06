// ===========================================================================
// dynAEP TypeScript SDK - Validation Bridge (AEP-SDKs/typescript/dynaep)
// Sits between AG-UI event stream and AEP frontend renderer.
// Every AG-UI event targeting an AEP element is validated before application.
// Agents NEVER mint IDs. The bridge mints all IDs.
// Agents NEVER own the clock. The bridge stamps all events.
// ===========================================================================
import { zBandForPrefix, prefixFromId, isTemplateInstance, createMemoryEntry, createDefaultMemoryFabric, isBaseNodeMemoryAvailable, createDefaultLatticeLogger, } from "../../aep-protocol/sdk/sdk-aep-core.js";
// TA-1: Temporal Authority imports
import { BridgeClock } from "./temporal/clock";
import { TemporalValidator } from "./temporal/validator";
import { CausalOrderingEngine } from "./temporal/causal";
import { ForecastSidecar } from "./temporal/forecast";
import { TemplateInstanceResolver } from "./template/TemplateInstanceResolver";
import { BufferedLedger } from "./persistence/BufferedLedger";
// OPT-002: Unified Rego evaluator with decision cache
import { UnifiedRegoEvaluator } from "./rego/UnifiedRegoEvaluator";
// OPT-003: Unified content scanner with Aho-Corasick
import { UnifiedScanner } from "./scanners/UnifiedScanner";
import { ParallelChainExecutor } from "./chain/ParallelChainExecutor";
import { SequentialChainExecutor } from "./chain/SequentialChainExecutor";
import { createTemporalRejectionEvent, createTemporalResetEvent, createClockSyncEvent, } from "./temporal/events";
import { LatticeFilter, ActionLattice, } from "./protocol/action-lattice.js";
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export const LATTICE_EVENT = "LATTICE_EVENT";
export const LATTICE_FILTER_RESULT = "LATTICE_FILTER_RESULT";
export const LATTICE_REGISTER = "LATTICE_REGISTER";
// ---------------------------------------------------------------------------
// Prefix-to-Type Mapping (for ID minting from type name)
// ---------------------------------------------------------------------------
const TYPE_TO_PREFIX = {
    shell: "SH", panel: "PN", component: "CP", navigation: "NV",
    cell_zone: "CZ", cell_node: "CN", toolbar: "TB", widget: "WD",
    overlay: "OV", modal: "MD", dropdown: "DD", tooltip: "TT",
    form: "FM", icon: "IC",
};
// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------
export class DynAEPBridge {
    config;
    liveElements;
    bridgeConfig;
    idCounters = {};
    elementVersions = {};
    reflectionTimer = null;
    observers = new Map();
    debounceTimers = new Map();
    // TA-1: Temporal Authority subsystems
    bridgeClock;
    temporalValidator;
    causalEngine;
    forecastSidecar;
    clockSyncTimer = null;
    agentSequenceCounters = {};
    eventEmitter = null;
    // OPT-009: Template instance fast-exit resolver
    templateResolver;
    // OPT-006: Buffered evidence ledger
    evidenceLedger;
    // OPT-002: Unified Rego evaluator
    regoEvaluator;
    // OPT-003: Unified content scanner
    contentScanner = null;
    scannerEngine = "unified";
    latticeLogger = null;
    lattice = null;
    latticeFilter = null;
    constructor(config, bridgeConfig) {
        this.config = config;
        this.liveElements = structuredClone(config.scene.elements);
        this.bridgeConfig = bridgeConfig;
        // Initialise ID counters from existing elements
        for (const id of Object.keys(this.liveElements)) {
            try {
                const prefix = prefixFromId(id);
                const num = parseInt(id.substring(3), 10);
                if (!isNaN(num)) {
                    this.idCounters[prefix] = Math.max(this.idCounters[prefix] ?? 0, num);
                }
            }
            catch {
                // Skip malformed IDs
            }
        }
        // Initialise element versions
        for (const id of Object.keys(this.liveElements)) {
            this.elementVersions[id] = 1;
        }
        if (!this.config.memory && isBaseNodeMemoryAvailable()) {
            this.config.memory = createDefaultMemoryFabric();
        }
        this.latticeLogger = createDefaultLatticeLogger();
        // AEP28-ENV-031: ActionLattice YAML load and LatticeFilter are not product Admit.
        this.lattice = null;
        this.latticeFilter = null;
        this.latticeInitError = null;
        // TA-1: Initialise temporal authority subsystems
        const clockConfig = bridgeConfig.timekeeping ?? {
            protocol: "system",
            source: "pool.ntp.org",
            syncIntervalMs: 30000,
            maxDriftMs: 50,
            bridgeIsAuthority: true,
        };
        this.bridgeClock = new BridgeClock(clockConfig);
        const temporalConfig = bridgeConfig.temporal_validation ?? {
            maxDriftMs: clockConfig.maxDriftMs,
            maxFutureMs: 500,
            maxStalenessMs: 5000,
            overwriteTimestamps: clockConfig.bridgeIsAuthority,
            logRejections: true,
            mode: bridgeConfig.validation.mode,
        };
        this.temporalValidator = new TemporalValidator(this.bridgeClock, temporalConfig);
        const causalConfig = bridgeConfig.causal_ordering ?? {
            maxReorderBufferSize: 64,
            maxReorderWaitMs: 200,
            conflictResolution: bridgeConfig.conflict_resolution.mode,
            enableVectorClocks: true,
            enableElementHistory: true,
            historyDepth: 100,
        };
        this.causalEngine = new CausalOrderingEngine(causalConfig);
        const forecastConfig = bridgeConfig.forecast ?? {
            enabled: false,
            timesfmEndpoint: null,
            timesfmMode: "local",
            contextWindow: 64,
            forecastHorizon: 12,
            anomalyThreshold: 3.0,
            debounceMs: 250,
            maxTrackedElements: 500,
        };
        this.forecastSidecar = new ForecastSidecar(forecastConfig);
        // OPT-009: Initialise template instance resolver
        this.templateResolver = new TemplateInstanceResolver(config.registry);
        // OPT-006: Initialise buffered evidence ledger
        this.evidenceLedger = new BufferedLedger(this.bridgeClock, {
            bufferSize: 256,
            flushIntervalMs: 5000,
            hashChainEnabled: true,
            persistencePath: null,
        });
        // OPT-002: Initialise unified Rego evaluator
        const regoConfig = bridgeConfig.rego ?? {
            policyPath: "./aep-policy.rego",
            evaluation: "precompiled",
            bundleMode: "unified",
            decisionCacheSize: 5000,
            cacheInvalidateOnReload: true,
        };
        this.regoEvaluator = new UnifiedRegoEvaluator(regoConfig);
        // OPT-003: Initialise unified content scanner
        if (bridgeConfig.scanners) {
            this.scannerEngine = bridgeConfig.scanners.engine;
            if (bridgeConfig.scanners.engine === "unified" && bridgeConfig.scanners.configs.length > 0) {
                this.contentScanner = new UnifiedScanner(bridgeConfig.scanners.configs);
            }
        }
        // Attempt initial clock sync (non-blocking)
        this.bridgeClock.sync().catch(() => {
            console.warn("[dynAEP-TA] Initial clock sync failed, using system clock fallback");
        });
    }
    // -------------------------------------------------------------------------
    // ID Minting
    // -------------------------------------------------------------------------
    mintElementId(type) {
        const prefix = TYPE_TO_PREFIX[type];
        if (!prefix) {
            throw new Error(`Unknown element type: "${type}". Valid types: ${Object.keys(TYPE_TO_PREFIX).join(", ")}`);
        }
        const next = (this.idCounters[prefix] ?? 0) + 1;
        this.idCounters[prefix] = next;
        return `${prefix}-${String(next).padStart(5, "0")}`;
    }
    getNextAvailableId(prefix) {
        const next = (this.idCounters[prefix] ?? 0) + 1;
        return `${prefix}-${String(next).padStart(5, "0")}`;
    }
    // -------------------------------------------------------------------------
    // Process incoming AG-UI event
    // -------------------------------------------------------------------------
    async processEvent(event) {
        this.normalizeAgentContext(event);
        // AEP28-ENV-031: TypeScript processEvent is not a second product Admit.
        // Product live path is Rust aep-live-entry. aep_envelope::admit in-process.
        // Admit collect-all walls then Apply lives in Rust aep-live-entry.
        // SDKs may speak the protocol. They must not be a second denier.
        return event;
    }
    // -------------------------------------------------------------------------
    // STATE_DELTA: Three-layer path routing
    // -------------------------------------------------------------------------
    processStateDelta(event) {
        if (!this.bridgeConfig.validation.jit_on_every_delta)
            return event;
        const deltas = event.delta;
        if (!Array.isArray(deltas))
            return event;
        for (const op of deltas) {
            if (typeof op.path !== "string")
                continue;
            const parts = op.path.split("/").filter(Boolean);
            if (parts.length < 2)
                continue;
            const layer = parts[0];
            const targetId = parts[1];
            const field = parts.length > 2 ? parts[2] : undefined;
            let result;
            if (layer === "elements") {
                // Layer 1: Structure
                result = this.validateStructureDelta(targetId, field, op.value);
            }
            else if (layer === "registry") {
                // Layer 2: Behaviour
                result = this.validateBehaviourDelta(targetId, field);
            }
            else if (layer === "theme" && parts[1] === "component_styles") {
                // Layer 3: Skin
                const styleKey = parts[2] ?? "";
                result = this.validateSkinDelta(styleKey);
                this.recordValidationMemory(styleKey, layer, field, op.value, result);
            }
            else {
                continue;
            }
            if (layer !== "theme") {
                this.recordValidationMemory(targetId, layer, field, op.value, result);
            }
            if (!result.valid) {
                return this.createRejection(targetId, result.errors.join("; "), event.timestamp);
            }
            // Optimistic locking check
            if (this.bridgeConfig.conflict_resolution.mode === "optimistic_locking" &&
                layer === "elements" &&
                event.expected_version !== undefined) {
                const currentVersion = this.elementVersions[targetId] ?? 0;
                if (event.expected_version !== currentVersion) {
                    return this.createRejection(targetId, `Optimistic lock conflict: expected version ${event.expected_version} but current is ${currentVersion}`, event.timestamp);
                }
            }
        }
        // All valid: apply deltas
        for (const op of deltas) {
            const parts = op.path.split("/").filter(Boolean);
            if (parts[0] === "elements" && parts.length >= 3) {
                const id = parts[1];
                const field = parts[2];
                const el = this.liveElements[id];
                if (el && field in el) {
                    el[field] = op.value;
                    this.elementVersions[id] = (this.elementVersions[id] ?? 0) + 1;
                }
            }
        }
        return event;
    }
    recordValidationMemory(targetId, layer, field, value, result) {
        const fabric = this.config.memory;
        if (!fabric)
            return;
        const proposal = layer === "theme"
            ? { skin_binding: targetId }
            : field
                ? { [field]: value }
                : { layer, targetId };
        fabric.record(createMemoryEntry(targetId, "ui", proposal, result.valid ? "accepted" : "rejected", result.errors, ["jit_delta", `dynaep_${layer}`]));
    }
    validateStructureDelta(targetId, field, value) {
        const errors = [];
        if (!this.liveElements[targetId] && !isTemplateInstance(targetId, this.config.registry)) {
            errors.push(`Unregistered element: ${targetId} does not exist in scene`);
            return { valid: false, errors, warnings: [] };
        }
        if (field === "z" && typeof value === "number") {
            try {
                const prefix = prefixFromId(targetId);
                const [minZ, maxZ] = zBandForPrefix(prefix);
                if (value < minZ || value > maxZ) {
                    errors.push(`z-band violation: ${targetId} z=${value} outside band ${minZ}-${maxZ}`);
                }
            }
            catch (e) {
                errors.push(e.message);
            }
        }
        if (field === "parent" && value !== null && typeof value === "string") {
            if (!this.liveElements[value]) {
                errors.push(`${targetId} references non-existent parent ${value}`);
            }
        }
        return { valid: errors.length === 0, errors, warnings: [] };
    }
    validateBehaviourDelta(targetId, _field) {
        if (!this.config.registry[targetId] && !isTemplateInstance(targetId, this.config.registry)) {
            return {
                valid: false,
                errors: [`Cannot mutate behaviour: ${targetId} has no registry entry`],
                warnings: [],
            };
        }
        return { valid: true, errors: [], warnings: [] };
    }
    validateSkinDelta(styleKey) {
        // Skin deltas targeting existing keys are always valid (theme is mutable)
        // Only warn if key doesn't exist yet (could be an addition)
        if (!this.config.theme.component_styles[styleKey]) {
            return { valid: true, errors: [], warnings: [`New skin key: ${styleKey} does not exist yet`] };
        }
        return { valid: true, errors: [], warnings: [] };
    }
    // -------------------------------------------------------------------------
    // Custom dynAEP events
    // -------------------------------------------------------------------------
    processDynAEPEvent(event) {
        switch (event.dynaep_type) {
            case "AEP_MUTATE_STRUCTURE":
                return this.handleStructureMutation(event);
            case "AEP_MUTATE_BEHAVIOUR":
                return this.handleBehaviourMutation(event);
            case "AEP_MUTATE_SKIN":
                return this.handleSkinMutation(event);
            case "AEP_QUERY":
                return this.handleQuery(event);
            default:
                return event;
        }
    }
    // -------------------------------------------------------------------------
    // Structure mutation
    // -------------------------------------------------------------------------
    handleStructureMutation(event) {
        const targetId = event.target_id ?? "";
        const mutation = event.mutation ?? {};
        const errors = [];
        if (!this.liveElements[targetId] && !isTemplateInstance(targetId, this.config.registry)) {
            errors.push(`Unknown element: ${targetId}`);
        }
        if (mutation.parent && !this.liveElements[mutation.parent]) {
            errors.push(`Cannot move ${targetId}: parent ${mutation.parent} does not exist`);
        }
        if (mutation.anchors && typeof mutation.anchors === "object") {
            for (const [dir, anchor] of Object.entries(mutation.anchors)) {
                if (typeof anchor !== "string")
                    continue;
                const anchorTarget = anchor.split(".")[0];
                if (anchorTarget !== "viewport" && !this.liveElements[anchorTarget]) {
                    errors.push(`Invalid anchor: ${targetId} ${dir} -> non-existent ${anchorTarget}`);
                }
            }
        }
        if (mutation.skin_binding && !this.config.theme.component_styles[mutation.skin_binding]) {
            errors.push(`${targetId} skin_binding "${mutation.skin_binding}" not found in theme`);
        }
        if (errors.length > 0) {
            return this.createRejection(targetId, errors.join("; "), event.timestamp);
        }
        // Apply
        const el = this.liveElements[targetId];
        if (el) {
            if (mutation.parent) {
                // Remove from old parent
                const oldParent = el.parent ? this.liveElements[el.parent] : null;
                if (oldParent) {
                    oldParent.children = oldParent.children.filter((c) => c !== targetId);
                }
                // Set new parent
                el.parent = mutation.parent;
                // Add to new parent
                const newParent = this.liveElements[mutation.parent];
                if (newParent && !newParent.children.includes(targetId)) {
                    newParent.children.push(targetId);
                }
            }
            if (mutation.anchors && el.layout) {
                el.layout.anchors = mutation.anchors;
            }
            this.elementVersions[targetId] = (this.elementVersions[targetId] ?? 0) + 1;
        }
        return event;
    }
    // -------------------------------------------------------------------------
    // Behaviour mutation
    // -------------------------------------------------------------------------
    handleBehaviourMutation(event) {
        const targetId = event.target_id ?? "";
        if (!this.config.registry[targetId] && !isTemplateInstance(targetId, this.config.registry)) {
            return this.createRejection(targetId, `Cannot mutate behaviour: ${targetId} has no registry entry`, event.timestamp);
        }
        return event;
    }
    // -------------------------------------------------------------------------
    // Skin mutation
    // -------------------------------------------------------------------------
    handleSkinMutation(event) {
        const targetId = event.target_id ?? "";
        if (!this.config.theme.component_styles[targetId]) {
            return this.createRejection(targetId, `Cannot mutate skin: "${targetId}" does not exist in component_styles`, event.timestamp);
        }
        return event;
    }
    // -------------------------------------------------------------------------
    // Query handler
    // -------------------------------------------------------------------------
    handleQuery(event) {
        const query = event.query ?? "";
        const targetId = event.target_id ?? "";
        let result = null;
        const el = this.liveElements[targetId];
        switch (query) {
            case "children_of":
                result = el?.children ?? [];
                break;
            case "parent_of":
                result = el?.parent ?? null;
                break;
            case "z_band_of":
                try {
                    result = zBandForPrefix(prefixFromId(targetId));
                }
                catch {
                    result = [0, 99];
                }
                break;
            case "visible_at_breakpoint":
                result = el?.responsive_matrix ?? { all: el?.visible ?? false };
                break;
            case "full_element":
                result = {
                    scene: el ?? null,
                    registry: this.config.registry[targetId] ?? null,
                    version: this.elementVersions[targetId] ?? 0,
                };
                break;
            case "next_available_id":
                // targetId here is used as the prefix (e.g., "CP")
                result = this.getNextAvailableId(targetId);
                break;
        }
        return {
            type: "CUSTOM",
            dynaep_type: "AEP_QUERY_RESULT",
            target_id: targetId,
            result,
        };
    }
    // -------------------------------------------------------------------------
    // Schema Reload
    // -------------------------------------------------------------------------
    reloadConfig(newConfig) {
        const oldRevision = this.config.meta.reg_schema_revision;
        this.config = newConfig;
        this.liveElements = structuredClone(newConfig.scene.elements);
        // Re-initialise counters
        for (const id of Object.keys(this.liveElements)) {
            try {
                const prefix = prefixFromId(id);
                const num = parseInt(id.substring(3), 10);
                if (!isNaN(num)) {
                    this.idCounters[prefix] = Math.max(this.idCounters[prefix] ?? 0, num);
                }
            }
            catch { /* skip */ }
        }
        // OPT-002: Invalidate Rego decision cache on schema reload
        this.regoEvaluator.reload([]).catch(() => {
            console.warn("[dynAEP-OPT002] Rego policy reload/cache invalidation failed");
        });
        // TA-1: Reset causal ordering on schema reload
        const oldVectorClock = this.causalEngine.getVectorClock();
        this.causalEngine.reset();
        const newVectorClock = this.causalEngine.getVectorClock();
        // Prune forecast tracking and template cache for removed elements
        const activeIds = Object.keys(this.liveElements);
        this.forecastSidecar.prune(activeIds);
        this.templateResolver.prune(activeIds);
        // Emit temporal reset event if emitter is available
        if (this.eventEmitter) {
            const resetEvent = createTemporalResetEvent({
                reason: "schema_reload",
                oldVectorClock,
                newVectorClock,
                resetAt: this.bridgeClock.now(),
            });
            this.eventEmitter(resetEvent);
        }
        return {
            type: "CUSTOM",
            dynaep_type: "DYNAEP_SCHEMA_RELOAD",
            old_revision: oldRevision,
            new_revision: newConfig.meta.reg_schema_revision,
            aep_version: newConfig.scene.aep_version,
        };
    }
    // -------------------------------------------------------------------------
    // Runtime Reflection (ResizeObserver, SSR-safe)
    // -------------------------------------------------------------------------
    startReflection(emitEvent) {
        if (!this.bridgeConfig.runtime_reflection.enabled)
            return;
        if (typeof document === "undefined" || typeof ResizeObserver === "undefined")
            return;
        const debounceMs = this.bridgeConfig.runtime_reflection.debounce_ms;
        const measure = (id) => {
            const el = document.querySelector(`[data-aep-id="${id}"]`);
            if (!el)
                return;
            // Debounce per element
            const existing = this.debounceTimers.get(id);
            if (existing)
                clearTimeout(existing);
            this.debounceTimers.set(id, setTimeout(() => {
                const rect = el.getBoundingClientRect();
                const w = typeof window !== "undefined" ? window.innerWidth : 1024;
                let bp = "vp-lg";
                if (w < 640)
                    bp = "base";
                else if (w < 1024)
                    bp = "vp-md";
                emitEvent({
                    type: "CUSTOM",
                    dynaep_type: "AEP_RUNTIME_COORDINATES",
                    target_id: id,
                    coordinates: {
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                        rendered_at: bp,
                        visible: rect.width > 0 && rect.height > 0,
                    },
                });
                this.debounceTimers.delete(id);
            }, debounceMs));
        };
        // Observe all existing elements
        for (const id of Object.keys(this.liveElements)) {
            const el = document.querySelector(`[data-aep-id="${id}"]`);
            if (el) {
                const observer = new ResizeObserver(() => measure(id));
                observer.observe(el);
                this.observers.set(id, observer);
            }
        }
    }
    stopReflection() {
        for (const observer of this.observers.values()) {
            observer.disconnect();
        }
        this.observers.clear();
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
    }
    // -------------------------------------------------------------------------
    // Scene Snapshot
    // -------------------------------------------------------------------------
    getSceneSnapshot() {
        return structuredClone(this.liveElements);
    }
    getLiveElements() {
        return this.liveElements;
    }
    getElementVersion(id) {
        return this.elementVersions[id] ?? 0;
    }
    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------
    logLatticeEvent(eventType, payload, agentId) {
        this.latticeLogger?.logEvent({
            agent_id: agentId ?? "dynaep-bridge",
            channel_id: "ch-local-dynaep",
            event_type: eventType,
            payload,
        });
    }
    getLatticeEventCount() {
        return this.latticeLogger?.getEventCount() ?? 0;
    }
    createRejection(targetId, error, ts) {
        this.logLatticeEvent("DYNAEP_REJECTION", { target_id: targetId, error });
        return {
            type: "CUSTOM",
            dynaep_type: "DYNAEP_REJECTION",
            target_id: targetId,
            error,
            original_event_timestamp: ts ?? Date.now(),
        };
    }
    validateLatticeEvent(event) {
        if (!this.latticeFilter) {
            throw new Error("LatticeFilter is not initialised. Set bridgeConfig.lattice.registry and governance.");
        }
        return this.latticeFilter.filter(event);
    }
    async validateLatticeEventAsync(event) {
        if (!this.latticeFilter) {
            throw new Error("LatticeFilter is not initialised. Set bridgeConfig.lattice.registry and governance.");
        }
        return this.latticeFilter.filterAsync(event);
    }
    normalizeAgentContext(event) {
        const agentId = event.agent_id ?? event._agentId;
        if (!agentId)
            return;
        if (!event.agent_id)
            event.agent_id = agentId;
        if (!event._agentId)
            event._agentId = agentId;
    }
    registerAgentInterest(interest) {
        if (!this.latticeFilter) {
            console.warn("[DynAEPBridge] Cannot register agent interest: LatticeFilter not initialised");
            return;
        }
        this.latticeFilter.registerInterest(interest);
    }
    deregisterAgentInterest(agentId) {
        if (!this.latticeFilter) {
            console.warn("[DynAEPBridge] Cannot deregister agent interest: LatticeFilter not initialised");
            return;
        }
        this.latticeFilter.deregisterInterest(agentId);
    }
    // -------------------------------------------------------------------------
    // AG-UI Frontend Tool Definitions
    // -------------------------------------------------------------------------
    getToolDefinitions() {
        return [
            {
                name: "aep_add_element",
                description: "Propose a new element to the AEP scene graph. The bridge assigns and returns the official AEP ID.",
                parameters: {
                    type: "object",
                    properties: {
                        type: { type: "string", description: "Element type (shell, panel, component, cell_zone, etc)" },
                        parent: { type: "string", description: "AEP ID of the parent element" },
                        z: { type: "integer", description: "z-index (must fall within correct band for type prefix)" },
                        skin_binding: { type: "string", description: "Key mapping to component_styles in theme" },
                        label: { type: "string", description: "Human-readable name" },
                        layout: { type: "object", description: "Layout constraints (anchors, width, height)" },
                    },
                    required: ["type", "parent", "z", "skin_binding"],
                },
            },
            {
                name: "aep_move_element",
                description: "Change the parent or anchors of an existing AEP element",
                parameters: {
                    type: "object",
                    properties: {
                        id: { type: "string" },
                        new_parent: { type: "string" },
                        anchors: { type: "object" },
                    },
                    required: ["id"],
                },
            },
            {
                name: "aep_query_graph",
                description: "Query the AEP scene graph for element relationships, z-bands or viewport visibility",
                parameters: {
                    type: "object",
                    properties: {
                        query_type: {
                            type: "string",
                            enum: ["children_of", "parent_of", "z_band_of", "visible_at_breakpoint", "full_element", "next_available_id"],
                        },
                        target_id: { type: "string" },
                    },
                    required: ["query_type", "target_id"],
                },
            },
            {
                name: "aep_swap_theme",
                description: "Replace the active AEP theme",
                parameters: {
                    type: "object",
                    properties: { theme_name: { type: "string" } },
                    required: ["theme_name"],
                },
            },
        ];
    }
    // -------------------------------------------------------------------------
    // Tool Call Handler
    // -------------------------------------------------------------------------
    handleToolCall(toolName, args) {
        switch (toolName) {
            case "aep_add_element":
                return this.handleAddElement(args);
            case "aep_move_element":
                return this.handleMoveElement(args);
            case "aep_query_graph":
                return this.handleQueryTool(args);
            case "aep_swap_theme":
                return { success: true, result: `Theme swap to "${args.theme_name}" requested` };
            default:
                return { success: false, errors: [`Unknown tool: ${toolName}`] };
        }
    }
    handleAddElement(args) {
        const { type, parent, z, skin_binding, label, layout } = args;
        const errors = [];
        // Validate type
        if (!TYPE_TO_PREFIX[type]) {
            errors.push(`Unknown element type: "${type}"`);
            return { success: false, errors };
        }
        // Validate parent exists
        if (!this.liveElements[parent]) {
            errors.push(`Parent ${parent} does not exist`);
            return { success: false, errors };
        }
        // Validate skin_binding resolves
        if (!this.config.theme.component_styles[skin_binding]) {
            errors.push(`skin_binding "${skin_binding}" not found in theme`);
            return { success: false, errors };
        }
        // Validate z-band
        const prefix = TYPE_TO_PREFIX[type];
        const [minZ, maxZ] = zBandForPrefix(prefix);
        if (typeof z !== "number" || z < minZ || z > maxZ) {
            errors.push(`z=${z} outside band ${minZ}-${maxZ} for prefix ${prefix}`);
            return { success: false, errors };
        }
        // Mint ID
        const newId = this.mintElementId(type);
        // Create element
        const newElement = {
            id: newId,
            type,
            label: label ?? newId,
            z,
            visible: true,
            parent,
            layout: layout ?? {},
            children: [],
        };
        // Apply to live scene
        this.liveElements[newId] = newElement;
        this.elementVersions[newId] = 1;
        // Add to parent children
        const parentEl = this.liveElements[parent];
        if (parentEl && !parentEl.children.includes(newId)) {
            parentEl.children.push(newId);
            this.elementVersions[parent] = (this.elementVersions[parent] ?? 0) + 1;
        }
        return { success: true, element_id: newId };
    }
    handleMoveElement(args) {
        const { id, new_parent, anchors } = args;
        if (!this.liveElements[id]) {
            return { success: false, errors: [`Element ${id} not found`] };
        }
        if (new_parent) {
            if (!this.liveElements[new_parent]) {
                return { success: false, errors: [`Parent ${new_parent} not found`] };
            }
            const el = this.liveElements[id];
            // Remove from old parent
            if (el.parent && this.liveElements[el.parent]) {
                this.liveElements[el.parent].children = this.liveElements[el.parent].children.filter((c) => c !== id);
                this.elementVersions[el.parent] = (this.elementVersions[el.parent] ?? 0) + 1;
            }
            // Set new parent
            el.parent = new_parent;
            // Add to new parent
            if (!this.liveElements[new_parent].children.includes(id)) {
                this.liveElements[new_parent].children.push(id);
                this.elementVersions[new_parent] = (this.elementVersions[new_parent] ?? 0) + 1;
            }
        }
        if (anchors && this.liveElements[id].layout) {
            this.liveElements[id].layout.anchors = anchors;
        }
        this.elementVersions[id] = (this.elementVersions[id] ?? 0) + 1;
        return { success: true, element_id: id };
    }
    handleQueryTool(args) {
        const queryEvent = this.handleQuery({
            type: "CUSTOM",
            dynaep_type: "AEP_QUERY",
            query: args.query_type,
            target_id: args.target_id,
        });
        return { success: true, result: queryEvent.result };
    }
    // -------------------------------------------------------------------------
    // OPT-002: Rego Scene/Registry Builders
    // -------------------------------------------------------------------------
    buildRegoScene() {
        const scene = { aep_version: this.config.scene.aep_version };
        for (const [id, el] of Object.entries(this.liveElements)) {
            scene[id] = {
                z: el.z,
                parent: el.parent,
                children: el.children,
                visible: el.visible,
            };
        }
        return scene;
    }
    buildRegoRegistry() {
        const registry = { aep_version: this.config.scene.aep_version };
        for (const [id, entry] of Object.entries(this.config.registry)) {
            registry[id] = { skin_binding: entry.skin_binding ?? "" };
        }
        return registry;
    }
    // -------------------------------------------------------------------------
    // OPT-003: Text Payload Extraction for Content Scanning
    // -------------------------------------------------------------------------
    extractTextPayload(event) {
        const parts = [];
        // Extract from mutation values
        if (event.mutation) {
            for (const value of Object.values(event.mutation)) {
                if (typeof value === "string")
                    parts.push(value);
            }
        }
        // Extract from delta values
        if (Array.isArray(event.delta)) {
            for (const op of event.delta) {
                if (typeof op.value === "string")
                    parts.push(op.value);
            }
        }
        // Extract from query string
        if (typeof event.query === "string")
            parts.push(event.query);
        // Extract from any text/content/body/label fields
        for (const key of ["text", "content", "body", "label", "code", "html", "css", "script"]) {
            if (typeof event[key] === "string")
                parts.push(event[key]);
        }
        return parts.join(" ");
    }
    // -------------------------------------------------------------------------
    // OPT-002/003: Accessors
    // -------------------------------------------------------------------------
    getRegoEvaluator() {
        return this.regoEvaluator;
    }
    getContentScanner() {
        return this.contentScanner;
    }
    // -------------------------------------------------------------------------
    // TA-1: Temporal Authority Accessors
    // -------------------------------------------------------------------------
    getClock() {
        return this.bridgeClock;
    }
    getTemporalValidator() {
        return this.temporalValidator;
    }
    getCausalEngine() {
        return this.causalEngine;
    }
    getForecastSidecar() {
        return this.forecastSidecar;
    }
    getEvidenceLedger() {
        return this.evidenceLedger;
    }
    getTemplateResolver() {
        return this.templateResolver;
    }
    // -------------------------------------------------------------------------
    // OPT-004: Chain Executor Factory
    // -------------------------------------------------------------------------
    /**
     * Create a chain executor based on the configured execution mode.
     * "parallel" mode uses 5-stage concurrent execution (OPT-004).
     * "sequential" mode preserves the original step-by-step evaluation.
     *
     * @param steps - Array of exactly 15 StepExecutor implementations
     * @returns ChainExecutor configured per bridge settings
     */
    createChainExecutor(steps) {
        const mode = this.bridgeConfig.chain_execution?.mode ?? "sequential";
        if (mode === "parallel") {
            return new ParallelChainExecutor(steps);
        }
        return new SequentialChainExecutor(steps);
    }
    // -------------------------------------------------------------------------
    // TA-1: Clock Sync Broadcasting
    // -------------------------------------------------------------------------
    startClockSync(emitEvent) {
        this.eventEmitter = emitEvent;
        // OPT-001: Start the forecast background worker
        this.forecastSidecar.startWorker();
        // OPT-006: Start the evidence ledger auto-flush
        this.evidenceLedger.startAutoFlush();
        const syncIntervalMs = this.bridgeConfig.timekeeping?.syncIntervalMs ?? 30000;
        const doSync = async () => {
            const syncResult = await this.bridgeClock.sync();
            if (syncResult.success && this.eventEmitter) {
                const health = this.bridgeClock.health();
                const syncEvent = createClockSyncEvent({
                    bridgeTimeMs: this.bridgeClock.now(),
                    source: health.protocol,
                    offsetMs: health.currentOffsetMs,
                    syncedAt: health.lastSyncAt,
                });
                this.eventEmitter(syncEvent);
            }
        };
        doSync().catch(() => {
            console.warn("[dynAEP-TA] Clock sync broadcast failed");
        });
        this.clockSyncTimer = setInterval(() => {
            doSync().catch(() => {
                console.warn("[dynAEP-TA] Periodic clock sync failed");
            });
        }, syncIntervalMs);
    }
    stopClockSync() {
        if (this.clockSyncTimer) {
            clearInterval(this.clockSyncTimer);
            this.clockSyncTimer = null;
        }
        this.eventEmitter = null;
        // OPT-001: Stop the forecast background worker
        this.forecastSidecar.stopWorker();
        // OPT-006: Final flush and stop the evidence ledger
        this.evidenceLedger.flush();
        this.evidenceLedger.stopAutoFlush();
    }
}
//# sourceMappingURL=bridge.js.map