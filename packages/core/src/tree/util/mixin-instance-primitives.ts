import type { Context } from '../../context.js';
import type { Node } from '../node-base.js';
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
import { getChildren, patchField, setChildren, setParent } from './session-helpers.js';

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
