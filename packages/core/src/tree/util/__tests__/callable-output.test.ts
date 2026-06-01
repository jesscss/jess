import { describe, expect, it } from 'vitest';
import { any, decl, rules } from '../../index.js';
import { getMixinOutputPlacementRecord } from '../mixin-output-slot.js';
import {
  createCallableOutputState,
  finalizeCallableOutput,
  pushCallableOutputRule,
  pushCallableOutputRules,
  recordCallableOutputSourceRules
} from '../callable-output.js';

describe('callable output helpers', () => {
  it('tracks the first source surface and appends output rules', () => {
    const state = createCallableOutputState();
    const sourceRules = rules([]);
    const outputA = rules([]);
    const outputB = rules([]);

    recordCallableOutputSourceRules(state, sourceRules);
    recordCallableOutputSourceRules(state, rules([decl({ name: 'color', value: any('blue') })]));
    pushCallableOutputRule(state, outputA);
    pushCallableOutputRules(state, [outputB]);

    expect(state.sourceRules).toBe(sourceRules);
    expect(state.outputRules).toEqual([outputA, outputB]);
  });

  it('finalizes empty output through the provided empty-output factory', () => {
    const state = createCallableOutputState();
    const sourceRules = rules([]);
    let seenSource: typeof sourceRules | undefined;
    recordCallableOutputSourceRules(state, sourceRules);

    const output = finalizeCallableOutput({
      state,
      restrictMixinOutputLookup: true,
      createEmptyOutput: (source) => {
        seenSource = source;
        return rules([], undefined, undefined, source.treeContext).inherit(source);
      },
      createWrapperOutput: () => {
        throw new Error('should not create wrapper output');
      },
      resolveSingleOutputSourceRules: outputRules => outputRules,
      isIndexedRuleChild: () => true
    });

    expect(seenSource).toBe(sourceRules);
    expect(output.value).toEqual([]);
  });

  it('finalizes a single output rule with placement state', () => {
    const state = createCallableOutputState();
    const sourceRules = rules([decl({ name: 'color', value: any('red') })]);
    const outputRule = rules([decl({ name: 'color', value: any('red') })]);

    recordCallableOutputSourceRules(state, sourceRules);
    pushCallableOutputRule(state, outputRule);

    const output = finalizeCallableOutput({
      state,
      restrictMixinOutputLookup: true,
      createEmptyOutput: () => {
        throw new Error('should not create empty output');
      },
      createWrapperOutput: () => {
        throw new Error('should not create wrapper output');
      },
      resolveSingleOutputSourceRules: () => sourceRules,
      isIndexedRuleChild: () => true
    });

    expect(output).toBe(outputRule);
    expect(getMixinOutputPlacementRecord(output)).toEqual({
      source: sourceRules,
      output
    });
  });

  it('finalizes multiple output rules through a wrapper and assigns source indexes', () => {
    const state = createCallableOutputState();
    const sourceRules = rules([
      decl({ name: 'color', value: any('red') }),
      decl({ name: 'background', value: any('blue') })
    ]);
    const outputA = rules([decl({ name: 'color', value: any('red') })]);
    const outputB = rules([decl({ name: 'background', value: any('blue') })]);

    recordCallableOutputSourceRules(state, sourceRules);
    pushCallableOutputRules(state, [outputA, outputB]);

    const output = finalizeCallableOutput({
      state,
      restrictMixinOutputLookup: true,
      createEmptyOutput: () => {
        throw new Error('should not create empty output');
      },
      createWrapperOutput: source => rules([], undefined, undefined, source.treeContext).inherit(source),
      resolveSingleOutputSourceRules: outputRules => outputRules,
      isIndexedRuleChild: () => true
    });

    expect(output.value).toEqual([outputA, outputB]);
    expect(outputA.frozen).toBe(true);
    expect(outputB.frozen).toBe(true);
    expect(outputA.index).toBe(0);
    expect(outputB.index).toBe(1);
    expect(getMixinOutputPlacementRecord(output)).toEqual({
      source: sourceRules,
      output
    });
  });
});
