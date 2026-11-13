//go:build !linux || !cgo

package api

// seccompFileMonitorBuilt is false where the seccomp file monitor is not built,
// so the enforcement check never counts it as a file backend.
const seccompFileMonitorBuilt = false

// registerFUSEMount is a no-op on non-Linux platforms.
// The MountRegistry and seccomp file monitoring are Linux-only features.
func registerFUSEMount(sessionID, sourcePath string) {}

// deregisterFUSEMount is a no-op on non-Linux platforms.
func deregisterFUSEMount(sessionID, sourcePath string) {}
