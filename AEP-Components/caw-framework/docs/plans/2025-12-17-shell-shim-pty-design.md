# Shell Shim + Interactive PTY Exec (Design)

**Status:** Implemented

## Goal

Provide a container-friendly way to force execution through `aep-caw` even when a harness/LLM/tooling would otherwise invoke `/bin/bash` or `/bin/sh` directly, while preserving shell compatibility as closely as possible (arguments, `$0`/`argv[0]` identity, interactive job control).

## Problem

In container scenarios, agents and harnesses frequently run commands via `/bin/sh -c ...` or `/bin/bash -lc ...`. If we only rely on “instructions” (AGENTS.md/CLAUDE.md) we risk the agent deciding to bypass `aep-caw`. We want a system-level enforcement point that still behaves like the underlying shell.

Key constraints:
- Must preserve the original shell binaries and forward all arguments unchanged.
- Must support interactive terminals (PTY semantics: raw mode, window resize, signals, job control).
- Must remain pipeable/redirection-friendly for non-interactive execution.
- Must avoid recursion (shell inside aep-caw calling `/bin/bash` again must not re-enter `aep-caw`).
- Must work across “any container runtime” (don’t assume Docker/Kubernetes IDs exist).

## High-level approach

Install a tiny static shim binary at `/bin/bash` and `/bin/sh`. The shim delegates execution to the `aep-caw` CLI (Option A) and uses a robust session-id resolution strategy so sessions persist without requiring a harness integration (while allowing a harness to override).

Interactive commands route through a new `aep-caw exec --pty` mode, implemented as:
- gRPC bidirectional PTY streaming (generated protos; raw bytes).
- HTTP WebSocket endpoint per session (binary frames for bytes; JSON control frames).

Non-interactive commands continue to use existing `aep-caw exec` behavior (separate stdout/stderr, normal piping semantics).

## Components

### 1) Shell shim binary (installed at `/bin/bash` and `/bin/sh`)

Responsibilities:
- Preserve the commandline interface and forward `"$@"` unchanged.
- Preserve invocation identity by propagating `argv0` (e.g. invoked as `sh`, `bash`, `-bash`, etc).
- Avoid recursion by bypassing `aep-caw` when running *inside* an aep-caw session.
- Resolve `aep-caw` executable path via `AEP_CAW_BIN` or `PATH`.
- Resolve a stable `session_id` shared by `/bin/sh` and `/bin/bash`.
- Decide interactive vs non-interactive based on TTY detection.

Real binaries:
- Move original `/bin/bash` to `/bin/bash.real`
- Move original `/bin/sh` to `/bin/sh.real` (preserve symlink if present by moving the link itself)

Invocation routing:
- If invoked as `sh` (basename or path ends with `/sh`) => exec `/bin/sh.real`
- If invoked as `bash` => exec `/bin/bash.real`
- Otherwise default to `/bin/sh.real`

Recursion guard:
- If `AEP_CAW_IN_SESSION=1` is present in the environment, the shim must directly `exec` the `.real` shell (no aep-caw).
- This requires the aep-caw server to inject `AEP_CAW_IN_SESSION=1` into every executed process environment.

TTY behavior:
- If stdin and stdout are TTYs: `aep-caw exec --pty --argv0 "$0" <sid> -- <real> "$@"`
- Else: `aep-caw exec --argv0 "$0" <sid> -- <real> "$@"`

### 2) `aep-caw exec` enhancements (non-PTY)

Add support for explicitly setting `argv0`:
- CLI: `aep-caw exec --argv0 <string> SESSION_ID -- COMMAND [ARGS...]`
- Server: when spawning the child, set `cmd.Args[0]` to the provided `argv0` while keeping `cmd.Path` as the real executable path.

This improves compatibility by preserving `$0` and “invoked as sh”/login-shell semantics as much as possible.

### 3) PTY exec (`aep-caw exec --pty`) over gRPC and HTTP

#### gRPC

Add a new generated-proto service dedicated to PTY streaming (to avoid migrating the existing Struct-based RPCs):
- Bidirectional streaming: client sends stdin bytes + control (resize/signal), server sends PTY output bytes + exit status.
- Use raw `bytes` in messages (no base64).

#### HTTP

Add a per-session WebSocket endpoint:
- `GET /api/v1/sessions/{id}/pty` upgrades to WebSocket.
- Client -> server:
  - Text JSON control: `start`, `resize`, `signal`
  - Binary: stdin bytes
- Server -> client:
  - Binary: PTY output bytes
  - Text JSON: `exit` (and then close)

Both transports share a single PTY engine implementation (spawn + wire + resize + signal forwarding), differing only by the wire adapter.

## Session ID resolution (shim)

Priority:
1) `AEP_CAW_SESSION_ID` (best: harness sets it)
2) `AEP_CAW_SESSION_FILE` (harness-managed; shim reads a single-line id)
3) Shim-managed workspace-scoped file (runtime-agnostic):
   - Pick first writable base dir: `/run/aep-caw` → `/tmp/aep-caw` → `<workspace>/.aep-caw`
   - Compute a workspace fingerprint (realpath(cwd) + stat(dev,inode), optionally mixed with hostname/cgroup if present)
   - Map fingerprint → `session-<token>` and persist it under a lock (`flock`) for stability across processes
4) Final fallback: `session-default` (only if all file locations fail)

The resolved session id is shared by both `/bin/sh` and `/bin/bash`.

## Security / auth

- Existing HTTP auth middleware must apply to the WebSocket PTY endpoint.
- gRPC PTY must enforce the same auth policy (e.g. API key metadata) as other gRPC requests.

## Compatibility notes / limitations

- Full “perfect illusion” is not possible: processes can still discover the real executable path via `/proc/self/exe` or tool-specific variables.
- PTY merges stdout/stderr by nature; separate stderr redirection (`2>`) is not possible in `--pty` mode (non-interactive exec preserves separation).

