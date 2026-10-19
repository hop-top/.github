'use strict';
// Upgrade gate: every release-please surface the extension relies on
// (lib/internals.js), exercised against the installed release-please.
// RP_ROOT=<release-please package dir> checks another copy.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {DEEP, load} = require('../lib/internals');
const {install} = require('../lib/install');
const {createGitHub} = require('./helpers/git-github');
const {repo} = require('./helpers/fixture');

const RP = path.resolve(process.env.RP_ROOT || path.dirname(require.resolve('release-please/package.json', {paths: [path.join(__dirname, '..')]})));
const rp = install(RP);
const I = load(RP);
rp.setLogger({error() {}, warn() {}, info() {}, debug() {}, trace() {}});
const offline = () => {
  throw new Error('network access in a hermetic test');
};
const pinned = require(path.join(__dirname, '..', 'package.json')).dependencies['release-please'];

test('pinned release-please is the one installed', {skip: !!process.env.RP_ROOT}, () => {
  assert.match(pinned, /^\d+\.\d+\.\d+$/, 'package.json pins an exact version');
  assert.equal(rp.VERSION, pinned);
});

test('public exports', () => {
  for (const k of ['GitHub', 'Manifest', 'registerVersioningStrategy', 'registerPlugin', 'getVersioningStrategyTypes', 'getPluginTypes', 'setLogger']) {
    assert.ok(rp[k], k);
  }
  assert.match(rp.VERSION, /^\d+\.\d+\.\d+/);
  assert.ok(rp.getVersioningStrategyTypes().includes('target'));
  assert.ok(rp.getPluginTypes().includes('target-context'));
  assert.ok(rp.getPluginTypes().includes('conditional-linked-versions'));
});

test('every deep import resolves', () => {
  for (const d of DEEP) assert.ok(I[d.export], `build/src/${d.module} exports ${d.export}`);
  assert.equal(typeof I.Version.parse, 'function');
  assert.ok(I.Version.parse('0.6.0-alpha.1').compare(I.Version.parse('0.6.0-alpha.0')) > 0);
  assert.equal(I.Version.parse('0.6.0-alpha.1').preRelease, 'alpha.1');
  for (const m of ['preconfigure', 'run', 'processCommits']) assert.equal(typeof I.ManifestPlugin.prototype[m], 'function', m);
  assert.ok(I.LinkedVersions.prototype instanceof I.ManifestPlugin);
  assert.equal(typeof I.buildStrategy, 'function');
});

test('commit parsing records Release-As as a RELEASE AS note', () => {
  const parsed = I.parseConventionalCommits([{sha: 'abc', message: 'fix: x\n\nRelease-As: 9.9.9', files: []}]);
  assert.deepEqual(parsed.flatMap(c => c.notes).filter(n => n.title === 'RELEASE AS').map(n => n.text), ['9.9.9']);
  const [b] = I.parseConventionalCommits([{sha: 'abc', message: 'feat!: x', files: []}]);
  assert.equal(b.breaking, true);
  assert.equal(b.type, 'feat');
});

test('tag, branch and pull request body parsing', () => {
  const t = I.TagName.parse('kit-py/v0.6.0-alpha.0');
  assert.equal(t.component, 'kit-py');
  assert.equal(t.version.toString(), '0.6.0-alpha.0');
  assert.equal(I.TagName.parse('v1.2.3').component, undefined);
  assert.equal(I.BranchName.parse('release-please--branches--next--components--kit-rs').getComponent(), 'kit-rs');
  assert.ok(I.BranchName.parse('release-please--branches--next--groups--kit'));
  assert.equal(I.BranchName.parse('feature/x'), undefined);
  const body = new I.PullRequestBody([
    {component: 'kit', version: I.Version.parse('0.6.0-alpha.0'), notes: 'a'},
    {component: 'kit-ts', version: I.Version.parse('0.6.0-alpha.0'), notes: 'b'},
  ]).toString();
  assert.deepEqual(I.PullRequestBody.parse(body).releaseData.map(d => d.component), ['kit', 'kit-ts']);
});

async function strategy(extra = {}) {
  const github = await rp.GitHub.create({owner: 'o', repo: 'r', token: 'x', defaultBranch: 'next', fetch: offline});
  return I.buildStrategy({github, releaseType: 'simple', component: 'c', versioning: 'target', prereleaseType: 'alpha.0', prerelease: true, ...extra});
}
const latest = v => ({tag: new (require(path.join(RP, 'build/src/util/tag-name')).TagName)(I.Version.parse(v), 'c'), sha: 'abc', notes: ''});
const commits = msgs => I.parseConventionalCommits(msgs.map((m, i) => ({sha: `s${i}`, message: m, files: []})));

test('the target strategy reaches strategy.versioningStrategy with its options', async () => {
  const s = await strategy();
  assert.ok(s.versioningStrategy, 'strategy.versioningStrategy');
  assert.equal(typeof s.versioningStrategy.bump, 'function');
  assert.equal(s.versioningStrategy.options.prerelease, true, 'prerelease reaches the versioning factory (fallback role)');
});

test('buildReleasePullRequest: bump awaited, bumpOnlyOptions forces a version, releaseAs and Release-As win', async () => {
  const s = await strategy();
  s.versioningStrategy.ctx = {kind: 'prerelease', component: 'c', branch: 'next', records: {promotion: {line: '0.6.0', channel: 'beta'}}};
  const pr = await s.buildReleasePullRequest(commits(['fix: a']), latest('0.6.0-alpha.7'));
  assert.equal(pr.version.toString(), '0.6.0-beta.0', 'versioningStrategy.bump result (awaited)');
  const forced = await s.buildReleasePullRequest([], latest('0.6.0-rc.1'), false, [], {newVersion: I.Version.parse('0.6.0')});
  assert.equal(forced.version.toString(), '0.6.0', 'bumpOnlyOptions.newVersion with no commits');
  assert.equal(await s.buildReleasePullRequest([], latest('0.6.0-rc.1')), undefined, 'no commits, no bumpOnly: no PR');
  const footer = await s.buildReleasePullRequest(commits(['fix: a\n\nRelease-As: 9.9.9']), latest('0.6.0-alpha.7'));
  assert.equal(footer.version.toString(), '9.9.9', 'a RELEASE AS note beats the strategy (why target-context strips it)');
  const pinnedAs = await strategy({releaseAs: '7.7.7'});
  const cfg = await pinnedAs.buildReleasePullRequest(commits(['fix: a']), latest('0.6.0-alpha.7'));
  assert.equal(cfg.version.toString(), '7.7.7', 'releaseAs config beats everything (how a linked member is pinned)');
});

// A one-package fixture repository with a probe plugin recording the calls.
async function manifestWithProbe(branch = 'next') {
  const r = repo();
  r.commit('chore: initial');
  r.manifest({kit: '0.5.0-alpha.1'});
  r.commit('chore(release): kit 0.5.0-alpha.1').tag('kit', '0.5.0-alpha.1');
  r.commit('fix: a', ['kit']);
  if (branch !== 'main') r.git('branch', branch);
  const calls = [];
  rp.registerPlugin('contract-probe', o => new class extends I.ManifestPlugin {
    async preconfigure(strategies, commitsByPath, releasesByPath) {
      calls.push(['preconfigure', Object.keys(strategies), Object.keys(commitsByPath), Object.keys(releasesByPath)]);
      const s = strategies['.'];
      const orig = s.buildReleasePullRequest.bind(s);
      s.buildReleasePullRequest = async (...a) => {
        calls.push(['build', a.length]);
        return orig(...a);
      };
      return strategies;
    }
    async run(c) {
      calls.push(['run', c.length]);
      return c;
    }
  }(o.github, o.targetBranch, o.repositoryConfig));
  const config = {
    'include-component-in-tag': true, 'tag-separator': '/', label: 'status:release-pending', 'release-label': 'status:release-tagged',
    plugins: ['contract-probe', {type: 'target-context', prereleaseBranches: [branch]}],
    packages: {'.': {'release-type': 'go', component: 'kit', versioning: 'target', prerelease: true, 'prerelease-type': 'alpha.0'}},
  };
  const github = await createGitHub({rpRoot: RP, dir: r.dir, branch, config});
  const m = await rp.Manifest.fromManifest(github, branch, '.github/release-please-config.json', '.github/.release-please-manifest.json');
  return {r, m, github, calls};
}

test('Manifest: plugins in config order, preconfigure before any pull request is built', async () => {
  const {m, calls} = await manifestWithProbe();
  assert.equal(m.plugins.map(p => p.constructor.name).indexOf('TargetContext'), 1, 'plugins built in config order');
  const prs = await m.buildPullRequests();
  assert.equal(prs[0].version.toString(), '0.5.0-alpha.2');
  assert.deepEqual(calls[0], ['preconfigure', ['.'], ['.'], ['.']]);
  assert.equal(calls[1][0], 'build');
  assert.ok(calls[1][1] >= 4, 'buildReleasePullRequest(commits, latestRelease, draft, labels)');
  assert.deepEqual(calls[calls.length - 1], ['run', 1]);
  assert.equal(m.targetBranch, 'next');
  assert.equal(m.repositoryConfig['.'].versioning, 'target');
  assert.deepEqual(m.labels, ['status:release-pending']);
});

test('Manifest: create* call the overridable build* methods; release candidates carry path and prerelease', async () => {
  const {m, github} = await manifestWithProbe();
  let built = 0;
  const orig = m.buildPullRequests.bind(m);
  m.buildPullRequests = async () => (built++, orig());
  await m.createPullRequests();
  assert.equal(built, 1, 'createPullRequests -> this.buildPullRequests()');
  const open = await m.findOpenReleasePullRequests();
  assert.equal(open.length, 1, 'findOpenReleasePullRequests finds the PR by config label');
  assert.equal(open[0].headBranchName, 'release-please--branches--next--components--kit');
  const merged = [];
  for await (const pr of m.findMergedReleasePullRequests()) merged.push(pr);
  assert.deepEqual(merged, []);

  github.fake.prs[0].state = 'MERGED';
  github.fake.prs[0].sha = 'f'.repeat(40);
  const {Manifest} = rp;
  const m2 = await Manifest.fromManifest(github, 'next', '.github/release-please-config.json', '.github/.release-please-manifest.json');
  const candidates = await m2.buildReleases();
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].path, '.');
  assert.equal(typeof candidates[0].prerelease, 'boolean');
  let releasesBuilt = 0;
  const origR = m2.buildReleases.bind(m2);
  m2.buildReleases = async () => (releasesBuilt++, origR());
  await m2.createReleases();
  assert.equal(releasesBuilt, 1, 'createReleases -> this.buildReleases()');
});

test('GitHub#buildChangeSet runs Update.updater.updateContent, same-path updates merged', async () => {
  const github = await rp.GitHub.create({owner: 'o', repo: 'r', token: 'x', defaultBranch: 'main', fetch: offline});
  github.getFileContentsOnBranch = async () => ({content: Buffer.from('a').toString('base64'), parsedContent: 'a', sha: 'x', mode: '100644'});
  const changes = await github.buildChangeSet([
    {path: 'f.json', createIfMissing: false, updater: {updateContent: c => `${c}b`}},
    {path: 'f.json', createIfMissing: false, updater: {updateContent: c => `${c}c`}},
  ], 'main');
  assert.equal(changes.get('f.json').content, 'abc');
});

test('LinkedVersions fields and GitHub methods the extension uses', async () => {
  const github = await rp.GitHub.create({owner: 'o', repo: 'r', token: 'x', defaultBranch: 'main', fetch: offline});
  const lv = new I.LinkedVersions(github, 'main', {}, 'kit', ['kit', 'kit-ts']);
  assert.ok(lv.components instanceof Set && lv.components.has('kit-ts'));
  assert.equal(lv.groupName, 'kit');
  assert.equal(typeof github.octokit.pulls.update, 'function', 'GitHub#octokit.pulls.update');
  for (const k of ['commentOnIssue', 'tagIterator', 'releaseIterator', 'pullRequestIterator', 'createRelease', 'createPullRequest', 'updatePullRequest', 'getFileJson', 'buildChangeSet']) {
    assert.equal(typeof github[k], 'function', `GitHub#${k}`);
  }
  assert.deepEqual(github.repository, {owner: 'o', repo: 'r', defaultBranch: 'main'});
});
