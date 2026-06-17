import { describe, expect, it } from 'vitest';
import { any, call, condition, defaultguard, el, list, ref, rules, ruleset, vardecl } from '../../index.js';
import { Nil } from '../../nil.js';
import { N } from '../../node-type.js';
import {
  callableRulesEntry,
  getCallableEntryParams,
  type CallableEntry,
  type MixinEntry
} from '../callable-entry.js';
import { prepareCallableCandidateMatches, resolveCallableCandidateMatches } from '../callable-candidate-match.js';
import { isNode } from '../is-node.js';

describe('callable candidate match helper', () => {
  it('skips zero-param candidates when call args are present and keeps matched callable bindings', () => {
    const zeroArgRuleset = ruleset({
      selector: el('.zero'),
      rules: rules([])
    });
    const callable = callableRulesEntry({
      name: '.tone',
      params: list([vardecl({ name: 'tone', value: any('red') })]),
      rules: rules([])
    });

    const prepared = prepareCallableCandidateMatches({
      mixinEntries: [zeroArgRuleset, callable],
      nodeArgs: [any('blue')],
      hasFileContext: false,
      rulesEvalStack: [],
      isCallableEntry: (entry: MixinEntry): entry is CallableEntry => !isNode(entry, N.Ruleset),
      getCallableEntryParams
    });

    expect(prepared.evalCandidates).toEqual([callable]);
    expect(prepared.hasDefault).toBe(false);
    expect(prepared.resolvedParamBindings.get(callable)?.bindings[0]?.name).toBe('tone');
  });

  it('orders matched default-guard candidates after plain matched candidates', () => {
    const plainCallable = callableRulesEntry({
      name: '.plain',
      params: list([vardecl({ name: 'tone', value: any('red') })]),
      rules: rules([])
    });
    const defaultCallable = callableRulesEntry({
      name: '.default',
      guard: condition([defaultguard()]),
      params: list([vardecl({ name: 'tone', value: any('red') })]),
      rules: rules([])
    });

    const prepared = prepareCallableCandidateMatches({
      mixinEntries: [defaultCallable, plainCallable],
      nodeArgs: [any('blue')],
      hasFileContext: false,
      rulesEvalStack: [],
      isCallableEntry: (entry: MixinEntry): entry is CallableEntry => !isNode(entry, N.Ruleset),
      getCallableEntryParams
    });

    expect(prepared.hasDefault).toBe(true);
    expect(prepared.evalCandidates).toEqual([plainCallable, defaultCallable]);
    expect(prepared.resolvedParamBindings.get(plainCallable)).toBeDefined();
    expect(prepared.resolvedParamBindings.get(defaultCallable)).toBeDefined();
  });

  it('drops recursive ruleset candidates during the prepared eval-candidate pass', () => {
    const recursiveRuleset = ruleset({
      selector: el('.loop'),
      rules: rules([
        call({ name: ref({ key: '.loop' }, { type: 'mixin' }) })
      ])
    });
    const caller = call({ name: ref({ key: '.loop' }, { type: 'mixin' }) });

    const prepared = prepareCallableCandidateMatches({
      mixinEntries: [recursiveRuleset],
      nodeArgs: [],
      hasFileContext: false,
      rulesEvalStack: [],
      caller,
      isCallableEntry: (entry: MixinEntry): entry is CallableEntry => !isNode(entry, N.Ruleset),
      getCallableEntryParams
    });

    expect(prepared.evalCandidates).toEqual([]);
    expect(prepared.hasDefault).toBe(false);
  });

  it('throws once candidate resolution proves there are no callable matches', () => {
    const requiredCallable = callableRulesEntry({
      name: '.tone',
      params: list([vardecl({ name: 'tone', value: new Nil() }, { paramVar: true })]),
      rules: rules([])
    });

    expect(() => resolveCallableCandidateMatches({
      mixinEntries: [requiredCallable],
      nodeArgs: [],
      hasFileContext: false,
      rulesEvalStack: [],
      isCallableEntry: (entry: MixinEntry): entry is CallableEntry => !isNode(entry, N.Ruleset),
      getCallableEntryParams
    })).toThrowError(new ReferenceError('No matching mixins found.'));
  });
});
