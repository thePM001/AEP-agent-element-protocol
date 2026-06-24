/**
 * Prompt Templates - Parameterized prompt construction with validation.
 * Ensures consistent prompt building across agents.
 * Part of AEP-Comm v2.75. Matches Anthropic MCP prompt template protocol.
 */

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface PromptTemplate {
  name: string;
  description?: string;
  arguments: PromptArgument[];
}

export interface PromptMessage {
  role: "user" | "assistant";
  content: string;
}

export interface RenderedPrompt {
  messages: PromptMessage[];
}

export class PromptTemplateEngine {
  private templates: Map<string, {
    template: PromptTemplate;
    render: (args: Record<string, string>) => RenderedPrompt;
  }> = new Map();

  register(
    template: PromptTemplate,
    render: (args: Record<string, string>) => RenderedPrompt
  ): void {
    this.templates.set(template.name, { template, render });
  }

  list(): PromptTemplate[] {
    return Array.from(this.templates.values()).map((t) => t.template);
  }

  get(name: string): { template: PromptTemplate; render: (args: Record<string, string>) => RenderedPrompt } | null {
    return this.templates.get(name) ?? null;
  }

  render(name: string, args: Record<string, string>): RenderedPrompt | null {
    const entry = this.templates.get(name);
    if (!entry) return null;

    const missing = entry.template.arguments
      .filter((a) => a.required !== false)
      .filter((a) => !(a.name in args))
      .map((a) => a.name);

    if (missing.length > 0) {
      throw new Error(`Missing required arguments for "${name}": ${missing.join(", ")}`);
    }

    return entry.render(args);
  }
}
