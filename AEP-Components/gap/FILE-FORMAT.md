
# GAP file format for AEP 2.9 collect-all Admit

This note tells operators how live GAP files are written and how collect-all Admit reads them after a sealed capsule.

- Keep `.gap` as GAP source and UTF-8.
- YAML 1.2 source remains valid GAP source.
- Live kernel policies may be JSON-encoded GAP instruction objects because the kernel reads the instruction object not the skin.
- Live evaluation seals a lattice-channel capsule, uses freeze-at-seal and waits 1000 ms.
- After freeze-at-seal the path is collect-all Admit then Apply.
- After the wait the client collects by capsule hash as collect-all Admit then Applies the allowed action.
- Live AEP 2.9 EPSCOM trust bundle mode is sha256-structure.
- Optional proof algorithms may still name Ed25519 or ML-DSA-65.
- The signatures loader denies an ML-DSA claim on sha256-structure.
- Signed proof is not the default live AEP 2.9 attach.
- Who-may is agent_permission.
- Empty grants close an agent action when the grant list is empty.
- Presence of trust_ring is Deny.
- Presence of trust_ring on a live GAP document is Deny.
- Closed wall gap:trust_ring:rank.
- Who-may is agent_permission.
- Do not set trust_ring on live documents.
- Writing and security are always-on stems and they evaluate on every action path.
- Other GAP walls bind to a wrap or an action path prefix.
- A GAP binds through `metadata.wrap` and `metadata.action_path_prefix`. A wrap or prefix under `pattern` is not a binding and fails `gapc check`.
- AEP keeps its own keys under the top-level `extensions.aep` object, for example `lrp_id`, `framework`, `ede_repos`, `tla_plus` and the CAW `subprotocols` block. Metadata takes only the fields the GAP meta schema names.
- The gap-pin CI job builds gapc at the pinned GAP commit and runs `gapc check` over `AEP-Policy-System/reference`, `AEP-Policy-System/lattice-channel-mandatory.gap` and `AEP-Components/gap/policies/reference`.
- A finance wrap GAP item does not close an inventory wrap ping.
- A non-always-on GAP with empty wrap does not fold onto every event.
- One instruction per document.
- Multi-instruction families use YAML multi-document syntax with `---` separators.

- This note lives at AEP-Components/gap/FILE-FORMAT.md

## Optional TLA plus sibling

A GAP policy may carry extensions.aep.tla_plus as a relative path to a sibling TLA plus file that ends in .tla. Absolute paths and parent directory tokens are rejected. The field is ignored when AEP_TLA_PROFILE is off. When the profile is warn a missing sibling writes a warning row and the checker exits 0. When the profile is strict a missing sibling closes the lane. MODULE shape still runs on every present TLA plus file.
