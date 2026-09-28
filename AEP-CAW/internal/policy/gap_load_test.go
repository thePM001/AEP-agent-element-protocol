package policy

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const gapInstruction = `address:
  domain: dev.aep.caw
  id: twin.v1
pattern: |
  Policy twin written as GAP.
weight: 1.0
composition:
  type: atomic
metadata:
  wrap: caw
`

// gapTwin wraps a YAML policy as the policy block of a GAP mount policy document.
func gapTwin(name string, yamlPolicy []byte) []byte {
	var b strings.Builder
	b.WriteString(gapInstruction)
	b.WriteString("---\nkind: aep.caw.mount_policy\nname: " + name + "\npolicy:\n")
	for _, line := range strings.Split(strings.TrimRight(string(yamlPolicy), "\n"), "\n") {
		if line == "" {
			b.WriteString("\n")
			continue
		}
		b.WriteString("  " + line + "\n")
	}
	return []byte(b.String())
}

func shippedPolicy(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "configs", "policies", "agent-default.yaml"))
	if err != nil {
		t.Fatalf("read shipped policy: %v", err)
	}
	return b
}

func TestGAPPolicyDecodesLikeItsYAMLTwin(t *testing.T) {
	yamlBytes := shippedPolicy(t)
	fromYAML, err := LoadFromBytes(yamlBytes)
	if err != nil {
		t.Fatalf("YAML twin: %v", err)
	}
	fromGAP, err := LoadFromBytes(gapTwin("agent-default", yamlBytes))
	if err != nil {
		t.Fatalf("GAP twin: %v", err)
	}
	if !reflect.DeepEqual(fromYAML, fromGAP) {
		t.Fatal("GAP twin decoded to a different policy than the YAML twin")
	}
}

func TestResolvePolicyPathFindsAGAPPolicy(t *testing.T) {
	dir := t.TempDir()
	want := filepath.Join(dir, "agent-default.gap")
	if err := os.WriteFile(want, gapTwin("agent-default", shippedPolicy(t)), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := ResolvePolicyPath(dir, "agent-default")
	if err != nil || got != want {
		t.Fatalf("ResolvePolicyPath = %q, %v, want %q", got, err, want)
	}
	if _, err := LoadFromFile(got); err != nil {
		t.Fatalf("LoadFromFile(.gap): %v", err)
	}
}

func TestResolvePolicyPathPrefersYAMLOverGAP(t *testing.T) {
	dir := t.TempDir()
	y := filepath.Join(dir, "p.yaml")
	if err := os.WriteFile(y, shippedPolicy(t), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "p.gap"), []byte("not read"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got, err := ResolvePolicyPath(dir, "p"); err != nil || got != y {
		t.Fatalf("ResolvePolicyPath = %q, %v, want the YAML file", got, err)
	}
}

func TestGAPPolicyKeepsTheStrictFieldCheck(t *testing.T) {
	src := gapTwin("x", []byte("version: 1\nname: x\nnot_a_policy_field: true\n"))
	if _, err := LoadFromBytes(src); err == nil {
		t.Fatal("GAP policy with an unknown field = nil error, want the strict decoder refusal")
	}
}

func TestGAPFileWithSeveralPoliciesIsPickedByName(t *testing.T) {
	a := gapTwin("first", []byte("version: 1\nname: first\n"))
	b := "---\nkind: aep.caw.mount_policy\nname: second\npolicy:\n  version: 1\n  name: second\n"
	src := append(a, []byte(b)...)
	p, err := LoadFromBytesNamed(src, "second")
	if err != nil || p.Name != "second" {
		t.Fatalf("LoadFromBytesNamed(second) = %v, %v", p, err)
	}
	if _, err := LoadFromBytes(src); err == nil {
		t.Fatal("two GAP policies and no name = nil error, want a refusal")
	}
}
