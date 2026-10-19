'use strict';
// The action-equivalent runner against a fake GitHub (reads from local git,
// writes recorded): outputs, the prerelease flag, superseded PR closing,
// blocked packages failing the run, config refused before any write.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {run, parseInputs} = require('../lib/runner');
const {load} = require('../lib/internals');
const {createGitHub} = require('./helpers/git-github');
const {config, repo, nextRepo, FAMILY, MAIN0, CONFIG, MANIFEST} = require('./helpers/fixture');
const {RP} = require('./helpers/sim');

function quiet() {
  const lines = [];
  const push = m => lines.push(String(m));
  return {lines, logger: {error: push, warn: push, info: push, debug() {}, trace() {}}};
}

function tmpFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-target-out-'));
  process.on('exit', () => fs.rmSync(dir, {recursive: true, force: true}));
  const f = path.join(dir, name);
  fs.writeFileSync(f, '');
  return f;
}

// Parse a GITHUB_OUTPUT file the way the runner reads it.
function readOutputs(file) {
  const out = {};
  const lines = fs.readFileSync(file, 'utf8').split(os.EOL);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(.+?)<<(ghadelimiter_[0-9a-f-]+)$/);
    if (!m) continue;
    const body = [];
    while (lines[++i] !== m[2]) body.push(lines[i]);
    out[m[1]] = body.join(os.EOL);
  }
  return out;
}

async function runner(r, branch, {cfg = config(), prs = [], env = {}} = {}) {
  const github = await createGitHub({rpRoot: RP, dir: r.dir, branch, config: cfg, prs});
  const output = tmpFile('output');
  const {lines, logger} = quiet();
  const res = await run({
    env: {TOKEN: 'test-token', GITHUB_REPOSITORY: 'hop-top/sim', TARGET_BRANCH: branch, CONFIG_FILE: CONFIG, MANIFEST_FILE: MANIFEST, GITHUB_OUTPUT: output, ...env},
    rpRoot: RP, github, logger,
  });
  return {...res, github, fake: github.fake, file: readOutputs(output), lines};
}

const pending = ['status:release-pending'];

// main after next promoted qmochi to 0.6.0-rc.2, with the release PR merged.
async function mergedPromotion() {
  const r = repo();
  r.commit('chore: initial').release(MAIN0);
  r.checkout('-b', 'next').commit('feat(qmochi): y', ['qmochi']).release({qmochi: '0.6.0-rc.2'});
  r.checkout('main');
  r.git('merge', '-q', '--no-ff', 'next', '-m', "Merge branch 'next'");
  const first = await runner(r, 'main');
  const [pr] = first.fake.prs;
  pr.state = 'MERGED';
  pr.sha = r.head();
  return {r, prs: first.fake.prs, first};
}

test('outputs: release PRs (action names and shapes)', async () => {
  const r = nextRepo().commit('feat(cli): a', ['kit']).commit('fix(py): b', ['kit-py']);
  const res = await runner(r, 'next');
  assert.equal(res.exitCode, 0, res.lines.join('\n'));
  assert.deepEqual(res.fake.prs.map(p => p.title).sort(), ['chore(release): kit 0.5.0-alpha.27', 'chore(release): kit-py 0.5.0-alpha.6']);
  for (const pr of res.fake.prs) assert.deepEqual(pr.labels, pending, 'labels from the config, not the CLI defaults');
  assert.equal(res.file.releases_created, 'false');
  assert.equal(res.file.paths_released, '[]');
  assert.equal(res.file.prs_created, 'true');
  const pr = JSON.parse(res.file.pr);
  assert.equal(pr.number, res.fake.prs[0].number);
  assert.equal(pr.baseBranchName, 'next');
  assert.equal(JSON.parse(res.file.prs).length, 2);
  assert.deepEqual(res.outputs, res.file);
});

test('outputs: releases, and rule 6: a stable 0.x release is not a GitHub prerelease', async () => {
  const {r, prs, first} = await mergedPromotion();
  assert.deepEqual(first.fake.prs.map(p => p.title), ['chore(release): qmochi 0.6.0']);
  const res = await runner(r, 'main', {prs});
  assert.equal(res.exitCode, 0, res.lines.join('\n'));
  assert.deepEqual(res.fake.releases.map(x => [x.tagName, x.prerelease]), [['qmochi/v0.6.0', false]]);
  assert.equal(res.file.releases_created, 'true');
  assert.equal(res.file.paths_released, '["incubator/qmochi"]');
  const k = s => res.file[`incubator/qmochi--${s}`];
  assert.equal(k('release_created'), 'true');
  assert.equal(k('tag_name'), 'qmochi/v0.6.0');
  assert.equal(k('version'), '0.6.0');
  assert.equal(k('major'), '0');
  assert.equal(k('minor'), '6');
  assert.equal(k('patch'), '0');
  assert.equal(k('prNumber'), String(prs[0].number));
  assert.equal(k('path'), 'incubator/qmochi');
  assert.equal(k('draft'), 'false');
  assert.equal(k('html_url'), 'https://github.com/hop-top/sim/releases/tag/qmochi/v0.6.0');
  for (const key of ['id', 'name', 'upload_url', 'body', 'sha']) assert.notEqual(k(key), undefined, key);
  for (const key of ['tagName', 'uploadUrl', 'notes', 'url']) assert.equal(k(key), undefined, `${key} is renamed`);
  assert.deepEqual(res.fake.labelOps.filter(o => o.number === prs[0].number).map(o => o.add || o.remove),
    [['status:release-pending'], ['status:release-tagged']]);
  // stock release-please would have flagged it a prerelease
  const stockCfg = config({versioning: 'prerelease'});
  const stock = await createGitHub({rpRoot: RP, dir: r.dir, branch: 'main', config: stockCfg, prs: prs.map(p => ({...p}))});
  const rp = require(RP);
  const m = await rp.Manifest.fromManifest(stock, 'main', CONFIG, MANIFEST);
  assert.deepEqual((await m.buildReleases()).map(x => x.prerelease), [true]);
});

test('rule 6: prerelease versions stay GitHub prereleases', async () => {
  const r = nextRepo({kit: '0.5.1-alpha.3'}, {kit: '0.5.0'}).commit('feat(cli)!: new line', ['kit']);
  const first = await runner(r, 'next');
  assert.deepEqual(first.fake.prs.map(p => p.title), ['chore(next): release kit libraries']);
  first.fake.prs[0].state = 'MERGED';
  first.fake.prs[0].sha = r.head();
  const res = await runner(r, 'next', {prs: first.fake.prs});
  assert.deepEqual(res.fake.releases.map(x => [x.tagName, x.prerelease]).sort(), FAMILY.map(c => [`${c}/v0.6.0-alpha.0`, true]).sort());
  assert.equal(JSON.parse(res.file.paths_released).length, FAMILY.length);
});

test('skip-github-release / skip-github-pull-request', async () => {
  const {r, prs} = await mergedPromotion();
  const noRel = await runner(r, 'main', {prs, env: {SKIP_GITHUB_RELEASE: 'true'}});
  assert.deepEqual(noRel.fake.releases, []);
  assert.equal(noRel.file.releases_created, undefined);
  const noPr = await runner(nextRepo().commit('fix(qmochi): x', ['qmochi']), 'next', {env: {SKIP_GITHUB_PULL_REQUEST: 'true'}});
  assert.deepEqual(noPr.fake.prs, []);
  assert.equal(noPr.file.prs_created, undefined);
  assert.equal(noPr.file.releases_created, 'false');
});

test('fork and changelog-host reach release-please', async () => {
  const r = nextRepo().commit('fix(qmochi): x', ['qmochi']);
  const res = await runner(r, 'next', {env: {FORK: 'true', CHANGELOG_HOST: 'https://git.example.com'}});
  assert.equal(res.fake.prs.length, 1);
  assert.equal(res.fake.prs[0].fork, true);
  assert.match(res.fake.prs[0].body, /https:\/\/git\.example\.com\/hop-top\/sim\/compare\//);
  const plain = await runner(nextRepo().commit('fix(qmochi): x', ['qmochi']), 'next');
  assert.equal(plain.fake.prs[0].fork, false);
  assert.match(plain.fake.prs[0].body, /https:\/\/github\.com\/hop-top\/sim\/compare\//);
});

test('rule 3: a feat on a maintenance branch fails the run after every package is processed', async () => {
  const r = repo().commit('chore: initial').release({...MAIN0, qmochi: '0.5.3', kit: '0.5.3'});
  r.checkout('-b', 'release/0.5').commit('feat(qmochi): not allowed', ['qmochi']).commit('fix(cli): fine', ['kit']);
  const res = await runner(r, 'release/0.5');
  assert.equal(res.exitCode, 1);
  assert.deepEqual(res.fake.prs.map(p => p.title), ['chore(release): kit 0.5.4']);
  assert.deepEqual(res.blocked.map(b => b.component), ['qmochi']);
  assert.ok(res.lines.some(l => /^::error::qmochi: feat on maintenance branch release\/0\.5: patch only$/.test(l)), res.lines.join('\n'));
  assert.equal(res.file.prs_created, 'true');
});

test('rule 7: per-package PRs superseded by the group PR are closed with a link', async () => {
  const r = nextRepo({kit: '0.5.1-alpha.3'}, {kit: '0.5.0'}).commit('fix(cli): a', ['kit']).commit('fix(ts): b', ['kit-ts']).commit('fix(qmochi): c', ['qmochi']);
  const first = await runner(r, 'next');
  assert.deepEqual(first.fake.prs.map(p => p.title).sort(),
    ['chore(release): kit 0.5.1-alpha.4', 'chore(release): kit-ts 0.5.0-alpha.4', 'chore(release): qmochi 0.2.0-alpha.2']);
  r.commit('feat(cli)!: new line', ['kit']);
  const res = await runner(r, 'next', {prs: first.fake.prs});
  assert.equal(res.exitCode, 0, res.lines.join('\n'));
  const group = res.fake.prs.find(p => p.title === 'chore(next): release kit libraries');
  assert.ok(group);
  const byTitle = t => first.fake.prs.find(p => p.title === t).number;
  const kit = byTitle('chore(release): kit 0.5.1-alpha.4'), ts = byTitle('chore(release): kit-ts 0.5.0-alpha.4');
  assert.deepEqual(res.fake.closed.sort(), [kit, ts].sort());
  for (const n of [kit, ts]) {
    const c = res.fake.comments.find(x => x.number === n);
    assert.match(c.comment, new RegExp(`^Superseded by #${group.number}\\.`));
  }
  assert.equal(res.fake.prs.find(p => p.number === byTitle('chore(release): qmochi 0.2.0-alpha.2')).state, 'OPEN');
  assert.deepEqual(res.closed.map(c => c.number).sort(), [kit, ts].sort());
});

test('rule 7: a stale proposal for a blocked package is closed with the reason', async () => {
  const r = repo().commit('chore: initial').release({...MAIN0, qmochi: '0.5.3'});
  r.checkout('-b', 'release/0.5').commit('fix(qmochi): backport', ['qmochi']);
  const first = await runner(r, 'release/0.5');
  assert.deepEqual(first.fake.prs.map(p => p.title), ['chore(release): qmochi 0.5.4']);
  r.commit('feat(qmochi): not allowed', ['qmochi']);
  const res = await runner(r, 'release/0.5', {prs: first.fake.prs});
  assert.equal(res.exitCode, 1);
  assert.deepEqual(res.fake.closed, [first.fake.prs[0].number]);
  assert.match(res.fake.comments[0].comment, /^Closed: no release is proposed for qmochi:\n\n- feat on maintenance branch release\/0\.5: patch only/);
});

test('rule 7: an unproposed PR with no replacement and no block is left open', async () => {
  const r = nextRepo().commit('fix(qmochi): c', ['qmochi']);
  const first = await runner(r, 'next');
  const php = {number: 7, headBranchName: 'release-please--branches--next--components--kit-php', baseBranchName: 'next',
    title: 'chore(release): kit-php 0.5.0-alpha.3', body: first.fake.prs[0].body, labels: pending, state: 'OPEN'};
  const res = await runner(r, 'next', {prs: [...first.fake.prs, php]});
  assert.deepEqual(res.fake.closed, []);
  assert.ok(res.lines.some(l => /#7 .*left open/.test(l)), res.lines.join('\n'));
});

test('rule 7: a PR opened by hand with the release label stays open', async () => {
  const r = nextRepo().commit('fix(qmochi): c', ['qmochi']);
  const first = await runner(r, 'next');
  // someone wrote release notes for qmochi and kit on their own branch,
  // with the release label: its body names the components the qmochi
  // release PR now carries (a release-please branch would be superseded)
  const {PullRequestBody, Version} = load(RP);
  const body = new PullRequestBody([
    {component: 'qmochi', version: Version.parse('0.2.0-alpha.2'), notes: 'x'},
    {component: 'kit', version: Version.parse('0.5.0-alpha.27'), notes: 'y'},
  ]).toString();
  const human = {number: 9, headBranchName: 'feature/manual-release', baseBranchName: 'next',
    title: 'chore(release): qmochi and kit notes', body, labels: pending, state: 'OPEN'};
  const res = await runner(r, 'next', {prs: [...first.fake.prs, human]});
  assert.equal(res.exitCode, 0, res.lines.join('\n'));
  assert.deepEqual(res.fake.closed, []);
  assert.deepEqual(res.fake.comments, []);
  assert.equal(res.fake.prs.find(p => p.number === 9).state, 'OPEN');
});

test('rule 7: a root package without a component: its stale PR is closed with the reason', async () => {
  const r = repo().commit('chore: initial');
  r.manifest({kit: '0.5.3'});
  r.commit('chore(release): 0.5.3').git('tag', 'v0.5.3');
  r.checkout('-b', 'release/0.5').commit('fix: backport', ['kit']);
  const cfg = {label: 'status:release-pending', 'release-label': 'status:release-tagged', plugins: [{type: 'target-context'}],
    packages: {'.': {'release-type': 'simple', versioning: 'target', 'bump-minor-pre-major': true}}};
  const first = await runner(r, 'release/0.5', {cfg});
  assert.equal(first.exitCode, 0, first.lines.join('\n'));
  assert.deepEqual(first.fake.prs.map(p => [p.title, p.headBranchName]), [['chore(release/0.5): release 0.5.4', 'release-please--branches--release/0.5']]);
  r.commit('feat: not allowed', ['kit']);
  const res = await runner(r, 'release/0.5', {cfg, prs: first.fake.prs});
  assert.equal(res.exitCode, 1);
  assert.deepEqual(res.blocked.map(b => [b.component, b.name]), [['', '.']]);
  assert.ok(res.lines.includes('::error::.: feat on maintenance branch release/0.5: patch only'), res.lines.join('\n'));
  assert.deepEqual(res.fake.closed, [first.fake.prs[0].number]);
  assert.match(res.fake.comments[0].comment, /^Closed: no release is proposed for \.:\n\n- feat on maintenance branch release\/0\.5: patch only/);
});

test('rule 2: a package skipped on main is a notice, and its stale release PR is closed', async () => {
  const r = repo();
  r.commit('chore: initial').release(MAIN0);
  r.checkout('-b', 'next').commit('feat(qmochi): y', ['qmochi']).release({qmochi: '0.6.0-beta.1'});
  r.checkout('main');
  r.git('merge', '-q', '--no-ff', 'next', '-m', "Merge branch 'next'");
  r.commit('fix(qmochi): z', ['qmochi']);
  // a standing proposal from before the switch to target versioning
  const stock = await runner(r, 'main', {cfg: config({versioning: 'prerelease'})});
  assert.deepEqual(stock.fake.prs.map(p => p.title), ['chore(release): qmochi 0.6.0-beta.2']);
  const summaryFile = tmpFile('summary');
  const res = await runner(r, 'main', {prs: stock.fake.prs, env: {GITHUB_STEP_SUMMARY: summaryFile}});
  assert.equal(res.exitCode, 0, res.lines.join('\n'));
  assert.deepEqual(res.blocked, []);
  assert.deepEqual(res.skipped.map(x => x.component), ['qmochi']);
  assert.ok(res.lines.some(l => /^::notice::qmochi: 0\.6\.0-beta\.1 is not an rc: skipped/.test(l)), res.lines.join('\n'));
  assert.ok(!res.lines.some(l => l.startsWith('::error::')), res.lines.join('\n'));
  assert.deepEqual(res.fake.closed, [stock.fake.prs[0].number]);
  assert.match(res.fake.comments[0].comment, /^Closed: no release is proposed for qmochi:\n\n- 0\.6\.0-beta\.1 is not an rc: skipped/);
  assert.match(fs.readFileSync(summaryFile, 'utf8'), /^- skipped qmochi: 0\.6\.0-beta\.1 is not an rc: skipped/m);
});

test('rule 7 (owner): the kit round: a promotion is cut on the next run, with no other change', async () => {
  const r = nextRepo();
  fs.writeFileSync(path.join(r.dir, CONFIG), '{"edited": true}\n');
  r.commit('chore(release): promote kit, qmochi to beta');
  const cfg = config({records: {kit: {'x-channel': {line: '0.5.0', channel: 'beta'}}, qmochi: {'x-channel': {line: '0.2.0', channel: 'beta'}}}});
  const res = await runner(r, 'next', {cfg});
  assert.equal(res.exitCode, 0, res.lines.join('\n'));
  assert.deepEqual(res.fake.prs.map(p => p.title).sort(), ['chore(release): kit 0.5.0-beta.0', 'chore(release): qmochi 0.2.0-beta.0']);
  for (const pr of res.fake.prs) assert.equal(pr.contents[CONFIG], undefined, 'the records stay: the line is unchanged');
});

test('records: refused against the manifest on the prerelease branch, inert elsewhere', async () => {
  const r = nextRepo({qmochi: '0.5.1-alpha.3'}, {qmochi: '0.5.0'}).commit('feat(qmochi): x', ['qmochi']);
  const cases = [
    // a line the package never reached (single and linked: the same refusal)
    [{qmochi: {'x-channel': {line: '0.6.0', channel: 'beta'}}}, /package incubator\/qmochi x-channel is for line 0\.6\.0, but its current target is 0\.5\.1 \(manifest 0\.5\.1-alpha\.3\)/],
    [{'kit-ts': {'x-channel': {line: '0.6.0', channel: 'beta'}}}, /package sdk\/ts x-channel is for line 0\.6\.0, but its current target is 0\.5\.0 \(manifest 0\.5\.0-alpha\.3\)/],
    [{kit: {'x-channel': {line: '0.5.0', channel: 'rc'}}}, /package \. x-channel rc skips a channel from 0\.5\.0-alpha\.26: channels move alpha -> beta -> rc/],
    [{'kit-py': {'x-open-line': '0.5.0'}}, /package sdk\/py x-open-line 0\.5\.0 is already reached \(manifest 0\.5\.0-alpha\.5\)/],
  ];
  for (const [records, msg] of cases) {
    const res = await runner(r, 'next', {cfg: config({records})});
    assert.equal(res.exitCode, 1, JSON.stringify(records));
    assert.ok(res.lines.some(l => msg.test(l)), `${msg}\n${res.lines.join('\n')}`);
    assert.deepEqual(res.fake.prs, []);
  }
  // main carries next's config as merged: the same records do not stop it
  const {r: m, prs} = await mergedPromotion();
  m.commit('fix(kit): z', ['kit']);
  const onMain = await runner(m, 'main', {prs, cfg: config({records: {qmochi: {'x-channel': {line: '0.6.0', channel: 'rc'}}, kit: {'x-open-line': '0.1.0'}}})});
  assert.equal(onMain.exitCode, 0, onMain.lines.join('\n'));
  assert.ok(onMain.fake.prs.some(p => p.state === 'OPEN' && p.title === 'chore(release): kit 0.4.1'), onMain.fake.prs.map(p => p.title).join(', '));
  assert.deepEqual(onMain.fake.releases.map(x => x.tagName), ['qmochi/v0.6.0']);
  // the shape is still checked everywhere
  const bad = await runner(m, 'main', {prs, cfg: config({records: {kit: {'x-open-line': '1.0'}}})});
  assert.equal(bad.exitCode, 1);
});

test('a config refusal stops the pull requests, not the releases of merged ones', async () => {
  const {r, prs} = await mergedPromotion();
  r.commit('fix(kit): z', ['kit']);
  const res = await runner(r, 'main', {prs, cfg: config({packages: {'incubator/qmochi': {'release-as': '0.9.0'}}})});
  assert.equal(res.exitCode, 1);
  assert.deepEqual(res.fake.releases.map(x => x.tagName), ['qmochi/v0.6.0']);
  assert.equal(res.file.releases_created, 'true');
  assert.equal(res.fake.prs.length, prs.length, 'no new pull request');
  assert.ok(res.lines.some(l => /^::error::.*package incubator\/qmochi sets release-as/.test(l)), res.lines.join('\n'));
  assert.ok(res.lines.some(l => /^::error::no release pull request proposed/.test(l)), res.lines.join('\n'));
});

test('rule 7: nothing is closed while a merged release PR is still untagged', async () => {
  const r = nextRepo().commit('fix(qmochi): c', ['qmochi']);
  const first = await runner(r, 'next');
  const qmochiBody = first.fake.prs[0].body;
  const {PullRequestBody, Version} = load(RP);
  const groupBody = new PullRequestBody([
    {component: 'qmochi', version: Version.parse('0.2.0-alpha.2'), notes: 'x'},
    {component: 'kit', version: Version.parse('0.5.0-alpha.27'), notes: 'y'},
  ]).toString();
  const stale = () => ({number: 7, headBranchName: 'release-please--branches--next--groups--kit', baseBranchName: 'next',
    title: 'chore(next): release kit libraries', body: groupBody, labels: pending, state: 'OPEN'});
  const merged = {number: 8, headBranchName: 'release-please--branches--next--components--kit-ts', baseBranchName: 'next',
    title: 'chore(release): kit-ts 0.5.0-alpha.9', body: qmochiBody, labels: pending, state: 'MERGED', sha: r.head()};
  // control: the stale group PR is superseded by the open qmochi PR
  const control = await runner(r, 'next', {prs: [...first.fake.prs.map(p => ({...p})), stale()], env: {SKIP_GITHUB_RELEASE: 'true'}});
  assert.deepEqual(control.fake.closed, [7]);
  assert.match(control.fake.comments[0].comment, new RegExp(`^Superseded by #${first.fake.prs[0].number}\\.`));
  // with a merged, untagged release PR outstanding: nothing is closed
  const res = await runner(r, 'next', {prs: [...first.fake.prs.map(p => ({...p})), stale(), merged], env: {SKIP_GITHUB_RELEASE: 'true'}});
  assert.deepEqual(res.fake.closed, []);
  assert.ok(res.lines.some(l => /merged, untagged release PRs outstanding/.test(l)), res.lines.join('\n'));
});

test('config the extension cannot honour is refused before any write', async () => {
  const r = nextRepo().commit('fix(qmochi): c', ['qmochi']);
  const cases = [
    [config({packages: {'incubator/qmochi': {'release-as': '0.9.0'}}}), /package incubator\/qmochi sets release-as/],
    [{...config(), plugins: []}, /plugins has no "target-context"/],
    [{...config(), plugins: [config().plugins[1], config().plugins[0]]}, /"target-context" must be listed before "conditional-linked-versions"/],
    [{...config(), plugins: [{type: 'target-context'}, {type: 'linked-versions', groupName: 'kit', components: FAMILY}]}, /kit is in a "linked-versions" group/],
    [config({packages: {'sdk/py': {'prerelease-type': 'beta.0'}}}), /package sdk\/py prerelease-type 'beta.0': every line starts on alpha\.0; promote a line with x-channel/],
    [config({packages: {'sdk/py': {'prerelease-type': 'alpha'}}}), /package sdk\/py prerelease-type 'alpha': every line starts on alpha\.0/],
    [config({records: {kit: {'x-channel': {line: '0.5.0', channel: 'gamma'}}}}), /package \.: x-channel .*expected/],
    [config({records: {kit: {'x-open-line': '1.0'}}}), /package \.: x-open-line "1\.0": expected/],
    [config({packages: {'sdk/py': {versioning: 'prerelease', 'x-channel': {line: '0.5.0', channel: 'beta'}}}}), /package sdk\/py has x-channel but does not use versioning "target"/],
  ];
  for (const [cfg, msg] of cases) {
    const res = await runner(r, 'next', {cfg});
    assert.equal(res.exitCode, 1);
    assert.ok(res.lines.some(l => msg.test(l)), `${msg}\n${res.lines.join('\n')}`);
    assert.deepEqual(res.fake.prs, []);
    assert.deepEqual(res.fake.releases, []);
  }
});

test('a release PR drops the records its version makes stale, and nothing else', async () => {
  const r = nextRepo({qmochi: '0.6.1-beta.2', kit: '0.5.0-beta.1'}, {qmochi: '0.6.0'}).commit('feat(qmochi): y', ['qmochi']).commit('fix(cli): z', ['kit']);
  const cfg = config({records: {qmochi: {'x-channel': {line: '0.6.1', channel: 'beta'}}, kit: {'x-channel': {line: '0.5.0', channel: 'beta'}}}});
  const res = await runner(r, 'next', {cfg});
  assert.equal(res.exitCode, 0, res.lines.join('\n'));
  const pr = t => res.fake.prs.find(p => p.title === t);
  const q = pr('chore(release): qmochi 0.7.0-alpha.0');
  const before = `${JSON.stringify(cfg, null, 2)}\n`;
  const written = q.contents[CONFIG];
  assert.equal(JSON.parse(written).packages['incubator/qmochi']['x-channel'], undefined);
  const expected = JSON.parse(before);
  delete expected.packages['incubator/qmochi']['x-channel'];
  assert.deepEqual(JSON.parse(written), expected);
  assert.equal(written.split('\n').length, before.split('\n').length - 4, 'only the record lines removed');
  // kit stays on its promoted line: its PR leaves the config alone
  const k = pr('chore(release): kit 0.5.0-beta.2');
  assert.ok(k, res.fake.prs.map(p => p.title).join(', '));
  assert.equal(k.contents[CONFIG], undefined);
});

test('a stock-only config runs unchanged through the runner', async () => {
  const r = nextRepo().commit('fix(qmochi): c', ['qmochi']);
  const res = await runner(r, 'next', {cfg: config({versioning: 'prerelease'})});
  assert.equal(res.exitCode, 0);
  assert.deepEqual(res.fake.prs.map(p => p.title), ['chore(release): qmochi 0.2.0-alpha.2']);
});

test('dry run builds and prints, writes nothing', async () => {
  const r = nextRepo().commit('fix(qmochi): c', ['qmochi']);
  const res = await runner(r, 'next', {env: {DRY_RUN: 'true'}});
  assert.equal(res.exitCode, 0);
  assert.deepEqual(res.fake.prs, []);
  assert.ok(res.lines.some(l => l === 'dry-run pull request: chore(release): qmochi 0.2.0-alpha.2 [release-please--branches--next--components--qmochi]'), res.lines.join('\n'));
  assert.deepEqual(res.file, {});
});

test('inputs', () => {
  assert.throws(() => parseInputs({GITHUB_REPOSITORY: 'o/r'}), /TOKEN is required/);
  assert.throws(() => parseInputs({TOKEN: 't', GITHUB_REPOSITORY: 'o/r', FORK: 'yes'}), /FORK: 'yes' is not a boolean/);
  assert.throws(() => parseInputs({TOKEN: 't'}), /owner\/repo/);
  const i = parseInputs({TOKEN: 't', GITHUB_REPOSITORY: 'o/r', GITHUB_GRAPHQL_URL: 'https://ghe.example.com/api/graphql', SKIP_LABELING: 'True'});
  assert.equal(i.githubGraphqlUrl, 'https://ghe.example.com/api');
  assert.equal(i.configFile, 'release-please-config.json');
  assert.equal(i.manifestFile, '.release-please-manifest.json');
  assert.equal(i.skipLabeling, true);
  assert.equal(i.fork, undefined);
});

test('bad inputs exit 2 without touching GitHub', async () => {
  const {lines, logger} = quiet();
  const res = await run({env: {GITHUB_REPOSITORY: 'o/r'}, rpRoot: RP, logger});
  assert.equal(res.exitCode, 2);
  assert.ok(lines.includes('::error::TOKEN is required'));
});
