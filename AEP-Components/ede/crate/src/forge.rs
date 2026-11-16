//! Forges of the public EDE.
//!
//! The operator folder picks the forge, never the agent. Two forges ship:
//!
//! - GitHub clones <github_url>/<owner>/<repo>.git. Promote pushes the one landing
//!   commit to the branch aep-ede/<draft> and opens a pull request against the base
//!   branch, so the required checks of the repository decide the merge.
//! - Plain git clones <git_remote>/<owner>/<repo>.git. Promote pushes the landing commit
//!   to aep-ede/<draft>, or to the base branch itself with git_direct: on.
//!
//! The GitHub token lives in github-token of the operator folder (mode 0600, owner the
//! EDE user). aep-ede reads it into memory. It reaches git only through the environment
//! of the one git process that fetches or pushes, and the API only through a header of
//! the request that aep-ede sends in process. No token is written to a file, a git
//! config or a command line.

use crate::ident::Repo;
use crate::operator::{ForgeKind, Operator};
use base64::Engine;
use serde::Deserialize;
use std::fs;

pub trait Forge {
    fn name(&self) -> &'static str;
    /// The URL a draft clones from and lands to.
    fn url(&self, repo: &Repo) -> String;
    /// Environment of the git process that reaches the forge.
    fn git_env(&self) -> Vec<(String, String)>;
    /// The branch the landing commit goes to.
    fn target(&self, base_branch: &str, draft: &str) -> String;
    /// Whether the forge can land at all, checked before anything is pushed.
    fn ready(&self) -> Result<(), String> {
        Ok(())
    }
    /// The step after the push: a pull request or nothing. Returns what landed.
    fn after_push(
        &self,
        repo: &Repo,
        base_branch: &str,
        branch: &str,
        message: &str,
    ) -> Result<String, String>;
}

pub struct GitForge {
    pub remote_base: String,
    pub direct: bool,
}

impl Forge for GitForge {
    fn name(&self) -> &'static str {
        "git"
    }
    fn url(&self, repo: &Repo) -> String {
        format!(
            "{}/{}.git",
            self.remote_base.trim_end_matches('/'),
            repo.full()
        )
    }
    fn git_env(&self) -> Vec<(String, String)> {
        Vec::new()
    }
    fn target(&self, base_branch: &str, draft: &str) -> String {
        if self.direct {
            base_branch.to_string()
        } else {
            format!("aep-ede/{}", draft)
        }
    }
    fn after_push(
        &self,
        _repo: &Repo,
        _base: &str,
        branch: &str,
        _message: &str,
    ) -> Result<String, String> {
        Ok(format!("branch {}", branch))
    }
}

pub struct GitHubForge {
    pub web: String,
    pub api: String,
    proxy: Option<String>,
    token: String,
}

#[derive(Deserialize)]
struct PullAnswer {
    html_url: String,
}

#[derive(serde::Serialize)]
struct PullRequest<'a> {
    title: &'a str,
    head: &'a str,
    base: &'a str,
    body: &'a str,
}

impl GitHubForge {
    pub fn new(web: &str, api: &str, token: String, proxy: Option<String>) -> Self {
        GitHubForge {
            web: web.to_string(),
            api: api.to_string(),
            proxy,
            token,
        }
    }
}

impl Forge for GitHubForge {
    fn name(&self) -> &'static str {
        "github"
    }
    fn url(&self, repo: &Repo) -> String {
        format!("{}/{}.git", self.web.trim_end_matches('/'), repo.full())
    }
    fn git_env(&self) -> Vec<(String, String)> {
        let mut env = Vec::new();
        if let Some(p) = &self.proxy {
            env.push(("HTTPS_PROXY".into(), p.clone()));
        }
        if self.token.is_empty() {
            return env;
        }
        let basic = base64::engine::general_purpose::STANDARD
            .encode(format!("x-access-token:{}", self.token));
        env.extend([
            ("GIT_CONFIG_COUNT".into(), "1".into()),
            ("GIT_CONFIG_KEY_0".into(), "http.extraHeader".into()),
            (
                "GIT_CONFIG_VALUE_0".into(),
                format!("Authorization: Basic {}", basic),
            ),
        ]);
        env
    }
    fn ready(&self) -> Result<(), String> {
        if self.token.is_empty() {
            return Err("the operator folder holds no github-token: a pull request needs a token with contents and pull request write access".into());
        }
        Ok(())
    }
    fn target(&self, _base_branch: &str, draft: &str) -> String {
        format!("aep-ede/{}", draft)
    }
    fn after_push(
        &self,
        repo: &Repo,
        base_branch: &str,
        branch: &str,
        message: &str,
    ) -> Result<String, String> {
        if self.token.is_empty() {
            return Err("the operator folder holds no github-token: a pull request needs a token with contents and pull request write access".into());
        }
        let mut lines = message.lines();
        let title = lines.next().unwrap_or("aep-ede promote").trim().to_string();
        let body = lines.collect::<Vec<_>>().join("\n");
        let request = PullRequest {
            title: &title,
            head: branch,
            base: base_branch,
            body: body.trim(),
        };
        let url = format!(
            "{}/repos/{}/{}/pulls",
            self.api.trim_end_matches('/'),
            repo.owner,
            repo.name
        );
        // The proxy of the request comes from the operator folder; a proxy variable of the
        // agent environment is never read.
        let mut builder = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .user_agent("aep-ede")
            .no_proxy();
        if let Some(p) = &self.proxy {
            builder = builder.proxy(
                reqwest::Proxy::all(p)
                    .map_err(|e| format!("https_proxy of the operator: {}", e))?,
            );
        }
        let client = builder.build().map_err(|e| e.to_string())?;
        let answer = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Accept", "application/vnd.github+json")
            .json(&request)
            .send()
            .map_err(|e| format!("the pull request was not sent: {}", e.without_url()))?;
        let status = answer.status().as_u16();
        let text = answer.text().unwrap_or_default();
        if status != 201 {
            return Err(format!(
                "the pull request was refused with HTTP {}: {}",
                status,
                text.chars().take(200).collect::<String>()
            ));
        }
        let parsed: PullAnswer = serde_json::from_str(&text)
            .map_err(|e| format!("the answer of the pull request does not parse: {}", e))?;
        Ok(format!("pull request {}", parsed.html_url))
    }
}

/// The forge of the operator.
pub fn of(op: &Operator) -> Box<dyn Forge> {
    match op.forge {
        ForgeKind::Git => Box::new(GitForge {
            remote_base: op.git_remote.clone(),
            direct: op.git_direct,
        }),
        ForgeKind::GitHub => {
            let token = {
                let _r = crate::privilege::raise();
                fs::read_to_string(op.token_path())
                    .map(|t| t.trim().to_string())
                    .unwrap_or_default()
            };
            Box::new(GitHubForge::new(
                &op.github_url,
                &op.github_api,
                token,
                op.https_proxy.clone(),
            ))
        }
    }
}
