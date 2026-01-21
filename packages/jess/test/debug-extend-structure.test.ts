import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { Compiler } from '../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { serializeTypes } from '@jesscss/core';
import { syncLog } from '../../core/src/tree/util/__tests__/debug-log.js';

describe('Debug extend structure from Less parser', () => {
  it('should inspect extend-exact :extend target shape', async () => {
    // Parse the actual Less file to see what structure it creates
    const lessFile = join(__dirname, '../../../../less.js/packages/test-data/tests-unit/extend-exact/extend-exact.less');

    const compiler = new Compiler({
      compile: {
        plugins: [lessPlugin()]
      }
    });

    const context = compiler.createContext(lessFile);
    const { node: tree } = await context.getTree(lessFile);

    // Eval the tree to trigger extend processing
    await tree.eval(context);

    // Access extends from context
    if (context.extends && context.extends.length > 0) {
      for (let i = 0; i < context.extends.length; i++) {
        const extend = context.extends[i]!;
        const [target, selectorWithExtend, partial, extendRoot, extendNode] = extend;

        const targetStr = target?.valueOf();
        const selectorStr = selectorWithExtend?.valueOf();

        // Look for the extend in extend-exact.less
        if (selectorStr === '.rep_ace') {
          syncLog({
            kind: 'debug:extend-exact:extend-entry',
            index: i,
            target: targetStr,
            targetType: (target as any)?.type ?? null,
            targetStructure: serializeTypes(target, { showValues: true, maxStringLength: 500 }),
            selectorWithExtend: selectorStr,
            partial,
            extendNodeType: (extendNode as any)?.type ?? null,
            extendNodeStructure: serializeTypes(extendNode, { showValues: true, maxStringLength: 500 })
          });
        }
      }
    }

    expect(true).toBe(true);
  });
});
