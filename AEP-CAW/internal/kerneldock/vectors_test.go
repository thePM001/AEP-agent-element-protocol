package kerneldock

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// vectorDir is the language neutral conformance vector folder of the AEP tree.
// The Rust kernel is normative; this package runs the suites it implements.
var vectorDir = filepath.Join("..", "..", "..", "AEP-Components", "conformance", "vectors", "v1")

type vectorFile struct {
	Format        string `json:"format"`
	FormatVersion int    `json:"format_version"`
	Normative     string `json:"normative"`
	Suite         string `json:"suite"`
	Cases         []struct {
		ID     string          `json:"id"`
		Input  json.RawMessage `json:"input"`
		Expect json.RawMessage `json:"expect"`
	} `json:"cases"`
}

func loadVectors(t *testing.T, suite string) vectorFile {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(vectorDir, suite+".json")) //nolint:gosec // the fixed vector folder of this source tree
	if err != nil {
		t.Fatalf("read %s vectors: %v", suite, err)
	}
	var f vectorFile
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("parse %s vectors: %v", suite, err)
	}
	if f.Format != "aep-conformance-vectors" || f.FormatVersion != 1 || f.Normative != "rust" || f.Suite != suite {
		t.Fatalf("%s: unexpected header %q v%d normative=%q suite=%q", suite, f.Format, f.FormatVersion, f.Normative, f.Suite)
	}
	if len(f.Cases) == 0 {
		t.Fatalf("%s: no cases", suite)
	}
	return f
}

func TestVectorsDockSocket(t *testing.T) {
	f := loadVectors(t, "dock-socket")
	for _, c := range f.Cases {
		var in struct {
			Port string `json:"port"`
		}
		var want struct {
			Suffix string `json:"suffix"`
			Error  string `json:"error"`
		}
		if err := json.Unmarshal(c.Input, &in); err != nil {
			t.Fatalf("%s: input: %v", c.ID, err)
		}
		if err := json.Unmarshal(c.Expect, &want); err != nil {
			t.Fatalf("%s: expect: %v", c.ID, err)
		}
		path, err := SocketPath("/aep-socket-base", in.Port)
		switch {
		case want.Error == "unknown_dock":
			if err == nil {
				t.Errorf("%s: port %q bound %s, want unknown_dock", c.ID, in.Port, path)
			}
			if ValidateDock(in.Port) == nil {
				t.Errorf("%s: ValidateDock accepted %q", c.ID, in.Port)
			}
		case want.Suffix != "":
			if err != nil {
				t.Errorf("%s: port %q: %v", c.ID, in.Port, err)
				continue
			}
			if got := filepath.Base(path); got != want.Suffix || filepath.Dir(path) != "/aep-socket-base" {
				t.Errorf("%s: port %q bound %s, want suffix %s", c.ID, in.Port, path, want.Suffix)
			}
		default:
			t.Fatalf("%s: expect names neither suffix nor error", c.ID)
		}
	}
}

func TestVectorsDockAnswer(t *testing.T) {
	f := loadVectors(t, "dock-answer")
	for _, c := range f.Cases {
		var in struct {
			Line string `json:"line"`
		}
		var want struct {
			Verdict Verdict `json:"verdict"`
		}
		if err := json.Unmarshal(c.Input, &in); err != nil {
			t.Fatalf("%s: input: %v", c.ID, err)
		}
		if err := json.Unmarshal(c.Expect, &want); err != nil || want.Verdict == "" {
			t.Fatalf("%s: expect has no verdict: %v", c.ID, err)
		}
		if got := ReadAnswer([]byte(in.Line)); got != want.Verdict {
			t.Errorf("%s: %s read as %s, want %s", c.ID, in.Line, got, want.Verdict)
		}
	}
}
