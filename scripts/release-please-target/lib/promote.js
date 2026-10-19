'use strict';
// The manual steps of target versioning, as config edits: promote a line's
// channel (x-channel) and open a line (x-open-line), for packages picked by
// path, by component, or by conditional-linked-versions group. All or
// nothing: one refused package and nothing is written. Once the edit lands
// on the prerelease branch, that run cuts the release PR for it.
const rules = require('./rules');
const {setPackageKey, removePackageKeys, parseConfig} = require('./config-edit');

const STEP = {alpha: 'beta', beta: 'rc'};
const KEYS = {channel: 'x-channel', 'open-line': 'x-open-line'};

function resolve(config, {packages = [], groups = []}) {
  const pkgs = config.packages || {};
  const byComponent = Object.fromEntries(Object.entries(pkgs).filter(([, c]) => c.component).map(([p, c]) => [c.component, p]));
  const out = [], problems = [];
  const add = p => {
    if (!out.includes(p)) out.push(p);
  };
  for (const sel of packages) {
    if (pkgs[sel]) add(sel);
    else if (byComponent[sel]) add(byComponent[sel]);
    else problems.push(`no package or component "${sel}" in the config`);
  }
  const plugins = (config.plugins || []).filter(p => p && typeof p === 'object' && p.type === 'conditional-linked-versions');
  for (const name of groups) {
    const g = plugins.find(p => p.groupName === name);
    if (!g) {
      problems.push(`no conditional-linked-versions group "${name}" in the config`);
      continue;
    }
    for (const c of g.components || []) {
      if (byComponent[c]) add(byComponent[c]);
      else problems.push(`group ${name}: component "${c}" is not configured`);
    }
  }
  if (!packages.length && !groups.length) problems.push('pick packages with --package and/or --group');
  return {paths: out, problems};
}

const nameOf = (config, p) => `${(config.packages[p] || {}).component || p} (${p})`;
const rank = ch => rules.CHANNELS.indexOf(ch);
const CUT = 'its release PR is cut on the next run on the prerelease branch';

function channelEdit(config, p, cur, value) {
  const name = nameOf(config, p);
  if (!cur.pre) return {problem: `${name}: at stable ${rules.fmt(cur)}: no open line to promote (its next release opens one on alpha)`};
  const target = rules.core(cur);
  const line = rules.fmt(target);
  let rec;
  try {
    rec = rules.promotionOf(config.packages[p]['x-channel']);
  } catch (e) {
    return {problem: `${name}: ${e.message}`};
  }
  // The step is measured from the channel the package is released on (the
  // manifest), not from a promotion recorded but not released yet.
  const own = cur.pre.split('.')[0];
  const pending = rec && rules.cmpCore(rec.line, target) === 0 && rank(rec.channel) > rank(own) ? rec.channel : undefined;
  if (value === own) return {problem: `${name}: already on ${value} for ${line}`};
  if (value === pending) return {problem: `${name}: already promoted to ${value} for ${line} (${CUT})`};
  if (rank(value) < rank(own)) return {problem: `${name}: on ${own} for ${line}: channels never move backwards`};
  if (STEP[own] !== value) {
    const wait = pending ? ` (the ${pending} promotion is not released yet: merge its release PR first)` : '';
    return {problem: `${name}: ${own} -> ${value} skips ${STEP[own]}: channels move alpha -> beta -> rc${wait}`};
  }
  return {key: 'x-channel', value: {line, channel: value}, change: `${name}: x-channel {"line": "${line}", "channel": "${value}"} (${rules.fmt(cur)} -> ${line}-${value}.0: ${CUT})`};
}

function openLineEdit(config, p, cur, open, value) {
  const name = nameOf(config, p);
  const reach = cur.pre ? rules.core(cur) : cur;
  if (rules.cmpCore(reach, open) >= 0) return {problem: `${name}: at ${rules.fmt(cur)}: line ${value} already reached`};
  return {key: 'x-open-line', value, change: `${name}: x-open-line "${value}" (${rules.fmt(cur)} -> ${value}-alpha.0, unless a change requires more: ${CUT})`};
}

/**
 * promote({configText, manifest, command, value, packages, groups})
 *   command  'channel' (value beta | rc) | 'open-line' (value x.y.z) | 'clear' (value channel | open-line | all)
 * -> {text, changes: [string], problems: [string]}; text is unchanged when problems is not empty
 */
function promote({configText, manifest, command, value, packages, groups}) {
  const config = parseConfig(configText);
  const {paths, problems} = resolve(config, {packages, groups});
  if (command === 'channel' && !['beta', 'rc'].includes(value)) problems.push(`channel: expected beta | rc, got "${value}" (every line starts on alpha)`);
  let open;
  if (command === 'open-line') {
    try {
      open = rules.openLineOf(value);
    } catch (e) {
      problems.push(e.message);
    }
  }
  if (command === 'clear' && !['channel', 'open-line', 'all'].includes(value)) problems.push(`clear: expected channel | open-line | all, got "${value}"`);
  if (!['channel', 'open-line', 'clear'].includes(command)) problems.push(`unknown command "${command}" (channel | open-line | clear)`);
  if (problems.length) return {text: configText, changes: [], problems};

  let text = configText;
  const changes = [];
  for (const p of paths) {
    const pkg = config.packages[p];
    const name = nameOf(config, p);
    if ((pkg.versioning || config.versioning) !== 'target') {
      problems.push(`${name}: does not use versioning "target"`);
      continue;
    }
    if (command === 'clear') {
      const keys = (value === 'all' ? Object.values(KEYS) : [KEYS[value]]).filter(k => pkg[k] !== undefined);
      if (!keys.length) continue;
      text = removePackageKeys(text, p, keys);
      changes.push(`${name}: removed ${keys.join(', ')}`);
      continue;
    }
    if (manifest[p] === undefined) {
      problems.push(`${name}: no version in the manifest`);
      continue;
    }
    const cur = rules.parse(manifest[p]);
    const edit = command === 'channel' ? channelEdit(config, p, cur, value) : openLineEdit(config, p, cur, open, value);
    if (edit.problem) {
      problems.push(edit.problem);
      continue;
    }
    text = setPackageKey(text, p, edit.key, edit.value);
    changes.push(edit.change);
  }
  if (problems.length) return {text: configText, changes: [], problems};
  return {text, changes, problems};
}

module.exports = {promote, resolve};
