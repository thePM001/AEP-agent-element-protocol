package azurekv

import (
	secrets "github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/proxy/secrets"
)

// Config configures the Azure Key Vault provider.
type Config struct {
	secrets.ProviderConfigMarker
	VaultURL string
}

func (Config) TypeName() string { return "azure-kv" }

var (
	_ secrets.ProviderConfig = Config{}
	_ secrets.SecretProvider = (*Provider)(nil)
)
