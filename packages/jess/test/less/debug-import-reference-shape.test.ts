import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { createRequire } from 'module';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { type Rules, type Ruleset, type Context } from '@jesscss/core';
import { isNode } from '@jesscss/core';
import { N } from '@jesscss/core';

const require = createRequire(import.meta.url);
const testData = path.dirname(require.resolve('@less/test-data'));

const compiler = new Compiler({
  output: { collapseNesting: true },
  compile: {
    plugins: [
      lessPlugin(),
      lessCompatPlugin()
    ]
  }
});

describe('debug import-reference shape', () => {
  it('materializes reference-import mixin output directly under the caller body', async () => {
    const lessPath = path.join(testData, 'tests-unit/import/import-reference.less');
    const { context, tree } = await compiler.compile(lessPath);
    const root = tree as Rules;

    const bRuleset = Array.from(root.value).find((node) => (
      isNode(node, N.Ruleset)
      && String((node as Ruleset).getRenderableSelector(true, context)?.valueOf?.() ?? '') === '.b'
    )) as Ruleset | undefined;

    expect(bRuleset).toBeDefined();

    const bRules = bRuleset!.enterRules(context);
    const bContext = {
      ...context,
      renderKey: bRules.renderKey,
      rulesContext: bRules
    } as Context;

    const emitted = bRules.getRegistryChildren(bContext)[0] as Rules;
    const emittedContext = {
      ...context,
      renderKey: emitted.renderKey,
      rulesContext: emitted
    } as Context;

    const flattenedRulesets = emitted.flatRules(true, emittedContext)
      .filter((child): child is Ruleset => isNode(child, N.Ruleset));
    const selfRuleset = flattenedRulesets.find((child) => (
      isNode(child, N.Ruleset)
      && String((child as Ruleset).getRenderableSelector(true, emittedContext)?.valueOf?.() ?? '') === '.b'
    )) as Ruleset | undefined;

    expect(selfRuleset).toBeDefined();
    expect(String(selfRuleset!.getOwnSelector()?.valueOf?.() ?? '')).toBe('&');
    expect(String(selfRuleset!.getRenderableSelector(true, emittedContext)?.valueOf?.() ?? '')).toBe('.b');
    expect(flattenedRulesets.some(child => (
      String(child.getRenderableSelector(true, emittedContext)?.valueOf?.() ?? '').includes('.only-with-visible')
    ))).toBe(false);
  });
});
