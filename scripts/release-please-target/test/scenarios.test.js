'use strict';
// Simulation: release-please + the extension against kit-shaped fixture
// repositories, every GitHub read served from local git. Each case asserts
// the proposed release PR titles, group member versions, blocked packages
// (the run fails) and skipped ones (a notice). `stock` records what
// release-please's own `versioning: prerelease` proposes on the same
// repository (not asserted); PRINT_SCENARIOS=1 recomputes it and prints
// the table. The runner's config refusals (records against the manifest)
// are runner.test.js's; here the plugins see every config.
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {config, repo, nextRepo, FAMILY, MAIN0, CONFIG} = require('./helpers/fixture');
const {propose, land} = require('./helpers/sim');

const all = (v, comps = FAMILY) => comps.map(c => `${c}: ${v}`);
const T = (component, version) => `chore(release): ${component} ${version}`;
const GROUP_NEXT = 'chore(next): release kit libraries';
const GROUP_MAIN = 'chore(main): release kit libraries';
// The config commit a promotion lands as (the root package's path, so kit
// sees a commit, not a user-facing one).
const configCommit = (r, msg) => {
  fs.writeFileSync(path.join(r.dir, CONFIG), `{"edited": "${msg}"}\n`);
  return r.commit(msg);
};

// main promoted from next: every package's manifest on main is what next released.
function promoted(rcs, main0 = MAIN0) {
  const r = repo();
  r.commit('chore: initial').release(main0);
  r.checkout('-b', 'next');
  for (const c of Object.keys(rcs)) r.commit(`feat(${c}): work`, [c]);
  r.release(rcs);
  r.checkout('main');
  r.git('merge', '-q', '--no-ff', 'next', '-m', "Merge branch 'next'");
  return r;
}

// qmochi stable 0.6.0; next previews `onNext`; main then hotfixes 0.6.1.
// The repository is left on next.
function hotfixOnMain(onNext) {
  const r = repo();
  r.commit('chore: initial').release({...MAIN0, qmochi: '0.6.0'});
  r.checkout('-b', 'next').commit('fix(qmochi): on next', ['qmochi']).release({qmochi: onNext});
  r.checkout('main').commit('fix(qmochi): hotfix', ['qmochi']).release({qmochi: '0.6.1'});
  return r.checkout('next');
}

// hotfixOnMain at 0.6.1-rc.2, then next merged into main (next's side of
// every conflict: its manifest lands on main). The repository is left on main.
function hotfixThenPromotion() {
  const r = hotfixOnMain('0.6.1-rc.2').checkout('main');
  r.git('merge', '-q', '--no-ff', '-X', 'theirs', 'next', '-m', "Merge branch 'next'");
  return r;
}

// main released without qmochi (a package added since): no manifest
// entry, no tag, so release-please would open it at its initial-version.
// Then a feat on qmochi and a fix on kit. The repository is left on main.
const NEW_QMOCHI = {'incubator/qmochi': {'initial-version': '0.1.0-alpha.0'}};
function unreleased(branch = 'main') {
  const {qmochi, ...released} = MAIN0;
  const r = repo().commit('chore: initial').release(released);
  if (branch !== 'main') r.checkout('-b', branch);
  return r.commit('feat(qmochi): first', ['qmochi']).commit('fix(cli): k', ['kit']);
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

  {id: 'c2', label: 'qmochi 1.6.0-beta.2 (stable 1.5.0, promoted on 1.6.0) + feat!: new line on alpha, record dropped', build() {
    return {r: nextRepo({qmochi: '1.6.0-beta.2'}, {qmochi: '1.5.0'}).commit('feat(qmochi)!: new api', ['qmochi']), branch: 'next',
      records: {qmochi: {'x-channel': {line: '1.6.0', channel: 'beta'}}}};
  }, expect: [T('qmochi', '2.0.0-alpha.0')], cleared: {qmochi: ['x-channel']}, stockType: 'beta.0', stock: [T('qmochi', '2.0.0-beta.2')]},

  {id: 'd', label: 'qmochi 0.6.0-beta.2 (promoted on 0.6.0) + fix', build() {
    return {r: nextRepo({qmochi: '0.6.0-beta.2'}, {qmochi: '0.5.0'}).commit('fix(qmochi): x', ['qmochi']), branch: 'next',
      records: {qmochi: {'x-channel': {line: '0.6.0', channel: 'beta'}}}};
  }, expect: [T('qmochi', '0.6.0-beta.3')], cleared: {}, stockType: 'beta.0', stock: [T('qmochi', '0.6.0-beta.3')]},

  {id: 'd2', label: 'qmochi 0.6.0-alpha.7 + fix, promoted to beta on 0.6.0 (no pin)', build() {
    return {r: nextRepo({qmochi: '0.6.0-alpha.7'}, {qmochi: '0.5.0'}).commit('fix(qmochi): x', ['qmochi']), branch: 'next',
      records: {qmochi: {'x-channel': {line: '0.6.0', channel: 'beta'}}}};
  }, expect: [T('qmochi', '0.6.0-beta.0')], cleared: {}, stockType: 'beta.0', stock: [T('qmochi', '0.6.0-alpha.8')]},

  {id: 'd3', label: 'promotion expires: qmochi 0.6.1-beta.2 (promoted on 0.6.1) + feat -> 0.7.0-alpha.0', build() {
    return {r: nextRepo({qmochi: '0.6.1-beta.2'}, {qmochi: '0.6.0'}).commit('feat(qmochi): y', ['qmochi']), branch: 'next',
      records: {qmochi: {'x-channel': {line: '0.6.1', channel: 'beta'}}}};
  }, expect: [T('qmochi', '0.7.0-alpha.0')], cleared: {qmochi: ['x-channel']}, stockType: 'beta.0', stock: [T('qmochi', '0.7.0-beta.2')]},

  {id: 'd4', label: 'a record left for an old line is ignored and dropped: 0.7.0-alpha.0 + fix (the runner refuses that config first)', build() {
    return {r: nextRepo({qmochi: '0.7.0-alpha.0'}, {qmochi: '0.6.0'}).commit('fix(qmochi): z', ['qmochi']), branch: 'next',
      records: {qmochi: {'x-channel': {line: '0.6.1', channel: 'beta'}}}};
  }, expect: [T('qmochi', '0.7.0-alpha.1')], cleared: {qmochi: ['x-channel']}, stock: [T('qmochi', '0.7.0-alpha.1')]},

  {id: 'kit', label: 'the kit round: kit and qmochi promoted to beta, no other change: both cut at once, the rest stays', build() {
    const r = configCommit(nextRepo(), 'chore(release): promote kit, qmochi to beta');
    return {r, branch: 'next', land: true, records: {kit: {'x-channel': {line: '0.5.0', channel: 'beta'}}, qmochi: {'x-channel': {line: '0.2.0', channel: 'beta'}}}};
  }, expect: [T('kit', '0.5.0-beta.0'), T('qmochi', '0.2.0-beta.0')], cleared: {},
  landed: ['kit/v0.5.0-beta.0', 'qmochi/v0.2.0-beta.0'], stock: []},

  {id: 'kit2', label: 'the kit family promoted to beta as a group, no other change: each member cut at beta.0', build() {
    const r = configCommit(nextRepo(), 'chore(release): promote kit to beta');
    const lines = {kit: '0.5.0', 'kit-php': '0.5.0', 'kit-rs': '0.5.0', 'kit-py': '0.5.0', 'kit-ts': '0.5.0'};
    return {r, branch: 'next', records: Object.fromEntries(Object.entries(lines).map(([c, line]) => [c, {'x-channel': {line, channel: 'beta'}}]))};
  }, expect: FAMILY.map(c => T(c, '0.5.0-beta.0')), cleared: {}, stock: []},

  {id: 'mix', label: 'kit and qmochi promoted to beta by package, kit-py stays alpha', build() {
    const r = nextRepo().commit('fix(cli): a', ['kit']).commit('fix(py): b', ['kit-py']).commit('fix(qmochi): c', ['qmochi']);
    return {r, branch: 'next', records: {kit: {'x-channel': {line: '0.5.0', channel: 'beta'}}, qmochi: {'x-channel': {line: '0.2.0', channel: 'beta'}}}};
  }, expect: [T('kit', '0.5.0-beta.0'), T('kit-py', '0.5.0-alpha.6'), T('qmochi', '0.2.0-beta.0')], cleared: {},
  stock: [T('kit', '0.5.0-alpha.27'), T('kit-py', '0.5.0-alpha.6'), T('qmochi', '0.2.0-alpha.2')]},

  {id: 'o1', label: 'open 1.0.0 from qmochi 0.9.0-alpha.3 (x-open-line)', build() {
    return {r: nextRepo({qmochi: '0.9.0-alpha.3'}, {qmochi: '0.8.0'}).commit('fix(qmochi): x', ['qmochi']), branch: 'next',
      records: {qmochi: {'x-open-line': '1.0.0'}}};
  }, expect: [T('qmochi', '1.0.0-alpha.0')], cleared: {qmochi: ['x-open-line']}, stock: [T('qmochi', '0.9.0-alpha.4')]},

  {id: 'o2', label: 'open line 1.6.0 below the required 2.0.0: refused', build() {
    const r = nextRepo({qmochi: '1.5.0-alpha.3'}, {qmochi: '1.4.2'}).commit('feat(qmochi)!: new api', ['qmochi']).commit('fix(cli): k', ['kit']);
    return {r, branch: 'next', records: {qmochi: {'x-open-line': '1.6.0'}}};
  }, expect: [T('kit', '0.5.0-alpha.27')], blocked: {qmochi: /x-open-line 1\.6\.0 is below the required target 2\.0\.0/},
  stock: [T('kit', '0.5.0-alpha.27'), T('qmochi', '2.0.0-alpha.3')]},

  {id: 'o3', label: 'open line already reached: qmochi 1.0.0-alpha.2 + fix, record ignored and dropped (the runner refuses that config first)', build() {
    return {r: nextRepo({qmochi: '1.0.0-alpha.2'}, {qmochi: '0.9.0'}).commit('fix(qmochi): x', ['qmochi']), branch: 'next',
      records: {qmochi: {'x-open-line': '1.0.0'}}};
  }, expect: [T('qmochi', '1.0.0-alpha.3')], cleared: {qmochi: ['x-open-line']}, stock: [T('qmochi', '1.0.0-alpha.3')]},

  {id: 'o5', label: 'open 1.0.0 from qmochi 0.9.0-alpha.3, no other change: cut at once', build() {
    return {r: configCommit(nextRepo({qmochi: '0.9.0-alpha.3'}, {qmochi: '0.8.0'}), 'chore(release): open qmochi 1.0.0'), branch: 'next', land: true,
      records: {qmochi: {'x-open-line': '1.0.0'}}};
  }, expect: [T('qmochi', '1.0.0-alpha.0')], cleared: {qmochi: ['x-open-line']}, landed: ['qmochi/v1.0.0-alpha.0'], stock: []},

  {id: 'o6', label: 'open 1.0.0 on kit-py alone, no other change: a major links the family at 1.0.0-alpha.0', build() {
    return {r: configCommit(nextRepo(), 'chore(release): open kit-py 1.0.0'), branch: 'next', records: {'kit-py': {'x-open-line': '1.0.0'}}};
  }, expect: [GROUP_NEXT], versions: all('1.0.0-alpha.0'), cleared: {'kit-py': ['x-open-line']}, stock: []},

  {id: 'o4', label: 'open 1.0.0 for the kit group, then a fix on kit: linked at 1.0.0-alpha.0', build() {
    const r = nextRepo(Object.fromEntries(FAMILY.map(c => [c, '0.9.0-alpha.3'])), Object.fromEntries(FAMILY.map(c => [c, '0.8.0'])));
    r.commit('fix(cli): x', ['kit']);
    return {r, branch: 'next', records: Object.fromEntries(FAMILY.map(c => [c, {'x-open-line': '1.0.0'}]))};
  }, expect: [GROUP_NEXT], versions: all('1.0.0-alpha.0'), cleared: Object.fromEntries(FAMILY.map(c => [c, ['x-open-line']])),
  stock: [T('kit', '0.9.0-alpha.4')]},

  {id: 'e', label: 'main after promotion: qmochi 0.6.0-rc.2 (stable 0.5.0, promoted rc on 0.6.0), no new commits; the record stays (inert on main)', build() {
    return {r: promoted({qmochi: '0.6.0-rc.2'}), branch: 'main', records: {qmochi: {'x-channel': {line: '0.6.0', channel: 'rc'}}}};
  }, expect: [T('qmochi', '0.6.0')], cleared: {}, stock: []},

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

  {id: 'e5', label: 'main carrying a beta (not promoted through rc): skipped with a notice, no failure', build() {
    return {r: promoted({qmochi: '0.6.0-beta.1'}).commit('fix(qmochi): z', ['qmochi']), branch: 'main'};
  }, expect: [], skipped: {qmochi: /0\.6\.0-beta\.1 is not an rc: skipped/}, stock: [T('qmochi', '0.6.0-beta.2')]},

  {id: 'e6', label: 'main after next merged: kit, kit-py, kit-ts at 0.6.0-rc.2, the experimental SDKs still alpha: three cut, two skipped', build() {
    return {r: promoted({kit: '0.6.0-rc.2', 'kit-py': '0.6.0-rc.2', 'kit-ts': '0.6.0-rc.2', 'kit-php': '0.6.0-alpha.3', 'kit-rs': '0.6.0-alpha.1'}), branch: 'main'};
  }, expect: ['kit', 'kit-py', 'kit-ts'].map(c => T(c, '0.6.0')),
  skipped: {'kit-php': /0\.6\.0-alpha\.3 is not an rc: skipped/, 'kit-rs': /0\.6\.0-alpha\.1 is not an rc: skipped/},
  stock: []},

  {id: 'e7', label: 'main, stable 1.0.0: kit at 1.0.0-rc.1, kit-py still at 1.0.0-alpha.3: the linked major blocks, no member is cut', build() {
    const r = repo();
    r.commit('chore: initial').release({...Object.fromEntries(FAMILY.map(c => [c, '0.9.0'])), qmochi: '0.5.0'});
    r.checkout('-b', 'next').commit('feat(cli): y', ['kit']);
    r.release({...Object.fromEntries(FAMILY.map(c => [c, '1.0.0-rc.0'])), kit: '1.0.0-rc.1', 'kit-py': '1.0.0-alpha.3'});
    r.checkout('main');
    r.git('merge', '-q', '--no-ff', 'next', '-m', "Merge branch 'next'");
    return {r, branch: 'main'};
  }, expect: [], blocked: Object.fromEntries(FAMILY.map(c => [c, /kit: linked at 1\.0\.0 by .*but kit-py is at 1\.0\.0-alpha\.3: a linked release is cut only when every member is at an rc of 1\.0\.0 \(promote kit-py via beta to rc on next first\)$/])),
  stock: []},

  {id: 'e8', label: 'main: qmochi 1.3.0-rc.1 promoted, then a feat! on main (needs 2.0.0): blocked, stable must equal the rc', build() {
    return {r: promoted({qmochi: '1.3.0-rc.1'}, {...MAIN0, qmochi: '1.2.0'}).commit('feat(qmochi)!: big', ['qmochi']), branch: 'main'};
  }, expect: [], blocked: {qmochi: /changes since 1\.3\.0-rc\.1 require 2\.0\.0 .*stable must equal what the rc previewed/},
  stock: [T('qmochi', '2.0.0-rc.1')]},

  {id: 'e9', label: 'hotfix, then promotion: next at qmochi 0.6.1-rc.2, main hotfixes 0.6.1, next merges into main: the rc is stale, blocked', build() {
    return {r: hotfixThenPromotion(), branch: 'main'};
  }, expect: [], blocked: {qmochi: /^0\.6\.1-rc\.2 previews 0\.6\.1, already released \(last stable 0\.6\.1\): re-line on next/},
  stock: [T('qmochi', '0.6.1-rc.3')]},

  {id: 'e10', label: 'as e9, re-lined on next with x-open-line 0.6.2, no other change: cut at once', build() {
    const r = hotfixThenPromotion();
    r.checkout('next');
    return {r: configCommit(r, 'chore(release): open qmochi 0.6.2'), branch: 'next', records: {qmochi: {'x-open-line': '0.6.2'}}};
  }, expect: [T('qmochi', '0.6.2-alpha.0')], cleared: {qmochi: ['x-open-line']}, stock: []},

  {id: 'm1', label: 'main, qmochi stable 0.6.0 + fix: patch', build() {
    return {r: repo().commit('chore: initial').release({...MAIN0, qmochi: '0.6.0'}).commit('fix(qmochi): z', ['qmochi']), branch: 'main'};
  }, expect: [T('qmochi', '0.6.1')], stock: [T('qmochi', '0.6.1-alpha.0')]},

  {id: 'm2', label: 'main, qmochi stable 0.6.0 + feat: blocked, never shipped unpreviewed', build() {
    return {r: repo().commit('chore: initial').release({...MAIN0, qmochi: '0.6.0'}).commit('feat(qmochi): z', ['qmochi']).commit('fix(cli): k', ['kit']), branch: 'main'};
  }, expect: [T('kit', '0.4.1')], blocked: {qmochi: /^feat since stable 0\.6\.0 would ship 0\.7\.0 unpreviewed: a stable package takes fixes only here \(land it on next, where it opens a new line\)$/},
  stock: [T('kit', '0.4.1-alpha.0'), T('qmochi', '0.7.0-alpha.0')]},

  {id: 'm3', label: 'main, qmochi (no group) stable 1.2.0 + feat!: blocked', build() {
    return {r: repo().commit('chore: initial').release({...MAIN0, qmochi: '1.2.0'}).commit('feat(qmochi)!: z', ['qmochi']), branch: 'main'};
  }, expect: [], blocked: {qmochi: /^breaking change since stable 1\.2\.0 would ship 2\.0\.0 unpreviewed: .*land it on next/},
  stock: [T('qmochi', '2.0.0-alpha.0')]},

  {id: 'm4', label: 'main, the kit family stable at 1.0.0: feat! on kit-py blocks kit-py alone, a fix on kit-ts is patched (no link)', build() {
    const r = repo().commit('chore: initial').release({...Object.fromEntries(FAMILY.map(c => [c, '1.0.0'])), qmochi: '0.5.0'});
    return {r: r.commit('feat(py)!: z', ['kit-py']).commit('fix(ts): y', ['kit-ts']), branch: 'main'};
  }, expect: [T('kit-ts', '1.0.1')], blocked: {'kit-py': /^breaking change since stable 1\.0\.0 would ship 2\.0\.0 unpreviewed/},
  stock: [T('kit-py', '2.0.0-alpha.0'), T('kit-ts', '1.0.1-alpha.0')]},

  {id: 'n1', label: 'main, qmochi never released (no manifest entry, no tag) + feat: skipped with a notice, never opened at its initial-version', build() {
    return {r: unreleased(), branch: 'main', packages: NEW_QMOCHI};
  }, expect: [T('kit', '0.4.1')], skipped: {qmochi: /^no release yet: skipped \(a stable branch cuts only an rc; release it on next, then promote it via beta to rc\)$/},
  stock: [T('kit', '0.4.1-alpha.0'), T('qmochi', '0.1.0-alpha.0')]},

  {id: 'n2', label: 'release/0.4, qmochi never released + feat: skipped with a notice, kit still patched', build() {
    return {r: unreleased('release/0.4'), branch: 'release/0.4', packages: NEW_QMOCHI};
  }, expect: [T('kit', '0.4.1')], skipped: {qmochi: /^no release yet: skipped \(maintenance branch release\/0\.4 releases stable patches only\)$/},
  stock: [T('kit', '0.4.1-alpha.0'), T('qmochi', '0.1.0-alpha.0')]},

  {id: 'n3', label: 'next, qmochi never released + feat: opened at its initial-version', build() {
    return {r: unreleased('next'), branch: 'next', packages: NEW_QMOCHI};
  }, expect: [T('kit', '0.4.1-alpha.0'), T('qmochi', '0.1.0-alpha.0')], stock: [T('kit', '0.4.1-alpha.0'), T('qmochi', '0.1.0-alpha.0')]},

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

  {id: 'f3', label: 'release/0.5 carrying qmochi 0.5.4-rc.0 + fix: skipped (never made stable), kit still patched', build() {
    const r = repo().commit('chore: initial').release({...MAIN0, qmochi: '0.5.3'});
    r.checkout('-b', 'release/0.5').release({qmochi: '0.5.4-rc.0'});
    r.commit('fix(qmochi): backport', ['qmochi']).commit('fix(kit): fine', ['kit']);
    return {r, branch: 'release/0.5'};
  }, expect: [T('kit', '0.4.1')], skipped: {qmochi: /0\.5\.4-rc\.0 is a prerelease: skipped \(maintenance branch release\/0\.5 releases stable patches only\)/},
  stock: [T('kit', '0.4.1-alpha.0'), T('qmochi', '0.5.4-rc.1')]},

  {id: 'g', label: 'kit 0.5.1-alpha.3 (stable 0.5.0) + feat! opens 0.6.0: linked', build() {
    return {r: nextRepo({kit: '0.5.1-alpha.3'}, {kit: '0.5.0'}).commit('feat(cli)!: new line', ['kit']), branch: 'next', land: true};
  }, expect: [GROUP_NEXT], versions: all('0.6.0-alpha.0'), stock: [T('kit', '0.6.0-alpha.3')],
  landed: FAMILY.map(c => `${c}/v0.6.0-alpha.0`)},

  {id: 'g2', label: 'from 1.0: kit 1.2.1-alpha.3 (stable 1.2.0) + feat opens 1.3.0: a minor, independent', build() {
    const pre = Object.fromEntries(FAMILY.map(c => [c, '1.2.0-alpha.2']));
    const st = Object.fromEntries(FAMILY.map(c => [c, '1.1.0']));
    return {r: nextRepo({...pre, kit: '1.2.1-alpha.3'}, {...st, kit: '1.2.0'}).commit('feat(cli): minor', ['kit']), branch: 'next'};
  }, expect: [T('kit', '1.3.0-alpha.0')], stock: [T('kit', '1.3.0-alpha.3')]},

  {id: 'g3', label: 'kit opens 0.6.0 while kit-py, blocked on its own (x-open-line 0.5.2 below its 0.6.0), cannot move: no group release', build() {
    const r = nextRepo({kit: '0.5.1-alpha.3', 'kit-py': '0.5.1-alpha.0'}, {kit: '0.5.0', 'kit-py': '0.5.0'});
    r.commit('feat(cli)!: new line', ['kit']).commit('feat(py): more', ['kit-py']).commit('fix(qmochi): independent', ['qmochi']);
    return {r, branch: 'next', records: {'kit-py': {'x-open-line': '0.5.2'}}};
  }, expect: [T('qmochi', '0.2.0-alpha.2')],
  blocked: Object.fromEntries(FAMILY.map(c => [c, c === 'kit-py' ? /x-open-line 0\.5\.2 is below the required target 0\.6\.0|kit: linked, but kit-py cannot release/ : /^kit: linked, but kit-py cannot release: no group release$/])),
  stock: [T('kit', '0.6.0-alpha.3'), T('kit-py', '0.6.0-alpha.0'), T('qmochi', '0.2.0-alpha.2')]},

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

  {id: 'j2', label: 'next previews qmochi 0.6.1-alpha.3, main hotfixes 0.6.1, then a fix on next: re-lined at 0.6.2-alpha.0', build() {
    return {r: hotfixOnMain('0.6.1-alpha.3').commit('fix(qmochi): on next', ['qmochi']), branch: 'next'};
  }, expect: [T('qmochi', '0.6.2-alpha.0')], stock: [T('qmochi', '0.6.1-alpha.4')]},

  {id: 'j3', label: 'as j2, a feat on next: re-lined at 0.7.0-alpha.0', build() {
    return {r: hotfixOnMain('0.6.1-alpha.3').commit('feat(qmochi): on next', ['qmochi']), branch: 'next'};
  }, expect: [T('qmochi', '0.7.0-alpha.0')], stock: [T('qmochi', '0.7.0-alpha.3')]},

  {id: 'j', label: 'stale target: qmochi 0.6.0-rc.2 while 0.6.0 is stable, + feat', build() {
    return {r: nextRepo({qmochi: '0.6.0-rc.2'}, {qmochi: '0.6.0'}).commit('feat(qmochi): w', ['qmochi']), branch: 'next'};
  }, expect: [T('qmochi', '0.7.0-alpha.0')], stock: [T('qmochi', '0.6.0-rc.3')]},

  {id: 'k', label: 'kit opens 0.6.0 while kit-rs is at 0.6.0-alpha.4: group at highest counter + 1', build() {
    return {r: nextRepo({kit: '0.5.1-alpha.3', 'kit-rs': '0.6.0-alpha.4'}, {kit: '0.5.0'}).commit('feat(cli)!: new line', ['kit']), branch: 'next'};
  }, expect: [GROUP_NEXT], versions: all('0.6.0-alpha.5'), stock: [T('kit', '0.6.0-alpha.3')]},

  {id: 'k2', label: 'kit opens 0.6.0 while kit-rs (promoted) is at 0.6.0-beta.2: kit-rs beta.3, the rest alpha.0', build() {
    return {r: nextRepo({kit: '0.5.1-alpha.3', 'kit-rs': '0.6.0-beta.2'}, {kit: '0.5.0'}).commit('feat(cli)!: new line', ['kit']), branch: 'next',
      records: {'kit-rs': {'x-channel': {line: '0.6.0', channel: 'beta'}}}};
  }, expect: [GROUP_NEXT], versions: [...all('0.6.0-alpha.0', ['kit', 'kit-php', 'kit-py', 'kit-ts']), 'kit-rs: 0.6.0-beta.3'], cleared: {},
  stock: [T('kit', '0.6.0-alpha.3')]},

  {id: 'k3', label: 'kit opens 0.6.0 while kit-rs is at 0.6.0-rc.1: kit-rs rc.2, the rest alpha.0; qmochi independent', build() {
    const r = nextRepo({kit: '0.5.1-alpha.3', 'kit-rs': '0.6.0-rc.1'}, {kit: '0.5.0'});
    r.commit('feat(cli)!: new line', ['kit']).commit('fix(qmochi): independent', ['qmochi']);
    return {r, branch: 'next', records: {'kit-rs': {'x-channel': {line: '0.6.0', channel: 'rc'}}}};
  }, expect: [GROUP_NEXT, T('qmochi', '0.2.0-alpha.2')], versions: [...all('0.6.0-alpha.0', ['kit', 'kit-php', 'kit-py', 'kit-ts']), 'kit-rs: 0.6.0-rc.2'],
  stock: [T('kit', '0.6.0-alpha.3'), T('qmochi', '0.2.0-alpha.2')]},

  {id: 'k4', label: 'kit opens 0.6.0 while kit-rs previews 0.7.0-alpha.2: highest target wins -> 0.7.0-alpha.3', build() {
    return {r: nextRepo({kit: '0.5.1-alpha.3', 'kit-rs': '0.7.0-alpha.2'}, {kit: '0.5.0'}).commit('feat(cli)!: new line', ['kit']), branch: 'next'};
  }, expect: [GROUP_NEXT], versions: all('0.7.0-alpha.3'), stock: [T('kit', '0.6.0-alpha.3')]},

  {id: 'k5', label: 'as k, kit-ts at 0.6.0-alpha.1 promoted to beta on 0.6.0: kit-ts beta.0, alpha members share alpha.5', build() {
    return {r: nextRepo({kit: '0.5.1-alpha.3', 'kit-rs': '0.6.0-alpha.4', 'kit-ts': '0.6.0-alpha.1'}, {kit: '0.5.0'}).commit('feat(cli)!: new line', ['kit']), branch: 'next',
      records: {'kit-ts': {'x-channel': {line: '0.6.0', channel: 'beta'}}}};
  }, expect: [GROUP_NEXT], versions: [...all('0.6.0-alpha.5', ['kit', 'kit-php', 'kit-py', 'kit-rs']), 'kit-ts: 0.6.0-beta.0'], cleared: {},
  stock: [T('kit', '0.6.0-alpha.3')]},

  {id: 'k7', label: 'kit opens 0.6.0; kit-ts (0.5.0-alpha.3) has a promotion for 0.6.0 it never reached: alpha.0 like everyone (the runner refuses that record first)', build() {
    return {r: nextRepo({kit: '0.5.1-alpha.3'}, {kit: '0.5.0'}).commit('feat(cli)!: new line', ['kit']), branch: 'next',
      records: {'kit-ts': {'x-channel': {line: '0.6.0', channel: 'beta'}}}};
  }, expect: [GROUP_NEXT], versions: all('0.6.0-alpha.0'), stock: [T('kit', '0.6.0-alpha.3')]},

  {id: 'k8', label: 'kit opens 0.6.0, kit-ts promoted on its old 0.5.0 line: alpha.0, the old record dropped', build() {
    return {r: nextRepo({kit: '0.5.1-alpha.3'}, {kit: '0.5.0'}).commit('feat(cli)!: new line', ['kit']), branch: 'next',
      records: {'kit-ts': {'x-channel': {line: '0.5.0', channel: 'beta'}}}};
  }, expect: [GROUP_NEXT], versions: all('0.6.0-alpha.0'), cleared: {'kit-ts': ['x-channel']}, stock: [T('kit', '0.6.0-alpha.3')]},

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

const PATH_OF_C = require('./helpers/fixture').PATH_OF;

for (const s of SCENARIOS) {
  test(`(${s.id}) ${s.label}`, async () => {
    const {r, branch, records = {}, packages = {}, land: doLand} = await s.build();
    const cfg = config({records, packages});
    const res = await propose(r, branch, cfg);
    // stock release-please on the same repository, for the printed table only
    const stock = PRINT
      ? (await propose(r, branch, config({versioning: 'prerelease', packages: {...packages, ...(s.stockType ? Object.fromEntries(Object.keys(records).map(c => [PATH_OF_C[c], {'prerelease-type': s.stockType}])) : {})}}))).titles
      : s.stock;
    ROWS.push({s, titles: res.titles, versions: res.prs.flatMap(p => p.versions), stock, blocked: res.blocked, skipped: res.skipped});
    assert.deepEqual([...res.titles].sort(), [...s.expect].sort(), res.notes.join('\n'));
    if (s.versions) assert.deepEqual([...res.prs.find(p => p.title.includes('libraries')).versions].sort(), [...s.versions].sort());
    for (const [key, want] of [['blocked', s.blocked || {}], ['skipped', s.skipped || {}]]) {
      assert.deepEqual([...new Set(res[key].map(b => b.component))].sort(), Object.keys(want).sort(), `${key}\n${res.notes.join('\n')}`);
      for (const b of res[key]) assert.match(b.reason, want[b.component]);
    }
    if (s.note) assert.ok(res.notes.some(n => s.note.test(n)), res.notes.join('\n'));
    if (s.cleared) {
      // the release PRs drop exactly the records their versions make stale
      for (const [c, rec] of Object.entries(records)) {
        const pr = res.prs.find(p => p.title.includes(` ${c} `) || p.versions.some(x => x.startsWith(`${c}: `)));
        const after = pr && pr.config ? pr.config.packages[PATH_OF_C[c]] : cfg.packages[PATH_OF_C[c]];
        for (const key of Object.keys(rec)) {
          assert.equal(after[key] === undefined, (s.cleared[c] || []).includes(key), `${c} ${key} after the release PR`);
        }
      }
      for (const pr of res.prs.filter(p => p.config)) {
        const touched = Object.entries(pr.config.packages).filter(([p, v]) => JSON.stringify(v) !== JSON.stringify(cfg.packages[p])).map(([p]) => p);
        assert.ok(touched.every(p => Object.keys(s.cleared).map(c => PATH_OF_C[c]).includes(p)), `only stale records change: ${touched}`);
      }
    }
    if (doLand) {
      // merge every proposed PR (with the config it writes), then propose again
      const tags = [];
      let merged = cfg;
      for (const p of res.prs) {
        if (p.config) merged = {...merged, packages: {...merged.packages, ...p.config.packages}};
        tags.push(...await land(r, branch, merged, p.pr));
      }
      assert.deepEqual(tags.sort(), [...s.landed].sort());
      const after = await propose(r, branch, merged);
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
      ...[...new Set(row.blocked.map(b => b.reason))].map(b => `blocked: ${b}`),
      ...row.skipped.map(x => `skipped ${x.name}: ${x.reason}`)];
    console.log(`| ${row.s.id} | ${row.s.label} | ${cell(ext)} | ${cell(row.stock)} |`);
  }
});
