'use strict';
// Per GitHub client (one per runner invocation): the raw release-please
// config the run reads (release-please keeps only the keys it knows, so the
// `x-channel` / `x-open-line` records come from here), the version
// decisions, the packages blocked from releasing (the run fails) and those
// skipped on this branch (a notice). The runner attaches the config and
// reads the rest to fail the run and to explain why a stale release PR
// was closed.
//
// `component` is release-please's component ('' for a package without
// one, as PR bodies and branch names carry it); `name` is what messages
// show (the component, or the package path).

const reports = new WeakMap();

class Report {
  constructor() {
    this.config = undefined; // {file, json}
    this.decisions = new Map(); // component -> {component, name, from, to, reason}
    this.blocked = new Map(); // `${component}\0${reason}` -> {component, name, reason}
    this.skipped = new Map(); // same shape
  }
  decide(component, from, to, reason, name = component) {
    this.decisions.set(component, {component, name, from, to, reason});
  }
  block(component, reason, name = component) {
    this.blocked.set(`${component}\0${reason}`, {component, name, reason});
  }
  skip(component, reason, name = component) {
    this.skipped.set(`${component}\0${reason}`, {component, name, reason});
  }
  blockedComponents() {
    return new Set([...this.blocked.values()].map(b => b.component));
  }
  list() {
    return [...this.blocked.values()];
  }
  // Skipped packages that are not also blocked (a linked group that cannot
  // move blocks a member the branch skipped).
  notices() {
    const blocked = this.blockedComponents();
    return [...this.skipped.values()].filter(s => !blocked.has(s.component));
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
