//go:build linux

package api

import (
	"bufio"
	"encoding/binary"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// procPeerResolver resolves control API peers through procfs.
type procPeerResolver struct {
	// root is the procfs mount, "/proc" in production.
	root string
}

func defaultPeerResolver() peerResolver { return procPeerResolver{root: "/proc"} }

type procStat struct {
	ppid, pgid, sid int
}

// classify finds the socket of the client end (its local address is the
// server's remote address and the other way round), then looks for a session
// process that holds that socket.
func (p procPeerResolver) classify(localAddr, remoteAddr net.Addr, v sessionView) (peerClass, error) {
	local, remote, err := tcpPeerAddrs(localAddr, remoteAddr)
	if err != nil {
		return peerClass{}, err
	}
	inode, err := p.socketInode(remote, local)
	if errors.Is(err, errPeerNotLocal) && !remote.IP.IsLoopback() {
		// No socket of this host: the caller is on another machine.
		return peerClass{}, nil
	}
	if err != nil {
		return peerClass{}, err
	}
	procs, err := p.scanProcs()
	if err != nil {
		return peerClass{}, err
	}
	if v.Prune != nil {
		live := make(map[int]struct{}, len(procs)*2)
		for pid, st := range procs {
			live[pid] = struct{}{}
			live[st.pgid] = struct{}{}
			live[st.sid] = struct{}{}
		}
		defer v.Prune(live)
	}
	target := fmt.Sprintf("socket:[%d]", inode)
	var unreadable error
	for pid, st := range procs {
		pc, ok := p.sessionMarker(pid, st, procs, v)
		if !ok {
			continue
		}
		holds, err := p.holdsSocket(pid, target)
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				continue // exited during the scan
			}
			unreadable = fmt.Errorf("read fds of session process %d: %w", pid, err)
			continue
		}
		if holds {
			pc.SessionProcess = true
			pc.PID = pid
			return pc, nil
		}
	}
	if unreadable != nil {
		return peerClass{}, unreadable
	}
	return peerClass{}, nil
}

// classifyPID classifies the process that connected over the unix socket.
func (p procPeerResolver) classifyPID(pid int, v sessionView) (peerClass, error) {
	if pid <= 0 {
		return peerClass{}, errors.New("unix socket peer has no credentials")
	}
	procs, err := p.scanProcs()
	if err != nil {
		return peerClass{}, err
	}
	st, ok := procs[pid]
	if !ok {
		return peerClass{}, fmt.Errorf("unix socket peer %d is gone", pid)
	}
	pc, isSession := p.sessionMarker(pid, st, procs, v)
	if !isSession {
		return peerClass{}, nil
	}
	pc.SessionProcess = true
	pc.PID = pid
	return pc, nil
}

// sessionMarker reports whether pid belongs to a session and which marker
// says so. The markers survive the usual ways out of a process tree: the
// process group and session id survive reparenting, the cgroup survives
// setsid, and a descendant of the server is always one of its commands.
func (p procPeerResolver) sessionMarker(pid int, st procStat, procs map[int]procStat, v sessionView) (peerClass, bool) {
	pc := peerClass{Sessions: map[string]struct{}{}}
	if pid == v.ServerPID {
		return pc, false
	}
	var reasons []string
	if id, ok := v.Roots[st.pgid]; ok {
		pc.Sessions[id] = struct{}{}
		reasons = append(reasons, fmt.Sprintf("process group of session root %d", st.pgid))
	}
	if id, ok := v.Roots[st.sid]; ok {
		pc.Sessions[id] = struct{}{}
		reasons = append(reasons, fmt.Sprintf("terminal session of session root %d", st.sid))
	}
	underServer := false
	cur := pid
	for depth := 0; depth < 4096 && cur > 1; depth++ {
		if id, ok := v.Roots[cur]; ok {
			pc.Sessions[id] = struct{}{}
			reasons = append(reasons, fmt.Sprintf("descendant of session root %d", cur))
		}
		if cur == v.ServerPID && cur != pid {
			underServer = true
			break
		}
		next, ok := procs[cur]
		if !ok || next.ppid == cur {
			break
		}
		cur = next.ppid
	}
	if len(v.CgroupPrefix) > 0 {
		if id, ok := p.cgroupSession(pid, v.CgroupPrefix); ok {
			pc.Sessions[id] = struct{}{}
			reasons = append(reasons, "session cgroup")
		}
	}
	if underServer {
		reasons = append(reasons, "descendant of the server")
	}
	if len(reasons) == 0 {
		return pc, false
	}
	pc.Reason = strings.Join(reasons, "; ")
	return pc, true
}

// cgroupSession matches the cgroup of pid against the session cgroup names
// ("aep-caw-<session>-<command>").
func (p procPeerResolver) cgroupSession(pid int, prefixes map[string]string) (string, bool) {
	b, err := os.ReadFile(filepath.Join(p.root, strconv.Itoa(pid), "cgroup"))
	if err != nil {
		return "", false
	}
	for _, line := range strings.Split(string(b), "\n") {
		parts := strings.SplitN(line, ":", 3)
		if len(parts) != 3 {
			continue
		}
		for _, seg := range strings.Split(parts[2], "/") {
			for prefix, id := range prefixes {
				if strings.HasPrefix(seg, prefix) {
					return id, true
				}
			}
		}
	}
	return "", false
}

func (p procPeerResolver) holdsSocket(pid int, target string) (bool, error) {
	dir := filepath.Join(p.root, strconv.Itoa(pid), "fd")
	ents, err := os.ReadDir(dir)
	if err != nil {
		return false, err
	}
	for _, e := range ents {
		link, err := os.Readlink(filepath.Join(dir, e.Name()))
		if err != nil {
			continue // closed while reading
		}
		if link == target {
			return true, nil
		}
	}
	return false, nil
}

func (p procPeerResolver) scanProcs() (map[int]procStat, error) {
	ents, err := os.ReadDir(p.root)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", p.root, err)
	}
	out := make(map[int]procStat, len(ents))
	for _, e := range ents {
		pid, err := strconv.Atoi(e.Name())
		if err != nil || pid <= 0 {
			continue
		}
		b, err := os.ReadFile(filepath.Join(p.root, e.Name(), "stat"))
		if err != nil {
			continue // exited during the scan
		}
		st, ok := parseProcStat(string(b))
		if !ok {
			continue
		}
		out[pid] = st
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no processes readable under %s", p.root)
	}
	return out, nil
}

// parseProcStat reads ppid, pgrp and session from /proc/<pid>/stat. The
// command name may hold spaces and parentheses, so the fields are read after
// the last closing parenthesis.
func parseProcStat(s string) (procStat, bool) {
	i := strings.LastIndexByte(s, ')')
	if i < 0 {
		return procStat{}, false
	}
	f := strings.Fields(s[i+1:])
	if len(f) < 4 {
		return procStat{}, false
	}
	ppid, err1 := strconv.Atoi(f[1])
	pgid, err2 := strconv.Atoi(f[2])
	sid, err3 := strconv.Atoi(f[3])
	if err1 != nil || err2 != nil || err3 != nil {
		return procStat{}, false
	}
	return procStat{ppid: ppid, pgid: pgid, sid: sid}, true
}

// socketInode finds the inode of the TCP socket with local address src and
// remote address dst in this network namespace. errPeerNotLocal means no
// such socket exists here, so the peer is on another host.
func (p procPeerResolver) socketInode(src, dst *net.TCPAddr) (uint64, error) {
	read := 0
	for _, name := range []string{"tcp", "tcp6"} {
		f, err := os.Open(filepath.Join(p.root, "net", name))
		if err != nil {
			continue
		}
		read++
		inode, found, err := findSocketInode(bufio.NewScanner(f), src, dst)
		_ = f.Close()
		if err != nil {
			return 0, err
		}
		if found {
			return inode, nil
		}
	}
	if read == 0 {
		return 0, fmt.Errorf("no tcp table readable under %s/net", p.root)
	}
	return 0, errPeerNotLocal
}

func findSocketInode(sc *bufio.Scanner, src, dst *net.TCPAddr) (uint64, bool, error) {
	first := true
	for sc.Scan() {
		if first {
			first = false
			continue // header
		}
		f := strings.Fields(sc.Text())
		if len(f) < 10 {
			continue
		}
		lip, lport, ok1 := parseProcNetAddr(f[1])
		rip, rport, ok2 := parseProcNetAddr(f[2])
		if !ok1 || !ok2 {
			continue
		}
		if lport != src.Port || rport != dst.Port || !lip.Equal(src.IP) || !rip.Equal(dst.IP) {
			continue
		}
		inode, err := strconv.ParseUint(f[9], 10, 64)
		if err != nil || inode == 0 {
			continue // a socket without an inode (TIME_WAIT) is not a live peer
		}
		return inode, true, nil
	}
	return 0, false, sc.Err()
}

// parseProcNetAddr decodes "0100007F:1F90" (IPv4) or the 32 hex digit IPv6
// form of /proc/net/tcp6. The kernel prints each 32 bit word of the address
// as a host order integer, so each word is written back in native order.
func parseProcNetAddr(s string) (net.IP, int, bool) {
	hexIP, hexPort, ok := strings.Cut(s, ":")
	if !ok || (len(hexIP) != 8 && len(hexIP) != 32) {
		return nil, 0, false
	}
	port, err := strconv.ParseUint(hexPort, 16, 16)
	if err != nil {
		return nil, 0, false
	}
	ip := make(net.IP, len(hexIP)/2)
	for w := 0; w < len(hexIP); w += 8 {
		word, err := strconv.ParseUint(hexIP[w:w+8], 16, 32)
		if err != nil {
			return nil, 0, false
		}
		binary.NativeEndian.PutUint32(ip[w/2:], uint32(word))
	}
	return ip, int(port), true
}
