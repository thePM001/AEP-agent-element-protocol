package gapdoc

import (
	"strings"
	"testing"
)

const instruction = `address:
  domain: dev.aep.caw
  id: test.v1
pattern: |
  Test policy written as GAP.
weight: 1.0
composition:
  type: atomic
metadata:
  wrap: caw
`

func TestExtractLeavesPlainYAMLAlone(t *testing.T) {
	_, isGAP, err := Extract([]byte("version: 1\nname: plain\n"), KindCawPolicy, "policy", "")
	if err != nil || isGAP {
		t.Fatalf("plain YAML: isGAP=%v err=%v, want plain and no error", isGAP, err)
	}
}

func TestExtractReturnsTheOnlyPolicyPayload(t *testing.T) {
	src := instruction + "---\nkind: aep.caw.mount_policy\nname: one\npolicy:\n  version: 1\n  name: one\n"
	payload, isGAP, err := Extract([]byte(src), KindCawPolicy, "policy", "")
	if err != nil || !isGAP {
		t.Fatalf("Extract: isGAP=%v err=%v", isGAP, err)
	}
	if !strings.Contains(string(payload), "name: one") || strings.Contains(string(payload), "kind:") {
		t.Fatalf("payload = %q, want only the policy block", payload)
	}
}

func TestExtractPicksByName(t *testing.T) {
	src := instruction +
		"---\nkind: aep.caw.mount_policy\nname: first\npolicy:\n  version: 1\n  name: first\n" +
		"---\nkind: aep.caw.mount_policy\nname: second\npolicy:\n  version: 1\n  name: second\n"
	payload, _, err := Extract([]byte(src), KindCawPolicy, "policy", "second")
	if err != nil || !strings.Contains(string(payload), "name: second") {
		t.Fatalf("Extract by name = %q err=%v, want the second policy", payload, err)
	}
	if _, _, err := Extract([]byte(src), KindCawPolicy, "policy", ""); err == nil {
		t.Fatal("two policies and no name = nil error, want a refusal")
	}
	if _, _, err := Extract([]byte(src), KindCawPolicy, "policy", "third"); err == nil {
		t.Fatal("unknown name = nil error, want a refusal")
	}
}

func TestExtractRefusesGAPWithoutTheKind(t *testing.T) {
	src := instruction + "---\nkind: aep.caw.profile\nprofile_id: x\n"
	if _, isGAP, err := Extract([]byte(src), KindCawPolicy, "policy", ""); err == nil || !isGAP {
		t.Fatalf("GAP without a policy document: isGAP=%v err=%v, want GAP and a refusal", isGAP, err)
	}
}

func TestExtractRefusesAMissingPayloadField(t *testing.T) {
	src := instruction + "---\nkind: aep.caw.mount_policy\nname: x\n"
	if _, _, err := Extract([]byte(src), KindCawPolicy, "policy", ""); err == nil {
		t.Fatal("policy document without policy field = nil error, want a refusal")
	}
}
