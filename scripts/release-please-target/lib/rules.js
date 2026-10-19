'use strict';
// Target versioning: the version rules, with no release-please import so
// they unit-test on their own.
//
// A version is {major, minor, patch, pre} (pre: "alpha.26" | undefined).
// A summary is {breaking, feat} over the commits since the package's latest
// release. A kind is the role of the branch being released:
//   prerelease   alpha -> beta -> rc previews of one target stable version
//   stable       stable releases; a promoted rc becomes its stable
//   maintenance  release/x.y lines: patch only
//
// The engine never picks a channel. Every line starts and stays on alpha;
// a package moves to beta or rc only through a promotion record,
// {line: 'x.y.z', channel: 'beta' | 'rc'} (config key `x-channel`), which
// applies while the package's target is that line and expires with it.
// An open-line record, 'x.y.z' (`x-open-line`), opens that line on the
// next release when no change requires more; it is spent once reached.
//
// Every decision is {version, code, reason, warnings, blocked}. `blocked`
// lists why no version may be proposed; when it is non-empty `version` is
// undefined and the caller must not release the package.

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parse(s) {
  if (s && typeof s === 'object') return s;
  const m = String(s).match(SEMVER);
  if (!m) throw new Error(`not a semver: ${s}`);
  return {major: +m[1], minor: +m[2], patch: +m[3], pre: m[4]};
}
const fmt = v => `${v.major}.${v.minor}.${v.patch}${v.pre ? '-' + v.pre : ''}`;
const core = v => ({major: v.major, minor: v.minor, patch: v.patch});
const opt = s => (s === undefined || s === null || s === '' ? undefined : parse(s));

// Compare major.minor.patch only.
function cmpCore(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

// SemVer precedence.
function cmp(a, b) {
  const c = cmpCore(a, b);
  if (c) return c;
  if (!a.pre && !b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  const x = a.pre.split('.'), y = b.pre.split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1;
    if (y[i] === undefined) return 1;
    const nx = /^\d+$/.test(x[i]), ny = /^\d+$/.test(y[i]);
    if (nx && ny && +x[i] !== +y[i]) return +x[i] - +y[i];
    if (nx !== ny) return nx ? -1 : 1;
    if (!nx && x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}
const maxV = (a, b) => (!a ? b : !b ? a : cmp(a, b) >= 0 ? a : b);

// Channels, in promotion order. Every line opens on the first.
const CHANNELS = ['alpha', 'beta', 'rc'];
const FIRST = CHANNELS[0];
const rank = ch => CHANNELS.indexOf(ch) + 1; // 0 = not a target channel
const channelOf = pre => (pre ? pre.split('.')[0] : undefined);
const atChannel = (v, ch) => ({...core(v), pre: `${ch}.0`});

const STABLE = /^\d+\.\d+\.\d+$/;

// A promotion record, validated: {line: 'x.y.z', channel: 'beta' | 'rc'}.
function promotionOf(record) {
  if (record === undefined || record === null) return undefined;
  if (typeof record !== 'object' || Array.isArray(record) || !STABLE.test(String(record.line)) || !['beta', 'rc'].includes(record.channel)) {
    throw new Error(`x-channel ${JSON.stringify(record)}: expected {"line": "x.y.z", "channel": "beta" | "rc"}`);
  }
  return {line: parse(record.line), channel: record.channel};
}

// An open-line record, validated: 'x.y.z'.
function openLineOf(record) {
  if (record === undefined || record === null) return undefined;
  if (typeof record !== 'string' || !STABLE.test(record)) throw new Error(`x-open-line ${JSON.stringify(record)}: expected "x.y.z"`);
  return parse(record);
}

// The channel a promotion gives target T, if it is recorded for T.
const promotedOn = (promotion, T) => (promotion && cmpCore(promotion.line, T) === 0 ? promotion.channel : undefined);
const higher = (a, b) => (!a ? b : !b ? a : rank(b) > rank(a) ? b : a);

function bumpCounter(pre) {
  const m = pre.match(/^(.*?)(\d+)$/);
  return m ? `${m[1]}${+m[2] + 1}` : `${pre}.1`;
}

// The owner's bump table: pre-1.0 breaking or feat -> minor, else patch;
// from 1.0 breaking -> major, feat -> minor, else patch.
function bumpStable(base, summary) {
  if (base.major === 0) {
    return summary.breaking || summary.feat
      ? {major: 0, minor: base.minor + 1, patch: 0}
      : {major: 0, minor: base.minor, patch: base.patch + 1};
  }
  if (summary.breaking) return {major: base.major + 1, minor: 0, patch: 0};
  if (summary.feat) return {major: base.major, minor: base.minor + 1, patch: 0};
  return {major: base.major, minor: base.minor, patch: base.patch + 1};
}

// With no stable known, the smallest stable a target T can stem from: any
// bump of it at a level at or below T's own level stays at or below T.
function deriveBase(t) {
  if (t.patch > 0) return {major: t.major, minor: t.minor, patch: t.patch - 1};
  if (t.minor > 0) return {major: t.major, minor: t.minor - 1, patch: 0};
  if (t.major > 0) return {major: t.major - 1, minor: 0, patch: 0};
  return {major: 0, minor: 0, patch: 0};
}

function summarize(commits) {
  let breaking = false, feat = false;
  for (const c of commits || []) {
    if (c.breaking) breaking = true;
    else if (c.type === 'feat' || c.type === 'feature') feat = true;
  }
  return {breaking, feat};
}

function decision(version, code, reason, extra = {}) {
  return {version: version && fmt(version), code, reason, warnings: extra.warnings || [], blocked: extra.blocked || []};
}
const blocked = (code, reason) => decision(undefined, code, reason, {blocked: [reason]});

// Rule 1: prerelease branch.
function nextPrerelease(C, S, summary, promotion) {
  if (!C.pre) {
    const v = bumpStable(maxV(core(C), S), summary);
    return decision(atChannel(v, FIRST), 'open', `open ${fmt(v)} line from stable ${fmt(C)}`);
  }
  const T = core(C);
  if (S && cmpCore(T, S) <= 0) {
    const v = bumpStable(S, summary);
    return decision(atChannel(v, FIRST), 'line', `target ${fmt(T)} already released as stable: new ${fmt(v)} line`);
  }
  const req = bumpStable(S || deriveBase(T), summary);
  if (cmpCore(req, T) > 0) {
    return decision(atChannel(req, FIRST), 'line', `required ${fmt(req)} > target ${fmt(T)}: new line`);
  }
  const promoted = promotedOn(promotion, T);
  if (rank(promoted) > rank(channelOf(C.pre))) {
    return decision(atChannel(T, promoted), 'channel', `promoted to ${promoted} on ${fmt(T)}`);
  }
  return decision({...T, pre: bumpCounter(C.pre)}, 'counter', `target ${fmt(T)} covers it: counter`);
}

// Rule 1 with an open-line record: open `<line>-alpha.0` instead, when the
// line is not reached yet and no change requires more than it.
function withOpenLine(d, C, line) {
  if (!line || d.blocked.length) return d;
  const target = C.pre ? core(C) : C;
  if (cmpCore(target, line) >= 0) return d; // reached: the record is spent
  const required = core(parse(d.version));
  if (cmpCore(line, required) < 0) {
    return blocked('open-line-below', `x-open-line ${fmt(line)} is below the required target ${fmt(required)} (raise or remove it)`);
  }
  return decision(atChannel(line, FIRST), 'open-line', `x-open-line: open ${fmt(line)} line`);
}

// Rule 2: stable branch.
function nextStable(C, S, summary) {
  if (!C.pre) return decision(bumpStable(maxV(core(C), S), summary), 'bump', `stable bump from ${fmt(maxV(core(C), S))}`);
  const T = core(C);
  if (S && cmpCore(T, S) <= 0) {
    return decision(bumpStable(S, summary), 'bump', `target ${fmt(T)} already released (last stable ${fmt(S)})`);
  }
  if (channelOf(C.pre) !== 'rc') {
    return blocked('not-promoted', `${fmt(C)} is not an rc: a stable branch promotes only an rc (promote the line to rc on the prerelease branch first)`);
  }
  const req = bumpStable(S || deriveBase(T), summary);
  if (cmpCore(req, T) > 0) return decision(req, 'promote', `required ${fmt(req)} > promoted target ${fmt(T)}`);
  return decision(T, 'promote', `promote ${fmt(C)} -> ${fmt(T)}`);
}

// Rule 3: maintenance branch (release/x.y): patch only.
function nextMaintenance(C, summary, branch) {
  if (summary.breaking || summary.feat) {
    return blocked('not-patch', `${summary.breaking ? 'breaking change' : 'feat'} on maintenance branch ${branch}: patch only`);
  }
  // A package off the branch's own line still gets its patch (a monorepo
  // branch names one family's line); say so, it may collide with that
  // package's own line elsewhere.
  const warnings = [];
  const m = String(branch || '').match(/(\d+)\.(\d+|x)$/);
  if (m && (+m[1] !== C.major || (m[2] !== 'x' && +m[2] !== C.minor))) warnings.push(`${fmt(C)} is not on the ${m[1]}.${m[2]} line of ${branch}`);
  if (C.pre) {
    warnings.push(`maintenance branch ${branch} carries prerelease ${fmt(C)}`);
    return decision(core(C), 'bump', `maintenance: ${fmt(C)} -> its stable`, {warnings});
  }
  return decision({...core(C), patch: C.patch + 1}, 'bump', 'maintenance: patch', {warnings});
}

/**
 * next({kind, current, summary, lastStable, promotion, openLine, branch}) -> decision
 *   promotion  x-channel record {line, channel} | undefined
 *   openLine   x-open-line record 'x.y.z' | undefined
 * Both records are read on the prerelease branch only.
 */
function next(input) {
  const C = parse(input.current);
  const S = opt(input.lastStable);
  const summary = input.summary || {breaking: false, feat: false};
  switch (input.kind) {
    case 'prerelease':
      return withOpenLine(nextPrerelease(C, S, summary, promotionOf(input.promotion)), C, openLineOf(input.openLine));
    case 'stable': return nextStable(C, S, summary);
    case 'maintenance': return nextMaintenance(C, summary, input.branch);
    default: throw new Error(`unknown branch kind: ${input.kind}`);
  }
}

// Rule 4: does `proposed` open a line the family links on? A new major
// always (on a stable branch: against the last stable); a new minor line
// only in the prerelease phase. Never on a maintenance branch.
function startsLinkedLine({kind, current, proposed, lastStable}) {
  if (kind === 'maintenance') return false;
  const C = parse(current), V = parse(proposed), S = opt(lastStable);
  if (kind === 'stable') {
    const ref = S || (C.pre ? deriveBase(core(C)) : C);
    return V.major > ref.major;
  }
  if (V.major > C.major) return true;
  return !!V.pre && V.major === C.major && V.minor > C.minor;
}

/**
 * resolveGroup({kind, groupName, members}) -> {linked, versions?, reason, blocked}
 * members: [{component, current?, lastStable?, proposed?, promotion?}]
 * versions: {component: version}
 *
 * Linked only when a member's proposal opens a linked line. Every member
 * then moves to the group's target, the highest among the members (their
 * proposals, and any member already previewing a later unreleased target).
 * On a stable branch every member gets that stable version. On a
 * prerelease branch each member keeps its own channel (its channel on the
 * target line, or its promotion recorded for that line; alpha otherwise),
 * and the members of one channel share one counter: the highest of that
 * channel's members already on the line + 1, or .0. Nobody moves
 * backwards or changes channel. A member that already released the target
 * (or later) as stable blocks the group: no member gets a version.
 */
function resolveGroup({kind, groupName = 'group', members}) {
  const M = members.map(m => ({
    component: m.component, current: opt(m.current), lastStable: opt(m.lastStable), proposed: opt(m.proposed), promotion: promotionOf(m.promotion),
  }));
  const triggers = M.filter(m => m.proposed && m.current &&
    startsLinkedLine({kind, current: m.current, proposed: m.proposed, lastStable: m.lastStable}));
  if (!triggers.length) return {linked: false, reason: `${groupName}: no new major or prerelease minor line: independent`, blocked: []};
  const by = triggers.map(t => `${t.component}@${fmt(t.proposed)}`).join(', ');
  const L = M.reduce((a, m) => maxV(a, m.proposed), undefined);
  const fail = reason => ({linked: true, reason: `${groupName}: ${reason}`, blocked: [`${groupName}: ${reason}`]});
  const all = v => Object.fromEntries(M.map(m => [m.component, fmt(v)]));

  if (kind === 'stable') {
    const at = M.find(m => (m.current && cmp(m.current, L) >= 0) || (m.lastStable && cmp(m.lastStable, L) >= 0));
    if (at) return fail(`${at.component} is already at ${fmt(maxV(at.current, at.lastStable))} >= ${fmt(L)} (linked by ${by})`);
    return {linked: true, versions: all(L), reason: `${groupName}: linked at ${fmt(L)} by ${by}`, blocked: []};
  }

  // Highest target first: the group's proposal, or a member already
  // previewing a later (unreleased) target.
  let T = core(L);
  for (const m of M) {
    const live = m.current && m.current.pre && !(m.lastStable && cmpCore(m.lastStable, core(m.current)) >= 0);
    if (live && cmpCore(core(m.current), T) > 0) T = core(m.current);
  }
  const done = M.find(m => (m.lastStable && cmpCore(m.lastStable, T) >= 0) || (m.current && !m.current.pre && cmpCore(m.current, T) >= 0));
  if (done) return fail(`${done.component} already released ${fmt(maxV(done.lastStable, done.current && !done.current.pre ? done.current : undefined))} as stable, at or past group target ${fmt(T)}`);

  const onT = v => !!(v && v.pre && cmpCore(core(v), T) === 0);
  const channelFor = m => higher(onT(m.current) ? channelOf(m.current.pre) : FIRST, promotedOn(m.promotion, T));
  const top = {}; // channel -> highest member version on the line
  for (const m of M) if (onT(m.current)) top[channelOf(m.current.pre)] = maxV(top[channelOf(m.current.pre)], m.current);
  const versions = {};
  for (const m of M) {
    const ch = channelFor(m);
    const v = top[ch] ? {...T, pre: bumpCounter(top[ch].pre)} : atChannel(T, ch);
    if (m.current && cmp(v, m.current) <= 0) return fail(`${m.component} at ${fmt(m.current)} would move to ${fmt(v)}: never backwards`);
    versions[m.component] = fmt(v);
  }
  const distinct = [...new Set(Object.values(versions))].join(', ');
  return {linked: true, versions, reason: `${groupName}: linked on ${fmt(T)} at ${distinct} by ${by}`, blocked: []};
}

module.exports = {
  CHANNELS, parse, fmt, core, cmp, cmpCore, bumpStable, deriveBase, summarize, promotionOf, openLineOf,
  next, startsLinkedLine, resolveGroup,
};
