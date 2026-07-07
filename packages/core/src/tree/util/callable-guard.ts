import type { Context } from '../../context.js';
import { Condition } from '../condition.js';
import type { Node } from '../node.js';
import type { Rules } from '../rules.js';
import { isConstantGuard } from './callable-guard-constant.js';
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
  hasDefault: _hasDefault,
  candidateGuard,
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
  const guard: Node | undefined = candidateGuard;
  const usesPreboundCallerGuardOuterRules = Boolean(
    guard
    && !isConstantGuard(guard)
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
    || isConstantGuard(guard)
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
        beforeEval: (probeGuard) => {
          if (
            !isConstantGuard(probeGuard)
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
      !isConstantGuard(guard)
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
    let passes: boolean;
    if (guard instanceof Condition) {
      passes = await guard.evaluateBoolean(context);
    } else {
      // A bare (non-Condition) guard body — `when ((@value))`, `when (#ns[flag])` —
      // resolves to a Bool or a keyword `true`/`false`; Less honours both, so use
      // the canonical truth check rather than a strict `instanceof Bool`.
      const resolvedGuard = await guard.eval(context);
      passes = Condition.resultPasses(resolvedGuard);
    }
    return {
      passes,
      contributesDefNone: passes,
      defersCandidateOutput: false,
      outerRules
    };
  });
}
