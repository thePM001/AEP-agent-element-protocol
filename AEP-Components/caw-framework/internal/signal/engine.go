//go:build !windows

// internal/signal/engine.go
package signal

// SignalRule represents a signal policy rule.
// This mirrors policy.SignalRule to avoid import cycles.
type SignalRule struct {
	Name        string
	Description string
	Signals     []string   // Signal names, numbers, or groups (@fatal, @job)
	Target      TargetSpec // Who can receive the signal
	Decision    string     // allow, deny, audit, approve, redirect, absorb
	Fallback    string     // Fallback decision if platform can't enforce
	RedirectTo  string     // For redirect: target signal
	Message     string
}

// DecisionAction represents the action to take for a signal.
type DecisionAction string

const (
	DecisionAllow    DecisionAction = "allow"
	DecisionDeny     DecisionAction = "deny"
	DecisionAudit    DecisionAction = "audit"
	DecisionApprove  DecisionAction = "approve"
	DecisionRedirect DecisionAction = "redirect"
	DecisionAbsorb   DecisionAction = "absorb"
)

// Decision is the result of evaluating a signal against policy.
type Decision struct {
	Action         DecisionAction
	Rule           string
	Message        string
	RedirectSignal int    // For redirect: the new signal
	Fallback       string // Original fallback for platform limitations
}

// compiledSignalRule is an internal representation of a policy rule
// with expanded signals and parsed target.
type compiledSignalRule struct {
	rule     SignalRule
	signals  map[int]struct{} // Expanded signal numbers
	target   *ParsedTarget
	redirect int // For redirect decision
}

// Engine evaluates signals against policy rules.
type Engine struct {
	rules []compiledSignalRule
}

// NewEngine creates a signal policy engine from rules.
func NewEngine(rules []SignalRule) (*Engine, error) {
	compiled := make([]compiledSignalRule, 0, len(rules))

	for _, rule := range rules {
		cr := compiledSignalRule{
			rule:    rule,
			signals: make(map[int]struct{}),
		}

		// Expand signals (groups and individual)
		for _, sigSpec := range rule.Signals {
			if IsSignalGroup(sigSpec) {
				expanded, err := ExpandSignalGroup(sigSpec)
				if err != nil {
					return nil, err
				}
				for _, sig := range expanded {
					cr.signals[sig] = struct{}{}
				}
			} else {
				sig, err := SignalFromString(sigSpec)
				if err != nil {
					return nil, err
				}
				cr.signals[sig] = struct{}{}
			}
		}

		// Parse target specification
		target, err := ParseTargetSpec(rule.Target)
		if err != nil {
			return nil, err
		}
		cr.target = target

		// Parse redirect signal if decision is redirect
		if rule.Decision == string(DecisionRedirect) && rule.RedirectTo != "" {
			redirectSig, err := SignalFromString(rule.RedirectTo)
			if err != nil {
				return nil, err
			}
			cr.redirect = redirectSig
		}

		compiled = append(compiled, cr)
	}

	return &Engine{rules: compiled}, nil
}

// Check evaluates a signal against the policy.
// Collects matching rules. Most specific selector wins.
// If no rule matches, returns default deny.
func (e *Engine) Check(signal int, ctx *TargetContext) Decision {
	bestExact := -1
	bestPrefix := -1
	var top []Decision
	found := false
	for _, rule := range e.rules {
		if _, ok := rule.signals[signal]; ok == false {
			continue
		}
		if rule.target.Matches(ctx) == false {
			continue
		}
		dec := Decision{
			Action:         DecisionAction(rule.rule.Decision),
			Rule:           rule.rule.Name,
			Message:        rule.rule.Message,
			RedirectSignal: rule.redirect,
			Fallback:       rule.rule.Fallback,
		}
		exact := 0
		if len(rule.signals) == 1 {
			exact = 1
		}
		prefix := 1000 - len(rule.signals)
		if rule.target != nil {
			switch rule.target.Type {
			case TargetProcess, TargetPIDRange:
				prefix += 20
			case TargetSelf, TargetParent, TargetChildren:
				prefix += 10
			}
		}
		if found == false || exact > bestExact || (exact == bestExact && prefix > bestPrefix) {
			bestExact = exact
			bestPrefix = prefix
			top = []Decision{dec}
			found = true
		} else if exact == bestExact && prefix == bestPrefix {
			top = append(top, dec)
		}
	}
	if found == false {
		return Decision{
			Action:  DecisionDeny,
			Rule:    "",
			Message: "no matching rule",
		}
	}
	for _, d := range top {
		if d.Action == DecisionDeny {
			return d
		}
	}
	return top[0]
}

// ApplyFallback adjusts a decision based on platform limitations.
// If canBlock is false and the decision requires blocking (deny, approve, redirect, absorb),
// the fallback decision is applied if specified.
func ApplyFallback(dec Decision, canBlock bool) Decision {
	if canBlock {
		return dec
	}

	// These actions require the ability to block
	needsBlock := dec.Action == DecisionDeny ||
		dec.Action == DecisionApprove ||
		dec.Action == DecisionRedirect ||
		dec.Action == DecisionAbsorb

	if !needsBlock {
		return dec
	}

	// Apply fallback if specified
	if dec.Fallback != "" {
		return Decision{
			Action:         DecisionAction(dec.Fallback),
			Rule:           dec.Rule,
			Message:        dec.Message + " (fallback applied)",
			RedirectSignal: dec.RedirectSignal,
			Fallback:       dec.Fallback,
		}
	}

	// No fallback specified, return audit as safe default
	return Decision{
		Action:   DecisionAudit,
		Rule:     dec.Rule,
		Message:  dec.Message + " (platform cannot enforce)",
		Fallback: dec.Fallback,
	}
}
