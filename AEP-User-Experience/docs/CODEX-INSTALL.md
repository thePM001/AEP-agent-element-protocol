# OpenAI Codex + AEP

1. Start AEP Base Node (Docker or local wizard) and complete activation.
2. From your project directory run `npx aep init codex`.
3. In Codex TUI run `/mcp` to confirm the `aep` MCP server is active.
4. Use `/aepassist` or ask Codex to run governed tasks through AEP MCP tools.

Creates `AGENTS.md`, `agent.policy.yaml` and `.codex/config.toml` with `npx aep proxy --policy ./agent.policy.yaml`.

See also [`AEP-SDKs/typescript/aep-protocol/README.md`](../../AEP-SDKs/typescript/aep-protocol/README.md).