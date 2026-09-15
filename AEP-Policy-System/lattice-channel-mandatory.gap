{
  "address": {
    "domain": "aep.reference.lattice",
    "id": "lattice-channel-mandatory.v1"
  },
  "pattern": {
    "guard": "true",
    "description": "ALL AEP components MUST communicate only via PQEncryptedCapsule Lattice Channels.",
    "invariants": [
      {"expr": "lattice-channel-only-transport", "lang": "gapdsl", "severity": "critical", "description": "Reject plain ping/event/register_lrp docking wire formats"},
      {"expr": "lattice-scene-validation-mandatory", "lang": "gapdsl", "severity": "critical", "description": "validateLatticeScene required for every system topology on config load"},
      {"expr": "no-npm-registry-distribution", "lang": "gapdsl", "severity": "critical", "description": "AEP must not ship or document npm registry install pathways"},
      {"expr": "containerized-modular-deploy", "lang": "gapdsl", "severity": "critical", "description": "Base Node kernel deploys via Docker or validation-engine dock only"},
      {"expr": "wasm-sandbox-lattice-socket", "lang": "gapdsl", "severity": "critical", "description": "WASM sandbox listens on Unix socket wasm_sandbox and plain HTTP :8423 is rejected"},
      {"expr": "composer-lite-wasm-lattice-proxy", "lang": "gapdsl", "severity": "critical", "description": "Composer Lite /api/wasm routes through the lattice channel socket only"},
      {"expr": "outbound-gateway-lattice-gate", "lang": "gapdsl", "severity": "critical", "description": "LLM, Agentstream, registry and external HTTP gated via the inference_engine dock"},
      {"expr": "setup-agent-inference-lattice-register", "lang": "gapdsl", "severity": "critical", "description": "INFERENCE_ENGINE_REGISTER sealed as a LatticeChannelFrame on the validation dock"},
      {"expr": "docking-frame-only", "lang": "gapdsl", "severity": "critical", "description": "Docking client logEvent and ping use build-frame and no plain wire bypass"},
      {"expr": "ucb-secured-perimeter-dock", "lang": "gapdsl", "severity": "critical", "description": "Non AEP agent stacks integrate only via UCB :8412 and UCB uses lattice transport internally"},
      {"expr": "ucb-auth-required", "lang": "gapdsl", "severity": "critical", "description": "UCB ingest, delegate, rollback and MCP require an API key while lattice sockets stay non HTTP"},
      {"expr": "dynaep-observers-lattice-gate", "lang": "gapdsl", "severity": "critical", "description": "dynAEP poll, SSE and blockchain observers use observerLatticeFetch via the inference_engine dock"},
      {"expr": "dynaep-forecast-lattice-gate", "lang": "gapdsl", "severity": "critical", "description": "TimesFM forecast sidecar health and predict HTTP gated via latticeGatedFetch"},
      {"expr": "lattice-transport-canonical-surface", "lang": "gapdsl", "severity": "critical", "description": "Lattice transport stays canonical in lattice-transport"},
      {"expr": "no-smtp-mail-transport-libraries", "lang": "gapdsl", "severity": "critical", "description": "Governed code must not ship SMTP mail clients such as nodemailer, smtplib, sendmail or createTransport"}
    ]
  },
  "action": {
    "type": "reference",
    "address": {
      "domain": "aep.reference.lattice",
      "id": "lattice-transport.v1"
    }
  },
  "weight": 1.0,
  "composition": {
    "type": "atomic"
  },
  "metadata": {
    "provenance": "AEP 2.8.6 Policy Lattice Reference",
    "version": "2.0.0",
    "stability": "stable",
    "aspect": "objective",
    "mandatory": true,
    "aep_version": "2.8.6"
  }
}
