# gVisor facts of the CAW

Status: the first work package of the Rust CAW. The CAW design rests on the facts below. Each one is proven by a run, replaced by a named fallback or still open. No engine code relies on an open fact.

## How the facts are proven

`proof/gvisor-facts.sh` starts one gVisor sandbox as a user that is not root and prints one line per fact. With the program `caw-trace-proof` as its second argument it also starts a trace session and checks the events. `proof/install-runsc.sh` installs the pinned gVisor package. `proof/runsc-pin.env` holds the pin.

```bash
sudo bash AEP-CAWs-RustGvisor/proof/install-runsc.sh
cargo build -p aep-caw-runtime --example caw-trace-proof
bash AEP-CAWs-RustGvisor/proof/gvisor-facts.sh /usr/bin/runsc path/to/caw-trace-proof
```

The last command needs no root. A root caller is handed over to the user nobody, because the proof is about a run without root.

## The proven run

| Item | Value |
|------|-------|
| Date | 2026-11-16 |
| Host | an Ubuntu server, kernel 7.0.0-42-generic, no /dev/kvm device |
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
| A trace session reports calls to a sink on a Unix socket | proven | The listener of the crate `aep-caw-runtime` took 212 points of one sandbox with none dropped. |
| A denied file open leaves one event with its path | proven | One `open` event with errno 2 names the denied file. |
| A denied exec leaves one event with its path | proven, by a rule of two points | See "What a denied exec looks like" below. |
| A denied connect leaves one event with its address | proven | One `connect` event with errno 101 carries the host address. |
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

### What a denied exec looks like

gVisor reports errno zero on the exit point of `execve` even when the program does not exist. So the errno of that point is no deny signal. The point `sentry/execve` fires only when a program image was loaded. A denied exec is an `execve` point for a path with no `sentry/execve` point after it. In the proven run the sandbox saw 14 `execve` points and 13 loaded programs. The one without a load was the program outside the root.

### What leaves no event

gVisor has typed trace points for open, execve and connect and none for stat. A program that only asks whether a file exists gets its refusal and leaves no event with a path. The deny events of the CAW are about an attempted open, exec or connect. The README of the CAW has to say this.

### The trace socket

The sink is a Unix socket of the type SOCK_SEQPACKET. runsc connects to it before the sandbox starts and hands the connection to the sandbox, so the socket needs no mount inside the sandbox. The session is given with the flag `--pod-init-config`, which starts it before the first program of the sandbox runs.

## Open facts and their next step

1. The GitHub runner. The job caw-gvisor proves it on the first push of the mirror.
2. arm64. Out of scope until an arm64 host is part of the CI.
