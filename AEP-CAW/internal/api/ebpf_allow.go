package api

import (
	"fmt"
	"math/big"
	"net"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/miekg/dns"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/netmonitor/ebpf"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/policy"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/pkg/types"
)

var (
	resolveDomainWithTTL = resolveDomainTTL
	// ebpfResolverAddrs lists the name servers the wrapped command resolves
	// through. It is a seam for tests.
	ebpfResolverAddrs = systemResolverAddrs
)

// dnsPort is the port of the name servers the allow list opens when the
// policy names hosts by domain.
const dnsPort = 53

// ebpfAllowPlan is the content of the BPF allow and deny maps for one cgroup.
type ebpfAllowPlan struct {
	Allow      []ebpf.AllowKey
	AllowCIDRs []ebpf.AllowCIDR
	Deny       []ebpf.AllowKey
	DenyCIDRs  []ebpf.AllowCIDR
	// DefaultDeny arms the BPF default deny. It is off only when the policy
	// itself allows every destination on every port (a catch-all allow), so
	// the kernel answer then matches the policy answer.
	DefaultDeny bool
	// HasDomains reports whether the plan holds addresses resolved from
	// literal domains, so a DNS refresh can keep them current.
	HasDomains bool
	// TTLHint is the shortest DNS TTL seen, 0 when no domain resolved.
	TTLHint time.Duration
	// UnservedWildcards lists wildcard allow patterns. The kernel list holds
	// addresses, so a host that only such a pattern allows is refused.
	UnservedWildcards []string
	// Unresolved lists literal allow domains that resolved to no address.
	// They add nothing, so their hosts are refused.
	Unresolved []string
	// Resolvers lists the name servers opened on port 53.
	Resolvers []string
}

// ebpfPrefix is one address prefix of a network rule with its port. origin is
// the rank of the prefix under the engine's most-specific rule: for a policy
// prefix its own length, for a carved deny piece the length of the policy deny
// it came from. A higher origin wins. The loopback entry ranks below every
// policy rule with origin -1.
type ebpfPrefix struct {
	net    *net.IPNet
	port   uint16
	origin int
}

func (p ebpfPrefix) ones() int {
	ones, _ := p.net.Mask.Size()
	return ones
}

func (p ebpfPrefix) bits() int {
	_, bits := p.net.Mask.Size()
	return bits
}

func (p ebpfPrefix) key() string {
	return fmt.Sprintf("%s|%d", p.net.String(), p.port)
}

func newPrefix(ipnet *net.IPNet, port uint16) ebpfPrefix {
	ones, _ := ipnet.Mask.Size()
	return ebpfPrefix{net: ipnet, port: port, origin: ones}
}

func hostPrefix(ip net.IP, port uint16) (ebpfPrefix, bool) {
	if ip4 := ip.To4(); ip4 != nil {
		return newPrefix(&net.IPNet{IP: ip4, Mask: net.CIDRMask(32, 32)}, port), true
	}
	if ip16 := ip.To16(); ip16 != nil {
		return newPrefix(&net.IPNet{IP: ip16, Mask: net.CIDRMask(128, 128)}, port), true
	}
	return ebpfPrefix{}, false
}

func ruleCIDRPrefixes(cidrs []string, ports []uint16) []ebpfPrefix {
	var out []ebpfPrefix
	for _, c := range cidrs {
		_, ipnet, err := net.ParseCIDR(strings.TrimSpace(c))
		if err != nil || ipnet == nil {
			continue
		}
		if ip4 := ipnet.IP.To4(); ip4 != nil {
			ones, _ := ipnet.Mask.Size()
			ipnet = &net.IPNet{IP: ip4, Mask: net.CIDRMask(ones, 32)}
		}
		for _, port := range ports {
			out = append(out, newPrefix(ipnet, port))
		}
	}
	return out
}

func rulePorts(r policy.NetworkRule) []uint16 {
	if len(r.Ports) == 0 {
		return []uint16{0}
	}
	out := make([]uint16, 0, len(r.Ports))
	for _, p := range r.Ports {
		if p > 0 && p <= 65535 {
			out = append(out, uint16(p))
		}
	}
	return out
}

// subtractPrefix returns the prefixes of outer that do not hold inner. inner
// must lie strictly inside outer. The result holds one sibling prefix for
// every bit between the two prefix lengths, each carrying the origin of outer.
func subtractPrefix(outer, inner ebpfPrefix) []ebpfPrefix {
	bits := outer.bits()
	innerIP := new(big.Int).SetBytes(inner.net.IP.Mask(inner.net.Mask))
	var out []ebpfPrefix
	for l := outer.ones() + 1; l <= inner.ones(); l++ {
		// The sibling at depth l shares the first l-1 bits of inner and
		// flips bit l.
		sib := new(big.Int).Xor(innerIP, new(big.Int).Lsh(big.NewInt(1), uint(bits-l)))
		mask := net.CIDRMask(l, bits)
		ip := net.IP(sib.FillBytes(make([]byte, bits/8))).Mask(mask)
		out = append(out, ebpfPrefix{net: &net.IPNet{IP: ip, Mask: mask}, port: outer.port, origin: outer.origin})
	}
	return out
}

// overlaps reports whether two prefixes of one family share an address. Two
// prefixes that share an address are nested.
func overlaps(a, b ebpfPrefix) bool {
	if a.bits() != b.bits() {
		return false
	}
	return a.net.Contains(b.net.IP) || b.net.Contains(a.net.IP)
}

// reopened reports whether an allow that loses to the deny d shares an
// address with a on a port a does not name. Carving a out of d for every port
// would then let that allow open the address on its port, which the engine
// refuses.
func reopened(a, d ebpfPrefix, allAllows []ebpfPrefix) bool {
	for _, b := range allAllows {
		if b.origin <= d.origin && b.port != a.port && overlaps(a, b) {
			return true
		}
	}
	return false
}

// carveDenies removes from the deny prefixes every address that a carving
// prefix wins under the engine's most-specific rule: the carver must outrank
// the policy deny the address came from. The BPF program checks every deny
// before any allow, so a deny that the engine overrules has to leave the map.
//
// Ports: a carver on one port facing a deny on another port changes nothing.
// A carver on one port facing a deny on every port can only be carved out for
// every port, so the carve runs only while the BPF default deny refuses the
// other ports and no losing allow would open them. Otherwise the deny is kept
// and the kernel refuses more than the engine.
func carveDenies(denies, carvers, allAllows []ebpfPrefix, defaultDeny bool) []ebpfPrefix {
	out := denies
	for _, a := range carvers {
		next := make([]ebpfPrefix, 0, len(out))
		for _, d := range out {
			keep := a.origin <= d.origin || !overlaps(a, d) ||
				(a.port != 0 && d.port != 0 && a.port != d.port) ||
				(a.port != 0 && d.port == 0 && (!defaultDeny || reopened(a, d, allAllows)))
			switch {
			case keep:
				next = append(next, d)
			case a.ones() > d.ones():
				next = append(next, subtractPrefix(d, a)...)
			default:
				// The whole deny piece lies inside the carver.
			}
		}
		out = next
	}
	return out
}

func dedupPrefixes(in []ebpfPrefix) []ebpfPrefix {
	seen := make(map[string]struct{}, len(in))
	out := make([]ebpfPrefix, 0, len(in))
	for _, p := range in {
		k := p.key()
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, p)
	}
	return out
}

// splitPrefixes turns prefixes into BPF map entries. A full-length prefix on
// one port goes to the exact hash map. Every other prefix goes to the LPM
// trie, which also serves port 0 (any port): the exact map has no port 0
// fallback, so a host entry for any port belongs in the trie.
func splitPrefixes(in []ebpfPrefix) ([]ebpf.AllowKey, []ebpf.AllowCIDR) {
	var keys []ebpf.AllowKey
	var cidrs []ebpf.AllowCIDR
	for _, p := range in {
		ones, bits := p.ones(), p.bits()
		family := uint8(2)
		if bits == 128 {
			family = 10
		}
		if ones == bits && p.port != 0 {
			k := ebpf.AllowKey{Family: family, Dport: p.port}
			if family == 2 {
				copy(k.Addr[:4], p.net.IP.To4())
			} else {
				copy(k.Addr[:], p.net.IP.To16())
			}
			keys = append(keys, k)
			continue
		}
		c := ebpf.AllowCIDR{Family: family, PrefixLen: uint32(ones), Dport: p.port}
		if family == 2 {
			copy(c.Addr[:4], p.net.IP.To4())
		} else {
			copy(c.Addr[:], p.net.IP.To16())
		}
		cidrs = append(cidrs, c)
	}
	return keys, cidrs
}

// systemResolverAddrs reads the name servers of /etc/resolv.conf.
func systemResolverAddrs() []net.IP {
	conf, err := dns.ClientConfigFromFile("/etc/resolv.conf")
	if err != nil {
		return nil
	}
	var out []net.IP
	for _, s := range conf.Servers {
		if ip := net.ParseIP(strings.Trim(s, "[]")); ip != nil {
			out = append(out, ip)
		}
	}
	return out
}

// buildAllowedEndpoints converts the network rules of a policy into the BPF
// allow and deny maps of eBPF enforce mode (CAWA-16).
//
// The default deny stays armed for every policy that does not allow all
// destinations on all ports. Wildcard allow domains add no address, and
// neither do literal allow domains that do not resolve, so their hosts are
// refused. A port-only allow rule allows every address on its ports. Loopback
// is open on every port below every policy deny. When the policy names hosts
// by domain the system name servers are open on port 53, because no domain
// rule works without name resolution. Deny prefixes give way to strictly more
// specific allow prefixes, as the policy engine decides.
func buildAllowedEndpoints(p *policy.Engine, maxTTL time.Duration) ebpfAllowPlan {
	plan := ebpfAllowPlan{DefaultDeny: true}
	if p == nil {
		return plan
	}
	rules := p.NetworkRules()

	// Pre-resolve all literal domains in parallel so the loop below hits the cache.
	{
		seen := make(map[string]struct{})
		var domains []string
		for _, r := range rules {
			for _, d := range r.Domains {
				if strings.ContainsAny(d, "*?[") {
					continue
				}
				if _, ok := seen[d]; !ok {
					seen[d] = struct{}{}
					domains = append(domains, d)
				}
			}
		}
		if len(domains) > 1 {
			var wg sync.WaitGroup
			wg.Add(len(domains))
			for _, d := range domains {
				go func(domain string) {
					defer wg.Done()
					resolveDomainWithTTL(domain, maxTTL)
				}(d)
			}
			wg.Wait()
		}
	}

	var allows, denies []ebpfPrefix
	namesHosts := false
	unserved := map[string]struct{}{}
	unresolved := map[string]struct{}{}
	for _, r := range rules {
		isAllow := strings.EqualFold(r.Decision, string(types.DecisionAllow))
		isDeny := strings.EqualFold(r.Decision, string(types.DecisionDeny))
		if !isAllow && !isDeny {
			// The kernel cannot ask for an approval or run a redirect. The
			// default deny refuses the destinations of such rules.
			continue
		}
		ports := rulePorts(r)
		if isAllow && r.IsCatchAll() {
			if len(r.Ports) == 0 {
				plan.DefaultDeny = false
				continue
			}
			for _, port := range ports {
				allows = append(allows,
					newPrefix(&net.IPNet{IP: net.IPv4zero.To4(), Mask: net.CIDRMask(0, 32)}, port),
					newPrefix(&net.IPNet{IP: net.IPv6zero, Mask: net.CIDRMask(0, 128)}, port))
			}
			continue
		}
		for _, d := range r.Domains {
			if strings.ContainsAny(d, "*?[") {
				if isAllow {
					namesHosts = true
					unserved[d] = struct{}{}
				}
				continue
			}
			plan.HasDomains = true
			if isAllow {
				namesHosts = true
			}
			ips, ttl := resolveDomainWithTTL(d, maxTTL)
			if ttl > 0 && (plan.TTLHint == 0 || ttl < plan.TTLHint) {
				plan.TTLHint = ttl
			}
			if len(ips) == 0 && isAllow {
				unresolved[d] = struct{}{}
			}
			for _, ip := range ips {
				for _, port := range ports {
					hp, ok := hostPrefix(ip, port)
					if !ok {
						continue
					}
					if isAllow {
						allows = append(allows, hp)
					} else {
						denies = append(denies, hp)
					}
				}
			}
		}
		if isAllow {
			allows = append(allows, ruleCIDRPrefixes(r.CIDRs, ports)...)
		} else {
			denies = append(denies, ruleCIDRPrefixes(r.CIDRs, ports)...)
		}
	}

	// Name servers on port 53 when the policy names hosts by domain. A name
	// server ranks like a host rule, so it outranks every wider policy deny
	// and loses to a deny that names its address.
	var infra []ebpfPrefix
	if namesHosts {
		for _, ip := range ebpfResolverAddrs() {
			hp, ok := hostPrefix(ip, dnsPort)
			if !ok {
				continue
			}
			infra = append(infra, hp)
			plan.Resolvers = append(plan.Resolvers, ip.String())
		}
	}

	// Loopback on every port, below every policy deny.
	lo4, _ := hostPrefix(net.IPv4(127, 0, 0, 1), 0)
	lo6, _ := hostPrefix(net.IPv6loopback, 0)
	lo4.origin, lo6.origin = -1, -1

	allows = dedupPrefixes(allows)
	allEntries := dedupPrefixes(append(append(append([]ebpfPrefix{}, allows...), infra...), lo4, lo6))
	carvers := append(append([]ebpfPrefix{}, allows...), infra...)
	denies = dedupPrefixes(carveDenies(dedupPrefixes(denies), carvers, allEntries, plan.DefaultDeny))

	plan.Allow, plan.AllowCIDRs = splitPrefixes(allEntries)
	plan.Deny, plan.DenyCIDRs = splitPrefixes(denies)
	for d := range unserved {
		plan.UnservedWildcards = append(plan.UnservedWildcards, d)
	}
	for d := range unresolved {
		plan.Unresolved = append(plan.Unresolved, d)
	}
	sort.Strings(plan.UnservedWildcards)
	sort.Strings(plan.Unresolved)
	return plan
}
