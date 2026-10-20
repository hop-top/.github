#!/usr/bin/env node
'use strict';
// Mutation check: re-introduce each defect the rules exist to prevent, in a
// scratch copy of this package, and require the test suite to go red. The
// unmutated copy must be green first.
//
//   node test/mutate.js            all mutations
//   node test/mutate.js M1 M3      some
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');

const PKG = path.join(__dirname, '..');

const MUTATIONS = [
  {id: 'M1', what: 'counter carry: a moved line keeps counting instead of restarting',
    file: 'lib/rules.js', from: "return decision(atChannel(req, FIRST), 'line',", to: "return decision({...req, pre: bumpCounter(C.pre)}, 'line',",
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M2', what: 'no alpha.0 reset: a moved line keeps the old line\'s promoted channel',
    file: 'lib/rules.js', from: "return decision(atChannel(req, FIRST), 'line',", to: "return decision(atChannel(req, promotedOn(promotion, T) || FIRST), 'line',",
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M3', what: 'backwards group move: members already on the target line are not counted',
    file: 'lib/rules.js', from: 'for (const m of M) if (onT(m.current)) top[', to: 'for (const m of M) if (false) top[',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M4', what: 'a linked release changes a channel: every member takes the highest channel on the line',
    file: 'lib/rules.js', from: 'const channelFor = m => (onT(m.current) ? higher(', to: 'const channelFor = m => Object.keys(top).reduce(higher, FIRST) || (onT(m.current) ? higher(',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M5', what: 'maintenance branch accepts a feat',
    file: 'lib/rules.js', from: 'if (summary.breaking || summary.feat) {\n    return blocked(\'not-patch\'', to: 'if (summary.breaking) {\n    return blocked(\'not-patch\'',
    tests: ['test/rules.test.js', 'test/scenarios.test.js', 'test/runner.test.js']},
  {id: 'M6', what: 'stable branch promotes an alpha/beta',
    file: 'lib/rules.js', from: "if (channelOf(C.pre) !== 'rc') {", to: 'if (false) {',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M7', what: 'Release-As footers are honoured again',
    file: 'lib/install.js', from: "const kept = notes.filter(n => n.title !== 'RELEASE AS');", to: 'const kept = notes;',
    tests: ['test/scenarios.test.js']},
  {id: 'M8', what: 'no promotion PR on the stable branch without new commits',
    file: 'lib/install.js', from: "const FORCED = {stable: ['promote'],", to: 'const FORCED = {stable: [],',
    tests: ['test/scenarios.test.js', 'test/runner.test.js']},
  {id: 'M9', what: 'stable 0.x releases created as GitHub prereleases',
    file: 'lib/runner.js', from: 'prerelease: !!r.tag.version.preRelease}', to: 'prerelease: r.prerelease}',
    tests: ['test/runner.test.js']},
  {id: 'M10', what: 'superseded release PRs left open',
    file: 'lib/runner.js', from: "    await github.octokit.pulls.update(", to: "    if (false) await github.octokit.pulls.update(",
    tests: ['test/runner.test.js']},
  {id: 'M11', what: 'linked family links on every proposal (stock linked-versions)',
    file: 'lib/rules.js', from: '  if (!triggers.length) {\n', to: '  if (!M.some(m => m.proposed)) {\n',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M12', what: 'a promotion does not expire: applied whatever line it was recorded for',
    file: 'lib/rules.js', from: 'const promotedOn = (promotion, T) => (promotion && cmpCore(promotion.line, T) === 0 ? promotion.channel : undefined);',
    to: 'const promotedOn = (promotion, T) => (promotion ? promotion.channel : undefined);',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M13', what: 'an open line below the required target is accepted',
    file: 'lib/rules.js', from: 'if (cmpCore(line, required) < 0) {', to: 'if (false) {',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M14', what: 'a release PR keeps the records its version made stale',
    file: 'lib/install.js', from: 'if (!keys.length) return pr;', to: 'if (true) return pr;',
    tests: ['test/scenarios.test.js', 'test/runner.test.js']},
  {id: 'M15', what: 'promote.js lets a channel skip a step (alpha -> rc)',
    file: 'lib/promote.js', from: 'if (STEP[own] !== value) {', to: 'if (false) {',
    tests: ['test/promote.test.js']},
  {id: 'M16', what: 'held guard off: a linked group releases while a member is blocked on its own',
    file: 'lib/install.js', from: 'const reasons = g.blocked.length ? g.blocked : held.length', to: 'const reasons = g.blocked.length ? g.blocked : false',
    tests: ['test/scenarios.test.js']},
  {id: 'M17', what: 'over-rc: a change needing more than the rc raises the stable instead of blocking',
    file: 'lib/rules.js', from: "return blocked('over-rc',", to: "return decision(req, 'over-rc',",
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M18', what: 'an alpha / beta on a stable branch fails the run instead of being skipped',
    file: 'lib/rules.js', from: "return skipped('not-rc',", to: "return blocked('not-rc',",
    tests: ['test/rules.test.js', 'test/scenarios.test.js', 'test/runner.test.js']},
  {id: 'M19', what: 'a promotion / open line is not cut until a user-facing commit lands',
    file: 'lib/install.js', from: "prerelease: ['channel', 'open-line'],", to: 'prerelease: [],',
    tests: ['test/scenarios.test.js', 'test/runner.test.js']},
  {id: 'M20', what: 'a new minor line links the family after 1.0',
    file: 'lib/rules.js', from: 'return V.major === 0 && C.major === 0 && V.minor > C.minor;', to: 'return V.major === C.major && V.minor > C.minor;',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M21', what: 'promote.js measures the step from a promotion not released yet (alpha -> pending beta -> rc)',
    file: 'lib/promote.js', from: 'if (STEP[own] !== value) {', to: 'if (STEP[pending || own] !== value) {',
    tests: ['test/promote.test.js']},
  {id: 'M22', what: 'close guard off: a hand-opened PR with the release label is closed',
    file: 'lib/runner.js', from: 'if (proposed.has(pr.headBranchName) || !I.BranchName.parse(pr.headBranchName, logger)) continue;', to: 'if (proposed.has(pr.headBranchName)) continue;',
    tests: ['test/runner.test.js']},
  {id: 'M23', what: 'a config refusal also stops the releases of merged release PRs',
    file: 'lib/runner.js', from: '    const {m} = await prepare();\n',
    to: '    const {m, raw} = await prepare();\n    if ((await checkConfig(m, inputs.configFile, raw, await github.getFileJson(inputs.manifestFile, github.repository.defaultBranch))).length) return {exitCode: 1, outputs: out.seen, blocked: [], closed};\n',
    tests: ['test/runner.test.js']},
  {id: 'M24', what: 'a linked stable release ships a member that is not at an rc of the target',
    file: 'lib/rules.js', from: 'if (notRc.length) {', to: 'if (false) {',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M25', what: 'a promotion may skip a channel (rules, runner)',
    file: 'lib/rules.js', from: 'const skipsChannel = (promoted, own) => !!promoted && rank(promoted) > rank(own) + 1;', to: 'const skipsChannel = () => false;',
    tests: ['test/rules.test.js', 'test/runner.test.js']},
  {id: 'M26', what: 'a prerelease on a maintenance branch is released as a stable',
    file: 'lib/rules.js', from: "if (C.pre) {\n    return skipped('not-stable',", to: "if (false) {\n    return skipped('not-stable',",
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M27', what: 'release PRs on a stable branch edit the records (main/next churn)',
    file: 'lib/install.js', from: "|| ctx.kind !== 'prerelease') return pr;", to: ') return pr;',
    tests: ['test/scenarios.test.js']},
  {id: 'M28', what: 'a linked member takes a promotion for a line it never reached',
    file: 'lib/rules.js', from: 'const channelFor = m => (onT(m.current) ? higher(channelOf(m.current.pre), promotedOn(m.promotion, T)) : FIRST);',
    to: 'const channelFor = m => higher(onT(m.current) ? channelOf(m.current.pre) : FIRST, promotedOn(m.promotion, T));',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M29', what: 'a root package without a component is booked as "." (its stale PR stays open)',
    file: 'lib/install.js', from: 'kind: k, branch: this.targetBranch, prereleaseBranch, component, name,', to: 'kind: k, branch: this.targetBranch, prereleaseBranch, component: name, name,',
    tests: ['test/runner.test.js']},
  {id: 'M30', what: 'records are checked against the manifest on every branch',
    file: 'lib/runner.js', from: "if (bad || roleOf(manifest, raw, p) !== 'prerelease') continue;", to: 'if (bad) continue;',
    tests: ['test/runner.test.js']},
  {id: 'M31', what: 'a linked member with no user-facing commit is left out of the group PR',
    file: 'lib/install.js', from: 'withRecordCleanup(await build(cs, latest, draft, labels, {newVersion: Version.parse(version)}), m.ctx);',
    to: 'withRecordCleanup(await build(cs, latest, draft, labels), m.ctx);',
    tests: ['test/scenarios.test.js']},
  {id: 'M32', what: "prerelease-type 'alpha' accepted (runner disagrees with the preflight)",
    file: 'lib/runner.js', from: "String(c.prereleaseType) !== 'alpha.0'", to: "!/^alpha(\\.0)?$/.test(String(c.prereleaseType))",
    tests: ['test/runner.test.js']},
  {id: 'M33', what: 'a skipped package fails the run',
    file: 'lib/runner.js', from: 'exitCode: blocked.length ? 1 : 0, outputs: out.seen, blocked, skipped, closed', to: 'exitCode: blocked.length || skipped.length ? 1 : 0, outputs: out.seen, blocked, skipped, closed',
    tests: ['test/runner.test.js']},
  {id: 'M34', what: 'a feat / breaking change on a stable package ships unpreviewed (plain stable bump)',
    file: 'lib/rules.js', from: '  if (!C.pre) {\n    const base = maxV(core(C), S);\n',
    to: "  if (!C.pre) {\n    const base = maxV(core(C), S);\n    return decision(bumpStable(base, summary), 'bump', 'plain stable bump');\n",
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M35', what: 'a feat on a stable package ships unpreviewed (only a breaking change blocks)',
    file: 'lib/rules.js', from: "if (summary.breaking || summary.feat) {\n      return blocked('unpreviewed',", to: "if (summary.breaking) {\n      return blocked('unpreviewed',",
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M36', what: 'a breaking change on a stable package ships unpreviewed (only a feat blocks)',
    file: 'lib/rules.js', from: "if (summary.breaking || summary.feat) {\n      return blocked('unpreviewed',", to: "if (summary.feat) {\n      return blocked('unpreviewed',",
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M37', what: 'an rc of a target already released is bumped instead of blocked (rc-released)',
    file: 'lib/rules.js', from: "    return blocked('rc-released',", to: "    return decision(bumpStable(S, summary), 'bump', 'released target: bump');\n    return blocked('rc-released',",
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M38', what: 'promote.js refuses a whole group when one member is already on / promoted to the channel',
    file: 'lib/promote.js', from: 'else notes.push(`${name}: unchanged, ${edit.same}`);', to: 'else problems.push(`${name}: ${edit.same}`);',
    tests: ['test/promote.test.js']},
  {id: 'M39', what: 'promote.js silently accepts a package named with --package that is already on the channel',
    file: 'lib/promote.js', from: 'if (explicit.has(p)) problems.push(', to: 'if (false) problems.push(',
    tests: ['test/promote.test.js']},
  {id: 'M40', what: 'linked stable block tells an alpha member to go straight to rc (skipping beta)',
    file: 'lib/rules.js', from: ": channelOf(m.current.pre) === 'alpha' ? 'via beta to rc' : 'to rc');", to: ": 'to rc');",
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M41', what: 'a line moved past a target released meanwhile (main hotfix) keeps counting',
    file: 'lib/rules.js', from: "    const v = bumpStable(S, summary);\n    return decision(atChannel(v, FIRST), 'line',", to: "    const v = bumpStable(S, summary);\n    return decision({...v, pre: bumpCounter(C.pre)}, 'line',",
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M42', what: 'a package never released is opened at its initial-version on every branch (no unreleased check)',
    file: 'lib/install.js', from: 'const first = latestRelease ? undefined : rules.unreleased(ctx);', to: 'const first = undefined;',
    tests: ['test/scenarios.test.js', 'test/runner.test.js']},
  {id: 'M43', what: 'a package never released is opened at its initial-version on a stable branch',
    file: 'lib/rules.js', from: "if (kind === 'stable') {\n    return skipped('unreleased',", to: "if (false) {\n    return skipped('unreleased',",
    tests: ['test/rules.test.js', 'test/scenarios.test.js', 'test/runner.test.js']},
  {id: 'M44', what: 'a package never released is opened at its initial-version on a maintenance branch',
    file: 'lib/rules.js', from: "if (kind === 'maintenance') {\n    return skipped('unreleased',", to: "if (false) {\n    return skipped('unreleased',",
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M45', what: 'a pre-1.0 minor does not link on a stable branch (each member cut from its own rc)',
    file: 'lib/rules.js', from: '    return V.major === 0 && ref.major === 0 && V.minor > ref.minor;', to: '    return false;',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M46', what: 'a pre-1.0 patch (a hotfix) links the family on a stable branch',
    file: 'lib/rules.js', from: 'return V.major === 0 && ref.major === 0 && V.minor > ref.minor;', to: 'return V.major === 0 && cmpCore(V, ref) > 0;',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M47', what: 'a minor from 1.0 links the family on a stable branch',
    file: 'lib/rules.js', from: 'return V.major === 0 && ref.major === 0 && V.minor > ref.minor;', to: 'return V.major === ref.major && V.minor > ref.minor;',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M48', what: 'a linked stable cut takes its target from every member (a stable member\'s patch raises it, the already-stable member goes unnamed)',
    file: 'lib/rules.js', from: 'const L = triggers.reduce((a, m) => maxV(a, m.proposed), undefined);', to: 'const L = M.reduce((a, m) => maxV(a, m.proposed), undefined);',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M49', what: 'a target package whose manifest is on a channel the rules do not know (experimental.N) is accepted',
    file: 'lib/runner.js', from: 'if (ch !== undefined && !rules.CHANNELS.includes(ch)) {', to: 'if (false) {',
    tests: ['test/runner.test.js']},
  {id: 'M50', what: 'a linked prerelease target takes every member\'s proposal (a member\'s own patch raises it, the already-stable member does not block)',
    file: 'lib/rules.js', from: 'let T = core(triggers.reduce((a, m) => maxV(a, m.proposed), undefined));', to: 'let T = core(M.reduce((a, m) => maxV(a, m.proposed), undefined));',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M51', what: 'a member\'s live preview of its own patch line raises the linked prerelease target',
    file: 'lib/rules.js', from: "startsLinkedLine({kind: 'stable', current: m.current, proposed: core(m.current), lastStable: m.lastStable});", to: 'true;',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M52', what: 'a linked member already past the prerelease target is moved backwards to it',
    file: 'lib/rules.js', from: 'if (m.current && cmp(v, m.current) <= 0) return pastTarget(m, T);', to: '',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M53', what: 'a no-stable member\'s 1.0 line from its initial version raises the linked prerelease target (the family pulled to 1.0)',
    file: 'lib/rules.js', from: 'const previewsLinkedLine = m => !fromInitial(m) && ', to: 'const previewsLinkedLine = m => ',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M54', what: 'a no-stable member\'s 1.0 line from its initial version links the family (the stable branch pulled to 1.0)',
    file: 'lib/rules.js', from: 'm.proposed && m.current && !fromInitial(m) &&', to: 'm.proposed && m.current &&',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M55', what: 'a no-stable member cuts 1.0 from its initial version on its own while the family is before 1.0',
    file: 'lib/rules.js', from: "} else if (kind === 'stable' && fromInitial(m)) {", to: '} else if (false) {',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M56', what: 'a linked member\'s first release past the family\'s line (1.0 included) opens on its own',
    file: 'lib/rules.js', from: 'const off = advised ? cmpCore(m.proposed, advised) : 0;', to: 'const off = advised ? Math.min(0, cmpCore(m.proposed, advised)) : 0;',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M57', what: 'a member\'s first release (its initial version) raises the linked prerelease target',
    file: 'lib/rules.js', from: 'let T = core(triggers.reduce((a, m) => maxV(a, m.proposed), undefined));', to: 'let T = core([...triggers, ...M.filter(m => !m.current)].reduce((a, m) => maxV(a, m.proposed), undefined));',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M58', what: 'a family from 1.0 counts as before 1.0 (its first releases and no-stable majors held to 1.0)',
    file: 'lib/rules.js', from: 'const preOne = !!highest && highest.major === 0;', to: 'const preOne = !!highest;',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M59', what: 'a linked member with no release yet gets no first-release proposal (its initial version goes unchecked)',
    file: 'lib/install.js', from: "if (latest || kind === 'prerelease') {", to: 'if (latest) {',
    tests: ['test/scenarios.test.js']},
  {id: 'M60', what: 'a member blocked on its own while the group is independent still releases',
    file: 'lib/install.js', from: '          out[m.p] = blockedStrategy(m.s);\n        }\n        return out;', to: '        }\n        return out;',
    tests: ['test/scenarios.test.js']},
  {id: 'M61', what: 'a new pre-1.0 minor line at a patch (x-open-line 0.6.1 from 0.5.0) does not link on a stable branch',
    file: 'lib/rules.js', from: 'return V.major === 0 && ref.major === 0 && V.minor > ref.minor;', to: 'return V.major === 0 && V.patch === 0 && cmpCore(V, ref) > 0;',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M62', what: 'before 1.0 means any member at 0.x (a 1.x family with a late 0.x member held to 1.0 rules)',
    file: 'lib/rules.js', from: 'const preOne = !!highest && highest.major === 0;', to: 'const preOne = M.some(m => m.current && m.current.major === 0);',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M63', what: 'a no-stable member\'s line from 1.0 (its initial version) lifts the family out of before 1.0',
    file: 'lib/rules.js', from: '(stableOf(m) || m.current.major === 0) ? core(m.current)', to: 'true ? core(m.current)',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M64', what: 'promote.js open-line --group refuses the whole group when a member is already on the line',
    file: 'lib/promote.js', from: 'if (cur.pre && c === 0) return {same: `at ${rules.fmt(cur)}: line ${value} already reached`};',
    to: 'if (cur.pre && c === 0) return {problem: `${name}: at ${rules.fmt(cur)}: line ${value} already reached`};',
    tests: ['test/promote.test.js']},
  {id: 'M65', what: 'promote.js open-line --group refuses the whole group when a member has no release yet',
    file: 'lib/promote.js', from: "if (command === 'open-line' && !explicit.has(p)) {", to: 'if (false) {',
    tests: ['test/promote.test.js']},
  {id: 'M66', what: 'a new member is advised the family\'s line already released stable (its rc then blocks the family on main)',
    file: 'lib/rules.js', from: 'const advised = openLine || (highestStable && {...core(highestStable), patch: highestStable.patch + 1});', to: 'const advised = openLine || highestStable;',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M67', what: 'a first release past the family\'s line is blocked only from 1.0 (0.9.0-alpha.0 in a 0.5 family opens)',
    file: 'lib/rules.js', from: 'const off = advised ? cmpCore(m.proposed, advised) : 0;', to: 'const off = advised ? (m.proposed.major < 1 ? Math.min(0, cmpCore(m.proposed, advised)) : cmpCore(m.proposed, advised)) : 0;',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M68', what: 'a first release that is not a prerelease opens on the prerelease branch',
    file: 'lib/rules.js', from: 'if (m.proposed.pre && off === 0) continue;', to: 'if (off === 0) continue;',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M69', what: 'a new member is advised the patch line after the stable even when the family has a line open above it',
    file: 'lib/rules.js', from: 'const advised = openLine || (highestStable', to: 'const advised = (highestStable',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M70', what: 'the step summary shows a blocked package\'s decision next to its block',
    file: 'lib/runner.js', from: 'for (const d of report.decisions.values()) if (!blocked.has(d.component)) lines.push(', to: 'for (const d of report.decisions.values()) lines.push(',
    tests: ['test/runner.test.js']},
  {id: 'M71', what: 'a linked member blocked alone is not reported (the run passes, its stale PR stays open)',
    file: 'lib/install.js', from: '          report.block(m.component, r, m.ctx.name);\n          this.logger.error(', to: '          this.logger.error(',
    tests: ['test/runner.test.js', 'test/scenarios.test.js']},
  {id: 'M72', what: 'on a stable branch a no-stable member is measured from below its own line (its 0.6.1 beside a stable 0.5.0 is cut alone)',
    file: 'lib/rules.js', from: "const measuredFrom = m => m.lastStable || (kind === 'stable' && highestStable && cmpCore(m.current, highestStable) > 0 ? highestStable : undefined);", to: 'const measuredFrom = m => m.lastStable;',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M73', what: 'a linked member\'s first release below the family\'s line opens on its own',
    file: 'lib/rules.js', from: 'const off = advised ? cmpCore(m.proposed, advised) : 0;', to: 'const off = advised ? Math.max(0, cmpCore(m.proposed, advised)) : 0;',
    tests: ['test/rules.test.js', 'test/scenarios.test.js']},
  {id: 'M74', what: 'promote.js open-line --group tells a member with no release yet it takes the group version when the line does not link',
    file: 'lib/promote.js', from: '${links ? "it takes the group\'s version"', to: '${true ? "it takes the group\'s version"',
    tests: ['test/promote.test.js']},
  {id: 'M75', what: 'promote.js channel promotes a linked member a linked gap behind its family without a word',
    file: 'lib/promote.js', from: 'if (behind) warnings.push(behind);', to: '',
    tests: ['test/promote.test.js']},
  {id: 'M76', what: 'promote.js warns on any gap behind the family (a pre-1.0 patch, a minor from 1.0), not only a linked one',
    file: 'lib/promote.js', from: "if (top && rules.startsLinkedLine({kind: 'prerelease', current: rules.fmt(line), proposed: rules.fmt(top)})) {", to: 'if (top && rules.cmpCore(top, line) > 0) {',
    tests: ['test/promote.test.js']},
];

function copy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-target-mut-'));
  for (const e of ['index.js', 'package.json', 'lib', 'test', 'bin']) fs.cpSync(path.join(PKG, e), path.join(dir, e), {recursive: true});
  fs.symlinkSync(path.join(PKG, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  return dir;
}

function suite(dir, tests) {
  const r = spawnSync(process.execPath, ['--test', ...tests], {cwd: dir, encoding: 'utf8'});
  const failed = (r.stdout.match(/^ℹ fail (\d+)/m) || [])[1];
  return {code: r.status, failed: failed === undefined ? '?' : failed};
}

const only = process.argv.slice(2);
const chosen = MUTATIONS.filter(m => !only.length || only.includes(m.id));
const base = copy();
try {
  const all = [...new Set(chosen.flatMap(m => m.tests))];
  const clean = suite(base, all);
  if (clean.code !== 0) {
    console.error(`unmutated suite is not green (${clean.failed} failing): fix that first`);
    process.exit(2);
  }
  let survived = 0;
  for (const m of chosen) {
    const dir = copy();
    try {
      const file = path.join(dir, m.file);
      const src = fs.readFileSync(file, 'utf8');
      if (!src.includes(m.from)) throw new Error(`${m.id}: mutation does not apply to ${m.file} (source changed?)`);
      fs.writeFileSync(file, src.replace(m.from, m.to));
      const r = suite(dir, m.tests);
      const killed = r.code !== 0;
      if (!killed) survived++;
      console.log(`${m.id} ${killed ? 'killed  ' : 'SURVIVED'} ${String(r.failed).padStart(2)} failing  ${m.what}`);
    } finally {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  }
  console.log(`${chosen.length - survived}/${chosen.length} mutations killed`);
  process.exitCode = survived ? 1 : 0;
} finally {
  fs.rmSync(base, {recursive: true, force: true});
}
