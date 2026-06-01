import type { Context } from '../../context.js';
import { Bool } from '../bool.js';
import type { Node } from '../node.js';
import { F_STATIC } from '../node.js';
import type { Rules } from '../rules.js';
import {
  CALLABLE_DEFAULT_NONE,
  type CallableDefaultGroup,
  probeCallableDefaultGuard
} from './callable-default-guard.js';
import { withRulesContext } from './context.js';
import { ensureCallableOuterRulesSurface } from './callable-outer-rules.js';

type PrepareCallableGuardStateOptions = {
  hasDefault: boolean;
  candidateGuard?: Node;
  copyGuardForEval: (guard: Node) => Node;
  candidateParams?: Node;
  paramBindingsLength: number;
  outerRules?: Rules;
  rules: Rules;
  parent: Node;
  candidateIndex?: number;
  parentFrame?: Rules['scopeFrame'];
  createOuterRules: (rules: Rules, options?: Rules['options']) => Rules;
  rulesContextParent?: Node;
};

type PrepareCallableGuardStateResult = {
  guard?: Node;
  outerRules?: Rules;
  usesPreboundCallerGuardOuterRules: boolean;
};

type EnsureCallableGuardOuterRulesOptions = {
  guard?: Node;
  usesPreboundCallerGuardOuterRules: boolean;
  usesPreboundParamGuardOuterRules: boolean;
  outerRules?: Rules;
  rules: Rules;
  parent: Node;
  candidateIndex?: number;
  createOuterRules: (rules: Rules, options?: Rules['options']) => Rules;
};

type EvaluateCallableGuardOptions = {
  context: Context;
  hasDefault: boolean;
  guard?: Node;
  candidateGuard?: Node;
  copyGuardForEval: (guard: Node) => Node;
  usesPreboundCallerGuardOuterRules: boolean;
  usesPreboundParamGuardOuterRules: boolean;
  outerRules?: Rules;
  rules: Rules;
  parent: Node;
  candidateIndex?: number;
  createOuterRules: (rules: Rules, options?: Rules['options']) => Rules;
};

type EvaluateCallableGuardResult = {
  passes: boolean;
  contributesDefNone: boolean;
  defersCandidateOutput: boolean;
  pendingDefaultGroup?: CallableDefaultGroup;
  outerRules?: Rules;
  defaultProbeResult?: {
    passWhenDefaultFalse: boolean;
    passWhenDefaultTrue: boolean;
  };
};

export function prepareCallableGuardState({
  hasDefault,
  candidateGuard,
  copyGuardForEval,
  candidateParams,
  paramBindingsLength,
  outerRules,
  rules,
  parent,
  candidateIndex,
  parentFrame,
  createOuterRules,
  rulesContextParent
}: PrepareCallableGuardStateOptions): PrepareCallableGuardStateResult {
  const guard: Node | undefined = hasDefault
    ? candidateGuard
    : candidateGuard
      ? (candidateGuard.hasFlag(F_STATIC) ? candidateGuard : copyGuardForEval(candidateGuard))
      : undefined;
  const usesPreboundCallerGuardOuterRules = Boolean(
    guard
    && !guard.hasFlag(F_STATIC)
    && !candidateParams
    && paramBindingsLength === 0
  );
  if (usesPreboundCallerGuardOuterRules && !outerRules) {
    outerRules = ensureCallableOuterRulesSurface({
      currentOuterRules: outerRules,
      rules,
      parent: rulesContextParent ?? parent,
      candidateIndex,
      createOuterRules,
      syncScopeFrame: false
    });
    if (parentFrame) {
      outerRules.scopeFrame = parentFrame;
    }
  }
  return {
    guard,
    outerRules,
    usesPreboundCallerGuardOuterRules
  };
}

export function ensureCallableGuardOuterRules({
  guard,
  usesPreboundCallerGuardOuterRules,
  usesPreboundParamGuardOuterRules,
  outerRules,
  rules,
  parent,
  candidateIndex,
  createOuterRules
}: EnsureCallableGuardOuterRulesOptions): Rules | undefined {
  if (
    !guard
    || guard.hasFlag(F_STATIC)
    || usesPreboundCallerGuardOuterRules
    || usesPreboundParamGuardOuterRules
  ) {
    return outerRules;
  }
  return ensureCallableOuterRulesSurface({
    currentOuterRules: outerRules,
    rules,
    parent,
    candidateIndex,
    createOuterRules
  });
}

export async function evaluateCallableGuard({
  context,
  hasDefault,
  guard,
  candidateGuard,
  copyGuardForEval,
  usesPreboundCallerGuardOuterRules,
  usesPreboundParamGuardOuterRules,
  outerRules,
  rules,
  parent,
  candidateIndex,
  createOuterRules
}: EvaluateCallableGuardOptions): Promise<EvaluateCallableGuardResult> {
  return await withRulesContext(context, outerRules ?? rules, async () => {
    if (!guard) {
      return {
        passes: true,
        contributesDefNone: true,
        defersCandidateOutput: false,
        outerRules
      };
    }

    if (hasDefault) {
      const {
        passWhenDefaultFalse,
        passWhenDefaultTrue,
        passes,
        group
      } = await probeCallableDefaultGuard({
        context,
        candidateGuard,
        copyGuardForEval,
        beforeEval: (probeGuard) => {
          if (
            !probeGuard.hasFlag(F_STATIC)
            && !usesPreboundCallerGuardOuterRules
            && !usesPreboundParamGuardOuterRules
          ) {
            outerRules = ensureCallableGuardOuterRules({
              guard: probeGuard,
              usesPreboundCallerGuardOuterRules,
              usesPreboundParamGuardOuterRules,
              outerRules,
              rules,
              parent,
              candidateIndex,
              createOuterRules
            });
          }
        }
      });

      return {
        passes,
        contributesDefNone: passes && group === CALLABLE_DEFAULT_NONE,
        defersCandidateOutput: passes,
        pendingDefaultGroup: passes ? group : undefined,
        outerRules,
        defaultProbeResult: {
          passWhenDefaultFalse,
          passWhenDefaultTrue
        }
      };
    }

    if (
      !guard.hasFlag(F_STATIC)
      && !usesPreboundCallerGuardOuterRules
      && !usesPreboundParamGuardOuterRules
    ) {
      outerRules = ensureCallableGuardOuterRules({
        guard,
        usesPreboundCallerGuardOuterRules,
        usesPreboundParamGuardOuterRules,
        outerRules,
        rules,
        parent,
        candidateIndex,
        createOuterRules
      });
    }

    context.isDefault = false;
    const resolvedGuard = await guard.eval(context);
    const passes = resolvedGuard instanceof Bool && resolvedGuard.value === true;
    return {
      passes,
      contributesDefNone: passes,
      defersCandidateOutput: false,
      outerRules
    };
  });
}
