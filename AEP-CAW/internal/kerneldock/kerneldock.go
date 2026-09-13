// Package kerneldock probes the AEP Base Node kernel dock.
//
// AEP 2.8 treats the Base Node as the local governance kernel. The kernel
// publishes one Unix socket dock per port under the socket base and answers a
// newline delimited JSON ping with a pong. CAW runs the host workload, so the
// execution path refuses to start a command while the probed dock stays
// silent: a host admission with no live kernel behind it is not governance.
//
// The probe is the same check the operator preflight reads from the kernel
// health report, run here inside the execution path instead of in a separate
// operator script.
package kerneldock

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
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

// DefaultTimeout bounds one dial plus one ping exchange.
const DefaultTimeout = 2 * time.Second

// pingRequest is the documented health request of every Base Node dock.
const pingRequest = "{\"ping\":true}\n"

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
	// Timeout bounds the dial and the ping read. Zero means DefaultTimeout.
	Timeout time.Duration
}

// Refusal is the named refusal the execution path returns when the dock does
// not answer. It names the rule, the dock and the socket, so the refusal in
// the evidence identifies the silent dock.
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

func (o Options) resolved() Options {
	if strings.TrimSpace(o.Dock) == "" {
		o.Dock = DefaultDock
	}
	o.Dock = strings.TrimSpace(o.Dock)
	o.SocketBase = ResolveSocketBase(o.SocketBase)
	if o.Timeout <= 0 {
		o.Timeout = DefaultTimeout
	}
	return o
}

// Probe dials the dock and requires the documented pong. It returns nil when
// the dock answers and a Refusal when the dock does not answer.
func Probe(opts Options) error {
	opts = opts.resolved()
	path, err := SocketPath(opts.SocketBase, opts.Dock)
	if err != nil {
		return &Refusal{Dock: opts.Dock, Socket: opts.SocketBase, Cause: err}
	}
	conn, err := net.DialTimeout("unix", path, opts.Timeout)
	if err != nil {
		return &Refusal{Dock: opts.Dock, Socket: path, Cause: err}
	}
	defer conn.Close()
	if err := conn.SetDeadline(time.Now().Add(opts.Timeout)); err != nil {
		return &Refusal{Dock: opts.Dock, Socket: path, Cause: err}
	}
	if _, err := io.WriteString(conn, pingRequest); err != nil {
		return &Refusal{Dock: opts.Dock, Socket: path, Cause: err}
	}
	line, err := bufio.NewReader(conn).ReadString('\n')
	if err != nil {
		return &Refusal{Dock: opts.Dock, Socket: path, Cause: err}
	}
	answer := strings.TrimSpace(line)
	var pong struct {
		OK    bool   `json:"ok"`
		Pong  bool   `json:"pong"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal([]byte(answer), &pong); err != nil {
		return &Refusal{Dock: opts.Dock, Socket: path, Cause: fmt.Errorf("dock answer is not a ping response: %v", err)}
	}
	if !pong.OK || !pong.Pong {
		detail := "dock answered without a pong"
		if strings.TrimSpace(pong.Error) != "" {
			detail = "dock answered with an error: " + strings.TrimSpace(pong.Error)
		}
		return &Refusal{Dock: opts.Dock, Socket: path, Cause: fmt.Errorf("%s", detail)}
	}
	return nil
}
