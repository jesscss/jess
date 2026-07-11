import type { Context } from '../../context.js';
import type { Node } from '../node.js';
import type { CallableParamMatch } from './callable-param-match.js';
import { prepareCallableCandidateState } from './callable-candidate-state.js';
import { executeCallableCandidate } from './callable-candidate-execution.js';
import {
  type CallableEntry,
  type MixinEntry,
  getCallableEntryGuard,
  getCallableEntryName,
  getCallableEntryParams,
  getMixinEntryRules,
  isCallableEntry
} from './callable-entry.js';
import type { Rules } from '../rules.js';
import type { CallableDefaultState } from './callable-default-guard.js';
import {
  pushCallableOutputRule,
  recordCallableOutputSourceRules,
  type CallableOutputState
} from './callable-output.js';
import { evaluateCallableSpecialCaseCandidate } from './callable-special-case.js';

type ExecuteCallableCandidateLoopOptions = {
  context: Context;
  caller?: Node;
  evalCandidates: readonly MixinEntry[];
  hasDefault: boolean;
  nodeArgs: Node[];
  resolvedParamBindings: WeakMap<CallableEntry, CallableParamMatch>;
  outputState: CallableOutputState;
  defaultState: CallableDefaultState;
  restrictMixinOutputLookup: boolean;
  debugDefaultGuard: boolean;
  debugCaller: () => string;
  specialCaseCallSiteRules?: Node;
  ordinaryCallSiteRules: Rules;
  createCallableRules: (sourceRules: Rules) => Rules;
  getRootSourceRules: (rules: Rules) => Rules;
  createOuterRules: (rules: Rules, options?: Rules['options']) => Rules;
};

/**
 * Resolve the BOUND leaky surface a candidate def leaked from, if any. The candidate
 * reaching the loop is a per-call CLONE (`createCallableRules`) whose `sourceNode`
 * chain points back at the canonical def node registered in the spine leaky-callable
 * side-table (`registerSpineFoldedSurfaceCallables`). Walk the sourceNode chain (short
 * — a couple of hops) so a clone still finds its leak surface. Returns undefined for
 * every non-leaked candidate (cheap WeakMap misses).
 */
function resolveLeakyCallableSurface(context: Context, rules: Rules): Rules | undefined {
  const map = context.spineLeakyCallableSurface;
  if (map === undefined) {
    return undefined;
  }
  let node: Node | undefined = rules;
  const seen = new Set<Node>();
  while (node && !seen.has(node)) {
    seen.add(node);
    const hit = map.get(node);
    if (hit !== undefined) {
      return hit;
    }
    node = (node as { sourceNode?: Node }).sourceNode;
  }
  return undefined;
}

export async function executeCallableCandidateLoop({
  context,
  caller,
  evalCandidates,
  hasDefault,
  nodeArgs,
  resolvedParamBindings,
  outputState,
  defaultState,
  restrictMixinOutputLookup,
  debugDefaultGuard,
  debugCaller,
  specialCaseCallSiteRules,
  ordinaryCallSiteRules,
  createCallableRules,
  getRootSourceRules,
  createOuterRules
}: ExecuteCallableCandidateLoopOptions): Promise<void> {
  for (const candidate of evalCandidates) {
    const candidateName = isCallableEntry(candidate)
      ? getCallableEntryName(candidate)
      : undefined;
    const candidateParams = isCallableEntry(candidate)
      ? getCallableEntryParams(candidate)
      : undefined;
    const candidateGuard = isCallableEntry(candidate)
      ? getCallableEntryGuard(candidate)
      : undefined;

    const specialCaseResult = await evaluateCallableSpecialCaseCandidate({
      candidate,
      context,
      caller,
      callSiteRules: specialCaseCallSiteRules,
      restrictMixinOutputLookup,
      candidateName,
      candidateParams,
      candidateGuard,
      createCallableRules,
      getRootSourceRules
    });
    if (specialCaseResult.handled) {
      // Record the source surface for EVERY handled special-case candidate (not only
      // one with output) — a spine-sink-captured ruleset-as-mixin (FOLD A) returns no
      // output but its source must still seed `outputState` so `finalizeCallableOutput`
      // returns an empty output (the fold assembles the real contribution) instead of
      // throwing "output source surface was not established". Mirrors the ordinary
      // (mixin) arm, which records the source unconditionally before execution.
      const sourceRules = getRootSourceRules(getMixinEntryRules(candidate));
      recordCallableOutputSourceRules(outputState, sourceRules);
      if (specialCaseResult.output) {
        pushCallableOutputRule(outputState, specialCaseResult.output);
      }
      continue;
    }

    if (!isCallableEntry(candidate)) {
      throw new TypeError('Callable candidate setup expects a callable entry');
    }

    // Spine leaky-callable definition-frame projection: a nested def that leaked into
    // this scope AND closes over an enclosing param resolves its definition frame
    // against the BOUND surface it leaked from (holding the enclosing param slots),
    // not its static def parent. Looked up per-candidate; undefined for every other
    // candidate (the common case pays a WeakMap miss).
    const leakySurface = resolveLeakyCallableSurface(context, getMixinEntryRules(candidate));
    const candidateState = prepareCallableCandidateState({
      candidate,
      callSiteRules: ordinaryCallSiteRules,
      leakyScope: context.options.leakyScope === true,
      resolvedBindingInfo: resolvedParamBindings.get(candidate),
      leakySurface,
      createCallableRules,
      getRootSourceRules
    });
    const { sourceRules } = candidateState;
    recordCallableOutputSourceRules(outputState, sourceRules);

    const execution = await executeCallableCandidate({
      context,
      hasDefault,
      candidate,
      candidateGuard,
      candidateParams,
      candidateState,
      nodeArgs,
      defaultState,
      restrictMixinOutputLookup,
      createOuterRules
    });
    if (debugDefaultGuard && execution.debugDefaultProbeResult) {
      const debugParams: unknown[] = [];
      const paramValues = candidateParams?.value;
      if (paramValues) {
        for (let i = 0; i < paramValues.length; i++) {
          const param = paramValues[i];
          debugParams.push(param?.valueOf() ?? String(param));
        }
      }
      console.log('[default-guard:candidate]', JSON.stringify({
        caller: debugCaller(),
        candidate: candidateName?.valueOf?.() ?? '<anon>',
        guard: candidateGuard?.valueOf?.() ?? candidateGuard?.toString?.() ?? '',
        params: debugParams,
        passWhenDefaultFalse: execution.debugDefaultProbeResult.passWhenDefaultFalse,
        passWhenDefaultTrue: execution.debugDefaultProbeResult.passWhenDefaultTrue
      }));
    }
    if (execution.output) {
      pushCallableOutputRule(outputState, execution.output);
    }
  }
}
