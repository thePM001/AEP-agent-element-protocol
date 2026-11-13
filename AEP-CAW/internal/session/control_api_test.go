package session

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"testing"
)

// AEP-CRV-030 (CAWB 02): a session must not take the filesystem root as its
// workspace, whether named directly, through parent segments or through a
// symlink, and a profile mount on the root is refused the same way.
func TestCreateRefusesRootWorkspace(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix root paths")
	}
	link := filepath.Join(t.TempDir(), "to-root")
	if err := os.Symlink("/", link); err != nil {
		t.Fatalf("symlink: %v", err)
	}
	for _, ws := range []string{"/", "//", "/tmp/..", link} {
		m := NewManager(10)
		if _, err := m.Create(ws, "default"); !errors.Is(err, ErrRootWorkspace) {
			t.Fatalf("Create(%q) error = %v, want ErrRootWorkspace", ws, err)
		}
		if m.Count() != 0 {
			t.Fatalf("Create(%q) left a session behind", ws)
		}
	}

	m := NewManager(10)
	mounts := []ResolvedMount{{Path: t.TempDir()}, {Path: link}}
	if _, err := m.CreateWithProfile("", "p", "default", mounts); !errors.Is(err, ErrRootWorkspace) {
		t.Fatalf("CreateWithProfile with a root mount error = %v, want ErrRootWorkspace", err)
	}

	if _, err := m.Create(t.TempDir(), "default"); err != nil {
		t.Fatalf("Create on a plain directory: %v", err)
	}
}

// AEP-CRV-030 (CAWB 01): every process the session starts is kept as a
// process root until no process carries it any more, so the control API can
// recognise the session processes after the command returned.
func TestProcessRootsRecordAndPrune(t *testing.T) {
	m := NewManager(10)
	s1, err := m.Create(t.TempDir(), "default")
	if err != nil {
		t.Fatal(err)
	}
	s2, err := m.Create(t.TempDir(), "default")
	if err != nil {
		t.Fatal(err)
	}

	unlock := s1.LockExec()
	s1.SetCurrentProcessPID(101)
	unlock() // the command returned: the current pid is cleared, the root is kept
	if got := s1.CurrentProcessPID(); got != 0 {
		t.Fatalf("CurrentProcessPID after unlock = %d", got)
	}
	s1.AddProcessRoot(102)
	s1.AddProcessRoot(0)
	s1.AddProcessRoot(-4)
	s2.SetCurrentProcessPID(201)

	got := s1.ProcessRoots()
	sort.Ints(got)
	if len(got) != 2 || got[0] != 101 || got[1] != 102 {
		t.Fatalf("ProcessRoots = %v, want [101 102]", got)
	}
	all := m.ProcessRoots()
	if all[101] != s1.ID || all[102] != s1.ID || all[201] != s2.ID || len(all) != 3 {
		t.Fatalf("Manager.ProcessRoots = %v", all)
	}

	s1.PruneProcessRoots(func(pid int) bool { return pid == 102 })
	if got := s1.ProcessRoots(); len(got) != 1 || got[0] != 102 {
		t.Fatalf("ProcessRoots after prune = %v, want [102]", got)
	}

	if !m.Destroy(s2.ID) {
		t.Fatal("destroy s2")
	}
	if _, ok := m.ProcessRoots()[201]; ok {
		t.Fatal("roots of a destroyed session must not be reported")
	}
}
