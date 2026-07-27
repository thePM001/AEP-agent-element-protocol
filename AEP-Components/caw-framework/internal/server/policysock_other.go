//go:build !darwin

package server

import (
	"github.com/nla-aep/aep-caw-framework/internal/config"
	"github.com/nla-aep/aep-caw-framework/internal/policy"
)

// startPolicySocket is a no-op on non-darwin platforms.
// The policy socket server is only available on macOS for system extension IPC.
func (s *Server) startPolicySocket(_ *config.Config, _ *policy.Engine) {}
