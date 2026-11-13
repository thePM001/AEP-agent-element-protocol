package api

import (
	"os"
	"testing"
)

// TestMain runs the package tests as an operator: tests that are not about
// the control guard build requests without a real peer. The guard tests set
// App.peerResolver themselves, and the proof gate uses the procfs resolver.
func TestMain(m *testing.M) {
	newPeerResolver = func() peerResolver { return stubResolver{} }
	os.Exit(m.Run())
}
