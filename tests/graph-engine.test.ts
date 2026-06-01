import { describe, it, expect } from 'vitest';

interface GraphNode {
  id: string;
  type: 'action' | 'decision' | 'wait' | 'parallel' | 'loop';
  next: string[];
}

class GraphEngine {
  private nodes: Map<string, GraphNode> = new Map();
  
  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
  }
  
  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }
  
  validate(): string[] {
    const errors: string[] = [];
    for (const [id, node] of this.nodes) {
      for (const nextId of node.next) {
        if (!this.nodes.has(nextId)) {
          errors.push(`Node ${id} references missing node ${nextId}`);
        }
      }
    }
    return errors;
  }
  
  detectCycles(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const path: string[] = [];
    
    const dfs = (nodeId: string) => {
      if (path.includes(nodeId)) {
        const cycleStart = path.indexOf(nodeId);
        cycles.push([...path.slice(cycleStart), nodeId]);
        return;
      }
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      path.push(nodeId);
      const node = this.nodes.get(nodeId);
      if (node) {
        for (const next of node.next) dfs(next);
      }
      path.pop();
    };
    
    for (const id of this.nodes.keys()) dfs(id);
    return cycles;
  }
}

describe('AEP-Graph Orchestration', () => {
  it('should add and retrieve nodes', () => {
    const engine = new GraphEngine();
    engine.addNode({ id: 'start', type: 'action', next: ['middle'] });
    expect(engine.getNode('start')).toBeDefined();
    expect(engine.getNode('start')!.type).toBe('action');
  });

  it('should detect missing node references', () => {
    const engine = new GraphEngine();
    engine.addNode({ id: 'start', type: 'action', next: ['missing'] });
    const errors = engine.validate();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('missing');
  });

  it('should detect cycles', () => {
    const engine = new GraphEngine();
    engine.addNode({ id: 'a', type: 'action', next: ['b'] });
    engine.addNode({ id: 'b', type: 'action', next: ['a'] });
    const cycles = engine.detectCycles();
    expect(cycles.length).toBeGreaterThan(0);
  });

  it('should validate clean acyclic graph', () => {
    const engine = new GraphEngine();
    engine.addNode({ id: 'a', type: 'action', next: ['b'] });
    engine.addNode({ id: 'b', type: 'action', next: ['c'] });
    engine.addNode({ id: 'c', type: 'action', next: [] });
    expect(engine.validate()).toHaveLength(0);
    expect(engine.detectCycles()).toHaveLength(0);
  });
});
