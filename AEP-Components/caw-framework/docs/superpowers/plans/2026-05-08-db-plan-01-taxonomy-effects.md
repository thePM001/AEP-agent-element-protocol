# DB Plan 01 - Taxonomy + Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the type backbone for DB access enforcement: groups, risk tiers, subtypes, aliases, object kinds, effect ordering, `Effect`, `ClassifiedStatement`, and skeletons for `DBEvent` + `db_services` config - all as pure Go with no socket or parser dependencies.

**Architecture:** Single tree under `internal/db/` per the roadmap. This plan touches `internal/db/effects/`, `internal/db/events/`, and `internal/db/service/`. No CGO, no Linux-only syscalls - builds on every platform. No external behavior change; this plan ships only types and pure functions consumed by Plans 02 and onward.

**Tech Stack:** Go 1.25, standard library only, table-driven tests, `gopkg.in/yaml.v3` for `db_services` config (already in go.mod).

**Source spec:** [`docs/aep-caw-db-access-spec.md`](../../aep-caw-db-access-spec.md) §5, §6, §8 (skeleton), §9.1.
**Roadmap:** [`docs/superpowers/specs/2026-05-08-db-access-phase-1-roadmap-design.md`](../specs/2026-05-08-db-access-phase-1-roadmap-design.md).

---

## File Structure

Files created in this plan:

| File | Responsibility |
|------|----------------|
| `internal/db/effects/risk_tier.go` | `RiskTier` enum (`Safe`, `Low`, `Medium`, `High`, `Critical`); `Compare`; `String`. |
| `internal/db/effects/group.go` | `Group` enum (18 values per §5 table); `RiskTier()`; `String`; `ParseGroup`. |
| `internal/db/effects/subtype.go` | `Subtype` enum (per §5.1 table) with parent-`Group` validation. |
| `internal/db/effects/alias.go` | `Alias` map and `ExpandAliases` function per §5.4. |
| `internal/db/effects/object.go` | `ObjectRef` sum type - `kind`, `schema`, `name`, `host`, `port`, `path`, `argv0` per §6.4. |
| `internal/db/effects/resolution.go` | `Resolution` enum (5 values per §6.1); `Fold` for worst-case summary per §6.2. |
| `internal/db/effects/effect.go` | `Effect` struct; `Order` function implementing §5.2 (risk-tier-first, R5 tie-break, AST traversal stable order). |
| `internal/db/effects/statement.go` | `ClassifiedStatement` struct (effects list + `parser_backend` + `object_resolution` summary). |
| `internal/db/effects/*_test.go` | Table-driven tests for every above unit. |
| `internal/db/events/event.go` | `DBEvent` struct (skeleton - fields only, no emission logic). |
| `internal/db/events/redaction.go` | `Redaction` enum (`None`, `ParametersRedacted`, `Full`) per R4. |
| `internal/db/events/event_test.go` | Round-trip JSON marshal/unmarshal stability test. |
| `internal/db/service/config.go` | `Service` struct + `ParseConfig` for `db_services` YAML schema (§9.1). |
| `internal/db/service/config_test.go` | YAML round-trip + validation tests. |

No files modified outside the new tree. No `internal/policy/` change in this plan.

---

## Task 1: Risk-tier enum

**Files:**
- Create: `internal/db/effects/risk_tier.go`
- Test: `internal/db/effects/risk_tier_test.go`

- [ ] **Step 1: Write the failing test**

```go
// internal/db/effects/risk_tier_test.go
package effects

import "testing"

func TestRiskTier_StringRoundTrip(t *testing.T) {
	cases := []struct {
		tier RiskTier
		name string
	}{
		{Safe, "safe"},
		{Low, "low"},
		{Medium, "medium"},
		{High, "high"},
		{Critical, "critical"},
	}
	for _, tc := range cases {
		if got := tc.tier.String(); got != tc.name {
			t.Errorf("RiskTier(%d).String() = %q, want %q", tc.tier, got, tc.name)
		}
	}
}

func TestRiskTier_Compare(t *testing.T) {
	if Critical.Compare(High) <= 0 {
		t.Error("Critical should be greater than High")
	}
	if Low.Compare(Low) != 0 {
		t.Error("Low should equal Low")
	}
	if Safe.Compare(Critical) >= 0 {
		t.Error("Safe should be less than Critical")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/db/effects/... -run RiskTier -v`
Expected: FAIL - `RiskTier`, `Safe`, `Low`, `Medium`, `High`, `Critical`, `Compare` all undefined.

- [ ] **Step 3: Write minimal implementation**

```go
// internal/db/effects/risk_tier.go
package effects

// RiskTier orders operation groups by severity. Critical is the highest tier.
type RiskTier uint8

const (
	Safe RiskTier = iota
	Low
	Medium
	High
	Critical
)

var riskTierNames = [...]string{
	Safe:     "safe",
	Low:      "low",
	Medium:   "medium",
	High:     "high",
	Critical: "critical",
}

func (t RiskTier) String() string {
	if int(t) >= len(riskTierNames) {
		return "unknown"
	}
	return riskTierNames[t]
}

// Compare returns >0 if t is more severe than other, <0 if less, 0 if equal.
func (t RiskTier) Compare(other RiskTier) int {
	return int(t) - int(other)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/db/effects/... -run RiskTier -v`
Expected: PASS, two tests.

- [ ] **Step 5: Commit**

```bash
git add internal/db/effects/risk_tier.go internal/db/effects/risk_tier_test.go
git commit -m "feat(db/effects): add RiskTier enum"
```

---

## Task 2: Group enum

**Files:**
- Create: `internal/db/effects/group.go`
- Test: `internal/db/effects/group_test.go`

- [ ] **Step 1: Write the failing test**

```go
// internal/db/effects/group_test.go
package effects

import "testing"

func TestGroup_RiskTierAndString(t *testing.T) {
	cases := []struct {
		group Group
		name  string
		tier  RiskTier
	}{
		{GroupRead, "read", Low},
		{GroupWrite, "write", Medium},
		{GroupModify, "modify", Medium},
		{GroupDelete, "delete", High},
		{GroupBulkLoad, "bulk_load", High},
		{GroupBulkExport, "bulk_export", Critical},
		{GroupSchemaCreate, "schema_create", High},
		{GroupSchemaAlter, "schema_alter", High},
		{GroupSchemaDestroy, "schema_destroy", Critical},
		{GroupPrivilege, "privilege", Critical},
		{GroupTransaction, "transaction", Low},
		{GroupSession, "session", Low},
		{GroupMaintenance, "maintenance", Medium},
		{GroupLock, "lock", Medium},
		{GroupNotify, "notify", Low},
		{GroupProcedural, "procedural", High},
		{GroupUnsafeIO, "unsafe_io", Critical},
		{GroupUnknown, "unknown", Critical},
	}
	for _, tc := range cases {
		if got := tc.group.String(); got != tc.name {
			t.Errorf("Group(%d).String() = %q, want %q", tc.group, got, tc.name)
		}
		if got := tc.group.RiskTier(); got != tc.tier {
			t.Errorf("%s.RiskTier() = %s, want %s", tc.name, got, tc.tier)
		}
	}
}

func TestParseGroup(t *testing.T) {
	g, ok := ParseGroup("unsafe_io")
	if !ok || g != GroupUnsafeIO {
		t.Fatalf("ParseGroup(unsafe_io) = %v, %v; want GroupUnsafeIO, true", g, ok)
	}
	if _, ok := ParseGroup("garbage"); ok {
		t.Fatal("ParseGroup(garbage) should fail")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/db/effects/... -run Group -v`
Expected: FAIL - `Group`, all `Group*` constants, `ParseGroup` undefined.

- [ ] **Step 3: Write minimal implementation**

```go
// internal/db/effects/group.go
package effects

// Group identifies an operation taxonomy bucket per §5 of the spec.
type Group uint8

// IDs match the spec table 1..18 so `group_id` in DBEvent is stable.
const (
	GroupRead          Group = 1
	GroupWrite         Group = 2
	GroupModify        Group = 3
	GroupDelete        Group = 4
	GroupBulkLoad      Group = 5
	GroupBulkExport    Group = 6
	GroupSchemaCreate  Group = 7
	GroupSchemaAlter   Group = 8
	GroupSchemaDestroy Group = 9
	GroupPrivilege     Group = 10
	GroupTransaction   Group = 11
	GroupSession       Group = 12
	GroupMaintenance   Group = 13
	GroupLock          Group = 14
	GroupNotify        Group = 15
	GroupProcedural    Group = 16
	GroupUnsafeIO      Group = 17
	GroupUnknown       Group = 18
)

type groupInfo struct {
	name string
	tier RiskTier
}

var groupTable = map[Group]groupInfo{
	GroupRead:          {"read", Low},
	GroupWrite:         {"write", Medium},
	GroupModify:        {"modify", Medium},
	GroupDelete:        {"delete", High},
	GroupBulkLoad:      {"bulk_load", High},
	GroupBulkExport:    {"bulk_export", Critical},
	GroupSchemaCreate:  {"schema_create", High},
	GroupSchemaAlter:   {"schema_alter", High},
	GroupSchemaDestroy: {"schema_destroy", Critical},
	GroupPrivilege:     {"privilege", Critical},
	GroupTransaction:   {"transaction", Low},
	GroupSession:       {"session", Low},
	GroupMaintenance:   {"maintenance", Medium},
	GroupLock:          {"lock", Medium},
	GroupNotify:        {"notify", Low},
	GroupProcedural:    {"procedural", High},
	GroupUnsafeIO:      {"unsafe_io", Critical},
	GroupUnknown:       {"unknown", Critical},
}

func (g Group) String() string {
	if info, ok := groupTable[g]; ok {
		return info.name
	}
	return "unknown"
}

func (g Group) RiskTier() RiskTier {
	if info, ok := groupTable[g]; ok {
		return info.tier
	}
	return Critical // unknown is critical per §5; default unknown values to critical
}

// ID returns the canonical numeric ID per §5 (used by DBEvent.operation_group_id).
func (g Group) ID() uint8 { return uint8(g) }

// ParseGroup parses the canonical lowercase group name. Returns ok=false on unknown input.
func ParseGroup(name string) (Group, bool) {
	for g, info := range groupTable {
		if info.name == name {
			return g, true
		}
	}
	return 0, false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/db/effects/... -run Group -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/db/effects/group.go internal/db/effects/group_test.go
git commit -m "feat(db/effects): add Group enum with risk tiers and IDs"
```

---

## Task 3: Subtype enum + parent-group validation

**Files:**
- Create: `internal/db/effects/subtype.go`
- Test: `internal/db/effects/subtype_test.go`

The subtype set is defined per §5.1. Each subtype is keyed to one Group (its parent). A subtype with mismatched parent at construction time is a programming error.

- [ ] **Step 1: Write the failing test**

```go
// internal/db/effects/subtype_test.go
package effects

import "testing"

func TestSubtype_ParentGroup(t *testing.T) {
	cases := []struct {
		sub  Subtype
		name string
		grp  Group
	}{
		{SubtypeSet, "set", GroupSession},
		{SubtypeSetSearchPath, "set_search_path", GroupSession},
		{SubtypeDiscardPlans, "discard_plans", GroupSession},
		{SubtypeCancelRequest, "cancel_request", GroupSession},
		{SubtypeCreateTable, "create_table", GroupSchemaCreate},
		{SubtypeCreatePublication, "create_publication", GroupSchemaCreate},
		{SubtypeAlterPublication, "alter_publication", GroupSchemaAlter},
		{SubtypeDropTable, "drop_table", GroupSchemaDestroy},
		{SubtypeTruncate, "truncate", GroupSchemaDestroy},
		{SubtypeGrant, "grant", GroupPrivilege},
		{SubtypeAlterSystem, "alter_system", GroupPrivilege},
		{SubtypeCopyFromStdin, "copy_from_stdin", GroupBulkLoad},
		{SubtypeCopyFromS3, "copy_from_s3", GroupBulkLoad},
		{SubtypeCopyToStdout, "copy_to_stdout", GroupBulkExport},
		{SubtypeUnloadToS3, "unload_to_s3", GroupBulkExport},
		{SubtypeFunctionCallProtocol, "function_call_protocol", GroupProcedural},
		{SubtypeCall, "call", GroupProcedural},
		{SubtypeDoOrAnon, "do_or_anon", GroupProcedural},
		{SubtypeCreateSubscription, "create_subscription", GroupUnsafeIO},
		{SubtypeCopyToPath, "copy_to_path", GroupUnsafeIO},
		{SubtypeCopyToProgram, "copy_to_program", GroupUnsafeIO},
		{SubtypeLargeObjectIO, "large_object_io", GroupUnsafeIO},
		{SubtypeServerFileRead, "server_file_read", GroupUnsafeIO},
		{SubtypeDblinkCall, "dblink_call", GroupUnsafeIO},
		{SubtypeFdwAccess, "fdw_access", GroupUnsafeIO},
	}
	for _, tc := range cases {
		if got := tc.sub.String(); got != tc.name {
			t.Errorf("Subtype(%d).String() = %q, want %q", tc.sub, got, tc.name)
		}
		if got := tc.sub.Group(); got != tc.grp {
			t.Errorf("%s.Group() = %s, want %s", tc.name, got, tc.grp)
		}
	}
}

func TestSubtype_NoneIsZero(t *testing.T) {
	var s Subtype
	if s != SubtypeNone {
		t.Errorf("zero Subtype should equal SubtypeNone, got %v", s)
	}
	if s.String() != "" {
		t.Errorf("SubtypeNone.String() should be empty, got %q", s.String())
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/db/effects/... -run Subtype -v`
Expected: FAIL - Subtype constants undefined.

- [ ] **Step 3: Write minimal implementation**

```go
// internal/db/effects/subtype.go
package effects

// Subtype is an optional refinement on a Group, per §5.1.
// SubtypeNone (zero value) means "no subtype, group-level only".
type Subtype uint8

const (
	SubtypeNone Subtype = iota

	// session subtypes
	SubtypeSet
	SubtypeSetSearchPath
	SubtypeSetRole
	SubtypeSetSessionAuthorization
	SubtypeSetLocal
	SubtypeReset
	SubtypeResetAll
	SubtypeDiscard
	SubtypeDiscardAll
	SubtypeDiscardTemp
	SubtypeDiscardPlans
	SubtypeDiscardSequences
	SubtypeCancelRequest

	// schema_create
	SubtypeCreateTable
	SubtypeCreateIndex
	SubtypeCreateView
	SubtypeCreateSchema
	SubtypeCreateFunction
	SubtypeCreateMaterializedView
	SubtypeCreateExtension
	SubtypeCreateDatabase
	SubtypeCreatePublication

	// schema_alter
	SubtypeAlterPublication

	// schema_destroy
	SubtypeDropTable
	SubtypeDropDatabase
	SubtypeDropSchema
	SubtypeDropIndex
	SubtypeDropView
	SubtypeDropFunction
	SubtypeDropPublication
	SubtypeTruncate

	// privilege
	SubtypeGrant
	SubtypeRevoke
	SubtypeAlterRole
	SubtypeCreateRole
	SubtypeDropRole
	SubtypeAlterSystem
	SubtypeSecurityLabel

	// bulk_load
	SubtypeCopyFromStdin
	SubtypeCopyFromS3

	// bulk_export
	SubtypeCopyToStdout
	SubtypeUnloadToS3

	// procedural
	SubtypeFunctionCallProtocol
	SubtypeCall
	SubtypeDo
	SubtypeAnonymousBlock
	SubtypeDoOrAnon

	// unsafe_io
	SubtypeCreateSubscription
	SubtypeAlterSubscription
	SubtypeDropSubscription
	SubtypeCreateServer
	SubtypeAlterServer
	SubtypeDropServer
	SubtypeCreateUserMapping
	SubtypeAlterUserMapping
	SubtypeDropUserMapping
	SubtypeCreateTablespace
	SubtypeAlterTablespace
	SubtypeDropTablespace
	SubtypeCopyToPath
	SubtypeCopyFromPath
	SubtypeCopyToProgram
	SubtypeCopyFromProgram
	SubtypeLargeObjectIO
	SubtypeServerFileRead
	SubtypeDblinkCall
	SubtypeFdwAccess
)

type subtypeInfo struct {
	name   string
	parent Group
}

var subtypeTable = map[Subtype]subtypeInfo{
	SubtypeNone: {"", 0},

	SubtypeSet:                     {"set", GroupSession},
	SubtypeSetSearchPath:           {"set_search_path", GroupSession},
	SubtypeSetRole:                 {"set_role", GroupSession},
	SubtypeSetSessionAuthorization: {"set_session_authorization", GroupSession},
	SubtypeSetLocal:                {"set_local", GroupSession},
	SubtypeReset:                   {"reset", GroupSession},
	SubtypeResetAll:                {"reset_all", GroupSession},
	SubtypeDiscard:                 {"discard", GroupSession},
	SubtypeDiscardAll:              {"discard_all", GroupSession},
	SubtypeDiscardTemp:             {"discard_temp", GroupSession},
	SubtypeDiscardPlans:            {"discard_plans", GroupSession},
	SubtypeDiscardSequences:        {"discard_sequences", GroupSession},
	SubtypeCancelRequest:           {"cancel_request", GroupSession},

	SubtypeCreateTable:            {"create_table", GroupSchemaCreate},
	SubtypeCreateIndex:            {"create_index", GroupSchemaCreate},
	SubtypeCreateView:             {"create_view", GroupSchemaCreate},
	SubtypeCreateSchema:           {"create_schema", GroupSchemaCreate},
	SubtypeCreateFunction:         {"create_function", GroupSchemaCreate},
	SubtypeCreateMaterializedView: {"create_materialized_view", GroupSchemaCreate},
	SubtypeCreateExtension:        {"create_extension", GroupSchemaCreate},
	SubtypeCreateDatabase:         {"create_database", GroupSchemaCreate},
	SubtypeCreatePublication:      {"create_publication", GroupSchemaCreate},

	SubtypeAlterPublication: {"alter_publication", GroupSchemaAlter},

	SubtypeDropTable:       {"drop_table", GroupSchemaDestroy},
	SubtypeDropDatabase:    {"drop_database", GroupSchemaDestroy},
	SubtypeDropSchema:      {"drop_schema", GroupSchemaDestroy},
	SubtypeDropIndex:       {"drop_index", GroupSchemaDestroy},
	SubtypeDropView:        {"drop_view", GroupSchemaDestroy},
	SubtypeDropFunction:    {"drop_function", GroupSchemaDestroy},
	SubtypeDropPublication: {"drop_publication", GroupSchemaDestroy},
	SubtypeTruncate:        {"truncate", GroupSchemaDestroy},

	SubtypeGrant:         {"grant", GroupPrivilege},
	SubtypeRevoke:        {"revoke", GroupPrivilege},
	SubtypeAlterRole:     {"alter_role", GroupPrivilege},
	SubtypeCreateRole:    {"create_role", GroupPrivilege},
	SubtypeDropRole:      {"drop_role", GroupPrivilege},
	SubtypeAlterSystem:   {"alter_system", GroupPrivilege},
	SubtypeSecurityLabel: {"security_label", GroupPrivilege},

	SubtypeCopyFromStdin: {"copy_from_stdin", GroupBulkLoad},
	SubtypeCopyFromS3:    {"copy_from_s3", GroupBulkLoad},

	SubtypeCopyToStdout: {"copy_to_stdout", GroupBulkExport},
	SubtypeUnloadToS3:   {"unload_to_s3", GroupBulkExport},

	SubtypeFunctionCallProtocol: {"function_call_protocol", GroupProcedural},
	SubtypeCall:                 {"call", GroupProcedural},
	SubtypeDo:                   {"do", GroupProcedural},
	SubtypeAnonymousBlock:       {"anonymous_block", GroupProcedural},
	SubtypeDoOrAnon:             {"do_or_anon", GroupProcedural},

	SubtypeCreateSubscription: {"create_subscription", GroupUnsafeIO},
	SubtypeAlterSubscription:  {"alter_subscription", GroupUnsafeIO},
	SubtypeDropSubscription:   {"drop_subscription", GroupUnsafeIO},
	SubtypeCreateServer:       {"create_server", GroupUnsafeIO},
	SubtypeAlterServer:        {"alter_server", GroupUnsafeIO},
	SubtypeDropServer:         {"drop_server", GroupUnsafeIO},
	SubtypeCreateUserMapping:  {"create_user_mapping", GroupUnsafeIO},
	SubtypeAlterUserMapping:   {"alter_user_mapping", GroupUnsafeIO},
	SubtypeDropUserMapping:    {"drop_user_mapping", GroupUnsafeIO},
	SubtypeCreateTablespace:   {"create_tablespace", GroupUnsafeIO},
	SubtypeAlterTablespace:    {"alter_tablespace", GroupUnsafeIO},
	SubtypeDropTablespace:     {"drop_tablespace", GroupUnsafeIO},
	SubtypeCopyToPath:         {"copy_to_path", GroupUnsafeIO},
	SubtypeCopyFromPath:       {"copy_from_path", GroupUnsafeIO},
	SubtypeCopyToProgram:      {"copy_to_program", GroupUnsafeIO},
	SubtypeCopyFromProgram:    {"copy_from_program", GroupUnsafeIO},
	SubtypeLargeObjectIO:      {"large_object_io", GroupUnsafeIO},
	SubtypeServerFileRead:     {"server_file_read", GroupUnsafeIO},
	SubtypeDblinkCall:         {"dblink_call", GroupUnsafeIO},
	SubtypeFdwAccess:          {"fdw_access", GroupUnsafeIO},
}

func (s Subtype) String() string {
	if info, ok := subtypeTable[s]; ok {
		return info.name
	}
	return ""
}

// Group returns the parent Group this subtype refines. Returns 0 for SubtypeNone.
func (s Subtype) Group() Group {
	if info, ok := subtypeTable[s]; ok {
		return info.parent
	}
	return 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/db/effects/... -run Subtype -v`
Expected: PASS, both tests.

- [ ] **Step 5: Commit**

```bash
git add internal/db/effects/subtype.go internal/db/effects/subtype_test.go
git commit -m "feat(db/effects): add Subtype enum with parent-group mapping"
```

---

## Task 4: Alias map + ExpandAliases

**Files:**
- Create: `internal/db/effects/alias.go`
- Test: `internal/db/effects/alias_test.go`

§5.4 alias table. R23 callout: `CREATE` does not expand to `INSERT`. Aliases expand at policy load time.

- [ ] **Step 1: Write the failing test**

```go
// internal/db/effects/alias_test.go
package effects

import (
	"reflect"
	"sort"
	"testing"
)

func sortedGroups(gs []Group) []Group {
	out := append([]Group(nil), gs...)
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

func TestExpandAliases_SimpleAliases(t *testing.T) {
	cases := []struct {
		alias string
		want  []Group
	}{
		{"READ", []Group{GroupRead}},
		{"INSERT", []Group{GroupWrite}},
		{"UPDATE", []Group{GroupModify}},
		{"DELETE", []Group{GroupDelete}},
		{"REMOVE", []Group{GroupDelete}},
		{"CREATE", []Group{GroupSchemaCreate}}, // R23: NOT INSERT
		{"DROP", []Group{GroupSchemaDestroy}},
		{"ALTER", []Group{GroupSchemaAlter}},
		{"TRUNCATE", []Group{GroupSchemaDestroy}}, // also tracks subtype but expansion is to group
		{"LOAD", []Group{GroupBulkLoad}},
		{"MAINTENANCE", []Group{GroupMaintenance}},
		{"LOCK_TABLES", []Group{GroupLock}},
		{"LISTEN_NOTIFY", []Group{GroupNotify}},
	}
	for _, tc := range cases {
		got, ok := ExpandAlias(tc.alias)
		if !ok {
			t.Fatalf("ExpandAlias(%q) returned ok=false", tc.alias)
		}
		if !reflect.DeepEqual(sortedGroups(got), sortedGroups(tc.want)) {
			t.Errorf("ExpandAlias(%q) = %v, want %v", tc.alias, got, tc.want)
		}
	}
}

func TestExpandAliases_CompoundAliases(t *testing.T) {
	cases := []struct {
		alias string
		want  []Group
	}{
		{"EXPORT", []Group{GroupBulkExport, GroupUnsafeIO}},
		{"MUTATE", []Group{GroupWrite, GroupModify, GroupDelete}},
		{"SCHEMA", []Group{GroupSchemaCreate, GroupSchemaAlter, GroupSchemaDestroy}},
		{"DANGEROUS", []Group{GroupSchemaDestroy, GroupPrivilege, GroupUnsafeIO, GroupProcedural, GroupBulkExport, GroupLock}},
	}
	for _, tc := range cases {
		got, ok := ExpandAlias(tc.alias)
		if !ok {
			t.Fatalf("ExpandAlias(%q) returned ok=false", tc.alias)
		}
		if !reflect.DeepEqual(sortedGroups(got), sortedGroups(tc.want)) {
			t.Errorf("ExpandAlias(%q) = %v, want %v", tc.alias, got, tc.want)
		}
	}
}

func TestExpandAliases_Wildcard(t *testing.T) {
	got, ok := ExpandAlias("*")
	if !ok {
		t.Fatal("ExpandAlias(*) returned ok=false")
	}
	for _, g := range got {
		if g == GroupUnknown {
			t.Errorf("ExpandAlias(*) must not include GroupUnknown")
		}
	}
	if len(got) != 17 { // 18 groups minus unknown
		t.Errorf("ExpandAlias(*) returned %d groups, want 17", len(got))
	}
}

func TestExpandAliases_CanonicalGroupNamePassthrough(t *testing.T) {
	// A canonical lowercase group name like "read" should be a valid token too.
	got, ok := ExpandAlias("read")
	if !ok {
		t.Fatal("canonical lowercase group name should resolve")
	}
	if !reflect.DeepEqual(got, []Group{GroupRead}) {
		t.Errorf("ExpandAlias(read) = %v, want [GroupRead]", got)
	}
}

func TestExpandAliases_Unknown(t *testing.T) {
	if _, ok := ExpandAlias("FAKE"); ok {
		t.Error("ExpandAlias(FAKE) should fail")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/db/effects/... -run ExpandAliases -v`
Expected: FAIL - `ExpandAlias` undefined.

- [ ] **Step 3: Write minimal implementation**

```go
// internal/db/effects/alias.go
package effects

// aliasTable maps uppercase alias tokens to the groups they expand to.
// Per §5.4: CREATE does NOT expand to GroupWrite (R23 callout).
var aliasTable = map[string][]Group{
	"READ":          {GroupRead},
	"INSERT":        {GroupWrite},
	"UPDATE":        {GroupModify},
	"DELETE":        {GroupDelete},
	"REMOVE":        {GroupDelete},
	"CREATE":        {GroupSchemaCreate},
	"DROP":          {GroupSchemaDestroy},
	"ALTER":         {GroupSchemaAlter},
	"TRUNCATE":      {GroupSchemaDestroy},
	"EXPORT":        {GroupBulkExport, GroupUnsafeIO},
	"LOAD":          {GroupBulkLoad},
	"MUTATE":        {GroupWrite, GroupModify, GroupDelete},
	"SCHEMA":        {GroupSchemaCreate, GroupSchemaAlter, GroupSchemaDestroy},
	"MAINTENANCE":   {GroupMaintenance},
	"LOCK_TABLES":   {GroupLock},
	"LISTEN_NOTIFY": {GroupNotify},
	"DANGEROUS":     {GroupSchemaDestroy, GroupPrivilege, GroupUnsafeIO, GroupProcedural, GroupBulkExport, GroupLock},
}

// ExpandAlias resolves an operator-written token to a list of canonical Groups.
// Accepts uppercase aliases ("READ", "MUTATE", "DANGEROUS"), the wildcard "*"
// (all groups except GroupUnknown), or canonical lowercase group names ("read").
// Returns ok=false on unknown tokens.
func ExpandAlias(token string) ([]Group, bool) {
	if token == "*" {
		out := make([]Group, 0, len(groupTable)-1)
		for g := range groupTable {
			if g != GroupUnknown {
				out = append(out, g)
			}
		}
		return out, true
	}
	if groups, ok := aliasTable[token]; ok {
		// return a copy so callers cannot mutate the table
		return append([]Group(nil), groups...), true
	}
	if g, ok := ParseGroup(token); ok {
		return []Group{g}, true
	}
	return nil, false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/db/effects/... -run ExpandAliases -v`
Expected: PASS, all five tests.

- [ ] **Step 5: Commit**

```bash
git add internal/db/effects/alias.go internal/db/effects/alias_test.go
git commit -m "feat(db/effects): add alias expansion per spec §5.4"
```

---

## Task 5: ObjectRef sum type

**Files:**
- Create: `internal/db/effects/object.go`
- Test: `internal/db/effects/object_test.go`

§6.4 object kinds. ObjectRef carries kind + the kind-specific subset of fields. One JSON shape, validated at construction.

- [ ] **Step 1: Write the failing test**

```go
// internal/db/effects/object_test.go
package effects

import (
	"encoding/json"
	"testing"
)

func TestObjectRef_TableMarshal(t *testing.T) {
	ref := ObjectRef{Kind: ObjectTable, Schema: "public", Name: "users"}
	got, err := json.Marshal(ref)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	want := `{"kind":"table","schema":"public","name":"users"}`
	if string(got) != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestObjectRef_ExternalEndpoint(t *testing.T) {
	ref := ObjectRef{Kind: ObjectExternalEndpoint, Host: "upstream.example", Port: 5432}
	got, err := json.Marshal(ref)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	want := `{"kind":"external_endpoint","host":"upstream.example","port":5432}`
	if string(got) != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestObjectRef_FilesystemPath(t *testing.T) {
	ref := ObjectRef{Kind: ObjectFilesystemPath, Path: "/tmp/dump.csv"}
	got, _ := json.Marshal(ref)
	want := `{"kind":"filesystem_path","path":"/tmp/dump.csv"}`
	if string(got) != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestObjectRef_Program(t *testing.T) {
	ref := ObjectRef{Kind: ObjectProgram, Argv0: "/usr/bin/curl"}
	got, _ := json.Marshal(ref)
	want := `{"kind":"program","argv0":"/usr/bin/curl"}`
	if string(got) != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestObjectRef_NamedClusterObject(t *testing.T) {
	ref := ObjectRef{Kind: ObjectSubscription, Name: "sub_orders"}
	got, _ := json.Marshal(ref)
	want := `{"kind":"subscription","name":"sub_orders"}`
	if string(got) != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestObjectRef_RoundTrip(t *testing.T) {
	cases := []ObjectRef{
		{Kind: ObjectTable, Schema: "public", Name: "users"},
		{Kind: ObjectTable, Schema: "", Name: "users"}, // unqualified
		{Kind: ObjectExternalEndpoint, Host: "h", Port: 1234},
		{Kind: ObjectFilesystemPath, Path: "/p"},
		{Kind: ObjectProgram, Argv0: "/x"},
		{Kind: ObjectSubscription, Name: "s"},
	}
	for _, in := range cases {
		raw, err := json.Marshal(in)
		if err != nil {
			t.Fatalf("Marshal(%v): %v", in, err)
		}
		var out ObjectRef
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatalf("Unmarshal(%s): %v", raw, err)
		}
		if out != in {
			t.Errorf("round-trip mismatch: in=%v out=%v", in, out)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/db/effects/... -run ObjectRef -v`
Expected: FAIL - `ObjectRef`, `Object*` constants undefined.

- [ ] **Step 3: Write minimal implementation**

```go
// internal/db/effects/object.go
package effects

import "encoding/json"

// ObjectKind identifies the schema of an ObjectRef per §6.4.
type ObjectKind uint8

const (
	ObjectTable ObjectKind = iota + 1
	ObjectView
	ObjectFunction
	ObjectSchema
	ObjectIndex
	ObjectSequence
	ObjectExternalEndpoint
	ObjectFilesystemPath
	ObjectProgram
	ObjectSubscription
	ObjectPublication
	ObjectServer
	ObjectUserMapping
	ObjectTablespace
	ObjectGUC
	ObjectRole
)

var objectKindNames = map[ObjectKind]string{
	ObjectTable:            "table",
	ObjectView:             "view",
	ObjectFunction:         "function",
	ObjectSchema:           "schema",
	ObjectIndex:            "index",
	ObjectSequence:         "sequence",
	ObjectExternalEndpoint: "external_endpoint",
	ObjectFilesystemPath:   "filesystem_path",
	ObjectProgram:          "program",
	ObjectSubscription:     "subscription",
	ObjectPublication:      "publication",
	ObjectServer:           "server",
	ObjectUserMapping:      "user_mapping",
	ObjectTablespace:       "tablespace",
	ObjectGUC:              "guc",
	ObjectRole:             "role",
}

func (k ObjectKind) String() string {
	if name, ok := objectKindNames[k]; ok {
		return name
	}
	return ""
}

// ObjectRef references one named object referenced by an Effect, per §6.4.
// Fields are kind-specific; consumers should read only those for the active Kind.
// JSON encoding emits only fields populated for the active Kind.
//
// Note: for unqualified table references the spec calls for schema=null in JSON
// (§6.1). Phase 1 emits the field as absent (omitempty) - the null-vs-absent
// distinction is finalized in Plan 04 when DBEvent JSON ships.
type ObjectRef struct {
	Kind   ObjectKind
	Schema string // table/view/function/index/sequence
	Name   string // any named object
	Host   string // external_endpoint
	Port   int    // external_endpoint
	Path   string // filesystem_path
	Argv0  string // program
}

type objectRefJSON struct {
	Kind   string `json:"kind"`
	Schema string `json:"schema,omitempty"`
	Name   string `json:"name,omitempty"`
	Host   string `json:"host,omitempty"`
	Port   int    `json:"port,omitempty"`
	Path   string `json:"path,omitempty"`
	Argv0  string `json:"argv0,omitempty"`
}

// MarshalJSON emits only the fields meaningful for r.Kind.
func (r ObjectRef) MarshalJSON() ([]byte, error) {
	out := objectRefJSON{Kind: r.Kind.String()}
	switch r.Kind {
	case ObjectTable, ObjectView, ObjectFunction, ObjectIndex, ObjectSequence:
		out.Schema = r.Schema
		out.Name = r.Name
	case ObjectExternalEndpoint:
		out.Host = r.Host
		out.Port = r.Port
	case ObjectFilesystemPath:
		out.Path = r.Path
	case ObjectProgram:
		out.Argv0 = r.Argv0
	default:
		out.Name = r.Name
	}
	return json.Marshal(out)
}

// UnmarshalJSON parses the kind-discriminated form back into an ObjectRef.
func (r *ObjectRef) UnmarshalJSON(b []byte) error {
	var raw objectRefJSON
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	for k, name := range objectKindNames {
		if name == raw.Kind {
			r.Kind = k
			break
		}
	}
	r.Schema = raw.Schema
	r.Name = raw.Name
	r.Host = raw.Host
	r.Port = raw.Port
	r.Path = raw.Path
	r.Argv0 = raw.Argv0
	return nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/db/effects/... -run ObjectRef -v`
Expected: PASS, all six tests.

- [ ] **Step 5: Commit**

```bash
git add internal/db/effects/object.go internal/db/effects/object_test.go
git commit -m "feat(db/effects): add ObjectRef sum type per spec §6.4"
```

---

## Task 6: Resolution enum + Fold

**Files:**
- Create: `internal/db/effects/resolution.go`
- Test: `internal/db/effects/resolution_test.go`

§6.1 + §6.2. Five resolution tags ordered best-to-worst. `Fold` returns the worst (least-confident) of a set.

- [ ] **Step 1: Write the failing test**

```go
// internal/db/effects/resolution_test.go
package effects

import "testing"

func TestResolution_String(t *testing.T) {
	cases := []struct {
		r Resolution
		s string
	}{
		{ResolutionQualified, "qualified_syntactic"},
		{ResolutionUnqualified, "unqualified_syntactic"},
		{ResolutionAmbiguousAfterSearchPath, "ambiguous_after_search_path"},
		{ResolutionMaybeTempShadowed, "maybe_temp_shadowed"},
		{ResolutionUnresolved, "unresolved"},
	}
	for _, tc := range cases {
		if got := tc.r.String(); got != tc.s {
			t.Errorf("Resolution(%d).String() = %q, want %q", tc.r, got, tc.s)
		}
	}
}

func TestResolution_Fold(t *testing.T) {
	cases := []struct {
		in   []Resolution
		want Resolution
	}{
		{[]Resolution{ResolutionQualified}, ResolutionQualified},
		{[]Resolution{ResolutionQualified, ResolutionUnqualified}, ResolutionUnqualified},
		{[]Resolution{ResolutionQualified, ResolutionMaybeTempShadowed, ResolutionAmbiguousAfterSearchPath}, ResolutionMaybeTempShadowed},
		{[]Resolution{ResolutionUnresolved, ResolutionQualified}, ResolutionUnresolved},
	}
	for _, tc := range cases {
		if got := Fold(tc.in); got != tc.want {
			t.Errorf("Fold(%v) = %s, want %s", tc.in, got, tc.want)
		}
	}
}

func TestResolution_FoldEmptyIsQualified(t *testing.T) {
	// empty effect list = no objects = best-case confidence; fold should not panic
	if got := Fold(nil); got != ResolutionQualified {
		t.Errorf("Fold(nil) = %s, want qualified_syntactic", got)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/db/effects/... -run Resolution -v`
Expected: FAIL - `Resolution`, `Fold` undefined.

- [ ] **Step 3: Write minimal implementation**

```go
// internal/db/effects/resolution.go
package effects

// Resolution tags an Effect's object set with a confidence level per §6.1.
// Ordering is best-to-worst (lower numeric value = higher confidence),
// matching the §6.2 fold rule:
//
//   qualified_syntactic > unqualified_syntactic > ambiguous_after_search_path
//   > maybe_temp_shadowed > unresolved
type Resolution uint8

const (
	ResolutionQualified Resolution = iota
	ResolutionUnqualified
	ResolutionAmbiguousAfterSearchPath
	ResolutionMaybeTempShadowed
	ResolutionUnresolved
)

var resolutionNames = [...]string{
	ResolutionQualified:                "qualified_syntactic",
	ResolutionUnqualified:              "unqualified_syntactic",
	ResolutionAmbiguousAfterSearchPath: "ambiguous_after_search_path",
	ResolutionMaybeTempShadowed:        "maybe_temp_shadowed",
	ResolutionUnresolved:               "unresolved",
}

func (r Resolution) String() string {
	if int(r) >= len(resolutionNames) {
		return ""
	}
	return resolutionNames[r]
}

// Fold returns the worst (least-confident) Resolution in the set, per §6.2.
// Empty input returns ResolutionQualified (no objects = no doubt).
func Fold(rs []Resolution) Resolution {
	worst := ResolutionQualified
	for _, r := range rs {
		if r > worst {
			worst = r
		}
	}
	return worst
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/db/effects/... -run Resolution -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/db/effects/resolution.go internal/db/effects/resolution_test.go
git commit -m "feat(db/effects): add Resolution enum + Fold per spec §6.1-6.2"
```

---

## Task 7: Effect struct + canonical ordering

**Files:**
- Create: `internal/db/effects/effect.go`
- Test: `internal/db/effects/effect_test.go`

§5.2 ordering with R5 tie-break. Canonical group order within each tier:

- Critical: `unknown > unsafe_io > schema_destroy > bulk_export > privilege`
- High: `delete > schema_create > schema_alter > bulk_load > procedural`
- Medium: `modify > write > maintenance > lock`
- Low: `read > transaction > session > notify`

The order function is **stable**: equal-priority effects retain their input position (AST traversal order).

- [ ] **Step 1: Write the failing test**

```go
// internal/db/effects/effect_test.go
package effects

import (
	"reflect"
	"testing"
)

func e(g Group, sub Subtype) Effect {
	return Effect{Group: g, Subtype: sub, Resolution: ResolutionQualified}
}

func groupsOf(es []Effect) []Group {
	out := make([]Group, len(es))
	for i, eff := range es {
		out[i] = eff.Group
	}
	return out
}

func TestEffect_OrderHighestTierFirst(t *testing.T) {
	// COPY (SELECT * FROM customers) TO STDOUT → bulk_export (critical) beats read (low)
	in := []Effect{e(GroupRead, SubtypeNone), e(GroupBulkExport, SubtypeCopyToStdout)}
	Order(in)
	want := []Group{GroupBulkExport, GroupRead}
	if !reflect.DeepEqual(groupsOf(in), want) {
		t.Errorf("got %v, want %v", groupsOf(in), want)
	}
}

func TestEffect_OrderTieBreakCritical(t *testing.T) {
	// COPY customers TO '/tmp/dump.csv' → unsafe_io and bulk_export both critical;
	// canonical group order puts unsafe_io first.
	in := []Effect{
		e(GroupBulkExport, SubtypeNone),
		e(GroupUnsafeIO, SubtypeCopyToPath),
		e(GroupRead, SubtypeNone),
	}
	Order(in)
	want := []Group{GroupUnsafeIO, GroupBulkExport, GroupRead}
	if !reflect.DeepEqual(groupsOf(in), want) {
		t.Errorf("got %v, want %v", groupsOf(in), want)
	}
}

func TestEffect_OrderTieBreakHigh(t *testing.T) {
	// CTE delete + create_table both high tier; delete > schema_create per §5.2.
	in := []Effect{e(GroupSchemaCreate, SubtypeNone), e(GroupDelete, SubtypeNone)}
	Order(in)
	want := []Group{GroupDelete, GroupSchemaCreate}
	if !reflect.DeepEqual(groupsOf(in), want) {
		t.Errorf("got %v, want %v", groupsOf(in), want)
	}
}

func TestEffect_OrderUnknownIsHighestCritical(t *testing.T) {
	// unknown leads even other critical groups
	in := []Effect{e(GroupUnsafeIO, SubtypeNone), e(GroupUnknown, SubtypeNone)}
	Order(in)
	want := []Group{GroupUnknown, GroupUnsafeIO}
	if !reflect.DeepEqual(groupsOf(in), want) {
		t.Errorf("got %v, want %v", groupsOf(in), want)
	}
}

func TestEffect_OrderStableForEqualPriority(t *testing.T) {
	// Two effects with the exact same group keep input order (AST traversal stability).
	a := Effect{Group: GroupRead, Subtype: SubtypeNone, Objects: []ObjectRef{{Kind: ObjectTable, Name: "a"}}}
	b := Effect{Group: GroupRead, Subtype: SubtypeNone, Objects: []ObjectRef{{Kind: ObjectTable, Name: "b"}}}
	in := []Effect{a, b}
	Order(in)
	if in[0].Objects[0].Name != "a" || in[1].Objects[0].Name != "b" {
		t.Errorf("stable order broken: %v", in)
	}
}

func TestEffect_OrderEmpty(t *testing.T) {
	Order(nil) // must not panic
	Order([]Effect{})
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/db/effects/... -run Effect_Order -v`
Expected: FAIL - `Effect`, `Order` undefined.

- [ ] **Step 3: Write minimal implementation**

```go
// internal/db/effects/effect.go
package effects

import "sort"

// Effect is one classified consequence of a statement, per §5.2.
type Effect struct {
	Group      Group
	Subtype    Subtype
	Objects    []ObjectRef
	Resolution Resolution
}

// canonicalGroupRank returns the within-tier ordering position per §5.2 R5.
// Lower rank = higher priority within the same tier (= sorted first).
// Groups not listed for their tier sort after listed groups, in Group enum order.
var canonicalGroupRank = map[Group]int{
	// critical: unknown > unsafe_io > schema_destroy > bulk_export > privilege
	GroupUnknown:       0,
	GroupUnsafeIO:      1,
	GroupSchemaDestroy: 2,
	GroupBulkExport:    3,
	GroupPrivilege:     4,
	// high: delete > schema_create > schema_alter > bulk_load > procedural
	GroupDelete:       0,
	GroupSchemaCreate: 1,
	GroupSchemaAlter:  2,
	GroupBulkLoad:     3,
	GroupProcedural:   4,
	// medium: modify > write > maintenance > lock
	GroupModify:      0,
	GroupWrite:       1,
	GroupMaintenance: 2,
	GroupLock:        3,
	// low: read > transaction > session > notify
	GroupRead:        0,
	GroupTransaction: 1,
	GroupSession:     2,
	GroupNotify:      3,
}

// Order sorts the slice into canonical effect order per §5.2:
//   1. Highest risk tier first.
//   2. Within tier, fixed canonical group order.
//   3. Stable for equal priority (preserves input order).
//
// Ordering is in-place. The first element after sorting is the primary effect.
func Order(effects []Effect) {
	sort.SliceStable(effects, func(i, j int) bool {
		ti, tj := effects[i].Group.RiskTier(), effects[j].Group.RiskTier()
		if ti != tj {
			return ti > tj // higher tier value sorts first
		}
		return canonicalGroupRank[effects[i].Group] < canonicalGroupRank[effects[j].Group]
	})
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/db/effects/... -run Effect_Order -v`
Expected: PASS, all six tests.

- [ ] **Step 5: Commit**

```bash
git add internal/db/effects/effect.go internal/db/effects/effect_test.go
git commit -m "feat(db/effects): add Effect struct and canonical Order per spec §5.2"
```

---

## Task 8: ClassifiedStatement struct

**Files:**
- Create: `internal/db/effects/statement.go`
- Test: `internal/db/effects/statement_test.go`

§5.2 + §6.2 + §7.8. ClassifiedStatement is the value the classifier (Plan 03) produces and the evaluator (Plan 02) consumes. It carries the ordered effects, the folded top-level resolution, the parser backend that produced it, and the raw verb hint.

- [ ] **Step 1: Write the failing test**

```go
// internal/db/effects/statement_test.go
package effects

import "testing"

func TestClassifiedStatement_Primary(t *testing.T) {
	s := ClassifiedStatement{
		Effects: []Effect{
			{Group: GroupBulkExport, Subtype: SubtypeCopyToStdout},
			{Group: GroupRead},
		},
		ParserBackend: ParserBackendLibPgQuery,
	}
	p, ok := s.Primary()
	if !ok || p.Group != GroupBulkExport {
		t.Errorf("Primary = %v, ok=%v; want bulk_export, true", p, ok)
	}
}

func TestClassifiedStatement_PrimaryEmpty(t *testing.T) {
	var s ClassifiedStatement
	if _, ok := s.Primary(); ok {
		t.Error("Primary on empty statement should return ok=false")
	}
}

func TestClassifiedStatement_FoldResolution(t *testing.T) {
	s := ClassifiedStatement{
		Effects: []Effect{
			{Group: GroupWrite, Resolution: ResolutionQualified},
			{Group: GroupRead, Resolution: ResolutionAmbiguousAfterSearchPath},
		},
	}
	if got := s.FoldResolution(); got != ResolutionAmbiguousAfterSearchPath {
		t.Errorf("FoldResolution() = %s, want ambiguous_after_search_path", got)
	}
}

func TestParserBackend_String(t *testing.T) {
	cases := map[ParserBackend]string{
		ParserBackendLibPgQuery: "libpg_query",
		ParserBackendPureGo:     "pure_go",
		ParserBackendUnknown:    "",
	}
	for b, name := range cases {
		if got := b.String(); got != name {
			t.Errorf("ParserBackend(%d).String() = %q, want %q", b, got, name)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/db/effects/... -run ClassifiedStatement -v`
Expected: FAIL - `ClassifiedStatement`, `ParserBackend` undefined.

- [ ] **Step 3: Write minimal implementation**

```go
// internal/db/effects/statement.go
package effects

// ParserBackend identifies which parser produced a classification, per §7.8.
type ParserBackend uint8

const (
	ParserBackendUnknown ParserBackend = iota
	ParserBackendLibPgQuery
	ParserBackendPureGo
)

func (b ParserBackend) String() string {
	switch b {
	case ParserBackendLibPgQuery:
		return "libpg_query"
	case ParserBackendPureGo:
		return "pure_go"
	default:
		return ""
	}
}

// ClassifiedStatement is the output of the Postgres classifier (Plan 03) and
// the input to the policy evaluator (Plan 02). Effects must be in canonical
// order per Order(); the first entry is the primary effect.
type ClassifiedStatement struct {
	Effects       []Effect
	RawVerb       string        // hint, e.g. "CREATE_SUBSCRIPTION" - informational only
	ParserBackend ParserBackend // which parser produced this
}

// Primary returns the first (canonical) effect. ok=false on empty effects list.
func (s ClassifiedStatement) Primary() (Effect, bool) {
	if len(s.Effects) == 0 {
		return Effect{}, false
	}
	return s.Effects[0], true
}

// FoldResolution returns the worst (least-confident) Resolution across all
// effects, per §6.2. Returns ResolutionQualified if Effects is empty.
func (s ClassifiedStatement) FoldResolution() Resolution {
	rs := make([]Resolution, len(s.Effects))
	for i, e := range s.Effects {
		rs[i] = e.Resolution
	}
	return Fold(rs)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/db/effects/... -run ClassifiedStatement -v`
Expected: PASS.

Run the whole `effects` package: `go test ./internal/db/effects/...`
Expected: PASS, every test in the package.

- [ ] **Step 5: Commit**

```bash
git add internal/db/effects/statement.go internal/db/effects/statement_test.go
git commit -m "feat(db/effects): add ClassifiedStatement and ParserBackend"
```

---

## Task 9: DBEvent skeleton + Redaction enum

**Files:**
- Create: `internal/db/events/event.go`
- Create: `internal/db/events/redaction.go`
- Test: `internal/db/events/event_test.go`

§8 normalized DBEvent + R4 redaction enum. Skeleton only - no emission logic; that lands in Plan 04.

- [ ] **Step 1: Write the failing test**

```go
// internal/db/events/event_test.go
package events

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/nla-aep/aep-caw-framework/internal/db/effects"
)

func TestRedaction_String(t *testing.T) {
	cases := []struct {
		r Redaction
		s string
	}{
		{RedactionNone, "none"},
		{RedactionParametersRedacted, "parameters_redacted"},
		{RedactionFull, "full"},
	}
	for _, tc := range cases {
		if got := tc.r.String(); got != tc.s {
			t.Errorf("Redaction(%d).String() = %q, want %q", tc.r, got, tc.s)
		}
	}
}

func TestParseRedaction(t *testing.T) {
	cases := map[string]Redaction{
		"none":                RedactionNone,
		"parameters_redacted": RedactionParametersRedacted,
		"full":                RedactionFull,
	}
	for in, want := range cases {
		got, ok := ParseRedaction(in)
		if !ok || got != want {
			t.Errorf("ParseRedaction(%q) = %v, %v; want %v, true", in, got, ok, want)
		}
	}
	if _, ok := ParseRedaction("garbage"); ok {
		t.Error("ParseRedaction(garbage) should fail")
	}
}

func TestDBEvent_JSONRoundTrip(t *testing.T) {
	in := DBEvent{
		EventID:    "01HQ-fake",
		SessionID:  "sess-1",
		Timestamp:  time.Date(2026, 5, 8, 10, 0, 0, 0, time.UTC),
		DBService:  "appdb",
		DBFamily:   "postgres",
		DBDialect:  "postgres",
		Effects: []effects.Effect{{Group: effects.GroupRead, Resolution: effects.ResolutionQualified}},
		StatementRedaction: RedactionParametersRedacted,
		ParserBackend:      effects.ParserBackendLibPgQuery,
	}
	raw, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var out DBEvent
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if out.EventID != in.EventID || out.DBService != in.DBService {
		t.Errorf("round-trip lost fields: %+v", out)
	}
	if out.StatementRedaction != RedactionParametersRedacted {
		t.Errorf("redaction lost: %v", out.StatementRedaction)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/db/events/... -v`
Expected: FAIL - `DBEvent`, `Redaction*` undefined.

- [ ] **Step 3: Write minimal implementation**

```go
// internal/db/events/redaction.go
package events

// Redaction is the statement-text redaction tier per §10.3 (R4: enum form).
// Default for new events is RedactionParametersRedacted.
type Redaction uint8

const (
	RedactionNone Redaction = iota
	RedactionParametersRedacted
	RedactionFull
)

var redactionNames = [...]string{
	RedactionNone:               "none",
	RedactionParametersRedacted: "parameters_redacted",
	RedactionFull:               "full",
}

func (r Redaction) String() string {
	if int(r) >= len(redactionNames) {
		return ""
	}
	return redactionNames[r]
}

// MarshalJSON / UnmarshalJSON: emit/parse the canonical lowercase string form.
func (r Redaction) MarshalJSON() ([]byte, error) {
	return []byte(`"` + r.String() + `"`), nil
}

func (r *Redaction) UnmarshalJSON(b []byte) error {
	if len(b) < 2 {
		return nil
	}
	parsed, ok := ParseRedaction(string(b[1 : len(b)-1]))
	if !ok {
		return errInvalidRedaction
	}
	*r = parsed
	return nil
}

func ParseRedaction(s string) (Redaction, bool) {
	for i, name := range redactionNames {
		if name == s {
			return Redaction(i), true
		}
	}
	return 0, false
}

var errInvalidRedaction = &redactionError{}

type redactionError struct{}

func (e *redactionError) Error() string { return "invalid redaction value" }
```

```go
// internal/db/events/event.go
package events

import (
	"time"

	"github.com/nla-aep/aep-caw-framework/internal/db/effects"
)

// DBEvent is the normalized audit event emitted per database statement, per §8.
// This is the skeleton; emission lands in Plan 04. Fields here are the v0.8
// schema; additional sub-structs (decision, result, tx_context) ship in Plan 04.
type DBEvent struct {
	EventID   string    `json:"event_id"`
	SessionID string    `json:"session_id"`
	CommandID string    `json:"command_id,omitempty"`
	Timestamp time.Time `json:"ts"`

	DBService       string `json:"db_service"`
	DBFamily        string `json:"db_family"`
	DBDialect       string `json:"db_dialect"`
	DBUser          string `json:"db_user,omitempty"`
	ApplicationName string `json:"application_name,omitempty"`
	ClientIdentity  string `json:"client_identity,omitempty"`

	Effects []effects.Effect `json:"effects"`

	OperationGroup    string         `json:"operation_group,omitempty"`
	OperationGroupID  uint8          `json:"operation_group_id,omitempty"`
	OperationSubtype  string         `json:"operation_subtype,omitempty"`
	RawVerb           string         `json:"raw_verb,omitempty"`
	ObjectResolution  string         `json:"object_resolution,omitempty"`

	StatementDigest    string    `json:"statement_digest,omitempty"`
	StatementText      string    `json:"statement_text,omitempty"`
	StatementRedaction Redaction `json:"statement_redaction"`

	ParserBackend effects.ParserBackend `json:"parser_backend,omitempty"`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/db/events/... -v`
Expected: PASS, three tests.

- [ ] **Step 5: Commit**

```bash
git add internal/db/events/event.go internal/db/events/redaction.go internal/db/events/event_test.go
git commit -m "feat(db/events): add DBEvent skeleton and Redaction enum"
```

---

## Task 10: db_services config schema

**Files:**
- Create: `internal/db/service/config.go`
- Test: `internal/db/service/config_test.go`

§9.1. Schema for the `db_services` block of policy YAML. Parse-only at this stage; the bundle generator (Plan 07) consumes the same struct.

- [ ] **Step 1: Write the failing test**

```go
// internal/db/service/config_test.go
package service

import (
	"testing"

	"gopkg.in/yaml.v3"
)

func TestParseConfig_Minimal(t *testing.T) {
	in := []byte(`
services:
  - name: appdb
    family: postgres
    dialect: postgres
    upstream:
      host: db.internal
      port: 5432
    listen:
      kind: unix
      path: /run/aep-caw/db/appdb.sock
    tls_mode: terminate_reissue
`)
	cfg, err := ParseConfig(in)
	if err != nil {
		t.Fatalf("ParseConfig: %v", err)
	}
	if len(cfg.Services) != 1 {
		t.Fatalf("got %d services, want 1", len(cfg.Services))
	}
	s := cfg.Services[0]
	if s.Name != "appdb" || s.Family != "postgres" || s.Dialect != "postgres" {
		t.Errorf("unexpected service: %+v", s)
	}
	if s.Upstream.Host != "db.internal" || s.Upstream.Port != 5432 {
		t.Errorf("unexpected upstream: %+v", s.Upstream)
	}
	if s.Listen.Kind != "unix" || s.Listen.Path != "/run/aep-caw/db/appdb.sock" {
		t.Errorf("unexpected listen: %+v", s.Listen)
	}
	if s.TLSMode != "terminate_reissue" {
		t.Errorf("unexpected tls mode: %s", s.TLSMode)
	}
}

func TestParseConfig_Validate_RejectsUnknownDialect(t *testing.T) {
	in := []byte(`
services:
  - name: appdb
    family: postgres
    dialect: oracle
    upstream: {host: x, port: 1}
    listen: {kind: unix, path: /x}
    tls_mode: passthrough
`)
	if _, err := ParseConfig(in); err == nil {
		t.Fatal("expected error for unknown dialect")
	}
}

func TestParseConfig_Validate_RejectsUnknownTLSMode(t *testing.T) {
	in := []byte(`
services:
  - name: appdb
    family: postgres
    dialect: postgres
    upstream: {host: x, port: 1}
    listen: {kind: unix, path: /x}
    tls_mode: bad
`)
	if _, err := ParseConfig(in); err == nil {
		t.Fatal("expected error for unknown tls_mode")
	}
}

func TestParseConfig_Validate_RejectsEmptyName(t *testing.T) {
	in := []byte(`
services:
  - name: ""
    family: postgres
    dialect: postgres
    upstream: {host: x, port: 1}
    listen: {kind: unix, path: /x}
    tls_mode: passthrough
`)
	if _, err := ParseConfig(in); err == nil {
		t.Fatal("expected error for empty name")
	}
}

func TestParseConfig_Validate_RejectsDuplicateNames(t *testing.T) {
	in := []byte(`
services:
  - {name: appdb, family: postgres, dialect: postgres, upstream: {host: x, port: 1}, listen: {kind: unix, path: /a}, tls_mode: passthrough}
  - {name: appdb, family: postgres, dialect: postgres, upstream: {host: x, port: 1}, listen: {kind: unix, path: /b}, tls_mode: passthrough}
`)
	if _, err := ParseConfig(in); err == nil {
		t.Fatal("expected error for duplicate names")
	}
}

func TestParseConfig_RoundTrip(t *testing.T) {
	original := Config{
		Services: []Service{{
			Name: "appdb", Family: "postgres", Dialect: "postgres",
			Upstream: Endpoint{Host: "db", Port: 5432},
			Listen:   Listener{Kind: "unix", Path: "/run/x"},
			TLSMode:  "passthrough",
		}},
	}
	raw, err := yaml.Marshal(original)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	parsed, err := ParseConfig(raw)
	if err != nil {
		t.Fatalf("ParseConfig: %v", err)
	}
	if len(parsed.Services) != 1 || parsed.Services[0].Name != "appdb" {
		t.Errorf("round-trip mismatch: %+v", parsed)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/db/service/... -v`
Expected: FAIL - `ParseConfig`, `Config`, `Service`, etc. undefined.

- [ ] **Step 3: Write minimal implementation**

```go
// internal/db/service/config.go
package service

import (
	"errors"
	"fmt"

	"gopkg.in/yaml.v3"
)

// Config is the top-level YAML schema for the `db_services` block per §9.1.
type Config struct {
	Services []Service `yaml:"services"`
}

// Service describes one declared database service. The supervisor uses this to
// install a Unix-socket listener and a destination rule that makes outbound
// access to (Upstream.Host, Upstream.Port) unavoidable for governed processes.
type Service struct {
	Name     string   `yaml:"name"`
	Family   string   `yaml:"family"`  // currently always "postgres"
	Dialect  string   `yaml:"dialect"` // postgres | aurora_postgres | redshift | cockroachdb
	Upstream Endpoint `yaml:"upstream"`
	Listen   Listener `yaml:"listen"`
	TLSMode  string   `yaml:"tls_mode"` // terminate_reissue | passthrough | terminate_plaintext_upstream
}

// Endpoint is a host:port pair - the upstream DB the proxy connects to.
type Endpoint struct {
	Host string `yaml:"host"`
	Port int    `yaml:"port"`
}

// Listener describes where the proxy accepts client connections.
// Phase 1 supports kind="unix" (path) and kind="tcp" (host, port).
type Listener struct {
	Kind string `yaml:"kind"`
	Path string `yaml:"path,omitempty"`
	Host string `yaml:"host,omitempty"`
	Port int    `yaml:"port,omitempty"`
}

var (
	validFamilies = map[string]bool{"postgres": true}
	validDialects = map[string]bool{
		"postgres":        true,
		"aurora_postgres": true,
		"redshift":        true,
		"cockroachdb":     true,
	}
	validTLSModes = map[string]bool{
		"terminate_reissue":           true,
		"passthrough":                 true,
		"terminate_plaintext_upstream": true,
	}
	validListenKinds = map[string]bool{"unix": true, "tcp": true}
)

// ParseConfig parses YAML bytes into a validated Config.
// Returns an error if any service entry is malformed; valid entries are not
// returned partially.
func ParseConfig(raw []byte) (Config, error) {
	var cfg Config
	if err := yaml.Unmarshal(raw, &cfg); err != nil {
		return Config{}, fmt.Errorf("yaml: %w", err)
	}
	if err := cfg.validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c Config) validate() error {
	seen := make(map[string]struct{}, len(c.Services))
	for i, s := range c.Services {
		if s.Name == "" {
			return fmt.Errorf("services[%d]: name is required", i)
		}
		if _, dup := seen[s.Name]; dup {
			return fmt.Errorf("services[%d]: duplicate service name %q", i, s.Name)
		}
		seen[s.Name] = struct{}{}
		if !validFamilies[s.Family] {
			return fmt.Errorf("services[%d] %s: family %q not supported", i, s.Name, s.Family)
		}
		if !validDialects[s.Dialect] {
			return fmt.Errorf("services[%d] %s: dialect %q not supported", i, s.Name, s.Dialect)
		}
		if !validTLSModes[s.TLSMode] {
			return fmt.Errorf("services[%d] %s: tls_mode %q not supported", i, s.Name, s.TLSMode)
		}
		if s.Upstream.Host == "" || s.Upstream.Port <= 0 {
			return fmt.Errorf("services[%d] %s: upstream host and port required", i, s.Name)
		}
		if !validListenKinds[s.Listen.Kind] {
			return fmt.Errorf("services[%d] %s: listen.kind %q not supported", i, s.Name, s.Listen.Kind)
		}
		if s.Listen.Kind == "unix" && s.Listen.Path == "" {
			return fmt.Errorf("services[%d] %s: listen.path required for kind=unix", i, s.Name)
		}
		if s.Listen.Kind == "tcp" && (s.Listen.Host == "" || s.Listen.Port <= 0) {
			return fmt.Errorf("services[%d] %s: listen.host and port required for kind=tcp", i, s.Name)
		}
	}
	return nil
}

// ErrNoServices is returned when the config block is empty.
var ErrNoServices = errors.New("no services declared")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/db/service/... -v`
Expected: PASS, six tests.

- [ ] **Step 5: Commit**

```bash
git add internal/db/service/config.go internal/db/service/config_test.go
git commit -m "feat(db/service): add db_services config schema and validation"
```

---

## Task 11: Final cross-platform build check + commit

- [ ] **Step 1: Run full Go test suite**

Run: `go test ./internal/db/...`
Expected: PASS, all packages.

- [ ] **Step 2: Verify cross-compile to Windows**

Run: `GOOS=windows go build ./...`
Expected: success, no output. CLAUDE.md requires this on every commit.

- [ ] **Step 3: Verify whole-tree build**

Run: `go build ./...`
Expected: success.

- [ ] **Step 4: No further commit needed**

The per-task commits already capture every change. This task is verification only.

---

## Cross-cutting notes for the implementer

**Don't add fields beyond what tests require.** Plan 02 will add Decision/RuleSet types in `internal/db/policy/`. Plan 04 will add emission and the missing DBEvent sub-structs (`Decision`, `Result`, `TXContext`, `TLSInfo`). Don't pre-build them here.

**Don't modify `internal/policy/`.** That registration hook is Plan 02's responsibility; this plan does not touch the existing policy engine.

**Don't add a `String()` method that implies behavior beyond display.** `Group.String()`, `Subtype.String()`, etc. are formatting only. The canonical names live in lookup tables, not in string-comparison logic. Plan 02's evaluator will compare against the table-keyed values, not against strings.

**Stable enum IDs are a wire-format commitment.** `Group.ID()` returns the §5 numeric ID and is part of the `DBEvent.operation_group_id` contract. Don't renumber existing `Group*` constants. New groups (none expected for Phase 1) get the next free ID.

**Test exhaustiveness over cleverness.** Where the spec lists tables (groups, subtypes, aliases), test every row. The cost is a long test file; the benefit is that a future spec rev that drops a row is caught instantly.

---

## Done definition

- All ten task suites pass.
- `go test ./internal/db/...` passes on Linux + macOS.
- `GOOS=windows go build ./...` passes (zero CGO, zero Linux-only syscalls in this plan).
- Eleven commits on the working branch, one per task plus a no-op verification step.
- Plan 02 (`db-plan-02-policy-evaluator.md`) is unblocked and can begin.
