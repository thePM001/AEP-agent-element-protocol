package gcpsm

import (
	secrets "github.com/nla-aep/aep-caw-framework/internal/proxy/secrets"
)

// Config configures the GCP Secret Manager provider.
type Config struct {
	secrets.ProviderConfigMarker
	ProjectID string
}

func (Config) TypeName() string { return "gcp-sm" }

var (
	_ secrets.ProviderConfig = Config{}
	_ secrets.SecretProvider = (*Provider)(nil)
)
