//go:build darwin

package api

import "github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/platform/darwin"

func notifySessionRegistered() {
	darwin.NotifySessionRegistered()
}
