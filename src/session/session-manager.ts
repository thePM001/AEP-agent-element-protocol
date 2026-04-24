import { Session } from "./session.js";
import type { SessionReport } from "./session.js";
import { loadPolicy } from "../policy/loader.js";

export class SessionManager {
  private sessions: Map<string, Session> = new Map();

  createSession(
    policyPath: string,
    metadata?: Record<string, string>
  ): Session {
    const policy = loadPolicy(policyPath);
    const session = new Session(policy, metadata);
    this.sessions.set(session.id, session);
    return session;
  }

  createSessionFromPolicy(
    policy: import("../policy/types.js").Policy,
    metadata?: Record<string, string>
  ): Session {
    const session = new Session(policy, metadata);
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(sessionId: string): Session | null {
    return this.sessions.get(sessionId) ?? null;
  }

  terminateSession(sessionId: string, reason: string): SessionReport {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found.`);
    }
    const report = session.terminate(reason);
    return report;
  }

  listActiveSessions(): Session[] {
    const active: Session[] = [];
    for (const session of this.sessions.values()) {
      if (session.state === "active" || session.state === "created") {
        active.push(session);
      }
    }
    return active;
  }

  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
