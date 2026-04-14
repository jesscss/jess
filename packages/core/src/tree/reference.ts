import { defineType, Node, F_MAY_ASYNC, F_VISIBLE, F_NON_STATIC, F_STATIC, type LocationInfo } from './node.js';
import type { Context, TreeContext } from '../context.js';
import { cast } from './util/cast.js';
import type { FindOptions } from './util/registry-utils.js';
import { Any, type AnyRole } from './any.js';
import { Selector } from './selector.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import type { Call } from './call.js';
import type { Quoted } from './quoted.js';
import { atIndex } from './util/collections.js';
import type { Num } from './number.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { isThenable, type MaybePromise, pipe } from '@jesscss/awaitable-pipe';
import { MixinCollection } from './rules.js';
import type { MixinEntry, Rules, RulesOptions, RuntimeVarBinding } from './rules.js';
import type { Mixin } from './mixin.js';
import type { Interpolated } from './interpolated.js';
import { freezeChildren } from './util/cloning.js';
import type { Ruleset } from './ruleset.js';
import type { Declaration } from './declaration.js';
import type { Color } from './color.js';
import { List } from './list.js';
import { Nil } from './nil.js';
import { comparePosition } from './util/compare.js';
import type { BindingEntry, ScopeFrame } from './scope-frame.js';
import type { VarDeclaration } from './declaration-var.js';
/**
 * The type is determined by syntax
 * and location.
 *   e.g. in Jess
 *    - `$foo` refers to a variable
 *    - `$.foo` is a prop or var
 *    - `$foo$(bar)` is a var var
 *    - `$foo.bar` is a prop or var `bar` in `foo`
 *    - in `$|.foo()`, `.foo` is a mixin
 *    - in `$foo|.mixin()`, `.mixin` is a mixin in `$foo`
 *    - Resolution:
 *      - `$` searches scope,
 *      - `$^` searches in declaration order
 *   in Less
 *   - `@foo` refers to a variable
 *   - `$foo` refers to a property
 *   - `.foo` or `#foo` refers to a mixin
 */
export type ReferenceValue = {
  target?: Reference | Call | undefined;
  rawKey?:
    string
    | string[]
    | Node
    | Any
    | number
    | Num
    | Quoted
    | Selector
    | Reference
    | Interpolated;
  key:
    string
    | string[]
    | Node
    | Any
    | number // $[0] or $.0
    | Num // $.key or $[key] or $*key
    | Quoted // $['key']
    | Selector // $*(.selector)
    | Reference // $.key
    | Interpolated; // @{variable} interpolation
};

export type ReferenceOptions = {
  /**
   * What kind of lookup are we doing?
   */
  type?: 'index' | 'declaration' | 'property' | 'variable' | 'function' | 'mixin' | 'ruleset' | 'mixin-ruleset';
  /**
   * Resolution strategy:
   * - 'contextual': Contextual lookup (default)
   * - 'live': Resolve using call-site/live lookup semantics
   */
  resolution?: 'contextual' | 'live';
  /**
   * Optional references just resolve to the string
   * representation if the fallback value is set to true.
   *
   * @note - Used by Less for function references
   */
  fallbackValue?: Node | true;
  filter?: (node: Node) => boolean;
  role?: AnyRole;
};

const isRuntimeVarBinding = (value: unknown): value is RuntimeVarBinding => (
  value !== null
  && typeof value === 'object'
  && 'kind' in value
  && value.kind === 'runtime-var-binding'
);

/**
 * Fast parent-chain walk for ordinary VarDeclaration lookup.
 *
 * Bypasses the full declaration-registry machinery (Set creation, indexPendingItems,
 * Set→Array conversion, sort, _searchRulesChildren) for the dominant hot case:
 * lexical variables looked up from nested scopes.
 *
 * Invariant: `varsByName === undefined` means the scope has not yet been indexed
 * by `_indexRules`. `varsByName` is initialized to an empty Map at the start of
 * `_indexRules` so that "indexed with no vars" is distinguishable from "not indexed".
 *
 * When `varsByName` is undefined the fast path bails immediately (returns undefined),
 * causing the caller to fall back to the full declaration registry which will trigger
 * indexing and warm up `varsByName` for all visited scopes. Subsequent lookups then
 * use the fast path for the entire chain.
 *
 * Last entry in varsByName wins (Less "last definition wins" / contextual semantics).
 */
function findVarDeclarationFast(
  startRules: Rules,
  name: string,
  filter: (n: Node) => boolean,
  options: {
    start?: number;
    context: Context;
    hasTarget?: boolean;
    local?: boolean;
  }
): {
  match: Node | undefined;
  matchKind: 'public' | 'optional' | undefined;
  needsAsyncProbe: boolean;
} {
  const selectBucketCandidate = (
    bucket: BindingEntry[] | undefined,
    start: number | undefined
  ): Node | undefined => {
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
  };

  const laterOf = <T extends Node>(a: T | undefined, b: T | undefined): T | undefined => {
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
    let position: ReturnType<typeof comparePosition>;
    try {
      position = comparePosition(a, b);
    } catch {
      return a.parent || !b.parent ? a : b;
    }
    return position !== undefined && position <= 0 ? b : a;
  };

  const unresolvedDynamicCouldBeat = (
    scope: Rules,
    pendingDynamicDecls: readonly VarDeclaration[],
    currentBest: Node | undefined
  ): VarDeclaration[] => {
    const candidates: VarDeclaration[] = [];
    for (const decl of pendingDynamicDecls) {
      if (decl.parent !== scope) {
        continue;
      }
      if (!filter(decl)) {
        continue;
      }
      if (!currentBest) {
        candidates.push(decl);
        continue;
      }
      if (!currentBest.parent) {
        candidates.push(decl);
        continue;
      }
      const position = comparePosition(currentBest, decl);
      if (position === undefined || position <= 0) {
        candidates.push(decl);
      }
    }
    return candidates;
  };

  const promoteResolvedPendingDecls = (
    scope: Rules,
    frame: ScopeFrame
  ): void => {
    if (frame.pendingDynamicDecls.length === 0) {
      return;
    }
    const remaining: VarDeclaration[] = [];
    let mutated = false;

    for (const decl of frame.pendingDynamicDecls) {
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
      if (!bucket.some((entry) => {
        const entryIdentity = entry.sourceNode.sourceNode ?? entry.sourceNode;
        return entry.sourceNode === decl
          || entry.sourceNode === sourceIdentity
          || entryIdentity === sourceIdentity;
      })) {
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
      frame.pendingDynamicDecls = remaining;
    }
  };

  const findVarWithinScopeSurface = (
    scope: Rules,
    scopeStart: number | undefined,
    localContext: boolean | undefined,
    visited: Set<Rules>,
    visibilityOverride?: RulesOptions['rulesVisibility']['VarDeclaration']
  ): {
    publicMatch: Node | undefined;
    optionalMatch: Node | undefined;
    needsAsyncProbe: boolean;
  } => {
    if (visited.has(scope)) {
      return {
        publicMatch: undefined,
        optionalMatch: undefined,
        needsAsyncProbe: false
      };
    }
    visited.add(scope);

    const frame = scope.getScopeFrame();
    promoteResolvedPendingDecls(scope, frame);
    let publicMatch: Node | undefined;
    let optionalMatch: Node | undefined;
    let needsAsyncProbe = false;

    const currentCandidate = selectBucketCandidate(frame.declarationBucketsByName.get(name), undefined);
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

    const pendingCandidates = unresolvedDynamicCouldBeat(scope, frame.pendingDynamicDecls, publicMatch ?? optionalMatch);
    if (pendingCandidates.length > 0) {
      for (let i = pendingCandidates.length - 1; i >= 0; i--) {
        const decl = pendingCandidates[i]!;
        let resolvedName: unknown;
        options.context.searchScope.add(decl);
        try {
          resolvedName = decl.value.name.eval(options.context);
        } catch {
          options.context.searchScope.delete(decl);
          continue;
        }
        if (isThenable(resolvedName)) {
          options.context.searchScope.delete(decl);
          needsAsyncProbe = true;
          continue;
        }
        options.context.searchScope.delete(decl);
        const resolvedKey = isNode(resolvedName) ? `${resolvedName.valueOf()}` : `${resolvedName}`;
        if (resolvedKey !== name) {
          continue;
        }
        const scopeVisibility = visibilityOverride ?? scope.options.rulesVisibility?.VarDeclaration;
        const isRulesetBodyScope = isNode(scope.parent, N.Ruleset) || isNode(scope.sourceNode, N.Ruleset);
        const isOptionalCurrentScope = visibilityOverride === undefined
          ? scopeVisibility === 'optional' && !isRulesetBodyScope
          : scopeVisibility === 'optional';
        if (isOptionalCurrentScope) {
          optionalMatch = laterOf(optionalMatch, decl);
        } else {
          publicMatch = laterOf(publicMatch, decl);
        }
        break;
      }
    }

    const childEntries = scope._rulesSet as Array<{
      node: Rules;
      rulesVisibility?: RulesOptions['rulesVisibility'];
    }> | undefined;
    if (!childEntries?.length) {
      return { publicMatch, optionalMatch, needsAsyncProbe };
    }

    for (let i = childEntries.length - 1; i >= 0; i--) {
      const entry = childEntries[i]!;
      const visibility = entry.rulesVisibility?.VarDeclaration
        ?? entry.node.options.rulesVisibility?.VarDeclaration;
      if (visibility !== 'public' && visibility !== 'optional') {
        continue;
      }
      if (entry.node.options?.isMixinOutput === true && options.hasTarget !== true) {
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
        scopeStart,
        localContext || Boolean(entry.node.options?.local),
        visited,
        visibility
      );
      needsAsyncProbe ||= childResult.needsAsyncProbe;
      publicMatch = laterOf(publicMatch, childResult.publicMatch);
      optionalMatch = laterOf(optionalMatch, childResult.optionalMatch);
    }

    return { publicMatch, optionalMatch, needsAsyncProbe };
  };

  let cursor: Node | undefined = startRules;
  let first = true;
  let needsAsyncProbe = false;
  let publicMatch: Node | undefined;
  let optionalMatch: Node | undefined;
  while (cursor) {
    if (isNode(cursor, N.Rules)) {
      const scope = cursor as Rules;
      const scopeStart = first ? options.start : undefined;
      const applyCurrentScopeStart = first;
      if (!first) {
        // Stop at non-classic-import boundaries (same as DeclarationRegistry.find)
        const sn = scope.sourceNode;
        if (sn?.type === 'StyleImport' && sn.options.type !== 'import') {
          break;
        }
      }
      first = false;
      const result = findVarWithinScopeSurface(
        scope,
        applyCurrentScopeStart ? scopeStart : undefined,
        options.local,
        new Set<Rules>()
      );
      needsAsyncProbe ||= result.needsAsyncProbe;
      publicMatch = laterOf(publicMatch, result.publicMatch);
      optionalMatch = laterOf(optionalMatch, result.optionalMatch);
      // No match at this scope; continue up the chain
    }
    cursor = cursor.parent ?? cursor.sourceParent;
  }
  if (publicMatch !== undefined) {
    return {
      match: publicMatch,
      matchKind: 'public',
      needsAsyncProbe
    };
  }
  if (optionalMatch !== undefined) {
    return {
      match: optionalMatch,
      matchKind: 'optional',
      needsAsyncProbe
    };
  }
  return { match: undefined, matchKind: undefined, needsAsyncProbe };
}

async function resolvePendingDynamicVarMatchAsync(
  startRules: Rules,
  name: string,
  filter: (n: Node) => boolean,
  options: {
    start?: number;
    context: Context;
    hasTarget?: boolean;
    local?: boolean;
  },
  baselineMatch: Node | undefined,
  baselineKind: 'public' | 'optional' | undefined
): Promise<Node | undefined> {
  const laterOf = <T extends Node>(a: T | undefined, b: T | undefined): T | undefined => {
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
    let position: ReturnType<typeof comparePosition>;
    try {
      position = comparePosition(a, b);
    } catch {
      return a.parent || !b.parent ? a : b;
    }
    return position !== undefined && position <= 0 ? b : a;
  };

  const unresolvedDynamicCouldBeat = (
    scope: Rules,
    pendingDynamicDecls: readonly VarDeclaration[],
    currentBest: Node | undefined
  ): VarDeclaration[] => {
    const candidates: VarDeclaration[] = [];
    for (const decl of pendingDynamicDecls) {
      if (decl.parent !== scope) {
        continue;
      }
      if (!filter(decl)) {
        continue;
      }
      if (!currentBest || !currentBest.parent) {
        candidates.push(decl);
        continue;
      }
      const position = comparePosition(currentBest, decl);
      if (position === undefined || position <= 0) {
        candidates.push(decl);
      }
    }
    return candidates;
  };

  const classifyVisibility = (
    scope: Rules,
    visibilityOverride?: RulesOptions['rulesVisibility']['VarDeclaration']
  ): 'public' | 'optional' => {
    const scopeVisibility = visibilityOverride ?? scope.options.rulesVisibility?.VarDeclaration;
    const isRulesetBodyScope = isNode(scope.parent, N.Ruleset) || isNode(scope.sourceNode, N.Ruleset);
    const isOptionalCurrentScope = visibilityOverride === undefined
      ? scopeVisibility === 'optional' && !isRulesetBodyScope
      : scopeVisibility === 'optional';
    return isOptionalCurrentScope ? 'optional' : 'public';
  };

  const probeScopeSurface = async (
    scope: Rules,
    scopeStart: number | undefined,
    localContext: boolean | undefined,
    visited: Set<Rules>,
    currentPublicMatch: Node | undefined,
    currentOptionalMatch: Node | undefined,
    visibilityOverride?: RulesOptions['rulesVisibility']['VarDeclaration']
  ): Promise<{
    publicMatch: Node | undefined;
    optionalMatch: Node | undefined;
  }> => {
    if (visited.has(scope)) {
      return {
        publicMatch: currentPublicMatch,
        optionalMatch: currentOptionalMatch
      };
    }
    visited.add(scope);

    const frame = scope.getScopeFrame();
    const pendingCandidates = unresolvedDynamicCouldBeat(scope, frame.pendingDynamicDecls, currentPublicMatch ?? currentOptionalMatch);
    for (let i = pendingCandidates.length - 1; i >= 0; i--) {
      const decl = pendingCandidates[i]!;
      let resolvedName: unknown;
      options.context.searchScope.add(decl);
      try {
        resolvedName = decl.value.name.eval(options.context);
      } catch {
        options.context.searchScope.delete(decl);
        continue;
      }
      if (isThenable(resolvedName)) {
        try {
          resolvedName = await resolvedName;
        } catch {
          options.context.searchScope.delete(decl);
          continue;
        }
      }
      options.context.searchScope.delete(decl);
      const resolvedKey = isNode(resolvedName) ? `${resolvedName.valueOf()}` : `${resolvedName}`;
      if (resolvedKey !== name) {
        continue;
      }
      if (classifyVisibility(scope, visibilityOverride) === 'optional') {
        currentOptionalMatch = laterOf(currentOptionalMatch, decl);
      } else {
        currentPublicMatch = laterOf(currentPublicMatch, decl);
      }
    }

    const childEntries = scope._rulesSet as Array<{
      node: Rules;
      rulesVisibility?: RulesOptions['rulesVisibility'];
    }> | undefined;
    if (!childEntries?.length) {
      return {
        publicMatch: currentPublicMatch,
        optionalMatch: currentOptionalMatch
      };
    }

    for (let i = childEntries.length - 1; i >= 0; i--) {
      const entry = childEntries[i]!;
      const visibility = entry.rulesVisibility?.VarDeclaration
        ?? entry.node.options.rulesVisibility?.VarDeclaration;
      if (visibility !== 'public' && visibility !== 'optional') {
        continue;
      }
      if (entry.node.options?.isMixinOutput === true && options.hasTarget !== true) {
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
      const childResult = await probeScopeSurface(
        entry.node,
        scopeStart,
        localContext || Boolean(entry.node.options?.local),
        visited,
        currentPublicMatch,
        currentOptionalMatch,
        visibility
      );
      currentPublicMatch = childResult.publicMatch;
      currentOptionalMatch = childResult.optionalMatch;
    }

    return {
      publicMatch: currentPublicMatch,
      optionalMatch: currentOptionalMatch
    };
  };

  let cursor: Node | undefined = startRules;
  let first = true;
  let publicMatch = baselineKind === 'public' ? baselineMatch : undefined;
  let optionalMatch = baselineKind === 'optional' ? baselineMatch : undefined;

  while (cursor) {
    if (isNode(cursor, N.Rules)) {
      const scope = cursor as Rules;
      const scopeStart = first ? options.start : undefined;
      if (!first) {
        const sn = scope.sourceNode;
        if (sn?.type === 'StyleImport' && sn.options.type !== 'import') {
          break;
        }
      }
      first = false;
      const result = await probeScopeSurface(
        scope,
        scopeStart,
        options.local,
        new Set<Rules>(),
        publicMatch,
        optionalMatch
      );
      publicMatch = result.publicMatch;
      optionalMatch = result.optionalMatch;
    }
    cursor = cursor.parent ?? cursor.sourceParent;
  }

  return publicMatch ?? optionalMatch;
}
/**
 * Fast parent-chain walk for static-named Mixin lookup.
 *
 * Mirrors findVarDeclarationFast: only covers Mixin nodes whose name was
 * indexed into mixinsByName (non-interpolated Any name). Ruleset-as-mixin
 * and interpolated-name mixins still go through the full MixinRegistry.
 *
 * Returns an array of Mixin candidates (all matching entries across scopes)
 * or undefined if any scope in the chain is not yet indexed (triggering
 * full-registry fallback which warms it up).
 */
function findMixinFast(
  startRules: Rules,
  key: string,
  options?: {
    context?: Context;
    hasTarget?: boolean;
    local?: boolean;
  }
): Mixin[] | undefined {
  const findMixinsWithinScopeSurface = (
    scope: Rules,
    localContext: boolean | undefined,
    visited: Set<Rules>
  ): Mixin[] | undefined => {
    if (visited.has(scope)) {
      return [];
    }
    visited.add(scope);

    if (!scope.mixinsByName) {
      // Scope not yet indexed — bail so full registry warms it up
      return undefined;
    }

    const results: Mixin[] = [];
    const candidates = scope.mixinsByName.get(key);
    if (candidates) {
      for (let i = candidates.length - 1; i >= 0; i--) {
        results.push(candidates[i]!);
      }
    }

    const childEntries = scope._rulesSet as Array<{
      node: Rules;
      rulesVisibility?: RulesOptions['rulesVisibility'];
    }> | undefined;
    if (!childEntries?.length) {
      return results;
    }

    for (let i = childEntries.length - 1; i >= 0; i--) {
      const entry = childEntries[i]!;
      const visibility = entry.rulesVisibility?.Mixin
        ?? entry.node.options.rulesVisibility?.Mixin;
      if (visibility !== 'public' && visibility !== 'optional') {
        continue;
      }
      if (entry.node.options?.isMixinOutput === true && options?.hasTarget !== true) {
        continue;
      }
      if (options?.context?.rulesContext === scope && entry.node.options?.forward) {
        continue;
      }
      if (localContext && entry.node.options?.local) {
        continue;
      }

      const childResult = findMixinsWithinScopeSurface(
        entry.node,
        localContext || Boolean(entry.node.options?.local),
        visited
      );
      if (childResult === undefined) {
        return undefined;
      }
      results.push(...childResult);
    }

    return results;
  };

  const results: Mixin[] = [];
  let cursor: Node | undefined = startRules;
  let first = true;
  while (cursor) {
    if (isNode(cursor, N.Rules)) {
      const scope = cursor as Rules;
      if (!first) {
        const sn = scope.sourceNode;
        if (sn?.type === 'StyleImport' && sn.options.type !== 'import') {
          break;
        }
      }
      first = false;
      const scopeResults = findMixinsWithinScopeSurface(scope, options?.local, new Set<Rules>());
      if (scopeResults === undefined) {
        return undefined;
      }
      results.push(...scopeResults);
    }
    cursor = cursor.parent ?? cursor.sourceParent;
  }
  return results;
}

const { isArray } = Array;

function isInsideSelectorCapture(node: Node | undefined): boolean {
  let cursor: Node | undefined = node;
  while (cursor) {
    if (cursor.type === 'SelectorCapture') {
      return true;
    }
    cursor = cursor.parent;
  }
  return false;
}

function normalizeSelectorReferenceKey(selector: Selector): string | string[] {
  if (isNode(selector, N.BasicSelector) || selector.type === 'InterpolatedSelector') {
    return selector.valueOf();
  }

  if (isNode(selector, N.CompoundSelector)) {
    return (selector.value as Node[]).map(node => String(node.valueOf()));
  }

  if (isNode(selector, N.ComplexSelector)) {
    const path: string[] = [];

    for (const node of selector.value as Node[]) {
      if (isNode(node, N.BasicSelector) || node.type === 'InterpolatedSelector') {
        path.push(String(node.valueOf()));
        continue;
      }
      if (isNode(node, N.CompoundSelector)) {
        path.push(...(node.value as Node[]).map(child => String(child.valueOf())));
        continue;
      }
      if (isNode(node, N.Combinator) && (node.value === '>' || node.value === ' ')) {
        continue;
      }
      return selector.valueOf();
    }

    if (path.length > 0) {
      return path;
    }
  }

  return selector.valueOf();
}

function getLookupStartIndex(node: Node): number | undefined {
  let startIndex = node.index;
  let currentNode: Node | undefined = node;

  if (startIndex === undefined) {
    while (currentNode && startIndex === undefined) {
      currentNode = currentNode.parent;
      if (currentNode) {
        startIndex = currentNode.index;
      }
    }
  }

  while (currentNode && currentNode.parent && !isNode(currentNode.parent, N.Rules)) {
    currentNode = currentNode.parent;
    if (currentNode && currentNode.index !== undefined) {
      startIndex = currentNode.index;
    }
  }

  return startIndex;
}

/**
 * This is a variable or property reference,
 * which can itself contain a reference (a variable variable).
 */
export class Reference extends Node<ReferenceValue, ReferenceOptions> {
  constructor(value: ReferenceValue | string, options?: ReferenceOptions, location?: LocationInfo, treeContext?: TreeContext) {
    if (typeof value === 'string') {
      value = { key: value };
    }
    super(value, options, location, treeContext);
    // References are always non-static and may be async
    this.addFlags(F_MAY_ASYNC, F_VISIBLE, F_NON_STATIC);
  }

  override valueOf() {
    return '';
  }

  /**
   * @note - A reference renders a $ only if it has no target.
   */
  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    let { type = 'variable', resolution, fallbackValue } = this.options;
    let { target, key, rawKey } = this.value;
    const emitKey = (k: any) => {
      if (typeof k === 'string' || typeof k === 'number') {
        w.add(String(k), this);
      } else if (k instanceof Node) {
        k.toString(options);
      } else if (Array.isArray(k)) {
        w.add(k.map(k => String(k)).join(''));
      } else {
        w.add(String(k));
      }
    };
    const printableKey = rawKey ?? key;
    if (target) {
      target.toString(options);
    } else {
      w.add('$');
    }
    if (resolution === 'live') {
      w.add('~');
    }
    switch (type) {
      case 'index':
        w.add('[');
        emitKey(printableKey);
        w.add(']');
        break;
      case 'variable':
        if (target) {
          w.add('.$');
        }
        emitKey(printableKey);
        break;
      case 'declaration':
        w.add('.');
        emitKey(printableKey);
        break;
      case 'property':
        if (target) {
          w.add('[');
          emitKey(printableKey);
          w.add(']');
        } else {
          w.add('.');
          emitKey(printableKey);
        }
        break;
      case 'mixin':
        w.add(' > ');
        emitKey(printableKey);
        break;
      case 'ruleset':
        w.add(' > *[');
        emitKey(printableKey);
        w.add(']');
        break;
      case 'mixin-ruleset':
        w.add(' > *');
        emitKey(printableKey);
        break;
    }
    if (fallbackValue === true) {
      w.add('?');
    }
    return w.getSince(mark);
  }

  /**
   * We don't need to mark evaluated, because a reference
   * should never resolve to itself
   */
  override evalNode(context: Context): MaybePromise<Node> {
    let { target, key } = this.value;
    let { type, fallbackValue, filter: originalFilter } = this.options;
    // Track reference chain for clearing remainders at outermost level
    context.pushReference();
    // Prefer the *current* evaluation rules context (mixin live scope) over the lexical rulesParent.
    // This is critical for mixin parameters (e.g. `@fallback`) which are registered onto the live
    // wrapper `Rules` and should be visible inside nested at-rule preludes.
    let resolvedTarget = target ? target.eval(context) : context.rulesContext ?? this.rulesParent;
    const result = pipe(
      () => {
        if (isThenable(resolvedTarget)) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          return (resolvedTarget as Promise<any>).then(result => result);
        }
        return resolvedTarget;
      },
      (resolvedTarget) => {
        let out: any;
        try {
          out = isNode(key) ? key.eval(context) : key;
        } catch (err: any) {
          throw err;
        }
        if (isThenable(out)) {
          return out.then((k: any) => {
            if (isNode(k, N.Selector)) {
              return [resolvedTarget, normalizeSelectorReferenceKey(k)] as [any, string | string[]];
            }
            if (Array.isArray(k)) {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
              return [resolvedTarget, k] as [any, string[]];
            }
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            return [resolvedTarget, k.valueOf()] as [any, string];
          });
        }
        if (isNode(out, N.Selector)) {
          return [resolvedTarget, normalizeSelectorReferenceKey(out)] as [any, string | string[]];
        }
        if (Array.isArray(out)) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          return [resolvedTarget, out] as [any, string[]];
        }
        const normalizedKey = isNode(out) ? out.valueOf() : out;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        return [resolvedTarget, normalizedKey] as [any, string];
      },
      ([resolvedTarget, valueKey]) => {
        /**
         * If we don't have rules yet, assume that this node
         * was an ambiguous reference to a mixin (such as a valid color
         * or an interpolated identifier). In that case, try to resolve
         * it as a reference to a mixin.
         *
         * (We have to do this for Less.)
         */
        if (resolvedTarget instanceof Node) {
          if (!(resolvedTarget instanceof MixinCollection) && !isNode(resolvedTarget, N.Rules | N.JsFunction | N.Mixin)) {
            let targetKey = isNode(resolvedTarget as Node, N.Color) ? String((resolvedTarget as Color).value.node) : (resolvedTarget as Node).valueOf();
            if (typeof targetKey === 'string') {
              let ref = new Reference(targetKey, { type: 'mixin-ruleset' });
              this.adopt(ref);
              return Promise.all([
                ref.eval(context),
                valueKey
              ]);
            }
          }
        }
        return [resolvedTarget, valueKey] as [any, string | string[]];
      },
      ([resolvedTarget, valueKey]) => {
        /**
         * If we're looking something up on a function, we presume
         * it needs to be called first, and that it has no arguments.
         */
        if (resolvedTarget instanceof MixinCollection) {
          return resolvedTarget.evalCall(context).then((r: any) => {
            return [r, valueKey] as [any, string | string[]];
          });
        }
        if (isNode(resolvedTarget, N.JsFunction)) {
          const jsResult = resolvedTarget.value.call(context);
          if (isThenable(jsResult)) {
            return (jsResult as Promise<any>).then((result) => {
              return [result, valueKey] as [any, string | string[]];
            });
          } else {
            resolvedTarget = jsResult;
            return [resolvedTarget, valueKey] as [any, string | string[]];
          }
        }

        /**
         * If we're looking something up on a mixin or ruleset (namespace lookup),
         * we need to evaluate its rules to get the Rules node first.
         *
         * Before evaluating, check if this Ruleset/Mixin has matched keys from a previous partial match
         * (for chained calls like .jo.ki() where .jo finds .jo.ki with matched keys [".jo"])
         * We accumulate the new key and use registry lookup to verify the compound match
         */
        if (isNode(resolvedTarget, N.Mixin | N.Ruleset)) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const mixinResult = (resolvedTarget as Ruleset).value.rules.eval(context);
          if (isThenable(mixinResult)) {
            return (mixinResult as Promise<Rules>).then((rules) => {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
              rules.inherit((resolvedTarget as Ruleset).value.rules);
              return [rules, valueKey] as [Node, string | string[]];
            });
          } else {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            mixinResult.inherit((resolvedTarget as Ruleset).value.rules);
            resolvedTarget = mixinResult as Rules;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            return [resolvedTarget, valueKey] as [Node, string | string[]];
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        return [resolvedTarget, valueKey] as [Node, string | string[]];
      },
      ([resolvedTarget, valueKey]) => {
        originalFilter ??= () => true;
        const isInterpolatedVariable =
          this.options.type === 'variable'
          && this.parent?.type === 'Interpolated';
        const isWithinParamVarScope = (paramParent: Node | undefined, activeRules: Node | undefined): boolean => {
          const sourceParamParent = paramParent?.sourceNode as Node | undefined;
          let cursor: Node | undefined = activeRules;
          while (cursor) {
            const sourceCursor = cursor.sourceNode as Node | undefined;
            if (
              cursor === paramParent
              || cursor === sourceParamParent
              || sourceCursor === paramParent
              || (sourceCursor && sourceParamParent && sourceCursor === sourceParamParent)
            ) {
              return true;
            }
            cursor = cursor.parent ?? cursor.sourceParent;
          }
          return false;
        };
        const filter = (n: Node) => {
          const passesOriginal = originalFilter!(n);
          const blockedParamVar = isNode(n, N.VarDeclaration)
            && Boolean(n.options?.paramVar)
            && !isWithinParamVarScope(n.parent, context.rulesContext);
          const blockedBySearchScope = context.searchScope.has(n);
          return passesOriginal && !blockedBySearchScope && !blockedParamVar;
        };
        const hasTarget = !!target;

        const performLookup = (targetRules: Rules | Node | undefined): any => {
          if (!targetRules) {
            return undefined;
          }
          const opts: FindOptions = { filter, context, hasTarget, renderKey: context.renderKey };
          if (!target && targetRules.options?.isMixinOutput === true) {
            opts.local = true;
          }

          if (
            !target
            && !isInterpolatedVariable
            && (
              type === 'variable'
              || type === 'property'
              || type === 'declaration'
            )
          ) {
            const startIndex = getLookupStartIndex(this);
            if (startIndex !== undefined) {
              // Contextual refs still respect the current scope cursor, but
              // must not carry that cutoff outward into parent scopes.
              opts.start = startIndex;
              opts.ignoreParentScopeStart = true;
            }
          } else if (this.options.resolution === 'live' && !isInterpolatedVariable) {
            // Live lookup uses the call site's position rather than the
            // definition position.
            if (context.rulesContext !== undefined) {
              opts.start = context.rulesContext.index;
            } else {
              // Fall back to the local node position if no call-site scope is active.
              const startIndex = getLookupStartIndex(this);
              if (startIndex !== undefined) {
                opts.start = startIndex;
              }
            }
          }
          switch (type) {
            case 'index':
              if (typeof valueKey === 'number') {
                if (isNode(targetRules, N.Rules)) {
                  return targetRules.at(valueKey);
                } else if (isNode(targetRules, N.JsArray)) {
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
                  return atIndex((targetRules as any).value, valueKey);
                }
              } else {
                const keyStr = Array.isArray(valueKey) ? (valueKey[0] ?? '') : valueKey;
                if (isNode(targetRules, N.Rules)) {
                  const indexFilterType = isNode(this.value.key, N.Quoted) ? 'Declaration' as const : 'VarDeclaration' as const;
                  return targetRules.find('declaration', `${keyStr}`, indexFilterType, opts);
                } else if (isNode(targetRules, N.JsObject)) {
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
                  return (targetRules as any).value[keyStr];
                }
              }
              break;
            case 'property':
            case 'variable':
              if (isNode(targetRules, N.Rules)) {
                const keyStr = Array.isArray(valueKey) ? valueKey[0] : valueKey;
                if (type === 'variable') {
                  // Slice 9/10/11: walk the frame chain for mixin param bindings
                  // (liveSlotsByName only — declarationBucketsByName follows
                  // definition-site semantics and must not be walked via the
                  // call-site chain).  getScopeFrame() now auto-wires parent
                  // frames so inner rules nodes within a mixin body correctly
                  // inherit outerRules.scopeFrame as their parent.
                  {
                    const frame = isNode(targetRules, N.Rules)
                      ? (targetRules as Rules).getScopeFrame()
                      : undefined;
                    let f = frame;
                    while (f) {
                      const live = f.liveSlotsByName.get(`${keyStr}`);
                      if (live) {
                        const src = live.sourceNode as Node | undefined;
                        if (!src || !context.searchScope.has(src)) {
                          return {
                            kind: 'runtime-var-binding' as const,
                            value: live.value,
                            readonly: live.readonly,
                            sourceNode: src
                          } satisfies RuntimeVarBinding;
                        }
                      }
                      f = f.parent;
                    }
                  }
                  // Fast path: walk varsByName directly, skipping the declaration-registry
                  // machinery for the dominant contextual variable lookup case.
                  {
                    const fast = findVarDeclarationFast(targetRules, `${keyStr}`, filter, {
                      start: opts.start,
                      context,
                      hasTarget,
                      local: opts.local
                    });
                    if (!fast.needsAsyncProbe) {
                      return fast.match;
                    }
                    return resolvePendingDynamicVarMatchAsync(
                      targetRules,
                      `${keyStr}`,
                      filter,
                      {
                        start: opts.start,
                        context,
                        hasTarget,
                        local: opts.local
                      },
                      fast.match,
                      fast.matchKind
                    );
                  }
                }
                const declarationType = type === 'property' ? 'Declaration' : 'VarDeclaration';
                const found = targetRules.find('declaration', `${keyStr}`, declarationType, opts);
                if (found !== undefined) {
                  return found;
                }
                return undefined;
              }
              break;
            case 'declaration':
              if (isNode(targetRules, N.Rules)) {
                const keyStr = Array.isArray(valueKey) ? valueKey[0] : valueKey;
                const found = targetRules.find('declaration', `${keyStr}`, undefined, opts);
                if (found !== undefined) {
                  return found;
                }
                return undefined;
              }
              break;
            case 'function':
              if (isNode(targetRules, N.Rules)) {
                const keyStr = Array.isArray(valueKey) ? valueKey[0] : valueKey;
                const inCall = isNode(this.parent, N.Call);
                // When called (e.g. `ns.func(...)`), prefer function lookup first, then fall back to a declaration.
                // When not called, parsers should generally use `index`/`variable` references for `ns.func` so
                // declarations win; but if we are here, keep behavior predictable.
                if (inCall) {
                  return (
                    targetRules.find('function', `${keyStr}`, undefined, opts)
                    ?? targetRules.find('declaration', `${keyStr}`, undefined, opts)
                  );
                }
                // Not in call: prefer declaration first, then function.
                return (
                  targetRules.find('declaration', `${keyStr}`, undefined, opts)
                  ?? targetRules.find('function', `${keyStr}`, undefined, opts)
                );
              }
              break;
            case 'mixin':
              if (isNode(targetRules, N.Rules)) {
                if (typeof valueKey === 'string') {
                  const fast = findMixinFast(targetRules, valueKey, {
                    context,
                    hasTarget,
                    local: opts.local
                  });
                  if (fast !== undefined) {
                    if (fast.length > 0) {
                      return fast;
                    }
                    if (isNode(this.parent, N.Call)) {
                      return targetRules.find('function', `${valueKey}`, undefined, opts);
                    }
                    return undefined;
                  }
                }
                const mixin = targetRules.find('mixin', valueKey, 'Mixin', opts);
                if (mixin) {
                  return mixin;
                }
                // Some Less built-ins are invoked in mixin-like call positions.
                // If a mixin lookup misses during a Call, allow function fallback.
                if (isNode(this.parent, N.Call)) {
                  const keyStr = Array.isArray(valueKey) ? (valueKey[0] ?? '') : valueKey;
                  return targetRules.find('function', `${keyStr}`, undefined, opts);
                }
                return undefined;
              }
              break;
            case 'mixin-ruleset':
              if (isNode(targetRules, N.Rules)) {
                // Fast path: single static string key → check mixinsByName before full registry.
                // Only covers Mixin nodes (not Ruleset-as-mixin); falls through for:
                //   - array keys (compound/namespace paths like .a > .b)
                //   - interpolated names (not in mixinsByName at all)
                //   - any scope not yet indexed (mixinsByName === undefined)
                if (typeof valueKey === 'string') {
                  const fast = findMixinFast(targetRules, valueKey, {
                    context,
                    hasTarget,
                    local: opts.local
                  });
                  if (fast !== undefined) {
                    // fast is an array; if non-empty, return it (same shape as full registry result).
                    // If empty, fall through — there may be Ruleset-as-mixin candidates in the registry.
                    if (fast.length > 0) {
                      return fast;
                    }
                    // Empty fast result + all scopes indexed: no static Mixin candidates.
                    // Still fall through to full registry in case Rulesets match.
                  }
                }
                const mixinOrRuleset = targetRules.find('mixin', valueKey, undefined, opts);
                if (mixinOrRuleset) {
                  return mixinOrRuleset;
                }
                if (isNode(this.parent, N.Call)) {
                  const keyStr = Array.isArray(valueKey) ? (valueKey[0] ?? '') : valueKey;
                  return targetRules.find('function', `${keyStr}`, undefined, opts);
                }
                return undefined;
              }
              break;
          }
          return undefined;
        };

        // Lookup is driven by the resolved target scope.
        // In mixin/at-rule nesting cases, `this.rulesParent` can point at a narrower scope (e.g. the
        // nested @media Rules) while the variable lives on an ancestor Rules (e.g. mixin param wrapper).
        let returnVal: any;
        if (isNode(resolvedTarget, N.Rules)) {
          returnVal = performLookup(resolvedTarget);
          if (isThenable(returnVal)) {
            return (returnVal as Promise<any>).then((asyncReturnVal) => {
              if (asyncReturnVal !== undefined || !context.leakyRules) {
                return { returnVal: asyncReturnVal, valueKey };
              }
              let callerLookup = performLookup(this.rulesParent);
              if (isThenable(callerLookup)) {
                return (callerLookup as Promise<any>).then((callerReturnVal) => {
                  if (callerReturnVal !== undefined) {
                    return { returnVal: callerReturnVal, valueKey };
                  }
                  let sourceLookup = performLookup(this.sourceRulesParent);
                  if (isThenable(sourceLookup)) {
                    return (sourceLookup as Promise<any>).then(sourceReturnVal => ({
                      returnVal: sourceReturnVal,
                      valueKey
                    }));
                  }
                  return { returnVal: sourceLookup, valueKey };
                });
              }
              if (callerLookup !== undefined) {
                return { returnVal: callerLookup, valueKey };
              }
              let sourceLookup = performLookup(this.sourceRulesParent);
              if (isThenable(sourceLookup)) {
                return (sourceLookup as Promise<any>).then(sourceReturnVal => ({
                  returnVal: sourceReturnVal,
                  valueKey
                }));
              }
              return { returnVal: sourceLookup, valueKey };
            });
          }
          // If leakyRules is true, try caller scope as a secondary pass (historical behavior).
          if (returnVal === undefined && context.leakyRules) {
            returnVal = performLookup(this.rulesParent);
            if (isThenable(returnVal)) {
              return (returnVal as Promise<any>).then((asyncReturnVal) => {
                if (asyncReturnVal !== undefined) {
                  return { returnVal: asyncReturnVal, valueKey };
                }
                let sourceLookup = performLookup(this.sourceRulesParent);
                if (isThenable(sourceLookup)) {
                  return (sourceLookup as Promise<any>).then(sourceReturnVal => ({
                    returnVal: sourceReturnVal,
                    valueKey
                  }));
                }
                return { returnVal: sourceLookup, valueKey };
              });
            }
            if (returnVal === undefined) {
              returnVal = performLookup(this.sourceRulesParent);
            }
          }
        }
        return { returnVal, valueKey };
      },
      ({ returnVal, valueKey }) => {
        const valueKeyStr2 = Array.isArray(valueKey) ? valueKey.join('') : String(valueKey);
        if (returnVal === undefined) {
          if (!fallbackValue) {
            if (
              (type === 'mixin' || type === 'mixin-ruleset')
              && isInsideSelectorCapture(this)
            ) {
              return new Any(valueKeyStr2, { role: 'ident' });
            }
            switch (type) {
              case 'mixin':
                throw new ReferenceError(`No matching mixins found for '${valueKeyStr2}'`);
              case 'ruleset':
                throw new ReferenceError(`No matching rulesets found for '${valueKeyStr2}'`);
              case 'mixin-ruleset':
                throw new ReferenceError(`No matching mixins found for '${valueKeyStr2}'`);
            }
            throw new ReferenceError(`'${valueKeyStr2}' is not defined`);
          }
          if (fallbackValue === true) {
            const any = new Any(`${valueKey}`);
            any.options.role = this.options.role;
            return any;
          }
          // Evaluate the fallbackValue if it's a Node
          let out = fallbackValue.eval(context);
          if (isThenable(out)) {
            return (out as Promise<Node>).then(node => node);
          }
          return out;
        }
        if (isRuntimeVarBinding(returnVal)) {
          const bindingSource = returnVal.sourceNode;
          if (bindingSource) {
            context.searchScope.add(bindingSource);
          }
          const finalizeRuntimeBinding = (evald: Node) => {
            if (bindingSource) {
              context.searchScope.delete(bindingSource);
            }
            const out = evald.copy(true, freezeChildren).inherit(evald);
            out.frozen = true;
            out.pre = this.pre;
            out.post = this.post;
            out.sourceParent = this;
            return out;
          };
          const evaluatedBinding = (() => {
            returnVal.value.frozen = true;
            try {
              return returnVal.value.eval(context);
            } catch (error) {
              if (bindingSource) {
                context.searchScope.delete(bindingSource);
              }
              throw error;
            }
          })();
          if (isThenable(evaluatedBinding)) {
            return (evaluatedBinding as Promise<Node>)
              .then(finalizeRuntimeBinding, (error) => {
                if (bindingSource) {
                  context.searchScope.delete(bindingSource);
                }
                throw error;
              });
          }
          return pipe(
            () => evaluatedBinding,
            (evald) => {
              return finalizeRuntimeBinding(evald as Node);
            }
          );
        }
        if (isNode(returnVal, N.Declaration | N.VarDeclaration)) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          context.searchScope.add(returnVal as Node);
          const hasImportant = isNode(returnVal, N.Declaration) && !!(returnVal as Declaration).value.important;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const declValue = (returnVal as Declaration).value.value;
          const normalizedAssign = isNode(returnVal, N.Declaration)
            ? returnVal.options?.normalizedFromAssign
            : undefined;
          const isMergedAssign = normalizedAssign === '+:' || normalizedAssign === '&,:' || normalizedAssign === '&_:';
          // Mixin references (e.g. @foo: .a) are not resolved at lookup time; they are
          // resolved only when called (@foo();) or used as target of a lookup (@foo[prop]).
          const isMixinRef = isNode(declValue, N.Reference) && declValue.options?.type === 'mixin-ruleset';
          return pipe(
            () => {
              // Track that this value came from an important declaration
              // We push here but DON'T pop - let the consuming Declaration pop it
              if (hasImportant) {
                context.pushImportantSource();
              }
              declValue.frozen = true;
              if (isMixinRef) {
                return declValue;
              }
              return declValue.eval(context);
            },
            (evald) => {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
              context.searchScope.delete(returnVal as Node);
              // DON'T pop important source here - let the consuming Declaration pop it
              // after it has checked and merged the important flag
              let out = evald.copy(true, freezeChildren).inherit(evald);
              if (isMergedAssign && isNode(out, N.List)) {
                const mergedItems: Node[] = [];
                const collect = (child: Node): void => {
                  if (isNode(child, N.List)) {
                    for (const item of child.value) {
                      collect(item as Node);
                    }
                    return;
                  }
                  const isEmptyPlaceholder = (
                    isNode(child, N.Nil)
                    || String(child.valueOf?.() ?? '') === ''
                  );
                  if (!isEmptyPlaceholder) {
                    mergedItems.push(child.copy(true, freezeChildren));
                  }
                };
                collect(out);
                if (mergedItems.length === 0) {
                  out = new Nil();
                } else if (mergedItems.length === 1) {
                  out = mergedItems[0]!;
                } else {
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
                  out = new List(mergedItems) as unknown as typeof out;
                }
              }
              out.frozen = true;
              out.pre = this.pre;
              out.post = this.post;
              out.sourceParent = this;
              return out;
            }
          );
        } else if (isArray(returnVal)) {
          for (let item of returnVal) {
            item.sourceParent = this;
            if (!isNode(item, N.Mixin | N.Ruleset)) {
              return cast(undefined);
            }
          }
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          return new MixinCollection(returnVal as MixinEntry[]);
        }
        const result = cast(returnVal);
        // Pop reference and clear remainders if we're at the outermost level
        context.popReference();
        result.sourceParent = this;
        return result;
      }
    );
    if (isThenable(result)) {
      return (result as Promise<Node>).then(
        res => res,
        (err) => {
          throw err;
        }
      );
    }
    return result as Node;
  }
}

export const ref = defineType(Reference, 'Reference', 'ref');
