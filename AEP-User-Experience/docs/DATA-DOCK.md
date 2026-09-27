# Data Dock

Data Dock is the HTTP JSON surface of the AEP Base Node. It gives frontends one plain way to read records that the lattice has already admitted and to send governed writes without handling any cryptography. The code lives in `AEP-Base-Node/AEP-Crate/src/data_dock.rs` and the Base Node daemon starts it next to the four docking ports.

Data Dock is not a fifth kernel dock. Every write it accepts is sealed on the server and then enters one of the four existing docks, so admission and denial follow the same lattice rules as any other agent traffic. UCB remains on port 8412, Display API is gone for good and port 28429 is never bound.

## Configuration

The daemon reads these environment variables at start.

| Variable | Default | Meaning |
|----------|---------|---------|
| `DATA_DOCK` | `1` | Set to `0` to turn Data Dock off |
| `DATA_DOCK_PORT` | `8413` | TCP port for the HTTP listener |
| `DATA_DOCK_HOST` | loopback outside Docker and `0.0.0.0` inside Docker | Bind address for the listener |

Outside Docker the listener binds to the loopback interface only. The Docker image sets `DATA_DOCK_HOST=0.0.0.0` and both compose files publish port 8413 next to UCB on 8412. The container entrypoint waits for `GET /health` on the Data Dock before it reports the node as ready.

On first start the daemon provisions a signing key for the server agent `data-dock` and writes the task manifest `data-dock.json` into the UCB manifest folder. The lattice policy must grant `data-dock` the action paths that frontends are allowed to write.

## Routes

### GET /health and GET /v1/health

These return the service health as JSON.

```json
{
  "ok": true,
  "service": "aep-data-dock",
  "version": "2.8.6",
  "status": "ok",
  "port": 8413,
  "ucb_port": 8412,
  "docks": 4,
  "display_api": false,
  "bind_28429": false
}
```

### GET /v1/ledger

This returns ledger rows that the lattice log has already admitted. The optional `limit` query parameter defaults to 100. A value of 0 means 100 and anything above 500 is cut to 500.

```json
{
  "ok": true,
  "rows": [
    {
      "id": 12,
      "event_type": "STATE_DELTA",
      "frame_digest": "9f2c...",
      "recorded_at_unix": 1790516000,
      "channel_id": "ch-data-dock",
      "contract_id": "dynaep-action-lattice",
      "payload": { "action_path": "root:ping" }
    }
  ]
}
```

### GET /v1/events

This returns the same rows as `/v1/ledger` under the key `events` and takes the same `limit` parameter.

### POST /v1/actions

This accepts one governed write as plain JSON.

| Field | Required | Meaning |
|-------|----------|---------|
| `action_path` | yes | Lattice action path such as `root:ping` |
| `payload` | no | JSON object that travels with the action and defaults to an empty object |
| `target_id` | no | Copied into the payload when the payload has no `target_id` of its own |
| `channel_id` | no | Lattice channel that defaults to `ch-data-dock` |
| `docking_port` | no | One of `validation_engine`, `inference_engine`, `regulation_module` or `future_features` with `validation_engine` as the default |
| `event_type` | no | Event type that defaults to `STATE_DELTA` |

The server builds the transport frame, signs it as `data-dock` and submits it to the chosen dock. It then waits up to three pulse beats for admission. An admitted write returns the ledger row.

```json
{ "ok": true, "row": { "id": 13, "event_type": "STATE_DELTA", "frame_digest": "4b1e...", "recorded_at_unix": 1790516010, "channel_id": "ch-data-dock", "contract_id": "dynaep-action-lattice", "payload": { "action_path": "root:ping" } } }
```

A denied write returns HTTP 422 with the deny payload from the dock.

```json
{ "ok": false, "error": "Admit denied", "deny": { } }
```

## Frontend contract

The frontend never seals anything. A request that carries any of `agent_id`, `grants`, `agent_permission`, `frame`, `sealed`, `signer_public_hex`, `trust_score`, `capsule`, `lattice_frame` or `agentmesh` at any depth is refused with HTTP 400. The same keys are stripped from every row before it leaves the server, so public JSON never shows a sealed frame, an agent id or a grant.

## Errors

| Status | When |
|--------|------|
| 400 | Refused frontend field, missing `action_path`, a payload that is not an object or an unknown `docking_port` |
| 422 | Frame build failure, missing signing key, dock denial or a dock that did not admit |
| 500 | The lattice log could not be read |

Every error body has `ok` set to false and an `error` string.

## Verification

Run `cargo test -p aep-base-node` from the repository root. The Data Dock tests check that health and ledger answer as JSON without seal fields, that public rows lose agent ids and grants, that seal fields on a request or its payload are refused and that a server-sealed write returns either an admitted row or a deny payload. They also check that the four docks remain and that no Display API folder exists.
