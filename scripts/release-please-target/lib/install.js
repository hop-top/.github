'use strict';
// Registers, into one release-please instance:
//   versioning "target"                  the rules in ./rules.js as a VersioningStrategy
//   plugin "target-context"              tells each target strategy the branch's role,
//                                        its component, last stable and records
//                                        (x-channel, x-open-line, from the raw config the
//                                        runner attaches); enforces the promotion /
//                                        maintenance / Release-As rules; cuts a promotion
//                                        (rc on a stable branch; x-channel, x-open-line on
//                                        the prerelease branch) with no new commit; release
//                                        PRs on the prerelease branch drop the records
//                                        their versions make stale
//   plugin "conditional-linked-versions" linked-versions that links only for a new
//                                        major, or a new minor line before 1.0 on the
//                                        prerelease branch; each member keeps its channel;
//                                        on a stable branch every member must be at an rc
//                                        of a linked major (rules.resolveGroup)
const rules = require('./rules');
const {load} = require('./internals');
const {reportFor} = require('./report');
const {removePackageKeys} = require('./config-edit');

const INSTALLED = Symbol.for('release-please-target.installed');
const TARGET = Symbol.for('release-please-target.strategy');
const WRAPPED = Symbol.for('release-please-target.wrapped');

const DEFAULT_ROLES = {
  stableBranches: ['main'],
  prereleaseBranches: ['next'],
  maintenanceBranchPattern: '^release/\\d+\\.\\d+$',
};

function list(v, fallback) {
  if (v === undefined || v === null) return fallback;
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

// The role of `branch`: explicit lists first, then the maintenance pattern.
function branchKind(branch, options = {}) {
  if (list(options.stableBranches, DEFAULT_ROLES.stableBranches).includes(branch)) return 'stable';
  if (list(options.prereleaseBranches, DEFAULT_ROLES.prereleaseBranches).includes(branch)) return 'prerelease';
  if (new RegExp(options.maintenanceBranchPattern || DEFAULT_ROLES.maintenanceBranchPattern).test(branch)) return 'maintenance';
  return undefined;
}

const short = sha => (sha ? sha.slice(0, 7) : '(synthetic)');

function install(rpRoot) {
  const I = load(rpRoot);
  const {rp, Version, ManifestPlugin, LinkedVersions, buildStrategy, parseConventionalCommits, TagName} = I;
  if (rp[INSTALLED]) return rp;

  // --------------------------------------------------------------- strategy
  class TargetVersioning {
    constructor(options = {}) {
      this[TARGET] = true;
      this.options = options;
      this.ctx = undefined; // set by target-context before any bump
      this.last = undefined; // last decision
    }
    // The decision for `version` and `commits`, without logging it.
    evaluate(version, commits) {
      const ctx = this.ctx || {kind: this.options.prerelease ? 'prerelease' : 'stable', component: '', name: '?', branch: ''};
      return rules.next({
        kind: ctx.kind,
        current: version.toString(),
        summary: rules.summarize(commits),
        lastStable: ctx.lastStable,
        promotion: ctx.records && ctx.records.promotion,
        openLine: ctx.records && ctx.records.openLine,
        branch: ctx.branch,
        prereleaseBranch: ctx.prereleaseBranch,
      });
    }
    decide(version, commits) {
      const ctx = this.ctx || {};
      const d = this.evaluate(version, commits);
      this.last = {...d, from: version.toString()};
      const log = ctx.logger;
      if (log) {
        log.info(`target: ${ctx.name} ${version} -> ${d.version || '(none)'} (${d.reason})`);
        for (const w of d.warnings) log.warn(`target: ${ctx.name}: ${w}`);
      }
      return this.last;
    }
    async bump(version, commits) {
      const d = this.decide(version, commits);
      // A blocked decision has no version; the wrapper discards the PR.
      return Version.parse(d.version || version.toString());
    }
    determineReleaseType(version, commits) {
      const v = Version.parse(this.decide(version, commits).version || version.toString());
      return {bump: () => v};
    }
  }
  rp.registerVersioningStrategy('target', options => new TargetVersioning(options));

  // ------------------------------------------------------- target-context
  async function stablesByComponent(github) {
    const out = new Map();
    for await (const tag of github.tagIterator()) {
      const t = TagName.parse(tag.name);
      if (!t || !t.version || t.version.preRelease) continue;
      const c = t.component || '';
      const cur = out.get(c);
      if (!cur || t.version.compare(cur) > 0) out.set(c, t.version);
    }
    return out;
  }

  // Rule 5: a Release-As footer would beat the strategy; drop it.
  function stripReleaseAs(commits, ctx, logger) {
    return commits.map(c => {
      const notes = c.notes || [];
      const kept = notes.filter(n => n.title !== 'RELEASE AS');
      if (kept.length === notes.length) return c;
      const as = notes.find(n => n.title === 'RELEASE AS');
      logger.warn(`target: ${ctx.name}: ignoring "Release-As: ${as.text}" on ${short(c.sha)}: target versioning picks the version`);
      return {...c, notes: kept};
    });
  }

  // A release PR on the prerelease branch drops the package's records that
  // its version makes stale: `x-channel` once the version leaves the
  // recorded line, `x-open-line` once the line is reached. Elsewhere the
  // records are inert and left alone (a stable cut does not edit them:
  // the prerelease branch's next release does, so the two branches do not
  // churn the same keys).
  function withRecordCleanup(pr, ctx) {
    if (!pr || !pr.version || !ctx.configFile || ctx.kind !== 'prerelease') return pr;
    const {promotion, openLine} = ctx.records;
    const v = pr.version;
    const target = rules.parse(`${v.major}.${v.minor}.${v.patch}`);
    const keys = [];
    if (promotion !== undefined && (!v.preRelease || rules.cmpCore(rules.parse(String(promotion.line)), target) !== 0)) keys.push('x-channel');
    if (openLine !== undefined && rules.cmpCore(target, rules.parse(String(openLine))) >= 0) keys.push('x-open-line');
    if (!keys.length) return pr;
    pr.updates.push({
      path: ctx.configFile,
      createIfMissing: false,
      updater: {updateContent: content => removePackageKeys(content, ctx.path, keys)},
    });
    return pr;
  }

  // A decision that stops the package: blocked (the run fails) or skipped
  // (a notice). True when it did.
  function settle(ctx, d, logger) {
    for (const r of d.blocked) {
      ctx.report.block(ctx.component, r, ctx.name);
      logger.error(`target: ${ctx.name}: no release on ${ctx.branch}: ${r}`);
    }
    for (const r of d.skipped) {
      ctx.report.skip(ctx.component, r, ctx.name);
      logger.info(`target: ${ctx.name}: no release on ${ctx.branch}: ${r}`);
    }
    return d.blocked.length + d.skipped.length > 0;
  }

  // Decisions cut even when no user-facing commit landed since the latest
  // release: rule 2's promotion of an rc on a stable branch, and rule 7's
  // promotion (x-channel) or opened line (x-open-line) on the prerelease
  // branch. Once that release is merged the decision is a counter again.
  const FORCED = {stable: ['promote'], prerelease: ['channel', 'open-line'], maintenance: []};

  function finish(pr, d, ctx) {
    if (pr && pr.version && d) ctx.report.decide(ctx.component, d.from, pr.version.toString(), d.reason, ctx.name);
    return withRecordCleanup(pr, ctx);
  }

  function wrap(strategy, vs, logger) {
    if (strategy[WRAPPED]) return;
    strategy[WRAPPED] = true;
    const orig = strategy.buildReleasePullRequest.bind(strategy);
    strategy.buildReleasePullRequest = async (commits, latestRelease, draft, labels, bumpOnly) => {
      const ctx = vs.ctx;
      // No release yet: release-please would open it at its initial-version.
      const first = latestRelease ? undefined : rules.unreleased(ctx);
      if (first && settle(ctx, first, logger)) return undefined;
      const cs = stripReleaseAs(commits || [], ctx, logger);
      vs.last = undefined;
      const pr = await orig(cs, latestRelease, draft, labels, bumpOnly);
      if (vs.last && settle(ctx, vs.last, logger)) return undefined;
      if (pr || bumpOnly) return finish(pr, vs.last, ctx);
      // No PR from the strategy: no commit, or none user-facing.
      const cur = latestRelease && latestRelease.tag && latestRelease.tag.version;
      if (!cur || (ctx.kind !== 'prerelease' && !cur.preRelease)) return pr;
      const d = vs.last || {...vs.evaluate(cur, cs), from: cur.toString()};
      if (settle(ctx, d, logger)) return undefined;
      if (!FORCED[ctx.kind].includes(d.code)) return pr;
      logger.info(`target: ${ctx.name}: ${d.code} release ${cur} -> ${d.version} (${d.reason}; no user-facing commit since ${cur})`);
      return finish(await orig(cs, latestRelease, draft, labels, {newVersion: Version.parse(d.version)}), d, ctx);
    };
  }

  class TargetContext extends ManifestPlugin {
    constructor(github, targetBranch, repositoryConfig, options = {}) {
      super(github, targetBranch, repositoryConfig, options.logger);
      this.options = options;
    }
    async preconfigure(strategiesByPath) {
      const kind = branchKind(this.targetBranch, this.options);
      // The prerelease branch, as block messages name it ("land it on next").
      const prereleaseBranch = list(this.options.prereleaseBranches, DEFAULT_ROLES.prereleaseBranches).join(' or ') || undefined;
      const stables = await stablesByComponent(this.github);
      const report = reportFor(this.github);
      const config = report.config;
      if (!config) this.logger.warn('target: no raw config attached (run through bin/run.js): x-channel / x-open-line records are not read');
      for (const p in strategiesByPath) {
        const strategy = strategiesByPath[p];
        const vs = strategy.versioningStrategy;
        if (!vs || !vs[TARGET]) continue;
        // `component` is release-please's ('' for none, as in PR bodies and
        // branch names); `name` is what messages show.
        const component = (await strategy.getComponent()) || '';
        const name = component || p;
        let k = kind;
        if (!k) {
          k = this.repositoryConfig[p].prerelease ? 'prerelease' : 'stable';
          this.logger.warn(`target: branch ${this.targetBranch} has no role (stableBranches, prereleaseBranches, maintenanceBranchPattern): ${name} treated as ${k}`);
        }
        const last = stables.get(component);
        const raw = (config && config.json.packages && config.json.packages[p]) || {};
        vs.ctx = {
          kind: k, branch: this.targetBranch, prereleaseBranch, component, name, path: p, lastStable: last && last.toString(), logger: this.logger, report,
          configFile: config && config.file, records: {promotion: raw['x-channel'], openLine: raw['x-open-line']},
        };
        wrap(strategy, vs, this.logger);
      }
      return strategiesByPath;
    }
  }

  rp.registerPlugin('target-context', o => new TargetContext(o.github, o.targetBranch, o.repositoryConfig, {
    ...(typeof o.type === 'object' ? o.type : {}),
    logger: o.logger,
  }));

  // ------------------------------------------- conditional-linked-versions
  function blockedStrategy(strategy) {
    const s = Object.create(strategy);
    s.buildReleasePullRequest = async () => undefined;
    return s;
  }

  class ConditionalLinkedVersions extends LinkedVersions {
    constructor(github, targetBranch, repositoryConfig, groupName, components, options = {}) {
      if (typeof groupName !== 'string' || !groupName) throw new Error('conditional-linked-versions: groupName (string) is required');
      if (!Array.isArray(components) || !components.length) throw new Error(`conditional-linked-versions ${groupName}: components (non-empty array) is required`);
      super(github, targetBranch, repositoryConfig, groupName, components, options);
      this.linked = false;
    }

    async preconfigure(strategiesByPath, commitsByPath, releasesByPath) {
      this.linked = false;
      const report = reportFor(this.github);
      const members = [];
      for (const p in strategiesByPath) {
        const s = strategiesByPath[p];
        const component = (await s.getComponent()) || '';
        if (!this.components.has(component)) continue;
        const vs = s.versioningStrategy;
        if (!vs || !vs[TARGET] || !vs.ctx) {
          throw new Error(`conditional-linked-versions ${this.groupName}: member ${component} (${p}) needs versioning "target" and the target-context plugin listed before this one`);
        }
        members.push({p, component, s, ctx: vs.ctx});
      }
      if (!members.length) return strategiesByPath;
      const kind = members[0].ctx.kind;
      if (kind === 'maintenance') {
        this.logger.info(`conditional-linked-versions: ${this.groupName}: maintenance branch ${this.targetBranch}: independent`);
        return strategiesByPath;
      }

      // Each member's own proposal, through its target strategy.
      const before = report.blockedComponents();
      const rows = [];
      for (const m of members) {
        const latest = releasesByPath[m.p];
        let proposed;
        if (latest) {
          const pr = await m.s.buildReleasePullRequest(parseConventionalCommits(commitsByPath[m.p] || [], this.logger), latest);
          proposed = pr && pr.version ? pr.version.toString() : undefined;
        }
        rows.push({component: m.component, current: latest && latest.tag.version.toString(), lastStable: m.ctx.lastStable, proposed, promotion: m.ctx.records.promotion});
      }
      const g = rules.resolveGroup({kind, groupName: this.groupName, members: rows, prereleaseBranch: members[0].ctx.prereleaseBranch});
      this.logger.info(`conditional-linked-versions: ${g.reason}`);
      if (!g.linked) return strategiesByPath;

      const after = report.blockedComponents();
      const held = members.filter(m => after.has(m.component) && !before.has(m.component)).map(m => m.component);
      const reasons = g.blocked.length ? g.blocked : held.length
        ? [`${this.groupName}: linked, but ${held.join(', ')} cannot release: no group release`]
        : [];
      const out = {...strategiesByPath};
      if (reasons.length) {
        for (const m of members) {
          for (const r of reasons) report.block(m.component, r, m.ctx.name);
          out[m.p] = blockedStrategy(m.s);
        }
        for (const r of reasons) this.logger.error(`conditional-linked-versions: ${r}`);
        return out;
      }

      this.linked = true;
      for (const [i, m] of members.entries()) {
        const version = g.versions[m.component];
        const rebuilt = await buildStrategy({
          ...this.repositoryConfig[m.p],
          github: this.github,
          path: m.p,
          targetBranch: this.targetBranch,
          releaseAs: version,
        });
        if (rebuilt.versioningStrategy && rebuilt.versioningStrategy[TARGET]) rebuilt.versioningStrategy.ctx = m.ctx;
        // Every member is in the group PR, also one whose commits are not
        // user-facing (a chore, a config change): its version is forced.
        const build = rebuilt.buildReleasePullRequest.bind(rebuilt);
        rebuilt.buildReleasePullRequest = async (cs, latest, draft, labels) =>
          withRecordCleanup(await build(cs, latest, draft, labels, {newVersion: Version.parse(version)}), m.ctx);
        out[m.p] = rebuilt;
        if (rows[i].current) report.decide(m.component, rows[i].current, version, g.reason, m.ctx.name);
        const commits = commitsByPath[m.p] || (commitsByPath[m.p] = []);
        if (parseConventionalCommits(commits, this.logger).length === 0) {
          commits.push({sha: '', message: `chore(${m.component}): synchronize ${this.groupName} versions\n\nRelease-As: ${version}`});
        }
      }
      return out;
    }

    async run(candidates) {
      return this.linked ? super.run(candidates) : candidates;
    }
  }

  rp.registerPlugin('conditional-linked-versions', o => {
    const t = typeof o.type === 'object' ? o.type : {};
    return new ConditionalLinkedVersions(o.github, o.targetBranch, o.repositoryConfig, t.groupName, t.components, {...o, ...t});
  });

  rp[INSTALLED] = true;
  return rp;
}

const isTarget = strategy => !!(strategy && strategy.versioningStrategy && strategy.versioningStrategy[TARGET]);

module.exports = {install, branchKind, isTarget, DEFAULT_ROLES};
