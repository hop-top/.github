'use strict';
// What a run decided, per GitHub client (one per runner invocation): the
// version decisions, and the packages blocked from releasing. The plugins
// write here; the runner reads it to fail the run and to explain why a
// stale release PR was closed.

const reports = new WeakMap();

class Report {
  constructor() {
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

module.exports = {reportFor, Report};
