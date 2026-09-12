package policy

type globScore struct {
	literal int
	wild    int
	prefix  int
	segs    int
}

type scoredHit struct {
	dec  Decision
	spec globScore
}

func scoreGlob(pat string) globScore {
	s := globScore{}
	if pat == "" {
		return s
	}
	s.segs = 1
	for i := 0; i < len(pat); i++ {
		switch pat[i] {
		case '*', '\x3f', '[', '{':
			s.wild++
		case '/':
			s.segs++
		default:
			s.literal++
		}
	}
	return s
}

func (a globScore) less(b globScore) bool {
	if a.prefix < b.prefix {
		return true
	}
	if b.prefix < a.prefix {
		return false
	}
	if b.wild < a.wild {
		return true
	}
	if a.wild < b.wild {
		return false
	}
	if a.literal < b.literal {
		return true
	}
	if b.literal < a.literal {
		return false
	}
	return a.segs < b.segs
}

func (e *Engine) pickMostSpecific(hits []scoredHit, fallback Decision) Decision {
	if len(hits) == 0 {
		return fallback
	}
	best := hits[0]
	for _, h := range hits[1:] {
		if best.spec.less(h.spec) {
			best = h
		}
	}
	return best.dec
}
