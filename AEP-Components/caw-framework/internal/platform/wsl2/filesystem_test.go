//go:build windows

package wsl2

import (
	"testing"
	"time"

	"github.com/nla-aep/aep-caw-framework/internal/platform"
)

func TestNewFilesystem(t *testing.T) {
	p := &Platform{distro: "Ubuntu"}
	fs := NewFilesystem(p)

	if fs == nil {
		t.Fatal("NewFilesystem() returned nil")
	}

	if fs.platform != p {
		t.Error("platform not set correctly")
	}

	if fs.implementation != "fuse3" {
		t.Errorf("implementation = %q, want fuse3", fs.implementation)
	}

	if fs.mounts == nil {
		t.Error("mounts map should be initialized")
	}
}

func TestFilesystem_Implementation(t *testing.T) {
	p := &Platform{distro: "Ubuntu"}
	fs := NewFilesystem(p)

	if got := fs.Implementation(); got != "fuse3" {
		t.Errorf("Implementation() = %q, want fuse3", got)
	}
}

func TestFilesystem_Available(t *testing.T) {
	p := &Platform{distro: "Ubuntu"}
	fs := &Filesystem{
		platform:  p,
		available: true,
		mounts:    make(map[string]*Mount),
	}

	if !fs.Available() {
		t.Error("Available() should return true when available is true")
	}

	fs.available = false
	if fs.Available() {
		t.Error("Available() should return false when available is false")
	}
}

func TestFilesystem_Mount_NotAvailable(t *testing.T) {
	p := &Platform{distro: "Ubuntu"}
	fs := &Filesystem{
		platform:  p,
		available: false,
		mounts:    make(map[string]*Mount),
	}

	cfg := platform.FSConfig{
		SourcePath: `C:\Users\test`,
		MountPoint: `C:\mnt\test`,
	}

	_, err := fs.Mount(cfg)
	if err == nil {
		t.Error("Mount() should error when FUSE not available")
	}
}

func TestFilesystem_Mount_AlreadyMounted(t *testing.T) {
	// This test can only run when WSL2 is actually available
	t.Skip("Requires real WSL2 environment")
}

func TestFilesystem_Mount_Success(t *testing.T) {
	// This test can only run when WSL2 is actually available
	t.Skip("Requires real WSL2 environment")
}

func TestFilesystem_Unmount_InvalidType(t *testing.T) {
	p := &Platform{distro: "Ubuntu"}
	fs := NewFilesystem(p)

	// Create a fake mount that's not the right type
	err := fs.Unmount(&fakeMount{})
	if err == nil {
		t.Error("Unmount() should error with invalid mount type")
	}
}

type fakeMount struct{}

func (f *fakeMount) Path() string            { return "" }
func (f *fakeMount) SourcePath() string      { return "" }
func (f *fakeMount) Stats() platform.FSStats { return platform.FSStats{} }
func (f *fakeMount) Close() error            { return nil }

func TestMount_Path(t *testing.T) {
	m := &Mount{
		winMount:   `C:\mnt\test`,
		mountPoint: "/mnt/c/mnt/test",
	}

	if got := m.Path(); got != `C:\mnt\test` {
		t.Errorf("Path() = %q, want C:\\mnt\\test", got)
	}
}

func TestMount_SourcePath(t *testing.T) {
	m := &Mount{
		winSource:  `C:\Users\test`,
		sourcePath: "/mnt/c/Users/test",
	}

	if got := m.SourcePath(); got != `C:\Users\test` {
		t.Errorf("SourcePath() = %q, want C:\\Users\\test", got)
	}
}

func TestMount_WSLPath(t *testing.T) {
	m := &Mount{
		mountPoint: "/mnt/c/mnt/test",
	}

	if got := m.WSLPath(); got != "/mnt/c/mnt/test" {
		t.Errorf("WSLPath() = %q, want /mnt/c/mnt/test", got)
	}
}

func TestMount_WSLSourcePath(t *testing.T) {
	m := &Mount{
		sourcePath: "/mnt/c/Users/test",
	}

	if got := m.WSLSourcePath(); got != "/mnt/c/Users/test" {
		t.Errorf("WSLSourcePath() = %q, want /mnt/c/Users/test", got)
	}
}

func TestMount_Stats(t *testing.T) {
	mountTime := time.Now()
	m := &Mount{
		mountedAt: mountTime,
	}
	stats := m.Stats()

	if stats.MountedAt != mountTime {
		t.Errorf("MountedAt = %v, want %v", stats.MountedAt, mountTime)
	}
}

func TestMount_Close_NilFilesystem(t *testing.T) {
	m := &Mount{}

	// Should not error when filesystem is nil
	if err := m.Close(); err != nil {
		t.Errorf("Close() error = %v", err)
	}
}

func TestMount_Close_NilPlatform(t *testing.T) {
	m := &Mount{
		filesystem: &Filesystem{},
	}

	// Should not error when platform is nil
	if err := m.Close(); err != nil {
		t.Errorf("Close() error = %v", err)
	}
}

func TestMount_Close_WithPlatform(t *testing.T) {
	// This test can only run when WSL2 is actually available
	t.Skip("Requires real WSL2 environment")
}

func TestFilesystem_InterfaceCompliance(t *testing.T) {
	var _ platform.FilesystemInterceptor = (*Filesystem)(nil)
	var _ platform.FSMount = (*Mount)(nil)
}
