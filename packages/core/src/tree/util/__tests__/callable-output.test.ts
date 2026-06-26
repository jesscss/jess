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
        return rules([]).inherit(source);
      },
      createWrapperOutput: () => {
        throw new Error('should not create wrapper output');
      },
      resolveSingleOutputSourceRules: outputRules => outputRules,
      isIndexedRuleChild: () => true
    });

    expect(seenSource).toBe(sourceRules);
    expect(output.rules).toEqual([]);
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
      createWrapperOutput: source => rules([]).inherit(source),
      resolveSingleOutputSourceRules: outputRules => outputRules,
      isIndexedRuleChild: () => true
    });

    expect(output.rules).toEqual([outputA, outputB]);
    expect(outputA.frozen).toBe(false);
    expect(outputB.frozen).toBe(false);
    expect(outputA.parent).toBe(output);
    expect(outputB.parent).toBe(output);
    expect(outputA.index).toBe(0);
    expect(outputB.index).toBe(1);
    expect(getMixinOutputPlacementRecord(output)).toEqual({
      source: sourceRules,
      output
    });
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
      createWrapperOutput: source => rules([]).inherit(source),
      resolveSingleOutputSourceRules: outputRules => outputRules,
      isIndexedRuleChild: () => true
    });

    expect(defaultState.pendingCandidates).toHaveLength(1);
    expect(output.rules).toHaveLength(2);
    expect(output.rules[0]?.index).toBe(0);
    expect(output.rules[1]?.index).toBe(1);
    const renderedChildren = output.rules.map(rule => rule?.toString?.() ?? '');
    expect(renderedChildren).toContain('color: red;\n');
    expect(renderedChildren).toContain('background: blue;\n');
  });
});
