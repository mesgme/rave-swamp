<!-- BEGIN swamp managed section - DO NOT EDIT -->
# Project

This repository is managed with [swamp](https://github.com/systeminit/swamp).

## Rules

1. **Extension models for service integrations.** When automating AWS, APIs, or any external service, ALWAYS create an extension model in `extensions/models/`. Use the `swamp-extension-model` skill for guidance. The `command/shell` model is ONLY for ad-hoc one-off shell commands, NEVER for wrapping CLI tools or building integrations.
2. **Extend, don't be clever.** Don't work around a missing capability with shell scripts or multi-step hacks. Add a method to the extension model. One method, one purpose.
3. **Use the data model.** Once data exists in a model (via `lookup`, `start`, `sync`, etc.), reference it with CEL expressions. Don't re-fetch data that's already available.
4. **CEL expressions everywhere.** Wire models together with CEL expressions. Always prefer `data.latest("<name>", "<dataName>").attributes.<field>` over the deprecated `model.<name>.resource.<spec>.<instance>.attributes.<field>` pattern.
5. **Verify before destructive operations.** Always `swamp model get <name> --json` and verify resource IDs before running delete/stop/destroy methods.
6. **Extension npm deps are bundled, not lockfile-tracked.** Swamp's bundler inlines all npm packages (except zod) into extension bundles at bundle time. `deno.lock` and `package.json` do NOT cover extension model dependencies — this is by design. Always pin explicit versions in `npm:` import specifiers (e.g., `npm:lodash-es@4.17.21`).

## Skills

**IMPORTANT:** Always load swamp skills, even when in plan mode. The skills provide
essential context for working with this repository.

- `swamp-model` - Work with swamp models (creating, editing, validating)
- `swamp-workflow` - Work with workflows (creating, editing, running)
- `swamp-vault` - Manage secrets and credentials
- `swamp-data` - Manage model data lifecycle
- `swamp-repo` - Repository management
- `swamp-extension-model` - Create custom TypeScript models
- `swamp-extension-driver` - Create custom execution drivers
- `swamp-extension-datastore` - Create custom datastore backends
- `swamp-extension-vault` - Create custom vault providers
- `swamp-issue` - Submit bug reports and feature requests
- `swamp-troubleshooting` - Debug and diagnose swamp issues

## Getting Started

Always start by using the `swamp-model` skill to work with swamp models.

## Commands

Use `swamp --help` to see available commands.
<!-- END swamp managed section -->

# Rave

```
## GitHub Issues

### Rules
- When you create an issue that contains an implementation plan, immediately apply the **`planned`** label to it
- Close issues that have been fully implemented (don't leave them open after a PR merges)

```bash
# Apply planned label
gh issue edit <number> --repo mesgme/rave-spec --add-label "planned"

# Close a resolved issue
gh issue close <number> --repo mesgme/rave-spec --comment "Implemented in PR #<n>."
```

## Git Workflow

### Rules
- **Never merge PRs** — create PRs and leave merging to the user
- Use `--author="Claude Code <claude-code@anthropic.com>"` for all commits
- **Always use worktrees** for feature branches (never switch branches in main worktree)

### Worktree Workflow
```bash
# Start a new feature (from main worktree)
git worktree add ../rave-<feature> -b feature/<feature-name>

# Work in the new worktree
cd ../rave-<feature>

# When done, create PR, then clean up after merge
git worktree remove ../rave-<feature>
git branch -d feature/<feature-name>
git push origin --delete feature/<feature-name>
```

### Branch Protection
- Main branch requires PRs (no direct push)
- Enforced for admins

## Specification

The RAVE spec lives in `spec/rave-spec-v0.1.md`. Placeholder sections map to GitHub issues #2–#9.
