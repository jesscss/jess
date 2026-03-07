import type { Ruleset } from '../ruleset.js';

const rulesetTraceIds = new WeakMap<Ruleset, number>();
let nextRulesetTraceId = 1;

export function ensureRulesetTraceId(ruleset: Ruleset): number {
  let id = rulesetTraceIds.get(ruleset);
  if (!id) {
    id = nextRulesetTraceId++;
    rulesetTraceIds.set(ruleset, id);
  }
  return id;
}

export function getOptionalRulesetTraceId(ruleset: Ruleset): number | undefined {
  return rulesetTraceIds.get(ruleset);
}
