import { describe, expect, it } from 'vitest';
import { Context } from '../../../context.js';
import { any, call, decl, list, mixin, ref, rules, ruleset } from '../../index.js';
import * as rulesModule from '../../rules.js';
import { MixinCollection } from '../callable-collection.js';

describe('callable collection helper', () => {
  it('does not stay re-exported through rules.ts once the package seam is deleted', () => {
    expect('MixinCollection' in rulesModule).toBe(false);
  });

  it('preserves the direct callable handoff outside rules.ts', async () => {
    const context = new Context({ leakyRules: true });
    context.depth = 2;

    const mixinDef = mixin({
      name: '.button',
      rules: [
        decl({ name: 'color', value: any('red') })
      ]
    });
    const callerRules = rules([]);
    const root = rules([
      mixinDef,
      ruleset({
        selector: '.use',
        rules: callerRules.rules
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
    expect(result.options.mixinOutputSlot?.sourceRules).toBe(mixinDef);
    expect(result.options.mixinOutputSlot?.outputRules).toBe(result);
  });
});
