//go:build darwin && !cgo

package darwin

const PolicyUpdatedNotification = "ai.nla-aep.aep-caw.policy-updated"

// NotifyPolicyUpdated is a no-op when CGO is disabled.
func NotifyPolicyUpdated() {}

const SessionRegisteredNotification = "ai.nla-aep.aep-caw.session-registered"

// NotifySessionRegistered is a no-op when CGO is disabled.
func NotifySessionRegistered() {}
