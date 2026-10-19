'use strict';
// Edits to one package block of a release-please config, keeping the rest
// of the file as written (jsonc-parser edits in place; only the touched
// property is formatted). Shared by bin/promote.js and the release-PR
// cleanup of expired records.
const {modify, applyEdits, parse, printParseErrorCode} = require('jsonc-parser');

function formatting(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const m = text.match(/\n([ \t]+)\S/);
  const indent = m ? m[1] : '  ';
  return indent[0] === '\t'
    ? {insertSpaces: false, tabSize: 1, eol}
    : {insertSpaces: true, tabSize: indent.length, eol};
}

function parseConfig(text, file = 'config') {
  const errors = [];
  const json = parse(text, errors, {allowTrailingComma: false, disallowComments: true});
  if (errors.length) throw new Error(`${file}: not valid JSON (${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset})`);
  return json;
}

// Inline objects stay on one line: `"x-channel": {"line": "0.6.0", "channel": "beta"}`.
const inline = v => (v && typeof v === 'object' && !Array.isArray(v)
  ? `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${JSON.stringify(x)}`).join(', ')}}`
  : JSON.stringify(v));

/** setPackageKey(text, packagePath, key, value) -> text */
function setPackageKey(text, pkg, key, value) {
  const json = parseConfig(text);
  if (!json.packages || !json.packages[pkg]) throw new Error(`no package "${pkg}" in the config`);
  const placeholder = `\u0000release-please-target:${key}\u0000`;
  const edited = applyEdits(text, modify(text, ['packages', pkg, key], placeholder, {formattingOptions: formatting(text)}));
  return edited.replace(JSON.stringify(placeholder), inline(value));
}

/** removePackageKeys(text, packagePath, keys) -> text (unchanged if absent) */
function removePackageKeys(text, pkg, keys) {
  let out = text;
  for (const key of keys) {
    const json = parseConfig(out);
    if (!json.packages || !json.packages[pkg] || !(key in json.packages[pkg])) continue;
    out = applyEdits(out, modify(out, ['packages', pkg, key], undefined, {formattingOptions: formatting(out)}));
  }
  return out;
}

module.exports = {setPackageKey, removePackageKeys, parseConfig};
