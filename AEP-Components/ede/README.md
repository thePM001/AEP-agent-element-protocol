# EDE: enforced draft environments for coding agents

A coding agent changes a repository only through a draft. The draft is a clone with no push URL. The agent edits its tree. Every change set is scanned before it lands and lands in one step, as a pull request on GitHub or as a branch on any git remote. Every step runs under the agent profile of the agent that does the work.

## 1. Create an agent profile

An agent profile is a GAP policy. It names the agent in `agent_permission` records with one record per EDE action it may take. It lists the repositories the agent may change in `extensions.aep.ede_repos`, the host block that GAP keeps for AEP data. The EDE checks it with the agent permission wall of AEP Admit, the same wall that every other AEP action passes.

Create one per agent:

```
aep-ede profile init my-coding-agent owner/repo
```

This writes `~/.aep-ede/profiles/my-coding-agent.gap`:

```yaml
address:
  domain: dev.aep.ede
  id: my-coding-agent-coding.v1

pattern: |
  Agent profile of my-coding-agent for enforced draft environments.
  The agent changes the listed repositories only through aep-ede drafts.

action:
  type: template
  content: |
    Change the repositories listed in extensions.aep.ede_repos only through aep-ede drafts.

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: "aep-ede profile init"
  version: "1.0.0"
  stability: stable
  aspect: procedural
  agent_permission:
    - agent_id: my-coding-agent
      action: ede.seed
    - agent_id: my-coding-agent
      action: ede.scan
    - agent_id: my-coding-agent
      action: ede.promote

extensions:
  aep:
    ede_repos:
      - owner/repo
```

Edit it like any GAP policy:

- Remove the `ede.promote` record and the agent can prepare and scan drafts while a person lands them.
- Add repositories to `extensions.aep.ede_repos`. A `*` stands for every repository.
- `gapc check` from the GAP repository validates the profile like any other GAP policy.
- `agent_id: "*"` grants an action to every agent that uses the profile. Name each agent instead, so its commits stay traceable.
- Keep the profile in your repository or your policy folder and point `AEP_EDE_PROFILE` at it to share it with a team.

The reference copy is `AEP-Components/gap/policies/reference/ede-coding-agent.gap`.

## 2. Bind the agent to its profile

Set two variables in the environment the agent runs in: its launcher, its service unit or its CAW session (see `AEP-Components/gap/policies/reference/caw-coding-agent.gap` for the sandbox side).

```
export AEP_AGENT_ID=my-coding-agent
export AEP_EDE_PROFILE=/path/to/my-coding-agent.gap   # optional, default ~/.aep-ede/profiles/<AEP_AGENT_ID>.gap
```

Check the binding:

```
aep-ede profile check
agent my-coding-agent profile /home/me/.aep-ede/profiles/my-coding-agent.gap grants seed scan promote for owner/repo
```

From then on:

- `seed`, `scan` and `promote` each pass the permission wall for `ede.seed`, `ede.scan` and `ede.promote`, plus the `ede_repos` scope. A missing identity, a missing profile or a missing grant is refused with the record to add.
- A draft belongs to the agent that seeded it. Another agent cannot scan or promote it.
- Every promote commit ends with the trailer `AEP-Agent: <agent id>`, so the history and the pull request name the agent.

## 3. Work through drafts

```
aep-ede seed owner/repo main        # clone, record the base commit, print the draft id
aep-ede path <draft>                # the tree to edit
aep-ede diff <draft>                # the change set against the base, new files included
aep-ede scan <draft>                # judge the change set, record its digest
aep-ede promote <draft> -m "Title

Body of the pull request."           # land it
```

## What each step guarantees

| Step | Guarantee |
|------|-----------|
| seed | The tree is a clone at a known base commit. `git push` from the tree fails: only promote lands work. |
| scan | The added lines of prose files (`.md`, `.txt`, `.rst`, `.adoc`) pass the writing walls of AEP Admit, collect all, so one scan names every finding with file and line. Text that already sat in the file never blocks. Symbolic links, submodules and drafts above their quota (8 GiB, `AEP_EDE_QUOTA`) are refused. |
| promote | The change set equals the scanned one, byte for byte. The draft fetches the tip of its branch first. When the branch moved, the work is rebased inside the draft. A conflict is refused with every conflicting path named and the work remains in the tree as it was. |

## Forges

`AEP_EDE_FORGE` picks the forge.

- `github` (the default): seed clones `https://github.com/<owner>/<repo>.git`. Promote pushes the work to the branch `aep-ede/<draft>` and opens a pull request against the base branch, so the required status checks of the repository decide the merge. Promote needs `GITHUB_TOKEN` with contents and pull request write access. The token reaches git through the environment of the git process and the API through a header file that promote removes, never through a git config or a command line. `AEP_EDE_GITHUB_URL` and `AEP_EDE_GITHUB_API` point at GitHub Enterprise.
- `git`: seed clones `$AEP_EDE_GIT_REMOTE/<repo>.git`. Promote pushes to the branch `aep-ede/<draft>`. With `AEP_EDE_GIT_DIRECT=1` it pushes to the base branch itself. Credentials come from your git credential helper.

Drafts live under `AEP_EDE_ROOT`, by default `~/.aep-ede`. `aep-ede expire <draft>` removes one.

## Where it sits in AEP

The EDE is the coding agent side of Admit. Coding governance (`AEP-Components/coding-governance`) links governance records to git state. The EDE decides how the git state of a coding agent may change at all: through a scanned draft and nothing else.

## Build and test

```
cargo test -p aep-ede
```

The tests run against local bare repositories and a local stand-in for the GitHub API, so they need no network and no token.
