// Package gapdoc reads the data documents of a GAP file.
//
// GAP source is YAML 1.2. A GAP file holds one instruction document
// (address, pattern, weight, composition, metadata) and may carry data
// documents after it, separated by ---. Each data document names its type
// with a top-level kind key and carries its payload under one field, for
// example kind: aep.caw.mount_policy with the CAW policy under policy.
//
// Extract finds that data document and returns its payload as plain YAML, so
// the caller decodes it with the same strict decoder it uses for a YAML file.
// A GAP policy and its YAML twin therefore decide alike.
package gapdoc

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"strings"

	"gopkg.in/yaml.v3"
)

// Kinds CAW reads.
const (
	KindCawPolicy       = "aep.caw.mount_policy"
	KindCawServerConfig = "aep.caw.server_config"
)

// Extract returns the payload field of the data document of the given kind.
//
// isGAP is false when no document in b carries a top-level kind key, which
// means b is a plain YAML file and the caller keeps it as it is. When several
// documents carry the kind, name picks the one whose name key matches. An
// empty name picks the only one and refuses a choice between several.
func Extract(b []byte, kind, field, name string) (payload []byte, isGAP bool, err error) {
	dec := yaml.NewDecoder(bytes.NewReader(b))
	var matches []*yaml.Node
	sawKind := false
	for {
		var doc yaml.Node
		if err := dec.Decode(&doc); err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return nil, false, fmt.Errorf("parse GAP document: %w", err)
		}
		root := mappingRoot(&doc)
		if root == nil {
			continue
		}
		k, ok := scalarValue(root, "kind")
		if !ok {
			continue
		}
		sawKind = true
		if k == kind {
			matches = append(matches, root)
		}
	}
	if !sawKind {
		return nil, false, nil
	}
	chosen, err := pick(matches, kind, name)
	if err != nil {
		return nil, true, err
	}
	body := mappingValue(chosen, field)
	if body == nil {
		return nil, true, fmt.Errorf("GAP %s document has no %s field", kind, field)
	}
	out, err := yaml.Marshal(body)
	if err != nil {
		return nil, true, fmt.Errorf("encode GAP %s payload: %w", kind, err)
	}
	return out, true, nil
}

func pick(matches []*yaml.Node, kind, name string) (*yaml.Node, error) {
	name = strings.TrimSpace(name)
	if name != "" {
		var named []*yaml.Node
		for _, m := range matches {
			if v, ok := scalarValue(m, "name"); ok && v == name {
				named = append(named, m)
			}
		}
		if len(named) == 1 {
			return named[0], nil
		}
		if len(named) > 1 {
			return nil, fmt.Errorf("GAP source has %d %s documents named %q, want one", len(named), kind, name)
		}
		if len(matches) == 1 {
			if _, hasName := scalarValue(matches[0], "name"); !hasName {
				return matches[0], nil
			}
		}
		return nil, fmt.Errorf("GAP source has no %s document named %q", kind, name)
	}
	switch len(matches) {
	case 1:
		return matches[0], nil
	case 0:
		return nil, fmt.Errorf("GAP source has no %s document", kind)
	default:
		return nil, fmt.Errorf("GAP source has %d %s documents and no name picks one", len(matches), kind)
	}
}

func mappingRoot(doc *yaml.Node) *yaml.Node {
	n := doc
	if n.Kind == yaml.DocumentNode && len(n.Content) == 1 {
		n = n.Content[0]
	}
	if n.Kind != yaml.MappingNode {
		return nil
	}
	return n
}

func mappingValue(m *yaml.Node, key string) *yaml.Node {
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			return m.Content[i+1]
		}
	}
	return nil
}

func scalarValue(m *yaml.Node, key string) (string, bool) {
	v := mappingValue(m, key)
	if v == nil || v.Kind != yaml.ScalarNode {
		return "", false
	}
	return strings.TrimSpace(v.Value), true
}
