{
  "address": {
    "domain": "aep.reference.lattice",
    "id": "lattice-channel-mandatory.v1"
  },
  "pattern": {
    "guard": "true",
    "invariants": [
      {"expr": "lattice-channel-only-transport", "lang": "gapdsl", "severity": "hard", "description": "Reject plain ping/event/register_lrp docking wire formats"},
      {"expr": "lattice-scene-validation-mandatory", "lang": "gapdsl", "severity": "hard", "description": "validateLatticeScene required for every system topology on config load"},
      {"expr": "no-npm-registry-distribution", "lang": "gapdsl", "severity": "hard", "description": "AEP must not ship or document npm registry install pathways"},
      {"expr": "containerized-modular-deploy", "lang": "gapdsl", "severity": "hard", "description": "Base Node kernel deploys via Docker or kernel admit dock only"},
      {"expr": "wasm-sandbox-lattice-socket", "lang": "gapdsl", "severity": "hard", "description": "WASM sandbox listens on Unix socket wasm_sandbox and plain HTTP :8423 is rejected"},
      {"expr": "composer-lite-wasm-lattice-proxy", "lang": "gapdsl", "severity": "hard", "description": "hyperlattice /api/wasm routes through the lattice channel socket only"},
      {"expr": "outbound-gateway-lattice-gate", "lang": "gapdsl", "severity": "hard", "description": "LLM, Agentstream, registry and external HTTP gated via the inference_engine dock"},
      {"expr": "setup-agent-inference-lattice-register", "lang": "gapdsl", "severity": "hard", "description": "INFERENCE_ENGINE_REGISTER sealed as a LatticeChannelFrame on the kernel admit dock"},
      {"expr": "docking-frame-only", "lang": "gapdsl", "severity": "hard", "description": "Docking client logEvent and ping use build-frame and no plain wire bypass"},
      {"expr": "ucb-secured-perimeter-dock", "lang": "gapdsl", "severity": "hard", "description": "Non AEP agent stacks integrate only via UCB :8412 and UCB uses lattice transport internally"},
      {"expr": "ucb-auth-required", "lang": "gapdsl", "severity": "hard", "description": "UCB ingest, delegate, rollback and MCP require an API key while lattice sockets stay non HTTP"},
      {"expr": "dynaep-observers-lattice-gate", "lang": "gapdsl", "severity": "hard", "description": "dynAEP poll, SSE and blockchain observers use observerLatticeFetch via the inference_engine dock"},
      {"expr": "dynaep-forecast-lattice-gate", "lang": "gapdsl", "severity": "hard", "description": "TimesFM forecast companion process health and predict HTTP gated via latticeGatedFetch"},
      {"expr": "lattice-transport-canonical-surface", "lang": "gapdsl", "severity": "hard", "description": "Lattice transport remains canonical in lattice-transport"},
      {"expr": "no-smtp-mail-transport-libraries", "lang": "gapdsl", "severity": "hard", "description": "Governed code must not ship SMTP mail clients such as nodemailer, smtplib, sendmail or createTransport"}
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
    "provenance": "AEP 2.9 Policy Lattice Reference",
    "version": "2.0.0",
    "stability": "stable",
    "aspect": "objective",
    "aep_version": "2.9.0"
  },
  "extensions": {
    "aep": {
      "description": "ALL AEP components MUST communicate only via PQEncryptedCapsule Lattice Channels.",
      "mandatory": true
    }
  }
}
