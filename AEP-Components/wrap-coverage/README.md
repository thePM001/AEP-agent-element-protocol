# Wrap Coverage

Status: normative. Stability: evolving.

AEP governs traffic that crosses a declared wrap. An agent credential, an egress route or a tool that sits outside every wrap acts ungoverned. The wrap coverage report lists each such entry of a deployment with the wrap that governs it and flags every entry that no wrap governs.

- **Component ID:** `wrap-coverage`
- **Path:** `wrap-coverage/`
- **Manifest:** `AEP-Base-Node/AEP-Registry/components/wrap-coverage.json`

The gate is zero unmatched entries on the end to end example. CI runs the report on `AEP-User-Experience/examples/end-to-end-run/deployment/wrap-coverage.yaml` in the live-set job of `.github/workflows/baseline.yml` and through the `wrap coverage` section of `aep-check.mjs`.

## Usage

```sh
node AEP-Components/wrap-coverage/lib/wrap-coverage.mjs <inventory.yaml> [--json]
```

Text mode prints one line per entry and then a summary line:

```text
MATCHED <kind> <id> wrap=<wrap> <source file>
UNMATCHED <kind> <id> <reason> <source file>
NEUTRALIZED <kind> <id> <reason> wrap=<wrap> <source file>
wrap coverage: <n> entries, <m> matched, <u> unmatched, <z> neutralized
```

`--json` prints one object `{inventory, entries: [{kind, id, status, wrap, reason, source}], summary}`. Paths in the output are relative to the repository root when the file sits inside it.

The module exports the pure steps for tests and for other tools: `loadInventory`, `validateInventory`, `buildCoverage(inventory, baseDir)`, `coverageForFile`, `collectWraps`, `grantCovers`, `findWrapFor`, `isCatchAllNetworkRule`, `cawEntries`, `ucbEntries`, `latticeEntries` and `formatText`.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | No entry is unmatched |
| 1 | One or more entries are unmatched |
| 2 | The inventory or a file it names cannot be read or is invalid |

## Inventory format

```yaml
kind: aep.wrap-coverage.inventory
version: 1
name: end-to-end-run
gap_dirs: [gap]                 # every *.gap below these folders is read
lattice: lattice.yaml           # optional: actions.<path>.agent_permission
caw:
  - policy: caw-policies/e2e-wrapped.yaml
    wrap: caw
ucb_manifests: []               # UCB task manifest files
credentials:
  - { id: agent-a-sign-key, kind: agent_sign_key, description: "...", agent_id: agent-a, action: ucb:ingest }
tools:
  - { name: ucb-ingest, description: "...", agent_id: agent-a, action: ucb:ingest }
```

Every path resolves against the folder of the inventory file. A wrong `kind`, a `version` other than 1, an unknown top-level key or an item without its required fields is rejected with exit 2.

## Wraps

A wrap is a non-empty `metadata.wrap` on a GAP instruction document. A `.gap` file may hold several YAML documents separated by `---` or one JSON document. A document with no wrap or an empty wrap, such as the `kind: aep.caw.profile` document, declares no wrap. The grants of a wrap are the `metadata.agent_permission` items `{agent_id, action}` of every document that declares it. A grant `(a, x)` covers agent `A` and action `X` when `a` is `A` or `*` and `x` is `X` or `*`.

## Matching rules

1. **credential** from `credentials`: matched to the first wrap that grants `(agent_id, action)`. Otherwise UNMATCHED `no wrap grants <agent> <action>`.
2. **tool** from `tools`: the same rule as a credential.
3. **action_grant** for each lattice action and each agent of its `agent_permission`, with id `<action>@<agent>`. A `*` agent is its own entry. Matched when some wrap grants it.
4. **CAW policy** bound to a wrap by the inventory. When no GAP document declares that wrap, every entry of the policy is UNMATCHED `wrap <w> is not declared by any GAP document`.
   - **egress_route** for each `network_rules` item whose decision is not deny. A catch-all rule names no destination. It has no cidrs and its domains are empty or all wildcard patterns that hold only `*`, `?` or `.` such as `*`, `**` or `*.*`. It also counts when every cidr is `0.0.0.0/0` or `::/0` with no domain other than a wildcard pattern. Ports do not matter. A catch-all is UNMATCHED `catch-all <decision> rule lets unnamed destinations through` unless the policy sets `unmatched_egress: deny`, where it is NEUTRALIZED. A neutralized entry counts as neither matched nor unmatched and is still listed. An explicit rule matches the policy wrap. A deny rule is not an entry.
   - **egress_route** for each `http_services[]` upstream and **credential** for each `http_services[].secret`, matched to the policy wrap.
   - **tool** for each `mcp_rules.allowed_tools` item `{server, tool}`. A tool of `*` or an empty tool name is UNMATCHED `catch-all tool grant`. An explicit tool matches the policy wrap.
5. **UCB manifest**: each `egress.routes[]` item is an egress_route entry and each `auth_token_env` is a credential entry. They match when some wrap grants the manifest `agent_id` any action, through a grant that names that agent or `*`. Otherwise UNMATCHED `no wrap grants agent <agent> any action`.

## Tests

`tests/wrap-coverage.test.mjs` runs under vitest with fixtures in `tests/fixtures`:

```sh
npx vitest run AEP-Components/wrap-coverage
```
