// @PAD: /root/dynAEP/sdk/types/aep-core.d.ts
// Type declaration stubs for @aep/core.
// The AEP core package is a peer dependency of dynAEP. These stubs
// provide the minimum type surface needed for dynAEP TypeScript
// compilation without installing the full AEP package.
//
// In production, replace this file with the actual @aep/core package.

declare module "@aep/core" {
  export type ValidationOutcome = "accepted" | "rejected";

  export interface MemoryEntry {
    id: string;
    timestamp: string;
    element_id: string;
    domain: "ui" | "workflow" | "api" | "event" | "iac";
    proposal: Record<string, unknown>;
    result: ValidationOutcome;
    errors: string[];
    traversal_path: string[];
    embedding?: number[];
    metadata?: Record<string, unknown>;
  }

  export interface MemoryFabric {
    record(entry: MemoryEntry): void;
    findNearestAttractor(embedding: number[], limit?: number): MemoryEntry[];
    getRejectionHistory(elementId: string): MemoryEntry[];
    getAcceptanceHistory(elementId: string): MemoryEntry[];
    getValidationCount(elementId: string): number;
    getFastPathHit(embedding: number[], threshold?: number): MemoryEntry | null;
    exportHistory(): MemoryEntry[];
    clear(): void;
  }

  export interface AEPConfig {
    scene: {
      elements: Record<string, AEPElement>;
      aep_version?: string;
    };
    registry: Record<string, AEPRegistryEntry>;
    theme: AEPTheme;
    meta: Record<string, unknown>;
    memory?: MemoryFabric;
    [key: string]: unknown;
  }

  export interface AEPElement {
    id: string;
    label: string;
    category?: string;
    skin_binding?: string;
    parent?: string;
    children: string[];
    type?: string;
    z?: number;
    layout?: {
      anchors?: Record<string, string>;
      width?: number;
      height?: number;
      [key: string]: unknown;
    };
    responsive_matrix?: Record<string, unknown>;
    visible?: boolean;
    metadata?: Record<string, unknown> | null;
    [key: string]: unknown;
  }

  export interface AEPRegistryEntry {
    label: string;
    category: string;
    skin_binding: string;
    allowed_parents?: string[];
    allowed_children?: string[];
    default_z_band?: number;
    [key: string]: unknown;
  }

  export interface AEPTheme {
    component_styles: Record<string, Record<string, string>>;
    [key: string]: unknown;
  }

  export interface AEPValidationResult {
    valid: boolean;
    errors: string[];
    warnings?: string[];
    [key: string]: unknown;
  }

  export function zBandForPrefix(prefix: string): [number, number];
  export function prefixFromId(id: string): string;
  export function isTemplateInstance(
    elementOrId: AEPElement | string,
    registry?: Record<string, AEPRegistryEntry>,
  ): boolean;
  export function validateJIT(
    config: AEPConfig,
    elementId: string,
    change: Partial<AEPElement> & { skin_binding?: string },
    memory?: MemoryFabric,
  ): AEPValidationResult;
  export function loadAEPConfigs(configPath: string, ...extraPaths: string[]): AEPConfig;
  export function validateAOT(config: AEPConfig): AEPValidationResult;
  export function createMemoryEntry(
    elementId: string,
    domain: MemoryEntry["domain"],
    proposal: Record<string, unknown>,
    result: ValidationOutcome,
    errors: string[],
    traversalPath: string[],
    embedding?: number[],
    metadata?: Record<string, unknown>,
  ): MemoryEntry;
  export function createDefaultMemoryFabric(): MemoryFabric;
  export function isBaseNodeMemoryAvailable(): boolean;

  export interface DynAepLatticeEvent {
    agent_id: string;
    channel_id: string;
    contract_id?: string;
    event_type: string;
    session_id?: string;
    docking_port?: string;
    trust_score?: number;
    payload: Record<string, unknown>;
  }

  export interface DynAepEventRecord {
    ok: boolean;
    event_id: number;
    frame_digest: string;
    recorded_at_unix: number;
  }

  export interface BaseNodeLatticeLogger {
    available(): boolean;
    logEvent(event: DynAepLatticeEvent): DynAepEventRecord | null;
    getEventCount(): number;
    exportEvents(limit?: number): unknown[];
  }

  export function createDefaultLatticeLogger(): BaseNodeLatticeLogger | null;
  export function isBaseNodeLatticeAvailable(): boolean;
}
