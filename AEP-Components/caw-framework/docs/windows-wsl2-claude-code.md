# Running Claude Code under aep-caw on Windows (WSL2)

Native Windows enforcement (minifilter driver + AppContainer) is pending driver
signing. Until then, **WSL2 is the supported way to run aep-caw on Windows** -
and because WSL2 is a real Linux VM, you get the full Linux enforcement stack
(seccomp user-notify, Landlock, FUSE, cgroups v2, namespaces): the same 100%
protection score as bare-metal Linux.

This guide walks through:

1. [Installing WSL2 + Ubuntu on Windows](#1-install-wsl2--ubuntu)
2. [Installing aep-caw inside Ubuntu](#2-install-aep-caw-inside-ubuntu)
3. [Installing Claude Code inside Ubuntu](#3-install-claude-code-inside-wsl)
4. [Running Claude Code under aep-caw](#4-run-claude-code-under-aep-caw)

---

## Prerequisites

- Windows 11, or Windows 10 version 2004+ (build 19041+)
- Administrator access (only for the one-time WSL installation)
- Virtualization enabled in BIOS/UEFI (usually on by default)

---

## 1. Install WSL2 + Ubuntu

Open **PowerShell as Administrator** and run:

```powershell
wsl --install -d Ubuntu
```

Reboot if prompted. On first launch of Ubuntu you'll be asked to create a
Linux username and password.

If you already have WSL installed, make sure you're on WSL **2** and up to
date:

```powershell
wsl --update
wsl -l -v
```

The `VERSION` column for Ubuntu must say `2`. If it says `1`, convert it:

```powershell
wsl --set-version Ubuntu 2
```

> **Why WSL2 and not WSL1?** WSL1 emulates Linux syscalls and does not support
> seccomp user-notify, FUSE, or cgroups - aep-caw's enforcement primitives.
> WSL2 runs a real Linux kernel.

All remaining steps happen **inside the Ubuntu shell** (launch "Ubuntu" from
the Start menu, or run `wsl` in a terminal).

---

## 2. Install aep-caw inside Ubuntu

### 2.1 Install runtime dependencies

```bash
sudo apt update
sudo apt install -y fuse3 libseccomp2 jq
```

- `fuse3` - required for the FUSE filesystem layer (file-operation
  interception, soft-delete quarantine).
- `libseccomp2` - aep-caw links dynamically against system libseccomp
  (>= 2.5). Ubuntu 22.04+ ships a new-enough version; this just makes it
  explicit.
- `jq` - used by the session-creation snippets below (optional but handy).

### 2.2 Install the aep-caw package

Download the latest `.deb` for your architecture from the
[releases page](https://github.com/canyonroad/aep-caw/releases) and install
it:

```bash
# Pick the right arch: amd64 for Intel/AMD, arm64 for ARM (e.g. Surface/Snapdragon)
curl -fLO https://github.com/canyonroad/aep-caw/releases/latest/download/aep-caw_<VERSION>_linux_amd64.deb
sudo dpkg -i aep-caw_<VERSION>_linux_amd64.deb
```

This installs the `aep-caw` CLI (plus the `aep-caw-shell-shim` and
`aep-caw-unixwrap` helper binaries) into `/usr/bin`, and a default
configuration at `/etc/aep-caw/config.yaml`.

### 2.3 Verify enforcement

```bash
aep-caw detect
```

`aep-caw detect` probes the kernel and reports which enforcement primitives
are actually available (seccomp, Landlock, FUSE, cgroups, ptrace) plus
per-domain protection scores. On an up-to-date WSL2 Ubuntu you should see the
full Linux feature set.

Optionally, generate a config tuned to the host and merge it into your main
config:

```bash
aep-caw detect config        # prints a security config snippet for this host
```

> **No daemon to manage:** you do not need to start `aep-caw server` yourself.
> The first `aep-caw exec` / `aep-caw wrap` auto-starts a local server using
> the discovered config (`AEP_CAW_CONFIG` > `~/.config/aep-caw/config.yaml` >
> `/etc/aep-caw/config.yaml`). Set `AEP_CAW_NO_AUTO=1` if you prefer to manage
> the server lifecycle manually.

---

## 3. Install Claude Code inside WSL

Claude Code must be installed **inside Ubuntu** (not on the Windows side), so
that everything it executes runs under the Linux enforcement stack.

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

or, if you prefer npm (requires Node.js 18+):

```bash
npm install -g @anthropic-ai/claude-code
```

Then authenticate once:

```bash
claude
# follow the login prompts
```

---

## 4. Run Claude Code under aep-caw

### 4.1 Keep your workspace on the Linux filesystem

Clone/keep your projects under your Linux home directory (e.g.
`~/work/myproject`), **not** under `/mnt/c/...`. Windows-mounted paths are
dramatically slower and complicate file-event semantics.

```bash
cd ~/work/myproject
```

### 4.2 Launch Claude Code wrapped by aep-caw (recommended)

```bash
aep-caw wrap -- claude
```

`aep-caw wrap` launches the agent with **full exec interception**: every
command Claude Code spawns - and every subprocess of those commands - is
routed through the aep-caw pipeline (policy check, approval workflow, audit
logging). Claude Code itself needs no configuration; it can't opt out.

Useful flags:

```bash
aep-caw wrap --policy strict -- claude        # pick a specific policy
aep-caw wrap --session my-dev -- claude       # reuse a named session
aep-caw wrap --root ~/work/myproject -- claude # explicit workspace root
aep-caw wrap --report=false -- claude          # skip the session report on exit
```

On exit, aep-caw prints a session report summarizing the commands, file
operations, and network activity that occurred during the run.

### 4.3 Alternative: per-command routing via CLAUDE.md

If you'd rather not wrap the whole agent process, you can instead instruct
Claude Code to route individual commands through aep-caw. Add this to your
project's `CLAUDE.md` (see [`examples/claude/`](../examples/claude/) for the
full snippet):

```md
## Shell access

- Run commands via aep-caw, not directly in bash/zsh.
- Use: `aep-caw exec $SID -- <your-command-here>`
- For structured output: `aep-caw exec --output json --events summary $SID -- <your-command-here>`
- Get session ID first: `SID=$(aep-caw session create --workspace . --json | jq -r .id)`
```

> **Note:** this mode relies on the model following instructions; `aep-caw
> wrap` enforces at the process level and is the recommended approach.

### 4.4 Verify it's working

In a second Ubuntu terminal, watch events while Claude Code works:

```bash
aep-caw session list                 # find the active session
aep-caw events tail <SESSION_ID>     # live event stream
```

You should see process, file, and network events for everything the agent
does.

---

## Tips for WSL2

- **Workspace location:** Linux filesystem (`~/...`) for anything aep-caw
  monitors. `/mnt/c/...` works but is slow.
- **Resource limits:** WSL2 supports cgroups v2, so per-session CPU/memory/
  process-count limits in policies are enforced.
- **WSL global limits:** you can cap the whole WSL VM's memory/CPU in
  `%UserProfile%\.wslconfig` on the Windows side - this is independent of
  aep-caw's per-session cgroup limits.
- **Policies:** the default policy ships with the package; point sessions at
  your own with `--policy`, and see
  [`docs/operations/policies.md`](operations/policies.md) and
  [`docs/cookbook/command-policies.md`](cookbook/command-policies.md) for
  authoring.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `aep-caw detect` shows missing FUSE | `sudo apt install fuse3` and confirm `/dev/fuse` exists |
| Ubuntu shows `VERSION 1` in `wsl -l -v` | `wsl --set-version Ubuntu 2` from PowerShell |
| Seccomp features missing | `wsl --update` (updates the WSL2 kernel), then `wsl --shutdown` and relaunch |
| Stale server after config changes | `pkill -f "aep-caw server"` - the next command auto-starts a fresh one |
| Everything broke / VM wedged | `wsl --shutdown` from PowerShell, then relaunch Ubuntu |

For deeper platform details see
[Cross-Platform Support](cross-platform.md) and the
[Platform Comparison Matrix](platform-comparison.md).
