//! Every reason for which the engine refuses a record or a session.

/// A record or a session the CAW does not run. Each variant names its cause, so the
/// refusal a caller sees says which rule to change.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PolicyError {
    /// The text is not JSON or does not have the shape of the record.
    #[error("the profile record cannot be read: {0}")]
    Shape(String),
    /// The record is of another kind or version.
    #[error("the record is {found}, the CAW reads aep.caw.resolved_profile version 1")]
    RecordKind {
        /// Kind and version found.
        found: String,
    },
    /// The digest in the record does not match its content.
    #[error("the digest of the profile record does not match its content")]
    Digest,
    /// The profile is of a tier the CAW does not run.
    #[error("the profile has the tier {0}, the CAW runs only the tier gvisor")]
    Tier(String),
    /// A rule or a mount names a variable the call did not supply.
    #[error("{place} names the variable {name}, which the call does not supply")]
    MissingVariable {
        /// Rule, mount or route that names the variable.
        place: String,
        /// Name of the variable.
        name: String,
    },
    /// A path is not absolute and normalized.
    #[error("{place} holds the path {path}, which is not an absolute path in plain form")]
    BadPath {
        /// Rule or mount that holds the path.
        place: String,
        /// The path after the variables were filled.
        path: String,
    },
    /// A pattern is not a folder tree.
    #[error("rule {rule} holds the pattern {pattern}, which is not a folder tree. A mount covers a folder with everything below it.")]
    PatternNotATree {
        /// Name of the rule.
        rule: String,
        /// The pattern as written.
        pattern: String,
    },
    /// A decision other than allow or deny.
    #[error("rule {rule} has the decision {decision}. A sandbox knows allow and deny.")]
    UnsupportedDecision {
        /// Name of the rule.
        rule: String,
        /// The decision as written.
        decision: String,
    },
    /// An operation the engine does not know.
    #[error("rule {rule} names the unknown operation {operation}")]
    UnknownOperation {
        /// Name of the rule.
        rule: String,
        /// The operation as written.
        operation: String,
    },
    /// A rule covers only a part of the read or write operations.
    #[error("rule {rule} covers only a part of the {class} operations. A mount is read only or read write as a whole.")]
    PartialOperations {
        /// Name of the rule.
        rule: String,
        /// `read` or `write`.
        class: &'static str,
    },
    /// A mount would cover the root file system of the sandbox.
    #[error("{place} would mount {path}, which belongs to the root file system of the sandbox")]
    ReservedPath {
        /// Rule or mount.
        place: String,
        /// The path.
        path: String,
    },
    /// Two mounts of a profile name the same path.
    #[error("the profile mounts {0} twice")]
    DuplicateMount(String),
    /// The toolset holds a program that a command rule denies.
    #[error("rule {rule} denies the program {program}, which the toolset holds")]
    DeniedProgram {
        /// Name of the rule.
        rule: String,
        /// Name of the program.
        program: String,
    },
    /// A program of the toolset is not usable.
    #[error("program {program} of the toolset: {reason}")]
    Program {
        /// Name of the program.
        program: String,
        /// What is wrong with it.
        reason: String,
    },
    /// A tree of the toolset is not usable.
    #[error("tree {tree} of the toolset: {reason}")]
    Tree {
        /// Name of the tree.
        tree: String,
        /// What is wrong with it.
        reason: String,
    },
    /// A route is not usable.
    #[error("route {route}: {reason}")]
    Route {
        /// Name of the route.
        route: String,
        /// What is wrong with it.
        reason: String,
    },
    /// The profile opens the model gateway and names no route to it.
    #[error("the profile sets llm_proxy to true and has no egress policy")]
    ProxyWithoutRoute,
}
