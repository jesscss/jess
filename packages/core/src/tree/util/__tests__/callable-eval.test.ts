import { describe, expect, it } from 'vitest';
import { Context } from '../../../context.js';
import { any, decl, list, mixin, ref, rules, vardecl } from '../../index.js';
import { evaluateCallableCollection } from '../callable-eval.js';

describe('callable eval helper', () => {
  it('evaluates callable entries through the top-level helper', async () => {
    const context = new Context({ leakyRules: true });
    const candidate = mixin({
      name: '.button',
      params: list([vardecl({ name: 'tone', value: any('red') })]),
      rules: [
        decl({ name: 'color', value: ref({ key: 'tone' }, { type: 'variable' }) })
      ]
    });
    const definitionParent = rules([candidate]);
    const callerRules = rules([]);
    definitionParent.getScopeFrame();
    callerRules.getScopeFrame();
    context.rulesContext = callerRules;

    const output = await evaluateCallableCollection({
      context,
      mixinEntries: [candidate],
      args: [any('blue')]
    });

    expect(output.toString()).toContain('color: blue;');
    expect(output.index).toBeDefined();
  });

  it('throws when no callable candidates match', async () => {
    const context = new Context();
    const candidate = mixin({
      name: '.button',
      params: list([vardecl({ name: 'tone', value: any('red') })]),
      rules: [
        decl({ name: 'color', value: ref({ key: 'tone' }, { type: 'variable' }) })
      ]
    });
    context.rulesContext = rules([]);

    await expect(evaluateCallableCollection({
      context,
      mixinEntries: [candidate],
      args: [any('red'), any('blue')]
    })).rejects.toThrow('No matching mixins found.');
  });
});
