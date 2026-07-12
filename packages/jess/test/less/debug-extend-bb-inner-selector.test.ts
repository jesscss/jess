/**
 * Trace extend.less: what is the inner .bb ruleset's selector when we're about to apply .ee:extend(.bb)?
 * (a) Actual selector during evaluation
 * (b) Path through extend utilities
 * (c) Why extend does not reject
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { getTestCases } from '../test-utils.js';
import { syncLog } from '../../../core/src/tree/util/__tests__/debug-log.js';

const require = createRequire(import.meta.url);
const testData = path.dirname(require.resolve('@less/test-data'));

describe.todo('extend.less inner .bb selector trace', () => {
  it('logs inner .bb ruleset selector after eval (same pipeline as all-less)', async () => {
    const extendLessPath = path.join(testData, 'tests-unit/extend/extend.less');
    const testCases = getTestCases(extendLessPath);
    const testCase = testCases[0];
    if (!testCase) {
      throw new Error('no test case for extend.less');
    }
    const compiler = new Compiler({
      output: { collapseNesting: true, ...(testCase.config.output || {}) },
      compile: { plugins: [lessPlugin()] }
    });
    const context = compiler.createContext(extendLessPath, { outputFile: testCase.expectedFile });
    const { node } = await context.getTree(extendLessPath);
    const evald = await node.eval(context);

    // Find the inner .bb ruleset: nested ruleset that has decl "color" (the one with "color: black")
    function findInnerBbRuleset(r: any, depth: number): any {
      if (depth > 20) {
        return null;
      }
      if (!r || typeof r !== 'object') {
        return null;
      }
      if (r.type === 'Ruleset' && r.data?.rules?.data) {
        const parent = r.parent;
        const isNested = parent?.type === 'Rules' && parent?.parent?.type === 'Ruleset';
        const hasColorDecl = r.data.rules.data.some((c: any) => c?.data?.name?.valueOf?.() === 'color' || c?.data?.name === 'color');
        if (isNested && hasColorDecl) {
          const grandparentSel = parent?.parent?.data?.selector?.valueOf?.() ?? parent?.parent?.data?.selector ?? '';
          if (String(grandparentSel).includes('.bb')) {
            return r;
          }
        }
      }
      if (Array.isArray(r.data)) {
        for (const child of r.data) {
          const found = findInnerBbRuleset(child, depth + 1);
          if (found) {
            return found;
          }
        }
      }
      if (r.data?.rules?.data) {
        for (const child of r.data.rules.data) {
          const found = findInnerBbRuleset(child, depth + 1);
          if (found) {
            return found;
          }
        }
      }
      return null;
    }
    const inner = findInnerBbRuleset(evald, 0);
    const sel = inner?.data?.selector;
    const selStr = typeof sel?.valueOf === 'function' ? sel.valueOf() : String(sel);
    const selType = sel?.type ?? (sel && 'type' in sel ? (sel as any).type : undefined);
    syncLog({
      trace: 'extend_less_inner_bb_selector',
      message: 'Inner .bb ruleset selector after eval',
      selectorValueOf: selStr,
      selectorType: selType,
      hasSelector: !!sel
    });
    // Assert something so the test runs; we care about the log
    expect(selStr).toBeDefined();
  });
});
