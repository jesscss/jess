import type { Rules } from '../rules.js';
import { attachMixinOutputSlot, assignMixinOutputRuleIndexes } from './mixin-output-slot.js';

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
  isIndexedRuleChild: (node: Rules['value'][number]) => boolean;
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
  state.outputRules.push(...outputRules);
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
    rule.frozen = true;
    output.push(rule);
  }
  attachMixinOutputSlot(output, state.sourceRules, restrictMixinOutputLookup);
  assignMixinOutputRuleIndexes(output, isIndexedRuleChild);
  return output;
}
