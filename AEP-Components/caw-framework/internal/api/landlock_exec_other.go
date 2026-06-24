//go:build !linux

package api

import (
	"github.com/nla-aep/aep-caw-framework/internal/capabilities"
	"github.com/nla-aep/aep-caw-framework/internal/config"
	"github.com/nla-aep/aep-caw-framework/internal/policy"
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
