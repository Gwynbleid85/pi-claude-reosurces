# Claude resources in Pi

A Pi extension that reuses your global and project Claude skills, instructions, and rules without copying files or patching Pi.

## Install

```sh
pi install git:github.com/Gwynbleid85/pi-claude-reosurces
```

Run `/reload` in Pi, or start a new Pi process, to activate it. Tested with Pi 1.5.2.

If you previously installed a standalone copy in `~/.pi/agent/extensions/claude-resources/`, move that directory outside the extensions folder before installing this package so it does not load twice.

## What loads

- Skills from `~/.claude/skills/` and trusted project `.claude/skills/` directories. Pi lists them as normal skills and `/skill:name` commands.
- Instructions from `~/.claude/CLAUDE.md` and trusted project `.claude/CLAUDE.md` files.
- Markdown rules under global and trusted project `.claude/rules/`, recursively.

Project discovery walks from the current working directory up to the nearest repository root, including `.git` worktree files. Outside a repository it stops at home, when encountered, or the filesystem root. Global instructions come first, then project instructions from outermost to innermost directories. Project resources load only when Pi considers the project trusted.

Symlinks are supported. Skill discovery traverses directories with a realpath cycle guard and gives Pi individual skill files, avoiding recursive symlink loops in Pi's directory loader. Hidden directories and `node_modules` are skipped; this custom traversal does not interpret collection ignore files. Rule/context files are deduplicated by real path, including files already loaded by Pi. Skill-name collisions follow Pi's existing first-discovered-wins behavior; this extension does not override existing Pi skills.

## Scoped rules

Rules with a `paths` key in YAML frontmatter are listed with their file paths and original conditions. Scope detection uses Pi's YAML parser, including indented and flow-style mappings. Invalid YAML frontmatter is also advertised rather than applied unconditionally. The agent is instructed to read them before working on matching files. Their bodies are not injected as unconditional instructions. This is model-directed guidance, not Claude's native path-matching engine.

Rules without path conditions and `.claude/CLAUDE.md` contents are included automatically. Rules are rescanned before each agent run. Use `/reload` after adding, removing or editing skills.

## Limits

This extension does not load Claude hooks, commands, agents or plugin configurations. It does not replace Pi's existing resource discovery. The extension does not override Pi's trust decisions; if Pi does not consider the project trusted, project Claude resources are skipped.

To remove the package:

```sh
pi remove git:github.com/Gwynbleid85/pi-claude-reosurces
```

Then run `/reload`. Your Claude files are never removed.

## Development

Requires Node.js 22.19 or newer.

```sh
npm install --ignore-scripts
npm test
```

Tests use temporary directories and Pi's real API. They cover trust gates, repository boundaries, symlinks, YAML scopes, prompt refresh, deduplication, and downstream skill loading with cyclic directories in a timeout-bounded subprocess.

To run against an existing Pi installation instead of installing development dependencies, set `PI_TEST_HOST_ENTRY` to its absolute `dist/index.js` path and run `npm test`.
