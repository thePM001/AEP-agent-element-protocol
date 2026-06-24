# Agent Control Hub Extreme

Base Node agent control kernel extension. GAP capability profiles and CAW sandbox routing live here.

## GAP-centric profiles (authoritative)

Sandbox and mount profiles are **GAP instructions**, not hand-authored YAML:

| Path | Role |
|------|------|
| `AEP-Components/gap/policies/reference/caw-*.gap` | CAW sandbox profiles (`aep.caw.profile` runtime docs) |
| `AEP-Components/gap/policies/reference/caw-mount-policies.gap` | Per-mount policy compile targets |
| `AEP-Components/gap/policies/reference/task-manifest-v1.gap` | UCB task manifest synthesis template |
| `AEP-Components/gap/policies/reference/implementation-plan-v1.gap` | CCA plan GAP template |
| `lib/gap-profiles.mjs` | Loader: resolve profile, materialize CAW runtime |

Compile locally (no remote install):

```bash
node AEP-Components/gap/lib/gap-compile.mjs --list-profiles
node AEP-Components/gap/lib/gap-compile.mjs --materialize /data/aep
```

CAW CLI:

```bash
aep-caw profiles list
aep-caw session create --profile coding-agent
aep-caw run --profile agent-sandbox -- echo ok
aep-caw wrap --profile coding-agent -- <agent-binary>
```

- `profiles/mount-profiles.yaml` - deprecated stub; do not edit (see file header)
- Registry authority: `AEP-Base-Node/registry/`
- Kernel: `AEP-Base-Node/crate/` (docking, task_manifest, epscom, side_channel_monitor, lattice_log)
