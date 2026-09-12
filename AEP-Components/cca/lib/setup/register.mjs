#!/usr/bin/env node
/**
 * Register the AEP Base Node with the local dynAEP Action Lattice.
 */

import { latticeDockRequest } from "../../../lattice-channels/lib/lattice-transport.mjs";
import { stripTrustFields } from "../strip-trust-fields.mjs";

export const AEP_PROTOCOL_VERSION = "2.8.5";
export const BASE_NODE_AGENT_ID = "AG-BASE-NODE";
export const BASE_NODE_CHANNEL_ID = "ch-AEP-Base-Node-local";
export const BASE_NODE_CONTRACT_ID = "dynaep-action-lattice";

export function buildBaseNodeRegisterWire({
  agentId = BASE_NODE_AGENT_ID,
  version = AEP_PROTOCOL_VERSION,
  registeredBy = "setup-agent",
  lrps = [],
} = {}) {
  const event = {
    agent_id: agentId,
    channel_id: BASE_NODE_CHANNEL_ID,
    contract_id: BASE_NODE_CONTRACT_ID,
    event_type: "BASE_NODE_REGISTER",
    session_id: "AEP-Base-Node-boot",
    docking_port: "validation_engine",
    payload: {
      component: "aep-base-node",
      version,
      registered_by: registeredBy,
      lrps,
    },
  };
  return {
    event: stripTrustFields(event),
  };
}

export function registerBaseNodeWithLattice(socketBase, opts = {}) {
  const wire = buildBaseNodeRegisterWire(opts);
  return latticeDockRequest(socketBase, "validation_engine", wire.event, opts);
}
