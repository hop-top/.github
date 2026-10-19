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

// Channels, in promotion order. A new line always opens on the first.
const CHANNELS = ['alpha', 'beta', 'rc'];
const FIRST = CHANNELS[0];
const rank = ch => CHANNELS.indexOf(ch) + 1; // 0 = not a target channel
const channelOf = pre => (pre ? pre.split('.')[0] : undefined);
const atChannel = (v, ch) => ({...core(v), pre: `${ch}.0`});

// The configured channel: `prerelease-type` alpha.0 | beta.0 | rc.0 (the
// counter digit is accepted but every channel starts at .0). Unset = alpha.
function channelFrom(prereleaseType) {
  const t = prereleaseType === undefined || prereleaseType === null || prereleaseType === '' ? `${FIRST}.0` : String(prereleaseType);
  const m = t.match(/^([a-z]+)(?:\.(\d+))?$/);
  if (!m || !rank(m[1])) {
    throw new Error(`prerelease-type '${t}' is not a target channel (expected one of ${CHANNELS.map(c => c + '.0').join(', ')})`);
  }
  return m[1];
}

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
function nextPrerelease(C, S, summary, channel) {
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
  if (rank(channel) > rank(channelOf(C.pre))) {
    return decision(atChannel(T, channel), 'channel', `channel ${channelOf(C.pre)} -> ${channel}`);
  }
  return decision({...T, pre: bumpCounter(C.pre)}, 'counter', `target ${fmt(T)} covers it: counter`);
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
 * next({kind, current, summary, lastStable, prereleaseType, branch}) -> decision
 */
function next(input) {
  const C = parse(input.current);
  const S = opt(input.lastStable);
  const summary = input.summary || {breaking: false, feat: false};
  switch (input.kind) {
    case 'prerelease': return nextPrerelease(C, S, summary, channelFrom(input.prereleaseType));
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
 * resolveGroup({kind, groupName, members}) -> {linked, version?, reason, blocked}
 * members: [{component, current?, lastStable?, proposed?}] (version strings)
 *
 * Linked only when a member's proposal opens a linked line. The group's
 * target is the highest among the members (the proposals, and any member
 * already previewing a later unreleased target). On a prerelease branch
 * the group version is the highest of `<target>-alpha.0`, the members' own
 * proposals on that target, and the highest member already on that target
 * with its counter + 1: never backwards, and the channel is never changed
 * here (a channel moves only through a member's configured channel, rule
 * 1). A member that already released the target (or later) as stable
 * blocks the group: no version is proposed for any member.
 */
function resolveGroup({kind, groupName = 'group', members}) {
  const M = members.map(m => ({component: m.component, current: opt(m.current), lastStable: opt(m.lastStable), proposed: opt(m.proposed)}));
  const triggers = M.filter(m => m.proposed && m.current &&
    startsLinkedLine({kind, current: m.current, proposed: m.proposed, lastStable: m.lastStable}));
  if (!triggers.length) return {linked: false, reason: `${groupName}: no new major or prerelease minor line: independent`, blocked: []};
  const by = triggers.map(t => `${t.component}@${fmt(t.proposed)}`).join(', ');
  const L = M.reduce((a, m) => maxV(a, m.proposed), undefined);
  const fail = reason => ({linked: true, reason: `${groupName}: ${reason}`, blocked: [`${groupName}: ${reason}`]});

  if (kind === 'stable') {
    const at = M.find(m => (m.current && cmp(m.current, L) >= 0) || (m.lastStable && cmp(m.lastStable, L) >= 0));
    if (at) return fail(`${at.component} is already at ${fmt(maxV(at.current, at.lastStable))} >= ${fmt(L)} (linked by ${by})`);
    return {linked: true, version: fmt(L), reason: `${groupName}: linked at ${fmt(L)} by ${by}`, blocked: []};
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
  let V = atChannel(T, FIRST);
  for (const m of M) if (onT(m.proposed)) V = maxV(V, m.proposed);
  const ahead = M.filter(m => onT(m.current) && cmp(m.current, atChannel(T, FIRST)) >= 0);
  if (!ahead.length) return {linked: true, version: fmt(V), reason: `${groupName}: linked at ${fmt(V)} by ${by}`, blocked: []};
  const top = ahead.reduce((a, m) => (cmp(m.current, a.current) > 0 ? m : a));
  V = maxV(V, {...T, pre: bumpCounter(top.current.pre)});
  return {linked: true, version: fmt(V), reason: `${groupName}: ${top.component} already at ${fmt(top.current)}: group at ${fmt(V)} (linked by ${by})`, blocked: []};
}

module.exports = {
  CHANNELS, parse, fmt, cmp, cmpCore, channelFrom, bumpStable, deriveBase, summarize,
  next, startsLinkedLine, resolveGroup,
};
