//go:build !linux
// +build !linux

package netmonitor

import (
	"errors"

	"github.com/nla-aep/aep-caw-framework/internal/approvals"
	dbevents "github.com/nla-aep/aep-caw-framework/internal/db/events"
	"github.com/nla-aep/aep-caw-framework/internal/policy"
	"github.com/nla-aep/aep-caw-framework/internal/session"
)

type TransparentTCP struct{}

func StartTransparentTCP(listenAddr string, sessionID string, sess *session.Session, dnsCache *DNSCache, engine *policy.Engine, approvalsMgr *approvals.Manager, emit Emitter, dbBypass ...*dbevents.BypassEmitter) (*TransparentTCP, int, error) {
	return nil, 0, errors.New("transparent TCP is only supported on Linux")
}

func (t *TransparentTCP) SetDBBypassEmitter(em *dbevents.BypassEmitter) {}

func (t *TransparentTCP) SetTorGateway(pol TorGatewayPolicy, upstream string, socksPorts []int) {}

func (t *TransparentTCP) Close() error { return nil }
