#!/usr/bin/env node
'use strict';
// Mutation check: re-introduce each defect the rules exist to prevent, in a
// scratch copy of this package, and require the test suite to go red. The
// unmutated copy must be green first.
//
//   node test/mutate.js            all mutations
//   node test/mutate.js M1 M3      some
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');

const PKG = path.join(__dirname, '..');

const MUTATIONS = [
  {id: 'M1', what: 'counter carry: a moved line keeps counting instead of restarting',
    file: 'lib/rules.js', from: "return decision(atChannel(req, FIRST), 'line',", to: "return decision({...req, pre: bumpCounter(C.pre)}, 'line',",
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M2', what: 'no alpha.0 reset: a moved line restarts on the configured channel',
    file: 'lib/rules.js', from: "return decision(atChannel(req, FIRST), 'line',", to: "return decision(atChannel(req, channel), 'line',",
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M3', what: 'backwards group move: members ahead of the group line are ignored',
    file: 'lib/rules.js', from: 'if (!ahead.length) return', to: 'if (true) return',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M4', what: 'a linked release promotes the channel (alpha.N -> beta.0) instead of counter + 1',
    file: 'lib/rules.js', from: 'V = maxV(V, {...T, pre: bumpCounter(top.current.pre)});',
    to: 'V = maxV(V, {...T, pre: `${CHANNELS[Math.min(rank(channelOf(top.current.pre)), CHANNELS.length - 1)]}.0`});',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M5', what: 'maintenance branch accepts a feat',
    file: 'lib/rules.js', from: 'if (summary.breaking || summary.feat) {\n    return blocked(\'not-patch\'', to: 'if (summary.breaking) {\n    return blocked(\'not-patch\'',
    tests: ['test/rules.test.js', 'test/scenarios.test.js', 'test/runner.test.js']},
  {id: 'M6', what: 'stable branch promotes an alpha/beta',
    file: 'lib/rules.js', from: "if (channelOf(C.pre) !== 'rc') {", to: 'if (false) {',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M7', what: 'Release-As footers are honoured again',
    file: 'lib/install.js', from: "const kept = notes.filter(n => n.title !== 'RELEASE AS');", to: 'const kept = notes;',
    tests: ['test/scenarios.test.js']},
  {id: 'M8', what: 'no promotion PR on the stable branch without new commits',
    file: 'lib/install.js', from: "if (d.code !== 'promote') return pr;", to: 'return pr;',
    tests: ['test/scenarios.test.js', 'test/runner.test.js']},
  {id: 'M9', what: 'stable 0.x releases created as GitHub prereleases',
    file: 'lib/runner.js', from: 'prerelease: !!r.tag.version.preRelease}', to: 'prerelease: r.prerelease}',
    tests: ['test/runner.test.js']},
  {id: 'M10', what: 'superseded release PRs left open',
    file: 'lib/runner.js', from: "    await github.octokit.pulls.update(", to: "    if (false) await github.octokit.pulls.update(",
    tests: ['test/runner.test.js']},
  {id: 'M11', what: 'linked family links on every proposal (stock linked-versions)',
    file: 'lib/rules.js', from: "  if (!triggers.length) return {linked: false,", to: "  if (!M.some(m => m.proposed)) return {linked: false,",
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
];

function copy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-target-mut-'));
  for (const e of ['index.js', 'package.json', 'lib', 'test', 'bin']) fs.cpSync(path.join(PKG, e), path.join(dir, e), {recursive: true});
  fs.symlinkSync(path.join(PKG, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  return dir;
}

function suite(dir, tests) {
  const r = spawnSync(process.execPath, ['--test', ...tests], {cwd: dir, encoding: 'utf8'});
  const failed = (r.stdout.match(/^ℹ fail (\d+)/m) || [])[1];
  return {code: r.status, failed: failed === undefined ? '?' : failed};
}

const only = process.argv.slice(2);
const chosen = MUTATIONS.filter(m => !only.length || only.includes(m.id));
const base = copy();
try {
  const all = [...new Set(chosen.flatMap(m => m.tests))];
  const clean = suite(base, all);
  if (clean.code !== 0) {
    console.error(`unmutated suite is not green (${clean.failed} failing): fix that first`);
    process.exit(2);
  }
  let survived = 0;
  for (const m of chosen) {
    const dir = copy();
    try {
      const file = path.join(dir, m.file);
      const src = fs.readFileSync(file, 'utf8');
      if (!src.includes(m.from)) throw new Error(`${m.id}: mutation does not apply to ${m.file} (source changed?)`);
      fs.writeFileSync(file, src.replace(m.from, m.to));
      const r = suite(dir, m.tests);
      const killed = r.code !== 0;
      if (!killed) survived++;
      console.log(`${m.id} ${killed ? 'killed  ' : 'SURVIVED'} ${String(r.failed).padStart(2)} failing  ${m.what}`);
    } finally {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  }
  console.log(`${chosen.length - survived}/${chosen.length} mutations killed`);
  process.exitCode = survived ? 1 : 0;
} finally {
  fs.rmSync(base, {recursive: true, force: true});
}
