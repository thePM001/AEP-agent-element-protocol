#!/usr/bin/env node

import {
  latticeDockRequest,
  latticeStrictEnabled,
} from "../../../AEP-Components/lattice-channels/lib/lattice-transport.mjs";
import {
  assertCcaChatWritingDraft,
  validateCcaChatWritingDraft,
} from "./cca-writing-validator.mjs";
import {
  buildComposerProtocolSpec,
  validateComposerTopology,
} from "./composer-protocol.mjs";
import {
  loadCcaGapPolicies,
  validateGapDocument,
  gapEngineHealth,
} from "./gap-constrained-engine.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/** dynAEP action_path nodes for Composer Lite CCA (see composer-cca-lattice.yaml). */
export const CCA_HYPERLATTICE_ACTIONS = {
  chat: "composer-lite:cca:chat",
  validateWriting: "composer-lite:cca:validate_writing",
  release: "composer-lite:cca:release",
  topologyPropose: "composer-lite:cca:topology:propose",
  topologyValidate: "composer-lite:cca:topology:validate",
  topologyApply: "composer-lite:cca:topology:apply",
};

export const CCA_COMPOSER_PROTOCOL = buildComposerProtocolSpec();

async function assertCcaGapPoliciesOnline(env = process.env) {
  const policies = loadCcaGapPolicies(__repoRoot);
  const writing = policies.find((p) => p.file === "cca-writing-chat.gap");
  if (!writing?.instruction) {
    throw new Error("CCA GAP policy cca-writing-chat.gap missing; run materialize-cca-gap.mjs");
  }
  await gapEngineHealth(env);
  const validated = await validateGapDocument(writing.instruction, env);
  if (!validated.ok) {
    throw new Error(`GAP engine rejected cca-writing-chat.gap: ${validated.errors?.join("; ")}`);
  }
  return { policies, writing_validation: validated };
}

export const CCA_WRITING_GAP_POLICY = {
  domain: "aep.reference.writing",
  gap_ref: "AEP-Policy-System/reference/writing.gap",
  hierarchy_level: "writing.gap",
};

function latticeOptsFrom(opts = {}) {
  return {
    configPath: opts.configPath,
    latticeDb: opts.latticeDb,
    latticeLogBin: opts.latticeLogBin,
  };
}

export function assertCcaHyperlatticeDockStages(stages, opts = {}) {
  if (!opts.socketBase || !latticeStrictEnabled(opts.env)) return;
  const failures = stages.filter(
    (s) =>
      s?.skipped !== "lattice_not_strict"
      && (!s?.recorded || s?.audit_error),
  );
  if (!failures.length) return;
  const detail = failures
    .map((s) => {
      const path = s.action_path ?? s.dock ?? "unknown";
      return s.audit_error ? `${path}: ${s.audit_error}` : `${path}: not recorded`;
    })
    .join("; ");
  const err = new Error(`Hyperlattice dock audit failed (fail-closed): ${detail}`);
  err.violations = failures.map((s) => ({
    rule: "hyperlattice_dock_audit",
    message: s.audit_error ?? "dock stage not recorded",
    action_path: s.action_path ?? s.dock,
  }));
  throw err;
}

function recordCcaLatticeStage(socketBase, stage, payload, opts = {}) {
  if (!socketBase || !latticeStrictEnabled(opts.env)) {
    return { recorded: false, skipped: "lattice_not_strict" };
  }
  const requireRecord = opts.requireDockRecord === true;
  const spec = {
    chat: {
      event_type: "CCA_CHAT_INFERENCE",
      action_path: CCA_HYPERLATTICE_ACTIONS.chat,
      docking_port: "inference_engine",
      channel_id: "ch-cca-inference",
    },
    validate_writing: {
      event_type: "CCA_WRITING_GAP_VALIDATE",
      action_path: CCA_HYPERLATTICE_ACTIONS.validateWriting,
      docking_port: "validation_engine",
      channel_id: "ch-cca-writing-gap",
    },
    release: {
      event_type: "CCA_OUTPUT_RELEASE",
      action_path: CCA_HYPERLATTICE_ACTIONS.release,
      docking_port: "validation_engine",
      channel_id: "ch-cca-output-release",
    },
    topology_propose: {
      event_type: "CCA_TOPOLOGY_PROPOSE",
      action_path: CCA_HYPERLATTICE_ACTIONS.topologyPropose,
      docking_port: "validation_engine",
      channel_id: "ch-cca-topology-propose",
    },
    topology_validate: {
      event_type: "CCA_TOPOLOGY_VALIDATE",
      action_path: CCA_HYPERLATTICE_ACTIONS.topologyValidate,
      docking_port: "validation_engine",
      channel_id: "ch-cca-topology-validate",
    },
    topology_apply: {
      event_type: "CCA_TOPOLOGY_APPLY",
      action_path: CCA_HYPERLATTICE_ACTIONS.topologyApply,
      docking_port: "validation_engine",
      channel_id: "ch-cca-topology-apply",
    },
  }[stage];

  if (!spec) throw new Error(`unknown CCA hyperlattice stage: ${stage}`);

  const event = {
    agent_id: "cca",
    channel_id: spec.channel_id,
    contract_id: "aep-275-eval-chain",
    event_type: spec.event_type,
    session_id: opts.sessionId ?? "cca-chat-session",
    docking_port: spec.docking_port,
    trust_score: opts.trustScore ?? 750,
    payload: {
      action_path: spec.action_path,
      topology: "hyperlattice",
      gap_policy: stage === "validate_writing" ? CCA_WRITING_GAP_POLICY : undefined,
      epscom_authority: "epscom-core",
      ...payload,
    },
  };

  try {
    const resp = latticeDockRequest(socketBase, spec.docking_port, event, latticeOptsFrom(opts));
    return { recorded: true, dock: spec.docking_port, action_path: spec.action_path, response: resp };
  } catch (err) {
    const failure = {
      recorded: false,
      dock: spec.docking_port,
      action_path: spec.action_path,
      audit_error: err.message,
    };
    if (requireRecord) {
      const blocked = new Error(
        `Hyperlattice dock audit failed (fail-closed): ${spec.action_path}: ${err.message}`,
      );
      blocked.violations = [
        {
          rule: "hyperlattice_dock_audit",
          message: err.message,
          action_path: spec.action_path,
        },
      ];
      throw blocked;
    }
    return failure;
  }
}

/**
 * Fail-closed CCA reply release through the Composer Lite hyperlattice wrap.
 * EPSCOM writing.gap (kernel) + lattice validation_engine audit before UI release.
 */
export async function releaseCcaReplyViaHyperlattice(text, opts = {}) {
  const stages = [];
  const mode = opts.mode ?? "chat";
  const ccaChat = opts.ccaChat ?? mode === "chat";
  let gapPolicyValidation = null;

  try {
    gapPolicyValidation = await assertCcaGapPoliciesOnline(opts.env);
    const dockOpts = { ...opts, requireDockRecord: true };

    const writingValidation = validateCcaChatWritingDraft(text, {
      ccaChat,
      greeting: opts.greeting ?? false,
      writingHelp: opts.writingHelp ?? false,
      ...latticeOptsFrom(opts),
    });
    if (!writingValidation.ok) {
      const err = new Error(
        `CCA hyperlattice writing.gap blocked draft: ${writingValidation.violations.map((v) => v.rule).join(", ")}`,
      );
      err.violations = writingValidation.violations;
      err.writing_validation = { ...writingValidation, ok: false };
      throw err;
    }

    assertCcaChatWritingDraft(text, {
      ccaChat,
      greeting: opts.greeting ?? false,
      writingHelp: opts.writingHelp ?? false,
      ...latticeOptsFrom(opts),
    });

    if (opts.socketBase) {
      stages.push(
        recordCcaLatticeStage(
          opts.socketBase,
          "validate_writing",
          {
            mode,
            text_len: String(text ?? "").length,
            policy: CCA_WRITING_GAP_POLICY,
            writing_validation: writingValidation,
            greeting_mode: writingValidation.greeting_mode,
            rules_checked: writingValidation.rules_checked,
          },
          dockOpts,
        ),
      );
    }

    const released = {
      text: String(text ?? ""),
      validation: writingValidation,
    };

    if (opts.socketBase) {
      stages.push(
        recordCcaLatticeStage(
          opts.socketBase,
          "release",
          {
            mode,
            text_len: released.text.length,
            writing_validation: released.validation,
            released_text_digest: released.text.length,
          },
          dockOpts,
        ),
      );
    }

    assertCcaHyperlatticeDockStages(stages, opts);

    return {
      text: released.text,
      writing_validation: released.validation,
      hyperlattice_validation: {
        ok: true,
        topology: "hyperlattice",
        mechanism: "one",
        agent_id: "cca",
        governed_by: ["writing.gap", "epscom-core", "gapc_validated", "validation_engine_dock"],
        gap_policy: {
          ...CCA_WRITING_GAP_POLICY,
          cca_gap_address:
            gapPolicyValidation?.policies?.find((p) => p.file === "cca-writing-chat.gap")?.address ?? null,
        },
        gap_engine_validation: gapPolicyValidation?.writing_validation ?? null,
        action_paths: [
          CCA_HYPERLATTICE_ACTIONS.chat,
          CCA_HYPERLATTICE_ACTIONS.validateWriting,
          CCA_HYPERLATTICE_ACTIONS.release,
        ],
        lattice_stages: stages,
        dock_audit_ok: true,
        dock_audit_warnings: [],
      },
    };
  } catch (err) {
    const blocked = {
      ok: false,
      topology: "hyperlattice",
      mechanism: "one",
      agent_id: "cca",
      governed_by: ["writing.gap", "epscom-core", "validation_engine_dock"],
      action_paths: [
        CCA_HYPERLATTICE_ACTIONS.chat,
        CCA_HYPERLATTICE_ACTIONS.validateWriting,
        CCA_HYPERLATTICE_ACTIONS.release,
      ],
      gap_policy: CCA_WRITING_GAP_POLICY,
      error: err.message,
      lattice_stages: stages,
      dock_audit_ok: false,
      dock_audit_warnings: stages
        .filter((s) => s?.audit_error)
        .map((s) => `${s.action_path}: ${s.audit_error}`),
    };
    const error = new Error(err.message);
    error.violations = err.violations ?? [];
    error.hyperlattice_validation = blocked;
    error.writing_validation = {
      ok: false,
      authority: "epscom-core",
      violations:
        err.violations?.length > 0
          ? err.violations
          : [{ rule: "release_blocked", message: err.message }],
    };
    throw error;
  }
}

/**
 * Validate CCA topology (plan or graph suggestion) through hyperlattice composer_protocol rules.
 * Throws if invalid (fail-closed before canvas apply).
 */
export function validateCcaTopologyViaHyperlattice(topology, opts = {}) {
  const stages = [];
  const validation = validateComposerTopology(topology ?? {});

  const dockOpts = { ...opts, sessionId: opts.sessionId ?? "cca-topology-validate", requireDockRecord: true };

  if (opts.socketBase) {
    stages.push(
      recordCcaLatticeStage(
        opts.socketBase,
        "topology_propose",
        {
          composer_protocol: CCA_COMPOSER_PROTOCOL.id,
          node_count: topology?.nodes?.length ?? 0,
          edge_count: topology?.edges?.length ?? 0,
        },
        dockOpts,
      ),
    );
    stages.push(
      recordCcaLatticeStage(
        opts.socketBase,
        "topology_validate",
        {
          composer_protocol: CCA_COMPOSER_PROTOCOL.id,
          valid: validation.valid,
          errors: validation.errors,
        },
        dockOpts,
      ),
    );
  }

  if (!validation.valid) {
    const err = new Error(
      `Composer protocol blocked topology: ${validation.errors.join("; ")}`,
    );
    err.violations = validation.errors.map((message) => ({
      rule: "composer_protocol",
      message,
    }));
    err.topology_validation = {
      ok: false,
      ...validation,
      hyperlattice: {
        topology: "hyperlattice",
        governed_by: ["composer-protocol"],
        action_paths: [
          CCA_HYPERLATTICE_ACTIONS.topologyPropose,
          CCA_HYPERLATTICE_ACTIONS.topologyValidate,
        ],
        composer_protocol: CCA_COMPOSER_PROTOCOL.id,
        lattice_stages: stages,
      },
    };
    throw err;
  }

  assertCcaHyperlatticeDockStages(stages, opts);

  return {
    validation: {
      ok: true,
      ...validation,
    },
    hyperlattice_validation: {
      ok: true,
      topology: "hyperlattice",
      governed_by: ["composer-protocol", "validation_engine_dock"],
      action_paths: [
        CCA_HYPERLATTICE_ACTIONS.topologyPropose,
        CCA_HYPERLATTICE_ACTIONS.topologyValidate,
        CCA_HYPERLATTICE_ACTIONS.topologyApply,
      ],
      composer_protocol: CCA_COMPOSER_PROTOCOL,
      lattice_stages: stages,
    },
  };
}

/** Record CCA inference request on hyperlattice inference_engine dock. */
export function recordCcaChatInference(meta, opts = {}) {
  if (!opts.socketBase) return { recorded: false };
  return recordCcaLatticeStage(
    opts.socketBase,
    "chat",
    {
      mode: meta.mode ?? "chat",
      message_len: String(meta.message ?? "").length,
      provider: meta.provider ?? null,
      model: meta.model ?? null,
    },
    opts,
  );
}

/**
 * Mandatory chat-box release gate. ALL CCA agent text must pass through this before
 * the UI may render it: inference_engine dock + EPSCOM writing.gap + validation_engine dock.
 * Throws fail-closed on any validation or dock audit failure.
 */
export async function releaseCcaTextToChatBox(text, opts = {}) {
  const mode = opts.mode ?? "chat";
  const ccaChat = opts.ccaChat ?? mode === "chat";
  const dockOpts = { ...opts, requireDockRecord: true };

  let chatStage = null;
  if (opts.recordInference !== false) {
    chatStage = recordCcaChatInference(
      {
        mode,
        message: opts.inferenceMessage ?? "",
        provider: opts.provider ?? null,
        model: opts.model ?? null,
      },
      dockOpts,
    );
  }

  const released = await releaseCcaReplyViaHyperlattice(text, {
    mode,
    ccaChat,
    greeting: opts.greeting ?? false,
    writingHelp: opts.writingHelp ?? false,
    ...dockOpts,
    sessionId: opts.sessionId ?? "cca-chat-release",
  });

  const wv = released.writing_validation;
  const hl = released.hyperlattice_validation;
  if (chatStage?.recorded) {
    hl.lattice_stages = [chatStage, ...(hl.lattice_stages ?? [])];
  }
  if (wv?.ok !== true || hl?.ok !== true || hl?.dock_audit_ok === false) {
    const err = new Error(
      "CCA reply blocked: EPSCOM writing.gap or hyperlattice validation did not pass (fail-closed)",
    );
    err.violations = wv?.violations ?? [{ rule: "release_blocked", message: err.message }];
    err.writing_validation = wv ?? {
      ok: false,
      authority: "epscom-core",
      violations: err.violations,
    };
    err.hyperlattice_validation = hl ?? {
      ok: false,
      topology: "hyperlattice",
      agent_id: "cca",
      governed_by: ["writing.gap", "epscom-core", "validation_engine_dock"],
      error: err.message,
      dock_audit_ok: false,
    };
    throw err;
  }

  return released;
}