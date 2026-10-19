'use strict';
// Every release-please surface this extension relies on, public or not, in
// one place. test/contract.test.js walks this list against the pinned
// release-please, so an upgrade that moves or reshapes any of it fails
// there first.
//
// Public API (release-please's index exports):
//   GitHub, Manifest, VERSION, registerVersioningStrategy, registerPlugin,
//   getVersioningStrategyTypes, getPluginTypes
//
// Deep imports (build/src/..., not covered by release-please's semver):
const path = require('path');

const DEEP = [
  {module: 'version', export: 'Version', why: 'return type of VersioningStrategy#bump; parse/compare'},
  {module: 'plugin', export: 'ManifestPlugin', why: 'base class of the target-context plugin'},
  {module: 'plugins/linked-versions', export: 'LinkedVersions', why: 'subclassed by conditional-linked-versions (run() merges the group PR)'},
  {module: 'factory', export: 'buildStrategy', why: 'rebuild a linked member with releaseAs'},
  {module: 'commit', export: 'parseConventionalCommits', why: 'probe a member proposal in preconfigure'},
  {module: 'util/tag-name', export: 'TagName', why: 'last stable per component from tags'},
  {module: 'util/branch-name', export: 'BranchName', why: 'runner: release-please branches of superseded PRs'},
  {module: 'util/pull-request-body', export: 'PullRequestBody', why: 'runner: components of an open release PR'},
];

// Internal behaviour relied on (asserted by the contract test, not imported):
//   strategy.versioningStrategy                  BaseStrategy field, swapped context per run
//   strategy.buildReleasePullRequest(commits, latestRelease, draft, labels, bumpOnlyOptions)
//                                                bumpOnlyOptions.newVersion forces a version
//   BaseStrategy#buildNewVersion                 releaseAs config, then a RELEASE AS note, then
//                                                `await versioningStrategy.bump(...)`
//   Manifest#buildPullRequests                   plugin.preconfigure(strategies, commitsPerPath,
//                                                releasesByPath) in config order, before any
//                                                strategy builds its pull request
//   Manifest#getStrategiesByPath                 (private) path -> strategy, memoized: the
//                                                instances buildPullRequests hands the plugins
//                                                (runner: which packages are target, rule 6)
//   Manifest#createPullRequests                  calls this.buildPullRequests()
//   Manifest#createReleases                      calls this.buildReleases(); candidate.prerelease
//   Manifest#findOpenReleasePullRequests         open release PRs (config labels) on the branch
//   Manifest#findMergedReleasePullRequests       merged, untagged release PRs
//   Manifest#repositoryConfig, #targetBranch     parsed config per path
//   LinkedVersions#components, #groupName        Set of components, group name
//   GitHub#octokit.pulls.update                  close a pull request (no GitHub method for it)
//   GitHub#commentOnIssue, #tagIterator,         public methods on the GitHub class
//     #getFileJson                               (the raw config: release-please drops x-* keys)
//   GitHub#buildChangeSet / Update               {path, createIfMissing, updater.updateContent(text)},
//                                                same-path updates merged (record cleanup in PRs)

function load(rpRoot) {
  const rp = require(rpRoot);
  const out = {rp};
  for (const d of DEEP) out[d.export] = require(path.join(rpRoot, 'build/src', d.module))[d.export];
  return out;
}

module.exports = {DEEP, load};
