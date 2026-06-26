import type { Context } from '../../context.js';
import type { Rules } from '../rules.js';
import { flushCallableDefaultOutputs, type CallableDefaultState } from './callable-default-guard.js';
import { attachMixinOutputSlot, assignMixinOutputRuleIndexes } from './mixin-output-slot.js';
import { comparePosition } from './compare.js';

export type CallableOutputState = {
  sourceRules?: Rules;
  outputRules: Rules[];
};

type FinalizeCallableOutputOptions = {
  state: CallableOutputState;
  restrictMixinOutputLookup: boolean;
  createEmptyOutput: (sourceRules: Rules) => Rules;
  createWrapperOutput: (sourceRules: Rules, restrictMixinOutputLookup: boolean) => Rules;
  resolveSingleOutputSourceRules: (output: Rules) => Rules;
  isIndexedRuleChild: (node: Rules['rules'][number]) => boolean;
};

type FinalizeCallableEvalOutputOptions = FinalizeCallableOutputOptions & {
  context: Context;
  defaultState: CallableDefaultState;
  debugDefaultGuard?: boolean;
  debugCaller?: string;
};

export function createCallableOutputState(): CallableOutputState {
  return {
    outputRules: []
  };
}

export function recordCallableOutputSourceRules(
  state: CallableOutputState,
  sourceRules: Rules
): void {
  state.sourceRules ??= sourceRules;
}

export function pushCallableOutputRule(
  state: CallableOutputState,
  outputRule: Rules
): void {
  state.outputRules.push(outputRule);
}

export function pushCallableOutputRules(
  state: CallableOutputState,
  outputRules: readonly Rules[]
): void {
  for (let i = 0; i < outputRules.length; i++) {
    state.outputRules.push(outputRules[i]!);
  }
}

function compareCallableOutputPosition(a: Rules, b: Rules): number {
  if (
    a.parent === b.parent
    && a.index !== undefined
    && b.index !== undefined
  ) {
    return a.index - b.index;
  }
  return comparePosition(a, b);
}

export async function finalizeCallableEvalOutput({
  context,
  state,
  defaultState,
  restrictMixinOutputLookup,
  debugDefaultGuard = false,
  debugCaller,
  createEmptyOutput,
  createWrapperOutput,
  resolveSingleOutputSourceRules,
  isIndexedRuleChild
}: FinalizeCallableEvalOutputOptions): Promise<Rules> {
  const defaultExecution = await flushCallableDefaultOutputs({
    context,
    state: defaultState,
    restrictMixinOutputLookup
  });
  if (defaultExecution) {
    if (debugDefaultGuard) {
      console.log('[default-guard:resolution]', JSON.stringify({
        caller: debugCaller ?? '<unknown>',
        hasDefNoneCandidate: defaultState.hasDefNoneCandidate,
        defTrueCount: defaultExecution.resolution.defTrueCount,
        defFalseCount: defaultExecution.resolution.defFalseCount,
        defaultResult: defaultExecution.resolution.defaultResult
      }));
    }
    pushCallableOutputRules(state, defaultExecution.outputs);
  }
  state.outputRules.sort(compareCallableOutputPosition);
  return finalizeCallableOutput({
    state,
    restrictMixinOutputLookup,
    createEmptyOutput,
    createWrapperOutput,
    resolveSingleOutputSourceRules,
    isIndexedRuleChild
  });
}

export function finalizeCallableOutput({
  state,
  restrictMixinOutputLookup,
  createEmptyOutput,
  createWrapperOutput,
  resolveSingleOutputSourceRules,
  isIndexedRuleChild
}: FinalizeCallableOutputOptions): Rules {
  if (state.outputRules.length === 0) {
    if (!state.sourceRules) {
      throw new ReferenceError('Mixin output source surface was not established.');
    }
    return createEmptyOutput(state.sourceRules);
  }

  if (state.outputRules.length === 1) {
    const output = state.outputRules[0]!;
    output.options = {
      ...output.options,
      rulesVisibility: {
        Ruleset: 'public',
        Declaration: 'public',
        VarDeclaration: 'public',
        Mixin: 'public'
      }
    };
    attachMixinOutputSlot(
      output,
      resolveSingleOutputSourceRules(output),
      restrictMixinOutputLookup
    );
    return output;
  }

  if (!state.sourceRules) {
    throw new ReferenceError('Mixin output source surface was not established.');
  }

  const output = createWrapperOutput(state.sourceRules, restrictMixinOutputLookup);
  for (const rule of state.outputRules) {
    output.push(rule);
  }
  attachMixinOutputSlot(output, state.sourceRules, restrictMixinOutputLookup);
  assignMixinOutputRuleIndexes(output, isIndexedRuleChild);
  return output;
}
