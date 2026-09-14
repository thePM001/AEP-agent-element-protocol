//go:build !linux

package api

import (
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/capabilities"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/config"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/policy"
)

// LandlockHook is a no-op on non-Linux platforms.
type LandlockHook struct{}

// CreateLandlockHook returns nil on non-Linux platforms.
func CreateLandlockHook(
	cfg *config.LandlockConfig,
	secCaps *capabilities.SecurityCapabilities,
	workspace string,
	pol *policy.Policy,
) *LandlockHook {
	return nil
}

// Apply is a no-op on non-Linux platforms.
func (h *LandlockHook) Apply() error {
	return nil
}
