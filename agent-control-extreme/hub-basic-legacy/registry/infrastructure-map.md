# Infrastructure Map

Reference document for the system architecture, services, and how agents
connect to them. Customize this for your own infrastructure.

## Service Map

| Service | Purpose | Access |
|---------|---------|--------|
| Code Repository | Git server with all project repos | Internal network |
| Agent Control Hub | Central policy and session management | Internal network |
| Knowledge Base | Documentation and project index | Internal network |
| Build Server | CI/CD pipeline and artifact storage | Internal network |

## Agent Access Points

Agents connect to the control hub via:

1. **Git API** - For registration, session tracking, policy retrieval
2. **Knowledge Base API** - For documentation search
3. **Index API** - For code/semantic search
4. **Bootstrap scripts** - Located in this repo under bootstrap/

## Network Rules

- All internal services bind to localhost or internal IP only
- No service binds to 0.0.0.0
- External access is through authenticated reverse proxy only
- Agent-to-agent communication is audited and logged
