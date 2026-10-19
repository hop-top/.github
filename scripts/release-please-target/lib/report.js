'use strict';
// Per GitHub client (one per runner invocation): the raw release-please
// config the run reads (release-please keeps only the keys it knows, so the
// `x-channel` / `x-open-line` records come from here), the version
// decisions, and the packages blocked from releasing. The runner attaches
// the config and reads the rest to fail the run and to explain why a stale
// release PR was closed.

const reports = new WeakMap();

class Report {
  constructor() {
    this.config = undefined; // {file, json}
    this.decisions = new Map(); // component -> {from, to, reason}
    this.blocked = new Map(); // `${component}\0${reason}` -> {component, reason}
  }
  decide(component, from, to, reason) {
    this.decisions.set(component, {component, from, to, reason});
  }
  block(component, reason) {
    this.blocked.set(`${component}\0${reason}`, {component, reason});
  }
  blockedComponents() {
    return new Set([...this.blocked.values()].map(b => b.component));
  }
  list() {
    return [...this.blocked.values()];
  }
}

function reportFor(github) {
  if (!reports.has(github)) reports.set(github, new Report());
  return reports.get(github);
}

function attachConfig(github, file, json) {
  reportFor(github).config = {file, json};
}

module.exports = {reportFor, attachConfig, Report};
