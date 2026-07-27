#!/usr/bin/env node
/**
 * Register the AEP Base Node with the local dynAEP Action Lattice.
 */

import { latticeDockRequest } from "../../../lattice-channels/lib/lattice-transport.mjs";

export const BASE_NODE_AGENT_ID = "AG-BASE-NODE";
export const BASE_NODE_CHANNEL_ID = "ch-AEP-Base-Node-local";
export const BASE_NODE_CONTRACT_ID = "dynaep-action-lattice";

export function buildBaseNodeRegisterWire({
  agentId = BASE_NODE_AGENT_ID,
  version = "2.8.0",
  registeredBy = "setup-agent",
  lrps = [],
} = {}) {
  return {
    event: {
      agent_id: agentId,
      channel_id: BASE_NODE_CHANNEL_ID,
      contract_id: BASE_NODE_CONTRACT_ID,
      event_type: "BASE_NODE_REGISTER",
      session_id: "AEP-Base-Node-boot",
      docking_port: "validation_engine",
      trust_score: 900,
      payload: {
        component: "aep-base-node",
        version,
        registered_by: registeredBy,
        lrps,
      },
    },
  };
}

export function registerBaseNodeWithLattice(socketBase, opts = {}) {
  const wire = buildBaseNodeRegisterWire(opts);
  return latticeDockRequest(socketBase, "validation_engine", wire.event, opts);
}