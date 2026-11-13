//go:build linux && cgo

package unix

import (
	"encoding/binary"
	"errors"
	"fmt"
	"log/slog"
	"unsafe"

	seccomp "github.com/seccomp/libseccomp-golang"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/policy"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/pkg/types"
	"golang.org/x/sys/unix"
)

// maxSendmmsgVlen is UIO_MAXIOV. The kernel caps the vlen of sendmmsg to it,
// so no call sends more messages.
const maxSendmmsgVlen = 1024

var (
	msghdrSize     = int(unsafe.Sizeof(unix.Msghdr{}))
	mmsghdrSize    = int(unsafe.Sizeof(unix.Mmsghdr{}))
	msghdrNameOff  = int(unsafe.Offsetof(unix.Msghdr{}.Name))
	msghdrNameLen  = int(unsafe.Offsetof(unix.Msghdr{}.Namelen))
	tracePtrSize   = int(unsafe.Sizeof(uintptr(0)))
	errShortMsghdr = errors.New("short msghdr read")
)

// isMsgSendSyscall reports whether a trapped syscall carries its destination
// inside a msghdr: sendmsg and sendmmsg (CAWA-14).
func isMsgSendSyscall(sc seccomp.ScmpSyscall) bool {
	return sc == seccomp.ScmpSyscall(unix.SYS_SENDMSG) || sc == seccomp.ScmpSyscall(unix.SYS_SENDMMSG)
}

// traceeReader reads n bytes of tracee memory at addr.
type traceeReader func(pid int, addr uint64, n int) ([]byte, error)

// readTraceeExact reads exactly n bytes of tracee memory. It tries
// process_vm_readv first and /proc/<pid>/mem second, the same order as the
// path readers of the file monitor.
func readTraceeExact(pid int, addr uint64, n int) ([]byte, error) {
	if addr == 0 || n <= 0 {
		return nil, errors.New("empty tracee read")
	}
	buf := make([]byte, n)
	liov := unix.Iovec{Base: &buf[0], Len: uint64(n)}
	riov := unix.RemoteIovec{Base: uintptr(addr), Len: n}
	if got, err := unix.ProcessVMReadv(pid, []unix.Iovec{liov}, []unix.RemoteIovec{riov}, 0); err == nil && got == n {
		return buf, nil
	}
	got, err := readProcMemStrict(pid, addr, buf)
	if err != nil {
		return nil, err
	}
	if got != n {
		return nil, errShortMsghdr
	}
	return buf, nil
}

func nativeUint(b []byte, size int) uint64 {
	if size == 8 {
		return binary.NativeEndian.Uint64(b)
	}
	return uint64(binary.NativeEndian.Uint32(b))
}

// readMsgDestinations returns the destination addresses of a sendmsg or
// sendmmsg call. For sendmsg msgPtr points at one msghdr; for sendmmsg it
// points at vlen mmsghdr entries. A message without msg_name writes to a
// connected socket, which was judged at connect, and adds nothing. Any
// header or address that cannot be read is an error, so the caller denies.
func readMsgDestinations(pid int, sc seccomp.ScmpSyscall, msgPtr, vlen uint64, read traceeReader) ([][]byte, error) {
	if msgPtr == 0 {
		return nil, fmt.Errorf("null msghdr pointer")
	}
	count, stride := uint64(1), msghdrSize
	if sc == seccomp.ScmpSyscall(unix.SYS_SENDMMSG) {
		count, stride = vlen, mmsghdrSize
		if count > maxSendmmsgVlen {
			count = maxSendmmsgVlen
		}
		if count == 0 {
			return nil, nil
		}
	}
	hdrs, err := read(pid, msgPtr, int(count)*stride)
	if err != nil {
		return nil, fmt.Errorf("read msghdr: %w", err)
	}
	var out [][]byte
	for i := 0; i < int(count); i++ {
		h := hdrs[i*stride : i*stride+msghdrSize]
		namePtr := nativeUint(h[msghdrNameOff:], tracePtrSize)
		nameLen := uint64(binary.NativeEndian.Uint32(h[msghdrNameLen:]))
		if namePtr == 0 || nameLen == 0 {
			continue
		}
		if nameLen > uint64(unsafe.Sizeof(unix.RawSockaddrAny{})) {
			nameLen = uint64(unsafe.Sizeof(unix.RawSockaddrAny{}))
		}
		raw, err := read(pid, namePtr, int(nameLen))
		if err != nil {
			return nil, fmt.Errorf("read msg_name %d: %w", i, err)
		}
		out = append(out, raw)
	}
	return out, nil
}

// SendListenerFD hands the listener fd of a freshly loaded filter to the
// supervisor over sockFD with one SCM_RIGHTS message carrying payload.
//
// When msgSendTrapped is set the filter traps sendmsg (CAWA-14), so the
// handoff sendmsg itself raises a notification on the listener it carries.
// No supervisor holds that listener yet, so a goroutine of this process
// answers it: it continues every notification until it has continued the
// handoff. Up to the handoff only this process runs under the filter and
// every trapped call is its own setup code. The goroutine stops right after
// the handoff, so from then on the supervisor is the only reader.
func SendListenerFD(sockFD, listenerFD int, payload byte, msgSendTrapped bool) error {
	rights := unix.UnixRights(listenerFD)
	if !msgSendTrapped {
		return unix.Sendmsg(sockFD, []byte{payload}, rights, nil, 0)
	}
	served := make(chan error, 1)
	go func() {
		served <- continueUntilHandoff(listenerFD, sockFD)
	}()
	sendErr := unix.Sendmsg(sockFD, []byte{payload}, rights, nil, 0)
	if serveErr := <-served; serveErr != nil {
		return fmt.Errorf("answer handoff notification: %w", serveErr)
	}
	return sendErr
}

// continueUntilHandoff answers notifications on listenerFD with CONTINUE and
// returns once it has continued the sendmsg on sockFD.
func continueUntilHandoff(listenerFD, sockFD int) error {
	for {
		req, err := seccomp.NotifReceive(seccomp.ScmpFd(listenerFD))
		if err != nil {
			if isEAGAIN(err) || errors.Is(err, unix.EINTR) || isENOENT(err) {
				continue
			}
			return err
		}
		handoff := req.Data.Syscall == seccomp.ScmpSyscall(unix.SYS_SENDMSG) && req.Data.Args[0] == uint64(sockFD)
		if err := NotifRespondContinue(listenerFD, req.ID); err != nil {
			if isENOENT(err) || errors.Is(err, unix.ENOENT) {
				// The call was interrupted and will be trapped again.
				continue
			}
			return err
		}
		if handoff {
			return nil
		}
	}
}

// judgeMsgSend decides a trapped sendmsg or sendmmsg under unix socket policy.
// Every AF_UNIX destination must be allowed; the first refused one denies the
// whole call and names its path. Destinations of other families belong to the
// network policy and pass. An unreadable header or address denies (TM-05).
func judgeMsgSend(pid int, req *seccomp.ScmpNotifReq, pol *policy.Engine, emit Emitter, sessID, op string) (allow bool, path string, abstract bool, ev *types.Event) {
	dests, err := readMsgDestinations(pid, req.Data.Syscall, req.Data.Args[1], req.Data.Args[2], readTraceeExact)
	if err != nil {
		slog.Debug("unix socket: msghdr unreadable, denying", "session_id", sessID, "syscall", op, "error", err)
		return false, "", false, nil
	}
	for _, raw := range dests {
		if len(raw) < 2 {
			return false, "", false, nil
		}
		if *(*uint16)(unsafe.Pointer(&raw[0])) != unix.AF_UNIX {
			continue
		}
		p, abs, perr := ParseSockaddr(raw)
		if perr != nil {
			slog.Debug("unix socket: ParseSockaddr failed, denying", "session_id", sessID, "error", perr)
			return false, "", false, nil
		}
		dec := pol.CheckUnixSocket(p, op)
		if dec.EffectiveDecision != types.DecisionAllow {
			return false, p, abs, buildUnixSocketEvent(emit, sessID, dec, p, abs, op)
		}
	}
	return true, "", false, nil
}
