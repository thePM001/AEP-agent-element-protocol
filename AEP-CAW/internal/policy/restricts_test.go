package policy

import "testing"

func TestRestrictsFiles(t *testing.T) {
	cases := []struct {
		name string
		p    *Policy
		want bool
	}{
		{"nil policy", nil, false},
		{"no file rules", &Policy{}, false},
		{"deny rule", &Policy{FileRules: []FileRule{
			{Name: "d", Paths: []string{"/secret/**"}, Operations: []string{"*"}, Decision: "deny"},
		}}, true},
		{"approve rule", &Policy{FileRules: []FileRule{
			{Name: "a", Paths: []string{"/**"}, Operations: []string{"*"}, Decision: "allow"},
			{Name: "ap", Paths: []string{"/w/**"}, Operations: []string{"delete"}, Decision: "approve"},
		}}, true},
		{"allow rules without catch-all", &Policy{FileRules: []FileRule{
			{Name: "a", Paths: []string{"/work/**"}, Operations: []string{"*"}, Decision: "allow"},
		}}, true},
		{"catch-all allow", &Policy{FileRules: []FileRule{
			{Name: "a", Paths: []string{"/**"}, Operations: []string{"*"}, Decision: "allow"},
			{Name: "au", Paths: []string{"/w/**"}, Operations: []string{"write"}, Decision: "audit"},
		}}, false},
		{"catch-all allow on some operations", &Policy{FileRules: []FileRule{
			{Name: "a", Paths: []string{"**"}, Operations: []string{"read"}, Decision: "allow"},
		}}, true},
	}
	for _, c := range cases {
		if got := c.p.RestrictsFiles(); got != c.want {
			t.Errorf("%s: RestrictsFiles = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestRestrictsNetwork(t *testing.T) {
	cases := []struct {
		name string
		p    *Policy
		want bool
	}{
		{"nil policy", nil, false},
		{"no network rules", &Policy{}, false},
		{"deny rule", &Policy{NetworkRules: []NetworkRule{
			{Name: "d", CIDRs: []string{"10.0.0.0/8"}, Decision: "deny"},
		}}, true},
		{"literal allow only", &Policy{NetworkRules: []NetworkRule{
			{Name: "a", Domains: []string{"example.com"}, Decision: "allow"},
		}}, true},
		{"catch-all allow", &Policy{NetworkRules: []NetworkRule{
			{Name: "a", Domains: []string{"*"}, Decision: "allow"},
		}}, false},
		{"catch-all allow on one port", &Policy{NetworkRules: []NetworkRule{
			{Name: "a", Domains: []string{"*"}, Ports: []int{443}, Decision: "allow"},
		}}, true},
		{"catch-all allow under unmatched_egress deny", &Policy{UnmatchedEgress: "deny", NetworkRules: []NetworkRule{
			{Name: "a", Domains: []string{"*"}, Decision: "allow"},
		}}, true},
	}
	for _, c := range cases {
		if got := c.p.RestrictsNetwork(); got != c.want {
			t.Errorf("%s: RestrictsNetwork = %v, want %v", c.name, got, c.want)
		}
	}
}

// The shipped default policy restricts both file and network access, so it
// needs a backend for each (AEP-CRV-040).
func TestShippedDefaultPolicyRestricts(t *testing.T) {
	p, err := LoadFromFile("../../configs/policies/default.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if !p.RestrictsFiles() || !p.RestrictsNetwork() {
		t.Fatalf("default policy: RestrictsFiles=%v RestrictsNetwork=%v, want both true", p.RestrictsFiles(), p.RestrictsNetwork())
	}
}
