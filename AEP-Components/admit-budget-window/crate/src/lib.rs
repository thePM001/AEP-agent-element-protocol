//! Sliding window budgets per agent and per wrap on the live Admit pass.
//!
//! Admit judges each proposed action on its own. A chain of actions that each
//! pass can still reach a forbidden outcome, such as data leaving in small
//! slices or an agent reaching for one new capability after another. This
//! crate keeps a window of what each agent and each wrap already spent and
//! closes a wall when the next action would push a budget past its limit.
//!
//! The limits are written in the budget GAP policy at
//! AEP-Policy-System/reference/budget.gap. Each constraint of that policy names
//! one scope (agent or wrap) and one dimension (volume_bytes, sensitivity or
//! novelty) and becomes one wall with the id policy:budget:<scope>_<dimension>.
//! The walls join the other product walls on the one collect-all AND, so the
//! budget adds walls and never changes how Admit combines them.
//!
//! Evaluation is pure. The walls read the ledger and the measured charge of the
//! proposed action. The live entry commits the charge into the ledger only
//! after Admit allows the action, beside Apply, so a denied action spends
//! nothing.
use aep_admit::AdmitWall;
use aep_policy_system_admit::{action_path_matches_prefix, parse_gap_text, scan_rules};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fs;
use std::path::Path;

/// The file stem of the budget GAP policy.
pub const STEM: &str = "budget";
/// Path of the budget GAP policy inside the policy system directory.
pub const POLICY_REL_PATH: &str = "reference/budget.gap";
/// Closed when the budget policy is present but its parameters or constraints cannot be read.
pub const WALL_PARAMETERS: &str = "policy:budget:parameters";
/// Wrap bucket of an action whose lattice node names no wrap.
pub const UNWRAPPED: &str = "unwrapped";

/// The scope a budget counts over.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    Agent,
    Wrap,
}

impl Scope {
    fn name(self) -> &'static str {
        match self {
            Scope::Agent => "agent",
            Scope::Wrap => "wrap",
        }
    }

    fn parse(text: &str) -> Option<Self> {
        match text {
            "agent" => Some(Scope::Agent),
            "wrap" => Some(Scope::Wrap),
            _ => None,
        }
    }
}

/// The quantity a budget counts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dimension {
    /// Bytes of the serialized event.
    VolumeBytes,
    /// Weighted sensitivity of the action path and of the content classes found in the event.
    Sensitivity,
    /// Targets the scope had not touched before.
    Novelty,
}

impl Dimension {
    fn name(self) -> &'static str {
        match self {
            Dimension::VolumeBytes => "volume_bytes",
            Dimension::Sensitivity => "sensitivity",
            Dimension::Novelty => "novelty",
        }
    }

    fn unit(self) -> &'static str {
        match self {
            Dimension::VolumeBytes => "bytes",
            Dimension::Sensitivity => "sensitivity points",
            Dimension::Novelty => "new targets",
        }
    }

    fn parse(text: &str) -> Option<Self> {
        match text {
            "volume_bytes" => Some(Dimension::VolumeBytes),
            "sensitivity" => Some(Dimension::Sensitivity),
            "novelty" => Some(Dimension::Novelty),
            _ => None,
        }
    }
}

/// One budget per scope.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    pub volume_bytes: u64,
    pub sensitivity: u64,
    pub novelty: u64,
}

impl Limits {
    fn get(&self, dimension: Dimension) -> u64 {
        match dimension {
            Dimension::VolumeBytes => self.volume_bytes,
            Dimension::Sensitivity => self.sensitivity,
            Dimension::Novelty => self.novelty,
        }
    }
}

/// A sensitivity weight for every action path under one prefix.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PathWeight {
    pub prefix: String,
    pub weight: u64,
}

/// One constraint of the budget policy. It becomes one wall.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BudgetItem {
    pub scope: Scope,
    pub dimension: Dimension,
    pub expr: String,
}

impl BudgetItem {
    /// The wall id of this constraint.
    pub fn wall_id(&self) -> String {
        let mut id = String::from("policy:budget:");
        id.push_str(self.scope.name());
        id.push('_');
        id.push_str(self.dimension.name());
        id
    }
}

/// The budget policy read from budget.gap.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BudgetPolicy {
    pub rel_path: String,
    pub window_ms: i64,
    pub agent: Limits,
    pub wrap: Limits,
    pub path_weights: Vec<PathWeight>,
    pub class_weights: BTreeMap<String, u64>,
    pub known_targets_max: usize,
    pub items: Vec<BudgetItem>,
}

impl BudgetPolicy {
    fn limits(&self, scope: Scope) -> &Limits {
        match scope {
            Scope::Agent => &self.agent,
            Scope::Wrap => &self.wrap,
        }
    }

    /// The sensitivity of one action: the largest weight of a matching path prefix plus the
    /// weight of every content class of the shared scan rule table found in the event text.
    pub fn sensitivity_of(&self, action_path: &str, text: &str) -> u64 {
        let mut path_weight = 0u64;
        for pw in &self.path_weights {
            if action_path_matches_prefix(action_path, &pw.prefix) && pw.weight > path_weight {
                path_weight = pw.weight;
            }
        }
        let mut total = path_weight;
        for (class, weight) in &self.class_weights {
            if scan_rules::class(class, text) {
                total = total.saturating_add(*weight);
            }
        }
        total
    }
}

/// What one proposed action would spend. The live entry holds it until Admit answers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BudgetCharge {
    pub agent_key: String,
    pub wrap_key: String,
    pub ts_ms: i64,
    pub volume_bytes: u64,
    pub sensitivity: u64,
    pub target: String,
    pub window_ms: i64,
    pub known_targets_max: usize,
}

/// The fields of one proposed action that the budget reads.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BudgetInput {
    pub agent_id: String,
    /// The wrap of the lattice node of the action path. The event cannot choose it.
    pub wrap: String,
    pub action_path: String,
    pub tool: String,
    pub target_id: String,
    /// Every string of the event, joined. Content classes are found here.
    pub text: String,
    /// Byte length of the serialized event.
    pub event_bytes: u64,
    /// Kernel time of the Admit pass.
    pub now_ms: i64,
}

impl BudgetInput {
    /// Read the budget fields of an opened event.
    pub fn from_event(event: &Value, agent_id: &str, wrap: &str, text: &str, now_ms: i64) -> Self {
        let field = |key: &str| {
            event
                .get(key)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        };
        let event_bytes = serde_json::to_vec(event).map(|b| b.len()).unwrap_or(0) as u64;
        BudgetInput {
            agent_id: agent_id.to_string(),
            wrap: wrap.to_string(),
            action_path: field("action_path"),
            tool: field("tool"),
            target_id: field("target_id"),
            text: text.to_string(),
            event_bytes,
            now_ms,
        }
    }
}

/// Measure what one action would spend under a policy.
pub fn measure(policy: &BudgetPolicy, input: &BudgetInput) -> BudgetCharge {
    let wrap = if input.wrap.trim().is_empty() {
        UNWRAPPED
    } else {
        input.wrap.trim()
    };
    let mut target = input.action_path.clone();
    target.push('|');
    target.push_str(&input.tool);
    target.push('|');
    target.push_str(&input.target_id);
    BudgetCharge {
        agent_key: scope_key(Scope::Agent, &input.agent_id),
        wrap_key: scope_key(Scope::Wrap, wrap),
        ts_ms: input.now_ms,
        volume_bytes: input.event_bytes,
        sensitivity: policy.sensitivity_of(&input.action_path, &input.text),
        target,
        window_ms: policy.window_ms,
        known_targets_max: policy.known_targets_max,
    }
}

fn scope_key(scope: Scope, id: &str) -> String {
    let mut key = String::from(scope.name());
    key.push(':');
    key.push_str(id);
    key
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Spend {
    ts_ms: i64,
    volume_bytes: u64,
    sensitivity: u64,
    novel: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct ScopeLedger {
    spends: VecDeque<Spend>,
    /// Target to the last time this scope touched it.
    seen: BTreeMap<String, i64>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Totals {
    volume_bytes: u64,
    sensitivity: u64,
    novelty: u64,
}

impl Totals {
    fn get(&self, dimension: Dimension) -> u64 {
        match dimension {
            Dimension::VolumeBytes => self.volume_bytes,
            Dimension::Sensitivity => self.sensitivity,
            Dimension::Novelty => self.novelty,
        }
    }
}

fn in_window(ts_ms: i64, now_ms: i64, window_ms: i64) -> bool {
    // A spend stamped after now (a clock step back) still counts.
    now_ms.saturating_sub(ts_ms) < window_ms
}

impl ScopeLedger {
    fn totals(&self, now_ms: i64, window_ms: i64) -> Totals {
        let mut t = Totals::default();
        for s in &self.spends {
            if in_window(s.ts_ms, now_ms, window_ms) {
                t.volume_bytes = t.volume_bytes.saturating_add(s.volume_bytes);
                t.sensitivity = t.sensitivity.saturating_add(s.sensitivity);
                if s.novel {
                    t.novelty = t.novelty.saturating_add(1);
                }
            }
        }
        t
    }

    fn commit(&mut self, charge: &BudgetCharge) {
        while let Some(front) = self.spends.front() {
            if in_window(front.ts_ms, charge.ts_ms, charge.window_ms) {
                break;
            }
            self.spends.pop_front();
        }
        let novel = !self.seen.contains_key(&charge.target);
        self.spends.push_back(Spend {
            ts_ms: charge.ts_ms,
            volume_bytes: charge.volume_bytes,
            sensitivity: charge.sensitivity,
            novel,
        });
        self.seen.insert(charge.target.clone(), charge.ts_ms);
        while self.seen.len() > charge.known_targets_max.max(1) {
            let oldest = self
                .seen
                .iter()
                .min_by_key(|(_, ts)| **ts)
                .map(|(k, _)| k.clone());
            match oldest {
                Some(k) => {
                    self.seen.remove(&k);
                }
                None => break,
            }
        }
    }
}

/// What every agent and every wrap spent inside the window. The live entry owns one ledger.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BudgetLedger {
    scopes: BTreeMap<String, ScopeLedger>,
}

impl BudgetLedger {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record an admitted action against its agent and its wrap.
    pub fn commit(&mut self, charge: &BudgetCharge) {
        for key in [&charge.agent_key, &charge.wrap_key] {
            self.scopes.entry(key.clone()).or_default().commit(charge);
        }
    }

    fn totals(&self, key: &str, now_ms: i64, window_ms: i64) -> Totals {
        self.scopes
            .get(key)
            .map(|s| s.totals(now_ms, window_ms))
            .unwrap_or_default()
    }

    fn is_novel(&self, key: &str, target: &str) -> bool {
        self.scopes
            .get(key)
            .map(|s| !s.seen.contains_key(target))
            .unwrap_or(true)
    }

    /// Spend of one scope key inside the window, as (volume_bytes, sensitivity, novelty).
    pub fn spent(&self, key: &str, now_ms: i64, window_ms: i64) -> (u64, u64, u64) {
        let t = self.totals(key, now_ms, window_ms);
        (t.volume_bytes, t.sensitivity, t.novelty)
    }

    /// Number of scopes with a record.
    pub fn scope_count(&self) -> usize {
        self.scopes.len()
    }
}

/// Compile the budget walls of one proposed action. A wall closes when the action adds to its
/// dimension and the spend of the window plus the action would pass the limit.
pub fn compile_budget_walls(
    policy: &BudgetPolicy,
    ledger: &BudgetLedger,
    charge: &BudgetCharge,
) -> Vec<AdmitWall> {
    let mut walls = vec![AdmitWall::open(WALL_PARAMETERS)];
    for item in &policy.items {
        let key = match item.scope {
            Scope::Agent => &charge.agent_key,
            Scope::Wrap => &charge.wrap_key,
        };
        let spent = ledger
            .totals(key, charge.ts_ms, policy.window_ms)
            .get(item.dimension);
        let add = match item.dimension {
            Dimension::VolumeBytes => charge.volume_bytes,
            Dimension::Sensitivity => charge.sensitivity,
            Dimension::Novelty => u64::from(ledger.is_novel(key, &charge.target)),
        };
        let limit = policy.limits(item.scope).get(item.dimension);
        let total = spent.saturating_add(add);
        if add > 0 && total > limit {
            let reason = format!(
                "GAP {} {}: {} would reach {} of {} {} inside {} ms",
                policy.rel_path,
                item.expr,
                key,
                total,
                limit,
                item.dimension.unit(),
                policy.window_ms
            );
            walls.push(AdmitWall::close(item.wall_id(), reason));
        } else {
            walls.push(AdmitWall::open(item.wall_id()));
        }
    }
    walls
}

fn u64_at(obj: &Value, key: &str, path: &str) -> Result<u64, String> {
    obj.get(key)
        .and_then(|v| v.as_u64())
        .ok_or_else(|| format!("{path}.{key} must be a whole number"))
}

fn limits_at(budget: &Value, scope: &str) -> Result<Limits, String> {
    let path = format!("extensions.aep.budget.{scope}");
    let obj = budget
        .get(scope)
        .filter(|v| v.is_object())
        .ok_or_else(|| format!("{path} must be an object"))?;
    Ok(Limits {
        volume_bytes: u64_at(obj, "volume_bytes", &path)?,
        sensitivity: u64_at(obj, "sensitivity", &path)?,
        novelty: u64_at(obj, "novelty", &path)?,
    })
}

/// Read one constraint of the form `hard: <scope>.<dimension> <= budget.<scope>.<dimension>`.
pub fn parse_item(expr: &str) -> Result<BudgetItem, String> {
    let body = expr.trim();
    let body = body.strip_prefix("hard:").unwrap_or(body).trim();
    let mut parts = body.split("<=");
    let lhs = parts.next().unwrap_or("").trim();
    let rhs = parts.next().unwrap_or("").trim();
    if parts.next().is_some() || lhs.is_empty() || rhs.is_empty() {
        return Err(format!("budget constraint is not <lhs> <= <rhs>: {expr}"));
    }
    let mut lhs_parts = lhs.split('.');
    let scope = lhs_parts.next().and_then(Scope::parse);
    let dimension = lhs_parts.next().and_then(Dimension::parse);
    let (Some(scope), Some(dimension)) = (scope, dimension) else {
        return Err(format!(
            "budget constraint names no known scope and dimension: {expr}"
        ));
    };
    if lhs_parts.next().is_some() {
        return Err(format!(
            "budget constraint left side has extra parts: {expr}"
        ));
    }
    let mut expected = String::from("budget.");
    expected.push_str(lhs);
    if rhs != expected {
        return Err(format!(
            "budget constraint right side must be {expected}: {expr}"
        ));
    }
    Ok(BudgetItem {
        scope,
        dimension,
        expr: expr.trim().to_string(),
    })
}

/// Read the budget policy from the source of budget.gap.
pub fn parse_budget_policy(rel_path: &str, source: &str) -> Result<BudgetPolicy, String> {
    let gap = parse_gap_text(STEM, rel_path, source)?;
    let mut doc = Value::Null;
    let mut err = String::new();
    gap_schema_profile_v13::parse_gap_source(source, &mut doc, &mut err);
    if !err.is_empty() {
        return Err(err);
    }
    let budget = doc
        .get("extensions")
        .and_then(|e| e.get("aep"))
        .and_then(|a| a.get("budget"))
        .filter(|v| v.is_object())
        .ok_or_else(|| String::from("extensions.aep.budget must be an object"))?;
    let window = u64_at(budget, "window_ms", "extensions.aep.budget")?;
    if window == 0 {
        return Err(String::from(
            "extensions.aep.budget.window_ms must be above 0",
        ));
    }
    let window_ms = i64::try_from(window)
        .map_err(|_| String::from("extensions.aep.budget.window_ms is too large"))?;
    let known = u64_at(budget, "known_targets_max", "extensions.aep.budget")?;
    if known == 0 {
        return Err(String::from(
            "extensions.aep.budget.known_targets_max must be above 0",
        ));
    }
    let known_targets_max = usize::try_from(known)
        .map_err(|_| String::from("extensions.aep.budget.known_targets_max is too large"))?;
    let mut path_weights = Vec::new();
    if let Some(rows) = budget.get("sensitivity_paths") {
        let rows = rows.as_array().ok_or_else(|| {
            String::from("extensions.aep.budget.sensitivity_paths must be a list")
        })?;
        for row in rows {
            let prefix = row
                .get("prefix")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| String::from("every sensitivity_paths row needs a prefix"))?;
            let weight = u64_at(row, "weight", "extensions.aep.budget.sensitivity_paths[]")?;
            path_weights.push(PathWeight {
                prefix: prefix.trim().to_string(),
                weight,
            });
        }
    }
    let mut class_weights = BTreeMap::new();
    if let Some(classes) = budget.get("sensitivity_classes") {
        let classes = classes.as_object().ok_or_else(|| {
            String::from("extensions.aep.budget.sensitivity_classes must be an object")
        })?;
        let known_classes = scan_rules::classes();
        for (class, weight) in classes {
            if !known_classes.contains(class.as_str()) {
                return Err(format!(
                    "sensitivity class {class} is not a class of the shared scan rule table"
                ));
            }
            let weight = weight
                .as_u64()
                .ok_or_else(|| format!("sensitivity class {class} needs a whole number weight"))?;
            class_weights.insert(class.clone(), weight);
        }
    }
    if gap.items.is_empty() {
        return Err(String::from("the budget policy carries no constraint"));
    }
    let mut items = Vec::new();
    let mut ids = BTreeSet::new();
    for item in &gap.items {
        let parsed = parse_item(&item.expr)?;
        if !ids.insert(parsed.wall_id()) {
            return Err(format!("budget constraint repeats {}", parsed.wall_id()));
        }
        items.push(parsed);
    }
    Ok(BudgetPolicy {
        rel_path: rel_path.to_string(),
        window_ms,
        agent: limits_at(budget, "agent")?,
        wrap: limits_at(budget, "wrap")?,
        path_weights,
        class_weights,
        known_targets_max,
        items,
    })
}

/// The budget policy of a policy system directory. None when the directory has no budget.gap,
/// which the policy system loader closes as a missing required GAP.
pub fn load_budget_policy(dir: &Path) -> Option<Result<BudgetPolicy, String>> {
    let path = dir.join(POLICY_REL_PATH);
    if !path.is_file() {
        return None;
    }
    Some(match fs::read_to_string(&path) {
        Ok(raw) => parse_budget_policy(POLICY_REL_PATH, &raw),
        Err(e) => Err(format!("read failed: {e}")),
    })
}

/// The budget walls and the charge of one proposed action for a policy system directory.
/// A policy that cannot be read closes the parameters wall and charges nothing.
pub fn compile_live_budget(
    dir: Option<&Path>,
    ledger: &BudgetLedger,
    input: &BudgetInput,
) -> (Vec<AdmitWall>, Option<BudgetCharge>) {
    let Some(dir) = dir else {
        return (Vec::new(), None);
    };
    match load_budget_policy(dir) {
        None => (Vec::new(), None),
        Some(Err(e)) => {
            let mut reason = String::from("GAP ");
            reason.push_str(POLICY_REL_PATH);
            reason.push_str(" budget parameters unreadable: ");
            reason.push_str(&e);
            (vec![AdmitWall::close(WALL_PARAMETERS, reason)], None)
        }
        Some(Ok(policy)) => {
            let charge = measure(&policy, input);
            (compile_budget_walls(&policy, ledger, &charge), Some(charge))
        }
    }
}

#[cfg(test)]
mod tests;
