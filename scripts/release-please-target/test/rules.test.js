'use strict';
// The version rules on their own (no release-please).
const test = require('node:test');
const assert = require('node:assert/strict');
const {next, startsLinkedLine, resolveGroup, cmp, parse, bumpStable, promotionOf, openLineOf} = require('../lib/rules');

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
});

test('rule 1: from a stable manifest, or a target already released stable', () => {
  assert.equal(v(pre('0.6.0', F, '0.6.0')), '0.7.0-alpha.0');
  assert.equal(v(pre('0.6.0', X, '0.6.0')), '0.6.1-alpha.0');
  assert.equal(v(pre('1.2.0', B, '1.2.0')), '2.0.0-alpha.0');
  assert.equal(v(pre('0.6.0-rc.2', X, '0.6.0')), '0.6.1-alpha.0');
  assert.equal(v(pre('0.6.0-rc.2', F, '0.6.0')), '0.7.0-alpha.0');
});

test('rule 1: a promotion moves its line to <channel>.0, then counts on it', () => {
  assert.equal(v(pre('0.6.0-alpha.7', X, '0.5.0', promo('0.6.0', 'beta'))), '0.6.0-beta.0');
  assert.equal(pre('0.6.0-alpha.7', X, '0.5.0', promo('0.6.0', 'beta')).code, 'channel');
  assert.equal(v(pre('0.6.0-beta.0', X, '0.5.0', promo('0.6.0', 'beta'))), '0.6.0-beta.1');
  assert.equal(v(pre('0.6.0-beta.3', X, '0.5.0', promo('0.6.0', 'rc'))), '0.6.0-rc.0');
  // never backwards: a record behind the current channel, or removed
  assert.equal(v(pre('0.6.0-rc.2', X, '0.5.0', promo('0.6.0', 'beta'))), '0.6.0-rc.3');
  assert.equal(v(pre('0.6.0-beta.3', F, '0.5.0')), '0.6.0-beta.4');
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

test('rule 2: stable branch promotes an rc to its target', () => {
  const st = (current, summary, lastStable) => next({kind: 'stable', current, summary, lastStable});
  assert.equal(v(st('0.6.0-rc.2', X, '0.5.0')), '0.6.0');
  assert.equal(st('0.6.0-rc.2', X, '0.5.0').code, 'promote');
  assert.equal(v(st('0.6.0-rc.2', B, '0.5.0')), '0.6.0');
  assert.equal(v(st('0.6.0-rc.0', X, undefined)), '0.6.0');
  assert.equal(v(st('0.5.1-rc.0', F, '0.5.0')), '0.6.0');
  assert.equal(v(st('1.5.0-rc.1', B, '1.4.0')), '2.0.0');
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
  assert.ok(L('0.9.0-alpha.3', '1.0.0-alpha.0'));
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

test('rule 4: a new line moves every member, each at <target>-alpha.0 when nobody is on it', () => {
  const g = group([KIT, {component: 'kit-py', current: '0.5.0-alpha.5'}, {component: 'kit-ts', current: '0.5.0-alpha.3', proposed: '0.5.0-alpha.4'}]);
  assert.equal(g.linked, true);
  assert.deepEqual(g.versions, {kit: '0.6.0-alpha.0', 'kit-py': '0.6.0-alpha.0', 'kit-ts': '0.6.0-alpha.0'});
  // a member promoted on its old line starts the new one on alpha
  const p = group([KIT, {component: 'kit-py', current: '0.5.0-beta.2', promotion: promo('0.5.0', 'beta')}]);
  assert.deepEqual(p.versions, {kit: '0.6.0-alpha.0', 'kit-py': '0.6.0-alpha.0'});
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
        for (const m of members) {
          const got = g.versions[m.component];
          const onLine = m.current && m.current.startsWith('0.6.0-');
          const own = onLine ? channelOf(m.current) : 'alpha';
          const promoted = m.promotion && m.promotion.line === '0.6.0' ? m.promotion.channel : undefined;
          const want = promoted && ['alpha', 'beta', 'rc'].indexOf(promoted) > ['alpha', 'beta', 'rc'].indexOf(own) ? promoted : own;
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

test('rule 4: a stable-branch major links; a member at or past it blocks', () => {
  const g = group([
    {component: 'kit', current: '2.0.0-rc.3', lastStable: '1.9.0', proposed: '2.0.0'},
    {component: 'kit-ts', current: '2.0.0-rc.1', lastStable: '1.9.0', proposed: '2.0.0'},
    {component: 'kit-php', current: '1.9.0', lastStable: '1.9.0'},
  ], 'stable');
  assert.deepEqual(g.versions, {kit: '2.0.0', 'kit-ts': '2.0.0', 'kit-php': '2.0.0'});
  const b = group([
    {component: 'kit', current: '2.0.0-rc.3', lastStable: '1.9.0', proposed: '2.0.0'},
    {component: 'kit-ts', current: '2.0.0', lastStable: '2.0.0'},
  ], 'stable');
  assert.equal(b.versions, undefined);
  assert.match(b.blocked[0], /kit-ts is already at 2\.0\.0/);
  assert.equal(group([{component: 'kit', current: '0.6.0-rc.2', lastStable: '0.5.0', proposed: '0.6.0'}], 'stable').linked, false);
});

test('semver precedence', () => {
  assert.ok(cmp(parse('0.6.0-alpha.10'), parse('0.6.0-alpha.9')) > 0);
  assert.ok(cmp(parse('0.6.0-rc.0'), parse('0.6.0-beta.9')) > 0);
  assert.ok(cmp(parse('0.6.0'), parse('0.6.0-rc.9')) > 0);
  assert.ok(cmp(parse('v1.0.0'), parse('0.9.9')) > 0);
});
