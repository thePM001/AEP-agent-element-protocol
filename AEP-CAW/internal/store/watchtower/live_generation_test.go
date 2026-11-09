package watchtower_test

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/audit"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/store/watchtower"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/store/watchtower/compact"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/store/watchtower/testserver"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/pkg/types"
)

// TestStore_LiveFollowsFirstGeneration covers a Store whose transport reaches the
// Live state before the first event is appended. The WAL is empty at that moment,
// so the Live reader opens at generation 0, and the first events then arrive in a
// generation 1 segment. The Live loop must follow the WAL to the new generation;
// before it did, the reader skipped the generation 1 segment and no batch was ever
// sent.
func TestStore_LiveFollowsFirstGeneration(t *testing.T) {
	skipOnWindowsCIIfSlow(t)
	srv := testserver.New(testserver.Options{})
	defer srv.Close()

	s, err := watchtower.New(context.Background(), watchtower.Options{
		WALDir:          t.TempDir(),
		Mapper:          compact.StubMapper{},
		Allocator:       audit.NewSequenceAllocator(),
		AgentID:         "a",
		SessionID:       "s",
		KeyFingerprint:  "sha256:live-gen",
		HMACKeyID:       "k1",
		HMACSecret:      bytes.Repeat([]byte("a"), 32),
		HMACAlgorithm:   "hmac-sha256",
		BatchMaxRecords: 8,
		BatchMaxBytes:   4 * 1024,
		BatchMaxAge:     50 * time.Millisecond,
		AllowStubMapper: true,
		Dialer:          srv.DialerFor(),
		BackoffInitial:  10 * time.Millisecond,
		BackoffMax:      50 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("watchtower.New: %v", err)
	}
	defer func() { _ = s.Close() }()

	// Let the transport connect, replay the empty WAL and settle in Live
	// before any event exists.
	if _, err := srv.WaitForSessionInits(1, 30*time.Second); err != nil {
		t.Fatalf("WaitForSessionInits: %v", err)
	}
	time.Sleep(300 * time.Millisecond)

	const total = 20
	for i := uint64(1); i <= total; i++ {
		ev := types.Event{
			Type:      "exec",
			SessionID: "s",
			Timestamp: time.Now(),
			Chain:     &types.ChainState{Sequence: i, Generation: 1},
		}
		if err := s.AppendEvent(context.Background(), ev); err != nil {
			t.Fatalf("AppendEvent: %v", err)
		}
	}

	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if srv.AssertReplayObserved(1, total) == nil {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	if err := srv.AssertReplayObserved(1, total); err != nil {
		t.Fatalf("events appended after the transport went Live were not delivered: %v\nReceived batches: %s", err, dumpReceivedBatchSummary(srv))
	}
}
