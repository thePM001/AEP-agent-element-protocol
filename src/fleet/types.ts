import { z } from "zod";

// --- Fleet Policy ---

export const FleetPolicySchema = z.object({
  enabled: z.boolean().optional().default(false),
  max_agents: z.number().positive().optional().default(10),
  max_total_cost_per_hour: z.number().nonnegative().optional().default(100),
  max_ring0_agents: z.number().nonnegative().optional().default(1),
  drift_pause_threshold: z.number().positive().optional().default(3),
  require_parent_covenant_subset: z.boolean().optional().default(true),
}).optional();

export type FleetPolicy = z.infer<typeof FleetPolicySchema>;

// --- Agent Summary ---

export interface AgentSummary {
  agentId: string;
  sessionId: string;
  trust: number;
  ring: number;
  drift: number;
  phase?: string;
  actions: { total: number; allowed: number; denied: number };
  cost: number;
  status: "active" | "paused" | "terminated";
}

// --- Fleet Alert ---

export type FleetAlertType =
  | "cost_threshold"
  | "drift_cluster"
  | "ring_saturation"
  | "agent_limit"
  | "trust_erosion_cluster";

export interface FleetAlert {
  type: FleetAlertType;
  message: string;
  severity: "warning" | "critical";
  timestamp: string;
  affectedAgents: string[];
}

// --- Fleet Status ---

export interface FleetStatus {
  activeAgents: number;
  totalSessions: number;
  agents: AgentSummary[];
  fleetTrust: number;
  fleetDrift: number;
  totalCost: number;
  totalTokens: number;
  alerts: FleetAlert[];
}

// --- Fleet Policy Result ---

export interface FleetViolation {
  type: string;
  message: string;
  current: number;
  limit: number;
}

export interface FleetAction {
  type: "reject_new_agent" | "pause_all" | "demote_ring0" | "pause_swarm";
  reason: string;
  affectedAgents: string[];
}

export interface FleetPolicyResult {
  violations: FleetViolation[];
  actions: FleetAction[];
}

// --- Register Result ---

export interface RegisterResult {
  registered: boolean;
  agentId: string;
  reason?: string;
}

// --- Spawn Result ---

export interface SpawnResult {
  allowed: boolean;
  reason?: string;
  childTrust: number;
  childRing: number;
}

// --- Message Scan Result ---

export interface MessageScanResult {
  passed: boolean;
  blocked: boolean;
  findings: Array<{
    scanner: string;
    severity: string;
    category: string;
    match: string;
  }>;
}
