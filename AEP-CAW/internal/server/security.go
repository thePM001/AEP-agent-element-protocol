package server

import (
	"fmt"
	"log/slog"

	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/capabilities"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/config"
)

// detectSecurityCapabilities is a seam for tests; the probes read kernel facts.
var detectSecurityCapabilities = capabilities.DetectSecurityCapabilities

// securityModeRequested reports whether the config asks the server to hold a
// security mode: security.strict or security.minimum_mode. Only then does
// startup run the capability probes, which fork helper processes.
func securityModeRequested(cfg *config.Config) bool {
	return cfg != nil && (cfg.Security.Strict || cfg.Security.MinimumMode != "")
}

// DetectAndValidateSecurityMode detects security capabilities and selects the appropriate mode.
// Returns the selected mode, detected capabilities, and any error.
// Server startup calls it whenever security.strict or security.minimum_mode is
// set and refuses to start on its error (CAWA-12).
func DetectAndValidateSecurityMode(cfg *config.Config) (string, *capabilities.SecurityCapabilities, error) {
	// Detect available security capabilities
	caps := detectSecurityCapabilities()

	// Determine effective mode
	var mode string
	if cfg != nil && cfg.Security.Mode != "" && cfg.Security.Mode != "auto" {
		mode = cfg.Security.Mode
	} else {
		mode = caps.SelectMode()
	}

	// Validate strict mode requirements
	if cfg != nil && cfg.Security.Strict {
		if err := capabilities.ValidateStrictMode(mode, caps); err != nil {
			return "", caps, fmt.Errorf("strict mode validation failed: %w", err)
		}
		// A layer the config switches on must exist on this kernel. Without
		// this check the wrapper skips Landlock and the session skips the FUSE
		// mount without an error.
		if cfg.Landlock.Enabled && !caps.Landlock {
			return "", caps, fmt.Errorf("strict mode validation failed: landlock.enabled is true but Landlock is unavailable")
		}
		if cfg.Sandbox.FUSE.Enabled && !caps.FUSE {
			return "", caps, fmt.Errorf("strict mode validation failed: sandbox.fuse.enabled is true but FUSE is unavailable")
		}
	}

	// Validate minimum mode requirements
	if cfg != nil && cfg.Security.MinimumMode != "" {
		if err := capabilities.ValidateMinimumMode(mode, cfg.Security.MinimumMode); err != nil {
			return "", caps, fmt.Errorf("minimum mode validation failed: %w", err)
		}
	}

	// Log degraded mode warnings
	if cfg != nil && cfg.Security.WarnDegraded && mode != capabilities.ModeFull {
		slog.Warn("running in degraded security mode",
			"mode", mode,
			"description", capabilities.ModeDescriptionWithCaps(mode, caps),
			"seccomp", caps.Seccomp,
			"landlock", caps.Landlock,
			"landlock_abi", caps.LandlockABI,
			"ebpf", caps.EBPF,
			"fuse", caps.FUSE,
			"capabilities_active", caps.CapabilitiesActive,
		)
	}

	return mode, caps, nil
}

// LogSecurityCapabilities logs the detected security capabilities at startup.
func LogSecurityCapabilities(caps *capabilities.SecurityCapabilities, mode string) {
	slog.Info("security capabilities detected",
		"mode", mode,
		"description", capabilities.ModeDescriptionWithCaps(mode, caps),
		"seccomp", caps.Seccomp,
		"seccomp_basic", caps.SeccompBasic,
		"landlock", caps.Landlock,
		"landlock_abi", caps.LandlockABI,
		"landlock_network", caps.LandlockNetwork,
		"ebpf", caps.EBPF,
		"fuse", caps.FUSE,
		// "capabilities" is the mechanism flag (kept for log-field
		// backward compatibility) - always true on Linux. The
		// behavioural "is this process actually running with a reduced
		// capability set" signal is logged separately as
		// "capabilities_active" so operators can distinguish the two
		// after #198 split them.
		"capabilities", caps.Capabilities,
		"capabilities_active", caps.CapabilitiesActive,
	)
}
