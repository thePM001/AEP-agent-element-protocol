/**
 * Agent Card - Google A2A-compatible agent capability description.
 * Published at /.well-known/agent.json for discovery.
 * Part of AEP-Comm v2.75 - Universal Orchestration.
 */

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples: string[];
  inputModes: string[];
  outputModes: string[];
}

export interface AgentCard {
  /** Semantic version of the Agent Card schema. */
  protocolVersion: "0.2.0";
  /** Unique name for the agent. */
  name: string;
  /** Human-readable description. */
  description: string;
  /** URL to the agent's service endpoint. */
  url: string;
  /** Provider organization. */
  provider?: {
    organization: string;
    url?: string;
  };
  /** Agent capabilities (AEP-Comm native). */
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  /** Authentication schemes supported. */
  authentication?: {
    schemes: string[];
    credentials?: string;
  };
  /** Default input/output modes. */
  defaultInputModes: string[];
  defaultOutputModes: string[];
  /** Skills this agent can perform. */
  skills: AgentSkill[];
  /** AEP-specific: trust tier requirement for interaction. */
  trustTier: number;
  /** AEP-specific: Ed25519 public key for identity verification. */
  publicKey?: string;
}

/**
 * Generate an Agent Card for this agent.
 */
export function createAgentCard(params: {
  name: string;
  description: string;
  url: string;
  skills: AgentSkill[];
  publicKey?: string;
  trustTier?: number;
  provider?: { organization: string; url?: string };
}): AgentCard {
  return {
    protocolVersion: "0.2.0",
    name: params.name,
    description: params.description,
    url: params.url,
    provider: params.provider,
    capabilities: {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: true,
    },
    authentication: params.publicKey
      ? { schemes: ["ed25519"], credentials: params.publicKey }
      : undefined,
    defaultInputModes: ["text", "json"],
    defaultOutputModes: ["text", "json"],
    skills: params.skills,
    trustTier: params.trustTier ?? 1,
    publicKey: params.publicKey,
  };
}

/**
 * Validate an Agent Card received from another agent.
 */
export function validateAgentCard(card: unknown): card is AgentCard {
  if (!card || typeof card !== "object") return false;
  const c = card as Record<string, unknown>;
  return (
    typeof c.name === "string" &&
    typeof c.description === "string" &&
    typeof c.url === "string" &&
    typeof c.protocolVersion === "string" &&
    Array.isArray(c.skills) &&
    Array.isArray(c.defaultInputModes) &&
    Array.isArray(c.defaultOutputModes)
  );
}

/**
 * Publish Agent Card as a well-known endpoint response.
 * Use in HTTP handler: GET /.well-known/agent.json -> agentCardToResponse(card)
 */
export function agentCardToResponse(card: AgentCard): object {
  return {
    ...card,
    "@context": "https://aep.newlisbon.agency/aep-comm/v1",
    "@type": "AgentCard",
  };
}
