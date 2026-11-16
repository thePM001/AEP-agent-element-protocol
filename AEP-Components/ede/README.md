# EDE: enforced draft environments for coding agents

A coding agent changes a repository only through a draft. The draft is a clone whose git folder sits beside the tree the agent edits. Every change set is scanned before it lands and lands as one commit, as a pull request on GitHub or as a branch on any git remote. Every step runs under the registered identity and the agent profile of the agent that does the work. No control comes from the environment of the agent: the operator folder holds every one of them.

## 1. Set up the operator folder

The operator folder `/etc/aep-ede` belongs to the EDE user of the host (for example `aep-ede`). The `aep-ede` binary belongs to that user and carries the set user id bit, so it reads and writes the operator folder and the record root while the agent cannot.

```
/etc/aep-ede/operator.conf        forge, roots, quota, age bounds
/etc/aep-ede/profiles/<agent>.gap the agent profiles
/etc/aep-ede/agents/<agent>.pub   the registered public key of each agent
/etc/aep-ede/github-token         the token of the GitHub forge, mode 0600
/etc/aep-ede/ede.key              the EDE key, made on first use, mode 0600
```

`operator.conf` holds `key: value` lines. An unknown key closes every verb.

```
forge: github                      # or git
github_url: https://github.com
github_api: https://api.github.com
git_remote: https://git.example    # the base URL of the git forge
git_direct: off                    # on: the git forge lands on the base branch itself
default_owner: owner               # the owner of a bare repository name
state_root: /var/lib/aep-ede/drafts
record_root: /var/lib/aep-ede/records
quota_bytes: 8589934592
draft_max_age_secs: 604800
scan_max_age_secs: 86400
seal_max_age_secs: 86400
ede_user: aep-ede
lattice: /path/to/aep-lattice.yaml # optional, the lattice of dynAEP that ships is the default
```

## 2. Register an agent

The agent proves who it is with a frame signed by its own ML-DSA-65 key, the same proof the dock of the Base Node asks of an agent. The agent makes its key; the operator registers the public half and writes the profile.

```
aep-ede agent keygen /home/agent/.aep-ede.seed          # by the agent: prints the public key
aep-ede agent register my-coding-agent <public-hex>      # by the operator
aep-ede profile init my-coding-agent owner/repo          # by the operator
```

The agent runs with two variables. Neither is a control: a wrong value only fails the proof.

```
export AEP_AGENT_ID=my-coding-agent
export AEP_AGENT_KEY=/home/agent/.aep-ede.seed
```

An agent profile is a GAP policy. It names the agent in `agent_permission` records with one record per verb: `ede.seed`, `ede.refresh`, `ede.scan`, `ede.promote` and `ede.expire`. It lists the repositories the agent may change in `extensions.aep.ede_repos`. aep-ede reads it with the GAP schema parser of AEP, so a line inside a block scalar is text and never a record. A profile that does not parse grants nothing. The reference copy is `AEP-Components/gap/policies/reference/ede-coding-agent.gap`.

- Remove the `ede.promote` record and the agent can prepare and scan drafts while a person lands them.
- A `*` in `ede_repos` stands for every repository.
- `diff`, `status` and `path` read a draft under the grant of `ede.scan`.

## 3. Work through drafts

```
aep-ede seed owner/repo main        # clone, record the base commit, print the draft id
aep-ede path <draft>                # the tree to edit
aep-ede diff <draft>                # the change set against the base, new files included
aep-ede scan <draft>                # judge the change set, bind it to a scan id
aep-ede promote <draft> -m "Title

Body of the pull request."           # land it
aep-ede expire <draft>              # end a draft and leave a tombstone
```

## What each step guarantees

| Step | Guarantee |
|------|-----------|
| every verb | The frame of the agent verifies under its registered key, the profile of the operator grants the verb for the repository, the verb holds the lock of the draft and the EDE lifecycle wall of dynAEP admits it. A draft belongs to the agent that seeded it. |
| seed | The draft id is new: `ede-<unix seconds>-<32 hex>` from 128 random bits, made with an exclusive create. A failed seed removes only the folder it made. The record of the draft is sealed with the EDE key. |
| scan | git writes the tree object of the draft and scan judges its blobs, never the files of the work tree. The added lines of prose files (`.md`, `.txt`, `.rst`, `.adoc`) pass the writing walls of AEP Admit at the line where they now stand, collect all. Text that already sat in the file never blocks. Symbolic links, submodules, blobs that do not hold the bytes their ids name, prose that is not UTF-8 text and drafts above their quota are refused. |
| promote | The scan is inside its age bound and its scan id matches the sealed statement. promote fetches the tip of the branch. When the branch moved it merges the scanned tree onto the tip and scans the merged tree again. It lands exactly the scanned tree as one commit on the tip with the trailers `AEP-Agent`, `AEP-EDE-Draft`, `AEP-EDE-Scan` and `AEP-EDE-Base`. A promoted draft is done: seed a new one for more work. |

Every seed, scan, rescan, refresh, promote, expire and sweep is one entry of a chained ledger in the record root. `aep-ede ledger-check` checks the chain. `aep-ede sweep`, run by the operator, expires drafts past `draft_max_age_secs`.

## Identifiers

Every draft environment of AEP follows one identifier specification. Its vectors are `identifier-vectors.gaplune` of this component.

| Identifier | Grammar |
|------------|---------|
| draft id | `ede-<unix seconds>-<32 lower hex>`. The seconds have no leading zero and at most 20 digits. The 32 hex digits are 128 random bits of the kernel. Every verb checks the grammar. The id inside the record equals the name of the record and of the draft folder. |
| agent id | Lower case letters, digits and single hyphens, 1 to 64, no hyphen at either end. |
| session id | Letters, digits and hyphens, 1 to 64, starting with a letter or a digit. |
| repository | `owner/name`, compared in lower case. Each part is 1 to 100 of letters, digits, dot, underscore and hyphen, starts with a letter or a digit, holds no `..` and does not end with `.git`. A bare name takes the owner of the operator. |
| branch | What `git check-ref-format refs/heads/<branch>` accepts, without a leading hyphen and without `@{`. |
| path in a draft | Relative, no empty part, no `.` or `..` part, no `.git` part, no backslash. |
| record value | No control character, so a value never breaks a record line. |
| scan id | sha256 over one length prefixed statement: `aep-ede-scan-v1`, draft id, agent, session, repository, branch, base commit, the git tree id, the sha256 of the full listing of the tree with modes, the digest of the policy, the digest of the CI manifest, the seed second and the scan second. Each field is its length in decimal, a colon and its bytes. aep-ede leaves session and CI manifest empty. |

## Forges

The operator folder picks the forge.

- `github`: seed clones `<github_url>/<owner>/<repo>.git`. promote pushes the landing commit to the branch `aep-ede/<draft>` and opens a pull request against the base branch, so the required status checks of the repository decide the merge. The token comes from `github-token` of the operator folder and remains in memory: it reaches git through the environment of the one git process that fetches or pushes and the API through a header of the request aep-ede sends in process. It is written to no file, git config or command line.
- `git`: seed clones `<git_remote>/<owner>/<repo>.git`. promote pushes to the branch `aep-ede/<draft>` or to the base branch itself with `git_direct: on`. Credentials come from the git credential helper of the EDE user.

## Where it sits in AEP

The EDE is the coding agent side of Admit. The EDE decides how the git state of a coding agent may change at all: through a scanned draft and nothing else. Its lifecycle is part of the action lattice of dynAEP (the nodes `ede.seed` to `ede.expire`).

The record root and the EDE key are out of reach of an agent only while the agent runs as a user other than the EDE user and other than root. The sandbox that runs the agent carries that side of the boundary.

## Build and test

```
cargo test -p aep-ede
```

The tests run against local bare repositories and a local stand-in for the GitHub API, so they need no network and no token.
