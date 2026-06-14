import type { Context } from '../../context.js';
import { F_STATIC, Node } from '../node.js';
import { N } from '../node-type.js';
import type { VarDeclaration } from '../declaration-var.js';
import type { Rules, RulesOptions, RuntimeVarBinding } from '../rules.js';
import {
  getBindingCellValue,
  type BindingEntry,
  type ScopeFrame
} from '../scope-frame.js';
import { comparePosition } from './compare.js';
import { isNode } from './is-node.js';
import {
  canEnterMixinOutputForLookup,
  getRulesEntryVisibility
} from './mixin-output-slot.js';
import { isNonClassicImportBoundary } from './registry-utils.js';

export type FindVarDeclarationFastOptions = {
  /** Source-order boundary for contextual Less-style reads. */
  start?: number;
  /** Active evaluation context, used for search-scope exclusion and caller rules state. */
  context: Context;
  /** Whether the reference has an explicit target, which restricts mixin-output traversal. */
  hasTarget?: boolean;
  /** Whether lookup is already inside a local child surface. */
  local?: boolean;
};

type FindVarScopeSurfaceResult = {
  publicMatch: Node | undefined;
  optionalMatch: Node | undefined;
};

/**
 * Selects the newest declaration bucket entry that is visible before the
 * optional source-order boundary and accepted by the caller's node filter.
 */
function selectVarBucketCandidate(
  bucket: BindingEntry[] | undefined,
  start: number | undefined,
  filter: (n: Node) => boolean
): Node | undefined {
  if (!bucket?.length) {
    return undefined;
  }
  for (let i = bucket.length - 1; i >= 0; i--) {
    const candidate = bucket[i]!;
    if (start !== undefined && !(candidate.sourceNode.index !== undefined && candidate.sourceNode.index < start)) {
      continue;
    }
    if (filter(candidate.sourceNode)) {
      return candidate.sourceNode;
    }
  }
  return undefined;
}

/**
 * Chooses the later source candidate while tolerating partially owned runtime
 * surfaces that may not have enough parent/index metadata for `comparePosition`.
 */
function laterVarMatch<T extends Node>(a: T | undefined, b: T | undefined): T | undefined {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  if (!a.parent && b.parent) {
    return b;
  }
  if (a.parent && !b.parent) {
    return a;
  }
  if (
    a.parent === b.parent
    && a.index !== undefined
    && b.index !== undefined
  ) {
    return a.index <= b.index ? b : a;
  }
  let position: ReturnType<typeof comparePosition>;
  try {
    position = comparePosition(a, b);
  } catch {
    return a.parent || !b.parent ? a : b;
  }
  return position !== undefined && position <= 0 ? b : a;
}

/**
 * Moves pending dynamic variable declarations into a frame's static name bucket
 * once their names have resolved to static values.
 *
 * The promotion keeps lookup on the binding-frame path for declarations that
 * were dynamic during initial indexing but became statically addressable before
 * the current reference lookup.
 */
export function promoteResolvedPendingVarDecls(
  scope: Rules,
  frame: ScopeFrame
): void {
  if (frame.pendingDeclarationNames.length === 0) {
    return;
  }
  const remaining: VarDeclaration[] = [];
  let mutated = false;

  for (const decl of frame.pendingDeclarationNames) {
    if (decl.parent !== scope) {
      remaining.push(decl);
      continue;
    }

    const declName = decl.value.name;
    const isStaticName = !(declName instanceof Node) || declName.hasFlag(F_STATIC);
    if (!isStaticName) {
      remaining.push(decl);
      continue;
    }

    const resolvedName = `${declName.valueOf()}`;
    const sourceIdentity = decl.sourceNode ?? decl;
    let bucket = frame.declarationBucketsByName.get(resolvedName);
    if (!bucket) {
      frame.declarationBucketsByName.set(resolvedName, bucket = []);
    }
    let hasEntry = false;
    for (let i = 0; i < bucket.length; i++) {
      const entry = bucket[i]!;
      const entryIdentity = entry.sourceNode.sourceNode ?? entry.sourceNode;
      if (entry.sourceNode === decl
        || entry.sourceNode === sourceIdentity
        || entryIdentity === sourceIdentity) {
        hasEntry = true;
        break;
      }
    }
    if (!hasEntry) {
      bucket.push({
        cell: {
          value: decl.value.value,
          sourceNode: decl,
          readonly: decl.options?.readonly
        },
        sourceNode: decl
      });
    }
    mutated = true;
  }

  if (mutated) {
    frame.pendingDeclarationNames = remaining;
  }
}

/**
 * Searches one Rules surface and its visible child surfaces for a variable
 * declaration, preserving Less public/optional visibility and Jess local
 * surface boundaries.
 */
function findVarWithinScopeSurface(
  scope: Rules,
  name: string,
  filter: (n: Node) => boolean,
  options: FindVarDeclarationFastOptions,
  scopeStart: number | undefined,
  localContext: boolean | undefined,
  visited: Set<Rules>,
  visibilityOverride?: NonNullable<RulesOptions['rulesVisibility']>['VarDeclaration'],
  includeChildSurfaces = true
): FindVarScopeSurfaceResult {
  if (visited.has(scope)) {
    return {
      publicMatch: undefined,
      optionalMatch: undefined
    };
  }
  visited.add(scope);

  if (scope.rulesIndexed < scope.value.length) {
    scope._indexRules();
  }
  const frame = scope.getScopeFrame();
  promoteResolvedPendingVarDecls(scope, frame);
  let publicMatch: Node | undefined;
  let optionalMatch: Node | undefined;
  const currentCandidate = selectVarBucketCandidate(frame.declarationBucketsByName.get(name), undefined, filter);
  if (currentCandidate) {
    const scopeVisibility = visibilityOverride ?? scope.options.rulesVisibility?.VarDeclaration;
    const isRulesetBodyScope = isNode(scope.parent, N.Ruleset) || isNode(scope.sourceNode, N.Ruleset);
    const isOptionalCurrentScope = visibilityOverride === undefined
      ? scopeVisibility === 'optional' && !isRulesetBodyScope
      : scopeVisibility === 'optional';
    if (isOptionalCurrentScope) {
      optionalMatch = currentCandidate;
    } else {
      publicMatch = currentCandidate;
    }
  }
  const lexicalParentRules = frame.parent?.rulesNode;
  const astRulesParent = scope.rulesParent;
  if (
    isNode(lexicalParentRules, N.Rules)
    && lexicalParentRules !== scope
    && lexicalParentRules !== astRulesParent
  ) {
    const lexicalResult = findVarWithinScopeSurface(
      lexicalParentRules as Rules,
      name,
      filter,
      options,
      undefined,
      localContext,
      visited
    );
    publicMatch = laterVarMatch(publicMatch, lexicalResult.publicMatch);
    optionalMatch = laterVarMatch(optionalMatch, lexicalResult.optionalMatch);
  }

  if (!includeChildSurfaces) {
    return { publicMatch, optionalMatch };
  }

  const childEntries = scope._rulesSet as Array<{
    node: Rules;
    rulesVisibility?: RulesOptions['rulesVisibility'];
  }> | undefined;
  if (!childEntries?.length) {
    return { publicMatch, optionalMatch };
  }

  for (let i = childEntries.length - 1; i >= 0; i--) {
    const entry = childEntries[i]!;
    const visibility = getRulesEntryVisibility(entry, 'VarDeclaration');
    if (visibility !== 'public' && visibility !== 'optional') {
      continue;
    }
    if (!canEnterMixinOutputForLookup(entry, { type: 'VarDeclaration', hasTarget: options.hasTarget })) {
      continue;
    }
    if (options.context.rulesContext === scope && entry.node.options?.forward) {
      continue;
    }
    if (localContext && entry.node.options?.local) {
      continue;
    }
    if (
      scopeStart !== undefined
      && !(entry.node.index !== undefined && entry.node.index < scopeStart)
    ) {
      continue;
    }

    const childResult = findVarWithinScopeSurface(
      entry.node,
      name,
      filter,
      options,
      scopeStart,
      localContext || Boolean(entry.node.options?.local),
      visited,
      visibility
    );
    publicMatch = laterVarMatch(publicMatch, childResult.publicMatch);
    optionalMatch = laterVarMatch(optionalMatch, childResult.optionalMatch);
  }

  return { publicMatch, optionalMatch };
}

/**
 * Finds a static variable declaration by walking the Rules parent/fallback
 * chain and using already-indexed declaration buckets instead of the generic
 * declaration registry.
 *
 * This is the hot lookup path for ordinary Reference variable reads. It returns
 * `undefined` for a real miss or for cases that must stay on the broader
 * registry path because this helper does not model them yet.
 */
export function findVarDeclarationFast(
  startRules: Rules,
  name: string,
  filter: (n: Node) => boolean,
  options: FindVarDeclarationFastOptions
): Node | undefined {
  let cursor: Node | undefined = startRules;
  let first = true;
  let publicMatch: Node | undefined;
  let optionalMatch: Node | undefined;
  const visited = new Set<Rules>();
  while (cursor) {
    if (isNode(cursor, N.Rules)) {
      const scope = cursor as Rules;
      const scopeStart = first ? options.start : undefined;
      const applyCurrentScopeStart = first;
      if (!first) {
        if (isNonClassicImportBoundary(scope)) {
          visited.clear();
          const boundaryResult = findVarWithinScopeSurface(
            scope,
            name,
            filter,
            options,
            undefined,
            options.local,
            visited,
            undefined,
            false
          );
          publicMatch = laterVarMatch(publicMatch, boundaryResult.publicMatch);
          optionalMatch = laterVarMatch(optionalMatch, boundaryResult.optionalMatch);
          break;
        }
      }
      first = false;
      visited.clear();
      const result = findVarWithinScopeSurface(
        scope,
        name,
        filter,
        options,
        applyCurrentScopeStart ? scopeStart : undefined,
        options.local,
        visited
      );
      publicMatch = laterVarMatch(publicMatch, result.publicMatch);
      optionalMatch = laterVarMatch(optionalMatch, result.optionalMatch);
    }
    cursor = cursor.parent;
  }
  const fallbackFrame = startRules.scopeFrame?.fallbackFrame;
  const fallbackRules = fallbackFrame?.rulesNode;
  if (publicMatch === undefined && optionalMatch === undefined && isNode(fallbackRules, N.Rules)) {
    cursor = fallbackRules as Rules;
    while (cursor) {
      if (isNode(cursor, N.Rules)) {
        const scope = cursor as Rules;
        if (isNonClassicImportBoundary(scope)) {
          visited.clear();
          const boundaryResult = findVarWithinScopeSurface(
            scope,
            name,
            filter,
            options,
            undefined,
            options.local,
            visited,
            undefined,
            false
          );
          publicMatch = laterVarMatch(publicMatch, boundaryResult.publicMatch);
          optionalMatch = laterVarMatch(optionalMatch, boundaryResult.optionalMatch);
          break;
        }
        visited.clear();
        const result = findVarWithinScopeSurface(
          scope,
          name,
          filter,
          options,
          undefined,
          options.local,
          visited
        );
        publicMatch = laterVarMatch(publicMatch, result.publicMatch);
        optionalMatch = laterVarMatch(optionalMatch, result.optionalMatch);
      }
      const fallbackCandidate: unknown = isNode(cursor, N.Rules)
        ? cursor.scopeFrame?.fallbackFrame?.rulesNode
        : undefined;
      const nextFallbackRules: Rules | undefined = isNode(fallbackCandidate, N.Rules)
        ? fallbackCandidate as Rules
        : undefined;
      cursor = nextFallbackRules ?? cursor.parent;
    }
  }
  if (publicMatch !== undefined) {
    return publicMatch;
  }
  if (optionalMatch !== undefined) {
    return optionalMatch;
  }
  return undefined;
}

/**
 * Walks one ScopeFrame parent chain for a live runtime variable binding,
 * skipping bindings whose source node is already in the active reference search
 * scope.
 */
function searchRuntimeVarBindingChain(
  start: ScopeFrame | undefined,
  key: string,
  context: Context
): RuntimeVarBinding | undefined {
  let f = start;
  while (f) {
    const live = f.liveSlotsByName.get(key);
    if (live) {
      const src = live.sourceNode as Node | undefined;
      const value = getBindingCellValue(live);
      if (!src || !context._searchScope?.has(src)) {
        return {
          kind: 'runtime-var-binding',
          value,
          readonly: live.readonly,
          sourceNode: src,
          rulesContext: isNode(live.rulesContext, N.Rules) ? live.rulesContext : undefined
        } satisfies RuntimeVarBinding;
      }
    }
    f = f.parent;
  }
  return undefined;
}

/**
 * Resolves a live runtime variable binding from the target rules frame, then
 * from any fallback frame chain owned by that target.
 */
export function lookupRuntimeVarBinding(
  targetRules: Rules,
  key: string,
  context: Context
): RuntimeVarBinding | undefined {
  const frame = targetRules.getScopeFrame();
  const direct = searchRuntimeVarBindingChain(frame, key, context);
  if (direct) {
    return direct;
  }

  let fallback = frame.fallbackFrame;
  while (fallback) {
    const resolved = searchRuntimeVarBindingChain(fallback, key, context);
    if (resolved) {
      return resolved;
    }
    fallback = fallback.fallbackFrame;
  }
  return undefined;
}
