
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

## CAW record kinds

A `.gap` file may carry runtime documents after its instruction, one YAML document each. Four kinds describe a CAW sandbox. The compiler refuses a key that is not listed here.

| Kind | Keys | Meaning |
|------|------|---------|
| `aep.caw.profile` | `profile_id`, `name`, `base_policy`, `enforcement_tier`, `llm_proxy`, `compiled_runtime`, `mounts`, `egress_policy`, `toolset` | One sandbox profile. `mounts` is a list of `path` and `policy`. The CAW runs only the tier `gvisor`. |
| `aep.caw.mount_policy` | `name`, `policy` with `version`, `name`, `description`, `file_rules`, `command_rules` | Rules for one mounted folder tree or for the base of a profile. A file rule has `name`, `paths`, `operations` and `decision`. A command rule has `name`, `commands` and `decision`. |
| `aep.caw.egress_policy` | `name`, `description`, `unmatched`, `routes` | A named list of routes. A route has `name`, `scheme` (`http` or `https`), `host`, `port` and `decision` (`allow` or `deny`). `unmatched` is `deny` and no other value compiles. |
| `aep.caw.toolset` | `name`, `description`, `programs`, `trees` | A named list of programs and folder trees. A program has `name`, `source` (its path on the host) and an optional `path` inside the sandbox, which is `/usr/bin/<name>` when absent. A tree has `name`, `source` (a folder of the host, which may start with one variable), `path` (a folder below `/usr` or below a library folder of the root) and an optional `bin` folder inside the tree that joins the search path. |

Rules of the profile:

- A profile names its toolset. A profile with no toolset does not compile.
- A profile with no `egress_policy` has no network at all.
- `llm_proxy: true` means that the route to the declared model gateway is open. Such a profile must name an egress policy. The CAW reads and rewrites no request body.
- `llm_proxy` and `compiled_runtime` are written out as `true` or `false`.

Rules of a route host:

- A lower case host name, a wildcard under one domain such as `*.example.com` or one variable such as `${AEP_MODEL_GATEWAY_HOST}`.
- An address is not a host name and does not compile.

The compiler resolves a profile with everything it names into one record `aep.caw.resolved_profile`. The record is JSON with the keys of every object in sorted order and no white space. Its field `digest` is the sha256 of that text without the field `digest`. `--materialize` writes one record per profile to `caw-framework/profiles/<profile>.json` under the data folder. Variables such as `${PROJECT_ROOT}`, `${HOME}` and `${MOUNT_PATH}` are kept as written. The CAW fills them when a session is created and refuses a variable that the call does not supply.

A tree is for what a single program cannot carry, such as a compiler toolchain. The sandbox mounts the folder of the host read only. The CAW pins a tree at session create by a digest over the content of every file and checks its listing before every command. A program may not lie inside the path of a tree, because the tree brings its own programs.

A sandbox has its own empty `/tmp`. No reference profile mounts the `/tmp` of the host.

## Optional TLA plus sibling

A GAP policy may carry extensions.aep.tla_plus as a relative path to a sibling TLA plus file that ends in .tla. Absolute paths and parent directory tokens are rejected. The field is ignored when AEP_TLA_PROFILE is off. When the profile is warn a missing sibling writes a warning row and the checker exits 0. When the profile is strict a missing sibling closes the lane. MODULE shape still runs on every present TLA plus file.
