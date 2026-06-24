/**
 * AEP-Comm Universal Orchestration Harness
 *
 * Wires all AEP-Comm modules into the AEP 2.8 agent harness.
 * Component paths: AEP-Components/aep-comm/lib/
 *
 * Usage:
 *   import { AEPCommHarness } from "./aep-comm-harness.js";
 *   const comm = new AEPCommHarness({ agentId: "my-agent", ... });
 *   await comm.start();
 */

import { AgentRegistryImpl } from "../AEP-Components/aep-comm/lib/discovery/registry.js";
import { DHTLite } from "../AEP-Components/aep-comm/lib/discovery/dht.js";
import { GossipProtocol } from "../AEP-Components/aep-comm/lib/discovery/gossip.js";
import { MessageRouterImpl } from "../AEP-Components/aep-comm/lib/messaging/router.js";
import { WSTransport } from "../AEP-Components/aep-comm/lib/messaging/transports/ws-transport.js";
import { SSETransport } from "../AEP-Components/aep-comm/lib/messaging/transports/sse-transport.js";
import { DelegateResolver } from "../AEP-Components/aep-comm/lib/delegate/resolver.js";
import { AgentstreamEvidenceBackend } from "../AEP-Components/evidence-ledger/lib/evidence/agentstream-backend.js";
import { createAgentCard } from "../AEP-Components/aep-comm/lib/agent-card.js";
import { TaskManager } from "../AEP-Components/aep-comm/lib/task-lifecycle.js";
import { HumanInTheLoop } from "../AEP-Components/aep-comm/lib/human-in-the-loop.js";
import { ResourceProtocol } from "../AEP-Components/aep-comm/lib/resource-protocol.js";
import { PromptTemplateEngine } from "../AEP-Components/aep-comm/lib/prompt-templates.js";
import { CodeSandbox } from "../AEP-Components/aep-comm/lib/code-sandbox.js";

import type { AgentSkill } from "./aep-comm-harness-types.js";

export type {
  AgentCard,
  AgentSkill,
  Task,
  TaskState,
  ApprovalRequest,
} from "./aep-comm-harness-types.js";

export interface AEPCommHarnessConfig {
  agentId: string;
  agentName: string;
  agentDescription: string;
  agentUrl: string;
  publicKey?: string;
  trustTier?: number;
  skills?: AgentSkill[];
  evidenceUrl?: string;
  evidenceCapsule?: string;
}

export class AEPCommHarness {
  public registry: AgentRegistryImpl;
  public router: MessageRouterImpl;
  public delegate: DelegateResolver;
  public tasks: TaskManager;
  public approvals: HumanInTheLoop;
  public resources: ResourceProtocol;
  public prompts: PromptTemplateEngine;
  public sandbox: CodeSandbox;
  public evidence?: AgentstreamEvidenceBackend;

  private config: AEPCommHarnessConfig;
  private wsTransport: WSTransport;
  private sseTransport: SSETransport;
  private gossip: GossipProtocol;

  constructor(config: AEPCommHarnessConfig) {
    this.config = config;

    const dht = new DHTLite();
    this.registry = new AgentRegistryImpl();
    this.gossip = new GossipProtocol(dht);

    this.router = new MessageRouterImpl(this.registry, config.agentId);
    this.delegate = new DelegateResolver(this.registry, this.router, config.agentId);
    this.wsTransport = new WSTransport();
    this.sseTransport = new SSETransport();

    this.tasks = new TaskManager();
    this.approvals = new HumanInTheLoop();
    this.resources = new ResourceProtocol();
    this.prompts = new PromptTemplateEngine();
    this.sandbox = new CodeSandbox();

    if (config.evidenceUrl) {
      this.evidence = new AgentstreamEvidenceBackend({
        url: config.evidenceUrl,
        capsule: config.evidenceCapsule || "aep-evidence",
      });
    }
  }

  async start(): Promise<void> {
    await this.registry.start();

    await this.registry.register({
      agentId: this.config.agentId,
      identity: { publicKey: this.config.publicKey || "" },
      status: "online",
      endpoints: [
        { protocol: "ws", url: `${this.config.agentUrl}/ws`, priority: 1 },
        { protocol: "sse", url: `${this.config.agentUrl}/sse`, priority: 2 },
      ],
      capabilities: this.config.skills?.map((s) => s.id) || [],
      trustTier: this.config.trustTier || 1,
      lastSeen: Date.now(),
      registeredAt: Date.now(),
    });

    await this.wsTransport.connect(`${this.config.agentUrl}/ws`);
    await this.sseTransport.connect(`${this.config.agentUrl}/sse`);
    await this.gossip.exchange(this.config.agentId, [this.config.agentId]);

    if (this.evidence) {
      await this.evidence.healthCheck();
    }
  }

  async stop(): Promise<void> {
    await this.registry.stop();
    await this.wsTransport.close();
    await this.sseTransport.close();
  }

  getAgentCard() {
    return createAgentCard({
      name: this.config.agentName,
      description: this.config.agentDescription,
      url: this.config.agentUrl,
      skills: this.config.skills || [],
      publicKey: this.config.publicKey,
      trustTier: this.config.trustTier,
    });
  }

  createTask(params: Parameters<TaskManager["createTask"]>[0]) {
    return this.tasks.createTask(params);
  }

  requestApproval(params: Parameters<HumanInTheLoop["requestApproval"]>[0]) {
    return this.approvals.requestApproval(params);
  }
}