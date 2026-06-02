import { describe, expect, it } from 'vitest';
import { Context } from '../../../context.js';
import { any, call, decl, list, mixin, ref, rules, ruleset } from '../../index.js';
import { MixinCollection } from '../callable-collection.js';

describe('callable collection helper', () => {
  it('preserves the direct callable handoff outside rules.ts', async () => {
    const context = new Context({ leakyRules: true });
    context.depth = 2;

    const mixinDef = mixin({
      name: any('.button'),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });
    const callerRules = rules([]);
    const root = rules([
      mixinDef,
      ruleset({
        selector: any('.use'),
        rules: callerRules
      })
    ]);
    context.root = root;
    context.rulesContext = callerRules;

    const callable = new MixinCollection([mixinDef]);
    const mixinCall = call({ name: ref({ key: '.button' }, { type: 'mixin' }) });
    callerRules.adopt(mixinCall);

    expect(callable.adopt(mixinDef)).toBe(callable);
    expect(callable.resolve(context)).toBe(callable);

    const result = await callable.evalCall(context, list([]));

    expect(result.toString()).toContain('color: red;');
    expect(result.options.mixinOutputSlot?.sourceRules).toBe(mixinDef.value.rules);
    expect(result.options.mixinOutputSlot?.outputRules).toBe(result);
  });
});
