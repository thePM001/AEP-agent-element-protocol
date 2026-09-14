//go:build !darwin

package server

import (
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/config"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/policy"
)

// startPolicySocket is a no-op on non-darwin platforms.
// The policy socket server is only available on macOS for system extension IPC.
func (s *Server) startPolicySocket(_ *config.Config, _ *policy.Engine) {}
