import { describe, it, expect } from 'vitest';

type AgentRole = 'supervisor' | 'worker' | 'reviewer';
type TaskStatus = 'pending' | 'assigned' | 'completed' | 'rejected';

interface Task {
  id: string;
  role: AgentRole;
  status: TaskStatus;
  assignedTo?: string;
}

class CollaborationManager {
  private agents: Map<string, AgentRole> = new Map();
  private tasks: Task[] = [];
  
  registerAgent(id: string, role: AgentRole): void {
    this.agents.set(id, role);
  }
  
  assignTask(taskId: string, role: AgentRole): Task {
    const available = [...this.agents.entries()]
      .filter(([_, r]) => r === role);
    
    const task: Task = {
      id: taskId,
      role,
      status: available.length > 0 ? 'assigned' : 'pending',
      assignedTo: available.length > 0 ? available[0][0] : undefined,
    };
    this.tasks.push(task);
    return task;
  }
  
  canDelegate(fromRole: AgentRole, toRole: AgentRole): boolean {
    const hierarchy: Record<AgentRole, number> = {
      supervisor: 3, reviewer: 2, worker: 1
    };
    return hierarchy[fromRole] >= hierarchy[toRole];
  }
  
  getTasksByRole(role: AgentRole): Task[] {
    return this.tasks.filter(t => t.role === role);
  }
}

describe('Multi-Agent Collaboration', () => {
  it('supervisor should be able to delegate to any role', () => {
    const mgr = new CollaborationManager();
    expect(mgr.canDelegate('supervisor', 'worker')).toBe(true);
    expect(mgr.canDelegate('supervisor', 'reviewer')).toBe(true);
    expect(mgr.canDelegate('supervisor', 'supervisor')).toBe(true);
  });

  it('worker should not delegate to supervisor', () => {
    const mgr = new CollaborationManager();
    expect(mgr.canDelegate('worker', 'supervisor')).toBe(false);
  });

  it('should assign tasks to registered agents', () => {
    const mgr = new CollaborationManager();
    mgr.registerAgent('agent-1', 'worker');
    const task = mgr.assignTask('task-1', 'worker');
    expect(task.status).toBe('assigned');
    expect(task.assignedTo).toBe('agent-1');
  });

  it('should leave tasks pending when no agent available', () => {
    const mgr = new CollaborationManager();
    const task = mgr.assignTask('task-2', 'worker');
    expect(task.status).toBe('pending');
  });
});
