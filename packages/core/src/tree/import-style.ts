import { basename, dirname, extname, join, relative } from 'node:path';
import { TreeContext, type Context } from '../context.js';
import { Node, F_MAY_ASYNC, F_NON_STATIC, F_VISIBLE, defineType, type NodeLocation, type LocationInfo } from './node.js';
import { type Reference } from './reference.js';
import { Rules, type RulesOptions, type RulesVisibility } from './rules.js';
import { type Quoted } from './quoted.js';
import { Url } from './url.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import type { Ruleset } from './ruleset.js';
import type { Collection } from './collection.js';
import { AtRule } from './at-rule.js';
import { AtRuleStatement } from './at-rule-statement.js';
import { Any } from './any.js';
import { Sequence } from './sequence.js';
import { registerRulesetWithRoot } from './util/extend-roots.js';
import { buildScopeFrame, copyScopeFrameLiveBindingSlots, type BindingCell } from './scope-frame.js';
import { Comment } from './comment.js';
import {
  isRenderBuffer,
  type RenderBuffer
} from './util/render-buffer.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import { createPlacementChildSegment, type PlacementChildSegment } from './util/placement-state.js';
import { queueTopImport } from './util/import-queue.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function markPathResolutionError(error: unknown): void {
  if (isObject(error)) {
    error._isPathResolutionError = true;
  }
}

function isParseError(error: unknown): boolean {
  if (!isObject(error)) {
    return false;
  }
  return error.phase === 'parse'
    || (typeof error.code === 'string' && error.code.startsWith('parse/'));
}

function escapeQuotedImportPath(value: string, quote: '"' | '\''): string {
  return value.replaceAll('\\', '\\\\').replaceAll(quote, `\\${quote}`);
}

function toCanonicalRelativeImportPath(fromDir: string | undefined, resolvedPath: string): string {
  if (!fromDir) {
    return resolvedPath.replace(/\\/g, '/');
  }
  let out = relative(fromDir, resolvedPath).replace(/\\/g, '/');
  if (!out.startsWith('.') && !out.startsWith('/')) {
    out = `./${out}`;
  }
  return out || './';
}

function replaceFileExtension(filePath: string, extension: string): string {
  const current = extname(filePath);
  return current
    ? `${filePath.substring(0, filePath.length - current.length)}${extension}`
    : `${filePath}${extension}`;
}

function mapConvertedFilePath(
  sourcePath: string,
  options: FinalPrintOptions,
  fallbackRoot: string | undefined
): string {
  const conversion = options.conversion;
  if (conversion?.mapPath) {
    return replaceFileExtension(conversion.mapPath(sourcePath), '.jess');
  }
  if (!conversion?.outputDir) {
    return replaceFileExtension(sourcePath, '.jess');
  }
  const sourceRoot = conversion.sourceRoot ?? fallbackRoot ?? dirname(sourcePath);
  return replaceFileExtension(join(conversion.outputDir, relative(sourceRoot, sourcePath)), '.jess');
}

function throwMissingImportSourceGetter(): never {
  throw new Error('No source getter found');
}

function throwInvalidImportedRulesRegistrationPrep(): never {
  throw new TypeError('Expected imported rules registration prep to return Rules');
}

function variableNameKey(node: Node): string {
  if (!isNode(node, N.VarDeclaration)) {
    return '';
  }
  const name = node.name;
  return name instanceof Any
    ? name.value
    : String(name.valueOf?.() ?? '');
}

function visitDescendantRulesets(value: unknown, cb: (ruleset: Ruleset) => void): void {
  if (isNode(value, N.Ruleset)) {
    cb(value as Ruleset);
  }
  if (isNode(value, N.Rules)) {
    visitDescendantRulesets((value as Rules).rules, cb);
    return;
  }
  if (value instanceof Node) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const childKeys = (value.constructor as typeof Node).childKeys;
    if (childKeys) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const fields = value as unknown as Record<string, unknown>;
      for (let i = 0; i < childKeys.length; i++) {
        visitDescendantRulesets(fields[childKeys[i]!], cb);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      visitDescendantRulesets(value[i], cb);
    }
    return;
  }
  if (isObject(value)) {
    for (const key in value) {
      visitDescendantRulesets(value[key], cb);
    }
  }
}

function getInlineSourceLocation(source: string): NodeLocation {
  let line = 1;
  let column = 1;
  for (let index = 0; index < source.length; index++) {
    if (source.charCodeAt(index) === 10) {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return [0, 1, 1, source.length, line, column];
}

/**
 * This class is for Jess / Sass+ / Less-style imports,
 * not the CSS `@import` rule. The two will be distinguished
 * during parsing.
 *
 * @see https://sass-lang.com/documentation/at-rules/import/#plain-css-imports
 */

export type ImportOptions = {
  /**
   * Affects evaluation - will be passed to registered import handlers when parsing.
   * Normally this is done by file extension, but can be overridden to select a
   * particular plugin handler.
   *
   * e.g. `@-import (type: less) 'foo.css';`
   */
  type?: string;
  /** Rules are not rendered in output. */
  reference?: boolean;
  optional?: boolean;
  inline?: boolean;
  /**
   * Optional import postlude captured by parsers for forms like:
   * `@import (inline) "x.css" layer(foo) supports(display: grid) screen;`
   *
   * For inline imports, this is applied as serializer wrappers around the inlined source.
   */
  postlude?: Node;
  /**
   * Less's default behavior for `@import` is to only output any resolved resource once.
   * In Jess, subsequent imports should output as reference unless the `multiple` option
   * is set to true.
   *
   * @todo - Investigate what Sass does.
   */
  multiple?: boolean;
  /**
   * Allow extends to reach into this import.
   * Default is false for @-compose (protected by default), true for @-import.
   */
  mutable?: boolean;
  /**
   * Sass `@forward` semantics:
   * - members are NOT visible to the current stylesheet scope
   * - members ARE made available downstream when this stylesheet is imported
   */
  forward?: boolean;
  /**
   * Sass `@forward ... as <prefix>-*;` prefixing.
   * Stores the prefix portion (e.g. `bar-` from `bar-*`).
   */
  forwardAsPrefix?: string;
  /**
   * Sass `@forward ... show ...;` list.
   * We capture raw member names (e.g. `$a`, `mixin-b`, `fn-c`) without semantics yet.
   */
  forwardShow?: string[];
  /**
   * Sass `@forward ... hide ...;` list.
   * We capture raw member names (e.g. `$a`, `mixin-b`, `fn-c`) without semantics yet.
   */
  forwardHide?: string[];
  /** Variables can't be reassigned (default is true for `@-compose` and false for `@-import`). */
  readonly?: boolean;
  /** Internal marker for "once" de-duplication rendering semantics. */
  _dedupe?: boolean;
  [key: string]: unknown;
};

export type StyleImportOptions = {
  /**
   * Old-style `@import` type or new `@-compose` type.
   */
  type: 'import' | 'compose';

  /**
   * Options passed to the Jess import plugin. Options are interpreted like
   * querystring parameters i.e.
   *   e.g. `@-import (foo, bar, baz: 1) 'foo.css';`
   *     - foo: true
   *     - bar: true
   *     - baz: '1'
   */
  importOptions?: ImportOptions;

  /** e.g. `import * as foo` sets namespace to `foo` */
  namespace?: string;

  /** Set on the import node instead of on rules */
  local?: boolean;
  rulesVisibility?: RulesOptions['rulesVisibility'];

  /**
   * Resolved import target captured during evaluation. Parsers preserve the
   * authored specifier; conversion passes can use this to rewrite the canonical
   * Jess tree after the resolver has proven where the import actually landed.
   */
  resolvedPath?: string;
  /** Directory of the importing file at the time `resolvedPath` was proven. */
  resolvedFromPath?: string;
  /** Full path of the importing file at the time `resolvedPath` was proven. */
  resolvedFromFilePath?: string;
};

export type StyleImportValue = {
  path: Quoted | Url;

  /** Values to inject */
  with?: {
    node: Reference | Collection;
    /**
     * For use / ref / include statements, will affect how this module is evaluated
     * every time. 'set' can be used once per module, 'with' can be used multiple.
     * In Sass, 'set' is called 'with' and 'with' will be parsed as 'set'.
     *   e.g.
     *     `@-use 'library' set { $foo: 1 };` -- $foo will be set to 1 every time
     *     `@-use 'library' with { $foo: 1 };` -- $foo will be set to 1 just for this scope.
     */
    type: 'with' | 'set';
  };
};

export interface StyleImport extends Node<StyleImportValue, StyleImportOptions> {
  eval(context: Context): MaybePromise<Rules>;
}

type ImportPlacementState = {
  source: Rules;
  children: Node[];
  childSegments: readonly ImportPlacementChildSegment[];
};

export type ImportPlacementChildSegment = PlacementChildSegment;

type ImportPlacementOptionsState = {
  referenceMode: RulesOptions['referenceMode'];
  rulesVisibility: RulesOptions['rulesVisibility'];
};

export type ImportPlacementRenderState = {
  referenceMode: RulesOptions['referenceMode'];
  rulesVisibility: RulesOptions['rulesVisibility'];
};

const importPlacementStates = new WeakMap<Rules, ImportPlacementState>();
const importPlacementOptionsStates = new WeakMap<Rules, ImportPlacementOptionsState>();

export type ImportPostludePlacementState = {
  sourceRules: Rules;
  outputRules: Rules;
  postludeNames: readonly string[];
  postludeNodes: readonly Node[];
};

export type ImportPostludeRenderState = {
  sourceRules: Rules;
  outputRules: Rules;
  order: readonly string[];
};

const importPostludePlacementStates = new WeakMap<Rules, ImportPostludePlacementState>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function findImportPlacementState(placementRules: Rules): ImportPlacementState | undefined {
  let cursor: Rules | undefined = placementRules;
  for (let depth = 0; cursor && depth < 4; depth++) {
    const state = importPlacementStates.get(cursor);
    if (state) {
      return state;
    }
    cursor = isNode(cursor.sourceNode, N.Rules) ? cursor.sourceNode : undefined;
  }
  return undefined;
}

type ImportPlacementValuePath = readonly (string | number)[];

function nodeChildKeys(node: Node): readonly string[] | undefined {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const childKeys = (node.constructor as typeof Node).childKeys;
  return childKeys === null ? undefined : childKeys;
}

function findImportPlacementValuePath(
  value: unknown,
  target: Node,
  path: (string | number)[] = []
): ImportPlacementValuePath | undefined {
  if (value === target) {
    const out = new Array<string | number>(path.length);
    for (let i = 0; i < path.length; i++) {
      out[i] = path[i]!;
    }
    return out;
  }
  if (value instanceof Node) {
    const childKeys = nodeChildKeys(value);
    if (childKeys) {
      for (const key of childKeys) {
        path.push(key);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const found = findImportPlacementValuePath((value as unknown as Record<string, unknown>)[key], target, path);
        path.pop();
        if (found) {
          return found;
        }
      }
      return undefined;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Node subclasses use legacy .value when childKeys is undefined
    return findImportPlacementValuePath((value as unknown as { value: unknown }).value, target, path);
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      path.push(index);
      const found = findImportPlacementValuePath(value[index], target, path);
      path.pop();
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  if (isRecord(value)) {
    for (const key in value) {
      path.push(key);
      const found = findImportPlacementValuePath(value[key], target, path);
      path.pop();
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

function readImportPlacementValuePath(value: unknown, path: ImportPlacementValuePath): unknown {
  let cursor = value;
  for (const segment of path) {
    if (cursor instanceof Node) {
      if (typeof segment === 'string') {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        cursor = (cursor as unknown as Record<string, unknown>)[segment];
        continue;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Node subclasses use legacy .value when childKeys is undefined
      cursor = (cursor as unknown as { value: unknown }).value;
    }
    if (Array.isArray(cursor)) {
      if (typeof segment !== 'number') {
        return undefined;
      }
      cursor = cursor[segment];
      continue;
    }
    if (isRecord(cursor)) {
      cursor = cursor[segment];
      continue;
    }
    return undefined;
  }
  return cursor;
}

export function getImportPlacementSourceChild(
  placementRules: Rules,
  placementChild: Node
): Node | undefined {
  const state = findImportPlacementState(placementRules);
  if (!state) {
    return undefined;
  }
  const segmentSource = getImportPlacementSegmentSourceChild(placementRules, placementChild);
  if (segmentSource) {
    return segmentSource;
  }
  const index = placementRules.rules.indexOf(placementChild);
  return index >= 0 ? state.source.rules[index] : undefined;
}

export function getImportPlacementSegmentSourceChild(
  placementRules: Rules,
  placementChild: Node
): Node | undefined {
  const state = findImportPlacementState(placementRules);
  if (!state) {
    return undefined;
  }
  if (placementChild.canReuseAsLeaf()) {
    return placementChild;
  }
  for (const segment of state.childSegments) {
    const placementSegment = placementRules.rules[segment.index];
    if (placementSegment === placementChild) {
      return segment.source;
    }
    const path = findImportPlacementValuePath(placementSegment, placementChild);
    if (!path) {
      continue;
    }
    const sourceDescendant = readImportPlacementValuePath(segment.source, path);
    return sourceDescendant instanceof Node ? sourceDescendant : undefined;
  }
  return undefined;
}

export function getImportPlacementChildSegments(placementRules: Rules): readonly ImportPlacementChildSegment[] | undefined {
  const state = findImportPlacementState(placementRules);
  if (!state) {
    return undefined;
  }
  const segments = new Array<ImportPlacementChildSegment>(state.childSegments.length);
  for (let i = 0; i < state.childSegments.length; i++) {
    const segment = state.childSegments[i]!;
    segments[i] = createPlacementChildSegment(segment.source, placementRules.rules[segment.index], segment.index);
  }
  return segments;
}

function readImportPlacementRenderState(placementRules: Rules): ImportPlacementRenderState {
  return {
    referenceMode: importPlacementOptionsStates.get(placementRules)?.referenceMode
      ?? placementRules.options.referenceMode,
    rulesVisibility: importPlacementOptionsStates.get(placementRules)?.rulesVisibility
      ?? placementRules.options.rulesVisibility
  };
}

export function getImportPlacementReferenceMode(placementRules: Rules): RulesOptions['referenceMode'] | undefined {
  return readImportPlacementRenderState(placementRules).referenceMode;
}

export function getImportPlacementRulesVisibility(placementRules: Rules): RulesOptions['rulesVisibility'] | undefined {
  return readImportPlacementRenderState(placementRules).rulesVisibility;
}

export function getImportPlacementRenderState(placementRules: Rules): ImportPlacementRenderState {
  return readImportPlacementRenderState(placementRules);
}

export function getImportPostludePlacement(outputRules: Rules): ImportPostludePlacementState | undefined {
  return importPostludePlacementStates.get(outputRules);
}

export function getImportPostludeRenderOrder(outputRules: Rules): readonly string[] | undefined {
  return getImportPostludeRenderState(outputRules)?.order;
}

export function getImportPostludeRenderState(outputRules: Rules): ImportPostludeRenderState | undefined {
  const placement = getImportPostludePlacement(outputRules);
  if (!placement) {
    return undefined;
  }
  return {
    sourceRules: placement.sourceRules,
    outputRules: placement.outputRules,
    order: placement.postludeNames
  };
}

/**
 * This is a generic class for:
 *   - Sass+ `@use` (for stylesheets)
 *   - Jess `@-compose` and Less `@compose`
 *   - Less, Sass+, and Jess `@import` / `@-import` that are indicated
 *     to be processed by the engine
 *
 * @see https://sass-lang.com/documentation/at-rules/import/
 */
export class StyleImport extends Node<StyleImportValue, StyleImportOptions> {
  static override childKeys = ['path', 'withNode'] as const;

  readonly path: StyleImportValue['path'];
  readonly with: StyleImportValue['with'] | undefined;
  readonly withNode: NonNullable<StyleImportValue['with']>['node'] | undefined;

  private getImportAnchorRules(context: Context): Rules {
    return isNode(context.rulesContext, N.Rules)
      ? context.rulesContext
      : isNode(this.parent, N.Rules)
        ? this.parent
        : context.root;
  }

  /**
   * Derive an import-owned Rules surface from the active anchor.
   *
   * This is not a clone-isolation mechanism. Imports use these surfaces to hold
   * semantic placement state: configured bindings, visibility/reference options,
   * inline source text, or real postlude containers like `@media`.
   */
  private deriveRulesSurface(
    anchorRules: Rules,
    childNodes?: Node[],
    options?: {
      preserveSourceNode?: boolean;
      resetScopeFrame?: boolean;
      shareChildren?: boolean;
    }
  ): Rules {
    const sourceLocation = anchorRules.location.length === 6 ? anchorRules.location : undefined;
    const wrapped = childNodes !== undefined
      ? new Rules([], anchorRules.options ? { ...anchorRules.options } : undefined, sourceLocation, anchorRules._treeContext)
      : anchorRules.derive();
    if (childNodes !== undefined) {
      wrapped.parent = anchorRules.parent;
      wrapped.index = anchorRules.index;
    }
    if (options?.resetScopeFrame) {
      wrapped.scopeFrame = undefined;
    }
    if (options?.preserveSourceNode) {
      wrapped.sourceNode = anchorRules.sourceNode ?? anchorRules;
    }
    if (childNodes) {
      for (const childNode of childNodes) {
        // Thin placement shares the canonical children (push without adopting,
        // so the source tree is never re-parented); other callers own them.
        if (!options?.shareChildren) {
          wrapped.adopt(childNode);
        }
        wrapped.rules.push(childNode);
      }
    }
    return wrapped;
  }

  private createInlineSourceNode(source: string, resolvedPath: string): Any<'any'> {
    const treeContext = new TreeContext({
      file: {
        name: basename(resolvedPath),
        path: dirname(resolvedPath),
        fullPath: resolvedPath,
        source
      }
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- getInlineSourceLocation always returns a full 6-element tuple, never []
    const node = new Any(source, { role: 'any' }, getInlineSourceLocation(source) as LocationInfo);
    new Rules([node], undefined, undefined, treeContext);
    return node;
  }

  private createFirstUseImportPlacementState(sourceRules: Rules): ImportPlacementState {
    // Thin placement: SHARE the imported source children directly (the
    // canonical tree is never copied). Per-placement state lives in the
    // placement state record / scope frame, not in copied nodes.
    const children = new Array<Node>(sourceRules.rules.length);
    const childSegments = new Array<PlacementChildSegment>(sourceRules.rules.length);
    for (let index = 0; index < sourceRules.rules.length; index++) {
      const source = sourceRules.rules[index]!;
      children[index] = source;
      childSegments[index] = createPlacementChildSegment(source, source, index);
    }
    return {
      source: sourceRules,
      children,
      childSegments
    };
  }

  private materializeImportPlacementState(
    state: ImportPlacementState,
    importSite: Rules
  ): Rules {
    const placement = this.deriveRulesSurface(state.source, state.children, {
      shareChildren: true,
      preserveSourceNode: true
    });
    // `import` inlines into the importing scope. Because the placement SHARES
    // the canonical imported children (they keep their imported-tree parent),
    // the only way those children resolve free vars (e.g. a parent-scope
    // variable) is through this surface's scope frame. So the surface's lexical
    // parent is the IMPORT SITE — its frame chain reaches the importing scope —
    // while `sourceNode` still points at the canonical imported tree for the
    // surface's own declarations. See LIVE_BINDING_ARCHITECTURE.md §4.
    placement.parent = importSite;
    // Mark as an inline placement so the scope-frame parent-walk re-points the
    // shared canonical children up the import-site chain (LIVE_BINDING §4).
    placement.options.inlinePlacement = true;
    importPlacementStates.set(placement, state);
    return placement;
  }

  private getPostludeNodes(postlude?: Node): Node[] {
    if (!postlude) {
      return [];
    }
    if (isNode(postlude, N.List)) {
      return postlude.value;
    }
    return isNode(postlude, N.Sequence) ? postlude.value : [postlude];
  }

  private wrapRulesInAtRuleSurface(anchorRules: Rules, rules: Rules, name: string, prelude: Node): Rules {
    const wrappedAtRule = new AtRule({
      name: new Any(name, { role: 'atkeyword' }),
      prelude,
      rules: rules.rules
    });
    return this.deriveRulesSurface(anchorRules, [wrappedAtRule], { resetScopeFrame: true });
  }

  private clearConfiguredImportBoundary(rules: Rules): void {
    delete rules.options.importBoundary;
  }

  private throwIfConfiguredReuseIsDisallowed(withValues: StyleImportValue['with'] | undefined, hasCachedEvaluation: boolean): void {
    if (!withValues || !hasCachedEvaluation) {
      return;
    }

    if (withValues.type === 'set' || this.options.type === 'compose') {
      throw new Error('Cannot configure a stylesheet more than once.');
    }
  }

  private async resolveConfiguredRulesInput(context: Context, withNode: Reference | Collection): Promise<Collection> {
    if (isNode(withNode, N.Reference)) {
      const evaluated = await withNode.eval(context);
      if (!isNode(evaluated, N.Collection)) {
        throw new Error('with/set node must evaluate to a Collection');
      }
      return evaluated;
    }

    return withNode;
  }

  private partitionConfiguredNodes(sourceRules: Rules, withRules: Rules): {
    newVariables: Node[];
    replacementsByIndex: Map<number, Node>;
  } {
    const firstVarIndexByName = new Map<string, number>();
    for (let index = 0; index < sourceRules.rules.length; index++) {
      const existingNode = sourceRules.rules[index]!;
      if (!isNode(existingNode, N.VarDeclaration)) {
        continue;
      }
      const existingName = variableNameKey(existingNode);
      if (existingName && !firstVarIndexByName.has(existingName)) {
        firstVarIndexByName.set(existingName, index);
      }
    }

    const newVariables: Node[] = [];
    const replacementsByIndex = new Map<number, Node>();
    for (const injectedNode of withRules.rules) {
      if (isNode(injectedNode, N.VarDeclaration)) {
        const varName = variableNameKey(injectedNode);
        if (varName) {
          const existingIndex = firstVarIndexByName.get(varName);
          if (existingIndex !== undefined) {
            replacementsByIndex.set(existingIndex, injectedNode);
          } else {
            newVariables.push(injectedNode);
          }
        } else {
          newVariables.push(injectedNode);
        }
      } else {
        newVariables.push(injectedNode);
      }
    }

    return {
      newVariables,
      replacementsByIndex
    };
  }

  private createConfiguredImportedSurface(sourceRules: Rules, replacementsByIndex?: Map<number, Node>): Rules {
    const importedRules = this.deriveRulesSurface(sourceRules, undefined, { preserveSourceNode: true });
    if (!replacementsByIndex?.size) {
      return importedRules;
    }

    importedRules.rules.length = 0;
    for (let index = 0; index < sourceRules.rules.length; index++) {
      const originalNode = sourceRules.rules[index]!;
      const nextNode = replacementsByIndex.get(index) ?? originalNode;
      importedRules.adopt(nextNode);
      importedRules.rules.push(nextNode);
    }
    return importedRules;
  }

  private createConfiguredResultSurface(
    sourceRules: Rules,
    importedRules: Rules,
    additiveNodes: Node[]
  ): Rules {
    const additiveVariableNodes: Node[] = [];
    const additiveNonVariableNodes: Node[] = [];
    for (let i = 0; i < additiveNodes.length; i++) {
      const node = additiveNodes[i]!;
      if (isNode(node, N.VarDeclaration)) {
        additiveVariableNodes.push(node);
      } else {
        additiveNonVariableNodes.push(node);
      }
    }
    this.clearConfiguredImportBoundary(importedRules);
    if (additiveNonVariableNodes.length === 0) {
      this.attachConfiguredVarBindings(importedRules, additiveVariableNodes);
      return importedRules;
    }

    const finalRules = this.deriveRulesSurface(sourceRules, [], { resetScopeFrame: true });
    for (const newNode of additiveNonVariableNodes) {
      finalRules.adopt(newNode);
      finalRules.rules.push(newNode);
    }
    this.attachConfiguredVarBindings(finalRules, additiveVariableNodes);
    finalRules.adopt(importedRules);
    finalRules.rules.push(importedRules);
    return finalRules;
  }

  private applyConfiguredValues(sourceRules: Rules, withRules: Rules): Rules {
    const { newVariables, replacementsByIndex } = this.partitionConfiguredNodes(sourceRules, withRules);

    if (newVariables.length === 0 && replacementsByIndex.size === 0) {
      return sourceRules;
    }

    const importedRules = this.createConfiguredImportedSurface(
      sourceRules,
      replacementsByIndex.size > 0 ? replacementsByIndex : undefined
    );

    return this.createConfiguredResultSurface(sourceRules, importedRules, newVariables);
  }

  private attachConfiguredVarBindings(targetRules: Rules, variableNodes: Node[]): void {
    const liveSlots = copyScopeFrameLiveBindingSlots(targetRules._scopeFrame);
    let didAdd = false;
    for (const node of variableNodes) {
      if (!isNode(node, N.VarDeclaration)) {
        continue;
      }
      const name = variableNameKey(node);
      if (!name) {
        continue;
      }
      liveSlots.set(name, {
        value: node.value instanceof Node ? node.value : undefined,
        sourceNode: node,
        readonly: node.options?.readonly
      } satisfies BindingCell);
      didAdd = true;
    }
    if (!didAdd) {
      return;
    }
    const existingFallbackFrame = targetRules._scopeFrame?.fallbackFrame;
    targetRules.scopeFrame = buildScopeFrame(
      undefined,
      targetRules,
      targetRules._scopeFrame?.parent,
      liveSlots,
      targetRules._scopeFrame?.pendingDeclarationNames,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      targetRules._scopeFrame?.hasReferenceImports ?? targetRules._hasReferenceImports
    );
    targetRules.scopeFrame.fallbackFrame = existingFallbackFrame;
  }

  private toImportPathNode(node: Node): Quoted | Url {
    if (isNode(node, N.Quoted) || node instanceof Url) {
      return node;
    }
    throw new Error('Import path must evaluate to a quoted string or url() node.');
  }

  private isPlainCssImport(finalPath: string): boolean {
    const { importOptions } = this.options;
    if (
      importOptions?.inline === true
      || importOptions?.type === 'less'
      || importOptions?.reference === true
      || importOptions?.multiple === true
      || importOptions?.optional === true
    ) {
      return false;
    }
    const lower = finalPath.toLowerCase();
    if (/\.css([?#].*)?$/.test(lower)) {
      return true;
    }
    return lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('//');
  }

  private createCssImportAtRule(pathNode: Quoted | Url): AtRuleStatement {
    const preludeNodes: Node[] = [pathNode];
    const postludeNodes = this.getPostludeNodes(this.options.importOptions?.postlude);
    for (let i = 0; i < postludeNodes.length; i++) {
      preludeNodes.push(postludeNodes[i]!);
    }
    const prelude = preludeNodes.length === 1
      ? preludeNodes[0]
      : new Sequence(preludeNodes);

    const location = this.location && this.location.length === 6 ? this.location : undefined;
    // @import has no block body — it is a semicolon at-rule statement.
    return new AtRuleStatement({
      name: new Any('@import', { role: 'atkeyword' }),
      prelude
    }, undefined, location);
  }

  constructor(value: StyleImportValue, options?: StyleImportOptions, location?: NodeLocation, treeContext?: Context['treeContext']) {
    super(value, options, location);
    this._treeContext = treeContext;
    this.path = value.path;
    this.with = value.with;
    this.withNode = value.with?.node;
    // Style imports are always non-static and may be async
    this.addFlags(F_MAY_ASYNC, F_NON_STATIC);
  }

  private getCanonicalSourcePath(options: FinalPrintOptions): string | undefined {
    if (options.syntax !== 'jess' || !this.options.resolvedPath) {
      return undefined;
    }
    const resolvedFromRoot = this.options.resolvedFromPath;
    const targetPath = mapConvertedFilePath(this.options.resolvedPath, options, resolvedFromRoot);
    const fromFilePath = options.conversion?.fromFilePath
      ?? (this.options.resolvedFromFilePath
        ? mapConvertedFilePath(this.options.resolvedFromFilePath, options, resolvedFromRoot)
        : undefined);
    return toCanonicalRelativeImportPath(
      fromFilePath ? dirname(fromFilePath) : resolvedFromRoot,
      targetPath
    );
  }

  private writeImportPathSyntax(options: FinalPrintOptions): void {
    const canonicalPath = this.getCanonicalSourcePath(options);
    if (canonicalPath === undefined) {
      this.path.writeSyntax(options);
      return;
    }
    const quote = this.path instanceof Url
      ? '"'
      : this.path.options?.quote ?? '"';
    options.writer.add(quote, this.path);
    options.writer.add(escapeQuotedImportPath(canonicalPath, quote), this.path);
    options.writer.add(quote, this.path);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const importOptions = this.options.importOptions;
    const atRuleName = this.options.type === 'compose'
      ? importOptions?.forward === true ? '@-export' : '@-compose'
      : '@import';
    const w = options.writer;
    w.add(`${atRuleName} `, this);
    this.writeImportPathSyntax(options);
    if (this.options.namespace) {
      w.add(` as ${this.options.namespace}`);
    }
    w.add(';');
  }

  override toTrimmedString(rawOptions?: PrintOptions): string {
    const options = getPrintOptions(rawOptions);
    const mark = options.writer.mark();
    this.writeSyntax(options);
    return options.writer.getSince(mark);
  }

  getFinalRules(evaluatedRules: Rules) {
    let { importOptions, type } = this.options;
    const reference = importOptions!.reference;
    const isForward = importOptions!.forward === true;
    // For compose type, default is protected (not mutable). For import type, default is mutable.
    // mutable: false on @import explicitly makes it protected.
    const isProtected = type === 'compose'
      ? !importOptions!.mutable // compose: protected unless mutable: true
      : importOptions!.mutable === false; // import: mutable unless explicitly mutable: false

    let Ruleset: RulesVisibility = 'public';
    let Declaration: RulesVisibility = 'public';
    let Mixin: RulesVisibility = 'public';
    let VarDeclaration: RulesVisibility = 'public';

    if (isProtected) {
      Ruleset = 'private';
    } else if (reference) {
      /**
       * Not sure if this is true.
       * They won't be output, but that's not the same as being optional,
       * UNLESS we're extending the word 'optional' to mean "not output".
       *
       * I think what we mean here by "optional" it "not ouptut unless extended".
       * Our test for reference therefore should mimic Less behavior.
       */
      Ruleset = 'optional';
    }

    /**
     * Create a rules wrapper so we can set visibility.
     * The inner rules may be static, but the import may
     * have different import settings.
     *
     * For compose type:
     * - Variables and mixins are visible to the direct parent (the file that imports them)
     * - If 'export' flag is set, variables and mixins are also forwarded to downstream stylesheets
     * - The 'local' flag means: visible to direct parent, but not re-exported to parent's parent
     */
    const isReferenceMode = (
      (type === 'import' && (importOptions?._dedupe === true || reference))
      || (type === 'compose' && reference)
    );
    // Import type: variables are visible and re-exported (not local)
    // Compose type: variables are visible to parent but not transitive by default (`local: true`)
    // Forward: not visible locally but *is* transitive (`local: false`)
    const isLocal = type === 'compose' && !isForward;
    const readonly = importOptions!.readonly ?? (type === 'compose' ? true : false);
    const canReuseEvaluatedRules = !isProtected && !isReferenceMode && !isLocal && !isForward && !readonly;
    if (canReuseEvaluatedRules) {
      this.adopt(evaluatedRules);
      return evaluatedRules;
    }
    // Derive an import-owned Rules wrapper. The children are shared with the
    // canonical tree/session result for this import placement; per-render
    // options (visibility, reference mode) are set on the wrapper below;
    // downstream serialization propagates `referenceMode` via PrintOptions,
    // so we don't need to mutate every child's `options.referenceMode`.
    let out = evaluatedRules.derive();
    const hasImportBoundary = (
      evaluatedRules.options.importBoundary === true
      || (isNode(evaluatedRules.sourceNode, N.Rules) && evaluatedRules.sourceNode.options.importBoundary === true)
    );
    out.options = {
      rulesVisibility: { Ruleset, Declaration, Mixin, VarDeclaration },
      local: isLocal,
      forward: isForward,
      importBoundary: hasImportBoundary,
      referenceMode: isReferenceMode,
      readonly
    };
    importPlacementOptionsStates.set(out, {
      referenceMode: isReferenceMode,
      rulesVisibility: out.options.rulesVisibility
    });
    out._hasReferenceImports = isReferenceMode || evaluatedRules._hasReferenceImports;
    // Forwarded modules should never render output at this scope.
    if (isForward) {
      out.removeFlag(F_VISIBLE);
    }
    this.adopt(out);
    return out;
  }

  /**
   * Defer import-path interpolation to evalNode so unresolved vars can be retried
   * after later imports/assignments in the same Rules scope have evaluated.
   */
  override prepareRegistration(_context: Context): MaybePromise<this> {
    return this;
  }

  private _preparePathIdentity(context: Context): MaybePromise<Node> {
    try {
      return this.path.eval(context);
    } catch (e) {
      // Tag path-resolution errors so the eval-queue retry policy can
      // distinguish "path interpolation not ready" (cheap, worth retrying)
      // from "import content evaluation failed" (expensive and not worth retrying).
      markPathResolutionError(e);
      throw e;
    }
  }

  /**
   * Import evaluation reuses the canonical source/evaluated rules whenever the
   * placement does not need different semantics. Placement-local behavior
   * belongs on a derived rules surface or explicit runtime state, not in a
   * routine deep clone of the imported body.
   */
  override evalNode(context: Context): MaybePromise<Rules> {
    let node = this;
    const { with: withValues } = node;
    const { options } = node;
    options.importOptions ??= {};
    const { type, importOptions } = options;
    const maybePath = this._preparePathIdentity(context);
    let originalDepth = context.depth;
    context.depth = this.depth;

    /**
     * @todo - Add options
     *
     * Note that the Less plugin should trigger a unique default behavior
     * for `@import` which is that it is de-duplicated by default. Meaning
     * that it won't render rulesets twice per compilation. I think that
     * means that it's just kind of ignored without an explicit `multiple`
     * option. Since all vars are global per compilation, it should just
     * work.
     */

    const finalize = async (finalPath: string, evaluatedPathNode: Quoted | Url) => {
      const previousTreeContext = context.treeContext;
      const resolvedFromFile = (node.sourceRoot?._treeContext ?? previousTreeContext)?.file;
      const resolvedFromPath = resolvedFromFile?.path;
      const resolvedFromFilePath = resolvedFromFile?.fullPath;
      // Inherit "reference branch" semantics lexically for nested imports unless
      // `multiple` explicitly opts into fresh output.
      const inheritedReferenceMode = context.inReferenceImportScope;
      const previousExplicitReference = importOptions!.reference;
      let pushedImportScope = false;
      if (inheritedReferenceMode && !importOptions!.multiple) {
        importOptions!.reference = true;
      }
      const nodeTreeContext = node.sourceRoot?._treeContext;
      if (nodeTreeContext) {
        context.treeContext = nodeTreeContext;
      }
      if (importOptions!.multiple || importOptions!.reference) {
        // Scope push/pop is intentionally paired in this method's try/finally.
        // This keeps branch semantics local to this import evaluation path.
        context.pushImportScope({
          multiple: importOptions!.multiple === true,
          reference: importOptions!.reference === true
        });
        pushedImportScope = true;
      }
      try {
        if (this.isPlainCssImport(finalPath)) {
          const importRule = this.createCssImportAtRule(evaluatedPathNode);
          queueTopImport(context, importRule);
          return this.deriveRulesSurface(this.getImportAnchorRules(context), [], { resetScopeFrame: true });
        }
        const isInlineImport = importOptions!.inline === true;
        let rules: Rules;
        let resolvedPath: string;
        if (isInlineImport) {
          const resolved = await context.resolveImportPath(finalPath);
          resolvedPath = resolved.resolvedPath;
          const sourceGetter = context.plugins.find(plugin => plugin.getSource);
          if (!sourceGetter) {
            throwMissingImportSourceGetter();
          }
          const source = await sourceGetter.getSource!(resolvedPath);
          const sourceNode = this.createInlineSourceNode(source, resolvedPath);
          const sourceRules = this.deriveRulesSurface(this.getImportAnchorRules(context), [sourceNode], { resetScopeFrame: true });
          rules = this.wrapRulesWithPostlude(sourceRules, importOptions!.postlude);
        } else {
          try {
            const loaded = await context.getTree(finalPath, importOptions);
            if (!loaded.node) {
              return this.deriveRulesSurface(this.getImportAnchorRules(context), [], { resetScopeFrame: true });
            }
            ({ node: rules, resolvedPath } = loaded);
          } catch (error) {
            if (importOptions!.optional) {
              return this.deriveRulesSurface(this.getImportAnchorRules(context), [], { resetScopeFrame: true });
            }
            if (importOptions!.reference && isParseError(error)) {
              return this.deriveRulesSurface(this.getImportAnchorRules(context), [], { resetScopeFrame: true });
            }
            throw error;
          }
        }
        // Mark import-boundary semantics on the Rules surface directly instead
        // of depending on source-node provenance walks.
        node.options.resolvedPath = resolvedPath;
        node.options.resolvedFromPath = resolvedFromPath;
        node.options.resolvedFromFilePath = resolvedFromFilePath;
        rules.options.importBoundary ??= this.options.type !== 'import';
        let evaldRules = context.evaldTrees.get(resolvedPath);
        if (type === 'import' && !evaldRules && !withValues) {
          // Plain imports still need an import-site-local Rules surface during
          // preparation/eval. Reusing the canonical source tree here lets the first
          // import site become the parent of later `multiple` / `reference`
          // imports, which leaks the wrong selector/context into repeated uses.
          rules = this.materializeImportPlacementState(
            this.createFirstUseImportPlacementState(rules),
            this.getImportAnchorRules(context)
          );
        }

        // Compose caching semantics:
        // - The first time a module is composed, we evaluate and cache the evaluated Rules.
        // - Subsequent compose imports reuse the cached evaluated Rules (so re-imports don't re-run evaluation).
        // - Subsequent compose imports default to "reference" mode unless `multiple: true` is set,
        //   so rulesets / at-rules are not output again.
        if (type === 'compose' && evaldRules) {
          // Sass-style: once configured, cannot be configured again.
          // (We keep parsing show/hide/prefix metadata elsewhere; this is for with/set configs.)
          this.throwIfConfiguredReuseIsDisallowed(withValues, true);
          // Reuse cached evaluated rules tree.
          rules = evaldRules;
          // Default: de-dupe output for compose re-imports unless explicitly multiple.
          if (!importOptions!.multiple) {
            importOptions!.reference = true;
          }
        }
        const inMultipleImportBranch = context.inMultipleImportScope;
        if (type === 'import' && importOptions!.once !== false && !importOptions!.multiple && !inMultipleImportBranch && evaldRules) {
          rules = evaldRules;
          importOptions!._dedupe = true;
        }

        if (withValues) {
          this.throwIfConfiguredReuseIsDisallowed(withValues, Boolean(evaldRules));
          const withRules = await this.resolveConfiguredRulesInput(context, withValues.node);
          rules = this.applyConfiguredValues(rules, withRules);
        }
        // For compose type, register and push extend root BEFORE evaluation
        // so extends inside the import use the correct root
        const parentExtendRoot = context.extendRoots.getCurrentExtendRoot();
        let pushedExtendRoot = false;
        if (type === 'compose') {
        // Register the Rules as an extend root (use rules before cloning/evaluation)
        // We'll update the registration after evaluation if the Rules changes
        // For compose type, default is protected (not mutable)
          const isComposeProtected = !importOptions!.mutable;
          context.extendRoots.registerRoot(rules, parentExtendRoot, {
            isProtected: isComposeProtected,
            isCompose: true,
            namespace: node.options.namespace
          });
          context.extendRoots.pushExtendRoot(rules);
          pushedExtendRoot = true;
        }

        try {
          /** Freshly evaluate the rules in these circumstances
         * - `with` (or `set`) values are present
         * - the rules have not been evaluated yet
         * - the import type is `import`
        */
          if (withValues || !evaldRules || type === 'import') {
            let pushedImplicitReferenceEvalScope = false;
            const isImplicitReferenceModeForEval = (
              type === 'import'
              && importOptions!.reference !== true
              && importOptions!._dedupe === true
              && !importOptions!.multiple
            );
            if (isImplicitReferenceModeForEval) {
              // Dedupe re-imports behave like an implicit reference traversal:
              // evaluate for symbol availability, but avoid outward extend side effects.
              context.pushImportScope({ reference: true });
              pushedImplicitReferenceEvalScope = true;
            }

            // For protected imports (mutable: false), push the rules to extend root stack
            // so rulesets register in the import's registry, not the parent's
            const isImportProtected = type === 'import' && importOptions!.mutable === false;
            const shouldUseLocalExtendRoot = isImportProtected || isImplicitReferenceModeForEval;
            if (isImplicitReferenceModeForEval) {
              // Link local in-eval root so external extends can still target deduped imports.
              context.extendRoots.registerRoot(rules, parentExtendRoot, {
                isProtected: isImportProtected,
                namespace: node.options.namespace
              });
            }
            if (shouldUseLocalExtendRoot) {
              context.extendRoots.pushExtendRoot(rules);
            }

            try {
              // Prepare registration first so any owned registration wrapper
              // keeps source identity from the import placement.
              const preparedRules = await rules.prepareRegistration(context);
              if (!(preparedRules instanceof Rules)) {
                throwInvalidImportedRulesRegistrationPrep();
              }
              rules = preparedRules;
              if (type === 'import') {
                /** Needed at evaluation time for older import type */
                node.adopt(rules);
              }
              rules = await rules.eval(context);
            } finally {
              if (pushedImplicitReferenceEvalScope) {
                context.popImportScope();
              }
              if (shouldUseLocalExtendRoot) {
                context.extendRoots.popExtendRoot();
              }
            }

            // Cache compose modules (and configured modules) after first evaluation.
            if (
              type === 'compose'
              || withValues?.type === 'set'
              || (type === 'import' && importOptions!.once !== false)
            ) {
              context.evaldTrees.set(resolvedPath, rules);
            }
          } else {
            // Compose cache hit: `rules` is already the cached canonical/session
            // result from `context.evaldTrees` (assigned at line 353). No clone
            // and no re-eval is needed — shape differences per compose scope are
            // handled by the shallow wrapper built in `getFinalRules` below,
            // which applies per-scope visibility/reference options without
            // mutating the shared cached tree.
          }
        } finally {
          if (pushedExtendRoot) {
            context.extendRoots.popExtendRoot();
          }
        }

        // NB: previously this block cleared `referenceMode` on both `rules`
        // and the finalRules wrapper when `evaluatedInImplicitReferenceMode`
        // was true. That was a workaround for the old `markReferenceMode`
        // eval-time walk, which tagged every descendant node individually.
        // With the walk gone, the wrapper's `options.referenceMode` is the
        // only reference-mode signal downstream renders will see, so
        // clearing it here defeats dedupe suppression entirely.
        let finalRules = node.getFinalRules(rules);
        if (importOptions!.postlude && !isInlineImport) {
          finalRules = this.wrapRulesWithPostlude(finalRules, importOptions!.postlude);
        }

        // For import type, register the final Rules as a child root of the parent
        // so extends from the parent can find rulesets in the imported Rules.
        // Do this after getFinalRules because it may return a placement-owned Rules.
        if (type === 'import') {
          const currentParentExtendRoot = context.extendRoots.getCurrentExtendRoot();
          // Import type is mutable by default (unless explicitly mutable: false)
          const isImportProtected = importOptions!.mutable === false;
          const isImplicitReferenceModeForRegistration = (
            importOptions!._dedupe === true
            && importOptions!.reference !== true
            && !importOptions!.multiple
          );
          const shouldReRegisterLocalRootRulesets = isImportProtected || isImplicitReferenceModeForRegistration;
          context.extendRoots.registerRoot(finalRules, currentParentExtendRoot, {
            isProtected: isImportProtected,
            namespace: node.options.namespace
          });

          // For imports that evaluated under a local extend root (protected import or implicit _dedupe
          // reference traversal), rulesets were registered against the pre-finalized Rules root. Since
          // getFinalRules can derive a placement wrapper; re-register all descendant rulesets
          // under finalRules' extend root set.
          if (shouldReRegisterLocalRootRulesets) {
            visitDescendantRulesets(finalRules.rules, ruleset => registerRulesetWithRoot(finalRules, ruleset));
          }
        // Don't push to stack - import type uses parent's root for extends inside the import
        // But we register it so extends from parent can find rulesets in the imported Rules
        }

        return finalRules;
      } finally {
        context.treeContext = previousTreeContext;
        if (pushedImportScope) {
          context.popImportScope();
        }
        importOptions!.reference = previousExplicitReference;
      }
    };
    if (isThenable(maybePath)) {
      return maybePath.then(async (p) => {
        const finalPath = String(p.valueOf());
        context.depth = originalDepth;
        return finalize(finalPath, this.toImportPathNode(p));
      });
    }
    const finalPath = String(maybePath.valueOf());
    context.depth = originalDepth;
    return finalize(finalPath, this.toImportPathNode(maybePath));
  }

  override resolve(context: Context): MaybePromise<Rules> {
    return this.evalNode(context);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const node = this.evalNode(context);
    return isThenable(node)
      ? node.then(resolved => isRenderBuffer(bufferOrOptions)
          ? resolved.render(context, bufferOrOptions, options)
          : resolved.render(context, bufferOrOptions))
      : isRenderBuffer(bufferOrOptions)
        ? node.render(context, bufferOrOptions, options)
        : node.render(context, bufferOrOptions);
  }

  private wrapRulesWithPostlude(rules: Rules, postlude?: Node): Rules {
    if (!postlude) {
      return rules;
    }
    const postludeNodes = this.getPostludeNodes(postlude);
    const anchorRules = rules;
    let wrappedRules: Rules = rules;
    const postludeNames: string[] = [];
    for (let i = postludeNodes.length - 1; i >= 0; i--) {
      const current = postludeNodes[i]!;
      if (isNode(current, N.Call)) {
        const callName = String(current.name).toLowerCase();
        if (callName === 'media' || callName === 'supports' || callName === 'layer') {
          const args = current.args?.value ?? [];
          const prelude = args.length <= 1 ? args[0] : current.args;
          if (prelude) {
            wrappedRules = this.wrapRulesInAtRuleSurface(anchorRules, wrappedRules, `@${callName}`, prelude);
            postludeNames.unshift(`@${callName}`);
            continue;
          }
        }
      }

      wrappedRules = this.wrapRulesInAtRuleSurface(anchorRules, wrappedRules, '@media', current);
      postludeNames.unshift('@media');
    }

    importPostludePlacementStates.set(wrappedRules, {
      sourceRules: rules,
      outputRules: wrappedRules,
      postludeNames,
      postludeNodes
    });
    return wrappedRules;
  }
}

defineType<StyleImportValue>(StyleImport, 'StyleImport', 'style');

export const style = (...args: ConstructorParameters<typeof StyleImport>) => {
  return new StyleImport(...args);
};
