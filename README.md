# Pi Claude Resources

**Keep your Claude instructions. Use them in Pi.**

[![Pi](https://img.shields.io/badge/Pi-tested%20with%201.5.2-6366f1)](https://pi.dev)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.19-43853d?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-extension-3178c6?logo=typescript&logoColor=white)](extensions/claude-resources/index.ts)

Reuse the skills, rules, and instructions you already maintain in `.claude` directories. This extension connects them to [Pi](https://pi.dev), so you can share guidance across tools without copying files or patching Pi.

- **Global and project-local resources** — use `~/.claude` alongside trusted project directories.
- **Path-scoped rules** — expose conditions without applying their instructions globally.
- **Symlink support** — share resource collections with cycle-safe discovery.
- **Existing Pi setup preserved** — add Claude resources without replacing Pi's normal discovery.

[Quick start](#quick-start) · [What loads](#what-loads) · [Examples](#examples) · [How it works](#how-it-works) · [Troubleshooting](#troubleshooting) · [Development](#development)

## Quick start

Install the package:

```sh
pi install git:github.com/Gwynbleid85/pi-claude-reosurces
```

Then run this inside Pi, or start a new Pi process:

```text
/reload
```

That's it. Existing `.claude` resources are discovered automatically; there is no extension-specific configuration.

> [!IMPORTANT]
> Previously installed a standalone copy in `~/.pi/agent/extensions/claude-resources/`? Move it outside Pi's extensions directory before installing this package to avoid loading the extension twice.

## What loads

| Resource | Global location | Project location | Behavior |
| --- | --- | --- | --- |
| Instructions | `~/.claude/CLAUDE.md` | `.claude/CLAUDE.md` | Included in the prompt when unconditional. |
| Rules | `~/.claude/rules/**/*.md` | `.claude/rules/**/*.md` | Unconditional rules are included; path-scoped rules are advertised for relevant work. |
| Skills | `~/.claude/skills/` | `.claude/skills/` | Registered as normal Pi skills, with `/skill:name` invocation. |

**Project-local resources load only when Pi considers the project trusted.** Global resources do not depend on project trust.

This extension specifically discovers instructions **inside `.claude` directories**. It does not add discovery for root-level `CLAUDE.md` or `CLAUDE.local.md` files.

## Examples

### Share a familiar directory layout

Use the same structure globally under `~/.claude/` or locally inside a project:

```text
my-project/
├── .git/
├── .claude/
│   ├── CLAUDE.md
│   ├── rules/
│   │   ├── testing.md
│   │   └── frontend/
│   │       └── react.md
│   └── skills/
│       └── review-changes/
│           └── SKILL.md
└── src/
```

For example, `.claude/CLAUDE.md` might contain:

```markdown
# Project conventions

- Use the existing package manager and formatting tools.
- Add regression tests when fixing bugs.
- Keep changes focused on the task.
```

### Apply rules to relevant files

Add YAML frontmatter to `.claude/rules/frontend/react.md`:

```markdown
---
paths:
  - "src/**/*.tsx"
---

# React conventions

- Prefer existing components before adding new ones.
- Keep state close to the component that owns it.
```

The extension lists the rule's path and conditions in the prompt. The agent is instructed to read the rule before working on matching files, rather than treating its body as global guidance. Patterns are relative to the directory containing `.claude`—the project root in this example.

> [!NOTE]
> Scoped rules are **model-directed guidance**, not an enforced matcher or Claude's native rule engine. Scope detection uses Pi's YAML parser and supports block and flow-style mappings. Rules with invalid YAML frontmatter are advertised rather than applied unconditionally.

### Reuse a skill

Create `.claude/skills/review-changes/SKILL.md`:

```markdown
---
name: review-changes
description: Review local changes for correctness, missing tests, and unintended behavior.
---

Inspect the diff, identify risks, and report findings by severity.
```

Run `/reload`, then invoke it in Pi:

```text
/skill:review-changes
```

Skill discovery supports nested collections. A directory containing `SKILL.md` is treated as a skill root, so discovery does not continue beneath it. Standalone Markdown skills directly inside the collection root are also supported.

## How it works

### Discovery and ordering

1. Discover global resources in `~/.claude`.
2. For trusted projects, walk from Pi's working directory through its ancestors to the nearest repository root. Both `.git` directories and worktree marker files are recognized.
3. Load project instructions from outermost to innermost directories, after global instructions. The prompt tells the agent to favor more specific project guidance when instructions conflict.

Outside a repository, discovery stops at the home directory when encountered, or at the filesystem root. Discovery follows Pi's current working directory; it does not scan every descendant project directory.

### Symlinks and duplicate resources

- Skill and rule traversal uses real paths to avoid directory cycles.
- Skills are passed to Pi as individual files, avoiding recursive symlink loops in Pi's directory loader.
- Rule and instruction files are deduplicated by real path, including context files Pi has already loaded.
- Skill-name collisions follow Pi's **first-discovered-wins** policy. This extension does not override existing Pi skills.

Skill traversal skips hidden entries and `node_modules`. It does **not** interpret collection ignore files such as `.gitignore`, `.ignore`, or `.fdignore`.

### Refresh behavior

| Change | When Pi picks it up |
| --- | --- |
| Add or edit instructions and rules | Before the next agent run. |
| Add, edit, or remove skills | After `/reload` or a new Pi process. |
| Install or remove the extension | After `/reload` or a new Pi process. |

## Compatibility and limits

Tested with **Pi 1.5.2**. This package is a resource bridge, not a complete Claude runtime compatibility layer.

It does **not**:

- Load Claude hooks, slash-command definitions, agents, or plugin configurations.
- Override Pi's project-trust decisions.
- Replace Pi's existing skills or context-file discovery.
- Enforce path-scoped instructions at the tool or filesystem level.
- Modify, copy, or delete your Claude resource files.

Only load instructions and skills you trust: their content can influence the agent's actions.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Project resources are missing | Confirm Pi considers the project trusted and that `.claude` is between the working directory and repository root. |
| A new or edited skill is missing | Run `/reload`. Check that `SKILL.md` has valid frontmatter and a description. |
| A different skill with the same name loads | Check Pi's startup diagnostics for name collisions; the first discovered skill wins. |
| A scoped rule is not visible as full instructions | Expected: only its path and conditions are advertised until the agent reads it for relevant work. |
| The extension appears twice | Remove any standalone copy from Pi's extensions directory before using the installed package. |
| An ignored skill still appears | Collection ignore files are not interpreted by this extension's skill traversal. |

## Uninstall

```sh
pi remove git:github.com/Gwynbleid85/pi-claude-reosurces
```

Then run `/reload`. Your `.claude` files remain untouched.

## Development

Requires **Node.js 22.19 or newer**.

```sh
git clone https://github.com/Gwynbleid85/pi-claude-reosurces.git
cd pi-claude-reosurces
npm install --ignore-scripts
npm test
```

The tests use temporary directories and Pi's real API. Coverage includes project trust, repository boundaries, YAML scopes, symlinks, deduplication, prompt refresh, and downstream skill loading with cyclic directories in a timeout-bounded subprocess.

To test against an existing Pi installation instead of installing development dependencies:

```sh
PI_TEST_HOST_ENTRY=/absolute/path/to/pi-coding-agent/dist/index.js npm test
```

### Repository layout

```text
extensions/claude-resources/index.ts   Resource discovery and prompt integration
tests/claude-resources.test.mjs        Filesystem discovery and runtime tests
tests/claude-resources-prompt.test.mjs Rule scoping, trust, and prompt tests
tests/fixtures/pi-host.mjs             Pi host-package resolution for tests
```
