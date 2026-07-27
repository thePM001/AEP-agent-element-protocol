/**
 * Type re-exports for AEP-Comm harness (2.8 component paths).
 */

export type {
  AgentSkill,
  AgentCard,
} from "../AEP-Components/aep-comm/lib/agent-card.js";

export type {
  Task,
  TaskState,
  TaskManager,
} from "../AEP-Components/aep-comm/lib/task-lifecycle.js";

export type {
  ApprovalRequest,
  HumanInTheLoop,
} from "../AEP-Components/aep-comm/lib/human-in-the-loop.js";

export type {
  Resource,
  ResourceContent,
  ResourceProtocol,
} from "../AEP-Components/aep-comm/lib/resource-protocol.js";

export type {
  PromptTemplate,
  RenderedPrompt,
  PromptTemplateEngine,
} from "../AEP-Components/aep-comm/lib/prompt-templates.js";

export type {
  CodeExecutionRequest,
  CodeExecutionResult,
  SandboxPolicy,
  CodeSandbox,
} from "../AEP-Components/aep-comm/lib/code-sandbox.js";