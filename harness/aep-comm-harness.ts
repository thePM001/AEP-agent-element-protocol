/**
 * AEP-Comm Universal Orchestration Harness
 *
 * Wires all AEP-Comm modules into the AEP 2.75 agent harness.
 * Provides discovery, messaging, task management, human-in-the-loop,
 * resource protocol, prompt templates and code sandbox.
 *
 * Usage in agent:
 *   import { AEPCommHarness } from "./aep-comm-harness.js";
 *   const comm = new AEPCommHarness({ agentId: "my-agent", ... });
 *   await comm.start();
 *   const card = comm.getAgentCard();
 *   const task = comm.createTask({ ... });
 */

import { AgentRegistryImpl } from "../src/aep-comm/discovery/registry.js";
import { DHTLite } from "../src/aep-comm/discovery/dht.js";
import { GossipProtocol } from "../src/aep-comm/discovery/gossip.js";
import { MessageRouterImpl } from "../src/aep-comm/messaging/router.js";
import { WSTransport } from "../src/aep-comm/messaging/transports/ws-transport.js";
import { SSETransport } from "../src/aep-comm/messaging/transports/sse-transport.js";
import { DelegateResolver } from "../src/aep-comm/delegate/resolver.js";
import { CollaborationManager } from "../src/fleet/collaboration/manager.js";
import { AgentstreamEvidenceBackend } from "../src/evidence/agentstream-backend.js";
import { createAgentCard, validateAgentCard } from "../src/aep-comm/agent-card.js";
import { TaskManager } from "../src/aep-comm/task-lifecycle.js";
import { HumanInTheLoop } from "../src/aep-comm/human-in-the-loop.js";
import { ResourceProtocol } from "../src/aep-comm/resource-protocol.js";
import { PromptTemplateEngine } from "../src/aep-comm/prompt-templates.js";
import { CodeSandbox } from "../src/aep-comm/code-sandbox.js";

import type {
  AgentCard, AgentSkill,
  Task, TaskState, TaskManager as ITaskManager,
  ApprovalRequest, HumanInTheLoop as IHumanInTheLoop,
  Resource, ResourceContent, ResourceProtocol as IResourceProtocol,
  PromptTemplate, RenderedPrompt, PromptTemplateEngine as IPromptTemplateEngine,
  CodeExecutionRequest, CodeExecutionResult, SandboxPolicy, CodeSandbox as ICodeSandbox,
} from "./types.js";

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
  public tasks: TaskManager;
  public approvals: HumanInTheLoop;
  public resources: ResourceProtocol;
  public prompts: PromptTemplateEngine;
  public sandbox: CodeSandbox;
  public evidence?: AgentstreamEvidenceBackend;

  private config: AEPCommHarnessConfig;
  private wsTransport: WSTransport;
  private sseTransport: SSETransport;

  constructor(config: AEPCommHarnessConfig) {
    this.config = config;

    // Discovery layer
    const dht = new DHTLite();
    this.registry = new AgentRegistryImpl();
    const gossip = new GossipProtocol(dht);

    // Messaging layer
    this.router = new MessageRouterImpl(this.registry, config.agentId);
    this.wsTransport = new WSTransport();
    this.sseTransport = new SSETransport();

    // Orchestration layer
    this.tasks = new TaskManager();
    this.approvals = new HumanInTheLoop();
    this.resources = new ResourceProtocol();
    this.prompts = new PromptTemplateEngine();
    this.sandbox = new CodeSandbox();

    // Evidence backend (optional)
    if (config.evidenceUrl) {
      this.evidence = new AgentstreamEvidenceBackend({
        url: config.evidenceUrl,
        capsule: config.evidenceCapsule || "aep-evidence",
      });
    }
  }

  async start(): Promise<void> {
    await this.registry.start();

    // Register self in the DHT
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

    // Connect evidence backend
    if (this.evidence) {
      await this.evidence.healthCheck();
    }
  }

  async stop(): Promise<void> {
    await this.registry.stop();
    await this.wsTransport.close();
    await this.sseTransport.close();
  }

  getAgentCard(): AgentCard {
    return createAgentCard({
      name: this.config.agentName,
      description: this.config.agentDescription,
      url: this.config.agentUrl,
      skills: this.config.skills || [],
      publicKey: this.config.publicKey,
      trustTier: this.config.trustTier,
    });
  }

  createTask(params: Parameters<TaskManager["createTask"]>[0]): Task {
    return this.tasks.createTask(params);
  }

  requestApproval(params: Parameters<HumanInTheLoop["requestApproval"]>[0]): ApprovalRequest {
    return this.approvals.requestApproval(params);
  }
}
