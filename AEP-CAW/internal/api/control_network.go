package api

import (
	"net"
	"sort"
	"strconv"
	"strings"

	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/config"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/policy"
)

// The control API is closed to session processes in the policy as well
// (AEP-CRV-030, CAWB 01). Every policy a session runs under gets deny rules
// for the addresses the server listens on, so an active enforcement backend
// (eBPF, seccomp, ptrace, the network proxy) stops the connection before it
// reaches the control guard. The rules name each address exactly (/32 or
// /128), which is the most specific match the engine knows, and a deny wins a
// tie, so no allow rule of the session policy can open the server again.

const (
	controlPlaneRuleName = "aep-caw-control-api"
	controlPlaneMessage  = "the AEP-CAW control API is closed to session processes"
)

// interfaceAddrs is replaced in tests.
var interfaceAddrs = net.InterfaceAddrs

// controlPlaneListenAddrs returns the TCP addresses the server listens on.
func controlPlaneListenAddrs(cfg *config.Config) []string {
	if cfg == nil {
		return nil
	}
	addrs := []string{cfg.Server.HTTP.Addr}
	if cfg.Server.GRPC.Enabled {
		g := cfg.Server.GRPC.Addr
		if g == "" {
			g = "127.0.0.1:9090" // listenGRPC default
		}
		addrs = append(addrs, g)
	}
	if cfg.Development.PProf.Enabled {
		p := cfg.Development.PProf.Addr
		if p == "" {
			p = "localhost:6060"
		}
		addrs = append(addrs, p)
	}
	return addrs
}

// exactCIDR returns the single address network of ip.
func exactCIDR(ip net.IP) string {
	if v4 := ip.To4(); v4 != nil {
		return v4.String() + "/32"
	}
	return ip.String() + "/128"
}

// controlPlaneNetworkRules builds the deny rules for the listen addresses of
// cfg. A listener on every interface is denied on each local address and on
// the loopback names.
func controlPlaneNetworkRules(cfg *config.Config) []policy.NetworkRule {
	byPort := map[int]map[string]struct{}{}
	domainPorts := map[int]struct{}{}
	add := func(port int, ip net.IP) {
		if byPort[port] == nil {
			byPort[port] = map[string]struct{}{}
		}
		byPort[port][exactCIDR(ip)] = struct{}{}
	}
	for _, addr := range controlPlaneListenAddrs(cfg) {
		host, portStr, err := net.SplitHostPort(strings.TrimSpace(addr))
		if err != nil {
			continue
		}
		port, err := strconv.Atoi(portStr)
		if err != nil || port <= 0 {
			continue
		}
		ip := net.ParseIP(host)
		switch {
		case host == "" || (ip != nil && ip.IsUnspecified()):
			domainPorts[port] = struct{}{}
			add(port, net.IPv4(127, 0, 0, 1))
			add(port, net.IPv6loopback)
			if ifs, err := interfaceAddrs(); err == nil {
				for _, a := range ifs {
					if n, ok := a.(*net.IPNet); ok {
						add(port, n.IP)
					}
				}
			}
		case ip != nil:
			add(port, ip)
			if ip.IsLoopback() {
				domainPorts[port] = struct{}{}
			}
		case strings.EqualFold(host, "localhost"):
			domainPorts[port] = struct{}{}
			add(port, net.IPv4(127, 0, 0, 1))
			add(port, net.IPv6loopback)
		default:
			if ips, err := net.LookupIP(host); err == nil {
				for _, r := range ips {
					add(port, r)
				}
			}
		}
	}

	ports := make([]int, 0, len(byPort))
	for p := range byPort {
		ports = append(ports, p)
	}
	sort.Ints(ports)
	var rules []policy.NetworkRule
	for _, port := range ports {
		cidrs := make([]string, 0, len(byPort[port]))
		for c := range byPort[port] {
			cidrs = append(cidrs, c)
		}
		sort.Strings(cidrs)
		rules = append(rules, policy.NetworkRule{
			Name:     controlPlaneRuleName,
			CIDRs:    cidrs,
			Ports:    []int{port},
			Decision: "deny",
			Message:  controlPlaneMessage,
		})
		if _, ok := domainPorts[port]; ok {
			rules = append(rules, policy.NetworkRule{
				Name:     controlPlaneRuleName,
				Domains:  []string{"localhost"},
				Ports:    []int{port},
				Decision: "deny",
				Message:  controlPlaneMessage,
			})
		}
	}
	return rules
}

// controlPlaneUnixRules denies the control API unix socket to sessions.
func controlPlaneUnixRules(cfg *config.Config) []policy.UnixSocketRule {
	if cfg == nil || !cfg.Server.UnixSocket.Enabled || strings.TrimSpace(cfg.Server.UnixSocket.Path) == "" {
		return nil
	}
	return []policy.UnixSocketRule{{
		Name:       controlPlaneRuleName,
		Paths:      []string{cfg.Server.UnixSocket.Path},
		Operations: []string{"connect", "sendto"},
		Decision:   "deny",
		Message:    controlPlaneMessage,
	}}
}

// SealControlPlane seals p with the control API rules of this App's config.
// A nil App seals nothing: before the App exists no session runs.
func (a *App) SealControlPlane(p *policy.Policy) *policy.Policy {
	if a == nil {
		return p
	}
	return SealControlPlane(a.cfg, p)
}

// SealControlPlane returns a copy of p whose network and unix socket rules
// start with the deny rules for the control API of cfg. p itself is left
// unchanged, so a cached policy document can be sealed more than once.
func SealControlPlane(cfg *config.Config, p *policy.Policy) *policy.Policy {
	if p == nil {
		return nil
	}
	sealed := *p
	netRules := controlPlaneNetworkRules(cfg)
	sealed.NetworkRules = append(append(make([]policy.NetworkRule, 0, len(netRules)+len(p.NetworkRules)), netRules...), p.NetworkRules...)
	unixRules := controlPlaneUnixRules(cfg)
	sealed.UnixRules = append(append(make([]policy.UnixSocketRule, 0, len(unixRules)+len(p.UnixRules)), unixRules...), p.UnixRules...)
	return &sealed
}
