'use strict';
// Drives release-please (with the extension installed) against a fixture
// repository: propose() is a dry release-pr run, land() merges a proposed
// PR the way GitHub would (release commit + tags) so cases can chain.
const path = require('path');
const {createGitHub} = require('./git-github');
const {CONFIG, MANIFEST} = require('./fixture');
const {install} = require('../../lib/install');
const {reportFor, attachConfig} = require('../../lib/report');

const RP = path.resolve(process.env.RP_ROOT || path.dirname(require.resolve('release-please/package.json', {paths: [path.join(__dirname, '../..')]})));
const rp = install(RP);

const notes = [];
const quiet = {
  error: (...a) => notes.push(`ERR ${a.join(' ')}`),
  warn: (...a) => /^(target|conditional)/.test(String(a[0])) && notes.push(a.join(' ')),
  info: (...a) => /^(target|conditional)/.test(String(a[0])) && notes.push(a.join(' ')),
  debug() {},
  trace() {},
};
rp.setLogger(quiet);

function versionsOf(pr) {
  return [...pr.body.toString().matchAll(/<summary>([^<]+)<\/summary>/g)].map(x => x[1]);
}

// The config file a PR would write, from release-please's change set.
async function configAfter(github, pr) {
  const changes = await github.buildChangeSet(pr.updates, github.repository.defaultBranch);
  return changes.has(CONFIG) ? JSON.parse(changes.get(CONFIG).content) : undefined;
}

async function propose(r, branch, cfg) {
  notes.length = 0;
  const github = await createGitHub({rpRoot: RP, dir: r.dir, branch, config: cfg});
  attachConfig(github, CONFIG, cfg);
  const m = await rp.Manifest.fromManifest(github, branch, CONFIG, MANIFEST);
  const prs = [];
  for (const pr of await m.buildPullRequests()) {
    prs.push({title: pr.title.toString(), branch: pr.headRefName, version: pr.version && pr.version.toString(), versions: versionsOf(pr), pr,
      config: await configAfter(github, pr)});
  }
  const report = reportFor(github);
  return {prs, titles: prs.map(p => p.title), blocked: report.list(), skipped: report.notices(), notes: [...notes]};
}

async function land(r, branch, cfg, pr) {
  const github = await createGitHub({rpRoot: RP, dir: r.dir, branch, config: cfg, prs: [{
    number: 1, headBranchName: pr.headRefName, baseBranchName: branch, title: pr.title.toString(), body: pr.body.toString(),
    labels: ['status:release-pending'], state: 'MERGED', sha: r.head(),
  }]});
  attachConfig(github, CONFIG, cfg);
  const m = await rp.Manifest.fromManifest(github, branch, CONFIG, MANIFEST);
  const rels = await m.buildReleases();
  const versions = {};
  for (const rel of rels) versions[rel.tag.component] = rel.tag.version.toString();
  r.checkout(branch);
  r.release(versions, pr.title.toString());
  return rels.map(x => x.tag.toString());
}

module.exports = {RP, rp, propose, land, notes};
