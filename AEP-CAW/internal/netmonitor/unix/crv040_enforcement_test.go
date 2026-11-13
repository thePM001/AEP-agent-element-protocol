//go:build linux && cgo

package unix

import (
	"context"
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
	"unsafe"

	seccomp "github.com/seccomp/libseccomp-golang"
	"golang.org/x/sys/unix"
)

type stubFileApprover struct {
	answer bool
	err    error
	calls  []FileApprovalRequest
}

func (s *stubFileApprover) RequestFileApproval(_ context.Context, req FileApprovalRequest) (bool, error) {
	s.calls = append(s.calls, req)
	return s.answer, s.err
}

func approvePolicy(path string) *mockFilePolicy {
	return &mockFilePolicy{decisions: map[string]FilePolicyDecision{
		path: {Decision: "approve", EffectiveDecision: "approve", Rule: "approve-workspace-delete", Message: "delete?"},
	}}
}

// CAWA-11 acceptance: an approve decision is not an allow.
func TestFileHandler_ApproveWithoutApproverDenies(t *testing.T) {
	h := NewFileHandler(approvePolicy("/w/f"), nil, &mockFileEmitter{}, true)
	res, ev := h.Handle(FileRequest{PID: 1, Path: "/w/f", Operation: "delete", Syscall: int32(unix.SYS_UNLINKAT)})
	if res.Action != ActionDeny || res.Errno != int32(unix.EACCES) {
		t.Fatalf("result = %+v, want deny with EACCES", res)
	}
	if ev == nil || ev.EffectiveAction != "blocked" {
		t.Fatalf("event = %+v, want a blocked event", ev)
	}
}

func TestFileHandler_ApproveRoutesToApprover(t *testing.T) {
	for _, tc := range []struct {
		name   string
		answer bool
		err    error
		want   string
	}{
		{"approved", true, nil, ActionContinue},
		{"refused", false, nil, ActionDeny},
		{"error", true, errors.New("timeout"), ActionDeny},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ap := &stubFileApprover{answer: tc.answer, err: tc.err}
			h := NewFileHandler(approvePolicy("/w/f"), nil, &mockFileEmitter{}, true)
			h.SetApprover(ap, time.Second)
			res, _ := h.Handle(FileRequest{PID: 1, Path: "/w/f", Operation: "delete", SessionID: "s1", Syscall: int32(unix.SYS_UNLINKAT)})
			if res.Action != tc.want {
				t.Fatalf("action = %s, want %s", res.Action, tc.want)
			}
			if len(ap.calls) != 1 || ap.calls[0].Path != "/w/f" || ap.calls[0].Rule != "approve-workspace-delete" || ap.calls[0].SessionID != "s1" {
				t.Fatalf("approver calls = %+v", ap.calls)
			}
		})
	}
}

// A decision the seccomp backend cannot carry out denies instead of allowing.
func TestFileHandler_RedirectDecisionDenies(t *testing.T) {
	pol := &mockFilePolicy{decisions: map[string]FilePolicyDecision{
		"/w/f": {Decision: "redirect", EffectiveDecision: "redirect", Rule: "redirect-writes"},
	}}
	h := NewFileHandler(pol, nil, &mockFileEmitter{}, true)
	if res, _ := h.Handle(FileRequest{PID: 1, Path: "/w/f", Operation: "write"}); res.Action != ActionDeny {
		t.Fatalf("redirect action = %s, want deny", res.Action)
	}
	// Audit-only mode still records without blocking.
	h = NewFileHandler(pol, nil, &mockFileEmitter{}, false)
	if res, _ := h.Handle(FileRequest{PID: 1, Path: "/w/f", Operation: "write"}); res.Action != ActionContinue {
		t.Fatalf("audit-only redirect action = %s, want continue", res.Action)
	}
}

// CAWA-06 acceptance: the emulated handler denies a read and a write whose
// path cannot be read from the tracee.
func TestEmulatedFileHandler_UnreadablePathDenies(t *testing.T) {
	prev := emulatedRespondDeny
	t.Cleanup(func() { emulatedRespondDeny = prev })

	// A PID no process holds: every tracee read fails.
	const gonePID = 0x3ffffff0
	const atFDCWD = uint64(0xffffffffffffff9c) // AT_FDCWD as an unsigned register
	for _, tc := range []struct {
		name  string
		flags uint64
	}{
		{"read-only open", uint64(unix.O_RDONLY)},
		{"write open", uint64(unix.O_WRONLY | unix.O_CREAT)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var gotErrno int32
			denied := 0
			emulatedRespondDeny = func(fd int, id uint64, errno int32) error {
				denied++
				gotErrno = errno
				return nil
			}
			req := &seccomp.ScmpNotifReq{ID: 7, Pid: gonePID}
			req.Data.Syscall = seccomp.ScmpSyscall(unix.SYS_OPENAT)
			req.Data.Args = []uint64{atFDCWD, 0x1000, tc.flags, 0o644, 0, 0}
			h := NewFileHandler(&mockFilePolicy{}, nil, &mockFileEmitter{}, true)
			h.SetEmulateOpen(true)
			handleFileNotificationEmulated(context.Background(), seccomp.ScmpFd(-1), req, h, "s1")
			if denied != 1 || gotErrno != int32(unix.EACCES) {
				t.Fatalf("deny responses = %d errno = %d, want one EACCES", denied, gotErrno)
			}
		})
	}
}

func TestReadTraceeCreds(t *testing.T) {
	c, err := readTraceeCreds(os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	if c.fsuid != os.Geteuid() || c.fsgid != os.Getegid() {
		t.Fatalf("creds = %+v, want fsuid %d fsgid %d", c, os.Geteuid(), os.Getegid())
	}
	own, _ := unix.Getgroups()
	if !sameGroups(c.groups, own) {
		t.Fatalf("groups = %v, want %v", c.groups, own)
	}
}

// CAWA-13: the emulated open refuses a path whose component turned into a
// symlink after the policy check.
func TestOpenAsTracee_RefusesSymlinkComponent(t *testing.T) {
	dir := t.TempDir()
	realDir := filepath.Join(dir, "real")
	if err := os.Mkdir(realDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(realDir, "f"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(realDir, filepath.Join(dir, "link")); err != nil {
		t.Fatal(err)
	}
	creds, err := readTraceeCreds(os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	fd, err := openAsTracee(os.Getpid(), filepath.Join(realDir, "f"), unix.O_WRONLY, 0, creds)
	if errors.Is(err, errEmulationUnavailable) {
		t.Skip("openat2 unavailable on this kernel")
	}
	if err != nil {
		t.Fatalf("open of the judged path: %v", err)
	}
	_ = unix.Close(fd)
	if _, err := openAsTracee(os.Getpid(), filepath.Join(dir, "link", "f"), unix.O_WRONLY, 0, creds); !errors.Is(err, unix.ELOOP) {
		t.Fatalf("open through a symlink = %v, want ELOOP", err)
	}
}

// CAWA-13: a root supervisor opens with the credentials of the tracee, so a
// file the tracee may not write stays closed and a created file belongs to it.
func TestOpenAsTracee_UsesTraceeCredentials(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("switching filesystem credentials needs root")
	}
	dir := t.TempDir()
	if err := os.Chmod(dir, 0o777); err != nil {
		t.Fatal(err)
	}
	// t.TempDir makes its parent 0700; uid 65534 needs to search it.
	if err := os.Chmod(filepath.Dir(dir), 0o711); err != nil {
		t.Fatal(err)
	}
	rootOnly := filepath.Join(dir, "root-only")
	if err := os.WriteFile(rootOnly, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	nobody := traceeCreds{fsuid: 65534, fsgid: 65534}
	fd, err := openAsTracee(os.Getpid(), rootOnly, unix.O_WRONLY, 0, nobody)
	if errors.Is(err, errEmulationUnavailable) {
		t.Skip("openat2 unavailable on this kernel")
	}
	if !errors.Is(err, unix.EACCES) {
		if err == nil {
			_ = unix.Close(fd)
		}
		t.Fatalf("open of a root-only file as uid 65534 = %v, want EACCES", err)
	}
	created := filepath.Join(dir, "created")
	fd, err = openAsTracee(os.Getpid(), created, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL, 0o600, nobody)
	if err != nil {
		t.Fatalf("create as uid 65534: %v", err)
	}
	_ = unix.Close(fd)
	var st unix.Stat_t
	if err := unix.Stat(created, &st); err != nil {
		t.Fatal(err)
	}
	if st.Uid != 65534 || st.Gid != 65534 {
		t.Fatalf("created file owner = %d:%d, want 65534:65534", st.Uid, st.Gid)
	}
	// The supervisor thread is back on its own credentials.
	if uid, _ := unix.SetfsuidRetUid(-1); uid != 0 {
		t.Fatalf("fsuid after the open = %d, want 0", uid)
	}
}

func TestOpenAsTracee_NonRootCannotSwitch(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("covers a supervisor that is not root")
	}
	other := traceeCreds{fsuid: os.Geteuid() + 1, fsgid: os.Getegid()}
	if _, err := openAsTracee(os.Getpid(), "/etc/hostname", unix.O_WRONLY, 0, other); !errors.Is(err, errEmulationUnavailable) {
		t.Fatalf("err = %v, want errEmulationUnavailable", err)
	}
}

// fakeTraceeMemory serves reads of a byte image at a base address.
type fakeTraceeMemory struct {
	base uint64
	mem  []byte
}

func (f *fakeTraceeMemory) read(_ int, addr uint64, n int) ([]byte, error) {
	if addr < f.base || addr+uint64(n) > f.base+uint64(len(f.mem)) {
		return nil, unix.EFAULT
	}
	off := addr - f.base
	return append([]byte(nil), f.mem[off:off+uint64(n)]...), nil
}

func putMsghdr(buf []byte, name uint64, namelen uint32) {
	if tracePtrSize == 8 {
		binary.NativeEndian.PutUint64(buf[msghdrNameOff:], name)
	} else {
		binary.NativeEndian.PutUint32(buf[msghdrNameOff:], uint32(name))
	}
	binary.NativeEndian.PutUint32(buf[msghdrNameLen:], namelen)
}

func unixSockaddr(path string) []byte {
	sa := make([]byte, 2+len(path)+1)
	*(*uint16)(unsafe.Pointer(&sa[0])) = unix.AF_UNIX
	copy(sa[2:], path)
	return sa
}

// CAWA-14: the destinations of sendmsg and sendmmsg are read from msg_name.
func TestReadMsgDestinations(t *testing.T) {
	const base = 0x10000
	mem := make([]byte, 4096)
	sa := unixSockaddr("/run/denied.sock")
	copy(mem[2048:], sa)

	// sendmsg: one header naming the socket.
	putMsghdr(mem[0:], base+2048, uint32(len(sa)))
	fake := &fakeTraceeMemory{base: base, mem: mem}
	got, err := readMsgDestinations(1, seccomp.ScmpSyscall(unix.SYS_SENDMSG), base, 0, fake.read)
	if err != nil || len(got) != 1 {
		t.Fatalf("sendmsg destinations = %v, %v", got, err)
	}
	if p, _, perr := ParseSockaddr(got[0]); perr != nil || p != "/run/denied.sock" {
		t.Fatalf("parsed destination = %q, %v", p, perr)
	}

	// sendmmsg: the second of three messages carries the address, the
	// others write to a connected socket.
	mm := make([]byte, 4096)
	copy(mm[2048:], sa)
	putMsghdr(mm[0*mmsghdrSize:], 0, 0)
	putMsghdr(mm[1*mmsghdrSize:], base+2048, uint32(len(sa)))
	putMsghdr(mm[2*mmsghdrSize:], 0, 0)
	fake = &fakeTraceeMemory{base: base, mem: mm}
	got, err = readMsgDestinations(1, seccomp.ScmpSyscall(unix.SYS_SENDMMSG), base, 3, fake.read)
	if err != nil || len(got) != 1 {
		t.Fatalf("sendmmsg destinations = %v, %v", got, err)
	}

	// An unreadable header is an error, so the caller denies.
	if _, err := readMsgDestinations(1, seccomp.ScmpSyscall(unix.SYS_SENDMSG), 0x999999, 0, fake.read); err == nil {
		t.Fatal("an unreadable msghdr must be an error")
	}
	// An unreadable msg_name is an error as well.
	bad := make([]byte, 512)
	putMsghdr(bad, 0x999999, 20)
	fake = &fakeTraceeMemory{base: base, mem: bad}
	if _, err := readMsgDestinations(1, seccomp.ScmpSyscall(unix.SYS_SENDMSG), base, 0, fake.read); err == nil {
		t.Fatal("an unreadable msg_name must be an error")
	}
}
