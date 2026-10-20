'use strict';
// Action-equivalent runner: what googleapis/release-please-action@v5 does in
// main() (GitHub.create with the target branch, createReleases() then
// createPullRequests(), the same outputs), on a release-please instance with
// the target extension installed, plus:
//   - hand the extension the raw config (release-please drops x-* keys)
//   - refuse config the extension cannot honour before the pull request
//     stage writes anything (merged release PRs are still released)
//   - rule 6: a stable release is never created as a GitHub prerelease
//   - rule 7: close release PRs a new proposal superseded
//   - rule 3 (and every other blocked package): exit non-zero once all
//     packages were processed; a skipped package is a notice only
//
// Inputs are environment variables named after the action inputs:
//   TOKEN (required)           token
//   REPO_URL                   repo-url (default GITHUB_REPOSITORY)
//   TARGET_BRANCH              target-branch (default: the repository default branch)
//   CONFIG_FILE                config-file (default release-please-config.json)
//   MANIFEST_FILE              manifest-file (default .release-please-manifest.json)
//   GITHUB_API_URL             github-api-url
//   GITHUB_GRAPHQL_URL         github-graphql-url
//   CHANGELOG_HOST             changelog-host (default https://github.com)
//   SKIP_GITHUB_RELEASE, SKIP_GITHUB_PULL_REQUEST, SKIP_LABELING, FORK
//   DRY_RUN                    'true': build and print, no writes (not an action input)
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {install, isTarget, branchKind} = require('./install');
const {load} = require('./internals');
const {reportFor, attachConfig} = require('./report');
const rules = require('./rules');

const DEFAULT_CONFIG_FILE = 'release-please-config.json';
const DEFAULT_MANIFEST_FILE = '.release-please-manifest.json';
const DEFAULT_GITHUB_API_URL = 'https://api.github.com';
const DEFAULT_GITHUB_GRAPHQL_URL = 'https://api.github.com';
const DEFAULT_GITHUB_SERVER_URL = 'https://github.com';

// Runner messages; release-please keeps its own logger. Workflow commands
// (::error::) go to stdout, where the runner reads them.
const consoleLogger = {
  error: m => process.stdout.write(`${m}\n`),
  warn: m => process.stdout.write(`${m}\n`),
  info: m => process.stdout.write(`${m}\n`),
  debug() {},
  trace() {},
};

const rpRootDefault = () => path.dirname(require.resolve('release-please/package.json', {paths: [path.join(__dirname, '..')]}));

class InputError extends Error {}

function parseInputs(env) {
  const get = k => (env[k] === undefined || env[k] === '' ? undefined : env[k]);
  const bool = k => {
    const v = get(k);
    if (v === undefined) return undefined;
    if (['true', 'True', 'TRUE'].includes(v)) return true;
    if (['false', 'False', 'FALSE'].includes(v)) return false;
    throw new InputError(`${k}: '${v}' is not a boolean (true | false)`);
  };
  const inputs = {
    token: get('TOKEN'),
    repoUrl: get('REPO_URL') || get('GITHUB_REPOSITORY') || '',
    targetBranch: get('TARGET_BRANCH'),
    configFile: get('CONFIG_FILE') || DEFAULT_CONFIG_FILE,
    manifestFile: get('MANIFEST_FILE') || DEFAULT_MANIFEST_FILE,
    githubApiUrl: get('GITHUB_API_URL') || DEFAULT_GITHUB_API_URL,
    githubGraphqlUrl: (get('GITHUB_GRAPHQL_URL') || '').replace(/\/graphql$/, '') || DEFAULT_GITHUB_GRAPHQL_URL,
    changelogHost: get('CHANGELOG_HOST') || DEFAULT_GITHUB_SERVER_URL,
    skipGitHubRelease: bool('SKIP_GITHUB_RELEASE'),
    skipGitHubPullRequest: bool('SKIP_GITHUB_PULL_REQUEST'),
    skipLabeling: bool('SKIP_LABELING'),
    fork: bool('FORK'),
    dryRun: bool('DRY_RUN') || false,
  };
  if (!inputs.token) throw new InputError('TOKEN is required');
  if (!/^[^/]+\/[^/]+$/.test(inputs.repoUrl)) throw new InputError(`REPO_URL / GITHUB_REPOSITORY must be owner/repo, got '${inputs.repoUrl}'`);
  return inputs;
}

// GITHUB_OUTPUT writer with @actions/core's semantics (toCommandValue +
// heredoc delimiter); without GITHUB_OUTPUT the outputs only land in `seen`.
function outputSink(env) {
  const seen = {};
  const set = (key, value) => {
    const v = value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
    seen[key] = v;
    if (!env.GITHUB_OUTPUT) return;
    const d = `ghadelimiter_${crypto.randomUUID()}`;
    fs.appendFileSync(env.GITHUB_OUTPUT, `${key}<<${d}${os.EOL}${v}${os.EOL}${d}${os.EOL}`);
  };
  return {set, seen};
}

async function loadManifest(rp, github, inputs) {
  const overrides = inputs.fork || inputs.skipLabeling ? {fork: inputs.fork, skipLabeling: inputs.skipLabeling} : {};
  const manifest = await rp.Manifest.fromManifest(github, github.repository.defaultBranch, inputs.configFile, inputs.manifestFile, overrides);
  if (inputs.changelogHost && inputs.changelogHost !== DEFAULT_GITHUB_SERVER_URL) {
    for (const p in manifest.repositoryConfig) manifest.repositoryConfig[p].changelogHost = inputs.changelogHost;
  }
  return manifest;
}

const pluginType = p => (typeof p === 'object' && p ? p.type : p);

// The branch role target-context gives package `p` (its `prerelease` flag
// on a branch with no role).
function roleOf(manifest, raw, p) {
  const ctx = (raw.plugins || []).find(x => x && typeof x === 'object' && x.type === 'target-context') || {};
  return branchKind(manifest.targetBranch, ctx) || (manifest.repositoryConfig[p].prerelease ? 'prerelease' : 'stable');
}

// The prerelease channel of a manifest version (alpha of 0.5.0-alpha.3),
// if it has one.
function channelOf(version) {
  try {
    const {pre} = rules.parse(version);
    return pre && pre.split('.')[0];
  } catch {
    return undefined; // not a version: release-please refuses it itself
  }
}

// Config the extension cannot honour: the pull request stage refuses it
// before anything is written. `versions` is the manifest (path -> version).
async function checkConfig(manifest, configFile, raw, versions = {}) {
  const problems = [];
  const strategies = await manifest.getStrategiesByPath();
  const target = Object.keys(manifest.repositoryConfig).filter(p => isTarget(strategies[p]));
  for (const p of Object.keys(manifest.repositoryConfig)) {
    const pkg = (raw.packages || {})[p] || {};
    if (pkg['x-channel'] === undefined && pkg['x-open-line'] === undefined) continue;
    let bad = false;
    for (const key of ['x-channel', 'x-open-line']) {
      if (pkg[key] === undefined) continue;
      if (!target.includes(p)) {
        problems.push(`${configFile}: package ${p} has ${key} but does not use versioning "target"`);
        bad = true;
        continue;
      }
      try {
        if (key === 'x-channel') rules.promotionOf(pkg[key]);
        else rules.openLineOf(pkg[key]);
      } catch (e) {
        problems.push(`${configFile}: package ${p}: ${e.message}`);
        bad = true;
      }
    }
    // Against the manifest on the prerelease branch only: elsewhere the
    // records are inert (a stable branch carries next's config as merged).
    if (bad || roleOf(manifest, raw, p) !== 'prerelease') continue;
    for (const problem of rules.recordProblems({current: versions[p], promotion: pkg['x-channel'], openLine: pkg['x-open-line']})) {
      problems.push(`${configFile}: package ${p} ${problem}`);
    }
  }
  if (!target.length) return problems;
  const types = (manifest.plugins || []).map(p => p.constructor && p.constructor.name);
  const ctxAt = types.indexOf('TargetContext');
  if (ctxAt < 0) problems.push(`${configFile}: packages ${target.join(', ')} use versioning "target" but plugins has no "target-context"`);
  const linkedAt = types.indexOf('ConditionalLinkedVersions');
  if (ctxAt >= 0 && linkedAt >= 0 && linkedAt < ctxAt) problems.push(`${configFile}: "target-context" must be listed before "conditional-linked-versions"`);
  for (const p of target) {
    const c = manifest.repositoryConfig[p];
    if (c.releaseAs) problems.push(`${configFile}: package ${p} sets release-as; target versioning picks the version (remove it)`);
    if (c.prereleaseType !== undefined && String(c.prereleaseType) !== 'alpha.0') {
      problems.push(`${configFile}: package ${p} prerelease-type '${c.prereleaseType}': every line starts on alpha.0; promote a line with x-channel (bin/promote.js)`);
    }
    // The rules know alpha -> beta -> rc only (a stock experimental.N, say).
    const ch = channelOf(versions[p]);
    if (ch !== undefined && !rules.CHANNELS.includes(ch)) {
      problems.push(`${configFile}: package ${p} manifest version '${versions[p]}' is on channel '${ch}': target versioning supports alpha/beta/rc only; seed the manifest on alpha when adopting`);
    }
  }
  for (const [i, plugin] of (manifest.plugins || []).entries()) {
    if (types[i] !== 'LinkedVersions' || !plugin.components) continue;
    for (const p of target) {
      const c = (await strategies[p].getComponent()) || '';
      if (plugin.components.has(c)) problems.push(`${configFile}: ${c} is in a "linked-versions" group; use "conditional-linked-versions" with versioning "target"`);
    }
  }
  return problems;
}

// Rule 6: the GitHub prerelease flag follows the version, not
// `prerelease: true` + major 0.
function fixPrereleaseFlag(manifest, strategiesPromise) {
  const orig = manifest.buildReleases.bind(manifest);
  manifest.buildReleases = async () => {
    const strategies = await strategiesPromise;
    return (await orig()).map(r => (isTarget(strategies[r.path]) ? {...r, prerelease: !!r.tag.version.preRelease} : r));
  };
}

async function componentsOf(I, pr, logger) {
  const body = I.PullRequestBody.parse(pr.body || '', logger);
  const fromBody = body ? body.releaseData.map(d => d.component).filter(c => c !== undefined) : [];
  if (fromBody.length) return new Set(fromBody.map(c => c || ''));
  const branch = I.BranchName.parse(pr.headBranchName || pr.headRefName || '', logger);
  return new Set([(branch && branch.getComponent && branch.getComponent()) || '']);
}

// Rule 7: an open release PR on this branch that this run did not propose
// is closed, with a comment linking the PR(s) now carrying its components;
// with no replacement it is closed only when its components are blocked
// or skipped. Only release-please's own branches: a PR someone opened by
// hand keeps its labels and stays open.
async function closeSuperseded({I, manifest, github, candidates, logger}) {
  for await (const _ of manifest.findMergedReleasePullRequests()) {
    logger.info('target: merged, untagged release PRs outstanding: not closing anything');
    return [];
  }
  const open = await manifest.findOpenReleasePullRequests();
  const proposed = new Set(candidates.map(c => c.headRefName));
  const replacements = [];
  for (const c of candidates) {
    const pr = open.find(o => o.headBranchName === c.headRefName);
    if (pr) replacements.push({pr, components: await componentsOf(I, {body: c.body.toString(), headRefName: c.headRefName}, logger)});
  }
  const report = reportFor(github);
  const blocked = [...report.list(), ...report.notices()];
  const closed = [];
  for (const pr of open) {
    if (proposed.has(pr.headBranchName) || !I.BranchName.parse(pr.headBranchName, logger)) continue;
    const comps = await componentsOf(I, pr, logger);
    const by = replacements.filter(r => [...comps].some(c => r.components.has(c)));
    let comment;
    if (by.length) {
      comment = `Superseded by ${by.map(r => `#${r.pr.number}`).join(', ')}.`;
    } else {
      const why = blocked.filter(b => comps.has(b.component));
      if (!why.length) {
        logger.warn(`target: open release PR #${pr.number} (${pr.headBranchName}) is no longer proposed and has no replacement: left open`);
        continue;
      }
      comment = `Closed: no release is proposed for ${[...new Set(why.map(b => b.name))].join(', ')}:\n\n${[...new Set(why.map(b => `- ${b.reason}`))].join('\n')}`;
    }
    await github.commentOnIssue(`${comment}\n\n(target versioning)`, pr.number);
    await github.octokit.pulls.update({owner: github.repository.owner, repo: github.repository.repo, pull_number: pr.number, state: 'closed'});
    logger.info(`target: closed #${pr.number} (${pr.headBranchName}): ${comment.split('\n')[0]}`);
    closed.push({number: pr.number, comment});
  }
  return closed;
}

function outputReleases(out, releases) {
  releases = releases.filter(r => r !== undefined);
  const paths = [];
  out.set('releases_created', releases.length > 0);
  for (const release of releases) {
    const p = release.path || '.';
    paths.push(p);
    const set = (k, v) => out.set(p === '.' ? k : `${p}--${k}`, v);
    set('release_created', true);
    const rename = {tagName: 'tag_name', uploadUrl: 'upload_url', notes: 'body', url: 'html_url'};
    for (const [k, v] of Object.entries(release)) set(rename[k] || k, v);
  }
  out.set('paths_released', JSON.stringify(paths));
}

function outputPRs(out, prs) {
  prs = prs.filter(pr => pr !== undefined);
  out.set('prs_created', prs.length > 0);
  if (prs.length) {
    out.set('pr', prs[0]);
    out.set('prs', JSON.stringify(prs));
  }
}

function summary(env, report, closed) {
  if (!env.GITHUB_STEP_SUMMARY) return;
  const lines = ['## release-please (target versioning)', ''];
  // A blocked package releases nothing: its block, not the decision it was blocked after.
  const blocked = report.blockedComponents();
  for (const d of report.decisions.values()) if (!blocked.has(d.component)) lines.push(`- ${d.name}: ${d.from} -> ${d.to} (${d.reason})`);
  for (const b of report.list()) lines.push(`- **blocked** ${b.name}: ${b.reason}`);
  for (const s of report.notices()) lines.push(`- skipped ${s.name}: ${s.reason}`);
  for (const c of closed) lines.push(`- closed #${c.number}: ${c.comment.split('\n')[0]}`);
  fs.appendFileSync(env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}

/**
 * run({env, rpRoot, github, logger}) -> {exitCode, outputs, blocked, skipped, closed}
 * `github` replaces GitHub.create (tests); `logger` is release-please's.
 */
async function run({env = process.env, rpRoot = rpRootDefault(), github, logger = consoleLogger} = {}) {
  const I = load(rpRoot);
  const rp = install(rpRoot);
  const out = outputSink(env);
  const log = msg => logger.info(msg);
  let inputs;
  try {
    inputs = parseInputs(env);
  } catch (e) {
    if (e instanceof InputError) {
      logger.error(`::error::${e.message}`);
      return {exitCode: 2, outputs: out.seen, blocked: [], closed: []};
    }
    throw e;
  }
  log(`Running release-please version: ${rp.VERSION} (target versioning)`);
  if (!github) {
    const [owner, repo] = inputs.repoUrl.split('/');
    github = await rp.GitHub.create({
      owner, repo,
      apiUrl: inputs.githubApiUrl,
      graphqlUrl: inputs.githubGraphqlUrl,
      token: inputs.token,
      defaultBranch: inputs.targetBranch,
    });
  }
  const report = reportFor(github);
  let closed = [];

  const prepare = async () => {
    const m = await loadManifest(rp, github, inputs);
    // release-please drops keys it does not know; the records come from the raw file.
    const raw = await github.getFileJson(inputs.configFile, github.repository.defaultBranch);
    attachConfig(github, inputs.configFile, raw);
    return {m, raw};
  };

  // Releases first, whatever the config: a merged release PR is tagged
  // even when the config now has a problem for the next proposals.
  if (!inputs.skipGitHubRelease) {
    const {m} = await prepare();
    fixPrereleaseFlag(m, m.getStrategiesByPath());
    if (inputs.dryRun) {
      for (const r of await m.buildReleases()) log(`dry-run release: ${r.tag.toString()} prerelease=${r.prerelease}`);
    } else {
      outputReleases(out, await m.createReleases());
    }
  }

  if (!inputs.skipGitHubPullRequest) {
    const {m, raw} = await prepare();
    const versions = await github.getFileJson(inputs.manifestFile, github.repository.defaultBranch);
    const problems = await checkConfig(m, inputs.configFile, raw, versions);
    if (problems.length) {
      for (const p of problems) logger.error(`::error::${p}`);
      logger.error('::error::no release pull request proposed: fix the config above (releases of merged release PRs, if any, were created)');
      return {exitCode: 1, outputs: out.seen, blocked: report.list(), closed};
    }
    let candidates = [];
    const build = m.buildPullRequests.bind(m);
    m.buildPullRequests = async () => (candidates = await build());
    if (inputs.dryRun) {
      for (const pr of await m.buildPullRequests()) log(`dry-run pull request: ${pr.title.toString()} [${pr.headRefName}]`);
    } else {
      outputPRs(out, await m.createPullRequests());
      closed = await closeSuperseded({I, manifest: m, github, candidates, logger});
    }
  }

  const blocked = report.list();
  const skipped = report.notices();
  for (const s of skipped) logger.info(`::notice::${s.name}: ${s.reason}`);
  for (const b of blocked) logger.error(`::error::${b.name}: ${b.reason}`);
  summary(env, report, closed);
  return {exitCode: blocked.length ? 1 : 0, outputs: out.seen, blocked, skipped, closed};
}

module.exports = {run, parseInputs, checkConfig, InputError};
