# EDE: enforced draft environments for coding agents

A coding agent changes a repository only through a draft. The draft is a clone with no push URL. The agent edits its tree. Every change set is scanned before it lands and lands in one step, as a pull request on GitHub or as a branch on any git remote.

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
