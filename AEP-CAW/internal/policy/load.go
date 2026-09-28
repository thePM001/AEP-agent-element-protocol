package policy

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/gapdoc"
	"gopkg.in/yaml.v3"
)

func LoadFromFile(path string) (*Policy, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read policy: %w", err)
	}
	return LoadFromBytesNamed(b, policyNameFromPath(path))
}

// LoadFromBytes parses and validates a policy from raw YAML or GAP bytes.
func LoadFromBytes(b []byte) (*Policy, error) {
	return LoadFromBytesNamed(b, "")
}

// LoadFromBytesNamed parses and validates a policy from raw YAML or GAP bytes.
// A GAP file carries the policy under policy in a kind: aep.caw.mount_policy
// document. name picks that document when the file holds several. The payload
// is decoded with the same strict decoder as a YAML policy file.
func LoadFromBytesNamed(b []byte, name string) (*Policy, error) {
	payload, isGAP, err := gapdoc.Extract(b, gapdoc.KindCawPolicy, "policy", name)
	if err != nil {
		return nil, fmt.Errorf("parse policy: %w", err)
	}
	if isGAP {
		b = payload
	}
	dec := yaml.NewDecoder(bytes.NewReader(b))
	dec.KnownFields(true)
	var p Policy
	if err := dec.Decode(&p); err != nil {
		return nil, fmt.Errorf("parse policy: %w", err)
	}
	if err := p.Validate(); err != nil {
		return nil, fmt.Errorf("validate policy: %w", err)
	}
	return &p, nil
}

func ResolvePolicyPath(dir, name string) (string, error) {
	if dir == "" {
		return "", fmt.Errorf("policy dir is empty")
	}
	if !nameRe.MatchString(name) {
		return "", fmt.Errorf("invalid policy name")
	}
	try := []string{
		filepath.Join(dir, name+".yaml"),
		filepath.Join(dir, name+".yml"),
		filepath.Join(dir, name+".gap"),
		filepath.Join(dir, name),
	}
	for _, p := range try {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("policy %q not found in %q", name, dir)
}

// policyNameFromPath is the file stem that picks a GAP policy document.
func policyNameFromPath(path string) string {
	base := filepath.Base(path)
	return strings.TrimSuffix(base, filepath.Ext(base))
}
