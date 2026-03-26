import type { Context } from '../../context.js';
import { EvalSession, type SessionInstanceRoot } from '../../eval-session.js';
import type { Node } from '../node-base.js';
import { Bool } from '../bool.js';
import type { Condition } from '../condition.js';
import { Rules } from '../rules.js';
import type { VarDeclaration } from '../declaration-var.js';
import { VarDeclaration as VarDeclarationCtor } from '../declaration-var.js';
import type { List } from '../list.js';
import { Sequence } from '../sequence.js';
import { Any } from '../any.js';
import { N } from '../node-type.js';
import { F_VISIBLE } from '../node.js';
import { isNode } from './is-node.js';
import { freezeChildren } from './cloning.js';
import { comparePosition } from './compare.js';
import { getChildren, patchField, setChildren, setParent, setSourceParent } from './session-helpers.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';

export const enum MixinDefaultGroup {
  FalseEither = -1,
  None = 0,
  True = 1,
  False = 2
}

export type PreparedMixinCandidateInvocation = {
  rules: Rules;
  params: List<Node> | undefined;
  outerRules: Rules | undefined;
  lookupScope: Rules;
  guardScopeChildren: readonly Node[] | undefined;
};

export type EvaluatedMixinGuard = {
  passes: boolean;
  outerRules: Rules | undefined;
  defaultGroup?: MixinDefaultGroup;
};

export type PendingMixinDefaultCandidate<TCandidate = unknown> = {
  candidate: TCandidate;
  rules: Rules;
  outerRules?: Rules;
  params?: List<Node>;
  group: MixinDefaultGroup;
  instanceRoot?: SessionInstanceRoot;
};

export type ProcessPreparedMixinCandidateOptions<TCandidate> = {
  candidate: TCandidate;
  rules: Rules;
  params?: List<Node>;
  outerRules?: Rules;
  guard?: Condition | Bool;
  parent: Node | undefined;
  lookupScope: Rules;
  guardScopeChildren?: readonly Node[];
  hasDefault: boolean;
  context: Context;
  instanceRoot?: SessionInstanceRoot;
  evaluateCandidateOutput: (
    candidate: TCandidate,
    rules: Rules,
    outerRules: Rules | undefined,
    params: List<Node> | undefined,
    instanceRoot?: SessionInstanceRoot
  ) => MaybePromise<void>;
};

/**
 * Follow a Rules node back to its canonical source root. Mixin/ruleset
 * candidate setup wants this shared notion of "the source rules subtree" so
 * that instance roots are always created against the canonical backing body.
 */
export function getRootSourceRules(rules: Rules): Rules {
  let current = rules;
  const seen = new Set<Rules>();
  while (current.sourceNode && isNode(current.sourceNode, N.Rules)) {
    const next = current.sourceNode as Rules;
    if (next === current || seen.has(next)) {
      break;
    }
    seen.add(current);
    current = next;
  }
  return current;
}

/**
 * Resolve the canonical source rules for a mixin-like candidate and create a
 * per-call instance root when a session is active.
 */
export function createMixinCandidateInstanceRoot(
  candidate: Node,
  context: Context
): SessionInstanceRoot | undefined {
  if (!context.session) {
    return undefined;
  }
  const candidateRules = isNode(candidate, N.Ruleset)
    ? (candidate as any).rules as Rules | undefined
    : (candidate as any).rules as Rules | undefined;
  if (!candidateRules) {
    return undefined;
  }
  return context.session.createInstanceRoot(getRootSourceRules(candidateRules));
}

/**
 * Bind one mixin param through the active instance root instead of mutating the
 * canonical VarDeclaration. This is the smallest useful primitive behind direct
 * mixin invocation.
 */
export function bindMixinParamValue(
  param: VarDeclaration,
  value: Node,
  context: Context
): void {
  patchField(param, 'value', value, context);
}

/**
 * Attach a canonical mixin body to its transient param scope through the active
 * instance root. This keeps the canonical body parent-free while allowing
 * lookups to walk body -> paramScope -> outer scope.
 */
export function attachMixinBodyToParamScope(
  body: Rules,
  paramScope: Rules,
  context: Context
): void {
  setParent(body, paramScope, context);
}

/**
 * Create the transient scope that holds bound mixin parameters. This is the
 * direct replacement for the inlined outerRules construction in
 * getFunctionFromMixins().
 */
export function createMixinParamScope(
  parent: Node | undefined,
  index: number,
  context: Context
): Rules {
  const scope = Rules.create([], {
    rulesVisibility: {
      Ruleset: 'public',
      Declaration: 'public',
      VarDeclaration: 'public',
      Mixin: 'public'
    }
  });
  setParent(scope, parent, context);
  scope.index = index;
  return scope;
}

/**
 * Register already-bound parameter declarations into the transient mixin scope.
 * Matching/rest conversion still happens outside this helper; this primitive is
 * only responsible for making those params visible to lookup.
 */
export function populateMixinParamScope(
  scope: Rules,
  params: List<Node>,
  context: Context
): void {
  for (let i = 0; i < params.value.length; i++) {
    const param = params.value[i]!;
    if (!isNode(param, N.VarDeclaration)) {
      continue;
    }
    if (param.index === undefined) {
      param.index = -(i + 1);
    }
    param.options ??= {};
    param.options.paramVar = true;
    param.removeFlag(F_VISIBLE);
    scope.push(context, param);
  }
}

/**
 * Define the Less-style @arguments variable inside the transient mixin scope.
 * This stays a separate primitive so direct mixin invocation can reuse it
 * without dragging along the rest of getFunctionFromMixins().
 */
export function defineMixinArgumentsInScope(
  scope: Rules,
  params: List<Node> | undefined,
  nodeArgs: readonly Node[],
  context: Context
): void {
  if (!context.treeContext?.file) {
    return;
  }

  const argumentsArgs: Node[] = [];
  const argumentsDecl = new VarDeclarationCtor({
    name: new Any('arguments', { role: 'property' }),
    value: new Sequence(argumentsArgs)
  }, { readonly: true, paramVar: true });
  argumentsDecl.removeFlag(F_VISIBLE);
  scope.push(context, argumentsDecl);

  const paramValues = params?.value
    .filter((p): p is VarDeclaration => isNode(p, N.VarDeclaration))
    .map(p => (p as any).value);
  const argumentNodes = (paramValues && paramValues.length > 0) ? paramValues : nodeArgs;
  for (const argNode of argumentNodes) {
    if (isNode(argNode, N.Sequence) && (argNode as Sequence).value.length > 1) {
      for (const item of (argNode as Sequence).value) {
        const cloned = item.copy(true, freezeChildren);
        cloned.frozen = true;
        argumentsArgs.push(cloned);
      }
    } else {
      const cloned = argNode.copy(true, freezeChildren);
      cloned.frozen = true;
      argumentsArgs.push(cloned);
    }
  }
}

/**
 * Seed a fresh reset-eval guard scope from the active param scope without
 * touching canonical parentage. The returned scope is safe to reuse for a
 * single guard probe.
 */
export function seedMixinGuardScope(
  scope: Rules | undefined,
  guardParent: Node | undefined,
  guardNode: Node | undefined,
  context: Context,
  scopeChildren?: readonly Node[]
): Rules {
  const nextScope = scope ?? Rules.create([]);
  setParent(nextScope, guardParent, context);
  const activeChildren = scopeChildren ?? getChildren(nextScope, context);
  if (scopeChildren) {
    setChildren(nextScope, activeChildren, context, { markDirty: false });
  }
  for (const child of activeChildren) {
    nextScope.registerNode(child, undefined, context);
  }
  if (guardNode) {
    nextScope.adopt(guardNode, context);
  }
  return nextScope;
}

/**
 * Prepare the transient scope used by a single mixin invocation. This is the
 * smallest complete lookup-ready scope primitive for direct canonical-body eval:
 * the caller gets a param scope with registered params / @arguments and the
 * canonical body attached through session parent shadow only.
 */
export function prepareMixinInvocationScope(
  body: Rules,
  parent: Node | undefined,
  index: number,
  params: List<Node> | undefined,
  nodeArgs: readonly Node[],
  context: Context
): Rules | undefined {
  if (!params) {
    return undefined;
  }
  const scope = createMixinParamScope(parent, index, context);
  populateMixinParamScope(scope, params, context);
  defineMixinArgumentsInScope(scope, params, nodeArgs, context);
  attachMixinBodyToParamScope(body, scope, context);
  return scope;
}

/**
 * Normalize mixin params for invocation-time lookup registration.
 *
 * Rest params must become VarDeclarations before they can participate in the
 * transient param scope. Keep that conversion here instead of inline inside the
 * candidate loop.
 */
export function normalizeMixinInvocationParams(
  params: List<Node> | undefined,
  context: Context
): List<Node> | undefined {
  if (!params) {
    return undefined;
  }

  let unnamedRestCount = 0;
  for (let i = 0; i < params.value.length; i++) {
    const param = params.value[i]!;
    if (param.type !== 'Rest') {
      continue;
    }

    let restName: string;
    if (typeof (param as any).value === 'string') {
      restName = (param as any).value;
    } else {
      restName = unnamedRestCount === 0 ? 'rest' : `rest${unnamedRestCount + 1}`;
      unnamedRestCount++;
    }

    const restValue = isNode((param as any).value)
      ? (param as any).value as Node
      : (
          context.treeContext?.file
            ? new Sequence([])
            : new Any(restName, { role: 'property' })
        );
    const restVarDecl = new VarDeclarationCtor({
      name: new Any(restName, { role: 'property' }),
      value: restValue
    }, { paramVar: true });

    params.setData(i, restVarDecl);
  }

  return params;
}

/**
 * Prepare the normal mixin-candidate body for direct invocation.
 *
 * This is the slice of the old candidate loop that wires per-call identity,
 * visibility, parent/source provenance, param normalization, and lookup scope
 * construction before guard evaluation or output shaping runs.
 */
export function prepareMixinCandidateInvocation(
  rules: Rules,
  params: List<Node> | undefined,
  parent: Node | undefined,
  sourceParent: Node | undefined,
  index: number,
  nodeArgs: readonly Node[],
  context: Context,
  instanceRoot?: SessionInstanceRoot
): PreparedMixinCandidateInvocation {
  if (instanceRoot) {
    rules._instanceRoot = instanceRoot;
  }

  patchField(rules, 'options', {
    ...rules.options,
    rulesVisibility: {
      ...(rules.options.rulesVisibility ?? {}),
      VarDeclaration: 'public'
    }
  }, context);
  setParent(rules, parent, context);
  setSourceParent(rules, sourceParent, context);

  const normalizedParams = normalizeMixinInvocationParams(params, context);
  const outerRules = normalizedParams
    ? prepareMixinInvocationScope(
        rules,
        context.rulesContext ?? parent,
        index,
        normalizedParams,
        nodeArgs,
        context
      )
    : undefined;

  return {
    rules,
    params: normalizedParams,
    outerRules,
    lookupScope: outerRules ?? rules,
    guardScopeChildren: outerRules
      ? [...getChildren(outerRules, context)]
      : undefined
  };
}

/**
 * Run an evaluation step with the mixin invocation scope as the active lookup
 * scope, then restore the caller's prior rulesContext.
 */
export function withMixinLookupScope<T>(
  scope: Rules | undefined,
  context: Context,
  fn: () => MaybePromise<T>
): MaybePromise<T> {
  const previousRulesContext = context.rulesContext;
  const previousLookupScope = context.lookupScope;
  context.lookupScope = scope;
  context.rulesContext = scope;
  try {
    const out = fn();
    if (isThenable(out)) {
      return (out as Promise<T>).finally(() => {
        context.lookupScope = previousLookupScope;
        context.rulesContext = previousRulesContext;
      });
    }
    context.lookupScope = previousLookupScope;
    context.rulesContext = previousRulesContext;
    return out;
  } catch (error) {
    context.lookupScope = previousLookupScope;
    context.rulesContext = previousRulesContext;
    throw error;
  }
}

/**
 * Evaluate one mixin guard candidate against the prepared invocation scope.
 *
 * This centralizes the reset-session guard probe behavior so the caller loop
 * only has to deal with the result (`passes`, optional default group, evolved
 * scope) instead of the probing mechanics.
 */
export async function evaluateMixinGuardCandidate(
  guardNode: Condition | Bool | undefined,
  outerRules: Rules | undefined,
  guardParent: Node | undefined,
  lookupScope: Rules,
  context: Context,
  scopeChildren: readonly Node[] | undefined,
  hasDefault: boolean
): Promise<EvaluatedMixinGuard> {
  if (!guardNode) {
    return { passes: true, outerRules };
  }

  const evaluateWithDefault = async (
    isDefaultValue: boolean
  ): Promise<{ passes: boolean; outerRules: Rules | undefined }> => {
    const prevSession = context.session;
    const prevIsDefault = context.isDefault;
    context.session = new EvalSession({ resetEvalState: true });
    try {
      const nextScope = seedMixinGuardScope(
        outerRules,
        guardParent,
        guardNode,
        context,
        scopeChildren
      );
      context.isDefault = isDefaultValue;
      const probeResult = await withMixinLookupScope(
        nextScope ?? lookupScope,
        context,
        () => guardNode.eval(context)
      );
      return {
        passes: probeResult instanceof Bool && probeResult.value === true,
        outerRules: nextScope
      };
    } finally {
      context.isDefault = prevIsDefault;
      context.session = prevSession;
    }
  };

  if (hasDefault) {
    const passWhenDefaultFalse = await evaluateWithDefault(false);
    const passWhenDefaultTrue = await evaluateWithDefault(true);
    const defaultGroup = classifyMixinDefaultGroup(
      passWhenDefaultFalse.passes,
      passWhenDefaultTrue.passes
    );
    return {
      passes: defaultGroup !== undefined,
      outerRules: passWhenDefaultTrue.outerRules ?? passWhenDefaultFalse.outerRules ?? outerRules,
      defaultGroup
    };
  }

  const result = await evaluateWithDefault(false);
  return {
    passes: result.passes,
    outerRules: result.outerRules
  };
}

/**
 * Turn a session-evaluated mixin body into a portable returned result tree.
 *
 * Direct body eval now writes resolved values through shadow state on the
 * canonical body. Returned mixin output cannot depend on that transient state
 * still being active during later serialization or downstream composition, so
 * this boundary materializes only the returned wrapper/result shape.
 */
export function finalizeMixinInvocationOutput(
  rules: Rules,
  context: Context
): Rules {
  if (!context.session) {
    return rules;
  }
  if (rules !== rules.sourceNode) {
    return rules;
  }
  return rules.cloneDetachedMaterializedWrapper(context);
}

/**
 * Project bound mixin params into the returned output shape.
 *
 * Older mixin semantics exposed bound param vars at the top of the returned
 * rules block. Keep that behavior as an explicit output-shaping primitive
 * instead of leaving it implicit inside `getFunctionFromMixins()`.
 */
export function projectMixinParamScopeIntoOutput(
  output: Rules,
  scope: Rules | undefined,
  context: Context
): Rules {
  if (!scope) {
    return output;
  }

  const projectedParams = getChildren(scope, context)
    .filter((node): node is VarDeclaration => {
      if (!isNode(node, N.VarDeclaration)) {
        return false;
      }
      if (!node.options?.paramVar) {
        return false;
      }
      return node.getPropertyName(context) !== 'arguments';
    })
    .map((node) => {
      const copy = node.materializeEvaluatedCopy(context) as VarDeclaration;
      copy.addFlag(F_VISIBLE);
      return copy;
    });

  if (projectedParams.length === 0) {
    return output;
  }

  const merged = Rules.create(
    [...projectedParams, ...getChildren(output, context)],
    output.options ? { ...output.options } : undefined
  );
  merged.inherit(output);
  merged._instanceRoot = output._instanceRoot;
  return merged;
}

/**
 * Classify a default() guard probe pair into Less-style default groups.
 */
export function classifyMixinDefaultGroup(
  passWhenDefaultFalse: boolean,
  passWhenDefaultTrue: boolean
): MixinDefaultGroup | undefined {
  if (!passWhenDefaultFalse && !passWhenDefaultTrue) {
    return undefined;
  }
  if (passWhenDefaultFalse && passWhenDefaultTrue) {
    return MixinDefaultGroup.None;
  }
  return passWhenDefaultTrue
    ? MixinDefaultGroup.True
    : MixinDefaultGroup.False;
}

/**
 * Resolve which default() candidate groups should win for the current call.
 */
export function resolveWinningMixinDefaultGroups(
  groups: readonly MixinDefaultGroup[]
): Set<MixinDefaultGroup> {
  let hasDefNoneCandidate = false;
  let defTrueCount = 0;
  let defFalseCount = 0;

  for (const group of groups) {
    if (group === MixinDefaultGroup.True) {
      defTrueCount++;
    } else if (group === MixinDefaultGroup.False) {
      defFalseCount++;
    } else if (group === MixinDefaultGroup.None) {
      hasDefNoneCandidate = true;
    }
  }

  if (!hasDefNoneCandidate && (defTrueCount + defFalseCount) > 1) {
    throw new ReferenceError('Ambiguous use of default() while matching mixins.');
  }

  if (hasDefNoneCandidate) {
    return new Set([MixinDefaultGroup.None, MixinDefaultGroup.False]);
  }

  return new Set([MixinDefaultGroup.True]);
}

/**
 * Replay only the winning pending default() candidates with the correct lookup
 * scope active for each candidate.
 */
export async function replayWinningMixinDefaultCandidates<TCandidate>(
  pendingCandidates: readonly PendingMixinDefaultCandidate<TCandidate>[],
  context: Context,
  evaluateCandidateOutput: (
    pending: PendingMixinDefaultCandidate<TCandidate>
  ) => MaybePromise<void>
): Promise<void> {
  if (pendingCandidates.length === 0) {
    return;
  }

  const winningGroups = resolveWinningMixinDefaultGroups(
    pendingCandidates.map(pending => pending.group)
  );

  for (const pending of pendingCandidates) {
    if (!winningGroups.has(pending.group)) {
      continue;
    }
    await withMixinLookupScope(
      pending.outerRules ?? pending.rules,
      context,
      () => evaluateCandidateOutput(pending)
    );
  }
}

/**
 * Assemble the final mixin output `Rules` from already-evaluated candidate
 * results, preserving source order and mixin-output visibility semantics.
 */
export function assembleMixinInvocationOutput(
  outputRules: Rules[],
  restrictMixinOutputLookup: boolean,
  context: Context
): Rules {
  outputRules.sort(comparePosition);

  if (outputRules.length === 1) {
    const output = outputRules[0]!;
    output.options.isMixinOutput ??= restrictMixinOutputLookup;
    return output;
  }

  const output = Rules.create([], {
    rulesVisibility: {
      Ruleset: 'public',
      Declaration: 'public',
      VarDeclaration: 'public',
      Mixin: 'public'
    },
    isMixinOutput: restrictMixinOutputLookup
  });

  for (let i = 0; i < outputRules.length; i++) {
    const rule = outputRules[i]!;
    rule.frozen = true;
    rule.index = i;
    if (context.session) {
      setParent(rule, output, context);
      output.push(context, rule);
    } else {
      output.push(rule);
    }
  }

  return output;
}

/**
 * Evaluate a ruleset candidate whose guard already passed during Ruleset
 * evaluation, preserving mixin-output semantics and instance-root association.
 */
export async function evaluateRulesetMixinCandidateOutput(
  sourceRules: Rules,
  parent: Node | undefined,
  sourceParent: Node | undefined,
  candidateIndex: number,
  restrictMixinOutputLookup: boolean,
  context: Context,
  instanceRoot?: SessionInstanceRoot
): Promise<Rules> {
  let rules = sourceRules.clone(true, undefined, context);
  if (instanceRoot) {
    rules._instanceRoot = instanceRoot;
  }
  setParent(rules, parent, context);
  setSourceParent(rules, sourceParent, context);
  const previousRulesContext = context.rulesContext;
  context.rulesContext = rules;
  try {
    rules = await rules.eval(context);
  } finally {
    context.rulesContext = previousRulesContext;
  }
  setSourceParent(rules, sourceParent, context);
  setParent(rules, parent, context);
  rules.index = candidateIndex;
  rules.options.isMixinOutput = restrictMixinOutputLookup;
  if (instanceRoot) {
    rules._instanceRoot = instanceRoot;
  }
  return rules;
}

/**
 * Create the unlocked output for a detached ruleset call without flattening
 * the source body eagerly.
 */
export function unlockDetachedRulesetMixinCandidateOutput(
  sourceRules: Rules,
  parent: Node | undefined,
  sourceParent: Node | undefined,
  candidateIndex: number,
  context: Context,
  instanceRoot?: SessionInstanceRoot
): Rules {
  const unlocked = sourceRules.cloneDetachedUnlockWrapper(context);
  setParent(unlocked, parent, context);
  setSourceParent(unlocked, sourceParent, context);
  unlocked.options.isMixinOutput = false;
  unlocked.index = candidateIndex;
  if (instanceRoot) {
    unlocked._instanceRoot = instanceRoot;
  }
  return unlocked;
}

/**
 * Process one prepared normal mixin candidate. This owns the remaining guard /
 * default orchestration for the standard candidate path: either dispatch the
 * candidate output immediately or return a pending default() replay record.
 */
export async function processPreparedMixinCandidate<TCandidate>(
  options: ProcessPreparedMixinCandidateOptions<TCandidate>
): Promise<PendingMixinDefaultCandidate<TCandidate> | undefined> {
  const {
    candidate,
    rules,
    params,
    outerRules,
    guard,
    parent,
    lookupScope,
    guardScopeChildren,
    hasDefault,
    context,
    instanceRoot,
    evaluateCandidateOutput
  } = options;

  let nextOuterRules = outerRules;
  if (guard) {
    const evaluatedGuard = await evaluateMixinGuardCandidate(
      guard,
      nextOuterRules,
      parent,
      lookupScope,
      context,
      guardScopeChildren,
      hasDefault
    );
    nextOuterRules = evaluatedGuard.outerRules;
    if (!evaluatedGuard.passes) {
      return undefined;
    }
    if (hasDefault) {
      return {
        candidate,
        rules,
        outerRules: nextOuterRules,
        params,
        group: evaluatedGuard.defaultGroup!,
        instanceRoot
      };
    }
  }

  await withMixinLookupScope(
    lookupScope,
    context,
    () => evaluateCandidateOutput(candidate, rules, nextOuterRules, params, instanceRoot)
  );
  return undefined;
}
