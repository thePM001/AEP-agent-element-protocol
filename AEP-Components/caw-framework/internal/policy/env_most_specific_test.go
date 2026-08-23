package policy

import "testing"

func TestEngine_CheckEnv_MostSpecificCollectAll(t *testing.T) {
	p := &Policy{
		Version: 1,
		Name:    "test",
		EnvPolicy: EnvPolicy{
			Deny:  []string{"*"},
			Allow: []string{"HOME", "PATH"},
		},
	}
	e, err := NewEngine(p, false, true)
	if err != nil {
		t.Fatal(err)
	}
	if dec := e.CheckEnv("HOME"); !dec.Allowed || dec.MatchedBy != "allow" {
		t.Fatalf("HOME: explicit allow must beat catch-all deny, got Allowed=%v MatchedBy=%s", dec.Allowed, dec.MatchedBy)
	}
	if dec := e.CheckEnv("PATH"); !dec.Allowed {
		t.Fatalf("PATH: explicit allow must beat catch-all deny, got Allowed=%v", dec.Allowed)
	}
	if dec := e.CheckEnv("AWS_SECRET"); dec.Allowed {
		t.Fatalf("AWS_SECRET must close, got Allowed=%v MatchedBy=%s", dec.Allowed, dec.MatchedBy)
	}
}

func TestEngine_CheckEnv_ExactDenyBeatsGlobAllow(t *testing.T) {
	p := &Policy{
		Version: 1,
		Name:    "test",
		EnvPolicy: EnvPolicy{
			Allow: []string{"MY_*"},
			Deny:  []string{"MY_SECRET"},
		},
	}
	e, err := NewEngine(p, false, true)
	if err != nil {
		t.Fatal(err)
	}
	if dec := e.CheckEnv("MY_VAR"); !dec.Allowed {
		t.Fatalf("MY_VAR should allow, got %v %s", dec.Allowed, dec.MatchedBy)
	}
	if dec := e.CheckEnv("MY_SECRET"); dec.Allowed {
		t.Fatalf("MY_SECRET exact deny must beat glob allow, got Allowed=%v", dec.Allowed)
	}
}

func TestEngine_CheckEnv_CatchAllDenyOrderIndependent(t *testing.T) {
	p1 := &Policy{Version: 1, Name: "a", EnvPolicy: EnvPolicy{Deny: []string{"*"}, Allow: []string{"HOME"}}}
	p2 := &Policy{Version: 1, Name: "b", EnvPolicy: EnvPolicy{Allow: []string{"HOME"}, Deny: []string{"*"}}}
	e1, err := NewEngine(p1, false, true)
	if err != nil {
		t.Fatal(err)
	}
	e2, err := NewEngine(p2, false, true)
	if err != nil {
		t.Fatal(err)
	}
	d1 := e1.CheckEnv("HOME")
	d2 := e2.CheckEnv("HOME")
	if !d1.Allowed || !d2.Allowed {
		t.Fatalf("HOME must allow in both list orders: %v %s / %v %s", d1.Allowed, d1.MatchedBy, d2.Allowed, d2.MatchedBy)
	}
	x1 := e1.CheckEnv("OTHER")
	x2 := e2.CheckEnv("OTHER")
	if x1.Allowed || x2.Allowed {
		t.Fatalf("OTHER must close under catch-all deny")
	}
}

