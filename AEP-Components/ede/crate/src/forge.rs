//! Forges of the public EDE. A forge seeds a draft with a read-only clone and lands
//! the work of a draft. Two forges ship: GitHub and plain git.
//!
//! - GitHub clones https://github.com/<owner>/<repo>.git. Promote pushes the work
//!   to the branch aep-ede/<draft> and opens a pull request against the base
//!   branch, so the required checks of the repository decide the merge.
//! - Plain git clones any remote. Promote pushes the work to the branch
//!   aep-ede/<draft>. With AEP_EDE_GIT_DIRECT=1 it pushes to the base branch itself.
//!
//! A token reaches git through the environment of the git process only and
//! reaches the GitHub API through a header file that promote removes again.
//! No token is written to a git config or shown on a command line.

use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::Command;

pub trait Forge {
    fn name(&self) -> &'static str;
    /// The URL a draft clones from.
    fn clone_url(&self, repo: &str) -> String;
    /// Extra environment for git calls that reach the forge.
    fn git_env(&self) -> Vec<(String, String)>;
    /// Land the commit at HEAD of `tree`. Returns the branch or pull request it landed as.
    fn land(&self, tree: &Path, repo: &str, base_branch: &str, draft: &str, message: &str) -> Result<String, String>;
}

fn env_or(key: &str, dflt: &str) -> String {
    match std::env::var(key) {
        Ok(v) if !v.is_empty() => v,
        _ => dflt.to_string(),
    }
}

fn git_out(tree: &Path, env: &[(String, String)], args: &[&str]) -> Result<String, String> {
    let mut c = Command::new("git");
    c.arg("-C").arg(tree).args(args).env("GIT_TERMINAL_PROMPT", "0");
    for (k, v) in env {
        c.env(k, v);
    }
    let o = c.output().map_err(|e| e.to_string())?;
    if o.status.success() {
        Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&o.stderr).trim().to_string())
    }
}

/// Standard base64 without padding loss, for the basic auth header of git over HTTPS.
pub fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

pub struct GitForge {
    pub remote_base: String,
    pub direct: bool,
}

impl GitForge {
    pub fn from_env() -> Self {
        GitForge {
            remote_base: env_or("AEP_EDE_GIT_REMOTE", ""),
            direct: env_or("AEP_EDE_GIT_DIRECT", "0") == "1",
        }
    }
}

impl Forge for GitForge {
    fn name(&self) -> &'static str {
        "git"
    }
    fn clone_url(&self, repo: &str) -> String {
        if self.remote_base.is_empty() {
            repo.to_string()
        } else {
            format!("{}/{}.git", self.remote_base.trim_end_matches('/'), repo)
        }
    }
    fn git_env(&self) -> Vec<(String, String)> {
        Vec::new()
    }
    fn land(&self, tree: &Path, _repo: &str, base_branch: &str, draft: &str, _message: &str) -> Result<String, String> {
        let target = if self.direct { base_branch.to_string() } else { format!("aep-ede/{}", draft) };
        git_out(tree, &[], &["push", "-q", "ede-land", &format!("HEAD:refs/heads/{}", target)])?;
        Ok(format!("branch {}", target))
    }
}

pub struct GitHubForge {
    pub web: String,
    pub api: String,
    pub token: String,
}

impl GitHubForge {
    pub fn from_env() -> Self {
        GitHubForge {
            web: env_or("AEP_EDE_GITHUB_URL", "https://github.com"),
            api: env_or("AEP_EDE_GITHUB_API", "https://api.github.com"),
            token: env_or("GITHUB_TOKEN", ""),
        }
    }
}

/// The value of a JSON string field in a flat answer, without a JSON library.
pub fn json_field(body: &str, key: &str) -> Option<String> {
    let at = body.find(&format!("\"{}\"", key))?;
    let rest = &body[at + key.len() + 2..];
    let rest = rest.trim_start().strip_prefix(':')?.trim_start().strip_prefix('"')?;
    Some(rest.chars().take_while(|c| *c != '"').collect())
}

fn json_string(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

impl Forge for GitHubForge {
    fn name(&self) -> &'static str {
        "github"
    }
    fn clone_url(&self, repo: &str) -> String {
        format!("{}/{}.git", self.web.trim_end_matches('/'), repo)
    }
    fn git_env(&self) -> Vec<(String, String)> {
        if self.token.is_empty() {
            return Vec::new();
        }
        let basic = base64(format!("x-access-token:{}", self.token).as_bytes());
        vec![
            ("GIT_CONFIG_COUNT".into(), "1".into()),
            ("GIT_CONFIG_KEY_0".into(), "http.extraHeader".into()),
            ("GIT_CONFIG_VALUE_0".into(), format!("Authorization: Basic {}", basic)),
        ]
    }
    fn land(&self, tree: &Path, repo: &str, base_branch: &str, draft: &str, message: &str) -> Result<String, String> {
        if self.token.is_empty() {
            return Err("GITHUB_TOKEN is empty: a pull request needs a token with contents and pull request write access".into());
        }
        let branch = format!("aep-ede/{}", draft);
        git_out(tree, &self.git_env(), &["push", "-q", "ede-land", &format!("HEAD:refs/heads/{}", branch)])?;
        let mut lines = message.lines();
        let title = lines.next().unwrap_or("aep-ede promote").trim().to_string();
        let body: Vec<&str> = lines.collect();
        let payload = format!(
            "{{\"title\":{},\"head\":{},\"base\":{},\"body\":{}}}",
            json_string(&title),
            json_string(&branch),
            json_string(base_branch),
            json_string(body.join("\n").trim())
        );
        let headers = tree.parent().unwrap_or(tree).join("github-headers");
        {
            let mut f = fs::File::create(&headers).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&headers, fs::Permissions::from_mode(0o600));
            }
            writeln!(f, "Authorization: Bearer {}", self.token).map_err(|e| e.to_string())?;
            writeln!(f, "Accept: application/vnd.github+json").map_err(|e| e.to_string())?;
            writeln!(f, "Content-Type: application/json").map_err(|e| e.to_string())?;
        }
        let url = format!("{}/repos/{}/pulls", self.api.trim_end_matches('/'), repo);
        let out = Command::new("curl")
            .arg("-s")
            .arg("-m")
            .arg("60")
            .arg("-X")
            .arg("POST")
            .arg("-H")
            .arg(format!("@{}", headers.display()))
            .arg("--data-binary")
            .arg(&payload)
            .arg("-w")
            .arg("\n%{http_code}")
            .arg(&url)
            .output();
        let _ = fs::remove_file(&headers);
        let o = out.map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&o.stdout).to_string();
        let code = text.lines().last().unwrap_or("").trim().to_string();
        if code != "201" {
            return Err(format!("the pull request was refused with HTTP {}: {}", code, text.lines().next().unwrap_or("").chars().take(200).collect::<String>()));
        }
        Ok(format!("pull request {}", json_field(&text, "html_url").unwrap_or(branch)))
    }
}

pub fn from_env() -> Box<dyn Forge> {
    match env_or("AEP_EDE_FORGE", "github").as_str() {
        "git" => Box::new(GitForge::from_env()),
        _ => Box::new(GitHubForge::from_env()),
    }
}
