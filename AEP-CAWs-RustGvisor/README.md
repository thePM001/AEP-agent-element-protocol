# 11 / CAWs

Status: reference. Stability: experimental. The Rust CAW runs every agent command inside gVisor.

## What it is

CAWs (Containerized Agentic Workflows) are the sandboxes on the host in which an agent process runs under the written policy. The CAW of AEP 2.9 is written in Rust. It compiles a sandbox profile from GAP into a plan, asks the kernel dock of the Base Node before every command and runs the command inside gVisor (`runsc`, systrap platform) as a user that is not root. Every denied file, program and network destination becomes one event in a hash chained audit log of the session.

The Go CAW of earlier releases is retired. Its approve and redirect decisions and its MCP inspection did not move into the Rust CAW: the model gateway and the MCP security gateway keep those jobs.

## Place among the 18

GAP (06) is the only place a sandbox profile is written. The AEP Base Node (01) owns the kernel dock: the CAW starts no command while that dock is silent or refuses its sealed `root:ping`. The Admit Gate (04) still judges every action that reaches a dock. The EDE pairs with the CAW for coding agents: the EDE decides how the git state of a draft may change, the CAW decides what a command may touch while it runs. The registry lists this component as `caw-framework` with the status active.

## What ships in 2.9

- The program `aep-caw` with four commands: list the allowed profiles, create a session, run one command in the sandbox and check the host.
- The program `aep-caw-init`, process 1 inside every sandbox. It starts the command, relays the egress port and reaps every child.
- Four library crates: the policy engine, the runtime around `runsc`, the egress proxy and the kernel dock client.
- A pinned gVisor release with its install script.
- The proof scripts that the CI job `caw-gvisor` runs on a GitHub runner as a user that is not root.
- The Docker image of the repository carries `aep-caw`, `aep-caw-init` and the pinned `runsc` and runs them with the Base Node as one user that is not root. `CAW=1` turns the CAW on. Its default lattice and its hub grant `root:ping` to `caw-kernel-dock`. The CI job `docker-caw` runs the image with `CAW=1` and the proof scripts inside it.
- Six reference profiles in GAP: `restricted`, `coding-agent`, `compiled-runtime`, `agent-sandbox`, `dev-multi-repo` and `ede-draft`.

## Layout

| Path | Role |
|------|------|
| `aep-caw-policy/` | Pure policy engine: profile records, the sandbox plan, routes and the classification of trace events into deny events |
| `aep-caw-runtime/` | Root file system of pinned programs and trees, the OCI bundle, the `runsc` run, the trace listener, the audit log and the one gate in front of every command |
| `aep-caw-egress/` | Egress proxy on a Unix socket: one route list, no address literal, no private answer |
| `aep-caw-dock/` | Client of the kernel dock: one sealed `root:ping` before every command |
| `aep-caw/` | The program `aep-caw` |
| `aep-caw-init/` | The program `aep-caw-init` |
| `proof/` | The pin of gVisor, its install script, the proof scripts and the files a deployment adds to the Base Node |
| `fuzz/` | Fuzz targets of the policy engine, in a workspace of their own |
| `GVISOR-FACTS.md` | What the pinned gVisor does and does not report, with the script that proves each fact |

The folders `AEP-Components/isolation`, `AEP-Components/intercept`, `AEP-Components/mcp-security` and `AEP-Components/caw-cve-demo-trees` belong to this component too. They hold the seal record contract, the hooks around an action, the MCP security gateway and the check that keeps CVE demo trees out of the attachable set.

## Interfaces

The commands of `aep-caw`:

```text
aep-caw profiles list  --data <folder>
aep-caw session create --data <folder> --profile <id> --workspace <folder> [--var NAME=VALUE]...
aep-caw exec           --data <folder> --session <id> [--time-limit <seconds>] --run <command> [args]
aep-caw doctor         --data <folder>
```

- `session create` prints the session id. The variables of a profile, such as `${HOME}` or `${PROJECT_ROOT}`, come from `--var` and `--workspace` only and never from the environment of the caller.
- `exec` returns the exit code of the command. It returns 126 when the CAW refuses to start the command, for example while the kernel dock is silent. It returns 125 when the trace of the run is incomplete. The environment of the command is built from nothing.
- `doctor` checks `caw.toml`, the record of every allowed profile, the pinned `runsc`, the AppArmor profile on a host that needs it and the kernel dock. It prints one line per check.

The folder given with `--data` is the data folder of the Base Node. The CAW reads `caw-framework/caw.toml` and the compiled profile records in `caw-framework/profiles/` below it and writes each session to `caw-framework/sessions/<id>/`:

```text
allowed_profiles = ["coding-agent"]
runsc = "/usr/bin/runsc"
init = "/usr/local/bin/aep-caw-init"
base_node_data = "/var/lib/aep"
dock_socket = "/var/lib/aep/sockets/validation"
```

`dock_socket` is the validation socket below the `socket_base` of the Base Node configuration.

A profile is written in GAP with three kinds of documents. The reference files under `AEP-Components/gap/policies/reference/` hold one of each:

- `kind: aep.caw.profile` (`caw-coding-agent.gap`) names its mounts, its egress policy, its toolset and whether programs built in the workspace may run.
- `kind: aep.caw.egress_policy` (`caw-egress-policies.gap`) lists the routes. A destination with no route is denied.
- `kind: aep.caw.toolset` (`caw-toolsets.gap`) lists the programs and the read only trees that the sandbox may run.

The GAP compiler lists the profiles and writes their records into a data folder:

```bash
node AEP-Components/gap/lib/gap-compile.mjs --list-profiles
node AEP-Components/gap/lib/gap-compile.mjs --materialize "$(mktemp -d)"
```

The Base Node of a deployment grants `root:ping` to the agent `caw-kernel-dock` in its lattice and in a hub policy of its data folder. `proof/dock-deployment/` holds both files. The CAW runs as the user of that Base Node, because it signs its ping with a key from the key store of the node. The two are one trust domain. The key store is outside every mount.

## Pairing with the EDE

The CAW and the EDE (`AEP-Components/ede`) are deployed together for coding agents.

```text
aep-ede seed owner/repo main                                   # outside the sandbox: prints the draft id
aep-caw session create --data /var/lib/aep --profile ede-draft \
    --workspace "$(aep-ede path <draft>)" \
    --var RUST_TOOLCHAIN="$(rustc --print sysroot)"            # prints the session id
aep-caw exec --data /var/lib/aep --session <session> --run cargo test --offline
aep-ede scan <draft>                                           # outside the sandbox
aep-ede promote <draft> -m "Title"                             # outside the sandbox
```

- The workspace of the session is the tree of the draft. The git folder beside the tree, the record root, the EDE key and the sign key of the agent are outside every mount.
- The harness that calls both programs runs outside the sandbox and holds the sign key of the agent. The CAW confines the tool commands of the agent. It does not confine the harness.
- The reference profile `ede-draft` mounts a Rust toolchain and the C linker as read only trees, lets programs built in the tree run and opens no route.

## Limits

- Linux on amd64 only, with the systrap platform of gVisor. The CAW never runs a sandbox as root. A host that restricts user namespaces through AppArmor needs the profile that `proof/install-runsc.sh` installs.
- A rule that a sandbox cannot express refuses the session at `session create`, with the name of the rule. Nothing is applied in a weaker form.
- gVisor reports open, exec and connect calls and no stat call. A program that only asks whether a file exists is refused and leaves no deny event: the hostile corpus case `probe-with-stat-leaves-no-event` holds this on purpose.
- A tool that looks for its configuration in the folders above the workspace, such as cargo, leaves one deny event per folder.
- A tree of a toolset is checked before each command by its listing, which reads no file content. A change that keeps size, mode and change time of every file is seen only at the next `session create`.
- The CAW confines the commands that run through `aep-caw exec`. It does not confine the harness that calls it. An agent process started any other way runs with the rights of its user.
- In the Docker image the container of the CAW runs without the seccomp and AppArmor profiles of Docker, because `runsc` creates a user namespace and mounts inside it. gVisor filters the system calls of every sandbox. The container drops every capability and no process in it gains one. A host that restricts user namespaces through AppArmor still needs the profile that `proof/install-runsc.sh` loads and the file `docker-compose.caw-apparmor.yml`.
- The gVisor pin covers amd64. The image builds on other platforms without gVisor and stops when it starts with `CAW=1`.
- The Docker image carries no Rust toolchain, so the profile `ede-draft` does not run in it. The `caw-proof` target of the image adds one for the pairing proof.
- The model gateway and the MCP security gateway keep the jobs the Go CAW did beside the sandbox: approval, redirection and the inspection of tool calls.
- `THREAT_MODEL.md` Layer 4 lists every threat with the check that holds it.

## Run and test

Install the pinned gVisor once as root, install the JavaScript dependencies and build the programs:

```bash
sudo bash AEP-CAWs-RustGvisor/proof/install-runsc.sh
npm ci
cargo build --release -p aep-base-node --bins -p aep-ucb -p aep-end-to-end-run -p aep-caw -p aep-caw-init
```

Run one command in a sandbox with a live Base Node, as the user of the deployment and not as root. The end to end example starts a Base Node with the grant of the kernel dock, compiles the reference profiles, writes `caw.toml`, opens a session under the profile `compiled-runtime`, runs a refused read and an allowed command and prints one line per layer:

```bash
AEP_E2E_BIN="$PWD/rust/target/release" bash AEP-User-Experience/examples/end-to-end-run/run.sh
```

Run the CAW in the Docker image. The image runs the Base Node and the CAW as the user `aep`. With `CAW=1` the entrypoint compiles the profile records, writes a `caw.toml` for the profiles of `CAW_PROFILES` on a fresh data folder and stops unless `aep-caw doctor` passes. `docker-compose.caw.yml` holds the run options the container needs. A host that restricts user namespaces through AppArmor, such as Ubuntu 23.10 and later, runs `proof/install-runsc.sh` once as root and adds `-f docker-compose.caw-apparmor.yml`:

```bash
docker compose -f docker-compose.yml -f docker-compose.caw.yml up -d --build
docker compose exec aep aep-caw session create --data /data/aep --profile restricted --workspace /workspace \
    --var HOME=/data/aep --var AEP_MODEL_GATEWAY_HOST=<host of the model gateway>
docker compose exec aep aep-caw exec --data /data/aep --session <id> --run ls /workspace
```

`docker/caw-image-check.sh` builds the image and its `caw-proof` target, opens a session in a container with `CAW=1`, runs an allowed command and a refused read, stops the Base Node to see the refusal and runs every proof script inside the image:

```bash
bash docker/caw-image-check.sh
```

Run the tests and the proof scripts as the CI job `caw-gvisor` does, as a user that is not root:

```bash
cargo test -p aep-caw-policy -p aep-caw-runtime -p aep-caw-egress -p aep-caw-dock -p aep-caw -p aep-caw-init
cargo build -p aep-caw-runtime -p aep-caw-dock --examples
cargo build -p aep-caw -p aep-caw-init
cargo build -p aep-base-node --bin aep-base-node
. AEP-CAWs-RustGvisor/proof/runsc-pin.env
bash AEP-CAWs-RustGvisor/proof/gvisor-facts.sh "$RUNSC_BIN" rust/target/debug/examples/caw-trace-proof
bash AEP-CAWs-RustGvisor/proof/dock-acceptance.sh rust/target/debug/aep-base-node rust/target/debug/examples/caw-dock-proof
bash AEP-CAWs-RustGvisor/proof/core-acceptance.sh "$RUNSC_BIN" rust/target/debug/examples/caw-run-proof AEP-CAWs-RustGvisor/aep-caw-policy/tests/fixtures/restricted.json rust/target/debug/aep-caw-init rust/target/debug/aep-caw AEP-CAWs-RustGvisor/proof/fixtures/egress-proof.json rust/target/debug/aep-base-node
bash AEP-CAWs-RustGvisor/proof/hostile-corpus.sh "$RUNSC_BIN" rust/target/debug/examples/caw-run-proof AEP-CAWs-RustGvisor/aep-caw-policy/tests/fixtures/restricted.json rust/target/debug/aep-caw-init
bash AEP-CAWs-RustGvisor/proof/ede-pairing.sh "$RUNSC_BIN" rust/target/debug/examples/caw-run-proof AEP-CAWs-RustGvisor/proof/fixtures/ede-draft-proof.json rust/target/debug/aep-caw-init "$(rustc --print sysroot)"
```

Each proof script prints one line per check and exits 0 only when every check holds.

## Related documents

- `THREAT_MODEL.md`, Layer 4: CAW
- `AEP-CAWs-RustGvisor/GVISOR-FACTS.md`
- `AEP-Base-Node/AEP-Registry/components/caw-framework.json`, the registry entry
- `AEP-Components/gap/README.md` for the GAP kinds of a sandbox profile
- `AEP-Components/ede/README.md` for the pairing with the EDE
- `AEP-User-Experience/examples/end-to-end-run/README.md` for the run with a live Base Node
