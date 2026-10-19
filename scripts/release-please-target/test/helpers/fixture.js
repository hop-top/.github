'use strict';
// Kit-shaped monorepo fixtures in a temp directory: kit at the root plus
// four SDK members linked as one family, and qmochi outside the family.
// Commit and tag dates are deterministic.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');
const {GIT_ENV} = require('./git-github');

const PKGS = {
  '.': {component: 'kit', 'exclude-paths': ['incubator', 'sdk']},
  'sdk/experimental/php': {component: 'kit-php'},
  'sdk/experimental/rs': {component: 'kit-rs'},
  'sdk/py': {component: 'kit-py'},
  'sdk/ts': {component: 'kit-ts'},
  'incubator/qmochi': {component: 'qmochi'},
};
const FAMILY = ['kit', 'kit-php', 'kit-py', 'kit-rs', 'kit-ts'];
const FILE = {
  kit: 'cli/a.go', 'kit-php': 'sdk/experimental/php/a.php', 'kit-rs': 'sdk/experimental/rs/a.rs',
  'kit-py': 'sdk/py/a.py', 'kit-ts': 'sdk/ts/a.ts', qmochi: 'incubator/qmochi/a.go',
};
const PATH_OF = Object.fromEntries(Object.entries(PKGS).map(([p, c]) => [c.component, p]));
const CONFIG = '.github/release-please-config.json';
const MANIFEST = '.github/.release-please-manifest.json';

/**
 * config({versioning, prereleaseType, plugins, groups, roles, extra})
 *   versioning  'target' (default) | 'prerelease' (stock release-please)
 *   groups      [[name, components]] conditional-linked-versions groups
 */
function config({versioning = 'target', prereleaseType = 'alpha.0', groups = [['kit', FAMILY]], roles = {}, packages: pkgExtra = {}} = {}) {
  const packages = {};
  for (const [p, c] of Object.entries(PKGS)) {
    packages[p] = {
      'release-type': 'go', ...c, 'changelog-path': 'CHANGELOG.md', 'bump-minor-pre-major': true,
      prerelease: true, 'prerelease-type': prereleaseType, versioning, ...(pkgExtra[p] || {}),
    };
  }
  const plugins = versioning === 'target'
    ? [{type: 'target-context', ...roles}, ...groups.map(([groupName, components]) => ({type: 'conditional-linked-versions', groupName, components}))]
    : [];
  return {
    'separate-pull-requests': true,
    'pull-request-title-pattern': 'chore(release): ${component} ${version}',
    'group-pull-request-title-pattern': 'chore${scope}: release ${component} libraries',
    'component-no-space': true,
    'include-component-in-tag': true,
    'tag-separator': '/',
    label: 'status:release-pending',
    'release-label': 'status:release-tagged',
    'changelog-sections': [
      {type: 'feat', section: 'Features'}, {type: 'fix', section: 'Bug Fixes'}, {type: 'perf', section: 'Performance'},
      {type: 'chore', section: 'Miscellaneous', hidden: true}, {type: 'ci', section: 'CI', hidden: true},
    ],
    plugins,
    packages,
  };
}

const roots = [];
process.on('exit', () => {
  for (const r of roots) fs.rmSync(r, {recursive: true, force: true});
});

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-target-'));
  roots.push(dir);
  let tick = 0;
  const run = (...args) => {
    tick++;
    const d = `${1700000000 + tick * 60} +0000`;
    return execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      env: {...process.env, ...GIT_ENV, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com'},
    });
  };
  const write = (f, s) => {
    fs.mkdirSync(path.dirname(path.join(dir, f)), {recursive: true});
    fs.writeFileSync(path.join(dir, f), s);
  };
  const r = {
    dir,
    git: run,
    manifest(versions) {
      const file = path.join(dir, MANIFEST);
      const cur = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
      for (const [c, v] of Object.entries(versions)) cur[PATH_OF[c]] = v;
      write(MANIFEST, JSON.stringify(cur, null, 2) + '\n');
    },
    commit(msg, components = []) {
      for (const c of components) write(FILE[c], `${tick}\n`);
      run('add', '-A');
      run('commit', '-q', '--allow-empty', '-m', msg);
      return r;
    },
    // A merged release PR: manifest + changelogs in one commit, then tags.
    release(versions, msg) {
      r.manifest(versions);
      for (const [c, v] of Object.entries(versions)) {
        const p = PATH_OF[c];
        write(p === '.' ? 'CHANGELOG.md' : `${p}/CHANGELOG.md`, `## ${v}\n`);
      }
      r.commit(msg || `chore(release): ${Object.entries(versions).map(([c, v]) => `${c} ${v}`).join(', ')}`);
      for (const [c, v] of Object.entries(versions)) run('tag', `${c}/v${v}`);
      return r;
    },
    tag(c, v) {
      run('tag', `${c}/v${v}`);
      return r;
    },
    checkout(...args) {
      run('checkout', '-q', ...args);
      return r;
    },
    head() {
      return run('rev-parse', 'HEAD').trim();
    },
  };
  run('init', '-q', '-b', 'main');
  for (const f of Object.values(FILE)) write(f, '0\n');
  write(CONFIG, '{}\n');
  return r;
}

const MAIN0 = {kit: '0.4.0', 'kit-php': '0.4.0', 'kit-rs': '0.4.0', 'kit-py': '0.4.0', 'kit-ts': '0.4.0', qmochi: '0.5.0'};
const NEXT0 = {kit: '0.5.0-alpha.26', 'kit-php': '0.5.0-alpha.2', 'kit-rs': '0.5.0-alpha.2', 'kit-py': '0.5.0-alpha.5', 'kit-ts': '0.5.0-alpha.3', qmochi: '0.2.0-alpha.1'};

// main with stable tags, then `next` cut from it carrying the NEXT0 line.
function nextRepo(overrides = {}, stables = {}) {
  const r = repo();
  r.commit('chore: initial');
  for (const [c, v] of Object.entries({kit: '0.4.0', 'kit-py': '0.4.0', 'kit-ts': '0.4.0', qmochi: '0.1.0', ...stables})) r.tag(c, v);
  r.checkout('-b', 'next');
  r.release({...NEXT0, ...overrides});
  return r;
}

module.exports = {PKGS, FAMILY, FILE, PATH_OF, CONFIG, MANIFEST, MAIN0, NEXT0, config, repo, nextRepo};
