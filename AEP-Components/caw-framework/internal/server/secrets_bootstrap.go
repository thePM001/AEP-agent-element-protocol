package server

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/nla-aep/aep-caw-framework/internal/config"
	secretspkg "github.com/nla-aep/aep-caw-framework/pkg/secrets"
)

func bootstrapSecretManager(cfg *config.Config) (*secretspkg.Manager, error) {
	if cfg == nil || len(cfg.Secrets.Inject) == 0 {
		return nil, nil
	}
	mgr := secretspkg.NewManager(cfg.Secrets, nil, nil)
	if cfg.Secrets.Providers.Vault != nil && cfg.Secrets.Providers.Vault.Enabled {
		provider, err := secretspkg.NewVaultProvider(*cfg.Secrets.Providers.Vault)
		if err != nil {
			return nil, fmt.Errorf("vault secrets provider: %w", err)
		}
		mgr.RegisterProvider(provider)
	}
	if cfg.Secrets.Providers.AWS != nil && cfg.Secrets.Providers.AWS.Enabled {
		provider, err := secretspkg.NewAWSProvider(context.Background(), *cfg.Secrets.Providers.AWS)
		if err != nil {
			return nil, fmt.Errorf("aws secrets provider: %w", err)
		}
		mgr.RegisterProvider(provider)
	}
	if len(mgr.ListProviders()) == 0 {
		return nil, fmt.Errorf("secrets.inject configured but no providers enabled")
	}
	if cfg.Secrets.CacheTTL == 0 {
		cfg.Secrets.CacheTTL = 5 * time.Minute
	}
	slog.Info("session secret injection enabled", "providers", mgr.ListProviders(), "injections", len(cfg.Secrets.Inject))
	return mgr, nil
}