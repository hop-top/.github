'use strict';
// release-please-target: target versioning for release-please, installed
// into the release-please this package pins (package.json).
//
//   require('release-please-target')            registers the extension
//   node bin/run.js                             action-equivalent runner
const path = require('path');
const {install} = require('./lib/install');
const rules = require('./lib/rules');
const {run} = require('./lib/runner');

const rpRoot = path.dirname(require.resolve('release-please/package.json', {paths: [__dirname]}));
install(rpRoot);

module.exports = {install, rules, run, rpRoot};
