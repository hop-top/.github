#!/usr/bin/env node
'use strict';
// Action-equivalent release-please run with target versioning; inputs are
// environment variables, see lib/runner.js.
const {run} = require('../lib/runner');

run().then(r => {
  process.exitCode = r.exitCode;
}, err => {
  process.stdout.write(`::error::release-please failed: ${err.message}\n`);
  if (err.stack) process.stderr.write(`${err.stack}\n`);
  process.exitCode = 1;
});
