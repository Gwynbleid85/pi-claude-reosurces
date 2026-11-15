import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import './fixtures/pi-host.mjs';
const api = await import('../extensions/claude-resources/index.ts');
const extension = api.default;

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-claude-prompt-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home'), cwd = join(home, 'repo');
  mkdirSync(cwd, { recursive: true });
  const put = (p, text) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); return p; };
  put(join(cwd, '.git'), 'gitdir: elsewhere');
  return { home, cwd, put };
}

test('includes unconditional instructions but only advertises scoped rule paths and conditions', t => {
  const f = fixture(t);
  const global = f.put(join(f.home, '.claude/CLAUDE.md'), 'global instructions');
  const local = f.put(join(f.cwd, '.claude/CLAUDE.md'), 'local instructions');
  f.put(join(f.cwd, '.claude/rules/base.md'), 'unconditional rule');
  const scoped = f.put(join(f.cwd, '.claude/rules/frontend.md'), '---\npaths:\n  - "src/**/*.tsx"\n---\nSCOPED BODY MUST NOT BE GLOBAL');
  const inline = f.put(join(f.cwd, '.claude/rules/tests.md'), '---\npaths: ["**/*.test.ts", "**/*.spec.ts"]\n---\nTEST BODY MUST NOT BE GLOBAL');
  assert.equal(typeof api.buildGuidance, 'function', 'Prompt builder must exist');
  const text = api.buildGuidance(api.discoverResources(f.cwd, f.home, true).files, []);
  for (const value of [global, local, 'global instructions', 'local instructions', 'unconditional rule', scoped, inline, 'src/**/*.tsx', '**/*.spec.ts']) assert.ok(text.includes(value), value);
  assert.ok(!text.includes('SCOPED BODY MUST NOT BE GLOBAL'));
  assert.ok(!text.includes('TEST BODY MUST NOT BE GLOBAL'));
  assert.ok(text.indexOf('global instructions') < text.indexOf('local instructions'));
});

test('valid non-column-zero YAML scopes never inject rule bodies unconditionally', () => {
  for (const yaml of ['  paths: ["src/**"]', '{paths: ["src/**"]}', '"pa\\x74hs": ["src/**"]']) {
    const text = api.buildGuidance([{ path: '/scoped.md', content: `---\n${yaml}\n---\nSCOPED SECRET BODY` }], []);
    assert.ok(!text.includes('SCOPED SECRET BODY'), yaml);
    assert.ok(text.includes('/scoped.md'));
  }
});

test('malformed YAML frontmatter is advertised rather than applied unconditionally', () => {
  const text = api.buildGuidance([{ path: '/invalid.md', content: '---\npaths: [\n---\nPOTENTIALLY SCOPED BODY' }], []);
  assert.ok(!text.includes('POTENTIALLY SCOPED BODY'));
  assert.ok(text.includes('/invalid.md'));
});

test('deduplicates against Pi context files through realpath aliases', t => {
  const f = fixture(t);
  const original = f.put(join(f.home, '.claude/CLAUDE.md'), 'already loaded');
  const alias = join(f.home, 'AGENTS.md'); symlinkSync(original, alias);
  assert.equal(typeof api.buildGuidance, 'function', 'Prompt builder must exist');
  assert.equal(api.buildGuidance(api.discoverResources(f.cwd, f.home, true).files, [{ path: alias, content: 'already loaded' }]), '');
});

test('hooks refresh rules per run, preserve other sections, and honor project trust', async t => {
  const f = fixture(t);
  const file = f.put(join(f.cwd, '.claude/rules/live.md'), 'first version');
  f.put(join(f.cwd, '.claude/skills/example/SKILL.md'), 'skill');
  const handlers = new Map(); extension({ on: (name, fn) => handlers.set(name, fn) });
  assert.ok(handlers.has('before_agent_start'), 'Must register prompt hook');
  const ctx = { cwd: f.cwd, hasUI: false, isProjectTrusted: () => true };
  const event = { systemPrompt: 'unchanged', systemPromptOptions: { sections: { other: 'keep' }, contextFiles: [] } };
  const run = handlers.get('before_agent_start');
  assert.equal(await run(event, ctx), undefined);
  assert.ok(event.systemPromptOptions.sections.claude_resources.includes('first version'));
  writeFileSync(file, 'second version'); await run(event, ctx);
  assert.ok(event.systemPromptOptions.sections.claude_resources.includes('second version'));
  assert.ok(!event.systemPromptOptions.sections.claude_resources.includes('first version'));
  await run(event, { ...ctx, isProjectTrusted: () => false });
  assert.ok(!(event.systemPromptOptions.sections.claude_resources ?? '').includes('second version'));
  assert.equal(event.systemPromptOptions.sections.other, 'keep');
  const trusted = await handlers.get('resources_discover')({ cwd: f.cwd }, ctx);
  const untrusted = await handlers.get('resources_discover')({ cwd: f.cwd }, { ...ctx, isProjectTrusted: () => false });
  assert.ok(trusted.skillPaths.includes(join(f.cwd, '.claude/skills/example/SKILL.md')));
  assert.ok(!untrusted.skillPaths.includes(join(f.cwd, '.claude/skills/example/SKILL.md')));
  await run(event, { ...ctx, cwd: f.home });
  assert.ok(!(event.systemPromptOptions.sections.claude_resources ?? '').includes('second version'));
});

test('reports unexpected filesystem errors without breaking startup', async t => {
  const f = fixture(t);
  mkdirSync(join(f.cwd, '.claude/CLAUDE.md'), { recursive: true });
  const resources = api.discoverResources(f.cwd, f.home, true);
  assert.equal(resources.warnings.length, 1);
  assert.match(resources.warnings[0], /CLAUDE.md/);
  const warnings = [], handlers = new Map(); extension({ on: (name, fn) => handlers.set(name, fn) });
  await handlers.get('resources_discover')({ cwd: f.cwd }, { isProjectTrusted: () => true, hasUI: true, ui: { notify: (text, level) => warnings.push([text, level]) } });
  assert.ok(warnings.some(([text, level]) => text.includes(f.cwd) && level === 'warning'));
});
