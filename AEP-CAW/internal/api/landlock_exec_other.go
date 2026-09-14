//go:build !linux

package api

import (
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/capabilities"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/config"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/policy"
)

// MakeLandlockPostStartHook returns nil on non-Linux platforms.
func MakeLandlockPostStartHook(
	cfg *config.LandlockConfig,
	secCaps *capabilities.SecurityCapabilities,
	workspace string,
	pol *policy.Policy,
) postStartHook {
	return nil
}

// GetLandlockEnvVars returns nil on non-Linux platforms.
func GetLandlockEnvVars(cfg *config.LandlockConfig, workspace string, abi int) map[string]string {
	return nil
}
