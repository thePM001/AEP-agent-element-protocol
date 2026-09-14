//go:build !darwin || !cgo

package api

import "github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/policy"

func compileDarwinSandboxProfile(cfg *macSandboxWrapperConfig, engine *policy.Engine, workspace string) bool {
	return false
}
