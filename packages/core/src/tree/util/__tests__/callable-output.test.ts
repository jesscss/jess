import { describe, expect, it } from 'vitest';
import { Context } from '../../../context.js';
import { any, decl, rules } from '../../index.js';
import { CALLABLE_DEFAULT_TRUE, createCallableDefaultState } from '../callable-default-guard.js';
import { getMixinOutputPlacementRecord } from '../mixin-output-slot.js';
import {
  createCallableOutputState,
  finalizeCallableEvalOutput,
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
        return rules([], undefined, undefined, source.sourceRoot?._treeContext).inherit(source);
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
      createWrapperOutput: source => rules([], undefined, undefined, source.sourceRoot?._treeContext).inherit(source),
      resolveSingleOutputSourceRules: outputRules => outputRules,
      isIndexedRuleChild: () => true
    });

    expect(output.value).toEqual([outputA, outputB]);
    expect(outputA.frozen).toBe(false);
    expect(outputB.frozen).toBe(false);
    expect(outputA.sourceParent).toBe(output);
    expect(outputB.sourceParent).toBe(output);
    expect(outputA.index).toBe(0);
    expect(outputB.index).toBe(1);
    expect(getMixinOutputPlacementRecord(output)).toEqual({
      source: sourceRules,
      output
    });
  });

  it('sorts multiple output rules at the wrapper boundary only', () => {
    const state = createCallableOutputState();
    const sourceRules = rules([]);
    const laterOutput = rules([decl({ name: 'z-index', value: any('2') })]);
    const earlierOutput = rules([decl({ name: 'z-index', value: any('1') })]);
    laterOutput.index = 10;
    earlierOutput.index = 1;

    recordCallableOutputSourceRules(state, sourceRules);
    pushCallableOutputRules(state, [laterOutput, earlierOutput]);

    const output = finalizeCallableOutput({
      state,
      restrictMixinOutputLookup: true,
      createEmptyOutput: () => {
        throw new Error('should not create empty output');
      },
      createWrapperOutput: source => rules([], undefined, undefined, source.sourceRoot?._treeContext).inherit(source),
      resolveSingleOutputSourceRules: outputRules => outputRules,
      isIndexedRuleChild: () => true
    });

    expect(output.value).toEqual([earlierOutput, laterOutput]);
    expect(earlierOutput.index).toBe(0);
    expect(laterOutput.index).toBe(1);
  });

  it('flushes pending default outputs before sorting and finalizing', async () => {
    const context = new Context();
    const state = createCallableOutputState();
    const defaultState = createCallableDefaultState();
    const sourceRules = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const existingOutput = rules([
      decl({ name: 'background', value: any('blue') })
    ]);
    existingOutput.index = 10;

    const pendingRules = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const pendingParent = rules([]);

    recordCallableOutputSourceRules(state, sourceRules);
    pushCallableOutputRule(state, existingOutput);
    defaultState.pendingCandidates.push({
      group: CALLABLE_DEFAULT_TRUE,
      rules: pendingRules,
      sourceRules,
      candidateParent: pendingParent,
      candidateIndex: 1
    });

    const output = await finalizeCallableEvalOutput({
      context,
      state,
      defaultState,
      restrictMixinOutputLookup: true,
      createEmptyOutput: () => {
        throw new Error('should not create empty output');
      },
      createWrapperOutput: source => rules([], undefined, undefined, source.sourceRoot?._treeContext).inherit(source),
      resolveSingleOutputSourceRules: outputRules => outputRules,
      isIndexedRuleChild: () => true
    });

    expect(defaultState.pendingCandidates).toHaveLength(1);
    expect(output.value).toHaveLength(2);
    expect(output.value[0]?.index).toBe(0);
    expect(output.value[1]?.index).toBe(1);
    const renderedChildren = output.value.map(rule => rule?.toString?.() ?? '');
    expect(renderedChildren).toContain('color: red;\n');
    expect(renderedChildren).toContain('background: blue;\n');
  });
});
