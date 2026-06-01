# Agent Identity Verification

AEP 2.75 includes a complete cryptographic agent identity system.

## Features

- **Ed25519 key pairs**: Generate, sign, verify using Node.js crypto
- **Identity cards**: Agent ID, name, capabilities, covenants, endpoints, trust tier, expiry
- **Compact format**: Minimal identity for P2P exchange (agentId, publicKey, capabilities)
- **Challenge-response verification**: Prove agent identity without revealing private key
- **Capability advertising**: Agents declare what they can do

## Usage

```typescript
import { AgentIdentityManager } from '@aep/core/identity';
import { generateKeyPairSync } from 'node:crypto';

// Generate key pair
const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// Create identity
const identity = AgentIdentityManager.create({
  name: 'my-agent',
  version: '1.0.0',
  operator: 'my-org',
  description: 'Code review agent',
  capabilities: ['code_review', 'security_scan'],
  covenants: ['no_deploy', 'read_only'],
  endpoints: [{ protocol: 'mcp', url: 'http://localhost:8080' }],
  maxTrustTier: 'system',
  defaultRing: 2,
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
}, privateKey);

// Verify identity
const isValid = AgentIdentityManager.verify(identity);
console.log(`Identity valid: ${isValid}`);

// Share compact identity for discovery
const compact = AgentIdentityManager.compact(identity);
```

## Integration

- **Session registration**: Identity tied to session via evidence ledger
- **Trust scoring**: Identity verified on each interaction, score adjusted
- **Fleet governance**: Agent identity validated before fleet operations
- **Multi-agent**: Identity exchanged during collaboration handshake
