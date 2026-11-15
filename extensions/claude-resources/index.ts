import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseFrontmatter, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ContextFile = { path: string; content: string };
type Resources = { skillPaths: string[]; files: ContextFile[]; warnings: string[] };

function optional<T>(path: string, warnings: string[], read: () => T): T | undefined {
  try {
    return read();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      warnings.push(`Cannot load Claude resource ${path}: ${(error as Error).message}`);
    }
    return undefined;
  }
}

function canonical(path: string): string {
  try { return realpathSync(path); } catch { return resolve(path); }
}

export function discoverResources(cwd: string, home: string, trusted: boolean): Resources {
  const result: Resources = { skillPaths: [], files: [], warnings: [] };
  const directories = [join(home, ".claude")];
  if (trusted) {
    const ancestors: string[] = [];
    for (let dir = resolve(cwd); ; dir = dirname(dir)) {
      ancestors.push(join(dir, ".claude"));
      const marker = optional(join(dir, ".git"), result.warnings, () => statSync(join(dir, ".git")));
      if (marker || canonical(dir) === canonical(home) || dirname(dir) === dir) break;
    }
    directories.push(...ancestors.reverse());
  }

  const seenSkills = new Set<string>();
  const seenSkillDirs = new Set<string>();
  const walkSkills = (dir: string, includeRootFiles: boolean) => {
    const key = canonical(dir);
    if (seenSkillDirs.has(key)) return;
    seenSkillDirs.add(key);
    const entries = optional(dir, result.warnings, () => readdirSync(dir));
    if (!entries) return;
    const addSkill = (file: string) => {
      const key = canonical(file);
      if (!seenSkills.has(key)) {
        seenSkills.add(key);
        result.skillPaths.push(file);
      }
    };
    const declared = join(dir, "SKILL.md");
    if (entries.includes("SKILL.md") && optional(declared, result.warnings, () => statSync(declared))?.isFile()) {
      addSkill(declared);
      return;
    }
    for (const name of entries.sort()) {
      if (name.startsWith(".") || name === "node_modules") continue;
      const path = join(dir, name);
      const stat = optional(path, result.warnings, () => statSync(path));
      if (stat?.isDirectory()) walkSkills(path, false);
      else if (includeRootFiles && stat?.isFile() && name.endsWith(".md")) addSkill(path);
    }
  };
  const seenFiles = new Set<string>();
  const seenDirs = new Set<string>();
  const addFile = (path: string) => {
    const key = canonical(path);
    if (seenFiles.has(key)) return;
    const content = optional(path, result.warnings, () => readFileSync(path, "utf8"));
    if (content !== undefined) {
      seenFiles.add(key);
      result.files.push({ path, content });
    }
  };
  const walkRules = (dir: string) => {
    const key = canonical(dir);
    if (seenDirs.has(key)) return;
    seenDirs.add(key);
    const entries = optional(dir, result.warnings, () => readdirSync(dir));
    for (const name of (entries ?? []).sort()) {
      const path = join(dir, name);
      const stat = optional(path, result.warnings, () => statSync(path));
      if (stat?.isDirectory()) walkRules(path);
      else if (stat?.isFile() && name.endsWith(".md")) addFile(path);
    }
  };
  for (const dir of directories) {
    // Pi 1.5.2's directory loader has no cycle guard. Contribute files instead.
    walkSkills(join(dir, "skills"), true);
    addFile(join(dir, "CLAUDE.md"));
    walkRules(join(dir, "rules"));
  }
  return result;
}

export function buildGuidance(files: ContextFile[], loaded: ContextFile[]): string {
  const seen = new Set(loaded.map(file => canonical(file.path)));
  const instructions: string[] = [];
  const scoped: string[] = [];
  for (const file of files) {
    const key = canonical(file.path);
    if (seen.has(key)) continue;
    seen.add(key);
    const frontmatter = file.content.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    let conditional = false;
    if (frontmatter) {
      try {
        const parsed = parseFrontmatter(file.content).frontmatter;
        conditional = typeof parsed === "object" && parsed !== null && Object.hasOwn(parsed, "paths");
      } catch {
        // An invalid scope must never turn into unconditional instructions.
        conditional = true;
      }
    }
    if (frontmatter && conditional) {
      scoped.push(`- Rule file: ${JSON.stringify(file.path)}\n  Scope (YAML frontmatter):\n${frontmatter[1]}`);
    } else if (file.content.trim()) {
      instructions.push(`### ${JSON.stringify(file.path)}\n\n${file.content}`);
    }
  }
  if (!instructions.length && !scoped.length) return "";
  return [
    "# Claude instructions and rules",
    "Follow these user-provided instructions within their directory scope. More specific project instructions take precedence over global guidance when they conflict.",
    ...instructions,
    ...(scoped.length ? [
      "## Path-scoped rules",
      "Before working on files matching a rule's paths, use the read tool to load that rule file and follow it. Patterns are relative to the directory containing .claude. These rules do not apply to unrelated files.",
      ...scoped,
    ] : []),
  ].join("\n\n");
}

export default function claudeResources(pi: ExtensionAPI) {
  pi.on("resources_discover", (event, ctx) => {
    const resources = discoverResources(event.cwd, homedir(), ctx.isProjectTrusted());
    if (ctx.hasUI) for (const warning of resources.warnings) ctx.ui.notify(warning, "warning");
    return { skillPaths: resources.skillPaths };
  });
  pi.on("before_agent_start", (event, ctx) => {
    const resources = discoverResources(ctx.cwd, homedir(), ctx.isProjectTrusted());
    if (ctx.hasUI) for (const warning of resources.warnings) ctx.ui.notify(warning, "warning");
    const guidance = buildGuidance(resources.files, event.systemPromptOptions.contextFiles ?? []);
    if (guidance) event.systemPromptOptions.sections.claude_resources = guidance;
    else delete event.systemPromptOptions.sections.claude_resources;
  });
}
