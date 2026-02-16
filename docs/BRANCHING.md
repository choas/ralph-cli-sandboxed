# Branching

Ralph supports working on multiple features in parallel using git branches. PRD items can be tagged with a `branch` field, and ralph will automatically create git worktrees to isolate branch work from the main checkout.

## Overview

```
prd.yaml (single source of truth)
├── item: "Add login page"        branch: feat/auth
├── item: "Add session tokens"    branch: feat/auth
├── item: "Redesign header"       branch: feat/ui
├── item: "Fix typo in footer"    (no branch — runs on main)
```

When `ralph run` encounters items with a `branch` field, it:

1. Creates a git worktree for that branch
2. Processes all items tagged with that branch in the worktree
3. Switches back to the base branch for untagged items

Items without a `branch` field work exactly as before — no configuration needed.

## Architecture

### The Problem

Ralph runs inside a Docker/Podman container with the project directory mounted at `/workspace`. If the AI agent runs `git checkout feat/auth` inside the container, the host's working directory also switches — because it's a shared volume mount. This would disrupt any work the user is doing on the host.

### The Solution: Git Worktrees

[Git worktrees](https://git-scm.com/docs/git-worktree) allow multiple working copies of the same repository, each on a different branch, without cloning. They share the same `.git` database, so branches, commits, and history are all unified.

```
Host                                        Container
─────────────────────────────────────────────────────────────────
~/prj/cool-prj                    →         /workspace
  (stays on main, untouched)                  (base branch)

~/ralph-worktrees/cool-prj        →         /worktrees
  cool-prj_feat-auth/                         cool-prj_feat-auth/
    src/                                        src/
    package.json                                package.json
  cool-prj_feat-ui/                           cool-prj_feat-ui/
    src/                                        src/
    package.json                                package.json
```

- **`/workspace`** is the main project mount (host's working directory, stays on its current branch)
- **`/worktrees`** is a separate mount pointing to a host directory where worktrees are stored

Both share the same `.git` database. Commits made in any worktree are visible everywhere.

### File Layout per Worktree

Each worktree gets its own `.ralph/` directory with branch-specific files:

```
/worktrees/cool-prj_feat-auth/
├── .ralph/
│   ├── prd-tasks.json      ← filtered: only feat/auth items
│   ├── progress.txt         ← branch-specific progress log
│   └── prompt.md            ← copied from workspace
├── src/
├── package.json
└── ...
```

The master `prd.yaml` and `config.json` always live in `/workspace/.ralph/` and are the single source of truth. After each iteration, ralph syncs completed items (`passes: true`) from the worktree's `prd-tasks.json` back to the master `prd.yaml`.

## Configuration

### 1. Set the Worktrees Path

Add `docker.worktreesPath` to `.ralph/config.json`:

```json
{
  "docker": {
    "worktreesPath": "~/ralph-worktrees/cool-prj"
  }
}
```

This tells ralph where to store worktrees on the host. The directory will be created automatically if it doesn't exist.

### 2. Docker Mount

When `worktreesPath` is configured, `ralph docker init` adds a second volume mount to `docker-compose.yml`:

```yaml
volumes:
  - ~/prj/cool-prj:/workspace
  - ~/ralph-worktrees/cool-prj:/worktrees
```

If `worktreesPath` is not set, no `/worktrees` mount is added and branching is not available (items with `branch` fields will be skipped with a warning).

### 3. Tag PRD Items

Add the `branch` field to any PRD item:

```yaml
- category: feature
  description: Add login page with email/password form
  branch: feat/auth
  steps:
    - Create login form component in src/components/Login.tsx
    - Add form validation for email and password fields
    - Run `npm test` and verify tests pass
  passes: false

- category: feature
  description: Add JWT session token generation
  branch: feat/auth
  steps:
    - Implement token generation in src/auth/tokens.ts
    - Add token validation middleware
    - Run `npm test` and verify tests pass
  passes: false

- category: bugfix
  description: Fix typo in footer copyright text
  steps:
    - Fix the typo in src/components/Footer.tsx
    - Run `npm test` and verify tests pass
  passes: false
```

The first two items will be processed together in a `feat/auth` worktree. The third item (no `branch`) runs on the base branch in `/workspace`.

## Execution Flow

```
ralph run
│
├─ Read prd.yaml → group items by branch
│
├─ Group: feat/auth (2 items)
│  ├─ git worktree add /worktrees/cool-prj_feat-auth feat/auth
│  ├─ Set up /worktrees/cool-prj_feat-auth/.ralph/ (prd-tasks.json, progress.txt, prompt.md)
│  ├─ Run iteration 1 in /worktrees/cool-prj_feat-auth/
│  │   └─ Sync passes back to /workspace/.ralph/prd.yaml
│  ├─ Run iteration 2 in /worktrees/cool-prj_feat-auth/
│  │   └─ Sync passes back to /workspace/.ralph/prd.yaml
│  └─ Switch back to /workspace
│
├─ Group: feat/ui (1 item)
│  ├─ git worktree add /worktrees/cool-prj_feat-ui feat/ui
│  ├─ ...
│  └─ Switch back to /workspace
│
├─ Group: (no branch) (1 item)
│  ├─ Run iteration in /workspace (same as today)
│  └─ Done
│
└─ All groups complete
```

### Resume After Interruption

If ralph is interrupted (Ctrl+C, container restart), the active branch state is saved in `.ralph/config.json`:

```json
{
  "branch": {
    "baseBranch": "main",
    "currentBranch": "feat/auth"
  }
}
```

On the next `ralph run`, ralph detects the existing worktree and resumes where it left off. The worktree's `progress.txt` is preserved (it's on the host filesystem), so the AI agent has context from previous iterations.

The branch state is cleaned up from config after the group completes.

## Branch Management Commands

### `ralph branch list`

Shows all branches referenced in the PRD with status:

```
Branches:

  ○ feat/auth  2/3 [worktree] ◀ active
  ○ feat/ui  0/1
  ○ (no branch)  1/2
```

Each branch shows a pass/total count, a `[worktree]` indicator if the worktree directory exists on disk, and `◀ active` if it's the branch currently being worked on.

### `ralph branch merge <name>`

Merges a completed branch back into the base branch:

```bash
ralph branch merge feat/auth
```

1. Asks for confirmation
2. Merges `feat/auth` into the base branch (in `/workspace`)
3. Removes the worktree with `git worktree remove` (if it exists)

If there are merge conflicts, ralph aborts the merge, lists the conflicting files, and suggests resolving manually or creating a PRD item for the AI to resolve.

### `ralph branch pr <name>`

Creates a GitHub pull request for the branch using the `gh` CLI:

```bash
ralph branch pr feat/auth
```

1. Verifies `gh` is installed and authenticated
2. Pushes the branch to the remote if it has no upstream tracking
3. Generates a PR body with PRD item checklist and commit log
4. Asks for confirmation
5. Creates the PR via `gh pr create`

Requires the [GitHub CLI](https://cli.github.com/) (`gh`) to be installed and authenticated.

### `ralph branch delete <name>`

Removes a branch and its worktree:

```bash
ralph branch delete feat/old-feature
```

1. Asks for confirmation
2. Removes the worktree with `git worktree remove`
3. Deletes the git branch
4. Removes the `branch` field from any remaining PRD items tagged with that branch

## Merge Conflict Handling

When `ralph branch merge` detects conflicts:

```
Merge conflict detected!

Conflicting files:
  src/components/App.tsx
  src/utils/config.ts

Merge aborted.

To resolve:
  1. Resolve conflicts manually and merge again
  2. Or add a PRD item to resolve the conflicts:
     ralph prd add  # describe the conflict resolution needed
```

Conflicts are a normal part of branching. They occur when both the branch and the base branch modify the same lines. Ralph never force-merges — it always aborts cleanly and lets the user decide.

## Persistence and Safety

| What | Where | Persists across container restarts? |
|------|-------|-------------------------------------|
| Master `prd.yaml` | `/workspace/.ralph/prd.yaml` (host) | Yes |
| `config.json` | `/workspace/.ralph/config.json` (host) | Yes |
| Worktree source files | `/worktrees/<branch>/` (host) | Yes |
| Branch-specific `progress.txt` | `/worktrees/<branch>/.ralph/progress.txt` (host) | Yes |
| Git branches and commits | `/workspace/.git/` (host) | Yes |
| Worktree metadata | `/workspace/.git/worktrees/` (host) | Yes |

Everything lives on the host filesystem. Container restarts lose nothing.

## Limitations

- **Branching requires Docker/Podman**: The worktree mount is set up via docker-compose. Running `ralph run` directly on the host without containers doesn't use worktrees (but `git checkout` works fine since there's no mount isolation concern).
- **One branch group at a time**: Ralph processes branch groups sequentially, not in parallel. Each group completes before the next starts.
- **Worktree disk usage**: Each worktree is a full working copy of the project (minus `.git`). For large projects, multiple worktrees may use significant disk space.
- **`.ralph/` is gitignored**: The `.ralph/` directories created in worktrees are not tracked by git. This is intentional — they contain runtime state, not source code.
