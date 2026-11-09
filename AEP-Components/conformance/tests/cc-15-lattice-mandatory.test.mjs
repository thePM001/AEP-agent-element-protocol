// CC-15: the lattice-mandatory policy ships with hard invariants, the policy-system
// context the agent builders read carries exactly those rules, and the frame builder
// seals a dynAEP event into a LatticeChannelFrame for one of the four docks only.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  gapRefExists,
  loadPolicySystemContext,
  resolveComplianceModulesForLrps,
} from "../../hyperlattice/lib/policy-system-context.mjs";
import { ALLOWED_DOCK_PORTS, buildLatticeFrame } from "../../lattice-channels/lib/lattice-transport.mjs";
import {
  REPO_ROOT,
  kernelFixtures,
  latticeLogBin,
  provisionedPublicHex,
} from "./support/paths.mjs";

const MANDATORY = join(REPO_ROOT, "AEP-Policy-System/lattice-channel-mandatory.gap");

function mandatoryPolicy() {
  return JSON.parse(readFileSync(MANDATORY, "utf8"));
}

const AGENT = "AG-CONF-15";

function pingEvent(port, agent = AGENT) {
  return {
    agent_id: agent,
    channel_id: "ch-conf-15",
    event_type: "PING",
    action_path: "root:ping",
    session_id: "sess-conf-15",
    docking_port: port,
    payload: { type: "PING", action_path: "root:ping", payload: { ok: true }, timestamp: 1_700_000_000_000 },
  };
}

describe("CC-15 lattice-mandatory policy artifacts and frame builder", () => {
  let dir;
  let configPath;
  let agentPublicHex;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "aep-cc15-"));
    // run.sh provisions the agent sign key with the Base Node operator step.
    const fixtures = kernelFixtures();
    agentPublicHex = provisionedPublicHex(fixtures, AGENT);
    configPath = join(dir, "base-node.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        version: "2.9",
        base_node: {
          lattice_db: join(fixtures, "action-lattice.db"),
          lrps: ["dynaep-action-lattice"],
        },
      }),
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("CC-15 the mandatory lattice policy ships with hard, unique invariants", () => {
    const policy = mandatoryPolicy();
    expect(policy.address).toMatchObject({ domain: "aep.reference.lattice", id: "lattice-channel-mandatory.v1" });
    const invariants = policy.pattern.invariants;
    expect(invariants.length).toBeGreaterThan(0);
    for (const inv of invariants) {
      expect(inv.severity).toBe("hard");
      expect(String(inv.description ?? "").trim()).not.toBe("");
    }
    const ids = invariants.map((i) => i.expr);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["lattice-channel-only-transport", "docking-frame-only"]));
  });

  it("CC-15 the policy-system context carries exactly the mandatory rules", () => {
    const ctx = loadPolicySystemContext(REPO_ROOT);
    expect(ctx.lattice_mandatory_rules).toEqual(mandatoryPolicy().pattern.invariants.map((i) => i.expr));
    expect(ctx.mandatory_gap).toBe("AEP-Policy-System/lattice-channel-mandatory.gap");
    expect(ctx.hierarchy.map((h) => h.level)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(ctx.reference_policies.length).toBeGreaterThan(0);
  });

  it("CC-15 every compliance module of the LRP catalog points at a GAP file that ships", () => {
    const ctx = loadPolicySystemContext(REPO_ROOT);
    const modules = resolveComplianceModulesForLrps((ctx.catalog.lrps ?? []).map((l) => l.id), ctx.catalog);
    expect(modules.length).toBeGreaterThan(0);
    expect(modules.filter((m) => !gapRefExists(m.gap_ref, REPO_ROOT)).map((m) => m.gap_ref)).toEqual([]);
  });

  it("CC-15 the frame builder seals an event into a LatticeChannelFrame for each dock", () => {
    for (const port of ALLOWED_DOCK_PORTS) {
      const built = buildLatticeFrame(pingEvent(port), { configPath, latticeLogBin: latticeLogBin() });
      expect(built.frame).toMatchObject({
        agent_id: AGENT,
        channel_id: "ch-conf-15",
        session_id: "sess-conf-15",
        docking_port: port,
      });
      expect(built.frame.capsule).toBeTruthy();
      expect(built.frame.sent_at_unix).toBeGreaterThan(0);
      expect(built.signer_public_hex).toBe(agentPublicHex);
      // The action travels sealed inside the capsule, never in the clear.
      expect(JSON.stringify(built.frame)).not.toContain("root:ping");
    }
  });

  it("CC-15 the frame builder refuses an agent with no provisioned sign key", () => {
    expect(() =>
      buildLatticeFrame(pingEvent("validation_engine", "AG-CONF-15-NOKEY"), {
        configPath,
        latticeLogBin: latticeLogBin(),
      }),
    ).toThrow(/SignKeyMissing/);
  });

  it("CC-15 the frame builder refuses a port that is not a dock", () => {
    expect(() =>
      buildLatticeFrame(pingEvent("wasm_sandbox"), { configPath, latticeLogBin: latticeLogBin() }),
    ).toThrow();
  });
});
