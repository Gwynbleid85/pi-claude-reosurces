import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import test from 'node:test';
import './fixtures/pi-host.mjs';

const modulePath = '../extensions/claude-resources/index.ts';
async function load() {
  assert.ok(existsSync(new URL(modulePath, import.meta.url)), 'Claude resource extension must exist');
  return import(modulePath);
}
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-claude-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const repo = join(home, 'projects', 'repo');
  const cwd = join(repo, 'src', 'nested');
  mkdirSync(cwd, { recursive: true });
  const put = (p, text = '') => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); return p; };
  put(join(repo, '.git'), 'gitdir: /elsewhere');
  return { root, home, repo, cwd, put };
}

test('discovers global and ancestor skills, bounded by worktree marker', async t => {
  const { discoverResources } = await load();
  const f = fixture(t);
  for (const dir of [f.home, join(f.home, 'projects'), f.repo, join(f.repo, 'src'), f.cwd]) {
    f.put(join(dir, '.claude/skills/example/SKILL.md'), 'skill');
  }
  assert.deepEqual(discoverResources(f.cwd, f.home, true).skillPaths, [
    join(f.home, '.claude/skills/example/SKILL.md'), join(f.repo, '.claude/skills/example/SKILL.md'),
    join(f.repo, 'src/.claude/skills/example/SKILL.md'), join(f.cwd, '.claude/skills/example/SKILL.md'),
  ]);
  assert.deepEqual(discoverResources(f.cwd, f.home, false).skillPaths, [join(f.home, '.claude/skills/example/SKILL.md')]);
});

test('supports git directories, missing resources, and home boundary outside repositories', async t => {
  const { discoverResources } = await load();
  const f = fixture(t);
  rmSync(join(f.repo, '.git')); mkdirSync(join(f.repo, '.git'));
  f.put(join(f.home, 'projects/.claude/rules/outside.md'), 'outside');
  assert.deepEqual(discoverResources(f.cwd, f.home, true), { skillPaths: [], files: [], warnings: [] });
  rmSync(join(f.repo, '.git'), { recursive: true });
  f.put(join(f.root, '.claude/rules/above-home.md'), 'above home');
  assert.deepEqual(discoverResources(f.cwd, f.home, true).files.map(x => x.content), ['outside']);
});

test('follows symlinks, deduplicates realpaths, and terminates directory cycles', async t => {
  const { discoverResources } = await load();
  const f = fixture(t);
  const rules = join(f.home, '.claude/rules');
  f.put(join(rules, 'a.md'), 'once');
  symlinkSync(rules, join(rules, 'loop'));
  symlinkSync(join(rules, 'a.md'), join(rules, 'alias.md'));
  mkdirSync(join(f.repo, '.claude'), { recursive: true });
  symlinkSync(rules, join(f.repo, '.claude/rules'));
  const skills = join(f.root, 'shared-skills');
  f.put(join(skills, 'example/SKILL.md'), 'skill');
  symlinkSync(skills, join(f.home, '.claude/skills'));
  symlinkSync(skills, join(f.repo, '.claude/skills'));
  assert.deepEqual(discoverResources(f.cwd, f.home, true).files.map(x => x.content), ['once']);
  assert.deepEqual(discoverResources(f.cwd, f.home, true).skillPaths, [join(f.home, '.claude/skills/example/SKILL.md')]);
  assert.equal(discoverResources(f.cwd, f.home, true).warnings.length, 0);
});


test('Pi runtime loads cyclic skill collections within a bounded subprocess', t => {
  const f = fixture(t);
  const root = join(f.cwd, '.claude/skills');
  f.put(join(root, 'example/SKILL.md'), '---\nname: example\ndescription: Example skill\n---\nInstructions');
  symlinkSync(root, join(root, 'loop-a'));
  symlinkSync(root, join(root, 'loop-b'));
  const script = `
    import assert from 'node:assert/strict';
    import {piBase} from ${JSON.stringify(new URL('./fixtures/pi-host.mjs', import.meta.url).href)};
    const {discoverResources} = await import(${JSON.stringify(new URL(modulePath, import.meta.url).href)});
    const {loadSkills} = await import(new URL('core/skills.js', piBase));
    const paths = discoverResources(${JSON.stringify(f.cwd)}, ${JSON.stringify(f.home)}, true).skillPaths;
    const result = loadSkills({cwd: ${JSON.stringify(f.cwd)}, agentDir: ${JSON.stringify(f.home)}, skillPaths: paths, includeDefaults: false});
    assert.deepEqual(result.skills.map(x => x.name), ['example']);
    assert.deepEqual(result.diagnostics, []);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { timeout: 4000, killSignal: 'SIGKILL', encoding: 'utf8' });
  assert.equal(result.error, undefined, 'Cyclic collections must not hang downstream Pi traversal');
  assert.equal(result.status, 0, result.stderr);
});
