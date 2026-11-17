//! From a resolved profile record to a sandbox plan.
//!
//! A sandbox knows three things about a folder tree: it is mounted read only, it is
//! mounted read write or it is covered by an empty mount. A path that no rule allows
//! is not mounted and does not exist inside the sandbox. Every file rule of a record
//! becomes one of these or the session is refused with the name of the rule.
//!
//! One precedence rule holds: a deny on a path wins over an allow on the same path
//! or on a parent. Between two other rules the rule on the longer path wins. The
//! mounts of a plan are sorted so that a longer path is mounted after its parent.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::canonical::{canonical_json, sha256_label};
use crate::error::PolicyError;
use crate::record::{FileRule, Policy, ResolvedProfile};
use crate::route::{normalize_route_host, HostError, PlanRoute, Scheme};
use crate::{in_root_trees, is_under};

/// Operations that read.
const READ_OPERATIONS: [&str; 3] = ["read", "list", "stat"];
/// Operations that change a tree. A read write mount allows all of them.
const WRITE_OPERATIONS: [&str; 5] = ["write", "create", "mkdir", "delete", "rename"];
/// Further write operations a rule may name. They follow the write class.
const MORE_WRITE_OPERATIONS: [&str; 5] = ["rmdir", "chmod", "link", "symlink", "truncate"];

/// The variables of one session, such as `PROJECT_ROOT` and `HOME`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Variables(BTreeMap<String, String>);

impl Variables {
    /// No variable.
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds one variable.
    pub fn with(mut self, name: &str, value: &str) -> Self {
        self.0.insert(name.to_string(), value.to_string());
        self
    }

    fn get(&self, name: &str) -> Option<&str> {
        self.0.get(name).map(String::as_str)
    }
}

/// How one folder tree appears inside the sandbox.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MountMode {
    /// The host folder, read only.
    ReadOnly,
    /// The host folder, read write.
    ReadWrite,
    /// An empty read only mount that hides what is below.
    Mask,
}

/// One mount of a plan. The path is the same on the host and inside the sandbox.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanMount {
    /// Absolute path of the folder tree.
    pub path: String,
    /// Mode of the mount.
    pub mode: MountMode,
    /// True when a program below this mount may run.
    pub exec: bool,
    /// Name of the rule that decided the mode.
    pub rule: String,
}

/// One program of a plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanProgram {
    /// Name of the program.
    pub name: String,
    /// Path of the program on the host.
    pub source: String,
    /// Path of the program inside the sandbox.
    pub path: String,
}

/// Trees of the root file system that may hold a tree of a toolset.
pub const TREE_ROOTS: [&str; 5] = ["/usr", "/lib", "/lib32", "/lib64", "/libx32"];

/// One folder tree of a plan: a folder of the host, mounted read only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanTree {
    /// Name of the tree.
    pub name: String,
    /// Folder of the host.
    pub source: String,
    /// Path of the folder inside the sandbox.
    pub path: String,
    /// Folder inside the tree that joins the search path of programs.
    pub bin: Option<String>,
}

/// Everything one sandbox holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SandboxPlan {
    /// Id of the profile.
    pub profile_id: String,
    /// Digest of the record the plan was compiled from.
    pub record_digest: String,
    /// True when programs inside the mounts may run.
    pub compiled_runtime: bool,
    /// The mounts, a parent before its children.
    pub mounts: Vec<PlanMount>,
    /// The programs of the root file system.
    pub programs: Vec<PlanProgram>,
    /// The folder trees of the root file system.
    #[serde(default)]
    pub trees: Vec<PlanTree>,
    /// The routes out of the sandbox. Empty means no network at all.
    pub routes: Vec<PlanRoute>,
    /// sha256 over the canonical JSON of the plan without this field.
    pub digest: String,
}

impl SandboxPlan {
    /// The deepest mount that holds `path`.
    pub fn mount_of(&self, path: &str) -> Option<&PlanMount> {
        self.mounts
            .iter()
            .filter(|m| is_under(path, &m.path))
            .max_by_key(|m| m.path.len())
    }
}

/// Fills the variables of a text. `place` names the rule for the refusal.
fn substitute(
    text: &str,
    vars: &Variables,
    mount_path: Option<&str>,
    place: &str,
) -> Result<String, PolicyError> {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find('$') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let name = after
            .strip_prefix('{')
            .and_then(|inner| inner.find('}').map(|end| &inner[..end]))
            .filter(|name| {
                !name.is_empty()
                    && name
                        .bytes()
                        .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
            })
            .ok_or_else(|| PolicyError::BadPath {
                place: place.to_string(),
                path: text.to_string(),
            })?;
        let value = match (name, mount_path) {
            ("MOUNT_PATH", Some(path)) => Some(path),
            ("MOUNT_PATH", None) => None,
            _ => vars.get(name),
        }
        .ok_or_else(|| PolicyError::MissingVariable {
            place: place.to_string(),
            name: name.to_string(),
        })?;
        out.push_str(value);
        rest = &after[name.len() + 2..];
    }
    out.push_str(rest);
    Ok(out)
}

/// Checks that a path is absolute and in plain form and returns it.
fn plain_path(path: &str, place: &str) -> Result<String, PolicyError> {
    let bad = || PolicyError::BadPath {
        place: place.to_string(),
        path: path.to_string(),
    };
    if !path.starts_with('/') || path.len() < 2 || path.ends_with('/') {
        return Err(bad());
    }
    for part in path[1..].split('/') {
        if part.is_empty() || part == "." || part == ".." || part.contains('\0') {
            return Err(bad());
        }
    }
    Ok(path.to_string())
}

/// What one file rule says about one tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Level {
    Read,
    Write,
}

/// What a deny rule takes away.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Denied {
    Write,
    All,
}

#[derive(Debug, Clone, Default)]
struct TreeRules {
    allow: Option<(Level, String)>,
    deny: Option<(Denied, String)>,
}

/// Reads the operations of a rule into the two classes.
/// Returns how many read operations and how many write operations are covered and
/// whether a further write operation is named.
fn operation_classes(rule: &FileRule) -> Result<(usize, usize, bool), PolicyError> {
    let mut read = [false; 3];
    let mut write = [false; 5];
    let mut more = false;
    for op in &rule.operations {
        if op == "*" {
            read = [true; 3];
            write = [true; 5];
        } else if let Some(i) = READ_OPERATIONS.iter().position(|o| o == op) {
            read[i] = true;
        } else if let Some(i) = WRITE_OPERATIONS.iter().position(|o| o == op) {
            write[i] = true;
        } else if MORE_WRITE_OPERATIONS.contains(&op.as_str()) {
            more = true;
        } else {
            return Err(PolicyError::UnknownOperation {
                rule: rule.name.clone(),
                operation: op.clone(),
            });
        }
    }
    Ok((
        read.iter().filter(|b| **b).count(),
        write.iter().filter(|b| **b).count(),
        more,
    ))
}

fn partial(rule: &FileRule, class: &'static str) -> PolicyError {
    PolicyError::PartialOperations {
        rule: rule.name.clone(),
        class,
    }
}

/// Adds the file rules of one policy to the rules per tree.
fn collect_file_rules(
    policy: &Policy,
    vars: &Variables,
    mount_path: Option<&str>,
    trees: &mut BTreeMap<String, TreeRules>,
) -> Result<(), PolicyError> {
    for rule in &policy.file_rules {
        let place = format!("rule {}", rule.name);
        let (reads, writes, more) = operation_classes(rule)?;
        enum Kind {
            Allow(Level),
            Deny(Denied),
        }
        let kind = match rule.decision.as_str() {
            "allow" => {
                if reads != READ_OPERATIONS.len() {
                    return Err(partial(rule, "read"));
                }
                match writes {
                    0 if !more => Kind::Allow(Level::Read),
                    n if n == WRITE_OPERATIONS.len() => Kind::Allow(Level::Write),
                    _ => return Err(partial(rule, "write")),
                }
            }
            "deny" => {
                if writes != WRITE_OPERATIONS.len() {
                    return Err(partial(rule, "write"));
                }
                match reads {
                    0 => Kind::Deny(Denied::Write),
                    n if n == READ_OPERATIONS.len() => Kind::Deny(Denied::All),
                    _ => return Err(partial(rule, "read")),
                }
            }
            other => {
                return Err(PolicyError::UnsupportedDecision {
                    rule: rule.name.clone(),
                    decision: other.to_string(),
                })
            }
        };
        for pattern in &rule.paths {
            let filled = substitute(pattern, vars, mount_path, &place)?;
            let root = filled.strip_suffix("/**").unwrap_or(&filled);
            if root.contains(['*', '?', '[', ']', '{', '}']) {
                return Err(PolicyError::PatternNotATree {
                    rule: rule.name.clone(),
                    pattern: pattern.clone(),
                });
            }
            let root = plain_path(root, &place)?;
            let entry = trees.entry(root).or_default();
            match kind {
                Kind::Allow(level) => {
                    if entry.allow.as_ref().is_none_or(|(old, _)| level > *old) {
                        entry.allow = Some((level, rule.name.clone()));
                    }
                }
                Kind::Deny(denied) => {
                    if entry.deny.as_ref().is_none_or(|(old, _)| denied > *old) {
                        entry.deny = Some((denied, rule.name.clone()));
                    }
                }
            }
        }
    }
    Ok(())
}

/// Compiles a record with the variables of one session into a sandbox plan.
pub fn compile(record: &ResolvedProfile, vars: &Variables) -> Result<SandboxPlan, PolicyError> {
    let mut trees: BTreeMap<String, TreeRules> = BTreeMap::new();
    collect_file_rules(&record.base_policy, vars, None, &mut trees)?;
    let mut mount_paths: Vec<String> = Vec::new();
    for (i, mount) in record.mounts.iter().enumerate() {
        let place = format!("mount {} of the profile", i + 1);
        let path = plain_path(&substitute(&mount.path, vars, None, &place)?, &place)?;
        if mount_paths.contains(&path) {
            return Err(PolicyError::DuplicateMount(path));
        }
        collect_file_rules(&mount.policy, vars, Some(&path), &mut trees)?;
        mount_paths.push(path);
    }

    // The trees come in the order of their paths, so a parent is decided before its
    // children. A tree with no allow rule of its own starts from what its nearest
    // mounted parent gives it. A deny rule only takes away: it never shows a tree
    // that a parent hides.
    let mut mounts: Vec<PlanMount> = Vec::new();
    for (path, rules) in &trees {
        let inherited = mounts
            .iter()
            .filter(|m| is_under(path, &m.path))
            .max_by_key(|m| m.path.len())
            .map(|m| m.mode);
        let own = rules.allow.as_ref().map(|(level, rule)| {
            let mode = match level {
                Level::Read => MountMode::ReadOnly,
                Level::Write => MountMode::ReadWrite,
            };
            (mode, rule.clone())
        });
        let base = own.as_ref().map(|(mode, _)| *mode).or(inherited);
        let decided = match (&rules.deny, base) {
            // Nothing reaches the path: it is absent and a deny has nothing to hide.
            (_, None) => None,
            (Some((Denied::All, rule)), Some(_)) => Some((MountMode::Mask, rule.clone())),
            (Some((Denied::Write, rule)), Some(MountMode::ReadWrite)) => {
                Some((MountMode::ReadOnly, rule.clone()))
            }
            (_, Some(mode)) => own.map(|(_, rule)| (mode, rule)),
        };
        let Some((mode, rule)) = decided else {
            continue;
        };
        if inherited == Some(mode) && rules.allow.is_none() {
            continue;
        }
        if in_root_trees(path) {
            return Err(PolicyError::ReservedPath {
                place: format!("rule {rule}"),
                path: path.clone(),
            });
        }
        mounts.push(PlanMount {
            path: path.clone(),
            mode,
            exec: mode != MountMode::Mask && record.compiled_runtime,
            rule,
        });
    }
    // A parent sorts before its children: "/a" before "/a/b" and before "/a-b".
    mounts.sort_by(|a, b| a.path.split('/').cmp(b.path.split('/')));

    let mut programs: Vec<PlanProgram> = Vec::new();
    for program in &record.toolset.programs {
        let bad = |reason: &str| PolicyError::Program {
            program: program.name.clone(),
            reason: reason.to_string(),
        };
        let place = format!("program {}", program.name);
        if program.name.is_empty() || program.name.contains('/') {
            return Err(bad("the name is not a plain program name"));
        }
        plain_path(&program.source, &place)
            .map_err(|_| bad("the source is not an absolute path in plain form"))?;
        plain_path(&program.path, &place)
            .map_err(|_| bad("the path is not an absolute path in plain form"))?;
        if !in_root_trees(&program.path) {
            return Err(bad(
                "the path is outside the root file system of the sandbox",
            ));
        }
        if programs
            .iter()
            .any(|p| p.name == program.name || p.path == program.path)
        {
            return Err(bad("the toolset holds the name or the path twice"));
        }
        programs.push(PlanProgram {
            name: program.name.clone(),
            source: program.source.clone(),
            path: program.path.clone(),
        });
    }
    if programs.is_empty() {
        return Err(PolicyError::Program {
            program: record.toolset.name.clone(),
            reason: "the toolset is empty".to_string(),
        });
    }
    let mut trees: Vec<PlanTree> = Vec::new();
    for tree in &record.toolset.trees {
        let bad = |reason: &str| PolicyError::Tree {
            tree: tree.name.clone(),
            reason: reason.to_string(),
        };
        let place = format!("tree {}", tree.name);
        let source = substitute(&tree.source, vars, None, &place)?;
        let source = plain_path(&source, &place)
            .map_err(|_| bad("the source is not an absolute path in plain form"))?;
        let path = plain_path(&tree.path, &place)
            .map_err(|_| bad("the path is not an absolute path in plain form"))?;
        if !TREE_ROOTS
            .iter()
            .any(|root| path != *root && is_under(&path, root))
        {
            return Err(bad(
                "the path is not a folder below /usr or below a library folder of the root",
            ));
        }
        if let Some(bin) = &tree.bin {
            let plain = !bin.is_empty()
                && !bin.starts_with('/')
                && bin
                    .split('/')
                    .all(|part| !part.is_empty() && part != "." && part != "..");
            if !plain {
                return Err(bad("the bin folder is not a plain path inside the tree"));
            }
        }
        if trees
            .iter()
            .any(|t| t.name == tree.name || is_under(&path, &t.path) || is_under(&t.path, &path))
        {
            return Err(bad(
                "the toolset holds the name twice or places two trees inside each other",
            ));
        }
        if let Some(program) = programs.iter().find(|p| is_under(&p.path, &path)) {
            return Err(bad(&format!(
                "the program {} lies inside the tree, which brings its own programs",
                program.name
            )));
        }
        trees.push(PlanTree {
            name: tree.name.clone(),
            source,
            path,
            bin: tree.bin.clone(),
        });
    }
    let policies =
        std::iter::once(&record.base_policy).chain(record.mounts.iter().map(|m| &m.policy));
    for policy in policies {
        for rule in &policy.command_rules {
            match rule.decision.as_str() {
                "allow" => {}
                "deny" => {
                    if let Some(program) = programs.iter().find(|p| rule.commands.contains(&p.name))
                    {
                        return Err(PolicyError::DeniedProgram {
                            rule: rule.name.clone(),
                            program: program.name.clone(),
                        });
                    }
                }
                other => {
                    return Err(PolicyError::UnsupportedDecision {
                        rule: rule.name.clone(),
                        decision: other.to_string(),
                    })
                }
            }
        }
    }

    let mut routes = Vec::new();
    if let Some(egress) = &record.egress_policy {
        if egress.unmatched != "deny" {
            return Err(PolicyError::Route {
                route: egress.name.clone(),
                reason: "a destination with no route is always denied".to_string(),
            });
        }
        for route in &egress.routes {
            let bad = |reason: &str| PolicyError::Route {
                route: route.name.clone(),
                reason: reason.to_string(),
            };
            let scheme = Scheme::parse(&route.scheme)
                .ok_or_else(|| bad("the scheme is not http or https"))?;
            let allow = match route.decision.as_str() {
                "allow" => true,
                "deny" => false,
                _ => return Err(bad("the decision is not allow or deny")),
            };
            if route.port == 0 {
                return Err(bad("the port is zero"));
            }
            let filled = substitute(&route.host, vars, None, &format!("route {}", route.name))?;
            let host = normalize_route_host(&filled).map_err(|e| match e {
                HostError::AddressLiteral => bad("the host is an address, a route names a host"),
                HostError::Invalid => bad("the host is not a host name"),
            })?;
            routes.push(PlanRoute {
                name: route.name.clone(),
                scheme,
                host,
                port: route.port,
                allow,
            });
        }
    }
    if record.llm_proxy && !routes.iter().any(|r| r.allow) {
        return Err(PolicyError::ProxyWithoutRoute);
    }

    let mut plan = SandboxPlan {
        profile_id: record.profile_id.clone(),
        record_digest: record.digest.clone(),
        compiled_runtime: record.compiled_runtime,
        mounts,
        programs,
        trees,
        routes,
        digest: String::new(),
    };
    plan.digest = plan_digest(&plan)?;
    Ok(plan)
}

/// The digest of a plan: sha256 over its canonical JSON without the field `digest`.
pub fn plan_digest(plan: &SandboxPlan) -> Result<String, PolicyError> {
    let mut value = serde_json::to_value(plan).map_err(|e| PolicyError::Shape(e.to_string()))?;
    if let serde_json::Value::Object(map) = &mut value {
        map.remove("digest");
    }
    Ok(sha256_label(&canonical_json(&value)))
}
