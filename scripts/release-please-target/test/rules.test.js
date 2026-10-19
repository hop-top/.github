'use strict';
// The version rules on their own (no release-please).
const test = require('node:test');
const assert = require('node:assert/strict');
const {next, startsLinkedLine, resolveGroup, cmp, parse, channelFrom, bumpStable} = require('../lib/rules');

const B = {breaking: true, feat: false}, F = {breaking: false, feat: true}, X = {breaking: false, feat: false};
const pre = (current, summary, lastStable, prereleaseType = 'alpha.0') => next({kind: 'prerelease', current, summary, lastStable, prereleaseType});
const v = d => d.version;

test('rule 1: the target covers it -> counter +1', () => {
  assert.equal(v(pre('0.5.0-alpha.26', B, '0.4.2')), '0.5.0-alpha.27');
  assert.equal(v(pre('0.5.0-alpha.26', B, undefined)), '0.5.0-alpha.27');
  assert.equal(v(pre('0.5.1-alpha.3', X, '0.5.0')), '0.5.1-alpha.4');
  assert.equal(v(pre('1.5.0-alpha.3', F, '1.4.2')), '1.5.0-alpha.4');
  assert.equal(v(pre('0.6.0-beta.2', X, '0.5.0', 'beta.0')), '0.6.0-beta.3');
  assert.equal(v(pre('2.0.0-rc.1', B, '1.9.0', 'rc.0')), '2.0.0-rc.2');
  assert.equal(pre('0.5.0-alpha.26', B, '0.4.2').code, 'counter');
});

test('rule 1: the line moves -> restarts at alpha.0, never carries the counter', () => {
  assert.equal(v(pre('0.5.1-alpha.3', B, '0.5.0')), '0.6.0-alpha.0');
  assert.equal(v(pre('0.5.1-alpha.3', B, undefined)), '0.6.0-alpha.0');
  assert.equal(v(pre('0.5.1-alpha.3', F, '0.5.0')), '0.6.0-alpha.0');
  assert.equal(v(pre('1.5.0-alpha.3', B, '1.4.2')), '2.0.0-alpha.0');
  assert.equal(v(pre('1.5.0-alpha.3', B, undefined)), '2.0.0-alpha.0');
  // alpha.0 always, whatever channel the config is on
  assert.equal(v(pre('1.6.0-beta.2', B, '1.5.0', 'beta.0')), '2.0.0-alpha.0');
  assert.equal(v(pre('0.5.1-rc.4', F, '0.5.0', 'rc.0')), '0.6.0-alpha.0');
  assert.equal(pre('0.5.1-alpha.3', B, '0.5.0').code, 'line');
});

test('rule 1: from a stable manifest, or a target already released stable', () => {
  assert.equal(v(pre('0.6.0', F, '0.6.0')), '0.7.0-alpha.0');
  assert.equal(v(pre('0.6.0', X, '0.6.0')), '0.6.1-alpha.0');
  assert.equal(v(pre('1.2.0', B, '1.2.0')), '2.0.0-alpha.0');
  assert.equal(v(pre('1.2.0', X, undefined, 'beta.0')), '1.2.1-alpha.0');
  assert.equal(v(pre('0.6.0-rc.2', X, '0.6.0')), '0.6.1-alpha.0');
  assert.equal(v(pre('0.6.0-rc.2', F, '0.6.0')), '0.7.0-alpha.0');
});

test('rule 1: a config channel change moves to <channel>.0, never backwards', () => {
  assert.equal(v(pre('0.6.0-alpha.7', X, '0.5.0', 'beta.0')), '0.6.0-beta.0');
  assert.equal(v(pre('0.6.0-beta.3', X, '0.5.0', 'rc.0')), '0.6.0-rc.0');
  assert.equal(v(pre('0.6.0-alpha.7', X, '0.5.0', 'rc.0')), '0.6.0-rc.0');
  assert.equal(pre('0.6.0-alpha.7', X, '0.5.0', 'beta.0').code, 'channel');
  assert.equal(v(pre('0.6.0-rc.2', X, '0.5.0', 'alpha.0')), '0.6.0-rc.3');
  assert.equal(v(pre('0.6.0-beta.1', F, '0.5.0', 'alpha.0')), '0.6.0-beta.2');
});

test('rule 1: required target uses the owner bump table', () => {
  assert.deepEqual(bumpStable(parse('0.5.3'), B), {major: 0, minor: 6, patch: 0});
  assert.deepEqual(bumpStable(parse('0.5.3'), F), {major: 0, minor: 6, patch: 0});
  assert.deepEqual(bumpStable(parse('0.5.3'), X), {major: 0, minor: 5, patch: 4});
  assert.deepEqual(bumpStable(parse('1.5.3'), B), {major: 2, minor: 0, patch: 0});
  assert.deepEqual(bumpStable(parse('1.5.3'), F), {major: 1, minor: 6, patch: 0});
  assert.deepEqual(bumpStable(parse('1.5.3'), X), {major: 1, minor: 5, patch: 4});
});

test('prerelease-type must name a target channel', () => {
  assert.equal(channelFrom(undefined), 'alpha');
  assert.equal(channelFrom('beta.0'), 'beta');
  assert.equal(channelFrom('rc'), 'rc');
  assert.throws(() => channelFrom('dev.0'), /not a target channel/);
  assert.throws(() => pre('0.1.0-alpha.0', X, undefined, 'preview'), /not a target channel/);
});

test('rule 2: stable branch promotes an rc to its target', () => {
  const st = (current, summary, lastStable) => next({kind: 'stable', current, summary, lastStable});
  assert.equal(v(st('0.6.0-rc.2', X, '0.5.0')), '0.6.0');
  assert.equal(st('0.6.0-rc.2', X, '0.5.0').code, 'promote');
  assert.equal(v(st('0.6.0-rc.2', B, '0.5.0')), '0.6.0'); // pre-1.0 breaking: minor, covered
  assert.equal(v(st('0.6.0-rc.0', X, undefined)), '0.6.0');
  // guard: x.y.z >= required vs the previous stable
  assert.equal(v(st('0.5.1-rc.0', F, '0.5.0')), '0.6.0');
  assert.equal(v(st('1.5.0-rc.1', B, '1.4.0')), '2.0.0');
  // target already released: plain stable bump
  assert.equal(v(st('0.6.0-rc.2', X, '0.6.0')), '0.6.1');
  assert.equal(st('0.6.0-rc.2', X, '0.6.0').code, 'bump');
  assert.equal(v(st('0.6.0', X, '0.6.0')), '0.6.1');
  assert.equal(v(st('0.6.0', F, '0.6.0')), '0.7.0');
  assert.equal(v(st('1.6.0', B, '1.6.0')), '2.0.0');
});

test('rule 2: a stable branch never promotes an alpha or beta', () => {
  const d = next({kind: 'stable', current: '0.6.0-beta.1', summary: X, lastStable: '0.5.0'});
  assert.equal(d.version, undefined);
  assert.equal(d.code, 'not-promoted');
  assert.match(d.blocked[0], /0\.6\.0-beta\.1 is not an rc/);
  assert.equal(next({kind: 'stable', current: '0.5.0-alpha.1', summary: F, lastStable: '0.4.0'}).version, undefined);
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
  // off the branch's line: still patch only, with a warning
  assert.equal(v(m('0.6.0', X)), '0.6.1');
  assert.match(m('0.6.0', X).warnings[0], /not on the 0\.5 line/);
  assert.equal(v(m('1.4.2', X, 'release/1.x')), '1.4.3');
  assert.deepEqual(m('1.4.2', X, 'release/1.x').warnings, []);
  assert.match(m('2.0.0', X, 'release/1.x').warnings[0], /not on the 1\.x line/);
  assert.match(m('0.6.0', F).blocked[0], /patch only/);
});

test('rule 4: which proposals open a linked line', () => {
  const L = (current, proposed, kind = 'prerelease', lastStable) => startsLinkedLine({kind, current, proposed, lastStable});
  assert.ok(L('0.5.1-alpha.3', '0.6.0-alpha.0'));
  assert.ok(L('1.5.0-alpha.3', '2.0.0-alpha.0'));
  assert.ok(L('0.6.0', '0.7.0-alpha.0'));
  assert.ok(!L('0.5.0-alpha.26', '0.5.0-alpha.27'));
  assert.ok(!L('0.6.0-alpha.7', '0.6.0-beta.0'));
  assert.ok(!L('0.6.0', '0.6.1-alpha.0'));
  // stable branch: a new major against the last stable, never a minor
  assert.ok(L('1.9.0', '2.0.0', 'stable', '1.9.0'));
  assert.ok(L('2.0.0-rc.2', '2.0.0', 'stable', '1.9.0'));
  assert.ok(!L('0.6.0-rc.2', '0.6.0', 'stable', '0.5.0'));
  assert.ok(!L('0.6.0', '0.7.0', 'stable', '0.6.0'));
  assert.ok(!L('0.5.3', '0.5.4', 'maintenance'));
});

const group = (members, kind = 'prerelease') => resolveGroup({kind, groupName: 'kit', members});

test('rule 4: independent unless a member opens a linked line', () => {
  const g = group([
    {component: 'kit', current: '0.5.0-alpha.26', proposed: '0.5.0-alpha.27'},
    {component: 'kit-py', current: '0.5.0-alpha.5', proposed: '0.5.0-alpha.6'},
    {component: 'kit-ts', current: '0.5.0-alpha.3'},
  ]);
  assert.equal(g.linked, false);
});

test('rule 4: a new minor line links every member at <target>-alpha.0', () => {
  const g = group([
    {component: 'kit', current: '0.5.1-alpha.3', lastStable: '0.5.0', proposed: '0.6.0-alpha.0'},
    {component: 'kit-py', current: '0.5.0-alpha.5'},
    {component: 'kit-ts', current: '0.5.0-alpha.3', proposed: '0.5.0-alpha.4'},
  ]);
  assert.equal(g.linked, true);
  assert.equal(g.version, '0.6.0-alpha.0');
  assert.deepEqual(g.blocked, []);
});

test('rule 4: a member already past .0 of the target line: highest counter + 1 on that channel', () => {
  const at = (rs, extra = {}) => group([
    {component: 'kit', current: '0.5.1-alpha.3', lastStable: '0.5.0', proposed: '0.6.0-alpha.0'},
    {component: 'kit-rs', current: rs, ...extra},
    {component: 'kit-py', current: '0.5.0-alpha.5'},
  ]);
  assert.equal(at('0.6.0-alpha.4').version, '0.6.0-alpha.5');
  assert.equal(at('0.6.0-alpha.0').version, '0.6.0-alpha.1');
  assert.equal(at('0.6.0-alpha.4', {proposed: '0.6.0-alpha.5'}).version, '0.6.0-alpha.5');
  assert.equal(at('0.6.0-beta.2').version, '0.6.0-beta.3');
  assert.equal(at('0.6.0-rc.1').version, '0.6.0-rc.2');
  for (const rs of ['0.6.0-alpha.4', '0.6.0-beta.2', '0.6.0-rc.1']) assert.deepEqual(at(rs).blocked, []);
  // a member's configured channel move (rule 1) is kept
  assert.equal(at('0.6.0-alpha.4', {proposed: '0.6.0-beta.0'}).version, '0.6.0-beta.0');
  // the highest member on the target line sets the counter
  const two = group([
    {component: 'kit', current: '0.5.1-alpha.3', lastStable: '0.5.0', proposed: '0.6.0-alpha.0'},
    {component: 'kit-rs', current: '0.6.0-alpha.4'},
    {component: 'kit-ts', current: '0.6.0-alpha.9'},
  ]);
  assert.equal(two.version, '0.6.0-alpha.10');
});

test('rule 4: a linked release never changes the channel', () => {
  const channelOf = v => v.split('-')[1].split('.')[0];
  const trigger = {component: 'kit', current: '0.5.1-alpha.3', lastStable: '0.5.0', proposed: '0.6.0-alpha.0'};
  for (const ch of ['alpha', 'beta', 'rc']) {
    for (const n of [0, 1, 4, 26]) {
      const g = group([trigger, {component: 'kit-rs', current: `0.6.0-${ch}.${n}`}, {component: 'kit-ts', current: '0.5.0-alpha.3'}]);
      assert.equal(g.version, `0.6.0-${ch}.${n + 1}`);
      assert.equal(channelOf(g.version), ch);
    }
  }
  // nobody on the target line yet: the new line's alpha.0, whatever the members' channels
  const g = group([trigger, {component: 'kit-rs', current: '0.5.0-beta.2'}, {component: 'kit-ts', current: '0.5.0-rc.1'}]);
  assert.equal(g.version, '0.6.0-alpha.0');
});

test('rule 4: the highest member target wins, then the same rule applies', () => {
  const g = group([
    {component: 'kit', current: '0.5.1-alpha.3', lastStable: '0.5.0', proposed: '0.6.0-alpha.0'},
    {component: 'kit-rs', current: '0.7.0-alpha.2', lastStable: '0.5.0'},
    {component: 'kit-ts', current: '0.6.0-beta.1'},
  ]);
  assert.equal(g.version, '0.7.0-alpha.3');
  const h = group([
    {component: 'kit', current: '0.5.1-alpha.3', lastStable: '0.5.0', proposed: '0.6.0-alpha.0'},
    {component: 'kit-rs', current: '0.7.0-rc.0'},
  ]);
  assert.equal(h.version, '0.7.0-rc.1');
  // a stale line (its target already released stable) does not raise the target
  const s = group([
    {component: 'kit', current: '0.5.1-alpha.3', lastStable: '0.5.0', proposed: '0.6.0-alpha.0'},
    {component: 'kit-rs', current: '0.5.0-rc.3', lastStable: '0.5.0'},
  ]);
  assert.equal(s.version, '0.6.0-alpha.0');
});

test('rule 4: a member that already released the target as stable blocks the group', () => {
  const g = group([
    {component: 'kit', current: '0.5.1-alpha.3', lastStable: '0.5.0', proposed: '0.6.0-alpha.0'},
    {component: 'kit-php', current: '0.6.0-rc.2', lastStable: '0.6.0'},
  ]);
  assert.equal(g.version, undefined);
  assert.match(g.blocked[0], /kit-php already released 0\.6\.0 as stable/);
});

test('rule 4: never moves a member backwards', () => {
  const currents = ['0.6.0-alpha.0', '0.6.0-alpha.9', '0.6.0-beta.0', '0.6.0-beta.4', '0.6.0-rc.7', '0.7.0-alpha.1', '0.5.9-rc.3', '0.5.0-alpha.1'];
  for (const c of currents) {
    const g = group([
      {component: 'kit', current: '0.5.1-alpha.3', lastStable: '0.5.0', proposed: '0.6.0-alpha.0'},
      {component: 'kit-rs', current: c},
    ]);
    assert.ok(g.version && cmp(parse(g.version), parse(c)) > 0, `${c} -> ${g.version}`);
  }
});

test('rule 4: a stable-branch major links; a member at or past it blocks', () => {
  const g = group([
    {component: 'kit', current: '2.0.0-rc.3', lastStable: '1.9.0', proposed: '2.0.0'},
    {component: 'kit-ts', current: '2.0.0-rc.1', lastStable: '1.9.0', proposed: '2.0.0'},
    {component: 'kit-php', current: '1.9.0', lastStable: '1.9.0'},
  ], 'stable');
  assert.equal(g.version, '2.0.0');
  const b = group([
    {component: 'kit', current: '2.0.0-rc.3', lastStable: '1.9.0', proposed: '2.0.0'},
    {component: 'kit-ts', current: '2.0.0', lastStable: '2.0.0'},
  ], 'stable');
  assert.equal(b.version, undefined);
  assert.match(b.blocked[0], /kit-ts is already at 2\.0\.0/);
  assert.equal(group([{component: 'kit', current: '0.6.0-rc.2', lastStable: '0.5.0', proposed: '0.6.0'}], 'stable').linked, false);
});

test('semver precedence', () => {
  assert.ok(cmp(parse('0.6.0-alpha.10'), parse('0.6.0-alpha.9')) > 0);
  assert.ok(cmp(parse('0.6.0-rc.0'), parse('0.6.0-beta.9')) > 0);
  assert.ok(cmp(parse('0.6.0'), parse('0.6.0-rc.9')) > 0);
  assert.ok(cmp(parse('v1.0.0'), parse('0.9.9')) > 0);
});
