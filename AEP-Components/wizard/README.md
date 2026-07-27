# AEP 2.8 Installation Wizard

Phase 1 interactive installer for Base Node, LRPs and lattice channel secrets.

## Usage

```bash
# Interactive
node wizard/install-wizard.mjs

# CI / automation
node wizard/install-wizard.mjs --non-interactive --config=/tmp/aep-test.json

# After wizard
source ~/.aep/lattice-channel.env
```

## Config output

- `~/.aep/base-node.json` - Base Node settings (mode 600)
- `~/.aep/lattice-channel.env` - `LATTICE_CHANNEL_SECRET` for Agent Composer interop
- `~/.aep/action-lattice.db` - forensic log + sqlite-vec Lattice Memory (USearch sidecar: `.usearch`)

Build CLIs: `cargo build --release -p aep-lattice-memory -p aep-base-node` (installs `aep-memory` and `aep-lattice-log` next to `aep-base-node`).

Run daemon (Phase 4 docking ports): `aep-base-node --daemon --config ~/.aep/base-node.json`

## LRP catalog

See `wizard/lrp/catalog.json`. EPSCOM is always mandatory with priority 255.

### Core LRPs

Runtime governance: dynAEP Action Lattice, lattice channel contract, 2.75 eval chain, optional GAP scanners and commerce subprotocol.

### Compliance modules

Optional regulation modules toggled in a separate wizard section:

| ID | Framework |
|----|-----------|
| `eu-ai-act` | EU AI Act |
| `gdpr` | GDPR |
| `soc2-type2` | SOC 2 Type II |
| `hipaa` | HIPAA |
| `nist-ai-rmf` | NIST AI RMF 1.0 |
| `iso-42001` | ISO/IEC 42001 |

Each module has a manifest in `wizard/lrp/modules/` and a reference GAP under `AEP-Policy-System/reference/`. See [`AEP-Policy-System/reference/`](../../AEP-Policy-System/reference/) for wiring and API details.