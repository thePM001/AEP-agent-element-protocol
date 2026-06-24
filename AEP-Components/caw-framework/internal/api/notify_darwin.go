//go:build darwin

package api

import "github.com/nla-aep/aep-caw-framework/internal/platform/darwin"

func notifySessionRegistered() {
	darwin.NotifySessionRegistered()
}
