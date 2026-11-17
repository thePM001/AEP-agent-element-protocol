//! The root file system of a sandbox: the programs of the toolset and nothing else.
//!
//! At session create the CAW resolves every program of the plan to its real file,
//! reads which loader and which shared libraries it needs, pins every file by sha256
//! and copies the files into the root folder of the session. The sandbox later sees
//! these copies. A program of the host that is replaced after session create does
//! not reach the sandbox.
//!
//! A toolset may also name folder trees, such as a compiler toolchain. A tree is not
//! copied. The sandbox mounts the folder of the host read only, and the CAW pins it:
//! at session create by a digest over the content of every file, before every command
//! by a digest over the listing of the tree with sizes, modes and change times. A
//! file below the path of a tree comes from the tree and is not copied a second time.
//!
//! No program is run to learn its needs. A program that is not an ELF file, such as
//! a script, is refused: its interpreter would have to be in the toolset by name.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Read;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::path::{Path, PathBuf};

use aep_caw_policy::is_under;
use aep_caw_policy::plan::{PlanProgram, PlanTree};
use sha2::{Digest, Sha256};

use crate::elf::{read_needs, ElfError};

/// Folders the loader searches when a library names none. The multiarch folders of
/// Debian come first, then the folders of other distributions.
pub const DEFAULT_LIBRARY_DIRS: [&str; 8] = [
    "/lib/x86_64-linux-gnu",
    "/usr/lib/x86_64-linux-gnu",
    "/lib/aarch64-linux-gnu",
    "/usr/lib/aarch64-linux-gnu",
    "/lib64",
    "/usr/lib64",
    "/lib",
    "/usr/lib",
];

/// Trees of the root that hold loaders and libraries. A loader or a library from
/// any other place, such as a temporary folder, is refused.
const LIBRARY_TREES: [&str; 5] = ["/lib", "/lib32", "/lib64", "/libx32", "/usr"];

fn in_library_trees(path: &str) -> bool {
    LIBRARY_TREES.iter().any(|tree| is_under(path, tree))
        && !path.split('/').any(|part| part == "..")
}

/// Most entries one tree holds.
const MAX_TREE_ENTRIES: usize = 400_000;

/// Largest file the root takes.
const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;
/// Most files one root holds.
const MAX_FILES: usize = 2048;

/// What a file of the root is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// A program of the toolset.
    Program,
    /// The loader a program names.
    Loader,
    /// A shared library.
    Library,
}

/// One pinned file of the root.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RootFile {
    /// Path of the file inside the sandbox.
    pub path: String,
    /// The real file on the host at the time of the pin.
    pub source: PathBuf,
    /// sha256 of the content in the form `sha256:<hex>`.
    pub sha256: String,
    /// What the file is.
    pub role: Role,
}

/// Every file of the root, sorted by path.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RootImage {
    /// The files.
    pub files: Vec<RootFile>,
    /// The pinned folder trees. A session written before trees existed has none.
    #[serde(default)]
    pub trees: Vec<PinnedTree>,
}

/// One pinned folder tree of the root.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PinnedTree {
    /// Name of the tree.
    pub name: String,
    /// The folder of the host.
    pub source: PathBuf,
    /// Path of the folder inside the sandbox.
    pub path: String,
    /// Folder inside the tree that joins the search path of programs.
    pub bin: Option<String>,
    /// Number of entries below the folder.
    pub entries: u64,
    /// Sum of the sizes of the regular files in bytes.
    pub bytes: u64,
    /// sha256 over the listing: kind, mode, size, change time and path of every entry.
    pub listing: String,
    /// sha256 over the content of every regular file with its path.
    pub content: String,
}

/// Why the root cannot be built.
#[derive(Debug, thiserror::Error)]
pub enum RootError {
    /// A file cannot be read or written.
    #[error("{what} {path}: {source}")]
    Io {
        /// What the CAW tried.
        what: &'static str,
        /// The path.
        path: PathBuf,
        /// The error of the operating system.
        source: std::io::Error,
    },
    /// A program or library is not a usable ELF file.
    #[error("{path} cannot be placed in a sandbox: {reason}")]
    NotUsable {
        /// The path.
        path: PathBuf,
        /// Why.
        reason: ElfError,
    },
    /// A library that a file names was found in no search folder.
    #[error("{needed_by} needs the library {library}, which is in no library folder")]
    LibraryMissing {
        /// The file that names the library.
        needed_by: PathBuf,
        /// Name of the library.
        library: String,
    },
    /// A loader or library would land outside the root file system.
    #[error("{needed_by} needs {path}, which lies outside the root file system of the sandbox")]
    OutsideRoot {
        /// The file that names the path.
        needed_by: PathBuf,
        /// The path.
        path: String,
    },
    /// Two different files would land at one path.
    #[error("two different files would land at {0} in the root")]
    Conflict(String),
    /// A file is too large or the root holds too many files.
    #[error("the root is too large: {0}")]
    TooLarge(String),
    /// A copied file does not carry its pinned digest.
    #[error("{0} changed while the root was built")]
    Changed(PathBuf),
    /// The source of a tree is not a real folder at its own path.
    #[error("the tree source {0} is not a real folder at its own path: it is missing, it is a link or a link lies on the way to it")]
    TreeSource(PathBuf),
    /// The root folder exists already.
    #[error("the root folder {0} exists already")]
    Exists(PathBuf),
}

fn io(what: &'static str, path: &Path) -> impl FnOnce(std::io::Error) -> RootError {
    let path = path.to_path_buf();
    move |source| RootError::Io { what, path, source }
}

fn hex_digest(bytes: &[u8]) -> String {
    let mut out = String::from("sha256:");
    for byte in Sha256::digest(bytes) {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// Reads a regular file with a size bound.
fn read_file(path: &Path) -> Result<Vec<u8>, RootError> {
    let file = fs::File::open(path).map_err(io("open", path))?;
    let meta = file.metadata().map_err(io("stat", path))?;
    if !meta.is_file() {
        return Err(RootError::Io {
            what: "read",
            path: path.to_path_buf(),
            source: std::io::Error::other("not a regular file"),
        });
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err(RootError::TooLarge(format!(
            "{} has {} bytes",
            path.display(),
            meta.len()
        )));
    }
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(io("read", path))?;
    Ok(bytes)
}

/// A file that waits for its needs to be read.
struct Pending {
    path: String,
    source: PathBuf,
    role: Role,
    /// True when a tree brings the file, so the root does not copy it.
    from_tree: bool,
}

/// The file of the host that a tree shows at `path` inside the sandbox.
fn in_tree(trees: &[PlanTree], path: &str) -> Option<PathBuf> {
    trees
        .iter()
        .find(|t| is_under(path, &t.path))
        .map(|t| Path::new(&t.source).join(path[t.path.len()..].trim_start_matches('/')))
}

/// One entry of a tree, in the form the listing digest reads.
struct TreeEntry {
    line: String,
    file: Option<(String, PathBuf, u64)>,
}

/// Every entry below `source`, sorted by path. Links are listed and never followed.
fn walk_tree(source: &Path) -> Result<Vec<TreeEntry>, RootError> {
    use std::os::unix::fs::MetadataExt;
    let mut out = Vec::new();
    let mut stack = vec![(source.to_path_buf(), String::new())];
    while let Some((dir, prefix)) = stack.pop() {
        let mut names = Vec::new();
        for entry in fs::read_dir(&dir).map_err(io("list", &dir))? {
            names.push(entry.map_err(io("list", &dir))?.file_name());
        }
        names.sort();
        for name in names {
            let path = dir.join(&name);
            let relative = format!("{prefix}{}", name.to_string_lossy());
            let meta = fs::symlink_metadata(&path).map_err(io("stat", &path))?;
            let kind = meta.file_type();
            let (tag, target) = if kind.is_symlink() {
                let target = fs::read_link(&path).map_err(io("read the link", &path))?;
                ("link", target.to_string_lossy().into_owned())
            } else if kind.is_dir() {
                ("dir", String::new())
            } else if kind.is_file() {
                ("file", String::new())
            } else {
                ("other", String::new())
            };
            let line = format!(
                "{tag}\t{:o}\t{}\t{}.{:09}\t{relative}\t{target}\n",
                meta.mode(),
                if kind.is_file() { meta.len() } else { 0 },
                meta.mtime(),
                meta.mtime_nsec(),
            );
            let file = kind
                .is_file()
                .then(|| (relative.clone(), path.clone(), meta.len()));
            out.push(TreeEntry { line, file });
            if out.len() > MAX_TREE_ENTRIES {
                return Err(RootError::TooLarge(format!(
                    "the tree {} holds more than {MAX_TREE_ENTRIES} entries",
                    source.display()
                )));
            }
            if kind.is_dir() {
                stack.push((path, format!("{relative}/")));
            }
        }
    }
    out.sort_by(|a, b| a.line.split('\t').nth(4).cmp(&b.line.split('\t').nth(4)));
    Ok(out)
}

fn is_real_dir(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.is_dir())
        && fs::canonicalize(path).is_ok_and(|real| real == path)
}

/// The digest over the listing of a tree, its number of entries and the sum of its
/// file sizes. This is the check that runs before every command: it reads no file
/// content, so it is fast for a tree of any size.
pub fn tree_listing(source: &Path) -> Result<(String, u64, u64), RootError> {
    if !is_real_dir(source) {
        return Err(RootError::TreeSource(source.to_path_buf()));
    }
    let entries = walk_tree(source)?;
    let mut hasher = Sha256::new();
    let mut bytes = 0u64;
    for entry in &entries {
        hasher.update(entry.line.as_bytes());
        if let Some((_, _, size)) = &entry.file {
            bytes += size;
        }
    }
    let mut digest = String::from("sha256:");
    for byte in hasher.finalize() {
        digest.push_str(&format!("{byte:02x}"));
    }
    Ok((digest, entries.len() as u64, bytes))
}

/// Pins one tree of a plan: its listing digest and a digest over the content of
/// every regular file. This runs once at session create.
pub fn pin_tree(tree: &PlanTree) -> Result<PinnedTree, RootError> {
    let source = Path::new(&tree.source);
    let (listing, entries, bytes) = tree_listing(source)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 16];
    for entry in walk_tree(source)? {
        let Some((relative, path, _)) = entry.file else {
            continue;
        };
        let mut file = fs::File::open(&path).map_err(io("open", &path))?;
        let mut one = Sha256::new();
        loop {
            let read = file.read(&mut buffer).map_err(io("read", &path))?;
            if read == 0 {
                break;
            }
            one.update(&buffer[..read]);
        }
        hasher.update(relative.as_bytes());
        hasher.update([0u8]);
        hasher.update(one.finalize());
    }
    let mut content = String::from("sha256:");
    for byte in hasher.finalize() {
        content.push_str(&format!("{byte:02x}"));
    }
    Ok(PinnedTree {
        name: tree.name.clone(),
        source: source.to_path_buf(),
        path: tree.path.clone(),
        bin: tree.bin.clone(),
        entries,
        bytes,
        listing,
        content,
    })
}

/// Resolves the programs of a plan with their loaders and libraries and pins its
/// trees.
///
/// `library_dirs` are the folders searched after the run path of a file. Pass
/// [`DEFAULT_LIBRARY_DIRS`] outside of tests. A loader or a library whose path lies
/// below a tree comes from that tree: the root does not copy it, and it must exist
/// in the folder of the tree.
pub fn resolve_root(
    programs: &[PlanProgram],
    trees: &[PlanTree],
    library_dirs: &[&str],
) -> Result<RootImage, RootError> {
    let mut pinned = Vec::new();
    for tree in trees {
        pinned.push(pin_tree(tree)?);
    }
    let mut files: BTreeMap<String, RootFile> = BTreeMap::new();
    let mut seen_in_trees: BTreeSet<String> = BTreeSet::new();
    let mut queue: Vec<Pending> = Vec::new();
    for program in programs {
        let source =
            fs::canonicalize(&program.source).map_err(io("resolve", Path::new(&program.source)))?;
        queue.push(Pending {
            path: program.path.clone(),
            source,
            role: Role::Program,
            from_tree: false,
        });
    }
    while let Some(item) = queue.pop() {
        if item.from_tree {
            if !seen_in_trees.insert(item.path.clone()) {
                continue;
            }
        } else if let Some(known) = files.get(&item.path) {
            if known.source != item.source {
                return Err(RootError::Conflict(item.path));
            }
            continue;
        }
        if files.len() + seen_in_trees.len() >= MAX_FILES {
            return Err(RootError::TooLarge(format!("more than {MAX_FILES} files")));
        }
        let bytes = read_file(&item.source)?;
        let needs = read_needs(&bytes).map_err(|reason| RootError::NotUsable {
            path: item.source.clone(),
            reason,
        })?;
        // Where a path of the sandbox lies on the host: in a tree or at the same path.
        let host_of = |path: &str| in_tree(trees, path).unwrap_or_else(|| PathBuf::from(path));
        if let Some(loader) = &needs.interpreter {
            if !in_library_trees(loader) {
                return Err(RootError::OutsideRoot {
                    needed_by: item.source.clone(),
                    path: loader.clone(),
                });
            }
            let host = host_of(loader);
            queue.push(Pending {
                path: loader.clone(),
                source: fs::canonicalize(&host).map_err(io("resolve", &host))?,
                role: Role::Loader,
                from_tree: in_tree(trees, loader).is_some(),
            });
        }
        let origin = item
            .source
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_default();
        let mut dirs: Vec<String> = needs
            .run_paths
            .iter()
            .map(|dir| {
                dir.replace("$ORIGIN", &origin.to_string_lossy())
                    .replace("${ORIGIN}", &origin.to_string_lossy())
            })
            .filter(|dir| dir.starts_with('/'))
            .collect();
        dirs.extend(library_dirs.iter().map(|d| (*d).to_string()));
        for library in &needs.needed {
            if library.contains('/') {
                return Err(RootError::OutsideRoot {
                    needed_by: item.source.clone(),
                    path: library.clone(),
                });
            }
            let found = dirs
                .iter()
                .map(|dir| format!("{}/{library}", dir.trim_end_matches('/')))
                .find(|candidate| fs::metadata(host_of(candidate)).is_ok_and(|m| m.is_file()));
            let Some(path) = found else {
                return Err(RootError::LibraryMissing {
                    needed_by: item.source.clone(),
                    library: library.clone(),
                });
            };
            // A library found through the run path of a file inside a tree lies in
            // that tree on the host. Inside the sandbox it lies below the tree path.
            let from_tree = in_tree(trees, &path).is_some();
            if !from_tree && !in_library_trees(&path) {
                return Err(RootError::OutsideRoot {
                    needed_by: item.source.clone(),
                    path,
                });
            }
            let host = host_of(&path);
            let source = fs::canonicalize(&host).map_err(io("resolve", &host))?;
            queue.push(Pending {
                path,
                source,
                role: Role::Library,
                from_tree,
            });
        }
        if !item.from_tree {
            files.insert(
                item.path.clone(),
                RootFile {
                    path: item.path,
                    source: item.source,
                    sha256: hex_digest(&bytes),
                    role: item.role,
                },
            );
        }
    }
    Ok(RootImage {
        files: files.into_values().collect(),
        trees: pinned,
    })
}

fn make_dirs(path: &Path) -> Result<(), RootError> {
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o755)
        .create(path)
        .map_err(io("create the folder", path))
}

fn inside(root: &Path, path: &str) -> PathBuf {
    root.join(path.trim_start_matches('/'))
}

fn write_text(root: &Path, path: &str, text: &str) -> Result<(), RootError> {
    let target = inside(root, path);
    fs::write(&target, text).map_err(io("write", &target))?;
    fs::set_permissions(&target, fs::Permissions::from_mode(0o444))
        .map_err(io("set the mode of", &target))
}

/// Builds the root folder of a session from a resolved image.
///
/// Copies every file, checks the copy against its pin and creates the folders the
/// sandbox mounts onto: the standard ones and one per mount path of the plan.
/// `root` must not exist yet.
pub fn build_root(image: &RootImage, mount_paths: &[&str], root: &Path) -> Result<(), RootError> {
    if root.exists() {
        return Err(RootError::Exists(root.to_path_buf()));
    }
    make_dirs(root)?;
    for dir in ["/proc", "/dev", "/tmp", "/run/caw", "/etc", "/usr/bin"] {
        make_dirs(&inside(root, dir))?;
    }
    for path in mount_paths {
        make_dirs(&inside(root, path))?;
    }
    for tree in &image.trees {
        make_dirs(&inside(root, &tree.path))?;
    }
    for file in &image.files {
        let target = inside(root, &file.path);
        if let Some(parent) = target.parent() {
            make_dirs(parent)?;
        }
        let bytes = read_file(&file.source)?;
        if hex_digest(&bytes) != file.sha256 {
            return Err(RootError::Changed(file.source.clone()));
        }
        fs::write(&target, &bytes).map_err(io("write", &target))?;
        fs::set_permissions(&target, fs::Permissions::from_mode(0o555))
            .map_err(io("set the mode of", &target))?;
    }
    write_text(root, "/etc/passwd", "root:x:0:0:root:/tmp:/usr/bin/sh\n")?;
    write_text(root, "/etc/group", "root:x:0:\n")?;
    write_text(root, "/etc/hosts", "127.0.0.1 localhost\n::1 localhost\n")?;
    Ok(())
}

/// Checks that every file of a built root still carries its pin and that the
/// listing of every tree is the one that was pinned.
pub fn verify_root(image: &RootImage, root: &Path) -> Result<(), RootError> {
    for file in &image.files {
        let target = inside(root, &file.path);
        if hex_digest(&read_file(&target)?) != file.sha256 {
            return Err(RootError::Changed(target));
        }
    }
    for tree in &image.trees {
        let (listing, _, _) = tree_listing(&tree.source)?;
        if listing != tree.listing {
            return Err(RootError::Changed(tree.source.clone()));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::elf::tests::build;
    use aep_caw_policy::in_root_trees;

    fn resolve_root_no_trees(
        programs: &[PlanProgram],
        dirs: &[&str],
    ) -> Result<RootImage, RootError> {
        resolve_root(programs, &[], dirs)
    }

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("caw-rootfs-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn program(name: &str, source: &Path) -> PlanProgram {
        PlanProgram {
            name: name.to_string(),
            source: source.to_string_lossy().into_owned(),
            path: format!("/usr/bin/{name}"),
        }
    }

    /// A folder with a static program, a program with one library and that library.
    fn fixture(name: &str) -> (PathBuf, PathBuf, PathBuf) {
        let dir = temp(name);
        let fixed = dir.join("static-tool");
        let mut plain = vec![0u8; 64];
        plain[..6].copy_from_slice(b"\x7fELF\x02\x01");
        fs::write(&fixed, &plain).expect("write");
        let linked = dir.join("linked-tool");
        fs::write(&linked, build(None, &["libcawtest.so.1"], None)).expect("write");
        (dir, fixed, linked)
    }

    #[test]
    fn a_static_program_is_pinned_alone() {
        let (dir, fixed, _) = fixture("static");
        let image = resolve_root_no_trees(&[program("tool", &fixed)], &[]).expect("resolves");
        assert_eq!(image.files.len(), 1);
        let file = &image.files[0];
        assert_eq!(file.path, "/usr/bin/tool");
        assert_eq!(file.role, Role::Program);
        assert_eq!(file.source, fs::canonicalize(&fixed).expect("canonical"));
        assert_eq!(file.sha256, hex_digest(&fs::read(&fixed).expect("read")));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_library_in_no_folder_refuses_the_root() {
        let (dir, _, linked) = fixture("missing-lib");
        let result = resolve_root_no_trees(&[program("tool", &linked)], &[]);
        assert!(
            matches!(result, Err(RootError::LibraryMissing { library, .. }) if library == "libcawtest.so.1")
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_library_outside_the_root_trees_refuses_the_root() {
        let (dir, _, linked) = fixture("outside-lib");
        fs::write(dir.join("libcawtest.so.1"), build(None, &[], None)).expect("write");
        let search = dir.to_string_lossy().into_owned();
        let result = resolve_root_no_trees(&[program("tool", &linked)], &[&search]);
        assert!(
            matches!(result, Err(RootError::OutsideRoot { .. })),
            "{result:?}"
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_script_a_folder_and_a_missing_file_are_refused() {
        let dir = temp("refused");
        let script = dir.join("script");
        fs::write(&script, "#!/bin/sh\necho hi\n").expect("write");
        assert!(matches!(
            resolve_root_no_trees(&[program("script", &script)], &[]),
            Err(RootError::NotUsable {
                reason: ElfError::NotElf,
                ..
            })
        ));
        assert!(matches!(
            resolve_root_no_trees(&[program("dir", &dir)], &[]),
            Err(RootError::Io { .. })
        ));
        assert!(matches!(
            resolve_root_no_trees(&[program("gone", &dir.join("gone"))], &[]),
            Err(RootError::Io { .. })
        ));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn two_different_files_at_one_path_are_a_conflict() {
        let (dir, fixed, _) = fixture("conflict");
        let other = dir.join("other");
        let mut bytes = vec![0u8; 80];
        bytes[..6].copy_from_slice(b"\x7fELF\x02\x01");
        fs::write(&other, &bytes).expect("write");
        let mut second = program("tool", &other);
        second.name = "tool2".to_string();
        let result = resolve_root_no_trees(&[program("tool", &fixed), second], &[]);
        assert!(matches!(result, Err(RootError::Conflict(path)) if path == "/usr/bin/tool"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_program_of_this_host_resolves_with_its_loader_and_libraries() {
        let Some(shell) = ["/bin/sh", "/usr/bin/sh"]
            .iter()
            .map(Path::new)
            .find(|p| p.exists())
        else {
            return;
        };
        let image = resolve_root_no_trees(&[program("sh", shell)], &DEFAULT_LIBRARY_DIRS)
            .expect("resolves");
        assert!(image
            .files
            .iter()
            .any(|f| f.role == Role::Program && f.path == "/usr/bin/sh"));
        for file in &image.files {
            assert!(in_root_trees(&file.path), "{}", file.path);
            assert_eq!(
                file.sha256,
                hex_digest(&fs::read(&file.source).expect("read"))
            );
        }
        let paths: Vec<&String> = image.files.iter().map(|f| &f.path).collect();
        let mut sorted = paths.clone();
        sorted.sort();
        assert_eq!(paths, sorted);
        let dynamic = read_needs(&fs::read(shell).expect("read"))
            .expect("elf")
            .interpreter
            .is_some();
        assert_eq!(image.files.iter().any(|f| f.role == Role::Loader), dynamic);
    }

    #[test]
    fn the_built_root_holds_the_pinned_copies_and_the_mount_points() {
        let (dir, fixed, _) = fixture("build");
        let image = resolve_root_no_trees(&[program("tool", &fixed)], &[]).expect("resolves");
        let root = dir.join("rootfs");
        build_root(&image, &["/home/agent/project", "/srv/config"], &root).expect("builds");
        let copy = root.join("usr/bin/tool");
        assert_eq!(
            fs::read(&copy).expect("read"),
            fs::read(&fixed).expect("read")
        );
        assert_eq!(
            fs::metadata(&copy).expect("meta").permissions().mode() & 0o777,
            0o555
        );
        for folder in [
            "proc",
            "dev",
            "tmp",
            "run/caw",
            "etc",
            "home/agent/project",
            "srv/config",
        ] {
            assert!(root.join(folder).is_dir(), "{folder}");
        }
        assert_eq!(
            fs::read_to_string(root.join("etc/hosts")).expect("read"),
            "127.0.0.1 localhost\n::1 localhost\n"
        );
        verify_root(&image, &root).expect("verifies");
        assert!(matches!(
            build_root(&image, &[], &root),
            Err(RootError::Exists(_))
        ));

        fs::set_permissions(&copy, fs::Permissions::from_mode(0o755)).expect("mode");
        fs::write(&copy, b"swapped").expect("write");
        assert!(matches!(
            verify_root(&image, &root),
            Err(RootError::Changed(_))
        ));
        let _ = fs::remove_dir_all(dir);
    }

    fn plan_tree(name: &str, source: &Path, path: &str) -> PlanTree {
        PlanTree {
            name: name.to_string(),
            source: source.to_string_lossy().into_owned(),
            path: path.to_string(),
            bin: Some("bin".to_string()),
        }
    }

    /// A tree with a program, a library and a link, in a folder with a real path.
    fn tree_fixture(name: &str) -> (PathBuf, PathBuf) {
        let base = fs::canonicalize(std::env::temp_dir()).expect("temp");
        let dir = base.join(format!("caw-tree-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let tree = dir.join("toolchain");
        fs::create_dir_all(tree.join("bin")).expect("bin");
        fs::create_dir_all(tree.join("lib/deep")).expect("lib");
        fs::write(
            tree.join("bin/compiler"),
            build(None, &["libtree.so.1"], Some("$ORIGIN/../lib")),
        )
        .expect("program");
        fs::write(tree.join("lib/libtree.so.1"), build(None, &[], None)).expect("library");
        fs::write(
            tree.join("lib/deep/notes.txt"),
            "a script or a text file is fine inside a tree\n",
        )
        .expect("text");
        std::os::unix::fs::symlink("libtree.so.1", tree.join("lib/libtree.so")).expect("link");
        (dir, tree)
    }

    #[test]
    fn a_tree_is_pinned_by_its_listing_and_by_its_content() {
        let (dir, tree) = tree_fixture("pin");
        let plan = plan_tree("toolchain", &tree, "/usr/local/toolchain");
        let pinned = pin_tree(&plan).expect("pins");
        assert_eq!(pinned.path, "/usr/local/toolchain");
        assert_eq!(pinned.source, tree);
        assert_eq!(pinned.bin.as_deref(), Some("bin"));
        assert_eq!(pinned.entries, 7, "three folders, three files and one link");
        assert!(pinned.bytes > 0);
        assert!(pinned.listing.starts_with("sha256:") && pinned.content.starts_with("sha256:"));
        assert_eq!(
            pin_tree(&plan).expect("pins"),
            pinned,
            "the same tree gives the same pin"
        );

        // Changed content changes the content digest and the listing digest.
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(tree.join("lib/deep/notes.txt"), "changed\n").expect("write");
        let changed = pin_tree(&plan).expect("pins");
        assert_ne!(changed.content, pinned.content);
        assert_ne!(changed.listing, pinned.listing);

        // A new file, a removed file and a changed mode each change the listing.
        fs::write(tree.join("bin/added"), b"x").expect("write");
        let added = tree_listing(&tree).expect("listing").0;
        assert_ne!(added, changed.listing);
        fs::remove_file(tree.join("bin/added")).expect("remove");
        // The folder that held the file keeps a new change time, so even a file
        // that was added and removed again leaves the listing changed.
        let removed = tree_listing(&tree).expect("listing").0;
        assert_ne!(removed, added);
        assert_ne!(removed, changed.listing);
        fs::set_permissions(tree.join("bin/compiler"), fs::Permissions::from_mode(0o700))
            .expect("mode");
        assert_ne!(tree_listing(&tree).expect("listing").0, removed);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_tree_source_that_is_missing_or_a_link_is_refused() {
        let (dir, tree) = tree_fixture("source");
        let missing = plan_tree("gone", &dir.join("gone"), "/usr/local/gone");
        assert!(matches!(pin_tree(&missing), Err(RootError::TreeSource(_))));
        std::os::unix::fs::symlink(&tree, dir.join("alias")).expect("link");
        let alias = plan_tree("alias", &dir.join("alias"), "/usr/local/alias");
        assert!(matches!(pin_tree(&alias), Err(RootError::TreeSource(_))));
        let file = plan_tree("file", &tree.join("bin/compiler"), "/usr/local/file");
        assert!(matches!(pin_tree(&file), Err(RootError::TreeSource(_))));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_library_below_a_tree_comes_from_the_tree_and_is_not_copied() {
        let (dir, tree) = tree_fixture("library");
        // A program of the toolset that needs a library which only the tree holds.
        let tool = dir.join("tool");
        fs::write(&tool, build(None, &["libtree.so.1"], None)).expect("tool");
        let plan = plan_tree("toolchain", &tree, "/usr/local/toolchain");
        let trees = vec![plan];
        let image = resolve_root(
            &[program("tool", &tool)],
            &trees,
            &["/usr/local/toolchain/lib"],
        )
        .expect("resolves");
        assert_eq!(image.trees.len(), 1);
        let paths: Vec<&str> = image.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(
            paths,
            vec!["/usr/bin/tool"],
            "the library is in the tree and not among the copied files"
        );
        // Without the tree the same library is in no folder.
        assert!(matches!(
            resolve_root(
                &[program("tool", &tool)],
                &[],
                &["/usr/local/toolchain/lib"]
            ),
            Err(RootError::LibraryMissing { .. })
        ));
        // A library that the tree does not hold is missing with the tree as well.
        let other = dir.join("other");
        fs::write(&other, build(None, &["libabsent.so.9"], None)).expect("other");
        assert!(matches!(
            resolve_root(&[program("other", &other)], &trees, &["/usr/local/toolchain/lib"]),
            Err(RootError::LibraryMissing { library, .. }) if library == "libabsent.so.9"
        ));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_tree_that_changed_after_the_pin_fails_the_check_of_the_root() {
        let (dir, tree) = tree_fixture("verify");
        let tool = dir.join("tool");
        let mut plain = vec![0u8; 64];
        plain[..6].copy_from_slice(b"\x7fELF\x02\x01");
        fs::write(&tool, &plain).expect("tool");
        let trees = vec![plan_tree("toolchain", &tree, "/usr/local/toolchain")];
        let image = resolve_root(&[program("tool", &tool)], &trees, &[]).expect("resolves");
        let root = dir.join("rootfs");
        build_root(&image, &[], &root).expect("builds");
        assert!(
            root.join("usr/local/toolchain").is_dir(),
            "the mount point of the tree exists"
        );
        verify_root(&image, &root).expect("an unchanged tree passes");

        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(tree.join("bin/compiler"), b"swapped").expect("write");
        assert!(matches!(verify_root(&image, &root), Err(RootError::Changed(p)) if p == tree));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_program_that_changes_after_the_pin_is_not_copied() {
        let (dir, fixed, _) = fixture("changed");
        let image = resolve_root_no_trees(&[program("tool", &fixed)], &[]).expect("resolves");
        let mut bytes = fs::read(&fixed).expect("read");
        bytes.push(1);
        fs::write(&fixed, &bytes).expect("write");
        assert!(matches!(
            build_root(&image, &[], &dir.join("rootfs")),
            Err(RootError::Changed(_))
        ));
        let _ = fs::remove_dir_all(dir);
    }
}
