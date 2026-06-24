export interface AgentIdentity {
  agentId: string;
  name: string;
  version: string;
  operator: string;
  description: string;
  capabilities: string[];
  covenants: string[];
  endpoints: Array<{ protocol: string; url: string }>;
  maxTrustTier: string;
  defaultRing: number;
  publicKey: string;
  createdAt: string;
  expiresAt: string;
  signature: string;
}

export interface CompactIdentity {
  agentId: string;
  name: string;
  publicKey: string;
  capabilities: string[];
  expiresAt: string;
  signature: string;
}
