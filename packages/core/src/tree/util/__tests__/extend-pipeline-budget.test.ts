import { describe, expect, it } from 'vitest';
import { Context } from '../../../context.js';
import {
  el,
  extend,
  rules,
  ruleset
} from '../../index.js';
import { withExtendWorkCounters } from '../extend-work-counters.js';

function heapMB(): number {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
  }
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

async function runBudget(root: ReturnType<typeof rules>) {
  const context = new Context();
  heapMB();
  const heapBefore = heapMB();
  const start = performance.now();
  const { counters } = await withExtendWorkCounters(() => root.eval(context));
  const ms = performance.now() - start;
  const heapAfter = heapMB();
  return {
    counters,
    elapsedMs: ms,
    heapDeltaMB: heapAfter - heapBefore
  };
}

describe('extend pipeline budgets', () => {
  it('tier 1: no-extend fixtures stay near-zero for planner and rewrite work', async () => {
    const root = rules([
      ruleset({ selector: el('.a'), rules: rules([]) }),
      ruleset({ selector: el('.b'), rules: rules([]) }),
      ruleset({ selector: el('.c'), rules: rules([]) })
    ]);

    const { counters, elapsedMs, heapDeltaMB } = await runBudget(root);

    expect(counters.instructionsConsidered).toBe(0);
    expect(counters.routePlansBuilt).toBeLessThanOrEqual(20);
    expect(counters.groupRequirementsBuilt).toBe(0);
    expect(counters.rewritesApplied).toBe(0);
    expect(elapsedMs).toBeLessThan(250);
    expect(heapDeltaMB).toBeLessThan(16);
  });

  it('tier 1: disjoint extends do not rewrite and stay under small planner budgets', async () => {
    const root = rules([
      ruleset({ selector: el('.target-a'), rules: rules([]) }),
      ruleset({ selector: el('.target-b'), rules: rules([]) }),
      ruleset({ selector: el('.target-c'), rules: rules([]) }),
      ruleset({
        selector: el('.ext-a'),
        rules: rules([extend({ target: el('.missing-a') })])
      }),
      ruleset({
        selector: el('.ext-b'),
        rules: rules([extend({ target: el('.missing-b') })])
      })
    ]);

    const { counters, elapsedMs, heapDeltaMB } = await runBudget(root);

    expect(counters.rewritesApplied).toBe(0);
    expect(counters.rulesetsChanged).toBe(0);
    expect(counters.routePlansBuilt).toBeLessThanOrEqual(20);
    expect(counters.processExtendsPasses).toBeLessThanOrEqual(1);
    expect(elapsedMs).toBeLessThan(250);
    expect(heapDeltaMB).toBeLessThan(16);
  });

  it('tier 1: chained micro fixture has bounded passes', async () => {
    const root = rules([
      ruleset({ selector: el('.foo'), rules: rules([]) }),
      ruleset({
        selector: el('.bar'),
        rules: rules([extend({ target: el('.foo') })])
      }),
      ruleset({
        selector: el('.baz'),
        rules: rules([extend({ target: el('.bar') })])
      })
    ]);

    const { counters, elapsedMs, heapDeltaMB } = await runBudget(root);

    expect(counters.rulesetsChanged).toBeGreaterThanOrEqual(2);
    expect(counters.rulesetsChanged).toBeLessThanOrEqual(3);
    expect(counters.processExtendsPasses).toBeLessThanOrEqual(3);
    expect(counters.chainedFollowupEnqueues).toBeLessThanOrEqual(3);
    expect(elapsedMs).toBeLessThan(250);
    expect(heapDeltaMB).toBeLessThan(16);
  });
});
