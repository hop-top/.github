'use strict';
// A release-please GitHub client with every read served from a local git
// repository (files at the branch head, tags as releases, rev-list for
// history) and every write recorded in memory. No network: the Octokit,
// request and GraphQL clients are replaced by functions that throw.
const {execFileSync} = require('child_process');
const path = require('path');

const GIT_ENV = {GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0'};

function makeGit(dir) {
  return (...args) => execFileSync('git', ['-C', dir, ...args], {encoding: 'utf8', maxBuffer: 1 << 28, env: {...process.env, ...GIT_ENV}});
}

const offline = () => {
  throw new Error('network access in a hermetic test');
};

/**
 * createGitHub({rpRoot, dir, branch, config, prs})
 *   config  release-please config served for any *release-please-config.json
 *           (as JSON and as file contents, 2-space indented)
 *   prs     initial pull requests: {number, headBranchName, baseBranchName,
 *           title, body, labels, state: OPEN|MERGED|CLOSED, sha}
 * Returns the GitHub client; `client.fake` holds the recorded state.
 */
async function createGitHub({rpRoot, dir, branch, config, prs = []}) {
  const {GitHub} = require(rpRoot);
  const {FileNotFoundError} = require(path.join(rpRoot, 'build/src/errors'));
  const git = makeGit(dir);
  const gh = await GitHub.create({owner: 'hop-top', repo: 'sim', token: 'test-token', defaultBranch: branch, fetch: offline});
  const fake = {prs: prs.map(p => ({labels: [], files: [], ...p})), releases: [], comments: [], closed: [], labelOps: [], nextNumber: 100};
  gh.fake = fake;
  gh.octokit = {pulls: {update: async ({pull_number: n, state}) => {
    const pr = fake.prs.find(p => p.number === n);
    if (!pr) throw new Error(`no pull request #${n}`);
    if (state === 'closed') {
      pr.state = 'CLOSED';
      fake.closed.push(n);
    }
    return {data: {}};
  }}};
  gh.graphql = offline;
  gh.request = offline;

  const ref = () => git('rev-parse', branch).trim();
  const show = p => {
    try {
      return git('show', `${ref()}:${p}`);
    } catch {
      throw new FileNotFoundError(p);
    }
  };
  const isConfig = p => p.endsWith('release-please-config.json') && config;
  gh.getFileJson = async p => (isConfig(p) ? JSON.parse(JSON.stringify(config)) : JSON.parse(show(p)));
  const contents = async p => {
    const s = isConfig(p) ? `${JSON.stringify(config, null, 2)}\n` : show(p);
    return {sha: 'x', content: Buffer.from(s).toString('base64'), parsedContent: s, mode: '100644'};
  };
  gh.getFileContentsOnBranch = contents;
  gh.getFileContents = contents;
  gh.findFilesByFilenameAndRef = async () => [];
  gh.findFilesByFilename = async () => [];
  gh.findFilesByGlobAndRef = async () => [];
  gh.findFilesByExtensionAndRef = async () => [];

  const tags = () => git('for-each-ref', '--sort=-creatordate', '--format=%(refname:short) %(objectname) %(*objectname)', 'refs/tags')
    .trim().split('\n').filter(Boolean).map(l => {
      const [name, o, d] = l.split(' ');
      return {name, sha: d || o};
    });
  gh.releaseIterator = async function* () {
    for (const t of tags()) yield {name: t.name, tagName: t.name, sha: t.sha, notes: '', url: ''};
  };
  gh.tagIterator = async function* () {
    for (const t of tags()) yield t;
  };
  gh.mergeCommitIterator = async function* (_branch, opts) {
    const head = ref();
    const shas = git('rev-list', `--max-count=${(opts && opts.maxResults) || 500}`, head).trim().split('\n').filter(Boolean);
    for (const sha of shas) {
      const parents = git('rev-list', '--parents', '-n1', sha).trim().split(' ').slice(1);
      const files = git('diff-tree', '--no-commit-id', '--name-only', '-r', ...(parents.length > 1 ? [parents[0], sha] : ['--root', sha]))
        .split('\n').filter(Boolean);
      yield {sha, message: git('log', '-1', '--format=%B', sha), files};
    }
  };

  // ------------------------------------------------------------- writes
  gh.pullRequestIterator = async function* (targetBranch, status = 'MERGED') {
    for (const pr of fake.prs) if (pr.baseBranchName === targetBranch && pr.state === status) yield {...pr};
  };
  // The files a PR would carry, through release-please's own change set.
  const changed = async (updates, targetBranch) => {
    const changes = await GitHub.prototype.buildChangeSet.call(gh, updates, targetBranch);
    return Object.fromEntries([...changes].map(([p, c]) => [p, c.content]));
  };
  gh.createPullRequest = async (pullRequest, targetBranch, message, updates, options = {}) => {
    const pr = {
      headBranchName: pullRequest.headBranchName,
      baseBranchName: targetBranch,
      number: fake.nextNumber++,
      title: pullRequest.title,
      body: pullRequest.body.toString(),
      labels: pullRequest.labels,
      files: [],
      state: 'OPEN',
      draft: !!options.draft,
      fork: !!options.fork,
      updates: updates.map(u => u.path),
      contents: await changed(updates, targetBranch),
    };
    fake.prs.push(pr);
    const {contents: _c, ...out} = pr;
    return out;
  };
  gh.updatePullRequest = async (number, releasePullRequest, targetBranch) => {
    const pr = fake.prs.find(p => p.number === number);
    pr.title = releasePullRequest.title.toString();
    pr.body = releasePullRequest.body.toString();
    pr.state = 'OPEN';
    pr.updated = true;
    pr.contents = await changed(releasePullRequest.updates, targetBranch);
    const {contents: _c, ...out} = pr;
    return out;
  };
  gh.createRelease = async (release, options = {}) => {
    const r = {
      id: fake.releases.length + 1,
      name: release.name,
      tagName: release.tag.toString(),
      sha: release.sha,
      notes: release.notes,
      url: `https://github.com/hop-top/sim/releases/tag/${release.tag.toString()}`,
      draft: !!options.draft,
      uploadUrl: `https://uploads.github.com/repos/hop-top/sim/releases/${fake.releases.length + 1}/assets`,
    };
    fake.releases.push({...r, prerelease: !!options.prerelease});
    return r;
  };
  gh.commentOnIssue = async (comment, number) => {
    fake.comments.push({number, comment});
    return comment;
  };
  gh.addIssueLabels = async (labels, number) => {
    fake.labelOps.push({number, add: labels});
    const pr = fake.prs.find(p => p.number === number);
    if (pr) pr.labels = [...new Set([...pr.labels, ...labels])];
  };
  gh.removeIssueLabels = async (labels, number) => {
    fake.labelOps.push({number, remove: labels});
    const pr = fake.prs.find(p => p.number === number);
    if (pr) pr.labels = pr.labels.filter(l => !labels.includes(l));
  };
  return gh;
}

module.exports = {createGitHub, makeGit, GIT_ENV};
