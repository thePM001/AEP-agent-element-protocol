//go:build !linux

package api

import (
	"log/slog"
	"net"
	"sync"
)

// noPeerResolver is the resolver on hosts without procfs. It cannot tell a
// session process from an operator process, so it reports none. On these
// hosts the policy network rule that denies the server addresses to sessions
// and the API credential carry the protection.
type noPeerResolver struct{}

var noPeerResolverWarn sync.Once

func defaultPeerResolver() peerResolver {
	noPeerResolverWarn.Do(func() {
		slog.Warn("control api: the session peer check needs procfs and is off on this platform; the network rule that denies the server addresses to sessions still applies")
	})
	return noPeerResolver{}
}

func (noPeerResolver) classify(_, _ net.Addr, _ sessionView) (peerClass, error) {
	return peerClass{}, nil
}

func (noPeerResolver) classifyPID(int, sessionView) (peerClass, error) {
	return peerClass{}, nil
}
