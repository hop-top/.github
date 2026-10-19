'use strict';
// Simulation: release-please + the extension against kit-shaped fixture
// repositories, every GitHub read served from local git. Each case asserts
// the proposed release PR titles, group member versions and blocked
// packages. `stock` records what release-please's own `versioning:
// prerelease` proposes on the same repository (not asserted);
// PRINT_SCENARIOS=1 recomputes it and prints the table.
const test = require('node:test');
const assert = require('node:assert/strict');
const {config, repo, nextRepo, FAMILY, MAIN0} = require('./helpers/fixture');
const {propose, land} = require('./helpers/sim');

const all = (v, comps = FAMILY) => comps.map(c => `${c}: ${v}`);
const T = (component, version) => `chore(release): ${component} ${version}`;
const GROUP_NEXT = 'chore(next): release kit libraries';

// main promoted from next: every package's manifest on main is what next released.
function promoted(rcs) {
  const r = repo();
  r.commit('chore: initial').release(MAIN0);
  r.checkout('-b', 'next');
  for (const c of Object.keys(rcs)) r.commit(`feat(${c}): work`, [c]);
  r.release(rcs);
  r.checkout('main');
  r.git('merge', '-q', '--no-ff', 'next', '-m', "Merge branch 'next'");
  return r;
}

const SCENARIOS = [
  {id: 'a', label: 'kit 0.5.0-alpha.26 + feat!', build() {
    return {r: nextRepo().commit('feat(cli)!: drop flag', ['kit']), branch: 'next'};
  }, expect: [T('kit', '0.5.0-alpha.27')], stock: [T('kit', '0.5.0-alpha.27')]},

  {id: 'b', label: 'qmochi 0.5.1-alpha.3 (stable 0.5.0) + feat!', build() {
    return {r: nextRepo({qmochi: '0.5.1-alpha.3'}, {qmochi: '0.5.0'}).commit('feat(qmochi)!: new api', ['qmochi']), branch: 'next'};
  }, expect: [T('qmochi', '0.6.0-alpha.0')], stock: [T('qmochi', '0.6.0-alpha.3')]},

  {id: 'c', label: 'qmochi 1.5.0-alpha.3 (stable 1.4.2) + feat!', build() {
    return {r: nextRepo({qmochi: '1.5.0-alpha.3'}, {qmochi: '1.4.2'}).commit('feat(qmochi)!: new api', ['qmochi']), branch: 'next'};
  }, expect: [T('qmochi', '2.0.0-alpha.0')], stock: [T('qmochi', '2.0.0-alpha.3')]},

  {id: 'c2', label: 'qmochi 1.6.0-beta.2 (stable 1.5.0) + feat!, channel beta', build() {
    return {r: nextRepo({qmochi: '1.6.0-beta.2'}, {qmochi: '1.5.0'}).commit('feat(qmochi)!: new api', ['qmochi']), branch: 'next', prereleaseType: 'beta.0'};
  }, expect: [T('qmochi', '2.0.0-alpha.0')], stock: [T('qmochi', '2.0.0-beta.2')]},

  {id: 'd', label: 'qmochi 0.6.0-beta.2 + fix, channel beta', build() {
    return {r: nextRepo({qmochi: '0.6.0-beta.2'}, {qmochi: '0.5.0'}).commit('fix(qmochi): x', ['qmochi']), branch: 'next', prereleaseType: 'beta.0'};
  }, expect: [T('qmochi', '0.6.0-beta.3')], stock: [T('qmochi', '0.6.0-beta.3')]},

  {id: 'd2', label: 'qmochi 0.6.0-alpha.7 + fix, config alpha -> beta (no pin)', build() {
    return {r: nextRepo({qmochi: '0.6.0-alpha.7'}, {qmochi: '0.5.0'}).commit('fix(qmochi): x', ['qmochi']), branch: 'next', prereleaseType: 'beta.0'};
  }, expect: [T('qmochi', '0.6.0-beta.0')], stock: [T('qmochi', '0.6.0-alpha.8')]},

  {id: 'e', label: 'main after promotion: qmochi 0.6.0-rc.2 (stable 0.5.0), no new commits', build() {
    return {r: promoted({qmochi: '0.6.0-rc.2'}), branch: 'main'};
  }, expect: [T('qmochi', '0.6.0')], stock: []},

  {id: 'e2', label: 'as e, plus a fix on main', build() {
    return {r: promoted({qmochi: '0.6.0-rc.2'}).commit('fix(qmochi): z', ['qmochi']), branch: 'main'};
  }, expect: [T('qmochi', '0.6.0')], stock: [T('qmochi', '0.6.0-rc.3')]},

  {id: 'e3', label: 'main after the kit family is promoted at 0.6.0-rc.2 (minor: independent)', build() {
    return {r: promoted(Object.fromEntries(FAMILY.map(c => [c, '0.6.0-rc.2']))), branch: 'main'};
  }, expect: FAMILY.map(c => T(c, '0.6.0')), stock: FAMILY.map(c => T(c, '0.6.0-rc.3'))},

  {id: 'e4', label: 'main after the kit family is promoted at 1.0.0-rc.1 (new major: linked)', build() {
    const r = repo();
    r.commit('chore: initial').release({...Object.fromEntries(FAMILY.map(c => [c, '0.9.0'])), qmochi: '0.5.0'});
    r.checkout('-b', 'next').commit('feat(cli): y', ['kit']);
    r.release({...Object.fromEntries(FAMILY.map(c => [c, '1.0.0-rc.0'])), kit: '1.0.0-rc.1'});
    r.checkout('main');
    r.git('merge', '-q', '--no-ff', 'next', '-m', "Merge branch 'next'");
    return {r, branch: 'main'};
  }, expect: ['chore(main): release kit libraries'], versions: all('1.0.0'), stock: []},

  {id: 'e5', label: 'main carrying a beta (not promoted through rc): blocked', build() {
    return {r: promoted({qmochi: '0.6.0-beta.1'}).commit('fix(qmochi): z', ['qmochi']), branch: 'main'};
  }, expect: [], blocked: {qmochi: /not an rc/}, stock: [T('qmochi', '0.6.0-beta.2')]},

  {id: 'f', label: 'release/0.5 at 0.5.3 + fix (0.6.0 released on main)', build() {
    const r = repo().commit('chore: initial').release({...MAIN0, qmochi: '0.5.3'});
    r.checkout('-b', 'release/0.5').checkout('main');
    r.commit('feat(qmochi): later', ['qmochi']).release({qmochi: '0.6.0'});
    r.checkout('release/0.5').commit('fix(qmochi): backport', ['qmochi']);
    return {r, branch: 'release/0.5'};
  }, expect: [T('qmochi', '0.5.4')], stock: [T('qmochi', '0.5.4-alpha.0')]},

  {id: 'f2', label: 'release/0.5 at 0.5.3 + feat: no version, blocked', build() {
    const r = repo().commit('chore: initial').release({...MAIN0, qmochi: '0.5.3'});
    r.checkout('-b', 'release/0.5').commit('feat(qmochi): not allowed', ['qmochi']).commit('fix(kit): fine', ['kit']);
    return {r, branch: 'release/0.5'};
  }, expect: [T('kit', '0.4.1')], blocked: {qmochi: /feat on maintenance branch release\/0\.5: patch only/}, stock: [T('kit', '0.4.1-alpha.0'), T('qmochi', '0.6.0-alpha.0')]},

  {id: 'g', label: 'kit 0.5.1-alpha.3 (stable 0.5.0) + feat! opens 0.6.0: linked', build() {
    return {r: nextRepo({kit: '0.5.1-alpha.3'}, {kit: '0.5.0'}).commit('feat(cli)!: new line', ['kit']), branch: 'next', land: true};
  }, expect: [GROUP_NEXT], versions: all('0.6.0-alpha.0'), stock: [T('kit', '0.6.0-alpha.3')],
  landed: FAMILY.map(c => `${c}/v0.6.0-alpha.0`)},

  {id: 'h', label: 'kit feat + kit-py fix on the 0.5.0 line: independent counters', build() {
    return {r: nextRepo().commit('feat(cli): a', ['kit']).commit('fix(py): b', ['kit-py']), branch: 'next'};
  }, expect: [T('kit', '0.5.0-alpha.27'), T('kit-py', '0.5.0-alpha.6')], stock: [T('kit', '0.5.0-alpha.27'), T('kit-py', '0.5.0-alpha.6')]},

  {id: 'i', label: 'after g landed: kit-ts fix is independent again', async build() {
    const r = nextRepo({kit: '0.5.1-alpha.3'}, {kit: '0.5.0'}).commit('feat(cli)!: new line', ['kit']);
    const cfg = config();
    const g = await propose(r, 'next', cfg);
    await land(r, 'next', cfg, g.prs[0].pr);
    r.commit('fix(ts): c', ['kit-ts']);
    return {r, branch: 'next'};
  }, expect: [T('kit-ts', '0.6.0-alpha.1')], stock: [T('kit-ts', '0.6.0-alpha.1')]},

  {id: 'j', label: 'stale target: qmochi 0.6.0-rc.2 while 0.6.0 is stable, + feat', build() {
    return {r: nextRepo({qmochi: '0.6.0-rc.2'}, {qmochi: '0.6.0'}).commit('feat(qmochi): w', ['qmochi']), branch: 'next'};
  }, expect: [T('qmochi', '0.7.0-alpha.0')], stock: [T('qmochi', '0.6.0-rc.3')]},

  {id: 'k', label: 'kit opens 0.6.0 while kit-rs is at 0.6.0-alpha.4: group at highest counter + 1', build() {
    return {r: nextRepo({kit: '0.5.1-alpha.3', 'kit-rs': '0.6.0-alpha.4'}, {kit: '0.5.0'}).commit('feat(cli)!: new line', ['kit']), branch: 'next'};
  }, expect: [GROUP_NEXT], versions: all('0.6.0-alpha.5'), stock: [T('kit', '0.6.0-alpha.3')]},

  {id: 'k2', label: 'kit opens 0.6.0 while kit-rs is at 0.6.0-beta.2: same channel, counter + 1', build() {
    return {r: nextRepo({kit: '0.5.1-alpha.3', 'kit-rs': '0.6.0-beta.2'}, {kit: '0.5.0'}).commit('feat(cli)!: new line', ['kit']), branch: 'next'};
  }, expect: [GROUP_NEXT], versions: all('0.6.0-beta.3'), stock: [T('kit', '0.6.0-alpha.3')]},

  {id: 'k3', label: 'kit opens 0.6.0 while kit-rs is at 0.6.0-rc.1: rc.2, no channel change; qmochi independent', build() {
    const r = nextRepo({kit: '0.5.1-alpha.3', 'kit-rs': '0.6.0-rc.1'}, {kit: '0.5.0'});
    r.commit('feat(cli)!: new line', ['kit']).commit('fix(qmochi): independent', ['qmochi']);
    return {r, branch: 'next'};
  }, expect: [GROUP_NEXT, T('qmochi', '0.2.0-alpha.2')], versions: all('0.6.0-rc.2'),
  stock: [T('kit', '0.6.0-alpha.3'), T('qmochi', '0.2.0-alpha.2')]},

  {id: 'k4', label: 'kit opens 0.6.0 while kit-rs previews 0.7.0-alpha.2: highest target wins -> 0.7.0-alpha.3', build() {
    return {r: nextRepo({kit: '0.5.1-alpha.3', 'kit-rs': '0.7.0-alpha.2'}, {kit: '0.5.0'}).commit('feat(cli)!: new line', ['kit']), branch: 'next'};
  }, expect: [GROUP_NEXT], versions: all('0.7.0-alpha.3'), stock: [T('kit', '0.6.0-alpha.3')]},

  {id: 'k5', label: 'as k with the config already on beta.0: the linked release keeps alpha', build() {
    return {r: nextRepo({kit: '0.5.1-alpha.3', 'kit-rs': '0.6.0-alpha.4'}, {kit: '0.5.0'}).commit('feat(cli)!: new line', ['kit']), branch: 'next', prereleaseType: 'beta.0'};
  }, expect: [GROUP_NEXT], versions: all('0.6.0-alpha.5'), stock: [T('kit', '0.6.0-alpha.3')]},

  {id: 'k6', label: 'kit opens 0.6.0 while kit-php already released 0.6.0 stable: fail closed', build() {
    const r = nextRepo({kit: '0.5.1-alpha.3', 'kit-php': '0.6.0-rc.2'}, {kit: '0.5.0', 'kit-php': '0.6.0'});
    r.commit('feat(cli)!: new line', ['kit']).commit('fix(qmochi): independent', ['qmochi']);
    return {r, branch: 'next'};
  }, expect: [T('qmochi', '0.2.0-alpha.2')], blocked: Object.fromEntries(FAMILY.map(c => [c, /kit-php already released 0\.6\.0 as stable/])),
  stock: [T('kit', '0.6.0-alpha.3'), T('qmochi', '0.2.0-alpha.2')]},

  {id: 'r', label: 'Release-As footer on next is ignored', build() {
    return {r: nextRepo().commit('fix(qmochi): pin\n\nRelease-As: 9.9.9', ['qmochi']), branch: 'next'};
  }, expect: [T('qmochi', '0.2.0-alpha.2')], stock: [T('qmochi', '9.9.9')], note: /ignoring "Release-As: 9\.9\.9"/},
];

const ROWS = [];
const PRINT = !!process.env.PRINT_SCENARIOS;

for (const s of SCENARIOS) {
  test(`(${s.id}) ${s.label}`, async () => {
    const {r, branch, prereleaseType, land: doLand} = await s.build();
    const res = await propose(r, branch, config({prereleaseType}));
    // stock release-please on the same repository, for the printed table only
    const stock = PRINT ? (await propose(r, branch, config({prereleaseType, versioning: 'prerelease'}))).titles : s.stock;
    ROWS.push({s, titles: res.titles, versions: res.prs.flatMap(p => p.versions), stock, blocked: res.blocked});
    assert.deepEqual([...res.titles].sort(), [...s.expect].sort(), res.notes.join('\n'));
    if (s.versions) assert.deepEqual([...res.prs.find(p => p.title.includes('libraries')).versions].sort(), [...s.versions].sort());
    const blocked = s.blocked || {};
    assert.deepEqual([...new Set(res.blocked.map(b => b.component))].sort(), Object.keys(blocked).sort(), res.notes.join('\n'));
    for (const b of res.blocked) assert.match(b.reason, blocked[b.component]);
    if (s.note) assert.ok(res.notes.some(n => s.note.test(n)), res.notes.join('\n'));
    if (doLand) {
      const tags = await land(r, branch, config({prereleaseType}), res.prs[0].pr);
      assert.deepEqual(tags.sort(), [...s.landed].sort());
      const after = await propose(r, branch, config({prereleaseType}));
      assert.deepEqual(after.titles, [], 'nothing left to release after landing');
    }
  });
}

test.after(() => {
  if (!PRINT) return;
  const cell = a => (a.length ? a.join('<br>') : '(none)');
  console.log('| case | situation | target versioning | stock `prerelease` |\n|---|---|---|---|');
  for (const row of ROWS) {
    const ext = [...row.titles.map(t => row.versions.length && t.includes('libraries') ? `${t} {${row.versions.join(', ')}}` : t),
      ...[...new Set(row.blocked.map(b => b.reason))].map(b => `blocked: ${b}`)];
    console.log(`| ${row.s.id} | ${row.s.label} | ${cell(ext)} | ${cell(row.stock)} |`);
  }
});
