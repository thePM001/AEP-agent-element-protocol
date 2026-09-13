//go:build !darwin || !cgo

package api

import "github.com/nla-aep/aep-caw-framework/internal/policy"

func compileDarwinSandboxProfile(cfg *macSandboxWrapperConfig, engine *policy.Engine, workspace string) bool {
	return false
}
