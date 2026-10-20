'use strict';
// bin/promote.js: the manual channel / open-line steps as config edits.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');

const BIN = path.join(__dirname, '..', 'bin', 'promote.js');
const CONFIG = '.github/release-please-config.json';
const MANIFEST = '.github/.release-please-manifest.json';

// kit's shape, written the way people write it (inline objects, 2 spaces).
const KIT_CONFIG = `{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "separate-pull-requests": true,
  "changelog-sections": [
    {"type": "feat", "section": "Features"},
    {"type": "fix", "section": "Bug Fixes"}
  ],
  "plugins": [
    {"type": "target-context"},
    {"type": "conditional-linked-versions", "groupName": "kit", "components": ["kit", "kit-php", "kit-py", "kit-rs", "kit-ts"]}
  ],
  "packages": {
    ".": {
      "release-type": "go",
      "component": "kit",
      "exclude-paths": ["extensions/mcp-tasks", "incubator", "sdk"],
      "prerelease": true,
      "prerelease-type": "alpha.0",
      "versioning": "target"
    },
    "extensions/mcp-tasks": {
      "release-type": "go",
      "component": "mcp-tasks",
      "prerelease": true,
      "prerelease-type": "alpha.0",
      "versioning": "target"
    },
    "incubator/qmochi": {
      "release-type": "go",
      "component": "qmochi",
      "prerelease": true,
      "prerelease-type": "alpha.0",
      "versioning": "target"
    },
    "sdk/experimental/php": {"release-type": "php", "component": "kit-php", "prerelease": true, "prerelease-type": "alpha.0", "versioning": "target"},
    "sdk/experimental/rs": {"release-type": "rust", "component": "kit-rs", "prerelease": true, "prerelease-type": "alpha.0", "versioning": "target"},
    "sdk/py": {"release-type": "python", "component": "kit-py", "prerelease": true, "prerelease-type": "alpha.0", "versioning": "target"},
    "sdk/ts": {"release-type": "node", "component": "kit-ts", "prerelease": true, "prerelease-type": "alpha.0", "versioning": "target"},
    "tools": {"release-type": "simple", "component": "tools", "versioning": "prerelease"}
  }
}
`;
const KIT_MANIFEST = {
  '.': '0.5.0-alpha.26', 'extensions/mcp-tasks': '0.1.0-alpha.1', 'incubator/qmochi': '0.2.0-alpha.1',
  'sdk/experimental/php': '0.5.0-alpha.2', 'sdk/experimental/rs': '0.5.0-alpha.2', 'sdk/py': '0.5.0-alpha.5', 'sdk/ts': '0.5.0-alpha.3', tools: '1.0.0',
};

function workspace(config = KIT_CONFIG, manifest = KIT_MANIFEST) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-target-promote-'));
  process.on('exit', () => fs.rmSync(dir, {recursive: true, force: true}));
  fs.mkdirSync(path.join(dir, '.github'));
  fs.writeFileSync(path.join(dir, CONFIG), config);
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(manifest, null, 2));
  const run = (...args) => {
    const r = spawnSync(process.execPath, [BIN, ...args], {cwd: dir, encoding: 'utf8'});
    return {code: r.status, out: r.stdout, err: r.stderr, config: fs.readFileSync(path.join(dir, CONFIG), 'utf8')};
  };
  const setManifest = m => fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(m, null, 2));
  return {dir, run, setManifest};
}

// Lines added / removed between two texts (multiset diff, order ignored).
function lineDiff(a, b) {
  const count = t => t.split('\n').reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
  const A = count(a), Bm = count(b);
  const added = [], removed = [];
  for (const [l, n] of Bm) for (let i = (A.get(l) || 0); i < n; i++) added.push(l.trim());
  for (const [l, n] of A) for (let i = (Bm.get(l) || 0); i < n; i++) removed.push(l.trim());
  return {added, removed};
}

test('the kit setup: kit and qmochi to beta by package, the rest stays alpha', () => {
  const w = workspace();
  const r = w.run('channel', 'beta', '--package', 'kit', '--package', 'qmochi');
  assert.equal(r.code, 0, r.err);
  const c = JSON.parse(r.config);
  assert.deepEqual(c.packages['.']['x-channel'], {line: '0.5.0', channel: 'beta'});
  assert.deepEqual(c.packages['incubator/qmochi']['x-channel'], {line: '0.2.0', channel: 'beta'});
  for (const p of ['extensions/mcp-tasks', 'sdk/experimental/php', 'sdk/experimental/rs', 'sdk/py', 'sdk/ts']) assert.equal(c.packages[p]['x-channel'], undefined, p);
  // formatting kept: only the two records are new lines (plus the commas they need)
  const d = lineDiff(KIT_CONFIG, r.config);
  assert.deepEqual(d.removed.sort(), ['"versioning": "target"', '"versioning": "target"'].sort());
  assert.deepEqual(d.added.sort(), ['"versioning": "target",', '"versioning": "target",', '"x-channel": {"line": "0.5.0", "channel": "beta"}', '"x-channel": {"line": "0.2.0", "channel": "beta"}'].sort());
  assert.match(r.out, /^kit \(\.\): x-channel \{"line": "0\.5\.0", "channel": "beta"\} \(0\.5\.0-alpha\.26 -> 0\.5\.0-beta\.0: its release PR is cut on the next run on the prerelease branch\)$/m);
});

test('by group: every member of the conditional-linked-versions group', () => {
  const w = workspace();
  const r = w.run('channel', 'beta', '--group', 'kit');
  assert.equal(r.code, 0, r.err);
  const c = JSON.parse(r.config);
  for (const p of ['.', 'sdk/experimental/php', 'sdk/experimental/rs', 'sdk/py', 'sdk/ts']) assert.deepEqual(c.packages[p]['x-channel'], {line: '0.5.0', channel: 'beta'}, p);
  assert.equal(c.packages['incubator/qmochi']['x-channel'], undefined);
  assert.equal(c.packages['extensions/mcp-tasks']['x-channel'], undefined);
});

test('by group: a member already on, or already promoted to, the channel is left as it is', () => {
  const w = workspace();
  assert.equal(w.run('channel', 'beta', '--package', 'kit').code, 0);
  const r = w.run('channel', 'beta', '--group', 'kit');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^kit \(\.\): unchanged, already promoted to beta for 0\.5\.0 \(its release PR is cut on the next run on the prerelease branch\)$/m);
  const c = JSON.parse(r.config);
  for (const p of ['.', 'sdk/experimental/php', 'sdk/experimental/rs', 'sdk/py', 'sdk/ts']) assert.deepEqual(c.packages[p]['x-channel'], {line: '0.5.0', channel: 'beta'}, p);
  assert.equal((r.out.match(/: x-channel /g) || []).length, 4, 'the four other members recorded');
  // released on beta: the same
  w.setManifest({...KIT_MANIFEST, '.': '0.5.0-beta.0', 'sdk/py': '0.5.0-beta.0'});
  const again = w.run('channel', 'beta', '--group', 'kit');
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /^kit \(\.\): unchanged, already on beta for 0\.5\.0$/m);
  assert.match(again.out, /^kit-py \(sdk\/py\): unchanged, already on beta for 0\.5\.0$/m);
  // every member there: nothing to change
  w.setManifest(Object.fromEntries(Object.entries(KIT_MANIFEST).map(([p, v]) => [p, v.replace(/-alpha\.\d+$/, '-beta.0')])));
  const none = w.run('channel', 'beta', '--group', 'kit');
  assert.equal(none.code, 0, none.err);
  assert.match(none.out, /nothing to change\n$/);
  // still all or nothing for a real refusal: kit-py backwards, kit pending beta -> rc skips
  w.setManifest({...KIT_MANIFEST, 'sdk/py': '0.5.0-rc.1'});
  const back = w.run('channel', 'beta', '--group', 'kit');
  assert.equal(back.code, 1);
  assert.match(back.err, /kit-py \(sdk\/py\): on rc for 0\.5\.0: channels never move backwards/);
  assert.equal(back.config, again.config, 'nothing written');
  w.setManifest(KIT_MANIFEST);
  const skip = w.run('channel', 'rc', '--group', 'kit');
  assert.equal(skip.code, 1);
  assert.match(skip.err, /kit \(\.\): alpha -> rc skips beta/);
  assert.equal(skip.config, again.config, 'nothing written');
  // named with --package, as well as through the group: refused as before
  const named = w.run('channel', 'beta', '--group', 'kit', '--package', 'kit');
  assert.equal(named.code, 1);
  assert.match(named.err, /^refused: kit \(\.\): already promoted to beta for 0\.5\.0/m);
});

test('one step at a time, never backwards, only open lines', () => {
  const w = workspace();
  assert.equal(w.run('channel', 'beta', '--package', 'kit').code, 0);
  const again = w.run('channel', 'beta', '--package', 'kit');
  assert.equal(again.code, 1);
  assert.match(again.err, /kit \(\.\): already promoted to beta for 0\.5\.0 \(its release PR is cut on the next run on the prerelease branch\)/);
  // rc while beta is recorded but not released: still a skip from alpha
  const early = w.run('channel', 'rc', '--package', 'kit');
  assert.equal(early.code, 1);
  assert.match(early.err, /kit \(\.\): alpha -> rc skips beta: channels move alpha -> beta -> rc \(the beta promotion is not released yet: merge its release PR first\)/);
  assert.deepEqual(JSON.parse(early.config).packages['.']['x-channel'], {line: '0.5.0', channel: 'beta'}, 'nothing written');
  // once beta.0 is released, rc is the next step
  w.setManifest({...KIT_MANIFEST, '.': '0.5.0-beta.0'});
  assert.equal(w.run('channel', 'beta', '--package', 'kit').err.trim(), 'refused: kit (.): already on beta for 0.5.0');
  const rc = w.run('channel', 'rc', '--package', 'kit');
  assert.equal(rc.code, 0, rc.err);
  assert.deepEqual(JSON.parse(rc.config).packages['.']['x-channel'], {line: '0.5.0', channel: 'rc'});
  w.setManifest(KIT_MANIFEST);
  const skip = w.run('channel', 'rc', '--package', 'kit-py');
  assert.equal(skip.code, 1);
  assert.match(skip.err, /kit-py \(sdk\/py\): alpha -> rc skips beta: channels move alpha -> beta -> rc/);
  w.setManifest({...KIT_MANIFEST, 'sdk/py': '0.5.0-rc.1', 'sdk/ts': '0.6.0', '.': '0.5.0-rc.0'});
  const back = w.run('channel', 'beta', '--package', 'kit-py');
  assert.match(back.err, /kit-py \(sdk\/py\): on rc for 0\.5\.0: channels never move backwards/);
  const stable = w.run('channel', 'beta', '--package', 'kit-ts');
  assert.match(stable.err, /kit-ts \(sdk\/ts\): at stable 0\.6\.0: no open line to promote/);
  assert.match(w.run('channel', 'alpha', '--package', 'kit-ts').err, /channel: expected beta \| rc/);
});

test('a promotion recorded for an old line counts for nothing', () => {
  const w = workspace();
  assert.equal(w.run('channel', 'beta', '--package', 'qmochi').code, 0);
  w.setManifest({...KIT_MANIFEST, 'incubator/qmochi': '0.3.0-alpha.0'});
  const r = w.run('channel', 'beta', '--package', 'qmochi');
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.config).packages['incubator/qmochi']['x-channel'], {line: '0.3.0', channel: 'beta'});
});

test('open-line by package and by group; refused once reached', () => {
  const w = workspace();
  const r = w.run('open-line', '1.0.0', '--group', 'kit');
  assert.equal(r.code, 0, r.err);
  const c = JSON.parse(r.config);
  for (const p of ['.', 'sdk/experimental/php', 'sdk/experimental/rs', 'sdk/py', 'sdk/ts']) assert.equal(c.packages[p]['x-open-line'], '1.0.0', p);
  assert.equal(c.packages['incubator/qmochi']['x-open-line'], undefined);
  w.setManifest({...KIT_MANIFEST, 'incubator/qmochi': '1.0.0-alpha.2'});
  const reached = w.run('open-line', '1.0.0', '--package', 'qmochi');
  assert.equal(reached.code, 1);
  assert.match(reached.err, /qmochi \(incubator\/qmochi\): at 1\.0\.0-alpha\.2: line 1\.0\.0 already reached/);
  assert.match(w.run('open-line', '1.0', '--package', 'kit').err, /x-open-line "1\.0": expected "x\.y\.z"/);
});

test('open-line by group: a member already on the line is left as it is, one with no release yet takes the group version', () => {
  // kit-rs already previews 0.6.1 (past the 0.6.0 the family links at):
  // the group opens 0.6.1 for the others
  const w = workspace(KIT_CONFIG, {...KIT_MANIFEST, 'sdk/experimental/rs': '0.6.1-alpha.0'});
  const r = w.run('open-line', '0.6.1', '--group', 'kit');
  assert.equal(r.code, 0, r.err);
  const c = JSON.parse(r.config);
  for (const p of ['.', 'sdk/experimental/php', 'sdk/py', 'sdk/ts']) assert.equal(c.packages[p]['x-open-line'], '0.6.1', p);
  assert.equal(c.packages['sdk/experimental/rs']['x-open-line'], undefined);
  assert.match(r.out, /^kit-rs \(sdk\/experimental\/rs\): unchanged, at 0\.6\.1-alpha\.0: line 0\.6\.1 already reached$/m);
  // named with --package it is refused, as before
  const named = w.run('open-line', '0.6.1', '--package', 'kit-rs');
  assert.equal(named.code, 1);
  assert.match(named.err, /^refused: kit-rs \(sdk\/experimental\/rs\): at 0\.6\.1-alpha\.0: line 0\.6\.1 already reached/m);
  // a member with no release yet (no manifest entry) takes the group version
  const {'sdk/experimental/rs': _, ...noRs} = KIT_MANIFEST;
  const fresh = workspace(KIT_CONFIG, noRs);
  const one = fresh.run('open-line', '1.0.0', '--group', 'kit');
  assert.equal(one.code, 0, one.err);
  assert.match(one.out, /^kit-rs \(sdk\/experimental\/rs\): unchanged, no release yet: it takes the group's version$/m);
  assert.equal(JSON.parse(one.config).packages['sdk/experimental/rs']['x-open-line'], undefined);
  assert.equal(JSON.parse(one.config).packages['sdk/py']['x-open-line'], '1.0.0');
  // ... named with --package, or for a channel, it is refused, as before
  assert.match(fresh.run('open-line', '1.0.0', '--package', 'kit-rs').err, /kit-rs \(sdk\/experimental\/rs\): no version in the manifest/);
  assert.match(fresh.run('channel', 'beta', '--group', 'kit').err, /kit-rs \(sdk\/experimental\/rs\): no version in the manifest/);
  // real refusals stay all or nothing: a member past the line, or stable at it
  for (const [v, why] of [['0.7.0-alpha.0', 'at 0\\.7\\.0-alpha\\.0, past line 0\\.6\\.1: lines never move backwards'], ['0.6.1', 'at stable 0\\.6\\.1: line 0\\.6\\.1 already released']]) {
    const b = workspace(KIT_CONFIG, {...KIT_MANIFEST, 'sdk/py': v});
    const res = b.run('open-line', '0.6.1', '--group', 'kit');
    assert.equal(res.code, 1, v);
    assert.match(res.err, new RegExp(`kit-py \\(sdk/py\\): ${why}`), v);
    assert.equal(res.config, KIT_CONFIG, `nothing written (${v})`);
  }
});

test('all or nothing, clear, dry run, usage', () => {
  const w = workspace();
  const mixed = w.run('channel', 'beta', '--package', 'kit', '--package', 'tools');
  assert.equal(mixed.code, 1);
  assert.match(mixed.err, /tools \(tools\): does not use versioning "target"/);
  assert.equal(mixed.config, KIT_CONFIG, 'nothing written');
  assert.match(w.run('channel', 'beta', '--package', 'nope').err, /no package or component "nope"/);
  assert.match(w.run('channel', 'beta', '--group', 'nope').err, /no conditional-linked-versions group "nope"/);
  const dry = w.run('channel', 'beta', '--package', 'kit', '--dry-run');
  assert.equal(dry.code, 0);
  assert.match(dry.out, /x-channel/);
  assert.equal(dry.config, KIT_CONFIG);
  w.run('channel', 'beta', '--package', 'kit');
  w.run('open-line', '1.0.0', '--package', 'kit');
  const cleared = w.run('clear', 'all', '--package', 'kit');
  assert.equal(cleared.code, 0, cleared.err);
  assert.equal(cleared.config, KIT_CONFIG, 'clear restores the file byte for byte');
  assert.equal(w.run('clear', 'all', '--package', 'kit').out, 'nothing to change\n');
  assert.equal(w.run('channel').code, 2);
  assert.equal(w.run('channel', 'beta').code, 1, 'no packages picked');
  assert.equal(w.run('bump', 'x', '--package', 'kit').code, 1);
});
