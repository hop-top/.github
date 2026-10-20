'use strict';
// Target versioning: the version rules, with no release-please import so
// they unit-test on their own.
//
// A version is {major, minor, patch, pre} (pre: "alpha.26" | undefined).
// A summary is {breaking, feat} over the commits since the package's latest
// release. A kind is the role of the branch being released:
//   prerelease   alpha -> beta -> rc previews of one target stable version
//   stable       stable releases; a promoted rc becomes its stable, a
//                package already stable takes fixes only (patch)
//   maintenance  release/x.y lines: patch only
//
// The engine never picks a channel. Every line starts and stays on alpha;
// a package moves to beta or rc only through a promotion record,
// {line: 'x.y.z', channel: 'beta' | 'rc'} (config key `x-channel`), one
// channel at a time, which applies while the package is on that line and
// expires with it. An open-line record, 'x.y.z' (`x-open-line`), opens
// that line when no change requires more; it is spent once reached. Both
// are read on the prerelease branch only, where the plugin cuts their
// release with no other change.
//
// Every decision is {version, code, reason, warnings, blocked, skipped}.
// `blocked` lists why no version may be proposed (the run fails);
// `skipped` why this branch releases nothing for the package (a notice,
// the run stays green). When either is non-empty `version` is undefined
// and the caller must not release the package.

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
const ONE = {major: 1, minor: 0, patch: 0};

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
  return {version: version && fmt(version), code, reason, warnings: extra.warnings || [], blocked: extra.blocked || [], skipped: extra.skipped || []};
}
const blocked = (code, reason) => decision(undefined, code, reason, {blocked: [reason]});
const skipped = (code, reason) => decision(undefined, code, reason, {skipped: [reason]});

// A promotion moves one channel at a time.
const skipsChannel = (promoted, own) => !!promoted && rank(promoted) > rank(own) + 1;
const SKIP_HINT = 'channels move alpha -> beta -> rc';

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
  if (skipsChannel(promoted, channelOf(C.pre))) {
    return blocked('channel-skip', `x-channel ${promoted} for ${fmt(T)} skips a channel from ${fmt(C)}: ${SKIP_HINT}`);
  }
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

// Rule 2: stable branch. Nothing ships that no prerelease previewed. An
// rc is cut at the target it previewed, unless that target is already
// released; an alpha or beta (an experimental package still on the
// prerelease track) is skipped. A package already stable takes fixes
// only: x.y.(z+1); a feat or breaking change goes through the prerelease
// branch. `on` names the prerelease branch in messages.
function nextStable(C, S, summary, on) {
  if (!C.pre) {
    const base = maxV(core(C), S);
    if (summary.breaking || summary.feat) {
      return blocked('unpreviewed', `${summary.breaking ? 'breaking change' : 'feat'} since stable ${fmt(base)} would ship ${fmt(bumpStable(base, summary))} unpreviewed: a stable package takes fixes only here (land it on ${on}, where it opens a new line)`);
    }
    return decision({...base, patch: base.patch + 1}, 'bump', `stable patch from ${fmt(base)}`);
  }
  const T = core(C);
  if (channelOf(C.pre) !== 'rc') {
    return skipped('not-rc', `${fmt(C)} is not an rc: skipped (a stable branch cuts only an rc; promote the line to rc on ${on} to release it here)`);
  }
  if (S && cmpCore(T, S) <= 0) {
    return blocked('rc-released', `${fmt(C)} previews ${fmt(T)}, already released (last stable ${fmt(S)}): re-line on ${on} (a change there, or x-open-line, opens the next line) and promote that line via beta to rc`);
  }
  const req = bumpStable(S || deriveBase(T), summary);
  if (cmpCore(req, T) > 0) {
    return blocked('over-rc', `changes since ${fmt(C)} require ${fmt(req)} (from ${S ? `stable ${fmt(S)}` : 'no stable'}), more than the ${fmt(T)} it previews: stable must equal what the rc previewed (land the change on ${on}, where it opens a new line)`);
  }
  return decision(T, 'promote', `promote ${fmt(C)} -> ${fmt(T)}`);
}

// Rule 3: maintenance branch (release/x.y): stable patches only. A
// prerelease there is skipped, never turned into its stable.
function nextMaintenance(C, summary, branch) {
  if (C.pre) {
    return skipped('not-stable', `${fmt(C)} is a prerelease: skipped (maintenance branch ${branch} releases stable patches only)`);
  }
  if (summary.breaking || summary.feat) {
    return blocked('not-patch', `${summary.breaking ? 'breaking change' : 'feat'} on maintenance branch ${branch}: patch only`);
  }
  // A package off the branch's own line still gets its patch (a monorepo
  // branch names one family's line); say so, it may collide with that
  // package's own line elsewhere.
  const warnings = [];
  const m = String(branch || '').match(/(\d+)\.(\d+|x)$/);
  if (m && (+m[1] !== C.major || (m[2] !== 'x' && +m[2] !== C.minor))) warnings.push(`${fmt(C)} is not on the ${m[1]}.${m[2]} line of ${branch}`);
  return decision({...core(C), patch: C.patch + 1}, 'bump', 'maintenance: patch', {warnings});
}

// The prerelease branch, as messages name it.
const onPrerelease = name => name || 'the prerelease branch';

/**
 * unreleased({kind, branch, prereleaseBranch}) -> decision | undefined
 * A package with no release yet (no manifest entry, no tag). The
 * prerelease branch opens it at its initial-version, release-please's
 * own (undefined: no rule applies). A stable or maintenance branch skips
 * it: nothing ships there that no prerelease previewed.
 */
function unreleased({kind, branch, prereleaseBranch}) {
  if (kind === 'stable') {
    return skipped('unreleased', `no release yet: skipped (a stable branch cuts only an rc; release it on ${onPrerelease(prereleaseBranch)}, then promote it via beta to rc)`);
  }
  if (kind === 'maintenance') {
    return skipped('unreleased', `no release yet: skipped (maintenance branch ${branch} releases stable patches only)`);
  }
  return undefined;
}

/**
 * next({kind, current, summary, lastStable, promotion, openLine, branch, prereleaseBranch}) -> decision
 *   promotion         x-channel record {line, channel} | undefined
 *   openLine          x-open-line record 'x.y.z' | undefined
 *   prereleaseBranch  its name, for messages (default: "the prerelease branch")
 * Both records are read on the prerelease branch only.
 */
function next(input) {
  const C = parse(input.current);
  const S = opt(input.lastStable);
  const summary = input.summary || {breaking: false, feat: false};
  switch (input.kind) {
    case 'prerelease':
      return withOpenLine(nextPrerelease(C, S, summary, promotionOf(input.promotion)), C, openLineOf(input.openLine));
    case 'stable': return nextStable(C, S, summary, onPrerelease(input.prereleaseBranch));
    case 'maintenance': return nextMaintenance(C, summary, input.branch);
    default: throw new Error(`unknown branch kind: ${input.kind}`);
  }
}

// Rule 4: does `proposed` open a line the family links on? A new major
// always; a new minor line only before 1.0 (major 0). From 1.0 minors
// are independent, and a patch never links. On a stable branch the cut
// is measured against the last stable (with none, the smallest stable
// the rc can stem from): a major above its major, or before 1.0 a minor
// above its minor, whatever its patch (x-open-line 0.6.1 from 0.5.0
// links, as on the prerelease branch). Never on a maintenance branch.
function startsLinkedLine({kind, current, proposed, lastStable}) {
  if (kind === 'maintenance') return false;
  const C = parse(current), V = parse(proposed), S = opt(lastStable);
  if (kind === 'stable') {
    const ref = S || (C.pre ? deriveBase(core(C)) : C);
    if (V.major > ref.major) return true;
    return V.major === 0 && ref.major === 0 && V.minor > ref.minor;
  }
  if (V.major > C.major) return true;
  return V.major === 0 && C.major === 0 && V.minor > C.minor;
}

// How the members not at an rc of L get there, as one instruction: on
// L's line one channel at a time (alpha via beta); off it, to the line
// first.
function toRc(members, L) {
  const path = m => (!m.current || !m.current.pre || cmpCore(core(m.current), L) !== 0 ? `to an rc of ${fmt(L)}`
    : channelOf(m.current.pre) === 'alpha' ? 'via beta to rc' : 'to rc');
  const by = new Map();
  for (const m of members) by.set(path(m), [...(by.get(path(m)) || []), m.component]);
  return `promote ${[...by].map(([p, cs]) => `${cs.join(', ')} ${p}`).join(' and ')}`;
}

/**
 * resolveGroup({kind, groupName, members, prereleaseBranch}) -> {linked, versions?, reason, blocked, blockedMembers}
 * members: [{component, current?, lastStable?, proposed?, promotion?}]
 *   (no current: no release yet; proposed is then its first release)
 * versions: {component: version}
 * blockedMembers: {component: reason}, members blocked on their own while
 *   the group is independent (the others release)
 *
 * Linked only when a member's proposal opens a linked line. Every member
 * then moves to the group's target: the highest proposal of the members
 * that open the linked line, or, on a prerelease branch, a later linked
 * line a member already previews (unreleased). A member's own patch,
 * proposed or previewed, never raises it. On a stable branch every
 * member gets that stable version, and every
 * member must be at an rc of it: one member still on alpha or beta (or
 * on no rc of the target), experimental ones included, blocks the
 * group, it never ships stable from anything but an rc. On a prerelease
 * branch each member keeps its own channel: a member already on the
 * target line keeps its channel there, or takes its promotion recorded
 * for that line (one step); any other member starts the line on alpha.
 * The members of one channel share one
 * counter: the highest of that channel's members already on the line + 1,
 * or .0 (a promoted member's last alpha still counts for the alpha
 * members). Nobody moves backwards or changes channel. A member that
 * already released the target (or later) as stable, or is already on a
 * later line, blocks the group: no member gets a version.
 *
 * 1.0 opens only through x-open-line. While the family is before 1.0
 * (any member's stable or line at 0.x), a member's first release never
 * raises the target (it takes the group's version when the group links)
 * and, independent, is blocked at or past 1.0.0; a member with no stable
 * on a line from 1.0 (its initial version) neither links the family nor
 * raises its target, and its stable cut, independent, is blocked.
 */
function resolveGroup({kind, groupName = 'group', members, prereleaseBranch}) {
  const M = members.map(m => ({
    component: m.component, current: opt(m.current), lastStable: opt(m.lastStable), proposed: opt(m.proposed), promotion: promotionOf(m.promotion),
  }));
  const on = onPrerelease(prereleaseBranch);
  const stableOf = m => maxV(m.lastStable, m.current && !m.current.pre ? m.current : undefined);
  // The family is before 1.0 while any member's stable or line is: at the
  // highest such line.
  const familyLine = M.reduce((a, m) => (m.current && m.current.major === 0 ? maxV(a, core(m.current)) : a), undefined);
  // A member with no stable on a line from 1.0 in a family before 1.0 has
  // that line from its initial version (config): a change or x-open-line
  // opening 1.0 links the family. It never links the family nor raises
  // its target.
  const fromInitial = m => !!familyLine && !stableOf(m) && !!(m.current && m.current.pre) && m.current.major >= 1;
  // The released members below `line`: x-open-line `line` on them links
  // the family at it.
  const below = (line, except) => M.filter(x => x !== except && x.current && cmpCore(x.current, line) < 0).map(x => x.component).join(', ');
  const triggers = M.filter(m => m.proposed && m.current && !fromInitial(m) &&
    startsLinkedLine({kind, current: m.current, proposed: m.proposed, lastStable: m.lastStable}));
  if (!triggers.length) {
    // Independent, but no member's own release opens 1.0 for a family
    // before 1.0: a first release (its initial version) at or past 1.0.0,
    // or the stable cut of a line from 1.0 its initial version opened.
    // That member alone is blocked.
    const blockedMembers = {};
    for (const m of M) {
      if (!familyLine || !m.proposed) continue;
      if (!m.current && m.proposed.major >= 1) {
        blockedMembers[m.component] = `${groupName}: ${m.component} has no release yet and its first release would be ${fmt(m.proposed)}, but the family is before 1.0 (at ${fmt(familyLine)}): set its initial-version to ${fmt(familyLine)}-alpha.0, the family's line, or open 1.0.0 for ${below(ONE, m)} with x-open-line on ${on}`;
      } else if (kind === 'stable' && fromInitial(m)) {
        blockedMembers[m.component] = `${groupName}: ${m.component} has no stable and would cut ${fmt(m.proposed)} from ${fmt(m.current)}, a line from 1.0 its initial version opened, but the family is before 1.0 (at ${fmt(familyLine)}): 1.0 opens for the family only through x-open-line (open ${fmt(core(m.current))} for ${below(core(m.current), m)} with x-open-line on ${on})`;
      }
    }
    return {linked: false, reason: `${groupName}: no new major or pre-1.0 minor line: independent`, blocked: [], blockedMembers};
  }
  const by = triggers.map(t => `${t.component}@${fmt(t.proposed)}`).join(', ');
  const fail = reason => ({linked: true, reason: `${groupName}: ${reason}`, blocked: [`${groupName}: ${reason}`], blockedMembers: {}});
  const all = v => Object.fromEntries(M.map(m => [m.component, fmt(v)]));
  // A member already on a later line than target T: it never moves back,
  // so the family links at its line or later only, which x-open-line on
  // the members below that line opens.
  const pastTarget = (m, T) => {
    const line = core(m.current);
    return fail(`${m.component} is already at ${fmt(m.current)}, past group target ${fmt(T)} (linked by ${by}), and a member never moves backwards: open ${fmt(line)} for ${below(line, m)} with x-open-line on ${on} so the family links at ${m.component}'s line`);
  };

  if (kind === 'stable') {
    // The target is what the linking members cut: another member's own
    // proposal (a patch of a member already stable) never raises it.
    const L = triggers.reduce((a, m) => maxV(a, m.proposed), undefined);
    const done = M.find(m => stableOf(m) && cmp(stableOf(m), L) >= 0);
    if (done) return fail(`${done.component} already released ${fmt(stableOf(done))} as stable, at or past group target ${fmt(L)} (linked by ${by})`);
    const at = M.find(m => m.current && cmp(m.current, L) >= 0);
    if (at) return pastTarget(at, L);
    const notRc = M.filter(m => !(m.current && channelOf(m.current.pre) === 'rc' && cmpCore(core(m.current), L) === 0));
    if (notRc.length) {
      const where = notRc.map(m => `${m.component} is at ${m.current ? fmt(m.current) : 'no release'}`).join(', ');
      return fail(`linked at ${fmt(L)} by ${by}, but ${where}: a linked release is cut only when every member is at an rc of ${fmt(L)} (${toRc(notRc, L)} on ${on} first)`);
    }
    return {linked: true, versions: all(L), reason: `${groupName}: linked at ${fmt(L)} by ${by}`, blocked: [], blockedMembers: {}};
  }

  // Highest linked line first: what the linking members open, or a later
  // line a member already previews (unreleased) that links as the stable
  // branch would cut it. A member's own patch, proposed or previewed,
  // never raises it, nor a line from 1.0 a member's initial version opened.
  const previewsLinkedLine = m => !fromInitial(m) && !!(m.current && m.current.pre) && !(m.lastStable && cmpCore(m.lastStable, core(m.current)) >= 0) &&
    startsLinkedLine({kind: 'stable', current: m.current, proposed: core(m.current), lastStable: m.lastStable});
  let T = core(triggers.reduce((a, m) => maxV(a, m.proposed), undefined));
  for (const m of M) {
    if (previewsLinkedLine(m) && cmpCore(core(m.current), T) > 0) T = core(m.current);
  }
  const done = M.find(m => (m.lastStable && cmpCore(m.lastStable, T) >= 0) || (m.current && !m.current.pre && cmpCore(m.current, T) >= 0));
  if (done) return fail(`${done.component} already released ${fmt(maxV(done.lastStable, done.current && !done.current.pre ? done.current : undefined))} as stable, at or past group target ${fmt(T)} (linked by ${by})`);

  const onT = v => !!(v && v.pre && cmpCore(core(v), T) === 0);
  // A promotion counts only for a member already on its line.
  const channelFor = m => (onT(m.current) ? higher(channelOf(m.current.pre), promotedOn(m.promotion, T)) : FIRST);
  const skip = M.find(m => onT(m.current) && skipsChannel(promotedOn(m.promotion, T), channelOf(m.current.pre)));
  if (skip) return fail(`${skip.component} x-channel ${promotedOn(skip.promotion, T)} for ${fmt(T)} skips a channel from ${fmt(skip.current)}: ${SKIP_HINT}`);
  const top = {}; // channel -> highest member version on the line
  for (const m of M) if (onT(m.current)) top[channelOf(m.current.pre)] = maxV(top[channelOf(m.current.pre)], m.current);
  const versions = {};
  for (const m of M) {
    const ch = channelFor(m);
    const v = top[ch] ? {...T, pre: bumpCounter(top[ch].pre)} : atChannel(T, ch);
    if (m.current && cmp(v, m.current) <= 0) return pastTarget(m, T);
    versions[m.component] = fmt(v);
  }
  const distinct = [...new Set(Object.values(versions))].join(', ');
  return {linked: true, versions, reason: `${groupName}: linked on ${fmt(T)} at ${distinct} by ${by}`, blocked: [], blockedMembers: {}};
}

/**
 * recordProblems({current, promotion, openLine}) -> [string]
 * The records of a package against its manifest version, on the
 * prerelease branch (the runner refuses them, as the preflight does): a
 * promotion names the current line and its current or next channel; an
 * open line is not reached yet. Elsewhere the records are inert. Shapes
 * are promotionOf's / openLineOf's (they throw).
 */
function recordProblems({current, promotion, openLine}) {
  const out = [];
  const C = opt(current);
  const P = promotionOf(promotion);
  if (P) {
    const own = C && channelOf(C.pre);
    if (!C || !C.pre) out.push(`x-channel is for line ${fmt(P.line)}, but the manifest has stable '${C ? fmt(C) : 'none'}': no open line to promote`);
    else if (cmpCore(P.line, C) !== 0) out.push(`x-channel is for line ${fmt(P.line)}, but its current target is ${fmt(core(C))} (manifest ${fmt(C)})`);
    else if (rank(P.channel) < rank(own)) out.push(`x-channel ${P.channel} is behind its current ${fmt(C)}: channels never move backwards`);
    else if (skipsChannel(P.channel, own)) out.push(`x-channel ${P.channel} skips a channel from ${fmt(C)}: ${SKIP_HINT}`);
  }
  const O = openLineOf(openLine);
  if (O && C && cmpCore(C, O) >= 0) out.push(`x-open-line ${fmt(O)} is already reached (manifest ${fmt(C)})`);
  return out;
}

module.exports = {
  CHANNELS, parse, fmt, core, cmp, cmpCore, bumpStable, deriveBase, summarize, promotionOf, openLineOf,
  next, unreleased, startsLinkedLine, resolveGroup, recordProblems,
};
