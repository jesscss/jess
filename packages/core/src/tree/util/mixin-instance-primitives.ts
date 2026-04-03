import { Context } from '../../context.js';
import { Node } from '../node-base.js';

import { Bool } from '../bool.js';
import type { Condition } from '../condition.js';
import { Nil } from '../nil.js';
import { Rules } from '../rules.js';
import type { Ruleset } from '../ruleset.js';
import type { AtRule } from '../at-rule.js';
import type { VarDeclaration } from '../declaration-var.js';
import { VarDeclaration as VarDeclarationCtor } from '../declaration-var.js';
import { list, type List } from '../list.js';
import { Sequence } from '../sequence.js';
import { Any } from '../any.js';
import { N } from '../node-type.js';
import { CANONICAL, F_VISIBLE } from '../node.js';
import { isNode } from './is-node.js';
import { comparePosition } from './compare.js';
import { getParent, getSourceParent, setChildren, setParent, setSourceParent } from './field-helpers.js';
import type { Mixin } from '../mixin.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { cast } from './cast.js';
import { isPlainObject } from './collections.js';
import type { MixinEntry } from '../rules.js';
import type { RenderKey } from '../node-base.js';
import { getCurrentParentNode } from './selector-utils.js';

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
  lookupScope?: Rules;
};

export type ProcessPreparedMixinCandidateOptions<TCandidate> = {
  candidate: TCandidate;
  rules: Rules;
  params?: List<Node>;
  outerRules?: Rules;
  guard?: Condition | Bool;
  parent: Node | undefined;
  guardScopeChildren?: readonly Node[];
  hasAnyDefault: boolean;
  candidateHasDefault: boolean;
  context: Context;
  evaluateCandidateOutput: (
    candidate: TCandidate,
    rules: Rules,
    outerRules: Rules | undefined,
    params: List<Node> | undefined,
  ) => MaybePromise<void>;
};

/**
 * Follow a Rules node back to its canonical source root. Mixin/ruleset
 * candidate setup wants this shared notion of "the source rules subtree" so
 * that eval state subtrees are always created against the canonical backing body.
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
 * per-call eval state subtree when a session is active.
 */
export function createMixinCandidateInstanceRoot(
  _candidate: MixinEntry,
  _context: Context
): undefined {
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
 * Bind one mixin param through the active eval state subtree instead of mutating the
 * canonical VarDeclaration. This is the smallest useful primitive behind direct
 * mixin invocation.
 */
export function bindMixinParamValue(
  param: VarDeclaration,
  value: Node,
  context: Context
): void {
  param.value = value;
  param.adopt(value, context);
}

/**
 * Create the transient scope that holds bound mixin parameters. This is the
 * direct replacement for the inlined outerRules construction in
 * getFunctionFromMixins().
 */
export function createMixinParamScope(
  index: number,
  renderKey: RenderKey
): Rules {
  const scope = Rules.create([], {
    rulesVisibility: {
      Ruleset: 'public',
      Declaration: 'public',
      VarDeclaration: 'public',
      Mixin: 'public'
    }
  });
  scope.index = index;
  scope.renderKey = renderKey;
  return scope;
}

function createRenderOwnedSequence(
  items: readonly Node[],
  renderKey: RenderKey,
  context: Context
): Sequence {
  const sequence = new Sequence([], { forceSpacing: true }, undefined, context.treeContext);
  sequence.renderKey = renderKey;
  (sequence as unknown as { value: Node[] }).value = [...items];
  const edgeContext = { ...context, renderKey };
  for (const item of items) {
    setParent(item, sequence, edgeContext);
  }
  return sequence;
}

/**
 * Register already-bound parameter declarations into the transient mixin scope.
 * Matching/rest conversion still happens outside this helper; this primitive is
 * only responsible for making those params visible to lookup.
 */
export function populateMixinParamScope(
  scope: Rules,
  params: List<Node>,
  _context: Context
): void {
  const paramItems = params.get('value');
  for (let i = 0; i < paramItems.length; i++) {
    const param = paramItems[i]!;
    if (!isNode(param, N.VarDeclaration)) {
      continue;
    }
    if (param.index === undefined) {
      param.index = -(i + 1);
    }
    param.options ??= {};
    param.options.paramVar = true;
    param.removeFlag(F_VISIBLE);
    // Push canonically — scope is ephemeral, not shared.
    // Avoids the children ending up in a caller-state that the per-call
    // state can't see.
    scope.push(param);
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
  const renderKey = scope.renderKey;
  const paramValues = params?.get('value', renderKey)
    .filter((p): p is VarDeclaration => isNode(p, N.VarDeclaration))
    .map(p => p.get('value', renderKey))
    .filter((value): value is Node => value instanceof Node);
  const argumentNodes = (paramValues && paramValues.length > 0) ? paramValues : nodeArgs;
  const argumentsArgs: Node[] = [];
  for (const argNode of argumentNodes) {
    if (isNode(argNode, N.Sequence) && (argNode as Sequence).get('value', renderKey).length > 1) {
      argumentsArgs.push(...(argNode as Sequence).get('value', renderKey));
    } else {
      argumentsArgs.push(argNode);
    }
  }

  const argumentsDecl = new VarDeclarationCtor({
    name: new Any('arguments', { role: 'property' }),
    value: createRenderOwnedSequence(argumentsArgs, renderKey, context)
  }, { readonly: true, paramVar: true });
  argumentsDecl.removeFlag(F_VISIBLE);
  argumentsDecl.renderKey = renderKey;
  argumentsDecl.preEvaluated = true;
  argumentsDecl.evaluated = true;
  const registrationContext = { ...context, renderKey };
  setParent(argumentsDecl, scope, registrationContext);
  scope.registerNode(argumentsDecl, undefined, registrationContext);
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
  const activeChildren = scopeChildren ?? nextScope.getRegistryChildren(context);
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
 * canonical body attached through state parent shadow only.
 */
export function prepareMixinInvocationScope(
  definitionParent: Node | undefined,
  placementParent: Node | undefined,
  sourceParent: Node | undefined,
  index: number,
  renderKey: RenderKey,
  params: List<Node> | undefined,
  nodeArgs: readonly Node[],
  context: Context
): Rules | undefined {
  if (!params) {
    return undefined;
  }
  const scope = createMixinParamScope(index, renderKey);
  populateMixinParamScope(scope, params, context);
  defineMixinArgumentsInScope(scope, params, nodeArgs, context);
  scope.parent = placementParent ?? definitionParent;
  scope.sourceParent = sourceParent;
  return scope;
}

export function createMixinInvocationRules(
  body: Rules,
  lookupParent: Node | undefined,
  lexicalSourceParent: Node | undefined,
  sourceParent: Node | undefined,
  index: number,
  context: Context,
  renderKey: RenderKey
): Rules {
  const wrapper = body.createShallowBodyWrapper(undefined, renderKey);
  wrapper.index = index;
  wrapper.parent = lookupParent;
  wrapper.sourceParent = sourceParent ?? lexicalSourceParent;

  wrapper.options = {
    ...wrapper.options,
    rulesVisibility: {
      ...(wrapper.options.rulesVisibility ?? {}),
      VarDeclaration: 'public'
    }
  };
  return wrapper;
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
  const paramItems = params.get('value');
  for (let i = 0; i < paramItems.length; i++) {
    const param = paramItems[i]!;
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

    params.value[i] = restVarDecl;
    params.adopt(restVarDecl, context);
  }

  return params;
}

function buildBoundMixinParams(
  params: List<Node> | undefined,
  nodeArgs: readonly Node[],
  bindingSourceParent: Node | undefined,
  renderKey: RenderKey,
  context: Context
): List<Node> | undefined {
  if (!params) {
    return undefined;
  }

  const namedArgs = new Map<string, Node>();
  const positionalArgs: Node[] = [];
  for (const arg of nodeArgs) {
    if (isNode(arg, N.VarDeclaration)) {
      const argName = String((arg as VarDeclaration).get('name').valueOf());
      const argValue = (arg as VarDeclaration).get('value') as Node;
      namedArgs.set(argName, argValue);
    } else {
      positionalArgs.push(arg);
    }
  }

  const bindingContext = { ...context, renderKey };
  const boundParams = list([], params.options ? { ...params.options } : undefined);
  let positionalIndex = 0;

  for (let index = 0; index < params.get('value').length; index++) {
    const param = params.get('value')[index]!;

    if (isNode(param, N.VarDeclaration)) {
      const name = String((param as VarDeclaration).get('name').valueOf());
      const boundParam = new VarDeclarationCtor({
        name: new Any(name, { role: 'property' }),
        value: new Nil()
      }, { ...((param as VarDeclaration).options ?? {}), paramVar: true }, param.location, context.treeContext);
      boundParam.index = param.index ?? -(index + 1);

      const hasNamedArg = namedArgs.has(name);
      const hasPositionalArg = positionalIndex < positionalArgs.length;
      const boundValue = hasNamedArg
        ? namedArgs.get(name)!
        : hasPositionalArg
          ? positionalArgs[positionalIndex++]!
          : (param as VarDeclaration).get('value');
      const cameFromCallSite = hasNamedArg || hasPositionalArg;
      if (
        cameFromCallSite
        && bindingSourceParent
        && (isNode(boundValue, N.Reference) || isNode(boundValue, N.Mixin))
      ) {
        setSourceParent(boundValue, bindingSourceParent, bindingContext);
      }
      boundParam.renderKey = renderKey;
      (boundParam as unknown as { value: Node }).value = boundValue;
      setParent(boundValue, boundParam, bindingContext);
      boundParam.preEvaluated = true;
      boundParam.evaluated = true;
      boundParams.push(boundParam);
      namedArgs.delete(name);
      continue;
    }

    if (isNode(param, N.Any) && param.role === 'property') {
      const name = String(param.valueOf());
      const boundParam = new VarDeclarationCtor({
        name: new Any(name, { role: 'property' }),
        value: new Nil()
      }, { paramVar: true }, param.location, context.treeContext);
      boundParam.index = -(index + 1);
      const hasNamedArg = namedArgs.has(name);
      const hasPositionalArg = positionalIndex < positionalArgs.length;
      const boundValue = hasNamedArg
        ? namedArgs.get(name)!
        : hasPositionalArg
          ? positionalArgs[positionalIndex++]!
          : undefined;
      if (boundValue) {
        if (
          (hasNamedArg || hasPositionalArg)
          && bindingSourceParent
          && (isNode(boundValue, N.Reference) || isNode(boundValue, N.Mixin))
        ) {
          setSourceParent(boundValue, bindingSourceParent, bindingContext);
        }
        (boundParam as unknown as { value: Node }).value = boundValue;
        setParent(boundValue, boundParam, bindingContext);
      }
      boundParam.renderKey = renderKey;
      boundParam.preEvaluated = true;
      boundParam.evaluated = true;
      boundParams.push(boundParam);
      namedArgs.delete(name);
      continue;
    }

    if (param.type === 'Rest') {
      const restName = typeof (param as unknown as { value?: string }).value === 'string'
        ? String((param as unknown as { value: string }).value)
        : 'rest';
      const restValues = positionalArgs.slice(positionalIndex);
      positionalIndex = positionalArgs.length;
      const restValue = restValues.length > 0
        ? createRenderOwnedSequence(restValues, renderKey, context)
        : (
            context.treeContext?.file
              ? createRenderOwnedSequence([], renderKey, context)
              : new Any(restName, { role: 'property' })
          );
      const restVarDecl = new VarDeclarationCtor({
        name: new Any(restName, { role: 'property' }),
        value: restValue
      }, { paramVar: true }, param.location, context.treeContext);
      restVarDecl.index = -(index + 1);
      restVarDecl.renderKey = renderKey;
      restVarDecl.preEvaluated = true;
      restVarDecl.evaluated = true;
      boundParams.push(restVarDecl);
      continue;
    }

    // Non-binding pattern params still consume a positional argument slot
    // when matched, so later bindable params line up with the correct arg.
    if (positionalIndex < positionalArgs.length) {
      positionalIndex++;
    }
  }

  return boundParams;
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
  context: Context
): PreparedMixinCandidateInvocation {
  const renderKey = context.nextRenderKey();
  const bindingSourceParent = context.caller ?? sourceParent;
  const boundParams = buildBoundMixinParams(
    params,
    nodeArgs,
    bindingSourceParent,
    renderKey,
    context
  );
  const outerRules = boundParams
    ? prepareMixinInvocationScope(
        parent,
        parent,
        sourceParent,
        index,
        renderKey,
        boundParams,
        nodeArgs,
        context
      )
    : undefined;
  const lookupParent = outerRules ?? parent;
  const invocationRules = createMixinInvocationRules(
    rules,
    lookupParent,
    parent,
    sourceParent,
    index,
    context,
    renderKey
  );

  return {
    rules: invocationRules,
    params: boundParams,
    outerRules,
    guardScopeChildren: outerRules
      ? [...outerRules.value]
      : undefined
  };
}

/**
 * Run an evaluation step with the mixin invocation scope as the active lookup
 * scope, then restore the caller's prior rulesContext.
 */
export function withMixinLookupScope<T>(
  scope: Rules | undefined,
  lookupScope: Rules | undefined,
  context: Context,
  fn: () => MaybePromise<T>
): MaybePromise<T> {
  const previousRulesContext = context.rulesContext;
  const previousRenderKey = context.renderKey;
  const previousLookupScope = context.lookupScope;
  if (scope) {
    context.rulesContext = scope;
  }
  context.lookupScope = lookupScope;
  context.renderKey = scope?.renderKey ?? previousRenderKey;
  try {
    const out = fn();
    if (isThenable(out)) {
      return (out as Promise<T>).finally(() => {
        context.rulesContext = previousRulesContext;
        context.renderKey = previousRenderKey;
        context.lookupScope = previousLookupScope;
      });
    }
    context.rulesContext = previousRulesContext;
    context.renderKey = previousRenderKey;
    context.lookupScope = previousLookupScope;
    return out;
  } catch (error) {
    context.rulesContext = previousRulesContext;
    context.renderKey = previousRenderKey;
    context.lookupScope = previousLookupScope;
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
        nextScope,
        nextScope,
        context,
        () => guardNode.eval(context)
      );
      return {
        passes: probeResult instanceof Bool && probeResult.value === true,
        outerRules: nextScope
      };
    } finally {
      context.isDefault = prevIsDefault;
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
  let hasDefTrueCandidate = false;
  let hasDefFalseCandidate = false;

  for (const group of groups) {
    if (group === MixinDefaultGroup.True) {
      hasDefTrueCandidate = true;
    } else if (group === MixinDefaultGroup.False) {
      hasDefFalseCandidate = true;
    } else if (group === MixinDefaultGroup.None) {
      hasDefNoneCandidate = true;
    }
  }

  if (!hasDefNoneCandidate && hasDefTrueCandidate && hasDefFalseCandidate) {
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
      pending.outerRules ?? pending.lookupScope ?? findRulesAncestor(pending.rules, context),
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
  _context: Context
): Rules {
  outputRules.sort(comparePosition);

  if (outputRules.length === 1) {
    const output = outputRules[0]!;
    output.options.isMixinOutput ??= restrictMixinOutputLookup;
    return output;
  }

  // Generated node — safe to build canonically before returning.
  for (let i = 0; i < outputRules.length; i++) {
    outputRules[i]!.frozen = true;
    outputRules[i]!.index = i;
  }
  const output = Rules.create(outputRules, {
    rulesVisibility: {
      Ruleset: 'public',
      Declaration: 'public',
      VarDeclaration: 'public',
      Mixin: 'public'
    },
    isMixinOutput: restrictMixinOutputLookup
  });

  return output;
}

/**
 * Evaluate a ruleset candidate whose guard already passed during Ruleset
 * evaluation, preserving mixin-output semantics and eval-state-subtree association.
 */
export async function evaluateRulesetMixinCandidateOutput(
  sourceRules: Rules,
  definitionParent: Node | undefined,
  placementParent: Node | undefined,
  candidateIndex: number,
  restrictMixinOutputLookup: boolean,
  context: Context
): Promise<Rules> {
  const renderKey = context.nextRenderKey();
  let rules = sourceRules.createShallowBodyWrapper(undefined, renderKey);
  const placementContext = {
    ...context,
    renderKey,
    rulesContext: rules
  } as Context;
  setParent(rules, placementParent, placementContext);
  setSourceParent(rules, definitionParent, placementContext);
  const previousRulesContext = context.rulesContext;
  const previousRenderKey = context.renderKey;
  const previousFrames = context.frames;
  const previousRulesetFrames = context.rulesetFrames;
  const seededFrames: Array<Ruleset | AtRule> = [];
  let frameCursor = placementParent;
  while (frameCursor) {
    if (isNode(frameCursor, N.Ruleset | N.AtRule)) {
      seededFrames.push(frameCursor as Ruleset | AtRule);
    }
    frameCursor = getParent(frameCursor, context);
  }
  seededFrames.reverse();
  context.rulesContext = rules;
  context.renderKey = rules.renderKey;
  context.frames = seededFrames;
  context.rulesetFrames = seededFrames.filter((frame): frame is Ruleset => isNode(frame, N.Ruleset));
  try {
    rules = await rules.preEval(context) as Rules;
    rules = await rules.eval(context);
  } finally {
    context.rulesContext = previousRulesContext;
    context.renderKey = previousRenderKey;
    context.frames = previousFrames;
    context.rulesetFrames = previousRulesetFrames;
  }
  setSourceParent(rules, definitionParent, placementContext);
  setParent(rules, placementParent, placementContext);
  finalizeInvocationOutputRules(rules, context);
  rules.index = candidateIndex;
  rules.options.isMixinOutput = restrictMixinOutputLookup;
  return rules;
}

export function finalizeInvocationOutputRules(
  rules: Rules,
  context: Context
): void {
  const scopedContext = {
    ...context,
    renderKey: rules.renderKey,
    rulesContext: rules
  } as Context;

  const children = rules.get('value', scopedContext);
  for (let index = 0; index < children.length; index++) {
    let child = children[index]!;
    if (isNode(child, N.Ruleset | N.AtRule) && getCurrentParentNode(child, scopedContext) !== rules) {
      child = child.clone(false, undefined, scopedContext);
      rules._setChildAt(index, child, scopedContext, false);
      rules.adopt(child, scopedContext);
    }

    if (isNode(child, N.Ruleset)) {
      const childRuleset = child as Ruleset;
      if (
        childRuleset.getOwnSelector()
        && childRuleset.getExtendedSelector(rules.renderKey)
        && !childRuleset.getSelectorBeforeExtend(rules.renderKey)
      ) {
        childRuleset.setExtendedSelector(
          childRuleset.getSelector(rules.renderKey),
          scopedContext
        );
      }
      finalizeInvocationOutputRules(
        childRuleset.enterRules(scopedContext),
        scopedContext
      );
      continue;
    }

    if (isNode(child, N.AtRule)) {
      const childRules = (child as AtRule).enterRules(scopedContext);
      if (childRules) {
        finalizeInvocationOutputRules(childRules, scopedContext);
      }
    }
  }
}

/**
 * Create the unlocked output for a detached ruleset call without flattening
 * the source body eagerly.
 */
export function unlockDetachedRulesetMixinCandidateOutput(
  sourceRules: Rules,
  placementParent: Node | undefined,
  definitionParent: Node | undefined,
  candidateIndex: number,
  context: Context
): Rules {
  const unlocked = sourceRules.cloneDetachedUnlockWrapper(context);
  const placementContext = {
    ...context,
    renderKey: unlocked.renderKey,
    rulesContext: unlocked
  } as Context;
  setParent(unlocked, placementParent, placementContext);
  setSourceParent(unlocked, definitionParent, placementContext);
  finalizeInvocationOutputRules(unlocked, placementContext);
  unlocked.options.isMixinOutput = false;
  unlocked.index = candidateIndex;
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
    guardScopeChildren,
    hasAnyDefault,
    candidateHasDefault,
    context,
    evaluateCandidateOutput
  } = options;

  let nextOuterRules = outerRules;
  const pendingLookupScope = () => nextOuterRules ?? getMixinCandidateLookupScope(parent, rules, context);
  if (guard) {
    const evaluatedGuard = await evaluateMixinGuardCandidate(
      guard,
      nextOuterRules,
      parent,
      context,
      guardScopeChildren,
      candidateHasDefault
    );
    nextOuterRules = evaluatedGuard.outerRules;
    if (!evaluatedGuard.passes) {
      return undefined;
    }
    if (hasAnyDefault) {
      return {
        candidate,
        rules,
        outerRules: nextOuterRules,
        params,
        group: candidateHasDefault ? evaluatedGuard.defaultGroup! : MixinDefaultGroup.None,
        lookupScope: pendingLookupScope()
      };
    }
  }

  if (hasAnyDefault) {
    return {
      candidate,
      rules,
      outerRules: nextOuterRules,
      params,
      group: MixinDefaultGroup.None,
      lookupScope: pendingLookupScope()
    };
  }

  await withMixinLookupScope(
    nextOuterRules ?? rules,
    pendingLookupScope(),
    context,
    () => evaluateCandidateOutput(candidate, rules, nextOuterRules, params)
  );
  return undefined;
}

// -- Scope ancestry helpers --

/**
 * Walk the parent chain (via eval state helpers) to find the nearest Rules ancestor.
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

export function getMixinCandidateLookupScope(
  parent: Node | undefined,
  rules: Rules,
  context: Context
): Rules | undefined {
  if (isNode(parent, N.Rules)) {
    return parent as Rules;
  }
  return findRulesAncestor(parent, context) ?? findRulesAncestor(rules, context);
}

/**
 * Resolve the candidate's parent, throwing if absent.
 *
 * Accepts `Node<any, any>` so callers don't need `as unknown as Node` casts
 * for typed subclasses like Mixin or Ruleset.
 */
export function getCandidateParent(node: Node<any, any>, context: Context): Node {
  const nonCanonicalParentEdgeKeys = node.parentEdges
    ? [...node.parentEdges.keys()].filter(key => key !== CANONICAL)
    : [];
  if (nonCanonicalParentEdgeKeys.length === 1) {
    const keyedParent = node.parentEdges!.get(nonCanonicalParentEdgeKeys[0]!);
    if (keyedParent) {
      return keyedParent;
    }
  }
  const parent = getParent(node as Node, context);
  if (!parent) {
    throw new ReferenceError(`${node.type} candidate must have a parent during mixin evaluation`);
  }
  return parent;
}

// -- Arg evaluation --

/**
 * Evaluate raw call args into a flat array of current Node values.
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
  const callerSourceParent = callerSourceNode
    ? getSourceParent(callerSourceNode, context)
    : undefined;
  const savedRulesContext = context.rulesContext;
  const savedRenderKey = context.renderKey;
  const argEvalRulesContext = savedRulesContext
    ?? findRulesAncestor(caller, context)
    ?? findSourceRulesAncestor(callerSourceNode, context)
    ?? findRulesAncestor(callerSourceParent, context);
  context.rulesContext = argEvalRulesContext;
  context.renderKey = argEvalRulesContext?.renderKey ?? savedRenderKey;
  try {
    for (const arg of args) {
      if (isNode(arg)) {
        if (isNode(arg, N.VarDeclaration)) {
          // Evaluate the value, keep the VarDeclaration structure
          const value = (arg as VarDeclaration).get('value');
          if (value instanceof Node) {
            if (callerSourceParent && (isNode(value, N.Reference) || isNode(value, N.Mixin))) {
              setSourceParent(value, callerSourceParent, context);
            }
            const evaldValue = await value.eval(context);
            const argName = String((arg as VarDeclaration).get('name').valueOf());
            const bound = new VarDeclarationCtor({
              name: new Any(argName, { role: 'property' }),
              value: new Nil()
            }, { ...((arg as VarDeclaration).options ?? {}) }, arg.location, context.treeContext);
            bound.renderKey = context.renderKey ?? bound.renderKey;
            (bound as VarDeclaration).value = evaldValue;
            bound.adopt(evaldValue, context);
            nodeArgs.push(bound);
          } else {
            nodeArgs.push(arg);
          }
          continue;
        }
        if (callerSourceParent && (isNode(arg, N.Reference) || isNode(arg, N.Mixin))) {
          setSourceParent(arg, callerSourceParent, context);
        }
        const evald = await arg.eval(context);
        if (evald.type === 'Rest') {
          let restValue = (evald as unknown as { value: unknown }).value;
          if (isNode(restValue as Node) && !isNode(restValue as Node, N.Sequence | N.List)) {
            restValue = await (restValue as Node).eval(context);
          }
          if (isNode(restValue, N.Sequence) || isNode(restValue, N.List)) {
            for (const restArg of (restValue as unknown as { value: Node[] }).value) {
              nodeArgs.push(restArg);
            }
            continue;
          }
        }
        nodeArgs.push(evald);
      } else {
        nodeArgs.push(cast(arg));
      }
    }
  } finally {
    context.rulesContext = savedRulesContext;
    context.renderKey = savedRenderKey;
  }
  return nodeArgs;
}

// -- Candidate matching --

/**
 * Evaluate a pattern-match operand in a fresh session scope.
 */
async function preparePatternOperand(node: Node, context: Context): Promise<Node> {
  try {
    return await node.eval(context);
  } finally {
  }
}

/**
 * Match the mixin array against evaluated args. Returns the candidates whose
 * param signatures match (with params bound).
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
      const params = (mixin as any).params as List<Node>;
      const hasRestParamOriginal = params.get('value').some(
        (p: Node) => p.type === 'Rest'
      );
      const maxPositionalArgs = hasRestParamOriginal ? Number.POSITIVE_INFINITY : params.length;
      const positions = params.length;
      let requiredPositions = 0;
      for (const param of params.get('value')) {
        if (isNode(param, N.VarDeclaration)) {
          if ((param as VarDeclaration).get('value') instanceof Nil) {
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
          param = params.get('value').find((p: Node) => {
            if (isNode(p, N.VarDeclaration)) {
              return (p as VarDeclaration).get('name').valueOf() === (arg as VarDeclaration).get('name').valueOf();
            }
            if (isNode(p, N.Any) && p.role === 'property') {
              return p.valueOf() === (arg as VarDeclaration).get('name').valueOf();
            }
            return false;
          });
          if (param) {
            argValue = (arg as VarDeclaration).get('value') as Node;
          } else {
            match = false;
            break;
          }
        } else {
          param = params.get('value')[pi];
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

        if (
          isNode(param, N.VarDeclaration)
          || (isNode(param, N.Any) && param.role === 'property')
          || param.type === 'Rest'
        ) {
          if (bindingSourceParent && (isNode(argValue, N.Reference) || isNode(argValue, N.Mixin))) {
            setSourceParent(argValue, bindingSourceParent, context);
          }
        } else {
          const originalPatternParam = !isNode(arg, N.VarDeclaration)
            ? ((mixin as any).params as List<Node> | undefined)?.get('value')[pi]
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
      if (nodeArgs.length > 1 && params.get('value').length === 1 && requiredPositions === 1) {
        continue;
      }
      if (match) {
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
      const blockedByFailedGuard = hasFailedGuardAncestor(candidate, context);
      return !blockedByFailedGuard;
    })
    .map<MixinEntry>((candidate) => {
      const hasDefaultGuard = Boolean(candidate.options?.hasDefault)
        || guardContainsDefault((candidate as Mixin).get('guard') as Node | undefined);
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
  invocationParent: Node | undefined;
  restrictMixinOutputLookup: boolean;
  outputRules: Rules[];
  getCandidateParent: (node: Node<any, any>) => Node;
};

/**
 * Evaluate a single mixin candidate's body and push the result to outputRules.
 *
 * Handles explicit recursion guarding, position creation, body eval, output
 * finalization, param scope projection, and eval state subtree association.
 */
export async function evaluateCandidateOutput(
  candidate: MixinEntry,
  rules: Rules,
  outerRules: Rules | undefined,
  params: List<Node> | undefined,
  context: Context,
  opts: EvaluateCandidateOutputOptions
): Promise<void> {
  const {
    sourceParent,
    invocationParent,
    restrictMixinOutputLookup,
    outputRules,
    getCandidateParent: getParentFn
  } = opts;
  const currentCall = context.callStack.at(-1);
  if (currentCall && context.callMap.add(currentCall, params, context)) {
    return;
  }
  try {
    const callerParent = getParentFn(candidate);
    const lexicalSourceParent = callerParent;
    rules.parent ??= outerRules ?? callerParent;
    rules.sourceParent = sourceParent ?? lexicalSourceParent;
    const previousRenderKey = context.renderKey;
    context.renderKey = rules.renderKey;
    let newRules: Rules;
    try {
      newRules = await rules.eval(context);
    } finally {
      context.renderKey = previousRenderKey;
    }
    void outerRules;
    if (newRules.renderKey === CANONICAL) {
      newRules.renderKey = rules.renderKey;
    }
    newRules.parent = invocationParent ?? callerParent;
    newRules.sourceParent = sourceParent ?? lexicalSourceParent;
    newRules.index = candidate.index;

    if (outerRules) {
      const previousRenderKey = context.renderKey;
      const previousRulesContext = context.rulesContext;
      context.renderKey = newRules.renderKey;
      context.rulesContext = newRules;
      let outputChildren: readonly Node[];
      try {
        outputChildren = [...newRules.getRegistryChildren(context)];
      } finally {
        context.renderKey = previousRenderKey;
        context.rulesContext = previousRulesContext;
      }
      const outputContainer = newRules.createPlacementWrapperWithChildren(
        outputChildren,
        newRules.renderKey
      );
      const outputContext = {
        ...context,
        renderKey: newRules.renderKey,
        rulesContext: outputContainer
      } as Context;
      for (const child of outputChildren) {
        if (isNode(child, N.Ruleset | N.AtRule)) {
          setSourceParent(child, outerRules, outputContext);
        }
      }
      outputContainer.parent = invocationParent ?? callerParent;
      outputContainer.sourceParent = sourceParent ?? lexicalSourceParent;
      outputContainer.index = candidate.index;
      outputContainer.options.isMixinOutput = false;
      outputRules.push(outputContainer);
      return;
    }

    newRules.options.isMixinOutput = restrictMixinOutputLookup;
    if (context.treeContext?.file) {
      newRules.options.rulesVisibility ??= {};
      newRules.options.rulesVisibility.VarDeclaration = 'private';
    }
    outputRules.push(newRules);
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
  invocationParent: Node | undefined;
  caller: Node | undefined;
  restrictMixinOutputLookup: boolean;
  outputRules: Rules[];
  getCandidateParent: (node: Node<any, any>) => Node;
  evaluateCandidateOutput: (
    candidate: MixinEntry,
    rules: Rules,
    outerRules: Rules | undefined,
    params: List<Node> | undefined,
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
    invocationParent,
    restrictMixinOutputLookup,
    outputRules,
    getCandidateParent,
    evaluateCandidateOutput
  } = dispatch;
  const pendingDefaultCandidates: PendingMixinDefaultCandidate<any>[] = [];
  let skippedByRecursion = false;
  for (const candidate of evalCandidates) {
    if (isNode(candidate, N.Ruleset)) {
      if ((candidate as Ruleset).get('guard') instanceof Nil) {
        continue;
      }
      const currentRules = (candidate as Ruleset).enterRules(context);
      const sourceRules = getRootSourceRules(currentRules);
      if (context.rulesEvalStack.includes(sourceRules)) {
        skippedByRecursion = true;
        continue;
      }
      const definitionParent = getCandidateParent(candidate);
      const placementParent = invocationParent ?? definitionParent;
      const rules = await evaluateRulesetMixinCandidateOutput(
        sourceRules,
        definitionParent,
        placementParent,
        candidate.index,
        restrictMixinOutputLookup,
        context
      );
      outputRules.push(rules);
      continue;
    }

    // After the Ruleset branch above, candidate must be a Mixin
    if (!isNode(candidate, N.Mixin)) {
      continue;
    }
    if (!candidate.get('name') && !candidate.get('params') && !candidate.get('guard')) {
      const sourceRules = getRootSourceRules(candidate.get('rules'));
      const definitionParent = getCandidateParent(candidate);
      const unlocked = unlockDetachedRulesetMixinCandidateOutput(
        sourceRules,
        invocationParent ?? definitionParent,
        definitionParent,
        candidate.index,
        context
      );
      outputRules.push(unlocked);
      continue;
    }

    const candidateRenderKey = candidate.renderKey ?? context.renderKey;
    let rules = candidate
      .get('rules', candidateRenderKey ?? context)
      .withRenderOwner(candidate, candidateRenderKey, context);
    let params = candidate.params;
    const prepared = prepareMixinCandidateInvocation(
      rules,
      params,
      getCandidateParent(candidate),
      sourceParent,
      candidate.index,
      nodeArgs,
      context
    );
    rules = prepared.rules;
    params = prepared.params;
    const canonicalGuard = candidate.get('guard');
    const candidateHasDefault = Boolean(candidate.options?.hasDefault)
      || guardContainsDefault(canonicalGuard as Node | undefined);
    const pendingDefaultCandidate = await processPreparedMixinCandidate({
      candidate,
      rules,
      params,
      outerRules: prepared.outerRules,
      guard: canonicalGuard,
      parent: getCandidateParent(candidate),
      guardScopeChildren: prepared.guardScopeChildren,
      hasAnyDefault: hasDefault,
      candidateHasDefault,
      context,
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
      pending.params
    )
  );

  if (
    skippedByRecursion
    && outputRules.length === 0
    && pendingDefaultCandidates.length === 0
  ) {
    throw new ReferenceError('No matching mixins found.');
  }

  const output = assembleMixinInvocationOutput(
    outputRules,
    restrictMixinOutputLookup,
    context
  );

  return output;
}
