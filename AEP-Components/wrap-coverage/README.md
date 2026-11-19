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
wrap coverage: <n> entries, <m> matched, <u> unmatched
```

`--json` prints one object `{inventory, entries: [{kind, id, status, wrap, reason, source}], summary}`. Paths in the output are relative to the repository root when the file sits inside it.

The module exports the pure steps for tests and for other tools: `loadInventory`, `validateInventory`, `buildCoverage(inventory, baseDir)`, `coverageForFile`, `readGapFiles`, `collectWraps`, `grantCovers`, `findWrapFor`, `routeHostProblem`, `egressEntries`, `ucbEntries`, `latticeEntries` and `formatText`.

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
gap_dirs: [gap]                 # every *.gap below these folders is read, CAW egress policies too
lattice: lattice.yaml           # optional: actions.<path>.agent_permission
ucb_manifests: []               # UCB task manifest files
credentials:
  - { id: agent-a-sign-key, kind: agent_sign_key, description: "...", agent_id: agent-a, action: ucb:ingest }
tools:
  - { name: ucb-ingest, description: "...", agent_id: agent-a, action: ucb:ingest }
```

Every path resolves against the folder of the inventory file. A wrong `kind`, a `version` other than 1, an unknown top-level key or an item without its required fields is rejected with exit 2. The key `caw` named policy files of the retired Go CAW and is rejected with exit 2 as well: the egress policies of the Rust CAW are GAP documents and the report finds them in `gap_dirs`.

## Wraps

A wrap is a non-empty `metadata.wrap` on a GAP instruction document. A `.gap` file may hold several YAML documents separated by `---` or one JSON document. A document with no wrap or an empty wrap, such as the `kind: aep.caw.profile` document, declares no wrap. The grants of a wrap are the `metadata.agent_permission` items `{agent_id, action}` of every document that declares it. A grant `(a, x)` covers agent `A` and action `X` when `a` is `A` or `*` and `x` is `X` or `*`.

## Matching rules

1. **credential** from `credentials`: matched to the first wrap that grants `(agent_id, action)`. Otherwise UNMATCHED `no wrap grants <agent> <action>`.
2. **tool** from `tools`: the same rule as a credential.
3. **action_grant** for each lattice action and each agent of its `agent_permission`, with id `<action>@<agent>`. A `*` agent is its own entry. Matched when some wrap grants it.
4. **CAW egress policy**: every document of the kind `aep.caw.egress_policy` in a GAP file below `gap_dirs`, the routes of the Rust CAW. Each route whose decision is not deny is an **egress_route** entry with the id `<policy>/<route>`. It matches the wrap of its GAP file, the `metadata.wrap` of the instruction document of that file. A deny route is not an entry. The report applies the host rules of the GAP compiler and the CAW. Each route it flags is one that both refuse:
   - A host that holds only `*`, `?` or `.` is UNMATCHED `catch-all route lets any host through`.
   - A wildcard over one label, such as `*.com`, is UNMATCHED `catch-all route lets every name under .<label> through`.
   - An address in any spelling is UNMATCHED `the route names an address instead of a host`. That includes a last label that is a decimal or hexadecimal number.
   - A host that is not a lower case name of at least two labels is UNMATCHED as well.
   - A host name, a wildcard under a domain such as `*.example.com` and one variable such as `${AEP_MODEL_GATEWAY_HOST}` match. The CAW checks the value of a variable when a session is created.
   - A policy whose `unmatched` is set to anything but `deny` adds the entry `<policy>`, UNMATCHED `unmatched is <value> so a destination with no route would pass`.
   - A route in a GAP file whose instruction document declares no wrap is UNMATCHED `the GAP file declares no wrap`.

   Each reason for a refused route or policy ends with `; the CAW refuses the policy`.
5. **UCB manifest**: each `egress.routes[]` item is an egress_route entry and each `auth_token_env` is a credential entry. They match when some wrap grants the manifest `agent_id` any action, through a grant that names that agent or `*`. Otherwise UNMATCHED `no wrap grants agent <agent> any action`.

## Tests

`tests/wrap-coverage.test.mjs` runs under vitest with fixtures in `tests/fixtures`:

```sh
npx vitest run AEP-Components/wrap-coverage
```
