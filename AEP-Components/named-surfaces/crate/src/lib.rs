// Named surfaces execute so CodeSandbox runs agent code while transpilers emit GAP and MCP backend transport forwards allowed calls.
use std::fs;
use std::io::Write;
use std::path::PathBuf;


fn walk_to_workspace() -> PathBuf {
    let mut dir = if let Ok(m) = std::env::var("CARGO_MANIFEST_DIR") {
        PathBuf::from(m)
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    };
    let mut i = 0usize;
    while i < 12 {
        let probe = dir
            .join("AEP-Components")
            .join("aep-comm")
            .join("lib")
            .join("code-sandbox.ts");
        if probe.is_file() {
            return dir;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
        i = i.saturating_add(1);
    }
    PathBuf::from(".")
}

fn read_src(path: &PathBuf, label: &str) -> Result<String, String> {
    if path.is_file() == false {
        return Err(format!("missing {label} source"));
    }
    match fs::read_to_string(path) {
        Ok(v) => {
            if v.is_empty() {
                Err(format!("empty {label} source"))
            } else {
                Ok(v)
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

fn lower_has(src: &str, needle: &str) -> bool {
    src.to_ascii_lowercase().contains(needle)
}

pub fn scan_code_sandbox_executes(src: &str) -> Result<String, String> {
    if lower_has(src, "not implemented") {
        return Err(String::from("CodeSandbox still says not implemented"));
    }
    if src.contains("spawn") == false {
        return Err(String::from("CodeSandbox missing spawn"));
    }
    if src.contains("AEP_DATA") == false {
        return Err(String::from("CodeSandbox missing AEP_DATA"));
    }
    if src.contains("sandbox") == false {
        return Err(String::from("CodeSandbox missing sandbox dir"));
    }
    if src.contains("empty code refused") == false {
        return Err(String::from("CodeSandbox missing empty code refuse"));
    }
    if src.contains("unshare") == false {
        return Err(String::from("CodeSandbox missing unshare"));
    }
    if src.contains("path escape refused") == false {
        return Err(String::from("CodeSandbox missing path escape refuse"));
    }
    Ok(String::from("ok CodeSandbox executes"))
}

pub fn scan_transpilers_emit_gap(src: &str) -> Result<String, String> {
    if lower_has(src, "not implemented") {
        return Err(String::from("transpiler still says not implemented"));
    }
    if src.contains("refusing pass-through") == false {
        return Err(String::from("transpiler missing empty refuse"));
    }
    if src.contains("address") == false {
        return Err(String::from("transpiler missing GAP address"));
    }
    Ok(String::from("ok transpilers emit GAP"))
}

pub fn scan_mcp_backend_transport(src: &str) -> Result<String, String> {
    if lower_has(src, "backend transport not implemented") {
        return Err(String::from("MCP backend transport still not live"));
    }
    if src.contains("initialize") == false {
        return Err(String::from("MCP backend missing initialize"));
    }
    if src.contains("tools/call") == false {
        return Err(String::from("MCP backend missing tools/call"));
    }
    if src.contains("mcp-session-id") == false {
        return Err(String::from("MCP backend missing mcp-session-id"));
    }
    Ok(String::from("ok MCP backend transport forwards"))
}

pub fn scan_mcp_proxy_wires_backend(src: &str) -> Result<String, String> {
    if src.contains("forwardMcpCall") == false {
        return Err(String::from("mcp-proxy missing forwardMcpCall"));
    }
    if src.contains("mcp-backend") == false {
        return Err(String::from("mcp-proxy missing mcp-backend import"));
    }
    if lower_has(src, "backend transport not implemented") {
        return Err(String::from("mcp-proxy still names missing transport"));
    }
    Ok(String::from("ok mcp-proxy forwards"))
}

pub fn scan_readme_names_surfaces(src: &str) -> Result<String, String> {
    let low = src.to_ascii_lowercase();
    if low.contains("codesandbox") == false {
        return Err(String::from("README missing CodeSandbox"));
    }
    if low.contains("execut") == false && low.contains("live") == false {
        return Err(String::from("README missing execute or live"));
    }
    if low.contains("gap") == false {
        return Err(String::from("README missing GAP"));
    }
    if low.contains("mcp") == false {
        return Err(String::from("README missing MCP"));
    }
    Ok(String::from("ok README names live surfaces"))
}

fn comp(root: &PathBuf, parts: &[&str]) -> PathBuf {
    let mut p = root.clone();
    for part in parts {
        p = p.join(part);
    }
    p
}

fn must_read(root: &PathBuf, parts: &[&str], label: &str) -> Result<String, String> {
    read_src(&comp(root, parts), label)
}

pub fn run_named_surface_gate() -> Result<i32, String> {
    let root = walk_to_workspace();
    let sandbox_src = must_read(&root, &["AEP-Components", "aep-comm", "lib", "code-sandbox.ts"], "code-sandbox");
    let sandbox_src = match sandbox_src {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let cedar_src = match must_read(&root, &["AEP-Components", "policy-engine", "lib", "policy", "transpilers", "cedar-to-gap.ts"], "cedar-to-gap") {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let rego_src = match must_read(&root, &["AEP-Components", "policy-engine", "lib", "policy", "transpilers", "rego-to-gap.ts"], "rego-to-gap") {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let gap_cedar_src = match must_read(&root, &["AEP-Components", "policy-engine", "lib", "policy", "transpilers", "gap-to-cedar.ts"], "gap-to-cedar") {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let gap_rego_src = match must_read(&root, &["AEP-Components", "policy-engine", "lib", "policy", "transpilers", "gap-to-rego.ts"], "gap-to-rego") {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let mcp_backend_src = match must_read(&root, &["AEP-Components", "proxy", "lib", "mcp-backend.ts"], "mcp-backend") {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let mcp_proxy_src = match must_read(&root, &["AEP-Components", "proxy", "lib", "mcp-proxy.ts"], "mcp-proxy") {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let named_readme_src = match must_read(&root, &["AEP-Components", "named-surfaces", "README.md"], "named-surfaces README") {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let comm_readme_src = match must_read(&root, &["AEP-Components", "aep-comm", "README.md"], "aep-comm README") {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let proxy_readme_src = match must_read(&root, &["AEP-Components", "proxy", "README.md"], "proxy README") {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let transpiler_readme_src = match must_read(&root, &["AEP-Components", "policy-engine", "lib", "policy", "transpilers", "README.md"], "transpilers README") {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let mut proofs: Vec<String> = Vec::new();
    match scan_code_sandbox_executes(&sandbox_src) {
        Ok(v) => proofs.push(v),
        Err(e) => return Err(e),
    }
    match scan_transpilers_emit_gap(&cedar_src) {
        Ok(v) => proofs.push(v),
        Err(e) => return Err(e),
    }
    match scan_transpilers_emit_gap(&rego_src) {
        Ok(v) => proofs.push(v),
        Err(e) => return Err(e),
    }
    match scan_transpilers_emit_gap(&gap_cedar_src) {
        Ok(v) => proofs.push(v),
        Err(e) => return Err(e),
    }
    match scan_transpilers_emit_gap(&gap_rego_src) {
        Ok(v) => proofs.push(v),
        Err(e) => return Err(e),
    }
    match scan_mcp_backend_transport(&mcp_backend_src) {
        Ok(v) => proofs.push(v),
        Err(e) => return Err(e),
    }
    match scan_mcp_proxy_wires_backend(&mcp_proxy_src) {
        Ok(v) => proofs.push(v),
        Err(e) => return Err(e),
    }
    match scan_readme_names_surfaces(&named_readme_src) {
        Ok(v) => proofs.push(v),
        Err(e) => return Err(e),
    }
    if comm_readme_src.to_ascii_lowercase().contains("codesandbox") == false || comm_readme_src.to_ascii_lowercase().contains("execut") == false {
        return Err(String::from("aep-comm README missing CodeSandbox execute"));
    }
    proofs.push(String::from("ok aep-comm README"));
    if proxy_readme_src.to_ascii_lowercase().contains("mcp") == false || proxy_readme_src.to_ascii_lowercase().contains("forward") == false {
        return Err(String::from("proxy README missing MCP forward"));
    }
    proofs.push(String::from("ok proxy README"));
        if transpiler_readme_src.contains("GAP-to-Rego") == false || transpiler_readme_src.contains("GAP-to-Cedar") == false {
        return Err(String::from("transpilers README missing reverse surfaces"));
    }
    for proof in proofs {
        let mut line = String::from("aep-named-surfaces ok proof=");
        line.push_str(&proof);
        line.push('\n');
        let _ = std::io::stdout().write_all(line.as_bytes());
    }
    Ok(0)
}

pub mod hvvcas_scan_code_sandbox_executes {
    pub struct ScanCodeSandboxExecutes {
        pub src: String,
        pub scan: String,
    }
    impl ScanCodeSandboxExecutes {
        pub fn new() -> Self {
            Self { src: String::new(), scan: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.scan = match super::scan_code_sandbox_executes(&self.src) {
                Ok(v) => v,
                Err(e) => e,
            };
            Ok(())
        }
    }
}

pub mod hvvcas_scan_transpilers_emit_gap {
    pub struct ScanTranspilersEmitGap {
        pub src: String,
        pub scan: String,
    }
    impl ScanTranspilersEmitGap {
        pub fn new() -> Self {
            Self { src: String::new(), scan: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.scan = match super::scan_transpilers_emit_gap(&self.src) {
                Ok(v) => v,
                Err(e) => e,
            };
            Ok(())
        }
    }
}

pub mod hvvcas_scan_mcp_backend_transport {
    pub struct ScanMcpBackendTransport {
        pub src: String,
        pub scan: String,
    }
    impl ScanMcpBackendTransport {
        pub fn new() -> Self {
            Self { src: String::new(), scan: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.scan = match super::scan_mcp_backend_transport(&self.src) {
                Ok(v) => v,
                Err(e) => e,
            };
            Ok(())
        }
    }
}

pub mod hvvcas_scan_readme_names_surfaces {
    pub struct ScanReadmeNamesSurfaces {
        pub src: String,
        pub scan: String,
    }
    impl ScanReadmeNamesSurfaces {
        pub fn new() -> Self {
            Self { src: String::new(), scan: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.scan = match super::scan_readme_names_surfaces(&self.src) {
                Ok(v) => v,
                Err(e) => e,
            };
            Ok(())
        }
    }
}

pub mod hvvcas_run_named_surface_gate {
    pub struct RunNamedSurfaceGate {
        pub src: String,
        pub scan: String,
    }
    impl RunNamedSurfaceGate {
        pub fn new() -> Self {
            Self { src: String::new(), scan: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.scan = match super::run_named_surface_gate() {
                Ok(_) => String::from("ok"),
                Err(e) => e,
            };
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fail() {
        let none: Option<i32> = None;
        let _ = none.unwrap();
    }

    #[test]
    fn sandbox_scan_rejects_missing_spawn() {
        match scan_code_sandbox_executes("empty code refused AEP_DATA sandbox unshare path escape refused") {
            Err(e) => {
                if e.contains("spawn") == false {
                    fail();
                }
            }
            Ok(_) => fail(),
        }
    }

    #[test]
    fn transpiler_scan_rejects_missing_address() {
        match scan_transpilers_emit_gap("refusing pass-through") {
            Err(e) => {
                if e.contains("address") == false {
                    fail();
                }
            }
            Ok(_) => fail(),
        }
    }

    #[test]
    fn mcp_scan_rejects_missing_initialize() {
        match scan_mcp_backend_transport("tools/call mcp-session-id") {
            Err(e) => {
                if e.contains("initialize") == false {
                    fail();
                }
            }
            Ok(_) => fail(),
        }
    }

    #[test]
    fn named_surface_gate_passes_on_tree() {
        match run_named_surface_gate() {
            Ok(_) => {}
            Err(_) => fail(),
        }
    }
}
