import { Context } from '../../context.js';
import { EvalState } from '../../eval-state.js';
import { Node } from '../node-base.js';

/** @deprecated — dead concept. Kept as type alias for migration. */
type SessionInstanceRoot = unknown;
import { Bool } from '../bool.js';
import type { Condition } from '../condition.js';
import { Nil } from '../nil.js';
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
import { getChildren, getDependency, getField, getParent, getSourceParent, mergeDependencies, setField, setChildren, setDependency, setParent, setSourceParent } from './field-helpers.js';
import type { Mixin } from '../mixin.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { cast } from './cast.js';
import { isPlainObject } from './collections.js';
import type { MixinEntry } from '../rules.js';

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
  _candidate: MixinEntry,
  _context: Context
): SessionInstanceRoot | undefined {
  // Instance roots are a dead concept. Always return undefined.
  return undefined;
}

/**
 * Apply the final return policy for mixin invocation output.
 *
 * - Context receivers get a live `Rules` result (or `Nil` if empty), with
 *   `ruleCounter` assigned on first return.
 * - Non-Context receivers get a plain object view, preserving legacy
 *   `getFunctionFromMixins()` semantics.
 */
export function finalizeMixinInvocationReturn(
  output: Rules,
  receiver: Context | Node
): Rules | Nil | ReturnType<Rules['toObject']> {
  if (receiver instanceof Context) {
    output.index ??= receiver.ruleCounter++;
    if (output.value.length === 0) {
      return new Nil();
    }
    return output;
  }
  return output.toObject();
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
  setField(param, 'value', value, context);
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
    setParent(child, nextScope, context);
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

  setField(rules, 'options', {
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
    const prevIsDefault = context.isDefault;
    context.evalStateStack.push(new EvalState());
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
      context.evalStateStack.pop();
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
/**
 * Finalize mixin invocation output.
 *
 * Creates a thin distinct wrapper per call so each call's output can
 * carry its own _evalPosition. No deep materialization — the wrapper
 * shares children with the canonical body. Only the wrapper itself
 * is a new object (one allocation per call, not N per subtree).
 */
export function finalizeMixinInvocationOutput(
  rules: Rules,
  context: Context
): Rules {
  // Each call needs a distinct output node to carry its own _evalPosition.
  // cloneDetachedShallowWrapper creates a thin shell sharing children.
  if (rules === rules.sourceNode) {
    const wrapper = rules.cloneDetachedShallowWrapper(context);
    // The per-call position has patches keyed by the original `rules` node
    // (e.g. the 'value' array). Copy those patches to the wrapper so
    // getField(wrapper, ...) finds them.
    {
      const rulesState = context.activeState.peek(rules);
      const patchedValue = rulesState?._fields?.get('value');
      if (patchedValue !== undefined) {
        context.activeState.get(wrapper).fields.set('value', patchedValue);
      }
    }
    return wrapper;
  }
  return rules;
}

/**
 * Project bound mixin params into the returned output shape.
 *
 * Older mixin semantics exposed bound param vars at the top of the returned
 * rules block. Keep that behavior as an explicit output-shaping primitive
 * instead of leaving it implicit inside `getFunctionFromMixins()`.
 */
/**
 * @removal-target — node-copy-reduction
 * Target: remove materializeEvaluatedCopy on params. Param vars should be
 * readable through the carried position/session, not materialized into
 * the output. The position already holds the bound values.
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
      // Use a simple copy (no materialization) — the param's bound value
      // is already on the canonical node via setData in matchMixinCandidates.
      const copy = node.copy(true) as VarDeclaration;
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
    setParent(rule, output, context);
    output.push(context, rule);
  }

  return output;
}

/**
 * Evaluate a ruleset candidate whose guard already passed during Ruleset
 * evaluation, preserving mixin-output semantics and instance-root association.
 *
 * @removal-target — node-copy-reduction: clone(true) on sourceRules.
 * Replace with new EvalPosition(sourceRules) — eval the canonical body
 * with position patches instead of deep cloning it.
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

// -- Scope ancestry helpers --

/**
 * Walk the parent chain (via session helpers) to find the nearest Rules ancestor.
 */
export function findRulesAncestor(node: Node | undefined, context: Context): Rules | undefined {
  let current = node ? getParent(node, context) : undefined;
  while (current && current.type !== 'Rules') {
    current = getParent(current, context);
  }
  return current as Rules | undefined;
}

/**
 * Walk sourceParent chain then parent chain to find the nearest source Rules ancestor.
 */
export function findSourceRulesAncestor(node: Node | undefined, context: Context): Rules | undefined {
  let current = node;
  let sp = current ? getSourceParent(current, context) : undefined;
  while (current && !sp) {
    current = getParent(current, context);
    sp = current ? getSourceParent(current, context) : undefined;
  }
  return sp ? findRulesAncestor(sp, context) : undefined;
}

/**
 * Resolve the candidate's parent, throwing if absent.
 *
 * Accepts `Node<any, any>` so callers don't need `as unknown as Node` casts
 * for typed subclasses like Mixin or Ruleset.
 */
export function getCandidateParent(node: Node<any, any>, context: Context): Node {
  const parent = getParent(node as Node, context);
  if (!parent) {
    throw new ReferenceError(`${node.type} candidate must have a parent during mixin evaluation`);
  }
  return parent;
}

// -- Arg evaluation --

/**
 * Normalize leading whitespace in bound List/Sequence values.
 */
function normalizeBoundLeadingItemWhitespace(node: Node): void {
  if (!isNode(node, N.List | N.Sequence)) {
    return;
  }
  const items = (node as unknown as { value: Node[] }).value;
  if (items.length > 0) {
    items[0]!.pre = 0;
  }
  for (const item of items) {
    if (isNode(item, N.List | N.Sequence)) {
      normalizeBoundLeadingItemWhitespace(item as Node);
    }
  }
}

/**
 * Copy dependency tracking from source to target node.
 */
function copyDependency(source: Node, target: Node, context: Context): void {
  const dependency = getDependency(source, context);
  if (dependency?.dependsOn && dependency.dependsOn.size > 0) {
    setDependency(target, {
      dependsOn: new Set(dependency.dependsOn),
      sourceExpr: dependency.sourceExpr
    }, context);
  }
}

/**
 * Evaluate raw call args into a flat array of frozen Node values.
 *
 * @removal-target — node-copy-reduction (copy/clonedEval/freeze cycle)
 * Target: evaluate args in a position instead of copy+clonedEval+freeze.
 * The copy(true, freezeChildren) + clonedEval pattern creates full deep
 * copies of every arg. With positions, eval args in a fresh position and
 * bind results via position patches — no copies, no freezing needed.
 */
export async function evaluateMixinArgs(
  args: any[],
  caller: Node | undefined,
  context: Context
): Promise<Node[]> {
  const nodeArgs: Node[] = [];
  const callerSourceNode = (caller as any)?.name instanceof Node
    ? (caller as any).name
    : caller;
  const savedRulesContext = context.rulesContext;
  const argEvalRulesContext = findRulesAncestor(caller, context)
    ?? findSourceRulesAncestor(callerSourceNode, context)
    ?? savedRulesContext;
  context.rulesContext = argEvalRulesContext;
  try {
    for (const arg of args) {
      if (isNode(arg)) {
        if (isNode(arg, N.VarDeclaration)) {
          const cloned = arg.copy(true, freezeChildren);
          const clonedValue = (cloned as VarDeclaration).value;
          if (clonedValue instanceof Node) {
            const evaldValue = await clonedValue.clonedEval(context);
            evaldValue.frozen = true;
            (cloned as VarDeclaration).setData('value', evaldValue);
          }
          cloned.frozen = true;
          nodeArgs.push(cloned);
          continue;
        }
        const evald = await arg.clonedEval(context);
        if (evald.type === 'Rest') {
          let restValue = (evald as unknown as { value: unknown }).value;
          if (isNode(restValue as Node) && !isNode(restValue as Node, N.Sequence | N.List)) {
            restValue = await (restValue as Node).eval(context);
          }
          if (isNode(restValue, N.Sequence) || isNode(restValue, N.List)) {
            for (const restArg of (restValue as unknown as { value: Node[] }).value) {
              const frozenRestArg = restArg.copy(true, freezeChildren);
              frozenRestArg.frozen = true;
              nodeArgs.push(frozenRestArg);
            }
            continue;
          }
        }
        evald.frozen = true;
        nodeArgs.push(evald);
      } else {
        nodeArgs.push(cast(arg));
      }
    }
  } finally {
    context.rulesContext = savedRulesContext;
  }
  return nodeArgs;
}

// -- Candidate matching --

/**
 * Evaluate a pattern-match operand in a fresh session scope.
 */
async function preparePatternOperand(node: Node, context: Context): Promise<Node> {
  context.evalStateStack.push(new EvalState());
  try {
    return await node.eval(context);
  } finally {
    context.evalStateStack.pop();
  }
}

/**
 * Match the mixin array against evaluated args. Returns the candidates whose
 * param signatures match (with params bound).
 *
 * @removal-target — node-copy-reduction (copy/freeze in param binding)
 * The copy(true, freezeChildren) calls on bound values create full deep
 * copies of every arg value per candidate. With positions, bind through
 * position.setField instead — no copies needed.
 * The params.copy(true) and mixin.clone(false)/mixin.copy() also create
 * objects that positions can eliminate.
 */
export async function matchMixinCandidates(
  mixinArr: MixinEntry[],
  nodeArgs: Node[],
  caller: Node | undefined,
  sourceParent: Node | undefined,
  context: Context
): Promise<MixinEntry[]> {
  const mixinCandidates: MixinEntry[] = [];
  const bindingSourceParent = caller ?? sourceParent;

  for (let i = 0; i < mixinArr.length; i++) {
    let mixin = mixinArr[i]!;
    const isPlainRule = isNode(mixin, N.Rules);
    const paramLength = isPlainRule ? 0 : ((mixin as any).params?.length ?? 0);

    if (!paramLength) {
      if (nodeArgs.length) {
        continue;
      }
      mixinCandidates.push(mixin);
    } else {
      const params = ((mixin as any).params as List<Node>).copy(true);
      const hasRestParamOriginal = ((mixin as any).params as List<Node>).value.some(
        (p: Node) => p.type === 'Rest'
      );
      const maxPositionalArgs = hasRestParamOriginal ? Number.POSITIVE_INFINITY : params.length;
      const positions = params.length;
      let requiredPositions = 0;
      for (const param of params.value) {
        if (isNode(param, N.VarDeclaration)) {
          if ((param as VarDeclaration).value instanceof Nil) {
            requiredPositions++;
          }
        } else if (isNode(param, N.Any) && param.role === 'property') {
          requiredPositions++;
        } else if (param.type !== 'Rest') {
          requiredPositions++;
        }
      }

      let argPos = 0;
      let match = true;
      for (let pi = 0; pi < positions; pi++) {
        const arg = nodeArgs[argPos];
        if (!arg) {
          continue;
        }
        let param: Node | undefined;
        let argValue: Node;

        if (isNode(arg, N.VarDeclaration)) {
          param = params.value.find((p: Node) => {
            if (isNode(p, N.VarDeclaration)) {
              return (p as VarDeclaration).name.valueOf() === (arg as VarDeclaration).name.valueOf();
            }
            if (isNode(p, N.Any) && p.role === 'property') {
              return p.valueOf() === (arg as VarDeclaration).name.valueOf();
            }
            return false;
          });
          if (param) {
            argValue = (arg as VarDeclaration).value as Node;
          } else {
            match = false;
            break;
          }
        } else {
          param = params.value[pi];
          if (!param) {
            match = false;
            break;
          }
          argValue = arg;
        }

        if (!param) {
          match = false;
          break;
        }

        if (isNode(param, N.VarDeclaration)) {
          const boundValue = argValue.copy(true, freezeChildren);
          boundValue.frozen = true;
          if (bindingSourceParent) {
            setSourceParent(boundValue, bindingSourceParent, context);
          }
          normalizeBoundLeadingItemWhitespace(boundValue);
          copyDependency(argValue, boundValue, context);
          param.setData('value', boundValue);
        } else if (isNode(param, N.Any) && param.role === 'property') {
          const boundValue = argValue.copy(true, freezeChildren);
          boundValue.frozen = true;
          if (bindingSourceParent) {
            setSourceParent(boundValue, bindingSourceParent, context);
          }
          normalizeBoundLeadingItemWhitespace(boundValue);
          copyDependency(argValue, boundValue, context);
          const varDecl = new VarDeclarationCtor({
            name: param as Any<'property'>,
            value: boundValue
          }, { paramVar: true });
          params.setData(pi, varDecl);
        } else if (param.type === 'Rest') {
          const rest = nodeArgs.slice(argPos).map((restArg) => {
            const cloned = restArg.copy(true, freezeChildren);
            cloned.frozen = true;
            copyDependency(restArg, cloned, context);
            return cloned;
          });
          const restValue = new Sequence(rest);
          const dependency = mergeDependencies(rest, context);
          if (dependency?.dependsOn && dependency.dependsOn.size > 0) {
            setDependency(restValue, {
              dependsOn: new Set(dependency.dependsOn),
              sourceExpr: dependency.sourceExpr
            }, context);
          }
          const restVarDecl = new VarDeclarationCtor({
            name: new Any(
              (param as unknown as { value: string | undefined }).value
                ? `${(param as unknown as { value: string }).value}`
                : `rest${pi}`,
              { role: 'property' }
            ) as Any<'property'>,
            value: restValue
          });
          params.setData(pi, restVarDecl);
        } else {
          const originalPatternParam = !isNode(arg, N.VarDeclaration)
            ? ((mixin as any).params as List<Node> | undefined)?.value[pi]
            : undefined;
          const preparedParam = isNode(originalPatternParam as Node | undefined, N.Selector)
            ? await preparePatternOperand(originalPatternParam as Node, context)
            : isNode(param, N.Selector)
              ? await preparePatternOperand(param, context)
              : param;
          if (preparedParam.compare(argValue, context) !== 0) {
            match = false;
            break;
          }
        }
        argPos++;
      }

      const positionalArgCount = nodeArgs.filter(argNode => !isNode(argNode, N.VarDeclaration)).length;
      if (positionalArgCount > maxPositionalArgs) {
        continue;
      }
      if (argPos < requiredPositions) {
        continue;
      }
      if (nodeArgs.length > 1 && params.value.length === 1 && requiredPositions === 1) {
        continue;
      }
      if (match) {
        const originalMixin = mixin;
        mixin = mixin.clone(false, undefined, context);
        getCandidateParent(originalMixin, context).adopt(mixin);
        (mixin as any).setData('params', params);
        mixinCandidates.push(mixin);
      }
    }
  }

  return mixinCandidates;
}

// -- Candidate filtering and sorting --

/**
 * Walk a node tree looking for `default()` / `DefaultGuard` / `??` calls.
 */
function guardContainsDefault(node: Node | undefined): boolean {
  if (!node) {
    return false;
  }
  if (node.type === 'DefaultGuard') {
    return true;
  }
  if (node.type === 'Call') {
    const callName = String((node as unknown as { name?: { valueOf?: () => string } }).name?.valueOf?.()
      ?? (node as unknown as { name?: string }).name ?? '');
    if (callName === 'default' || callName === '??') {
      return true;
    }
  }
  const value = (node as unknown as { value: unknown }).value;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isNode(item) && guardContainsDefault(item)) {
        return true;
      }
    }
    return false;
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value as Record<string, unknown>)) {
      if (isNode(item as Node) && guardContainsDefault(item as Node)) {
        return true;
      }
      if (Array.isArray(item)) {
        for (const child of item) {
          if (isNode(child) && guardContainsDefault(child)) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * Check whether a node has a failed-guard ancestor (Ruleset with Nil guard).
 */
function hasFailedGuardAncestor(node: Node<any, any>, context: Context): boolean {
  let current: Node | undefined = getParent(node as Node, context);
  while (current) {
    if (isNode(current, N.Ruleset)) {
      const guardNode = (current as unknown as { guard: unknown }).guard;
      if (guardNode instanceof Nil) {
        return true;
      }
    }
    current = getParent(current, context);
  }
  return false;
}

/**
 * Filter matched candidates by eval-stack guard and sort default-guard
 * candidates to the end.
 *
 * Returns `{ evalCandidates, hasDefault }`.
 */
export function filterAndSortMixinEvalCandidates(
  mixinCandidates: MixinEntry[],
  context: Context
): { evalCandidates: MixinEntry[]; hasDefault: boolean } {
  let hasDefault = false;
  let evalCandidates = mixinCandidates
    .filter((candidate) => {
      const inStack = context.rulesEvalStack.includes((candidate as Mixin).rules.sourceNode as Rules);
      const blockedByFailedGuard = hasFailedGuardAncestor(candidate, context);
      return !inStack && !blockedByFailedGuard;
    })
    .map<MixinEntry>((candidate) => {
      const hasDefaultGuard = Boolean(candidate.options?.hasDefault)
        || guardContainsDefault((candidate as Mixin).guard as Node | undefined);
      if (hasDefaultGuard) {
        candidate.options ??= {};
        candidate.options.hasDefault = true;
        hasDefault = true;
      }
      return candidate;
    });

  if (hasDefault) {
    evalCandidates = evalCandidates.slice(0).sort((a, b) => {
      const aDefault = a.options?.hasDefault;
      const bDefault = b.options?.hasDefault;
      if (!aDefault && !bDefault) {
        return 0;
      }
      if (!aDefault) {
        return -1;
      }
      if (!bDefault) {
        return 1;
      }
      return 0;
    });
  }

  if (evalCandidates.length === 0) {
    throw new ReferenceError('No matching mixins found.');
  }

  return { evalCandidates, hasDefault };
}

// -- Candidate output evaluation --

export type EvaluateCandidateOutputOptions = {
  sourceParent: Node | undefined;
  restrictMixinOutputLookup: boolean;
  outputRules: Rules[];
  getCandidateParent: (node: Node<any, any>) => Node;
};

/**
 * Evaluate a single mixin candidate's body and push the result to outputRules.
 *
 * Handles recursion detection, position creation, body eval, output
 * finalization, param scope projection, and instance root association.
 */
export async function evaluateCandidateOutput(
  candidate: MixinEntry,
  rules: Rules,
  outerRules: Rules | undefined,
  params: List<Node> | undefined,
  context: Context,
  opts: EvaluateCandidateOutputOptions,
  instanceRoot?: SessionInstanceRoot
): Promise<void> {
  const { sourceParent, restrictMixinOutputLookup, outputRules, getCandidateParent: getParentFn } = opts;
  const currentCall = context.callStack.at(-1);
  if (currentCall && context.callMap.add(currentCall, params)) {
    return;
  }

  // Push a per-call EvalState so this mixin body evaluates in its own overlay.
  const callState = new EvalState();
  context.evalStateStack.push(callState);
  try {
    let newRules: Rules;
    // The outerRules (param scope) parent was set in the previous state.
    // Copy it into the per-call state so lookups during body eval can
    // walk through the param scope to the caller's scope chain.
    if (outerRules) {
      // Check the parent in the state stack below us (the caller's state)
      const prevStack = context.evalStateStack;
      const callerStateIdx = prevStack.length - 2;
      if (callerStateIdx >= 0) {
        const callerState = prevStack[callerStateIdx]!;
        const outerParent = callerState.peek(outerRules)?._fields?.get('parent');
        if (outerParent !== undefined) {
          setParent(outerRules, outerParent as Node, context);
        }
      }
    }
    if (!outerRules) {
      setParent(rules, getParentFn(candidate), context);
      newRules = await rules.eval(context);
    } else {
      setParent(rules, outerRules, context);
      newRules = await rules.eval(context);
    }
    newRules = finalizeMixinInvocationOutput(newRules, context);
    newRules = projectMixinParamScopeIntoOutput(newRules, outerRules, context);
    // Pop the per-call state before we write to the caller's state.
    context.evalStateStack.pop();
    setSourceParent(newRules, sourceParent, context);
    setParent(newRules, getParentFn(candidate), context);
    newRules.index = candidate.index;
    newRules.options.isMixinOutput = restrictMixinOutputLookup;
    if (context.treeContext?.file) {
      newRules.options.rulesVisibility ??= {};
      newRules.options.rulesVisibility.VarDeclaration = 'private';
    }
    if (instanceRoot) {
      newRules._instanceRoot = instanceRoot;
    }
    // Carry the per-call state on the output node so downstream reads
    // resolve through this call's patches, not the canonical state.
    if (callState.size > 0) {
      newRules._evalPosition = callState;
    }
    outputRules.push(newRules);
  } catch (error) {
    context.evalStateStack.pop();
    if (error instanceof ReferenceError && error.message?.includes('Recursive mixin call')) {
      return;
    }
    throw error;
  } finally {
    if (currentCall) {
      context.callMap.delete(currentCall);
    }
  }
}

// -- Dispatch orchestration --

export type MixinDispatchContext = {
  evalCandidates: MixinEntry[];
  hasDefault: boolean;
  nodeArgs: Node[];
  sourceParent: Node | undefined;
  caller: Node | undefined;
  restrictMixinOutputLookup: boolean;
  outputRules: Rules[];
  getCandidateParent: (node: Node<any, any>) => Node;
  evaluateCandidateOutput: (
    candidate: MixinEntry,
    rules: Rules,
    outerRules: Rules | undefined,
    params: List<Node> | undefined,
    instanceRoot?: SessionInstanceRoot
  ) => Promise<void>;
};

/**
 * Dispatch all mixin eval candidates — the main candidate loop.
 *
 * Handles Ruleset candidates, detached rulesets, and normal parameterized
 * mixins. Includes default guard replay and output assembly.
 */
export async function dispatchMixinEvalCandidates(
  dispatch: MixinDispatchContext,
  context: Context
): Promise<Rules> {
  const {
    evalCandidates,
    hasDefault,
    nodeArgs,
    sourceParent,
    caller,
    restrictMixinOutputLookup,
    outputRules,
    getCandidateParent,
    evaluateCandidateOutput
  } = dispatch;
  const pendingDefaultCandidates: PendingMixinDefaultCandidate<any>[] = [];

  context.evalStateStack.push(new EvalState());

  for (const candidate of evalCandidates) {
    const candidateInstanceRoot = createMixinCandidateInstanceRoot(
      candidate,
      context
    );

    if (isNode(candidate, N.Ruleset)) {
      if (candidate.guard instanceof Nil) {
        continue;
      }
      const candidateRules = candidate.rules;
      const sourceRules = getRootSourceRules(candidateRules);
      const rules = await evaluateRulesetMixinCandidateOutput(
        sourceRules,
        getCandidateParent(candidate),
        sourceParent,
        candidate.index,
        restrictMixinOutputLookup,
        context,
        candidateInstanceRoot
      );
      outputRules.push(rules);
      continue;
    }

    // After the Ruleset branch above, candidate must be a Mixin
    if (!isNode(candidate, N.Mixin)) {
      continue;
    }
    if (!candidate.name && !candidate.params && !candidate.guard) {
      const sourceRules = getRootSourceRules(candidate.rules);
      const unlocked = unlockDetachedRulesetMixinCandidateOutput(
        sourceRules,
        getCandidateParent(candidate),
        sourceParent ?? caller,
        candidate.index,
        context,
        candidateInstanceRoot
      );
      outputRules.push(unlocked);
      continue;
    }

    let rules = candidate.rules;
    let params = getField<List<Node> | undefined>(candidate as Node, 'params', context);
    const prepared = prepareMixinCandidateInvocation(
      rules,
      params,
      getCandidateParent(candidate),
      sourceParent,
      candidate.index,
      nodeArgs,
      context,
      candidateInstanceRoot
    );
    rules = prepared.rules;
    params = prepared.params;
    const canonicalGuard = candidate.guard;
    const pendingDefaultCandidate = await processPreparedMixinCandidate({
      candidate,
      rules,
      params,
      outerRules: prepared.outerRules,
      guard: canonicalGuard,
      parent: getCandidateParent(candidate),
      lookupScope: prepared.lookupScope,
      guardScopeChildren: prepared.guardScopeChildren,
      hasDefault,
      context,
      instanceRoot: candidateInstanceRoot,
      evaluateCandidateOutput
    });
    if (pendingDefaultCandidate) {
      pendingDefaultCandidates.push(pendingDefaultCandidate);
    }
  }

  await replayWinningMixinDefaultCandidates(
    pendingDefaultCandidates,
    context,
    pending => evaluateCandidateOutput(
      pending.candidate,
      pending.rules,
      pending.outerRules,
      pending.params,
      pending.instanceRoot
    )
  );

  context.evalStateStack.pop();

  const output = assembleMixinInvocationOutput(
    outputRules,
    restrictMixinOutputLookup,
    context
  );

  return output;
}
