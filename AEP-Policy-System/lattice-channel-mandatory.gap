# Lattice Channel Mandatory - AEP 2.8
# severity: critical
# description: ALL AEP components MUST communicate only via PQEncryptedCapsule Lattice Channels.

rules:
  - id: lattice-channel-only-transport
    description: Reject plain ping/event/register_lrp docking wire formats
  - id: lattice-scene-validation-mandatory
    description: validateLatticeScene required for every system topology on config load
  - id: no-npm-registry-distribution
    description: AEP must not ship or document npm registry install pathways
  - id: containerized-modular-deploy
    description: Base Node kernel deploys via Docker or validation-engine dock only
  - id: wasm-sandbox-lattice-socket
    description: WASM sandbox listens on Unix socket wasm_sandbox; plain HTTP :8423 rejected
  - id: composer-lite-wasm-lattice-proxy
    description: Composer Lite /api/wasm/* routes through lattice channel socket only
  - id: outbound-gateway-lattice-gate
    description: LLM, Agentstream, registry, and external HTTP gated via inference_engine dock
  - id: setup-agent-inference-lattice-register
    description: INFERENCE_ENGINE_REGISTER sealed as LatticeChannelFrame on validation dock
  - id: sdk-docking-frame-only
    description: SDK docking client logEvent and ping use build-frame; no plain wire bypass
  - id: ucb-secured-perimeter-dock
    description: Non-AEP agent stacks integrate only via UCB (:8412); UCB uses lattice transport internally
  - id: ucb-auth-required
    description: UCB ingest/delegate/rollback/MCP require API key; lattice sockets remain non-HTTP
  - id: dynaep-observers-lattice-gate
    description: dynAEP poll/SSE/blockchain observers use observerLatticeFetch via inference_engine dock
  - id: dynaep-forecast-lattice-gate
    description: TimesFM forecast sidecar health/predict HTTP gated via latticeGatedFetch
  - id: typescript-sdk-unified-surface
    description: TypeScript SDK exports from typescript-sdk/index.ts; lattice transport canonical in lattice-transport/
  - id: no-smtp-mail-transport-libraries
    description: Governed code must not ship SMTP mail clients (nodemailer/smtplib/sendmail/createTransport); added 2026-07-21
  - id: changelog-public-surface-mandatory
    description: CHANGELOG.md must pass gate-changelog-public-surface (product changes only; no internal distribution hygiene narratives)
