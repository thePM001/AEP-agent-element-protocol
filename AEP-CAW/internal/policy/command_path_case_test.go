package policy

import (
	"strings"
	"testing"

	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/pkg/types"
)

// withCommandPathCaseFold compiles engines in the test as if the host
// filesystem were case-sensitive (fold=false, Linux) or case-insensitive
// (fold=true, Windows and default macOS).
func withCommandPathCaseFold(t *testing.T, fold bool) {
	t.Helper()
	orig := foldCommandPathCase
	t.Cleanup(func() { foldCommandPathCase = orig })
	foldCommandPathCase = fold
}

func fullPathCasePolicy() *Policy {
	return &Policy{
		Version: 1,
		Name:    "full-path-case",
		CommandRules: []CommandRule{
			{Name: "allow-git", Commands: []string{"/usr/bin/git"}, Decision: "allow"},
			{Name: "allow-tool-glob", Commands: []string{"/opt/*/tool"}, Decision: "allow"},
			{Name: "deny-upper-sh", Commands: []string{"/BIN/SH"}, Decision: "deny"},
		},
	}
}

// assertCaseDecision checks dec against want. An empty wantRule means the
// command must fall through to a default-deny rule, not any named rule.
func assertCaseDecision(t *testing.T, check, command string, dec Decision, want types.Decision, wantRule string) {
	t.Helper()
	if dec.PolicyDecision != want {
		t.Errorf("%s(%q) = %s (rule=%s), want %s", check, command, dec.PolicyDecision, dec.Rule, want)
		return
	}
	if wantRule == "" {
		if !strings.HasPrefix(dec.Rule, "default-deny") {
			t.Errorf("%s(%q) matched rule %q, want a default-deny fall-through", check, command, dec.Rule)
		}
		return
	}
	if dec.Rule != wantRule {
		t.Errorf("%s(%q) matched rule %q, want %q", check, command, dec.Rule, wantRule)
	}
}

func TestCommandPathsCaseInsensitive_PerGOOS(t *testing.T) {
	cases := map[string]bool{
		"linux":   false,
		"freebsd": false,
		"android": false,
		"windows": true,
		"darwin":  true,
	}
	for goos, want := range cases {
		if got := commandPathsCaseInsensitive(goos); got != want {
			t.Errorf("commandPathsCaseInsensitive(%q) = %v, want %v", goos, got, want)
		}
	}
}

func TestEngine_FullPathCommandRule_CaseSensitiveOnLinux(t *testing.T) {
	withCommandPathCaseFold(t, false)
	e, err := NewEngine(fullPathCasePolicy(), false, true)
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name     string
		command  string
		decision types.Decision
		rule     string
	}{
		{"exact full path allowed", "/usr/bin/git", types.DecisionAllow, "allow-git"},
		{"upper case full path not admitted by allow", "/USR/BIN/GIT", types.DecisionDeny, ""},
		{"mixed case full path not admitted by allow", "/usr/bin/Git", types.DecisionDeny, ""},
		{"exact path glob allowed", "/opt/acme/tool", types.DecisionAllow, "allow-tool-glob"},
		{"upper case path glob not admitted by allow", "/OPT/ACME/TOOL", types.DecisionDeny, ""},
		{"upper case rule matches exact spelling", "/BIN/SH", types.DecisionDeny, "deny-upper-sh"},
	}
	for _, tc := range tests {
		t.Run("CheckCommand/"+tc.name, func(t *testing.T) {
			assertCaseDecision(t, "CheckCommand", tc.command, e.CheckCommand(tc.command, nil), tc.decision, tc.rule)
		})
		t.Run("CheckExecve/"+tc.name, func(t *testing.T) {
			assertCaseDecision(t, "CheckExecve", tc.command, e.CheckExecve(tc.command, []string{tc.command}, 0), tc.decision, tc.rule)
		})
	}

	// A lower case /bin/sh is a different file on Linux, so the /BIN/SH deny
	// rule must not claim it.
	if dec := e.CheckCommand("/bin/sh", nil); dec.Rule == "deny-upper-sh" {
		t.Errorf("CheckCommand(/bin/sh) matched deny-upper-sh on a case-sensitive filesystem")
	}
	if dec := e.CheckExecve("/bin/sh", []string{"/bin/sh"}, 0); dec.Rule == "deny-upper-sh" {
		t.Errorf("CheckExecve(/bin/sh) matched deny-upper-sh on a case-sensitive filesystem")
	}
}

func TestEngine_FullPathCommandRule_CaseInsensitiveWhenFilesystemFolds(t *testing.T) {
	withCommandPathCaseFold(t, true)
	e, err := NewEngine(fullPathCasePolicy(), false, true)
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name     string
		command  string
		decision types.Decision
		rule     string
	}{
		{"exact full path allowed", "/usr/bin/git", types.DecisionAllow, "allow-git"},
		{"upper case full path is the same file", "/USR/BIN/GIT", types.DecisionAllow, "allow-git"},
		{"upper case path glob is the same file", "/OPT/ACME/TOOL", types.DecisionAllow, "allow-tool-glob"},
		{"lower case spelling hits upper case deny", "/bin/sh", types.DecisionDeny, "deny-upper-sh"},
	}
	for _, tc := range tests {
		t.Run("CheckCommand/"+tc.name, func(t *testing.T) {
			assertCaseDecision(t, "CheckCommand", tc.command, e.CheckCommand(tc.command, nil), tc.decision, tc.rule)
		})
		t.Run("CheckExecve/"+tc.name, func(t *testing.T) {
			assertCaseDecision(t, "CheckExecve", tc.command, e.CheckExecve(tc.command, []string{tc.command}, 0), tc.decision, tc.rule)
		})
	}
}

// Basename rules stay case-insensitive on every OS: a basename rule already
// matches that name in any directory, so folding case does not widen an allow
// beyond what the rule admits, and it keeps a deny on curl effective for CURL.
func TestEngine_BasenameCommandRule_StaysCaseInsensitiveOnLinux(t *testing.T) {
	withCommandPathCaseFold(t, false)
	p := &Policy{
		Version: 1,
		Name:    "basename-case",
		CommandRules: []CommandRule{
			{Name: "deny-curl", Commands: []string{"curl"}, Decision: "deny"},
			{Name: "allow-all", Commands: []string{"*"}, Decision: "allow"},
		},
	}
	e, err := NewEngine(p, false, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, cmd := range []string{"curl", "CURL", "/usr/bin/CuRl"} {
		if dec := e.CheckCommand(cmd, nil); dec.PolicyDecision != types.DecisionDeny || dec.Rule != "deny-curl" {
			t.Errorf("CheckCommand(%q) = %s (rule=%s), want deny (rule=deny-curl)", cmd, dec.PolicyDecision, dec.Rule)
		}
	}
}
