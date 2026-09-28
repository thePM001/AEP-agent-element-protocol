// Package kerneldock probes the AEP Base Node kernel dock.
//
// AEP 2.8 treats the Base Node as the local governance kernel. The kernel
// publishes one Unix socket dock per port under the socket base. CAW runs the
// host workload, so the execution path refuses to start a command while the
// probed dock is silent: a host admission with no live kernel behind it is not
// governance.
//
// The docks accept only sealed LatticeChannelFrames and refuse a plain ping as
// a side channel. The probe therefore proves a live kernel the way every other
// caller talks to it. It seals one root:ping as the caw-kernel-dock agent with
// aep-lattice-log build-frame, sends the frame to the dock, collects the
// outcome after the pulse and passes only when the dock admits the frame. The
// Base Node provisions the caw-kernel-dock identity at boot. The lattice and a
// caw-*.gap hub policy grant it root:ping.
package kerneldock

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Rule is the name the refusal carries.
const Rule = "kernel-dock-silent"

// DefaultDock is the dock the execution path probes when no dock is named.
// The validation dock carries the admission decision, so a live validation
// dock is what makes a host admission real.
const DefaultDock = "validation_engine"

// DefaultTimeout bounds one whole probe: sealing the ping, the send and the
// collect after the pulse.
const DefaultTimeout = 5 * time.Second

// DefaultAgent is the agent the sealed ping is signed as. The Base Node
// provisions its sign key and task manifest at boot.
const DefaultAgent = "caw-kernel-dock"

// DefaultLatticeLogBin is the Base Node tool that seals the ping.
const DefaultLatticeLogBin = "aep-lattice-log"

const (
	pingSession = "caw-kernel-dock-session"
	pingChannel = "ch-caw-kernel-dock"
	pingAction  = "root:ping"
	collectStep = 100 * time.Millisecond
)

// dockSuffixes maps a dock port id to the socket file name the kernel binds
// under the socket base.
var dockSuffixes = map[string]string{
	"inference_engine":  "inference",
	"validation_engine": "validation",
	"future_features":   "future",
	"regulation_module": "regulation",
}

// DockPorts lists the dock port ids in a stable order.
func DockPorts() []string {
	ports := make([]string, 0, len(dockSuffixes))
	for port := range dockSuffixes {
		ports = append(ports, port)
	}
	sort.Strings(ports)
	return ports
}

// Options configure one dock probe.
type Options struct {
	// SocketBase is the directory that holds the dock sockets. Empty means
	// AEP_SOCKET_BASE, else AEP_DATA/sockets, else $HOME/.aep/sockets.
	SocketBase string
	// Dock is the dock port id to probe. Empty means DefaultDock.
	Dock string
	// Timeout bounds the whole probe. Zero means DefaultTimeout.
	Timeout time.Duration
	// LatticeLogBin is the aep-lattice-log binary that seals the ping. Empty
	// means AEP_LATTICE_LOG_BIN, else aep-lattice-log on PATH.
	LatticeLogBin string
	// LatticeDB is the Base Node lattice database whose key store signs the
	// ping. Empty means AEP_LATTICE_DB, else AEP_DATA/action-lattice.db, else
	// action-lattice.db next to the socket base.
	LatticeDB string
	// AgentID signs the sealed ping. Empty means DefaultAgent.
	AgentID string
}

// Refusal is the named refusal the execution path returns when the dock does
// not admit the sealed ping. It names the rule, the dock and the socket, so the
// refusal in the evidence identifies the silent dock.
type Refusal struct {
	Dock   string
	Socket string
	Cause  error
}

func (r *Refusal) Error() string {
	return fmt.Sprintf("kernel dock silent (rule=%s dock=%s socket=%s): %v", Rule, r.Dock, r.Socket, r.Cause)
}

// Unwrap exposes the cause for errors.Is and errors.As.
func (r *Refusal) Unwrap() error { return r.Cause }

// ValidateDock reports whether a dock port id is one the kernel binds.
func ValidateDock(dock string) error {
	if _, ok := dockSuffixes[strings.TrimSpace(dock)]; !ok {
		return fmt.Errorf("unknown kernel dock %q (known: %s)", dock, strings.Join(DockPorts(), " "))
	}
	return nil
}

// SocketPath returns the socket path of one dock under a socket base.
func SocketPath(socketBase, dock string) (string, error) {
	suffix, ok := dockSuffixes[strings.TrimSpace(dock)]
	if !ok {
		return "", fmt.Errorf("unknown kernel dock %q (known: %s)", dock, strings.Join(DockPorts(), " "))
	}
	if strings.TrimSpace(socketBase) == "" {
		return "", fmt.Errorf("kernel dock socket base is empty")
	}
	return filepath.Join(socketBase, suffix), nil
}

// ResolveSocketBase returns the socket base the probe uses. An explicit value
// wins, then AEP_SOCKET_BASE, then AEP_DATA/sockets, then $HOME/.aep/sockets.
func ResolveSocketBase(explicit string) string {
	if v := strings.TrimSpace(explicit); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("AEP_SOCKET_BASE")); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("AEP_DATA")); v != "" {
		return filepath.Join(v, "sockets")
	}
	home := strings.TrimSpace(os.Getenv("HOME"))
	if home == "" {
		home = "/var/lib/aep"
	}
	return filepath.Join(home, ".aep", "sockets")
}

// ResolveLatticeDB returns the lattice database the probe seals with. An
// explicit value wins, then AEP_LATTICE_DB, then AEP_DATA/action-lattice.db,
// then action-lattice.db in the parent of the socket base.
func ResolveLatticeDB(explicit, socketBase string) string {
	if v := strings.TrimSpace(explicit); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("AEP_LATTICE_DB")); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("AEP_DATA")); v != "" {
		return filepath.Join(v, "action-lattice.db")
	}
	return filepath.Join(filepath.Dir(filepath.Clean(socketBase)), "action-lattice.db")
}

// ResolveLatticeLogBin returns the sealing tool. An explicit value wins, then
// AEP_LATTICE_LOG_BIN, then aep-lattice-log on PATH.
func ResolveLatticeLogBin(explicit string) string {
	if v := strings.TrimSpace(explicit); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("AEP_LATTICE_LOG_BIN")); v != "" {
		return v
	}
	return DefaultLatticeLogBin
}

func (o Options) resolved() Options {
	if strings.TrimSpace(o.Dock) == "" {
		o.Dock = DefaultDock
	}
	o.Dock = strings.TrimSpace(o.Dock)
	o.SocketBase = ResolveSocketBase(o.SocketBase)
	o.LatticeDB = ResolveLatticeDB(o.LatticeDB, o.SocketBase)
	o.LatticeLogBin = ResolveLatticeLogBin(o.LatticeLogBin)
	if strings.TrimSpace(o.AgentID) == "" {
		o.AgentID = DefaultAgent
	}
	o.AgentID = strings.TrimSpace(o.AgentID)
	if o.Timeout <= 0 {
		o.Timeout = DefaultTimeout
	}
	return o
}

// dockAnswer is the part of a Base Node dock response the probe reads.
type dockAnswer struct {
	OK      bool   `json:"ok"`
	EventID *int64 `json:"event_id"`
	Digest  string `json:"digest"`
	Error   string `json:"error"`
	Pending *bool  `json:"pending"`
	Deny    *struct {
		Closed []struct {
			ID     string `json:"id"`
			Reason string `json:"reason"`
		} `json:"closed"`
	} `json:"deny"`
}

func (a dockAnswer) pending() bool { return a.Pending != nil && *a.Pending }

func (a dockAnswer) refusalText() string {
	if t := strings.TrimSpace(a.Error); t != "" {
		return t
	}
	if a.Deny != nil {
		parts := make([]string, 0, len(a.Deny.Closed))
		for _, w := range a.Deny.Closed {
			parts = append(parts, strings.TrimSpace(w.ID+" "+w.Reason))
		}
		if len(parts) > 0 {
			return strings.Join(parts, "; ")
		}
	}
	return "dock answered without an admitted event"
}

// Probe seals one root:ping, sends it to the dock and requires the dock to
// admit it. It returns nil when the dock admits the ping and a Refusal
// otherwise.
func Probe(opts Options) error {
	opts = opts.resolved()
	path, err := SocketPath(opts.SocketBase, opts.Dock)
	if err != nil {
		return &Refusal{Dock: opts.Dock, Socket: opts.SocketBase, Cause: err}
	}
	deadline := time.Now().Add(opts.Timeout)
	refuse := func(cause error) error {
		return &Refusal{Dock: opts.Dock, Socket: path, Cause: cause}
	}
	wire, err := sealPing(opts, deadline)
	if err != nil {
		return refuse(err)
	}
	answer, err := exchange(path, wire, deadline)
	if err != nil {
		return refuse(err)
	}
	for answer.pending() {
		if strings.TrimSpace(answer.Digest) == "" {
			return refuse(fmt.Errorf("dock held the sealed ping without a digest"))
		}
		if time.Now().Add(collectStep).After(deadline) {
			return refuse(fmt.Errorf("sealed ping was still pending at the deadline"))
		}
		time.Sleep(collectStep)
		collect, err := json.Marshal(map[string]string{"collect": answer.Digest})
		if err != nil {
			return refuse(err)
		}
		if answer, err = exchange(path, append(collect, '\n'), deadline); err != nil {
			return refuse(err)
		}
	}
	if !answer.OK || answer.EventID == nil {
		return refuse(fmt.Errorf("dock refused the sealed ping: %s", answer.refusalText()))
	}
	return nil
}

// sealPing builds the dock request line for one sealed root:ping.
func sealPing(opts Options, deadline time.Time) ([]byte, error) {
	now := time.Now()
	event := map[string]any{
		"agent_id":     opts.AgentID,
		"channel_id":   pingChannel,
		"event_type":   "PING",
		"action_path":  pingAction,
		"session_id":   pingSession,
		"docking_port": opts.Dock,
		"payload": map[string]any{
			"type":            "PING",
			"action_path":     pingAction,
			"payload":         map[string]bool{"ok": true},
			"timestamp":       now.UnixMilli(),
			"target_id":       opts.AgentID,
			"_sequenceNumber": now.UnixNano(),
		},
	}
	input, err := json.Marshal(event)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithDeadline(context.Background(), deadline)
	defer cancel()
	cmd := exec.CommandContext(ctx, opts.LatticeLogBin, "--db", opts.LatticeDB, "build-frame")
	cmd.Stdin = bytes.NewReader(input)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		detail := strings.TrimSpace(stderr.String())
		if len(detail) > 300 {
			detail = detail[len(detail)-300:]
		}
		return nil, fmt.Errorf("seal root:ping with %s: %v %s", opts.LatticeLogBin, err, detail)
	}
	var built struct {
		Frame           json.RawMessage `json:"frame"`
		SignerPublicHex string          `json:"signer_public_hex"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &built); err != nil {
		return nil, fmt.Errorf("sealed ping is not a frame envelope: %v", err)
	}
	if len(bytes.TrimSpace(built.Frame)) == 0 || string(bytes.TrimSpace(built.Frame)) == "null" {
		return nil, fmt.Errorf("sealed ping carries no frame")
	}
	if strings.TrimSpace(built.SignerPublicHex) == "" {
		return nil, fmt.Errorf("no sign key for agent %s in %s", opts.AgentID, opts.LatticeDB)
	}
	line, err := json.Marshal(map[string]any{
		"frame":             built.Frame,
		"signer_public_hex": built.SignerPublicHex,
	})
	if err != nil {
		return nil, err
	}
	return append(line, '\n'), nil
}

// exchange sends one request line on a fresh connection and reads one answer.
func exchange(path string, line []byte, deadline time.Time) (dockAnswer, error) {
	var answer dockAnswer
	left := time.Until(deadline)
	if left <= 0 {
		return answer, fmt.Errorf("probe deadline passed before the dock answered")
	}
	conn, err := net.DialTimeout("unix", path, left)
	if err != nil {
		return answer, err
	}
	defer conn.Close()
	if err := conn.SetDeadline(deadline); err != nil {
		return answer, err
	}
	if _, err := conn.Write(line); err != nil {
		return answer, err
	}
	text, err := bufio.NewReader(conn).ReadString('\n')
	if err != nil && !(err == io.EOF && strings.TrimSpace(text) != "") {
		return answer, err
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(text)), &answer); err != nil {
		return answer, fmt.Errorf("dock answer is not a dock response: %v", err)
	}
	return answer, nil
}
