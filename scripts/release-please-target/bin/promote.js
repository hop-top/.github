#!/usr/bin/env node
'use strict';
// Manual target-versioning steps as release-please config edits.
//
//   promote.js channel beta|rc      (--package <path|component> | --group <name>)...
//   promote.js open-line <x.y.z>    (--package ... | --group ...)...
//   promote.js clear channel|open-line|all (--package ... | --group ...)...
//
// Options: --config <file> (default .github/release-please-config.json),
// --manifest <file> (default .github/.release-please-manifest.json),
// --dry-run (print, do not write). Exit 0 written, 1 refused, 2 usage.
const fs = require('fs');
const {parseArgs} = require('util');
const {promote} = require('../lib/promote');

const USAGE = `usage: promote.js <channel beta|rc | open-line x.y.z | clear channel|open-line|all>
                  (--package <path|component> | --group <name>)... [--config file] [--manifest file] [--dry-run]`;

function main(argv) {
  let args;
  try {
    args = parseArgs({args: argv, allowPositionals: true, options: {
      package: {type: 'string', multiple: true, short: 'p'},
      group: {type: 'string', multiple: true, short: 'g'},
      config: {type: 'string', default: '.github/release-please-config.json'},
      manifest: {type: 'string', default: '.github/.release-please-manifest.json'},
      'dry-run': {type: 'boolean', default: false},
      help: {type: 'boolean', short: 'h'},
    }});
  } catch (e) {
    process.stderr.write(`${e.message}\n${USAGE}\n`);
    return 2;
  }
  const {values: o, positionals: [command, value, ...extra]} = args;
  if (o.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (!command || value === undefined || extra.length) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const configText = fs.readFileSync(o.config, 'utf8');
  const manifest = JSON.parse(fs.readFileSync(o.manifest, 'utf8'));
  const r = promote({configText, manifest, command, value, packages: o.package || [], groups: o.group || []});
  if (r.problems.length) {
    for (const p of r.problems) process.stderr.write(`refused: ${p}\n`);
    return 1;
  }
  for (const w of r.warnings) process.stderr.write(`warning: ${w}\n`);
  for (const n of r.notes) process.stdout.write(`${n}\n`);
  for (const c of r.changes) process.stdout.write(`${c}\n`);
  if (!r.changes.length) process.stdout.write('nothing to change\n');
  else if (!o['dry-run']) fs.writeFileSync(o.config, r.text);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
