//! The one source check of the workspace.
//!
//! A few crates prove a rule of the Base Node by reading its Rust source, for example that
//! the dock request path never aborts on a poisoned lock. They read that source through this
//! crate only. It parses each file with syn and looks an item up by its identifier, so:
//!
//! - braces inside strings, character literals and comments never move the end of an item,
//! - a name in a comment, a doc comment or a string is never taken for the item,
//! - test code (`#[cfg(test)]` modules and `#[test]` functions) is never production code,
//! - an item that is absent or present more than once is an error and never an empty
//!   text, so renaming a checked function fails the check instead of passing it.
//!
//! The text of an item is its token text: comments and doc text are gone and whitespace is
//! removed, so a check compares with [`CodeText::contains`] independent of formatting.

use std::fmt;
use std::path::{Path, PathBuf};

use proc_macro2::{Delimiter, TokenStream, TokenTree};
use quote::ToTokens;
use syn::{Attribute, File, ImplItem, Item, TraitItem};

/// Why a source check could not read the code it checks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SourceCheckError {
    /// A file or folder could not be read.
    Read { path: String, message: String },
    /// A file is not Rust that syn parses.
    Parse { label: String, message: String },
    /// No production item of this kind has this name.
    Missing {
        label: String,
        kind: &'static str,
        name: String,
    },
    /// More than one production item of this kind has this name.
    Ambiguous {
        label: String,
        kind: &'static str,
        name: String,
        count: usize,
    },
    /// The workspace root was not found above the crate.
    Workspace { message: String },
}

impl fmt::Display for SourceCheckError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Read { path, message } => write!(f, "cannot read {path}: {message}"),
            Self::Parse { label, message } => {
                write!(f, "{label} does not parse as Rust: {message}")
            }
            Self::Missing { label, kind, name } => write!(f, "{kind} {name} not found in {label}"),
            Self::Ambiguous {
                label,
                kind,
                name,
                count,
            } => write!(
                f,
                "{kind} {name} is defined {count} times in {label}; name its owner as Owner::{name}"
            ),
            Self::Workspace { message } => write!(f, "workspace root not found: {message}"),
        }
    }
}

impl std::error::Error for SourceCheckError {}

impl From<SourceCheckError> for String {
    fn from(e: SourceCheckError) -> Self {
        e.to_string()
    }
}

/// Text with all whitespace removed. Checks compact their needles the same way.
pub fn compact(text: &str) -> String {
    text.chars().filter(|c| !c.is_whitespace()).collect()
}

/// The token text of a piece of code: no comments, no doc text and no whitespace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeText(String);

impl CodeText {
    fn of(tokens: TokenStream) -> Self {
        let mut out = String::new();
        write_tokens(tokens, &mut out);
        Self(out)
    }

    /// The compact token text.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Whether the code holds `needle`, compared without whitespace.
    pub fn contains(&self, needle: &str) -> bool {
        self.0.contains(&compact(needle))
    }

    /// Byte offset of the first `needle`, compared without whitespace.
    pub fn find(&self, needle: &str) -> Option<usize> {
        self.0.find(&compact(needle))
    }

    /// The code from the last `needle` to the end. None when the needle is absent.
    pub fn after_last(&self, needle: &str) -> Option<CodeText> {
        let n = compact(needle);
        self.0.rfind(&n).map(|i| Self(self.0[i..].to_string()))
    }
}

impl fmt::Display for CodeText {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

fn is_doc_attribute(trees: &[TokenTree], i: usize) -> Option<usize> {
    let TokenTree::Punct(hash) = trees.get(i)? else {
        return None;
    };
    if hash.as_char() != '#' {
        return None;
    }
    let mut j = i + 1;
    if let Some(TokenTree::Punct(bang)) = trees.get(j) {
        if bang.as_char() == '!' {
            j += 1;
        }
    }
    let TokenTree::Group(group) = trees.get(j)? else {
        return None;
    };
    if group.delimiter() != Delimiter::Bracket {
        return None;
    }
    match group.stream().into_iter().next() {
        Some(TokenTree::Ident(id)) if id == "doc" => Some(j + 1 - i),
        _ => None,
    }
}

fn write_tokens(tokens: TokenStream, out: &mut String) {
    let trees: Vec<TokenTree> = tokens.into_iter().collect();
    let mut i = 0;
    while i < trees.len() {
        if let Some(skip) = is_doc_attribute(&trees, i) {
            i += skip;
            continue;
        }
        match &trees[i] {
            TokenTree::Group(group) => {
                let (open, close) = match group.delimiter() {
                    Delimiter::Parenthesis => ("(", ")"),
                    Delimiter::Brace => ("{", "}"),
                    Delimiter::Bracket => ("[", "]"),
                    Delimiter::None => ("", ""),
                };
                out.push_str(open);
                write_tokens(group.stream(), out);
                out.push_str(close);
            }
            other => out.push_str(&compact(&other.to_string())),
        }
        i += 1;
    }
}

/// Whether the attributes mark test code: `#[test]`, `#[tokio::test]` or a `cfg` that
/// names `test`.
fn is_test_code(attrs: &[Attribute]) -> bool {
    attrs.iter().any(|attr| {
        let path = attr.path();
        if path.segments.last().is_some_and(|s| s.ident == "test") {
            return true;
        }
        if path.is_ident("cfg") {
            let text = compact(&attr.meta.to_token_stream().to_string());
            return text == "cfg(test)"
                || text.starts_with("cfg(all(test")
                || text.starts_with("cfg(any(test");
        }
        false
    })
}

fn last_ident(ty: &syn::Type) -> Option<String> {
    match ty {
        syn::Type::Path(p) => p.path.segments.last().map(|s| s.ident.to_string()),
        syn::Type::Reference(r) => last_ident(&r.elem),
        syn::Type::Paren(p) => last_ident(&p.elem),
        syn::Type::Group(g) => last_ident(&g.elem),
        _ => None,
    }
}

/// One production function: its owners (modules, impl self type, impl trait, trait) and
/// its token text.
struct FoundFn {
    owners: Vec<String>,
    name: String,
    text: CodeText,
}

fn collect_fns(items: &[Item], owners: &[String], out: &mut Vec<FoundFn>) {
    for item in items {
        match item {
            Item::Fn(f) if !is_test_code(&f.attrs) => out.push(FoundFn {
                owners: owners.to_vec(),
                name: f.sig.ident.to_string(),
                text: CodeText::of(f.to_token_stream()),
            }),
            Item::Impl(imp) if !is_test_code(&imp.attrs) => {
                let mut inner = owners.to_vec();
                if let Some(ty) = last_ident(&imp.self_ty) {
                    inner.push(ty);
                }
                if let Some((_, path, _)) = &imp.trait_ {
                    if let Some(seg) = path.segments.last() {
                        inner.push(seg.ident.to_string());
                    }
                }
                for it in &imp.items {
                    if let ImplItem::Fn(m) = it {
                        if !is_test_code(&m.attrs) {
                            out.push(FoundFn {
                                owners: inner.clone(),
                                name: m.sig.ident.to_string(),
                                text: CodeText::of(m.to_token_stream()),
                            });
                        }
                    }
                }
            }
            Item::Trait(tr) if !is_test_code(&tr.attrs) => {
                let mut inner = owners.to_vec();
                inner.push(tr.ident.to_string());
                for it in &tr.items {
                    if let TraitItem::Fn(m) = it {
                        if m.default.is_some() && !is_test_code(&m.attrs) {
                            out.push(FoundFn {
                                owners: inner.clone(),
                                name: m.sig.ident.to_string(),
                                text: CodeText::of(m.to_token_stream()),
                            });
                        }
                    }
                }
            }
            Item::Mod(m) if !is_test_code(&m.attrs) => {
                if let Some((_, inner_items)) = &m.content {
                    let mut inner = owners.to_vec();
                    inner.push(m.ident.to_string());
                    collect_fns(inner_items, &inner, out);
                }
            }
            _ => {}
        }
    }
}

fn type_name(item: &Item) -> Option<(String, &'static str)> {
    match item {
        Item::Struct(s) if !is_test_code(&s.attrs) => Some((s.ident.to_string(), "struct")),
        Item::Enum(e) if !is_test_code(&e.attrs) => Some((e.ident.to_string(), "enum")),
        Item::Union(u) if !is_test_code(&u.attrs) => Some((u.ident.to_string(), "union")),
        Item::Trait(t) if !is_test_code(&t.attrs) => Some((t.ident.to_string(), "trait")),
        Item::Type(t) if !is_test_code(&t.attrs) => Some((t.ident.to_string(), "type")),
        _ => None,
    }
}

fn collect_types(items: &[Item], out: &mut Vec<(String, CodeText)>) {
    for item in items {
        if let Some((name, _)) = type_name(item) {
            out.push((name, CodeText::of(item.to_token_stream())));
        }
        if let Item::Mod(m) = item {
            if !is_test_code(&m.attrs) {
                if let Some((_, inner)) = &m.content {
                    collect_types(inner, out);
                }
            }
        }
    }
}

fn without_test_code(items: &[Item]) -> Vec<Item> {
    let mut out = Vec::new();
    for item in items {
        let keep = match item {
            Item::Fn(f) => !is_test_code(&f.attrs),
            Item::Mod(m) => !is_test_code(&m.attrs),
            Item::Impl(i) => !is_test_code(&i.attrs),
            Item::Use(u) => !is_test_code(&u.attrs),
            Item::Const(c) => !is_test_code(&c.attrs),
            Item::Static(s) => !is_test_code(&s.attrs),
            Item::Struct(s) => !is_test_code(&s.attrs),
            Item::Enum(e) => !is_test_code(&e.attrs),
            Item::Trait(t) => !is_test_code(&t.attrs),
            Item::Type(t) => !is_test_code(&t.attrs),
            Item::Macro(m) => !is_test_code(&m.attrs),
            _ => true,
        };
        if !keep {
            continue;
        }
        match item {
            Item::Mod(m) => {
                let mut m = m.clone();
                if let Some((brace, inner)) = m.content.take() {
                    m.content = Some((brace, without_test_code(&inner)));
                }
                out.push(Item::Mod(m));
            }
            Item::Impl(i) => {
                let mut i = i.clone();
                i.items.retain(|it| match it {
                    ImplItem::Fn(f) => !is_test_code(&f.attrs),
                    _ => true,
                });
                out.push(Item::Impl(i));
            }
            other => out.push(other.clone()),
        }
    }
    out
}

/// One or more parsed Rust files that a check reads as one unit, such as the files of a
/// module folder.
pub struct RustSource {
    files: Vec<(String, File)>,
}

impl RustSource {
    /// Parse one text. The label names it in errors.
    pub fn parse(label: &str, text: &str) -> Result<Self, SourceCheckError> {
        let file = syn::parse_file(text).map_err(|e| SourceCheckError::Parse {
            label: label.to_string(),
            message: e.to_string(),
        })?;
        Ok(Self {
            files: vec![(label.to_string(), file)],
        })
    }

    /// Read and parse one file.
    pub fn read(path: &Path) -> Result<Self, SourceCheckError> {
        let text = std::fs::read_to_string(path).map_err(|e| SourceCheckError::Read {
            path: path.display().to_string(),
            message: e.to_string(),
        })?;
        Self::parse(&path.display().to_string(), &text)
    }

    /// Read and parse every `.rs` file of a module folder, `mod.rs` first and then by name,
    /// leaving out the file names in `skip`. A folder without a file is an error.
    pub fn read_module_dir(dir: &Path, skip: &[&str]) -> Result<Self, SourceCheckError> {
        let read_err = |e: std::io::Error| SourceCheckError::Read {
            path: dir.display().to_string(),
            message: e.to_string(),
        };
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .map_err(read_err)?
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".rs") && !skip.contains(&n.as_str()))
            .collect();
        names.sort_by(|a, b| (a != "mod.rs").cmp(&(b != "mod.rs")).then(a.cmp(b)));
        if names.is_empty() {
            return Err(SourceCheckError::Read {
                path: dir.display().to_string(),
                message: String::from("no Rust file"),
            });
        }
        let mut files = Vec::new();
        for n in names {
            let one = Self::read(&dir.join(&n))?;
            files.extend(one.files);
        }
        Ok(Self { files })
    }

    fn label(&self) -> String {
        self.files
            .iter()
            .map(|(l, _)| l.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    }

    /// The production function named `name` or `Owner::name`. Owner is a module, the self
    /// type of an impl, the trait of an impl or a trait. Test code is never searched.
    pub fn function(&self, name: &str) -> Result<CodeText, SourceCheckError> {
        let (owner, fn_name) = match name.rsplit_once("::") {
            Some((o, n)) => (Some(o.rsplit("::").next().unwrap_or(o)), n),
            None => (None, name),
        };
        let mut found = Vec::new();
        for (_, file) in &self.files {
            collect_fns(&file.items, &[], &mut found);
        }
        let mut hits: Vec<CodeText> = found
            .into_iter()
            .filter(|f| f.name == fn_name)
            .filter(|f| match owner {
                None => true,
                Some(o) => f.owners.iter().any(|x| x == o),
            })
            .map(|f| f.text)
            .collect();
        match hits.len() {
            0 => Err(SourceCheckError::Missing {
                label: self.label(),
                kind: "fn",
                name: name.to_string(),
            }),
            1 => Ok(hits.remove(0)),
            n => Err(SourceCheckError::Ambiguous {
                label: self.label(),
                kind: "fn",
                name: name.to_string(),
                count: n,
            }),
        }
    }

    /// The production struct, enum, union, trait or type alias named `name`.
    pub fn type_item(&self, name: &str) -> Result<CodeText, SourceCheckError> {
        let mut found = Vec::new();
        for (_, file) in &self.files {
            collect_types(&file.items, &mut found);
        }
        let mut hits: Vec<CodeText> = found
            .into_iter()
            .filter(|(n, _)| n == name)
            .map(|(_, t)| t)
            .collect();
        match hits.len() {
            0 => Err(SourceCheckError::Missing {
                label: self.label(),
                kind: "type",
                name: name.to_string(),
            }),
            1 => Ok(hits.remove(0)),
            n => Err(SourceCheckError::Ambiguous {
                label: self.label(),
                kind: "type",
                name: name.to_string(),
                count: n,
            }),
        }
    }

    /// The production code of every file: the whole text without test code.
    pub fn production(&self) -> CodeText {
        let mut out = String::new();
        for (_, file) in &self.files {
            let items = without_test_code(&file.items);
            for item in items {
                out.push_str(CodeText::of(item.to_token_stream()).as_str());
            }
        }
        CodeText(out)
    }
}

/// The root of the Cargo workspace: the nearest folder above the crate (or above the
/// current folder outside Cargo) whose Cargo.toml declares `[workspace]`.
pub fn workspace_root() -> Result<PathBuf, SourceCheckError> {
    let start = match std::env::var_os("CARGO_MANIFEST_DIR") {
        Some(dir) => PathBuf::from(dir),
        None => std::env::current_dir().map_err(|e| SourceCheckError::Workspace {
            message: e.to_string(),
        })?,
    };
    let mut dir = start.as_path();
    loop {
        let manifest = dir.join("Cargo.toml");
        if let Ok(text) = std::fs::read_to_string(&manifest) {
            if text.lines().any(|l| l.trim() == "[workspace]") {
                return Ok(dir.to_path_buf());
            }
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => {
                return Err(SourceCheckError::Workspace {
                    message: format!("no Cargo.toml with [workspace] above {}", start.display()),
                })
            }
        }
    }
}

/// A path inside the workspace, from its parts.
pub fn workspace_path(parts: &[&str]) -> Result<PathBuf, SourceCheckError> {
    let mut p = workspace_root()?;
    for part in parts {
        p.push(part);
    }
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SRC: &str = r#"
        //! pub fn process_request() { lock().expect("x") }
        /// process_request in a doc comment
        pub fn other() { let s = "pub fn process_request() { }"; let c = '{'; }

        pub fn process_request(line: &str) -> bool {
            // a brace in a comment: {
            let open = "{{{";
            let ch = '}';
            line.is_empty() && open.len() == 3 && ch == '}'
        }

        pub struct DockResponse { pub ok: bool, pub deny: Option<String> }

        pub enum DockRequest { Collect { collect: String }, Ping }

        impl Runtime {
            pub fn new() -> Self { Self }
            pub fn beat(&mut self) { self.tick(); }
        }

        impl Other {
            pub fn new() -> Self { Self }
        }

        mod docking {
            pub(crate) fn serve() { wait_collect_if_needed(); }
        }

        #[cfg(test)]
        mod tests {
            fn process_request() { db.lock().expect("test only") }
        }

        #[test]
        fn beat() {}
    "#;

    fn src() -> Result<RustSource, SourceCheckError> {
        RustSource::parse("sample.rs", SRC)
    }

    #[test]
    fn finds_a_function_by_identifier_and_ignores_strings_comments_and_braces(
    ) -> Result<(), SourceCheckError> {
        let f = src()?.function("process_request")?;
        assert!(f
            .as_str()
            .starts_with("pubfnprocess_request(line:&str)->bool{"));
        assert!(f.as_str().ends_with("ch=='}'}"));
        assert!(f.contains("open . len () == 3"));
        assert!(!f.contains("a brace in a comment"));
        Ok(())
    }

    #[test]
    fn a_missing_function_is_an_error_not_an_empty_text() -> Result<(), SourceCheckError> {
        let err = src()?.function("process_requests");
        assert_eq!(
            err,
            Err(SourceCheckError::Missing {
                label: String::from("sample.rs"),
                kind: "fn",
                name: String::from("process_requests"),
            })
        );
        Ok(())
    }

    #[test]
    fn a_renamed_function_fails_the_lookup() -> Result<(), SourceCheckError> {
        let renamed = SRC.replace("pub fn process_request(line", "pub fn handle_request(line");
        let s = RustSource::parse("renamed.rs", &renamed)?;
        assert!(matches!(
            s.function("process_request"),
            Err(SourceCheckError::Missing { .. })
        ));
        Ok(())
    }

    #[test]
    fn test_code_is_never_production() -> Result<(), SourceCheckError> {
        let s = src()?;
        assert!(!s.production().contains("test only"));
        assert!(!s.production().contains("a brace in a comment"));
        assert!(!s.production().contains("in a doc comment"));
        assert_eq!(
            s.function("Runtime::beat")?.as_str(),
            "pubfnbeat(&mutself){self.tick();}"
        );
        assert!(s.function("beat").is_ok());
        Ok(())
    }

    #[test]
    fn an_ambiguous_name_needs_its_owner() -> Result<(), SourceCheckError> {
        let s = src()?;
        assert!(matches!(
            s.function("new"),
            Err(SourceCheckError::Ambiguous { count: 2, .. })
        ));
        assert!(s.function("Other::new")?.contains("Self"));
        assert!(s
            .function("docking::serve")?
            .contains("wait_collect_if_needed"));
        Ok(())
    }

    #[test]
    fn finds_structs_and_enums() -> Result<(), SourceCheckError> {
        let s = src()?;
        assert!(s
            .type_item("DockResponse")?
            .contains("pub deny: Option<String>"));
        assert!(s
            .type_item("DockRequest")?
            .contains("Collect { collect: String }"));
        assert!(matches!(
            s.type_item("DockFrame"),
            Err(SourceCheckError::Missing { kind: "type", .. })
        ));
        Ok(())
    }

    #[test]
    fn text_that_is_not_rust_is_an_error() {
        assert!(matches!(
            RustSource::parse(
                "engine.ts",
                "async executeNode(node) { await admitGate(node); }"
            ),
            Err(SourceCheckError::Parse { .. })
        ));
    }

    #[test]
    fn after_last_cuts_at_the_last_needle() -> Result<(), SourceCheckError> {
        let s = RustSource::parse("a.rs", "fn f() { a(); b(); a(); c(); }")?;
        let f = s.function("f")?;
        assert_eq!(
            f.after_last("a()").map(|t| t.to_string()),
            Some(String::from("a();c();}"))
        );
        assert_eq!(f.after_last("z()"), None);
        Ok(())
    }

    #[test]
    fn reads_a_module_folder_and_the_workspace() -> Result<(), SourceCheckError> {
        let root = workspace_root()?;
        assert!(root.join("Cargo.toml").is_file());
        let dir = workspace_path(&["AEP-Components", "source-check", "crate", "src"])?;
        let s = RustSource::read_module_dir(&dir, &[])?;
        assert!(s.function("workspace_root").is_ok());
        assert!(matches!(
            RustSource::read_module_dir(&dir.join("absent"), &[]),
            Err(SourceCheckError::Read { .. })
        ));
        Ok(())
    }
}
