# 11 / CAWs

Status: sketch. Stability: experimental. This release ships no host sandbox.

## What it is

CAWs (Containerized Agentic Workflows) are the sandboxes on the host in which an agent process runs under the written policy. A CAW confines the shell commands, files, network connections and processes of an agent and asks the kernel dock of the Base Node before a command starts.

The Go CAW that earlier releases carried is retired. A Rust CAW replaces it: a policy engine written in Rust that runs every agent process inside gVisor. Until that CAW lands this component holds no runtime.

## Place among the 18

The Admit Gate (04) in the AEP Base Node (01) judges every action that reaches a dock. GAP (06) describes the sandbox profiles of a CAW in files of the kinds `aep.caw.profile` and `aep.caw.mount_policy`. The GAP compiler keeps compiling them for the Rust CAW. The CAW is the part that confines a process on the host. In this release that part is missing, so a process that never asks the kernel is not stopped.

## What ships in 2.9

- No host sandbox and no `aep-caw` program.
- The registry keeps the id `caw-framework` with the status retired, so the Rust CAW can take it over without a new catalog id.
- The kernel side of the CAW kernel dock in `AEP-Base-Node/AEP-Crate/src/caw_kernel_dock.rs`, which the Rust CAW will use.
- The four folders below. They hold the seal record contract, the intercept hooks, the MCP security gateway and the check that keeps CVE demo trees out of the attachable set. None of them confines a process.

## Layout

| Path | Role |
|------|------|
| `AEP-Components/isolation/` | Seal record contract for one process and one isolation specification |
| `AEP-Components/intercept/` | Hooks before and after an action |
| `AEP-Components/mcp-security/` | MCP security gateway |
| `AEP-Components/caw-cve-demo-trees/` | Keeps CVE demo trees out of the attachable component set |

## Interfaces

None in this release. The Rust CAW will take its sandbox profiles from GAP and ask the kernel dock before every command, as the Go CAW did.

## Limits

- An agent process on the host runs with the rights of its user. It can read files outside the workspace, reach any network destination and trace other processes of that user.
- Run agents inside a container or a virtual machine with its own limits until the Rust CAW lands.
- `THREAT_MODEL.md` Layer 4 lists what this leaves open.

## Run and test

Nothing to run. The end to end example in `AEP-User-Experience/examples/end-to-end-run/` walks its six layers without a CAW and prints one line that says no host sandbox runs.

## Related documents

- `THREAT_MODEL.md`, Layer 4: CAW
- `AEP-Base-Node/AEP-Registry/components/caw-framework.json`, the retired registry entry
- `AEP-Components/gap/README.md` for the GAP kinds of a sandbox profile
