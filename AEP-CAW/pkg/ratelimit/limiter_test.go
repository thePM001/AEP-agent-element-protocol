package ratelimit

import (
	"testing"
	"time"
)

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()

	if cfg.Session.FileOpsPerSecond != 1000 {
		t.Errorf("FileOpsPerSecond = %v, want 1000", cfg.Session.FileOpsPerSecond)
	}
	if cfg.Session.BurstMultiplier != 5 {
		t.Errorf("BurstMultiplier = %v, want 5", cfg.Session.BurstMultiplier)
	}
	if cfg.Global.MaxConcurrentSessions != 1000 {
		t.Errorf("MaxConcurrentSessions = %v, want 1000", cfg.Global.MaxConcurrentSessions)
	}
}

func TestNewLimiter(t *testing.T) {
	l := NewLimiter(10, 50)

	if l == nil {
		t.Fatal("NewLimiter returned nil")
	}
	if l.Rate() != 10 {
		t.Errorf("Rate() = %v, want 10", l.Rate())
	}
	if l.Burst() != 50 {
		t.Errorf("Burst() = %v, want 50", l.Burst())
	}
}

func TestLimiter_Allow(t *testing.T) {
	l := NewLimiter(10, 5)

	// Should allow burst
	for i := 0; i < 5; i++ {
		if !l.Allow() {
			t.Errorf("Allow() returned false on attempt %d within burst", i+1)
		}
	}

	// Should deny after burst exhausted
	if l.Allow() {
		t.Error("Allow() should return false after burst exhausted")
	}
}

func TestLimiter_AllowN(t *testing.T) {
	l := NewLimiter(100, 10)

	// Should allow 5 tokens
	if !l.AllowN(5) {
		t.Error("AllowN(5) should return true")
	}

	// Should allow another 5
	if !l.AllowN(5) {
		t.Error("AllowN(5) should return true again")
	}

	// Should deny 5 more (burst exhausted)
	if l.AllowN(5) {
		t.Error("AllowN(5) should return false after burst exhausted")
	}
}

func TestLimiter_TokensReplenish(t *testing.T) {
	l := NewLimiter(100, 10) // 100 tokens/second

	// Exhaust burst
	l.AllowN(10)

	// Should be empty
	if l.Tokens() > 0.5 {
		t.Errorf("Tokens() = %v, expected near 0", l.Tokens())
	}

	// Wait for replenishment. A loaded runner can sleep longer than asked, so the
	// upper bound follows the time that really passed (100/sec, capped at burst 10).
	start := time.Now()
	time.Sleep(50 * time.Millisecond)
	tokens := l.Tokens()
	upper := 100*time.Since(start).Seconds() + 1
	if upper > 10 {
		upper = 10
	}
	if tokens < 4 || tokens > upper {
		t.Errorf("Tokens() = %v, expected between 4 and %v", tokens, upper)
	}
}

func TestLimiter_SetRate(t *testing.T) {
	l := NewLimiter(10, 5)

	l.SetRate(100)
	if l.Rate() != 100 {
		t.Errorf("Rate() = %v, want 100", l.Rate())
	}
}

func TestLimiter_SetBurst(t *testing.T) {
	l := NewLimiter(10, 50)

	l.SetBurst(10)
	if l.Burst() != 10 {
		t.Errorf("Burst() = %v, want 10", l.Burst())
	}

	// Tokens should be capped at new burst
	if l.Tokens() > 10 {
		t.Errorf("Tokens() = %v, should be capped at 10", l.Tokens())
	}
}

func TestLimiter_Wait(t *testing.T) {
	l := NewLimiter(1000, 1) // Fast for testing

	// First should be immediate
	d := l.Wait()
	if d > time.Millisecond {
		t.Errorf("First Wait() = %v, expected immediate", d)
	}

	// Second should require waiting
	start := time.Now()
	l.Wait()
	elapsed := time.Since(start)

	// Should have waited approximately 1ms (1/1000 second)
	if elapsed < 500*time.Microsecond {
		t.Errorf("Second Wait() elapsed = %v, expected some delay", elapsed)
	}
}

func TestActionType(t *testing.T) {
	tests := []struct {
		action ActionType
		want   string
	}{
		{ActionThrottle, "throttle"},
		{ActionBlock, "block"},
		{ActionAlert, "alert"},
	}

	for _, tt := range tests {
		if string(tt.action) != tt.want {
			t.Errorf("ActionType = %q, want %q", tt.action, tt.want)
		}
	}
}

func TestResourceType(t *testing.T) {
	tests := []struct {
		resource ResourceType
		want     string
	}{
		{ResourceFileOps, "file_ops"},
		{ResourceNetworkConns, "network_conns"},
		{ResourceDNSQueries, "dns_queries"},
		{ResourceStorage, "storage"},
		{ResourceNetworkBytes, "network_bytes"},
	}

	for _, tt := range tests {
		if string(tt.resource) != tt.want {
			t.Errorf("ResourceType = %q, want %q", tt.resource, tt.want)
		}
	}
}
