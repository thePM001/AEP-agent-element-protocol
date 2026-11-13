//go:build linux && cgo

package unix

import (
	"errors"
	"fmt"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/sys/unix"
)

// errEmulationUnavailable reports that the supervisor cannot open a file the
// way the tracee would. The caller then lets the kernel run the syscall in the
// tracee (CONTINUE), which applies the tracee credentials and path walk.
var errEmulationUnavailable = errors.New("emulated open unavailable")

// traceeCreds are the filesystem credentials the kernel would apply to an
// open by the tracee.
type traceeCreds struct {
	fsuid  int
	fsgid  int
	groups []int
}

// readTraceeCreds reads the filesystem uid, the filesystem gid and the
// supplementary groups of a process from /proc/<pid>/status.
func readTraceeCreds(pid int) (traceeCreds, error) {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
	if err != nil {
		return traceeCreds{}, err
	}
	var c traceeCreds
	var haveUID, haveGID bool
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		switch fields[0] {
		case "Uid:", "Gid:":
			// Real, effective, saved set and filesystem id.
			if len(fields) != 5 {
				return traceeCreds{}, fmt.Errorf("malformed %s line in /proc/%d/status", fields[0], pid)
			}
			v, err := strconv.Atoi(fields[4])
			if err != nil {
				return traceeCreds{}, err
			}
			if fields[0] == "Uid:" {
				c.fsuid, haveUID = v, true
			} else {
				c.fsgid, haveGID = v, true
			}
		case "Groups:":
			for _, g := range fields[1:] {
				v, err := strconv.Atoi(g)
				if err != nil {
					return traceeCreds{}, err
				}
				c.groups = append(c.groups, v)
			}
		}
	}
	if !haveUID || !haveGID {
		return traceeCreds{}, fmt.Errorf("uid or gid missing in /proc/%d/status", pid)
	}
	return c, nil
}

func sameGroups(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	x := append([]int(nil), a...)
	y := append([]int(nil), b...)
	sort.Ints(x)
	sort.Ints(y)
	for i := range x {
		if x[i] != y[i] {
			return false
		}
	}
	return true
}

// emulatedOpenResolve keeps the supervisor open inside the tracee root and
// refuses every symlink. The policy judged a path that resolvePathAt resolved
// through /proc/<pid>/root, so the path holds no symlink when nothing changed
// it; a component swapped for a symlink after the check fails with ELOOP
// instead of reaching a file the policy never judged (CAWA-13).
const emulatedOpenResolve = unix.RESOLVE_IN_ROOT | unix.RESOLVE_NO_SYMLINKS | unix.RESOLVE_NO_MAGICLINKS

// openAsTracee opens path inside the root of pid with the filesystem
// credentials of the tracee (CAWA-13). The supervisor otherwise opens with its
// own credentials, which for a root server reading for an unprivileged agent
// means root DAC. A supervisor that is not root and whose credentials differ
// from the tracee cannot switch, so it reports errEmulationUnavailable. So
// does a kernel without openat2.
func openAsTracee(pid int, path string, flags int, mode uint32, c traceeCreds) (int, error) {
	euid, egid := os.Geteuid(), os.Getegid()
	ownGroups, err := unix.Getgroups()
	if err != nil {
		return -1, errEmulationUnavailable
	}
	switchCreds := c.fsuid != euid || c.fsgid != egid || !sameGroups(c.groups, ownGroups)
	if switchCreds && euid != 0 {
		return -1, errEmulationUnavailable
	}

	rel := strings.TrimPrefix(path, "/")
	if rel == "" {
		rel = "."
	}
	how := &unix.OpenHow{
		Flags:   uint64(flags | unix.O_CLOEXEC),
		Resolve: emulatedOpenResolve,
	}
	if flags&unix.O_CREAT != 0 {
		how.Mode = uint64(mode)
	}

	rootFD, err := unix.Open(fmt.Sprintf("/proc/%d/root", pid), unix.O_PATH|unix.O_DIRECTORY|unix.O_CLOEXEC, 0)
	if err != nil {
		return -1, err
	}
	defer unix.Close(rootFD)

	// The credential calls act on the calling thread only, so the goroutine
	// stays on one thread from the switch to the restore. The lock is
	// released only after a checked restore: when the restore fails,
	// openInRootAs panics and the thread stays locked, so the Go runtime
	// ends it with the goroutine instead of reusing it.
	runtime.LockOSThread()
	fd, err := openInRootAs(rootFD, rel, how, switchCreds, c, euid, egid, ownGroups)
	runtime.UnlockOSThread()
	if errors.Is(err, unix.ENOSYS) {
		return -1, errEmulationUnavailable
	}
	return fd, err
}

// openInRootAs runs openat2 on a thread locked by the caller, under the
// tracee credentials when switchCreds is set.
func openInRootAs(rootFD int, rel string, how *unix.OpenHow, switchCreds bool, c traceeCreds, euid, egid int, ownGroups []int) (int, error) {
	if switchCreds {
		if err := unix.Setgroups(c.groups); err != nil {
			restoreSupervisorCreds(euid, egid, ownGroups)
			return -1, errEmulationUnavailable
		}
		_ = unix.Setfsgid(c.fsgid)
		_ = unix.Setfsuid(c.fsuid)
		gotUID, _ := unix.SetfsuidRetUid(-1)
		gotGID, _ := unix.SetfsgidRetGid(-1)
		if gotUID != c.fsuid || gotGID != c.fsgid {
			restoreSupervisorCreds(euid, egid, ownGroups)
			return -1, errEmulationUnavailable
		}
	}
	fd, err := unix.Openat2(rootFD, rel, how)
	if switchCreds {
		restoreSupervisorCreds(euid, egid, ownGroups)
	}
	return fd, err
}

// restoreSupervisorCreds puts the filesystem credentials of the thread back.
// A thread that kept the credentials of a tracee would open later files with
// them, so a failed restore panics on the locked thread.
func restoreSupervisorCreds(euid, egid int, groups []int) {
	_ = unix.Setfsuid(euid)
	_ = unix.Setfsgid(egid)
	if err := unix.Setgroups(groups); err != nil {
		panic(fmt.Sprintf("emulated open: restore supplementary groups: %v", err))
	}
	if prev, _ := unix.SetfsuidRetUid(-1); prev != euid {
		panic(fmt.Sprintf("emulated open: fsuid %d after restore, want %d", prev, euid))
	}
	if prev, _ := unix.SetfsgidRetGid(-1); prev != egid {
		panic(fmt.Sprintf("emulated open: fsgid %d after restore, want %d", prev, egid))
	}
}
