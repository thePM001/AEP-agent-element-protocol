/**
 * Resource Protocol - Standardized resource listing and access.
 * Enables agents to discover and read data sources through a uniform interface.
 * Part of AEP-Comm v2.75. Matches Anthropic MCP resource protocol.
 */

export interface Resource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  size?: number;
}

export interface ResourceTemplate {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface ResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

export interface ResourceSubscription {
  uri: string;
  callback: (uri: string) => void;
}

export class ResourceProtocol {
  private resources: Map<string, Resource> = new Map();
  private templates: ResourceTemplate[] = [];
  private subscriptions: Map<string, Set<(uri: string) => void>> = new Map();
  private handlers: Map<string, (uri: string) => Promise<ResourceContent>> = new Map();

  registerResource(resource: Resource, handler: (uri: string) => Promise<ResourceContent>): void {
    this.resources.set(resource.uri, resource);
    this.handlers.set(resource.uri, handler);
  }

  registerTemplate(template: ResourceTemplate): void {
    this.templates.push(template);
  }

  async listResources(): Promise<Resource[]> {
    return Array.from(this.resources.values());
  }

  listTemplates(): ResourceTemplate[] {
    return [...this.templates];
  }

  async readResource(uri: string): Promise<ResourceContent | null> {
    const handler = this.handlers.get(uri);
    if (!handler) return null;
    return handler(uri);
  }

  subscribe(uri: string, callback: (uri: string) => void): void {
    if (!this.subscriptions.has(uri)) {
      this.subscriptions.set(uri, new Set());
    }
    this.subscriptions.get(uri)!.add(callback);
  }

  unsubscribe(uri: string, callback: (uri: string) => void): void {
    this.subscriptions.get(uri)?.delete(callback);
  }

  notify(uri: string): void {
    this.subscriptions.get(uri)?.forEach((cb) => cb(uri));
  }
}
