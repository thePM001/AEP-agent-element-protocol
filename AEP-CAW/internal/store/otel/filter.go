package otel

import "github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/store/eventfilter"

// Filter is an alias for the shared eventfilter.Filter so existing callers
// continue to use otel.Filter without churn.
type Filter = eventfilter.Filter
