# Data Dock

Data Dock is the HTTP JSON surface of the AEP Base Node. It gives frontends one plain way to read records that the lattice has already admitted and to send governed writes without handling any cryptography. The code lives in `AEP-Base-Node/AEP-Crate/src/data_dock.rs` and the Base Node daemon starts it next to the four docking ports.

Data Dock is not a fifth kernel dock. Every write it accepts is sealed on the server and then enters one of the four existing docks, so admission and denial follow the same lattice rules as any other agent traffic. UCB remains on port 8412, Display API is gone for good and port 28429 is never bound.

## Configuration

The daemon reads these environment variables at start.

| Variable | Default | Meaning |
|----------|---------|---------|
| `DATA_DOCK` | `1` | Set to `0` to turn Data Dock off |
| `DATA_DOCK_PORT` | `8413` | TCP port for the HTTP listener |
| `DATA_DOCK_HOST` | `127.0.0.1` | Bind address for the listener, loopback in every environment including Docker |
| `DATA_DOCK_API_KEY` | empty | Shared key for every `/v1` route. It wins over the key file whenever it is set |
| `UCB_PORT` | `8412` | Reported as `ucb_port` in the health body |

Data Dock binds to loopback by default even inside the Docker image. On loopback the key is optional. On any other host a key is always in force before the listener opens, chosen in this order.

1. `DATA_DOCK_API_KEY` from the environment. The key file is left untouched.
2. The key file `$AEP_DATA/keys/data-dock.http-key` when it holds 32 or more hex characters with mode 0600.
3. Otherwise the daemon mints 32 random bytes as 64 hex characters, writes them to that file with mode 0600 inside a 0700 folder and then listens. The log records the file path but never the key.

The daemon refuses to listen and exits with code 2 when the data folder is world-writable, when the key file is shorter than 32 hex characters or readable by others and when a minted key cannot be written with mode 0600. This file is the HTTP key and is separate from the `data-dock` signing key. There is no automatic rotation. To rotate, delete the file or set `DATA_DOCK_API_KEY` and restart the node.

On first start the daemon mints a signing key for the server agent `data-dock` and writes the task manifest `data-dock.json` into the UCB manifest folder. A later boot reuses that key, so a restart never rotates it. The lattice policy must grant `data-dock` the action paths that frontends are allowed to write.

## Generate a key

The key is yours to make and no central service knows it. The simplest route is to set `DATA_DOCK_HOST=0.0.0.0` and let the first boot mint the key file, then read it with `docker compose exec aep cat /data/aep/keys/data-dock.http-key` and hand that value to the frontends. To choose the key yourself instead, generate it as below and set it in the deployment environment, where it wins over the file.

1. Create a 32 byte random key as 64 hex characters.

   ```bash
   openssl rand -hex 32
   ```

   Without openssl the same result comes from `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

2. Put it in `.env` next to `docker-compose.yml` together with the host that opens the listener.

   ```text
   DATA_DOCK_HOST=0.0.0.0
   DATA_DOCK_API_KEY=<the 64 hex characters>
   ```

3. Restart the node with `docker compose up -d` so the daemon reads the new values.

4. Give the key to each frontend as a server side secret and send it on every `/v1` call as `Authorization: Bearer <key>`. Never ship it inside browser code that users can read.

To rotate the key, generate a new one, update `.env`, restart the node and update the frontends. The old key stops working at the restart. A node that listens on loopback only needs no key.

## Authorization

When a key is in force, from `DATA_DOCK_API_KEY` or from the key file, every `/v1` route requires it. Send it in one of two headers.

```text
Authorization: Bearer <key>
X-AEP-DATA-KEY: <key>
```

The server compares a SHA-256 digest of the presented key with the digest of the configured key in constant time. A missing or wrong key gets HTTP 401 with `{ "ok": false, "error": "unauthorized" }` and the key never appears in the log. `GET /health` needs no key and returns no ledger rows, so container probes can run without it. With no key configured on a loopback host the `/v1` routes answer without a header.

## Health

`GET /health` is open. `GET /v1/health` returns the same body behind the key.

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
  "bind_28429": false,
  "sqlite_closed": false,
  "last_tls_handshake_err": null,
  "drain_aborted_tasks": 0,
  "docking_ports_listening": true,
  "hub_loaded": true,
  "key_required": true
}
```

The `status` field comes from the same rollup that drives `aep-base-node --health` and the daemon ready log. It is `error` when the lattice ledger is closed, `degraded` when the dock sockets are missing, the Agent Control Hub is not loaded or the mesh peer file failed to load. Any other state reads `ok`. The `ok` field is true whenever the status is not `error`. The container probe counts the node as ready when this route answers HTTP 200 with a status other than `error`.

## Routes

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

```text
POST /v1/actions
Authorization: Bearer $DATA_DOCK_API_KEY
Content-Type: application/json

{ "action_path": "root:ping", "payload": {} }
```

| Field | Required | Meaning |
|-------|----------|---------|
| `action_path` | yes | Lattice action path such as `root:ping` |
| `payload` | no | JSON object that travels with the action and defaults to an empty object |
| `target_id` | no | Copied into the payload when the payload has no `target_id` of its own |
| `channel_id` | no | Lattice channel that defaults to `ch-data-dock` |
| `docking_port` | no | One of `validation_engine`, `inference_engine`, `regulation_module` or `future_features` with `validation_engine` as the default |
| `event_type` | no | Event type that defaults to `STATE_DELTA` |

Before anything is sealed the server checks the DockDefence fleet limiter and the per-signer limiter for the `data-dock` signer. That check does not spend a slot, so the dock counts each action once. A request over the limit gets HTTP 429 and no frame is built. Otherwise the server builds the transport frame, signs it as `data-dock` and submits it to the chosen dock, then waits up to three pulse beats for admission without blocking the runtime. An admitted write returns the ledger row.

```json
{ "ok": true, "row": { "id": 13, "event_type": "STATE_DELTA", "frame_digest": "4b1e...", "recorded_at_unix": 1790516010, "channel_id": "ch-data-dock", "contract_id": "dynaep-action-lattice", "payload": { "action_path": "root:ping" } } }
```

A denied write returns HTTP 422 with the deny payload from the dock.

```json
{ "ok": false, "error": "Admit denied", "deny": { } }
```

## No seal on the frontend

The frontend never seals anything and only adds the key header. A request that carries any of `agent_id`, `grants`, `agent_permission`, `frame`, `sealed`, `signer_public_hex`, `trust_score`, `capsule`, `lattice_frame` or `agentmesh` at any depth is refused with HTTP 400. The same keys are stripped from every row before it leaves the server, so public JSON never shows a sealed frame, an agent id or a grant.

## Status codes

| Status | When |
|--------|------|
| 200 | Health, ledger and events reads plus an admitted write |
| 400 | Refused frontend seal field, missing `action_path`, a payload that is not an object or an unknown `docking_port` |
| 401 | Missing or wrong key on a `/v1` route while a key is configured |
| 422 | Frame build failure, missing signing key, dock denial or a dock that did not admit |
| 429 | The fleet or the `data-dock` signer limit is reached, so no frame is built |
| 500 | The lattice log could not be read |

Every error body has `ok` set to false and an `error` string.

## Log

Data Dock writes to the official Base Node log with the event ids `data_dock.bind`, `data_dock.auth_fail`, `data_dock.ledger_read`, `data_dock.action_accept`, `data_dock.action_deny` and `data_dock.rate_limited`. Keys, seal material and grants are redacted before any line is written.

## Verification

Run `cargo test -p aep-base-node --lib` from the repository root. The Data Dock tests check the health rollup, the refusal of an open bind without a key, loopback without a key, 401 on every `/v1` route without the key, the strip of seal fields with a valid key, 429 over the limit without a ledger row and that a second boot keeps the `data-dock` key. The key tests check that a host other than loopback mints the key file with mode 0600, that a second boot reuses it, that an env key wins over the file, that loopback needs no file and that the minted key never appears in a log event. The base-node workflow also runs `aep-base-node --health` and checks the JSON status.
