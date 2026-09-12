# Error catalog (AEP 2.8.6)

This catalog is the public deny dialect for AEP 2.8.6. Base Node is the only live evaluator. UCB is an attach gateway and CAW is an execution companion so neither one is a second evaluator. Enqueue is not Admit. TypeScript processEvent is not product Admit. The theme yaml file has no Admit authority. Lattice Memory never admits and looking similar to a past allow is not allow.

The builder presents a manifest and a sealed capsule. Base Node freezes the clock at seal, waits the compiled 1000 ms pulse, runs every written wall together, records the ledger and applies only after Admit. A closed wall is a refuse. An empty agent permission list refuses.

## Field names

Each row in this catalog uses these field names:

- looks_like
- not_this
- code
- class
- when
- repair
- retry

code is the BaseNodeError variant or the public writing display name. class is one frozen DenyReport contract class. when is the condition that closes the wall. repair is command-shaped. retry is reseal yes or reseal no. looks_like names the false reading. not_this names the true operator action.

## DenyReport schema

DenyReport is the frozen refuse body returned when Admit does not allow. The shape is the same on Base Node docks and on the UCB gateway.

Field error is a string human refuse line. Writing refuses display as CORRECTWRITING_EN. Field closed is an array of ClosedWall from the collect-all pass. Field closed_set_key is a stable key of closed id, reason and class. Field repairs is an array of RepairHint with prescribed command-shaped repairs. Field reseal_required is a bool. Retry of the same sealed bytes is refuse.

ClosedWall id is the wall id. Writing walls use writing:* ids. ClosedWall reason is why this wall closed. ClosedWall class is the frozen contract class.

RepairHint wall_id is the closed wall id this repair belongs to. RepairHint field is the payload field to bind when the kind is bind_field. RepairHint kind is bind_field, rewrite_writing, reseal_new_capsule or closed_only. RepairHint fix is the command-shaped repair. Agent permission lists stay off this body.

Frozen DenyReport contract classes:

- writing
- security
- temporal
- capability
- poison
- structural

Writing class is CORRECTWRITING_EN and is not transport security. Capability class is agent permission. An empty agent permission list refuses.

## Clock table versus LARGE_STEP

Compiled pulse constants live in AEP-Components/base-node-pulse/crate. They are not environment variables, not dynAEP yaml keys and not the NTP LARGE_STEP clock-sync cap.

| Constant | Value | Role | Not this |
|----------|-------|------|----------|
| PULSE_MS | 1000 | Compiled wait after freeze-at-seal | env, dynAEP yaml, NTP LARGE_STEP |
| MAX_DRIFT_MS | 50 | Allowed drift against the freeze | Must not equal PULSE_MS |
| MAX_AGE_MS | 5000 | Pulse age after freeze | Must stay longer than PULSE_MS |
| MAX_FRAME_AGE_SECS | 300 | Wire sent_at freshness before open | Not pulse age |
| MAX_FRAME_FUTURE_SKEW_SECS | 60 | Wire future skew before open | Not pulse wait |
| LARGE_STEP | 1000 NTP | Clock-sync cap in dynAEP timekeeping | Not the kernel pulse |

Retry of a stale frame is reseal yes. Widening drift to 1000 is not a repair.

## Writing rows (CORRECTWRITING_EN)

Public writing policy name is CORRECTWRITING_EN. Class is writing. Wall ids are writing:*. Display text on DenyReport.error for these rows is CORRECTWRITING_EN. Rewrite the payload then reseal.

| looks_like | not_this | code | class | when | repair | retry |
|------------|----------|------|-------|------|--------|-------|
| Transport crypto death | Rewrite ASCII hyphen and reseal | CORRECTWRITING_EN | writing | U+2014 in payload | Replace U+2014 with ASCII hyphen then reseal | reseal yes |
| Transport crypto death | Rewrite ASCII hyphen and reseal | CORRECTWRITING_EN | writing | U+2013 in payload | Replace U+2013 with ASCII hyphen then reseal | reseal yes |
| Transport crypto death | Rewrite ASCII hyphen and reseal | CORRECTWRITING_EN | writing | U+2015 U+2E3A or U+2E3B | Replace dash substitutes with ASCII hyphen then reseal | reseal yes |
| Transport crypto death | Rewrite ASCII hyphen and reseal | CORRECTWRITING_EN | writing | U+2500 or U+2501 | Replace box-drawing dashes with ASCII hyphen then reseal | reseal yes |
| Transport crypto death | Rewrite ASCII hyphen and reseal | CORRECTWRITING_EN | writing | U+2212 used as dash | Replace minus sign used as dash with ASCII hyphen then reseal | reseal yes |
| Transport crypto death | Remove spaced double hyphen | CORRECTWRITING_EN | writing | Spaced double hyphen separators | Remove spaced double hyphen separators then reseal | reseal yes |
| Transport crypto death | Remove comma-space-and | CORRECTWRITING_EN | writing | Oxford comma | Remove comma before and/or then reseal | reseal yes |
| Transport crypto death | Space after ? or ! | CORRECTWRITING_EN | writing | Missing space after ? or ! before the next word | Put a space after ? or ! then reseal | reseal yes |

Wall ids for those rows:

- writing:no_em_dashes
- writing:no_en_dashes
- writing:no_dash_substitutes
- writing:no_box_drawing_dashes
- writing:no_minus_as_dash
- writing:no_double_hyphen
- writing:no_oxford_comma
- writing:punctuation_word_space

## BaseNodeError catalog

Typed kernel errors live on BaseNodeError. Admit wraps a DenyReport. Other variants map into DenyReport.error when the dock returns a refuse.

| looks_like | not_this | code | class | when | repair | retry |
|------------|----------|------|-------|------|--------|-------|
| A second evaluator failed | Collect-all walls closed | Admit | structural or the closed wall class | Collect-all returned closed walls | Bind the named field or rewrite CORRECTWRITING_EN then reseal | reseal yes |
| NTP LARGE_STEP misfire | Wire sent_at older than MAX_FRAME_AGE_SECS | FrameStale | temporal | sent_at_unix older than 300s | Seal a fresh frame. Do not widen PULSE_MS via env | reseal yes |
| NTP LARGE_STEP misfire | Wire sent_at too far in the future | FrameClockSkew | temporal | sent_at_unix beyond MAX_FRAME_FUTURE_SKEW_SECS | Bind sent_at at seal. Keep 60s future skew | reseal yes |
| Crypto death | Hex decode of AEP_DOCK_SEAL_KEY | SealKeyDecode | security | Seal key hex does not decode | openssl rand -hex 32 then install 64 hex chars as AEP_DOCK_SEAL_KEY | reseal no until key is valid |
| Crypto death | Seal key must be 32 bytes | SealKeyLength | security | Decoded key length is not 32 | openssl rand -hex 32 and set AEP_DOCK_SEAL_KEY to 64 hex chars | reseal no until key is valid |
| Crypto death | Mode 0600 owner euid | SealKeyPermissions | security | dock-seal.key is group or world readable | chmod 0600 dock-seal.key and chown to the Base Node euid | reseal no until mode is 0600 |
| Crypto death | File must be 32 bytes | SealKeyFileLength | security | dock-seal.key length is not 32 | openssl rand 32 into dock-seal.key and chmod 0600 | reseal no until length is 32 |
| Wrong algorithm forever | Unsupported envelope version or alg | SealedEnvelopeUnsupported | security | Envelope v or alg is not supported | Recreate the sealed file with the current seal tool | reseal no until format matches |
| Corrupt nonce forever | Nonce must be 12 bytes | SealedEnvelopeNonce | security | Sealed nonce length is not 12 | Recreate the sealed secret file | reseal no until nonce is 12 bytes |
| Crypto death | Wrong seal key or corrupt file | SealedEnvelopeDecrypt | security | Open failed after a valid envelope header | Confirm dock-seal.key matches the writer then recreate the sealed file | reseal no until the key matches |
| Crypto death | Seal encrypt helper failed | SealEncrypt | security | Encrypt of a secret file failed | chmod 0600 dock-seal.key then rewrite the sealed file | reseal no until encrypt succeeds |
| Crypto death | Mode 0600 then optional rotate | DockKemPermissions | security | dock-kem is group or world readable | chmod 0600 dock-kem file; set AEP_DOCK_KEM_FORCE_REGEN=1 only after operator rotation | reseal no until mode is 0600 |
| Crypto death | Corrupt file, rotate on purpose | DockKemCorrupt | security | dock-kem is unreadable or corrupt | chmod 0600 dock-kem file; set AEP_DOCK_KEM_FORCE_REGEN=1 to rotate | reseal no until a readable kem exists |
| Identity mystery | Bind a non-empty agent_id | AgentIdEmpty | structural | agent_id is empty | Bind agent_id on the payload before seal | reseal yes |
| Identity mystery | Shorten agent_id | AgentIdTooLong | structural | agent_id exceeds 128 chars | Bind an agent_id of 128 chars or fewer then reseal | reseal yes |
| Identity mystery | Use A-Za-z0-9._- | AgentIdChars | structural | agent_id has disallowed characters | Bind agent_id with allowed characters then reseal | reseal yes |
| Crypto death | Mode 0600 or force regen | SignKeysPoisoned | poison | agent-sign-keys load poisoned | chmod 0600 agent-sign-keys file; fix seal key; set AEP_AGENT_SIGN_KEYS_FORCE_REGEN=1 only before provisioning | reseal no until keys load |
| Crypto death | Provision the agent sign key | SignKeyMissing | capability | agent has no provisioned sign key | aep-base-node --provision-agent-sign-key --agent-id AGENT_ID | reseal no until the key exists |
| UCB invented a contract | Supply a task manifest | ManifestMissing | structural | No task manifest for agent_id | Store a non-provisional manifest under AEP_TASK_MANIFEST_DIR or send task_manifest on ingest | reseal yes after the manifest exists |
| UCB promotion is Admit | Promote the stored contract | ManifestProvisional | capability | Stored manifest is still provisional | Complete promotion_required then store a non-provisional manifest | reseal yes after promotion |
| Session optional | Bind session_id on the manifest | SessionMissing | capability | Strict session registration and manifest.session_id is missing | Bind session_id on the manifest then reseal the frame with the same session_id | reseal yes |
| Session optional | Match frame and manifest | SessionMismatch | capability | Frame session_id does not match manifest session_id | Bind the same session_id on frame and manifest then reseal | reseal yes |
| Session optional | Present the bound session | SessionRequired | capability | Manifest binds session_id and the frame omitted it | Bind session_id on the frame to the manifest value then reseal | reseal yes |
| Policy off | Activate the contract | ContractInactive | capability | Named contract is inactive | Activate the contract on Base Node then reseal | reseal yes after activation |
| Disk death | Fix path and mode | Io | structural | Filesystem read or write failed | Repair the path, mode and disk then retry the operator command | reseal no until IO succeeds |
| Crypto death | Repair hex input | Hex | structural | Hex decode failed | Supply even-length hex then retry | reseal yes if the hex was inside the capsule |
| Payload mystery | Repair UTF-8 | Utf8 | structural | Bytes are not UTF-8 | Supply UTF-8 plaintext then reseal | reseal yes |
| Payload mystery | Repair JSON | Json | structural | JSON decode failed | Supply JSON plaintext then reseal | reseal yes |
| Crypto death | Key provision first | Crypto | security | Cryptographic primitive failed after keys were expected valid | Confirm seal key, kem and sign key provision rows above before treating this as primitive death | reseal no until keys provision |
| Disk death | Repair sqlite file mode | Sqlite | structural | Lattice sqlite failed | chmod 0600 action-lattice.db and confirm disk | reseal no until sqlite opens |
| Dock down | Start Base Node docks | Channel | structural | Dock channel send failed | Start Base Node so inference, validation, future and regulation sockets exist | reseal yes after docks listen |

## Agent permission refuse

An empty agent permission list refuses under class capability, so bind a non-empty agent permission list on the lattice node or GAP instruction then reseal. Retry is reseal yes and this is not a numeric score and not a past allow in Lattice Memory.

## What is not a repair

Setting an environment variable named pulse_ms is not a repair. Adding pulse_ms to a dynAEP yaml file is not a repair. Treating NTP LARGE_STEP as PULSE_MS is not a repair. Treating enqueue as Admit is not a repair. Treating TypeScript processEvent as product Admit is not a repair. Treating the theme yaml file as Admit authority is not a repair. Treating UCB or CAW as a second evaluator is not a repair. Treating a nearby Lattice Memory allow as allow is not a repair.
