import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TRUST_DOMAIN = process.env.AEP_TRUST_DOMAIN || "aep.protocol.local";
const DID_METHOD = "aep";
const MTLS_TTL_SECS = 3600;

export function trustTier(score) {
  if (score >= 800) return 4;
  if (score >= 600) return 3;
  if (score >= 400) return 2;
  if (score >= 200) return 1;
  return 0;
}

export function tierLabel(tier) {
  return (
    ["untrusted", "provisional", "standard", "trusted", "privileged"][tier] ??
    "unknown"
  );
}

function createMtlsWorkloadCert(agentId, trustScore, now) {
  const dir = mkdtempSync(join(tmpdir(), "agentmesh-"));
  try {
    const certPath = join(dir, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "ec:-secp256r1",
        "-days",
        "1",
        "-nodes",
        "-subj",
        `/CN=${agentId}/O=AEP AgentMesh`,
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        certPath,
      ],
      { stdio: "pipe" },
    );
    const certPem = readFileSync(certPath, "utf8");
    return {
      agent_id: agentId,
      trust_tier: trustTier(trustScore),
      cert_fingerprint: createHash("sha256").update(certPem).digest("hex"),
      issued_at_unix: now,
      not_after_unix: now + MTLS_TTL_SECS,
      cert_pem: certPem,
      subject: `CN=${agentId},O=AEP AgentMesh`,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function createAgentMeshBundle(agentId = "AG-COMPOSER-LITE", trustScore = 700) {
  const now = Math.floor(Date.now() / 1000);
  const ttl = MTLS_TTL_SECS;
  const spiffeId = `spiffe://${TRUST_DOMAIN}/agent/${agentId}`;
  const expires = now + ttl;
  const pk = randomBytes(32);
  const tier = trustTier(trustScore);

  return {
    agent_id: agentId,
    trust_score: trustScore,
    trust_tier: tier,
    trust_tier_label: tierLabel(tier),
    spiffe: {
      spiffe_id: spiffeId,
      svid: `${spiffeId}|${agentId}|${expires}|ed25519`,
      expires_at_unix: expires,
    },
    did: {
      id: `did:${DID_METHOD}:${agentId}`,
      verification_key_hex: pk.toString("hex"),
      capabilities: ["lattice-channels", "dock-validation", "policy-lattice-read"],
      service_endpoints: [],
    },
    mtls: createMtlsWorkloadCert(agentId, trustScore, now),
    signal_protocol: {
      enabled: true,
      session_state: "pre-key-bundle-ready",
    },
  };
}