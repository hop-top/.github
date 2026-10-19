'use strict';
// The version rules on their own (no release-please).
const test = require('node:test');
const assert = require('node:assert/strict');
const {next, unreleased, startsLinkedLine, resolveGroup, cmp, parse, bumpStable, promotionOf, openLineOf, recordProblems} = require('../lib/rules');

const B = {breaking: true, feat: false}, F = {breaking: false, feat: true}, X = {breaking: false, feat: false};
const pre = (current, summary, lastStable, promotion, openLine) => next({kind: 'prerelease', current, summary, lastStable, promotion, openLine});
const v = d => d.version;
const promo = (line, channel) => ({line, channel});
const channelOf = s => (s.split('-')[1] || '').split('.')[0];

test('rule 1: the target covers it -> counter +1', () => {
  assert.equal(v(pre('0.5.0-alpha.26', B, '0.4.2')), '0.5.0-alpha.27');
  assert.equal(v(pre('0.5.0-alpha.26', B, undefined)), '0.5.0-alpha.27');
  assert.equal(v(pre('0.5.1-alpha.3', X, '0.5.0')), '0.5.1-alpha.4');
  assert.equal(v(pre('1.5.0-alpha.3', F, '1.4.2')), '1.5.0-alpha.4');
  assert.equal(v(pre('0.6.0-beta.2', X, '0.5.0', promo('0.6.0', 'beta'))), '0.6.0-beta.3');
  assert.equal(v(pre('2.0.0-rc.1', B, '1.9.0', promo('2.0.0', 'rc'))), '2.0.0-rc.2');
  assert.equal(pre('0.5.0-alpha.26', B, '0.4.2').code, 'counter');
  // from 1.0: a feat the current minor line covers keeps counting on its channel
  assert.equal(v(pre('1.3.0-beta.2', F, '1.2.0')), '1.3.0-beta.3');
  // no stable known: the smallest stable the target can stem from
  assert.equal(v(pre('1.0.0-alpha.0', F, undefined)), '1.0.0-alpha.1');
  assert.equal(v(pre('0.6.0-alpha.3', X, undefined)), '0.6.0-alpha.4');
});

test('rule 1: the line moves -> restarts at alpha.0, never carries the counter', () => {
  assert.equal(v(pre('0.5.1-alpha.3', B, '0.5.0')), '0.6.0-alpha.0');
  assert.equal(v(pre('0.5.1-alpha.3', B, undefined)), '0.6.0-alpha.0');
  assert.equal(v(pre('0.5.1-alpha.3', F, '0.5.0')), '0.6.0-alpha.0');
  assert.equal(v(pre('1.5.0-alpha.3', B, '1.4.2')), '2.0.0-alpha.0');
  assert.equal(v(pre('1.5.0-alpha.3', B, undefined)), '2.0.0-alpha.0');
  assert.equal(v(pre('1.6.0-beta.2', B, '1.5.0', promo('1.6.0', 'beta'))), '2.0.0-alpha.0');
  assert.equal(v(pre('0.5.1-rc.4', F, '0.5.0', promo('0.5.1', 'rc'))), '0.6.0-alpha.0');
  assert.equal(pre('0.5.1-alpha.3', B, '0.5.0').code, 'line');
  assert.equal(v(pre('1.2.1-alpha.3', F, '1.2.0')), '1.3.0-alpha.0');
  assert.equal(v(pre('0.6.1-alpha.0', F, undefined)), '0.7.0-alpha.0');
  // a promotion recorded for the line it moves to is not used on the move
  assert.equal(v(pre('0.5.1-alpha.3', F, '0.5.0', promo('0.6.0', 'beta'))), '0.6.0-alpha.0');
});

test('rule 1: from a stable manifest, or a target already released stable', () => {
  assert.equal(v(pre('0.6.0', F, '0.6.0')), '0.7.0-alpha.0');
  assert.equal(v(pre('0.6.0', X, '0.6.0')), '0.6.1-alpha.0');
  assert.equal(v(pre('1.2.0', B, '1.2.0')), '2.0.0-alpha.0');
  assert.equal(v(pre('0.6.0-rc.2', X, '0.6.0')), '0.6.1-alpha.0');
  assert.equal(v(pre('0.6.0-rc.2', F, '0.6.0')), '0.7.0-alpha.0');
  // next previews 0.6.1 while main hotfixes 0.6.1: the line moves past it
  assert.equal(v(pre('0.6.1-alpha.4', X, '0.6.1')), '0.6.2-alpha.0');
  assert.equal(pre('0.6.1-alpha.4', X, '0.6.1').code, 'line');
  assert.equal(v(pre('0.6.1-alpha.4', F, '0.6.1')), '0.7.0-alpha.0');
  assert.equal(v(pre('0.6.1-beta.1', X, '0.6.1', promo('0.6.1', 'beta'))), '0.6.2-alpha.0');
  assert.equal(v(pre('0.6.1-rc.2', X, '0.6.1', promo('0.6.1', 'rc'))), '0.6.2-alpha.0');
  // ... or to the line an open-line record names, with no other change
  assert.equal(v(pre('0.6.1-rc.2', X, '0.6.1', undefined, '0.6.2')), '0.6.2-alpha.0');
});

test('rule 1: a promotion moves its line to <channel>.0, then counts on it', () => {
  assert.equal(v(pre('0.6.0-alpha.7', X, '0.5.0', promo('0.6.0', 'beta'))), '0.6.0-beta.0');
  assert.equal(pre('0.6.0-alpha.7', X, '0.5.0', promo('0.6.0', 'beta')).code, 'channel');
  assert.equal(v(pre('0.6.0-beta.0', X, '0.5.0', promo('0.6.0', 'beta'))), '0.6.0-beta.1');
  assert.equal(v(pre('0.6.0-beta.3', X, '0.5.0', promo('0.6.0', 'rc'))), '0.6.0-rc.0');
  // a promotion and a change the line covers, in one release
  assert.equal(v(pre('0.6.0-alpha.7', B, '0.5.0', promo('0.6.0', 'beta'))), '0.6.0-beta.0');
  // never backwards: a record behind the current channel, or removed
  assert.equal(v(pre('0.6.0-rc.2', X, '0.5.0', promo('0.6.0', 'beta'))), '0.6.0-rc.3');
  assert.equal(v(pre('0.6.0-beta.3', F, '0.5.0')), '0.6.0-beta.4');
});

test('rule 1: a promotion that skips a channel is blocked', () => {
  const d = pre('0.6.0-alpha.7', X, '0.5.0', promo('0.6.0', 'rc'));
  assert.equal(d.version, undefined);
  assert.equal(d.code, 'channel-skip');
  assert.match(d.blocked[0], /x-channel rc for 0\.6\.0 skips a channel from 0\.6\.0-alpha\.7: channels move alpha -> beta -> rc/);
  // one step from where the package is: fine
  assert.equal(v(pre('0.6.0-beta.1', X, '0.5.0', promo('0.6.0', 'rc'))), '0.6.0-rc.0');
});

test('rule 1: a promotion expires with its line', () => {
  // recorded for another line: alpha
  assert.equal(v(pre('0.6.0-alpha.7', X, '0.5.0', promo('0.5.0', 'beta'))), '0.6.0-alpha.8');
  assert.equal(v(pre('0.6.0-alpha.7', X, '0.5.0', promo('0.7.0', 'beta'))), '0.6.0-alpha.8');
  // after a line move: the new line starts and stays on alpha
  assert.equal(v(pre('1.6.0-beta.2', B, '1.5.0', promo('1.6.0', 'beta'))), '2.0.0-alpha.0');
  assert.equal(v(pre('2.0.0-alpha.0', X, '1.5.0', promo('1.6.0', 'beta'))), '2.0.0-alpha.1');
  // after a stable cut
  assert.equal(v(pre('0.6.0', X, '0.6.0', promo('0.6.0', 'rc'))), '0.6.1-alpha.0');
  assert.equal(v(pre('0.6.0-rc.2', X, '0.6.0', promo('0.6.0', 'rc'))), '0.6.1-alpha.0');
});

test('rule 1: an open-line record opens <line>-alpha.0 when nothing requires more', () => {
  const d = pre('0.9.0-alpha.3', X, '0.8.0', undefined, '1.0.0');
  assert.equal(d.version, '1.0.0-alpha.0');
  assert.equal(d.code, 'open-line');
  assert.equal(v(pre('0.9.0-alpha.3', F, '0.8.0', promo('0.9.0', 'beta'), '1.0.0')), '1.0.0-alpha.0');
  assert.equal(v(pre('0.9.0', X, '0.9.0', undefined, '1.0.0')), '1.0.0-alpha.0');
  assert.equal(v(pre('1.5.0-alpha.3', B, '1.4.2', undefined, '2.0.0')), '2.0.0-alpha.0');
  assert.equal(v(pre('1.5.0-alpha.3', X, '1.4.2', undefined, '3.0.0')), '3.0.0-alpha.0');
});

test('rule 1: an open line below the required target is refused', () => {
  const d = pre('1.5.0-alpha.3', B, '1.4.2', undefined, '1.6.0');
  assert.equal(d.version, undefined);
  assert.equal(d.code, 'open-line-below');
  assert.match(d.blocked[0], /x-open-line 1\.6\.0 is below the required target 2\.0\.0/);
  assert.match(pre('0.6.0', F, '0.6.0', undefined, '0.6.1').blocked[0], /below the required target 0\.7\.0/);
});

test('rule 1: an open line is ignored once reached, and off the prerelease branch', () => {
  assert.equal(v(pre('1.0.0-alpha.2', X, '0.9.0', undefined, '1.0.0')), '1.0.0-alpha.3');
  assert.equal(v(pre('1.2.0-alpha.0', F, '1.1.0', undefined, '1.0.0')), '1.2.0-alpha.1');
  assert.equal(v(pre('1.0.0', X, '1.0.0', undefined, '1.0.0')), '1.0.1-alpha.0');
  assert.equal(next({kind: 'stable', current: '0.9.0-rc.1', summary: X, lastStable: '0.8.0', openLine: '1.0.0'}).version, '0.9.0');
  assert.equal(next({kind: 'maintenance', current: '0.9.2', summary: X, branch: 'release/0.9', openLine: '1.0.0'}).version, '0.9.3');
});

test('records are validated', () => {
  assert.deepEqual(promotionOf({line: '0.6.0', channel: 'beta'}), {line: parse('0.6.0'), channel: 'beta'});
  for (const bad of [{line: '0.6.0', channel: 'alpha'}, {line: '0.6', channel: 'beta'}, {line: '0.6.0-alpha.1', channel: 'rc'}, 'beta', []]) {
    assert.throws(() => promotionOf(bad), /x-channel/);
  }
  assert.deepEqual(openLineOf('1.0.0'), parse('1.0.0'));
  for (const bad of ['1.0', '1.0.0-alpha.0', 1]) assert.throws(() => openLineOf(bad), /x-open-line/);
  assert.throws(() => pre('0.6.0-alpha.1', X, '0.5.0', {line: '0.6.0', channel: 'gamma'}), /x-channel/);
});

test('rule 1: required target uses the owner bump table', () => {
  assert.deepEqual(bumpStable(parse('0.5.3'), B), {major: 0, minor: 6, patch: 0});
  assert.deepEqual(bumpStable(parse('0.5.3'), F), {major: 0, minor: 6, patch: 0});
  assert.deepEqual(bumpStable(parse('0.5.3'), X), {major: 0, minor: 5, patch: 4});
  assert.deepEqual(bumpStable(parse('1.5.3'), B), {major: 2, minor: 0, patch: 0});
  assert.deepEqual(bumpStable(parse('1.5.3'), F), {major: 1, minor: 6, patch: 0});
  assert.deepEqual(bumpStable(parse('1.5.3'), X), {major: 1, minor: 5, patch: 4});
});

const st = (current, summary, lastStable) => next({kind: 'stable', current, summary, lastStable});

test('rule 2: stable branch promotes an rc to its target', () => {
  assert.equal(v(st('0.6.0-rc.2', X, '0.5.0')), '0.6.0');
  assert.equal(st('0.6.0-rc.2', X, '0.5.0').code, 'promote');
  assert.equal(v(st('0.6.0-rc.2', B, '0.5.0')), '0.6.0');
  assert.equal(v(st('0.6.0-rc.0', X, undefined)), '0.6.0');
  assert.equal(v(st('2.0.0-rc.1', B, '1.9.0')), '2.0.0');
});

test('rule 2: a stable package takes fixes only (patch)', () => {
  assert.equal(v(st('0.6.0', X, '0.6.0')), '0.6.1');
  assert.equal(st('0.6.0', X, '0.6.0').code, 'bump');
  assert.equal(v(st('1.2.0', X, '1.2.0')), '1.2.1');
  assert.equal(v(st('1.2.3', X, undefined)), '1.2.4');
  // from the later of the manifest and the last stable tag
  assert.equal(v(st('0.6.0', X, '0.6.1')), '0.6.2');
});

test('rule 2: a feat or breaking change on a stable package blocks it: land it on the prerelease branch', () => {
  for (const [current, summary, change, would] of [
    ['0.6.0', F, 'feat', '0.7.0'],
    ['0.6.0', B, 'breaking change', '0.7.0'],
    ['1.2.0', F, 'feat', '1.3.0'],
    ['1.2.0', B, 'breaking change', '2.0.0'],
  ]) {
    const d = st(current, summary, current);
    assert.equal(d.version, undefined, `${current} ${change}`);
    assert.equal(d.code, 'unpreviewed');
    assert.deepEqual(d.skipped, []);
    assert.deepEqual(d.blocked, [`${change} since stable ${current} would ship ${would} unpreviewed: a stable package takes fixes only here (land it on the prerelease branch, where it opens a new line)`]);
  }
  // messages name the prerelease branch when the caller knows it
  const named = next({kind: 'stable', current: '0.6.0', summary: F, lastStable: '0.6.0', prereleaseBranch: 'next'});
  assert.match(named.blocked[0], /\(land it on next, where it opens a new line\)$/);
});

test('rule 2: an rc of a target already released blocks: re-line on the prerelease branch', () => {
  // next at 0.6.1-rc.2, main hotfixed 0.6.1, then the promotion merges
  for (const [current, summary, lastStable] of [['0.6.1-rc.2', X, '0.6.1'], ['0.6.1-rc.2', F, '0.6.1'], ['0.6.0-rc.2', X, '0.6.1'], ['0.6.0-rc.2', X, '0.6.0']]) {
    const d = st(current, summary, lastStable);
    assert.equal(d.version, undefined, current);
    assert.equal(d.code, 'rc-released');
    assert.deepEqual(d.skipped, []);
    assert.match(d.blocked[0], new RegExp(`^${current.replace(/\./g, '\\.')} previews ${current.split('-')[0].replace(/\./g, '\\.')}, already released \\(last stable ${lastStable.replace(/\./g, '\\.')}\\): re-line on the prerelease branch`));
  }
});

test('rule 2: a change that requires more than the rc previewed blocks it', () => {
  for (const [current, summary, lastStable, required] of [
    ['1.3.0-rc.1', B, '1.2.0', '2.0.0'],
    ['1.5.0-rc.1', B, '1.4.0', '2.0.0'],
    ['0.5.1-rc.0', F, '0.5.0', '0.6.0'],
    ['0.5.1-rc.0', F, undefined, '0.6.0'],
  ]) {
    const d = st(current, summary, lastStable);
    assert.equal(d.version, undefined, current);
    assert.equal(d.code, 'over-rc');
    assert.deepEqual(d.skipped, []);
    assert.match(d.blocked[0], new RegExp(`changes since ${current.replace(/\./g, '\\.')} require ${required.replace(/\./g, '\\.')} .*stable must equal what the rc previewed`));
  }
});

test('rule 2: an alpha or beta on a stable branch is skipped, not failed', () => {
  for (const [current, summary, lastStable] of [['0.6.0-beta.1', X, '0.5.0'], ['0.5.0-alpha.1', F, '0.4.0'], ['1.0.0-alpha.3', X, '0.9.0'], ['0.6.0-alpha.2', B, '0.6.0']]) {
    const d = st(current, summary, lastStable);
    assert.equal(d.version, undefined, current);
    assert.equal(d.code, 'not-rc');
    assert.deepEqual(d.blocked, [], current);
    assert.match(d.skipped[0], new RegExp(`^${current.replace(/\./g, '\\.')} is not an rc: skipped`));
  }
});

test('a package with no release yet: opened on the prerelease branch only, skipped elsewhere', () => {
  assert.equal(unreleased({kind: 'prerelease', branch: 'next'}), undefined);
  for (const [kind, branch, reason] of [
    ['stable', 'main', /^no release yet: skipped \(a stable branch cuts only an rc; release it on next, then promote it via beta to rc\)$/],
    ['maintenance', 'release/0.4', /^no release yet: skipped \(maintenance branch release\/0\.4 releases stable patches only\)$/],
  ]) {
    const d = unreleased({kind, branch, prereleaseBranch: 'next'});
    assert.equal(d.version, undefined, kind);
    assert.equal(d.code, 'unreleased');
    assert.deepEqual(d.blocked, [], kind);
    assert.equal(d.skipped.length, 1, kind);
    assert.match(d.skipped[0], reason);
  }
});

test('rule 3: maintenance branch is patch only', () => {
  const m = (current, summary, branch = 'release/0.5') => next({kind: 'maintenance', current, summary, branch});
  assert.equal(v(m('0.5.3', X)), '0.5.4');
  assert.deepEqual(m('0.5.3', X).blocked, []);
  for (const s of [F, B]) {
    const d = m('0.5.3', s);
    assert.equal(d.version, undefined);
    assert.equal(d.blocked.length, 1);
    assert.match(d.blocked[0], /patch only/);
  }
  assert.equal(v(m('0.6.0', X)), '0.6.1');
  assert.match(m('0.6.0', X).warnings[0], /not on the 0\.5 line/);
  assert.equal(v(m('1.4.2', X, 'release/1.x')), '1.4.3');
  assert.deepEqual(m('1.4.2', X, 'release/1.x').warnings, []);
  assert.match(m('2.0.0', X, 'release/1.x').warnings[0], /not on the 1\.x line/);
  assert.match(m('0.6.0', F).blocked[0], /patch only/);
});

test('rule 3: a prerelease on a maintenance branch is skipped, never made stable', () => {
  for (const [current, summary] of [['0.5.4-rc.1', X], ['0.5.4-alpha.0', F], ['0.5.4-beta.2', B]]) {
    const d = next({kind: 'maintenance', current, summary, branch: 'release/0.5'});
    assert.equal(d.version, undefined, current);
    assert.equal(d.code, 'not-stable');
    assert.deepEqual(d.blocked, []);
    assert.match(d.skipped[0], /is a prerelease: skipped \(maintenance branch release\/0\.5 releases stable patches only\)/);
  }
});

test('rule 4: which proposals open a linked line', () => {
  const L = (current, proposed, kind = 'prerelease', lastStable) => startsLinkedLine({kind, current, proposed, lastStable});
  assert.ok(L('0.5.1-alpha.3', '0.6.0-alpha.0'));
  assert.ok(L('1.5.0-alpha.3', '2.0.0-alpha.0'));
  assert.ok(L('0.6.0', '0.7.0-alpha.0'));
  assert.ok(L('0.9.0-alpha.3', '1.0.0-alpha.0'));
  assert.ok(L('1.6.0-beta.2', '2.0.0-alpha.0'));
  // from 1.0 a new minor line is independent
  assert.ok(!L('1.2.1-alpha.3', '1.3.0-alpha.0', 'prerelease', '1.2.0'));
  assert.ok(!L('1.2.0', '1.3.0-alpha.0'));
  assert.ok(!L('0.5.0-alpha.26', '0.5.0-alpha.27'));
  assert.ok(!L('0.6.0-alpha.7', '0.6.0-beta.0'));
  assert.ok(!L('0.6.0', '0.6.1-alpha.0'));
  assert.ok(L('1.9.0', '2.0.0', 'stable', '1.9.0'));
  assert.ok(L('2.0.0-rc.2', '2.0.0', 'stable', '1.9.0'));
  assert.ok(!L('0.6.0-rc.2', '0.6.0', 'stable', '0.5.0'));
  assert.ok(!L('0.6.0', '0.7.0', 'stable', '0.6.0'));
  assert.ok(!L('0.5.3', '0.5.4', 'maintenance'));
});

const group = (members, kind = 'prerelease') => resolveGroup({kind, groupName: 'kit', members});
const KIT = {component: 'kit', current: '0.5.1-alpha.3', lastStable: '0.5.0', proposed: '0.6.0-alpha.0'};

test('rule 4: independent unless a member opens a linked line', () => {
  const g = group([
    {component: 'kit', current: '0.5.0-alpha.26', proposed: '0.5.0-alpha.27'},
    {component: 'kit-py', current: '0.5.0-alpha.5', proposed: '0.5.0-alpha.6'},
    {component: 'kit-ts', current: '0.5.0-alpha.3'},
  ]);
  assert.equal(g.linked, false);
});

test('rule 4: from 1.0 a new minor line does not link', () => {
  const g = group([
    {component: 'kit', current: '1.2.1-alpha.3', lastStable: '1.2.0', proposed: '1.3.0-alpha.0'},
    {component: 'kit-py', current: '1.2.0-alpha.1', lastStable: '1.1.0', proposed: '1.2.0-alpha.2'},
  ]);
  assert.equal(g.linked, false);
  assert.match(g.reason, /independent/);
  // a new major still does
  assert.equal(group([
    {component: 'kit', current: '1.2.1-alpha.3', lastStable: '1.2.0', proposed: '2.0.0-alpha.0'},
    {component: 'kit-py', current: '1.2.0-alpha.1'},
  ]).linked, true);
});

test('rule 4: a new line moves every member, each at <target>-alpha.0 when nobody is on it', () => {
  const g = group([KIT, {component: 'kit-py', current: '0.5.0-alpha.5'}, {component: 'kit-ts', current: '0.5.0-alpha.3', proposed: '0.5.0-alpha.4'}]);
  assert.equal(g.linked, true);
  assert.deepEqual(g.versions, {kit: '0.6.0-alpha.0', 'kit-py': '0.6.0-alpha.0', 'kit-ts': '0.6.0-alpha.0'});
  // a member promoted on its old line starts the new one on alpha
  const p = group([KIT, {component: 'kit-py', current: '0.5.0-beta.2', promotion: promo('0.5.0', 'beta')}]);
  assert.deepEqual(p.versions, {kit: '0.6.0-alpha.0', 'kit-py': '0.6.0-alpha.0'});
  // a promotion recorded for the new line, by a member not on it yet, is
  // not used on the move (as for a single package): alpha.0
  const q = group([KIT, {component: 'kit-py', current: '0.5.0-alpha.5', lastStable: '0.4.0', promotion: promo('0.6.0', 'beta')}]);
  assert.deepEqual(q.versions, {kit: '0.6.0-alpha.0', 'kit-py': '0.6.0-alpha.0'});
  // a member with a breaking change on its own patch line links the
  // family; the target is the highest live line
  const r = group([
    {component: 'kit', current: '0.5.0-alpha.26'},
    {component: 'kit-py', current: '0.4.1-alpha.0', lastStable: '0.4.0', proposed: '0.5.0-alpha.0'},
  ]);
  assert.deepEqual(r.versions, {kit: '0.5.0-alpha.27', 'kit-py': '0.5.0-alpha.27'});
});

test('rule 4: members of one channel share one counter: highest on the line + 1', () => {
  assert.deepEqual(group([KIT, {component: 'kit-rs', current: '0.6.0-alpha.4'}, {component: 'kit-py', current: '0.5.0-alpha.5'}]).versions,
    {kit: '0.6.0-alpha.5', 'kit-rs': '0.6.0-alpha.5', 'kit-py': '0.6.0-alpha.5'});
  assert.deepEqual(group([KIT, {component: 'kit-rs', current: '0.6.0-alpha.0'}]).versions, {kit: '0.6.0-alpha.1', 'kit-rs': '0.6.0-alpha.1'});
  assert.deepEqual(group([KIT, {component: 'kit-rs', current: '0.6.0-alpha.4', proposed: '0.6.0-alpha.5'}, {component: 'kit-ts', current: '0.6.0-alpha.9'}]).versions,
    {kit: '0.6.0-alpha.10', 'kit-rs': '0.6.0-alpha.10', 'kit-ts': '0.6.0-alpha.10'});
});

test('rule 4: mixed channels: each member keeps its own, per-channel counters', () => {
  const g = group([
    KIT,
    {component: 'kit-rs', current: '0.6.0-alpha.4'},
    {component: 'kit-ts', current: '0.6.0-beta.2', promotion: promo('0.6.0', 'beta')},
    {component: 'kit-php', current: '0.6.0-beta.5'},
    {component: 'kit-py', current: '0.6.0-rc.1'},
  ]);
  assert.deepEqual(g.versions, {kit: '0.6.0-alpha.5', 'kit-rs': '0.6.0-alpha.5', 'kit-ts': '0.6.0-beta.6', 'kit-php': '0.6.0-beta.6', 'kit-py': '0.6.0-rc.2'});
  assert.deepEqual(g.blocked, []);
  // a promotion recorded for the target applies to that member only; the
  // alpha counter still counts the alpha.4 it leaves behind
  const p = group([KIT, {component: 'kit-rs', current: '0.6.0-alpha.4', promotion: promo('0.6.0', 'beta')}, {component: 'kit-py', current: '0.6.0-alpha.2'}]);
  assert.deepEqual(p.versions, {kit: '0.6.0-alpha.5', 'kit-rs': '0.6.0-beta.0', 'kit-py': '0.6.0-alpha.5'});
  const q = group([KIT, {component: 'kit-rs', current: '0.6.0-alpha.4', promotion: promo('0.6.0', 'beta')}, {component: 'kit-ts', current: '0.6.0-beta.2'}]);
  assert.deepEqual(q.versions, {kit: '0.6.0-alpha.5', 'kit-rs': '0.6.0-beta.3', 'kit-ts': '0.6.0-beta.3'});
});

test('rule 4: a linked release never changes any member\'s channel', () => {
  const lines = ['0.5.0-alpha.2', '0.5.0-beta.3', '0.5.0-rc.1', '0.6.0-alpha.0', '0.6.0-alpha.4', '0.6.0-beta.0', '0.6.0-beta.7', '0.6.0-rc.0', '0.6.0-rc.3', undefined];
  const promos = [undefined, promo('0.6.0', 'beta'), promo('0.6.0', 'rc'), promo('0.5.0', 'beta')];
  for (const a of lines) {
    for (const b of lines) {
      for (const pa of promos) {
        const members = [KIT, {component: 'a', current: a, promotion: pa}, {component: 'b', current: b}];
        const g = group(members);
        const rank = ch => ['alpha', 'beta', 'rc'].indexOf(ch);
        const onLine = c => !!c && c.startsWith('0.6.0-');
        // a promotion counts only for a member on its line, one step at a time
        const promoted = onLine(a) && pa && pa.line === '0.6.0' ? pa.channel : undefined;
        if (promoted && rank(promoted) > rank(channelOf(a)) + 1) {
          assert.equal(g.versions, undefined, `${a} ${JSON.stringify(pa)}`);
          assert.match(g.blocked[0], /skips a channel/);
          continue;
        }
        for (const m of members) {
          const got = g.versions[m.component];
          const own = onLine(m.current) ? channelOf(m.current) : 'alpha';
          const want = m === members[1] && promoted && rank(promoted) > rank(own) ? promoted : own;
          assert.equal(channelOf(got), want, `${m.component} ${m.current} ${JSON.stringify(m.promotion)} -> ${got}`);
          if (m.current) assert.ok(cmp(parse(got), parse(m.current)) > 0, `${m.component} ${m.current} -> ${got} moved backwards`);
        }
        // members on one channel share one version
        const byChannel = {};
        for (const ver of Object.values(g.versions)) (byChannel[channelOf(ver)] = byChannel[channelOf(ver)] || new Set()).add(ver);
        for (const set of Object.values(byChannel)) assert.equal(set.size, 1, JSON.stringify(g.versions));
      }
    }
  }
});

test('rule 4: the highest member target wins, then the same rule applies', () => {
  const g = group([KIT, {component: 'kit-rs', current: '0.7.0-alpha.2', lastStable: '0.5.0'}, {component: 'kit-ts', current: '0.6.0-beta.1'}]);
  assert.deepEqual(g.versions, {kit: '0.7.0-alpha.3', 'kit-rs': '0.7.0-alpha.3', 'kit-ts': '0.7.0-alpha.3'});
  const h = group([KIT, {component: 'kit-rs', current: '0.7.0-rc.0'}]);
  assert.deepEqual(h.versions, {kit: '0.7.0-alpha.0', 'kit-rs': '0.7.0-rc.1'});
  // a stale line (its target already released stable) does not raise the target
  const s = group([KIT, {component: 'kit-rs', current: '0.5.0-rc.3', lastStable: '0.5.0'}]);
  assert.deepEqual(s.versions, {kit: '0.6.0-alpha.0', 'kit-rs': '0.6.0-alpha.0'});
});

test('rule 4: an open line links the family', () => {
  const g = group([
    {component: 'kit', current: '0.9.0-alpha.3', lastStable: '0.8.0', proposed: '1.0.0-alpha.0'},
    {component: 'kit-ts', current: '0.9.0-beta.1', promotion: promo('0.9.0', 'beta')},
    {component: 'kit-py', current: '0.9.0-alpha.7'},
  ]);
  assert.deepEqual(g.versions, {kit: '1.0.0-alpha.0', 'kit-ts': '1.0.0-alpha.0', 'kit-py': '1.0.0-alpha.0'});
});

test('rule 4: a member that already released the target as stable blocks the group', () => {
  const g = group([KIT, {component: 'kit-php', current: '0.6.0-rc.2', lastStable: '0.6.0'}]);
  assert.equal(g.versions, undefined);
  assert.match(g.blocked[0], /kit-php already released 0\.6\.0 as stable/);
});

test('rule 4: never moves a member backwards', () => {
  const currents = ['0.6.0-alpha.0', '0.6.0-alpha.9', '0.6.0-beta.0', '0.6.0-beta.4', '0.6.0-rc.7', '0.7.0-alpha.1', '0.5.9-rc.3', '0.5.0-alpha.1'];
  for (const c of currents) {
    const g = group([KIT, {component: 'kit-rs', current: c}]);
    for (const [comp, ver] of Object.entries(g.versions)) {
      const cur = comp === 'kit' ? KIT.current : c;
      assert.ok(cmp(parse(ver), parse(cur)) > 0, `${comp} ${cur} -> ${ver}`);
    }
  }
});

test('rule 4: a promotion that skips a channel blocks the group', () => {
  const g = group([KIT, {component: 'kit-rs', current: '0.6.0-alpha.4', promotion: promo('0.6.0', 'rc')}]);
  assert.equal(g.versions, undefined);
  assert.match(g.blocked[0], /kit-rs x-channel rc for 0\.6\.0 skips a channel from 0\.6\.0-alpha\.4/);
});

test('rule 4: a stable-branch major links, only when every member is at an rc of it', () => {
  const g = group([
    {component: 'kit', current: '2.0.0-rc.3', lastStable: '1.9.0', proposed: '2.0.0'},
    {component: 'kit-ts', current: '2.0.0-rc.1', lastStable: '1.9.0', proposed: '2.0.0'},
    {component: 'kit-php', current: '2.0.0-rc.0', lastStable: '1.9.0'},
  ], 'stable');
  assert.deepEqual(g.versions, {kit: '2.0.0', 'kit-ts': '2.0.0', 'kit-php': '2.0.0'});
  // never stable from an alpha, a beta, a stable that previewed nothing, or no release
  for (const [cur, shown] of [['1.0.0-alpha.3', '1.0.0-alpha.3'], ['1.0.0-beta.1', '1.0.0-beta.1'], ['0.9.0', '0.9.0'], ['0.9.1-rc.0', '0.9.1-rc.0'], [undefined, 'no release']]) {
    const h = group([
      {component: 'kit', current: '1.0.0-rc.1', lastStable: '0.9.0', proposed: '1.0.0'},
      {component: 'kit-py', current: cur, lastStable: '0.9.0'},
    ], 'stable');
    assert.equal(h.versions, undefined, String(cur));
    assert.match(h.blocked[0], new RegExp(`kit: linked at 1\\.0\\.0 by kit@1\\.0\\.0, but kit-py is at ${shown.replace(/\./g, '\\.')}: a linked release is cut only when every member is at an rc of 1\\.0\\.0`));
  }
  // the way to an rc, per member: from alpha via beta, from beta one step, off the line to it first
  const how = members => group([{component: 'kit', current: '1.0.0-rc.1', lastStable: '0.9.0', proposed: '1.0.0'}, ...members], 'stable').blocked[0];
  assert.match(how([{component: 'kit-py', current: '1.0.0-alpha.3'}]), /\(promote kit-py via beta to rc on the prerelease branch first\)$/);
  assert.match(how([{component: 'kit-py', current: '1.0.0-beta.1'}]), /\(promote kit-py to rc on the prerelease branch first\)$/);
  assert.match(how([{component: 'kit-php', current: '1.0.0-alpha.0'}, {component: 'kit-rs', current: '1.0.0-alpha.2'}, {component: 'kit-py', current: '1.0.0-beta.1'}, {component: 'kit-ts', current: '0.9.0'}]),
    /\(promote kit-php, kit-rs via beta to rc and kit-py to rc and kit-ts to an rc of 1\.0\.0 on the prerelease branch first\)$/);
  assert.match(resolveGroup({kind: 'stable', groupName: 'kit', prereleaseBranch: 'next', members: [{component: 'kit', current: '1.0.0-rc.1', lastStable: '0.9.0', proposed: '1.0.0'}, {component: 'kit-py', current: '1.0.0-alpha.3'}]}).blocked[0],
    /\(promote kit-py via beta to rc on next first\)$/);
  const b = group([
    {component: 'kit', current: '2.0.0-rc.3', lastStable: '1.9.0', proposed: '2.0.0'},
    {component: 'kit-ts', current: '2.0.0', lastStable: '2.0.0'},
  ], 'stable');
  assert.equal(b.versions, undefined);
  assert.match(b.blocked[0], /kit-ts is already at 2\.0\.0/);
  assert.equal(group([{component: 'kit', current: '0.6.0-rc.2', lastStable: '0.5.0', proposed: '0.6.0'}], 'stable').linked, false);
});

test('rule 4: different targets and last stables: the highest live line wins', () => {
  const g = group([
    {component: 'kit', current: '0.9.0-alpha.3', lastStable: '0.8.0', proposed: '1.0.0-alpha.0'},
    {component: 'kit-py', current: '0.7.0-beta.1', lastStable: '0.6.0'},
    {component: 'kit-rs', current: '1.0.0-alpha.4'},
  ]);
  assert.deepEqual(g.versions, {kit: '1.0.0-alpha.5', 'kit-py': '1.0.0-alpha.5', 'kit-rs': '1.0.0-alpha.5'});
  const h = group([
    {component: 'kit', current: '0.6.0-alpha.3', lastStable: '0.5.0', proposed: '0.6.0-alpha.4'},
    {component: 'kit-py', current: '0.3.3-alpha.1', lastStable: '0.3.2', proposed: '0.4.0-alpha.0'},
  ]);
  assert.deepEqual(h.versions, {kit: '0.6.0-alpha.4', 'kit-py': '0.6.0-alpha.4'});
  // a member stable past the target blocks too
  const b = group([KIT, {component: 'kit-py', current: '0.7.0', lastStable: '0.7.0'}]);
  assert.match(b.blocked[0], /kit-py already released 0\.7\.0 as stable/);
});

test('records against the manifest (the runner\'s and the preflight\'s check)', () => {
  const R = (current, promotion, openLine) => recordProblems({current, promotion, openLine});
  assert.deepEqual(R('0.5.0-alpha.3', promo('0.5.0', 'beta')), []);
  assert.deepEqual(R('0.5.0-beta.2', promo('0.5.0', 'beta')), []);
  assert.deepEqual(R('0.5.0-beta.4', promo('0.5.0', 'rc'), '1.0.0'), []);
  assert.deepEqual(R('0.9.0-alpha.3', undefined, '1.0.0'), []);
  assert.deepEqual(R('0.5.0-alpha.3'), []);
  assert.deepEqual(R('0.5.0-alpha.3', promo('0.4.0', 'beta')), ['x-channel is for line 0.4.0, but its current target is 0.5.0 (manifest 0.5.0-alpha.3)']);
  assert.deepEqual(R('0.5.1-alpha.3', promo('0.6.0', 'beta')), ['x-channel is for line 0.6.0, but its current target is 0.5.1 (manifest 0.5.1-alpha.3)']);
  assert.deepEqual(R('0.5.0', promo('0.5.0', 'beta')), ["x-channel is for line 0.5.0, but the manifest has stable '0.5.0': no open line to promote"]);
  assert.deepEqual(R(undefined, promo('0.5.0', 'beta')), ["x-channel is for line 0.5.0, but the manifest has stable 'none': no open line to promote"]);
  assert.deepEqual(R('0.5.0-alpha.3', promo('0.5.0', 'rc')), ['x-channel rc skips a channel from 0.5.0-alpha.3: channels move alpha -> beta -> rc']);
  assert.deepEqual(R('0.5.0-rc.1', promo('0.5.0', 'beta')), ['x-channel beta is behind its current 0.5.0-rc.1: channels never move backwards']);
  assert.deepEqual(R('1.0.0-alpha.2', undefined, '1.0.0'), ['x-open-line 1.0.0 is already reached (manifest 1.0.0-alpha.2)']);
  assert.deepEqual(R('1.0.0', undefined, '1.0.0'), ['x-open-line 1.0.0 is already reached (manifest 1.0.0)']);
  assert.throws(() => R('0.5.0-alpha.3', {line: '0.5.0', channel: 'alpha'}), /x-channel/);
});

test('semver precedence', () => {
  assert.ok(cmp(parse('0.6.0-alpha.10'), parse('0.6.0-alpha.9')) > 0);
  assert.ok(cmp(parse('0.6.0-rc.0'), parse('0.6.0-beta.9')) > 0);
  assert.ok(cmp(parse('0.6.0'), parse('0.6.0-rc.9')) > 0);
  assert.ok(cmp(parse('v1.0.0'), parse('0.9.9')) > 0);
});
