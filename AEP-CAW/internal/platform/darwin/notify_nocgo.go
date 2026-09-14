//go:build darwin && !cgo

package darwin

const PolicyUpdatedNotification = "io.github.thepm001.aep-caw.policy-updated"

// NotifyPolicyUpdated is a no-op when CGO is disabled.
func NotifyPolicyUpdated() {}

const SessionRegisteredNotification = "io.github.thepm001.aep-caw.session-registered"

// NotifySessionRegistered is a no-op when CGO is disabled.
func NotifySessionRegistered() {}
