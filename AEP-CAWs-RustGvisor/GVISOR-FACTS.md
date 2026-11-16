# gVisor facts of the CAW

Status: the first work package of the Rust CAW. The CAW design rests on the facts below. Each one is proven by a run, replaced by a named fallback or still open. No engine code relies on an open fact.

## How the facts are proven

`proof/gvisor-facts.sh` starts one gVisor sandbox as a user that is not root and prints one line per fact. `proof/install-runsc.sh` installs the pinned gVisor package. `proof/runsc-pin.env` holds the pin.

```bash
sudo bash AEP-CAWs-RustGvisor/proof/install-runsc.sh
bash AEP-CAWs-RustGvisor/proof/gvisor-facts.sh /usr/bin/runsc
```

The second command needs no root. A root caller is handed over to the user nobody, because the proof is about a run without root.

## The proven run

| Item | Value |
|------|-------|
| Date | 2026-11-16 |
| Host | the build server, Ubuntu, kernel 7.0.0-42-generic, no /dev/kvm device |
| User | 65534 (nobody) |
| gVisor | release-20261109.0 |
| Flags | `--rootless --platform=systrap --network=none --ignore-cgroups --host-uds=open` |

## Facts

| Fact | State | Evidence |
|------|-------|----------|
| The systrap platform runs with no /dev/kvm device | proven | The sandbox ran on a host with no KVM device. |
| runsc runs a sandbox as a user that is not root | proven, with one host setup step | See "The AppArmor profile" below. |
| runsc runs with cgroups ignored | proven | `--ignore-cgroups`, no cgroup was prepared. |
| The kernel inside the sandbox is gVisor | proven | The kernel log inside names gVisor. |
| The sandbox has no network device | proven | `/proc/net/dev` shows nothing besides lo. |
| A TCP connect to the host address fails | proven | The client ran inside the sandbox and left with exit 1. The same connect from the host worked. |
| A host file outside the mounts cannot be read | proven | The file does not exist inside the sandbox. |
| The root file system is read only | proven | A write to the root failed and the host folder is unchanged. |
| A write to the workspace mount reaches the host | proven | The file is in the host folder after the run. |
| A program outside the root does not run | proven | The path does not exist inside the sandbox. |
| A program inside the root runs | proven | `/usr/bin/true` left with exit 0. |
| A Unix socket of the host, mounted into the sandbox, takes a connect | proven | A line sent inside the sandbox reached the host listener. Needs `--host-uds=open`. |
| The start of one command takes less than one second | proven | 120, 128, 142, 126 and 191 ms over five runs of `/usr/bin/true`. |
| A trace session reports calls to a sink on a Unix socket | open | This runsc lists 998 trace points and the sinks `null` and `remote`. The `remote` sink has not received an event in a test yet. |
| The same facts hold on a standard GitHub runner | open | The job caw-gvisor of baseline.yml runs both scripts. It has not run on GitHub yet. |
| The same facts hold on arm64 | open | The pin covers amd64 only. |

## What the run changed in the plan

### The AppArmor profile

Ubuntu restricts user namespaces to programs that carry an AppArmor profile (`kernel.apparmor_restrict_unprivileged_userns` is 1). Without a profile a rootless runsc stops with `fork/exec /proc/self/exe: permission denied`. The kernel log shows the cause: the process moves to the profile `unprivileged_userns`, which denies the exec.

`install-runsc.sh` writes `/etc/apparmor.d/runsc`. The profile has the form of the profiles that Ubuntu ships for crun, runc and podman: it confines nothing and only allows the `userns` rule for `/usr/bin/runsc`. This is one setup step with root per host. The CAW runs without root afterwards. GitHub runners on Ubuntu carry the same restriction, so the job caw-gvisor runs the install script with sudo. No cgroup setup is needed.

### The pin is a package

The gVisor release addresses for a single runsc file answer 404 for this release. gVisor ships as a package from its apt pool. The package holds `/usr/bin/runsc` and helper programs under `/usr/bin/gvisor-bin`. The pin is therefore the address of the package in the pool with its sha256 as the apt pool lists it, plus the sha512 of `/usr/bin/runsc` for the check at run time.

### The host socket flag

A connect from the sandbox to a mounted host socket needs `--host-uds=open`. gVisor logs that its own system call filter is less strict with this flag. The egress proxy is the only socket the CAW mounts, so the flag serves that one path only. The hostile corpus of work package 7 has to show that no other host socket is reachable.

## Open facts and their next step

1. The trace sink. The `remote` sink speaks a wire format of gVisor over a Unix socket. The next step is a listener for that format and a run that shows one event for a failed open, one for a failed exec and one for a failed connect. The fallback of the plan is unchanged: the system call log of runsc limited to open, exec and connect.
2. The GitHub runner. The job caw-gvisor proves it on the first push of the mirror.
3. arm64. Out of scope until an arm64 host is part of the CI.
