//go:build linux && cgo

package unix

import (
	"encoding/binary"
	"errors"
	"testing"

	seccomp "github.com/seccomp/libseccomp-golang"
	"golang.org/x/sys/unix"
)

func sockaddrOf(family uint16, rest ...byte) []byte {
	raw := make([]byte, 2, 2+len(rest))
	binary.NativeEndian.PutUint16(raw, family)
	return append(raw, rest...)
}

func TestSockaddrTrapScope(t *testing.T) {
	connect := seccomp.ScmpSyscall(unix.SYS_CONNECT)
	sendto := seccomp.ScmpSyscall(unix.SYS_SENDTO)
	bind := seccomp.ScmpSyscall(unix.SYS_BIND)
	readOK := func(raw []byte) func() ([]byte, error) {
		return func() ([]byte, error) { return raw, nil }
	}
	unread := func() ([]byte, error) { t.Fatal("address read for a sendto without an address"); return nil, nil }

	cases := []struct {
		name string
		sc   seccomp.ScmpSyscall
		ptr  uint64
		n    uint64
		read func() ([]byte, error)
		want trapScope
	}{
		{"tcp connect continues", connect, 1, 16, readOK(sockaddrOf(unix.AF_INET, 0x15, 0x38, 172, 19, 0, 2)), trapContinue},
		{"tcp6 connect continues", connect, 1, 28, readOK(sockaddrOf(unix.AF_INET6)), trapContinue},
		{"udp dns sendto continues", sendto, 1, 16, readOK(sockaddrOf(unix.AF_INET, 0, 53, 127, 0, 0, 11)), trapContinue},
		{"sendto on a connected socket continues", sendto, 0, 0, unread, trapContinue},
		{"unix connect goes to policy", connect, 1, 20, readOK(sockaddrOf(unix.AF_UNIX, '/', 'r', 'u', 'n', 0)), trapPolicy},
		{"unix bind goes to policy", bind, 1, 20, readOK(sockaddrOf(unix.AF_UNIX, 0, 'a', 'b')), trapPolicy},
		{"unreadable address fails closed", connect, 1, 16, func() ([]byte, error) { return nil, errors.New("gone") }, trapDeny},
		{"short address fails closed", connect, 1, 1, readOK([]byte{1}), trapDeny},
		{"connect without an address fails closed", connect, 0, 0, func() ([]byte, error) { return nil, errors.New("empty sockaddr") }, trapDeny},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, _, _ := sockaddrTrapScope(c.sc, c.ptr, c.n, c.read)
			if got != c.want {
				t.Fatalf("scope = %d, want %d", got, c.want)
			}
		})
	}
}

func TestExtractContextReadsTheAddressArgumentsOfEachSyscall(t *testing.T) {
	req := func(sc int, args ...uint64) *seccomp.ScmpNotifReq {
		r := &seccomp.ScmpNotifReq{Pid: 7}
		r.Data.Syscall = seccomp.ScmpSyscall(sc)
		r.Data.Args = make([]uint64, 6)
		copy(r.Data.Args, args)
		return r
	}
	// A one byte send on a connected socketpair, the asyncio loop wake-up:
	// buf and len sit in arg1 and arg2, the destination is NULL.
	send := ExtractContext(req(unix.SYS_SENDTO, 3, 0xbeef, 1, 0, 0, 0))
	if send.AddrPtr != 0 || send.AddrLen != 0 {
		t.Fatalf("sendto address = %#x/%d, want the NULL destination", send.AddrPtr, send.AddrLen)
	}
	if got, _, _ := sockaddrTrapScope(send.Syscall, send.AddrPtr, send.AddrLen, func() ([]byte, error) {
		t.Fatal("payload read as a sockaddr")
		return nil, nil
	}); got != trapContinue {
		t.Fatalf("connected sendto scope = %d, want trapContinue", got)
	}
	dest := ExtractContext(req(unix.SYS_SENDTO, 3, 0xbeef, 1, 0, 0xcafe, 16))
	if dest.AddrPtr != 0xcafe || dest.AddrLen != 16 {
		t.Fatalf("sendto destination = %#x/%d, want 0xcafe/16", dest.AddrPtr, dest.AddrLen)
	}
	for _, sc := range []int{unix.SYS_CONNECT, unix.SYS_BIND} {
		c := ExtractContext(req(sc, 3, 0xcafe, 20))
		if c.AddrPtr != 0xcafe || c.AddrLen != 20 || c.PID != 7 {
			t.Fatalf("syscall %d context = %+v, want 0xcafe/20 for pid 7", sc, c)
		}
	}
}
