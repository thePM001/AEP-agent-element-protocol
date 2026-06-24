import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  loadLrpCatalog,
  listPlatformContracts,
  listPlatformMandatoryPolicies,
  listComplianceModules,
} from "../../AEP-Components/wizard/lib/lrp.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_POLICIES = join(__dirname, "..", "..", "AEP-Policy-System");
const REFERENCE_DIR = join(REPO_POLICIES, "reference");

const LATTICE_HIERARCHY = [
  { id: "system", label: "SYSTEM", level: 0, description: "Most permissive apex" },
  { id: "governance.gap", label: "governance.gap", level: 1 },
  { id: "deployment.gap", label: "deployment.gap", level: 2 },
  { id: "writing.gap", label: "writing.gap", level: 3 },
  { id: "security.gap", label: "security.gap", level: 4 },
  { id: "sandbox", label: "SANDBOX", level: 5, description: "Most restrictive base" },
];

const DOCK_BY_CONTRACT = {
  "dynaep-action-lattice": "validation_engine",
  "lattice-channel-default": "validation_engine",
  "aep-275-eval-chain": "validation_engine",
  "gap-runtime-scanners": "regulation_module",
  "commerce-subprotocol": "regulation_module",
  "epscom-core": "regulation_module",
  "eu-ai-act": "regulation_module",
  gdpr: "regulation_module",
  "soc2-type2": "regulation_module",
  hipaa: "regulation_module",
  "nist-ai-rmf": "regulation_module",
  "iso-42001": "regulation_module",
};

export function buildPolicyLatticeView(activeRegulationLrps = []) {
  const catalog = loadLrpCatalog();
  const regulationLrps = activeRegulationLrps.length
    ? activeRegulationLrps.filter((id) => catalog.lrps?.some((l) => l.id === id))
    : (catalog.lrps ?? []).filter((l) => l.default_enabled).map((l) => l.id);

  const referencePolicies = listReferencePolicies();
  const platformContracts = listPlatformContracts(catalog);
  const platformMandatoryPolicies = listPlatformMandatoryPolicies(catalog);
  const complianceModules = listComplianceModules(catalog).map((l) => ({
    ...l,
    enabled: regulationLrps.includes(l.id),
  }));

  const channelBindings = [
    {
      lrp_id: catalog.epscom.id,
      contract_id: catalog.epscom.id,
      channel_id: `ch-${catalog.epscom.id}`,
      docking_port: DOCK_BY_CONTRACT[catalog.epscom.id] ?? "regulation_module",
      priority: catalog.epscom.priority,
      pq_capsule: true,
      agentmesh_required: true,
      epscom_supremacy: false,
      kind: "epscom",
    },
    ...platformContracts
      .filter((c) => c.kind === "kernel_contract")
      .map((contract) => ({
        lrp_id: contract.id,
        contract_id: contract.id,
        channel_id: `ch-${contract.id}`,
        docking_port: DOCK_BY_CONTRACT[contract.id] ?? "validation_engine",
        priority: 200,
        pq_capsule: true,
        agentmesh_required: true,
        epscom_supremacy: true,
        kind: "kernel_contract",
      })),
    ...regulationLrps.map((lrpId) => {
      const meta = catalog.lrps.find((l) => l.id === lrpId);
      return {
        lrp_id: lrpId,
        contract_id: lrpId,
        channel_id: `ch-${lrpId}`,
        docking_port: DOCK_BY_CONTRACT[lrpId] ?? "regulation_module",
        priority: meta?.priority ?? 150,
        pq_capsule: true,
        agentmesh_required: true,
        epscom_supremacy: true,
        kind: "regulation_lrp",
      };
    }),
  ];

  return {
    hierarchy: LATTICE_HIERARCHY,
    reference_policies: referencePolicies,
    epscom: catalog.epscom,
    platform_contracts: platformContracts,
    platform_mandatory_policies: platformMandatoryPolicies,
    active_regulation_lrps: regulationLrps.map((id) => {
      const meta = catalog.lrps.find((l) => l.id === id);
      return {
        id,
        name: meta?.name ?? id,
        priority: meta?.priority ?? 0,
        framework: meta?.framework ?? null,
        jurisdiction: meta?.jurisdiction ?? null,
        gap_ref: meta?.gap_ref ?? null,
        module_manifest: meta?.module_manifest ?? null,
        docking_port: DOCK_BY_CONTRACT[id] ?? "regulation_module",
      };
    }),
    /** @deprecated Use active_regulation_lrps. Kept for API compatibility. */
    active_lrps: regulationLrps.map((id) => {
      const meta = catalog.lrps.find((l) => l.id === id);
      return {
        id,
        name: meta?.name ?? id,
        priority: meta?.priority ?? 0,
        mandatory: false,
        epscom_priority: catalog.epscom.priority,
        category: "compliance",
        framework: meta?.framework ?? null,
        gap_ref: meta?.gap_ref ?? null,
        module_manifest: meta?.module_manifest ?? null,
        docking_port: DOCK_BY_CONTRACT[id] ?? "regulation_module",
      };
    }),
    compliance_modules: complianceModules,
    channel_bindings: channelBindings,
    epscom_priority: catalog.epscom.priority,
  };
}

function listReferencePolicies() {
  if (!existsSync(REFERENCE_DIR)) return [];
  return readdirSync(REFERENCE_DIR)
    .filter((f) => f.endsWith(".gap"))
    .map((file) => {
      const path = join(REFERENCE_DIR, file);
      let domain = basename(file, ".gap");
      try {
        const raw = JSON.parse(readFileSync(path, "utf8"));
        domain = raw?.address?.domain ?? domain;
      } catch {
        /* keep basename */
      }
      return { file, domain, path: `AEP-Policy-System/reference/${file}` };
    });
}