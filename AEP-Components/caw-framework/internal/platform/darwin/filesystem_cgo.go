//go:build darwin && cgo

package darwin

import (
	"fmt"

	"github.com/nla-aep/aep-caw-framework/internal/platform"
	"github.com/nla-aep/aep-caw-framework/internal/platform/fuse"
)

// Mount creates a FUSE mount.
func (fs *Filesystem) Mount(cfg platform.FSConfig) (platform.FSMount, error) {
	fs.mu.Lock()
	defer fs.mu.Unlock()

	if _, exists := fs.mounts[cfg.MountPoint]; exists {
		return nil, fmt.Errorf("mount point %q already in use", cfg.MountPoint)
	}

	mount, err := fuse.Mount(fuse.Config{
		FSConfig:   cfg,
		VolumeName: "aep-caw",
	})
	if err != nil {
		return nil, err
	}

	fs.mounts[cfg.MountPoint] = mount
	return mount, nil
}

const cgoEnabled = true
