// Package postgres - object.go owns the RangeVar→ObjectRef extractor and the
// §6.1 resolution-tag rule. Kept here so DML, DDL, COPY, etc. share one path.
package postgres

import (
	"strings"

	pg_query "github.com/pganalyze/pg_query_go/v6"

	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/db/effects"
)

// extractRelation maps a pg_query RangeVar to an ObjectRef + Resolution per §6.
// Caller specifies the target ObjectKind (table, view, sequence, etc.).
//
// A nil RangeVar returns a zero-valued ObjectRef of the requested kind with
// ResolutionUnresolved - handlers should generally guard their inputs before
// calling, but the defensive return keeps the dispatcher's "always emit at
// least one effect" invariant safe.
func extractRelation(rv *pg_query.RangeVar, sess SessionState, kind effects.ObjectKind) (effects.ObjectRef, effects.Resolution) {
	if rv == nil {
		return effects.ObjectRef{Kind: kind}, effects.ResolutionUnresolved
	}
	obj := effects.ObjectRef{
		Kind:   kind,
		Schema: strings.ToLower(rv.Schemaname),
		Name:   strings.ToLower(rv.Relname),
	}
	res := resolutionFor(obj, sess)
	return obj, res
}

// resolutionFor implements §6.1's resolution-tag decision tree.
func resolutionFor(obj effects.ObjectRef, sess SessionState) effects.Resolution {
	if obj.Schema != "" {
		return effects.ResolutionQualified
	}
	if _, isTemp := sess.TempTables[obj.Name]; isTemp {
		return effects.ResolutionMaybeTempShadowed
	}
	// Empty SearchPath with empty DefaultSearchPath is "no info" - treat as
	// plain unqualified per spec §6.1 (no evidence the path was tampered with).
	if len(sess.SearchPath) == 0 && len(sess.DefaultSearchPath) == 0 {
		return effects.ResolutionUnqualified
	}
	if !equalStringSlice(sess.SearchPath, sess.DefaultSearchPath) {
		return effects.ResolutionAmbiguousAfterSearchPath
	}
	return effects.ResolutionUnqualified
}

func equalStringSlice(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
