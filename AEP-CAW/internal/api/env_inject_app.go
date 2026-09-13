package api

import (
	"context"
	"log/slog"

	"github.com/nla-aep/aep-caw-framework/internal/policy"
)

func (a *App) mergeEnvInjectForSession(ctx context.Context, sessionID string, pol *policy.Engine) map[string]string {
	result := mergeEnvInject(a.cfg, pol)
	if a.secretManager != nil && sessionID != "" {
		injections, err := a.secretManager.GetInjections(ctx, sessionID)
		if err != nil {
			slog.Warn("secret injection failed", "session", sessionID, "error", err)
		} else {
			for k, v := range injections {
				result[k] = v
			}
		}
	}
	return result
}