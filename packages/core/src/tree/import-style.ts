import { sourceSpanOf } from './util/provenance.js';
import { basename, dirname, extname, join, relative } from 'node:path';
import { TreeContext, type Context } from '../context.js';
import type { ImportOptions } from '../import-options.js';
import { Node, F_NON_STATIC, F_VISIBLE, defineType, type NodeLocation, type LocationInfo } from './node.js';
import { type Reference } from './reference.js';
import { hasCarriedMergeOutputSurface, Rules, type RulesOptions, type RulesVisibility } from './rules.js';
import { type Quoted } from './quoted.js';
import { Interpolated } from './interpolated.js';
import { Url } from './url.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import type { Ruleset } from './ruleset.js';
import type { Collection } from './collection.js';
import { AtRule } from './at-rule.js';
import { AtRuleStatement } from './at-rule-statement.js';
import { Any } from './any.js';
import { declarationNameKey } from './declaration.js';
import { Sequence } from './sequence.js';
import { QueryCondition } from './query-condition.js';
import { registerRulesetWithRoot } from './util/extend-roots.js';
import { setScopeFrameLiveBinding, type BindingCell } from './scope-frame.js';
import {
  isRenderBuffer,
  type RenderBuffer
} from './util/render-buffer.js';
import { JessError, toDiagnostic, type ErrorDiagnostic } from '../jess-error.js';
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

/**
 * Normalize an import resolution/parse failure into an `ErrorDiagnostic`. Used on
 * the `breakOnError: false` path so a failed import is COLLECTED on
 * `context.errors` and folded to empty, mirroring `Context.getTree`'s own
 * breakOnError handling for parse errors — instead of hard-throwing out of render.
 */
function importFailureToDiagnostic(error: unknown, finalPath: string): ErrorDiagnostic {
  if (error instanceof JessError) {
    return toDiagnostic(error) as ErrorDiagnostic;
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: 'import/resolution-error',
    phase: 'parse',
    message,
    reason: message,
    fix: 'Check the import path and that the file exists / parses.',
    filePath: finalPath,
    line: 1,
    column: 1
  };
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
  return declarationNameKey(name);
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
  return { start: 0, end: source.length };
}

/**
 * This class is for Jess / Sass+ / Less-style imports,
 * not the CSS `@import` rule. The two will be distinguished
 * during parsing.
 *
 * @see https://sass-lang.com/documentation/at-rules/import/#plain-css-imports
 */

export interface LegacyImportOptions extends ImportOptions {
  /**
   * Optional import postlude captured by parsers for forms like:
   * `@import (inline) "x.css" layer(foo) supports(display: grid) screen;`
   *
   * For inline imports, this is applied as serializer wrappers around the inlined source.
   */
  postlude?: Node;
  [key: string]: unknown;
}

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
  importOptions?: LegacyImportOptions;

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
  childSegments: readonly ImportPlacementChildSegment[] | undefined;
};

export type ImportPlacementChildSegment = PlacementChildSegment;

/**
 * The result of driving a spine-foldable `StyleImport`'s resolution
 * (`resolveForSpine`, UNIFIED-EVAL-EMIT-DESIGN §2/§4.0 IMPORTS increment 1):
 *   - `css` — CSS-passthrough, already queued to `context.topImports`; emit nothing inline.
 *   - `fold` — a plain Less import whose parsed body (`body`) the spine descends inline.
 *     `resolvedPath` is the file the specifier resolved to — the dedup key (IMPORTS
 *     increment 4): a second import of the same `resolvedPath` under `once` (default)
 *     registers SCOPE but emits NO output. `multiple` is the authored opt-out that
 *     re-emits at every position (never deduped).
 */
export type SpineImportResolution =
  | { kind: 'css' }
  | { kind: 'fold'; body: Rules; resolvedPath: string | undefined; multiple: boolean; reference: boolean };

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

// A source child that a first-use import placement may OWN (clone) rather than
// share: a plain Declaration, or a Ruleset/Rules whose entire body is likewise
// ownable. Anything callable-bearing (Mixin, AtRule, nested StyleImport) stays
// shared so reference-import guard/param scope resolution is preserved.
function isPlacementScalarChild(node: Node): boolean {
  if (isNode(node, N.Declaration | N.VarDeclaration)) {
    return true;
  }
  if (isNode(node, N.Ruleset) && node instanceof Rules) {
    for (let i = 0; i < node.rules.length; i++) {
      if (!isPlacementScalarChild(node.rules[i]!)) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function isStaticPlacementScalarChild(node: Node): boolean {
  if (node.hasFlag(F_NON_STATIC)) {
    return false;
  }
  if (isNode(node, N.VarDeclaration)) {
    return false;
  }
  if (isNode(node, N.Declaration)) {
    return true;
  }
  if (node instanceof Rules) {
    for (let i = 0; i < node.rules.length; i++) {
      if (!isStaticPlacementScalarChild(node.rules[i]!)) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function hasPlacementTrivia(rules: Rules): boolean {
  const trivia = rules._treeContext?.opts?.trivia;
  return trivia !== undefined
    && (!trivia.entries('before').next().done || !trivia.entries('after').next().done);
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
  if (!state.childSegments) {
    return undefined;
  }
  // NOTE: a placement child may itself LOOK like a reusable leaf (a cloned
  // container whose only child was reused-as-leaf clears F_HAS_NODE_CHILD) yet
  // still map to a distinct source child. So resolve positionally through the
  // segments — a genuinely shared leaf resolves to itself via the value-path
  // walk (it is the same object in both source and placement).
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
  if (!state?.childSegments) {
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
    const sourceLocation = sourceSpanOf(anchorRules);
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
        if (hasCarriedMergeOutputSurface(childNode)) {
          wrapped.hasMergeOutputSurface = true;
        }
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
    const inlineRules = new Rules([node], undefined, undefined, treeContext);
    // Pin the inline source root so later `adopt` into an import-site surface
    // (whose treeContext is the importing file) cannot re-root the inline node's
    // provenance. Source-map segments read `sourceRoot._treeContext.file`, so the
    // inline node must keep resolving to the inlined file's tree context.
    node._sourceRoot = inlineRules;
    return node;
  }

  private createFirstUseImportPlacementState(sourceRules: Rules, retainPlacementState = true): ImportPlacementState {
    // Thin placement: the placement OWNS its child containers (a fresh
    // declaration/ruleset surface per placement) while REUSING inert scalar
    // leaves (shared by identity via `reuseAsLeaf`). The canonical source
    // children keep their imported-tree parent — `cloneForPlacement` never
    // reparents the source. Each segment records the ORIGINAL source child so
    // placement→source mapping (getImportPlacementSourceChild) still resolves,
    // and a reusable leaf placement child IS its own source. See
    // LIVE_BINDING_ARCHITECTURE.md §4.
    const children = new Array<Node>(sourceRules.rules.length);
    // `false` is only passed after the closed-static admission has already
    // proved every source child is placement-scalar. Keep the shallow child
    // array, but do not repeat that recursive check or allocate mapping state.
    const childSegments = retainPlacementState
      ? new Array<PlacementChildSegment>(sourceRules.rules.length)
      : undefined;
    for (let index = 0; index < sourceRules.rules.length; index++) {
      const source = sourceRules.rules[index]!;
      // Only pure scalar-declaration content is placement-owned (a fresh
      // declaration/ruleset surface reusing the scalar leaf). Callable-bearing
      // content (mixins with guards/params, at-rules, nested imports) MUST stay
      // shared: a reference-import's mixin guards resolve caller scope through
      // the shared source parent chain, which cloning would sever.
      const output = retainPlacementState
        ? isPlacementScalarChild(source)
          ? source.cloneForPlacement({ detachChildren: true })
          : source
        : source.cloneForPlacement({ detachChildren: true });
      children[index] = output;
      if (childSegments) {
        childSegments[index] = createPlacementChildSegment(source, output, index);
      }
    }
    return {
      source: sourceRules,
      children,
      childSegments
    };
  }

  private materializeImportPlacementState(
    state: ImportPlacementState,
    importSite: Rules,
    retainPlacementState = true
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
    // Thin surface identity is intrinsic: `placement.sourceNode` already points
    // at the canonical imported tree (preserveSourceNode above), so the
    // scope-frame parent-walk re-points the shared children up the import-site
    // chain with no marker. See LIVE_BINDING_ARCHITECTURE.md §4 / §6.2.
    if (retainPlacementState) {
      importPlacementStates.set(placement, state);
    }
    return placement;
  }

  private getPostludeNodes(postlude?: Node): Node[] {
    if (!postlude) {
      return [];
    }
    // A `QueryCondition` is a SINGLE media query (`screen and (max-width: 600px)`),
    // even though it is structurally a `Sequence` of keyword/paren terms. It must
    // stay whole so it wraps the imported rules in ONE `@media <full query>` rather
    // than one nested `@media` per term (`@media screen { @media and { … } }`).
    if (postlude instanceof QueryCondition) {
      return [postlude];
    }
    if (isNode(postlude, N.List)) {
      return postlude.value;
    }
    return isNode(postlude, N.Sequence) ? postlude.value : [postlude];
  }

  private wrapRulesInAtRuleSurface(anchorRules: Rules, rules: Rules, name: string, prelude: Node): Rules {
    const wrappedAtRule = new AtRule({
      name,
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

    // Only a `set` (replacement) config may not be applied more than once.
    // `with` is additive and re-applying it (e.g. a re-eval of the same import)
    // is allowed.
    if (withValues.type === 'set') {
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
    importedRules.hasMergeOutputSurface = false;
    for (let index = 0; index < sourceRules.rules.length; index++) {
      const originalNode = sourceRules.rules[index]!;
      const nextNode = replacementsByIndex.get(index) ?? originalNode;
      importedRules.adopt(nextNode);
      importedRules.rules.push(nextNode);
      if (hasCarriedMergeOutputSurface(nextNode)) {
        importedRules.hasMergeOutputSurface = true;
      }
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
      if (hasCarriedMergeOutputSurface(newNode)) {
        finalRules.hasMergeOutputSurface = true;
      }
    }
    // The imported module surface holds the composed-in members (mixins, rulesets,
    // decls). Nested as a child of the boundary result surface, its public callables
    // were previously reached only via the `directChildRuleEntries` descent
    // (`findMixinsFastForUncoveredCallable`). Mark it as inlining its members to the
    // parent so `linkInlineImportFallbackFrames` (run when the frame is built below)
    // chains it as `finalRules`'s fallback frame — unifying it with the plain/`@import`
    // inline model so the callable lookup resolves imported (guarded) mixins on the
    // frame fallback chain and retires that descent. It must be adopted BEFORE the
    // frame is built so the inline-import link is wired. Members stay behind the outer
    // `importBoundary`.
    importedRules.options.inlinesMembersToParent = true;
    finalRules.adopt(importedRules);
    finalRules.rules.push(importedRules);
    this.attachConfiguredVarBindings(finalRules, additiveVariableNodes);
    if (hasCarriedMergeOutputSurface(importedRules)) {
      finalRules.hasMergeOutputSurface = true;
    }
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
    // Build the target frame through the normal getter so it carries the
    // assignment-binding chain (prepareScopeFrameAssignmentBindings surfaces any
    // additive child rulesets' public property decls) and inline-import fallbacks,
    // then overlay the config vars as live slots on that prepared frame. Injecting
    // in place keeps `configuredProp`/`setConfiguredProp`-style non-variable decls
    // resolvable via the same assignment chain variables use — no bare frame rebuild
    // that would drop them.
    const frame = targetRules.scopeFrame;
    for (const node of variableNodes) {
      if (!isNode(node, N.VarDeclaration)) {
        continue;
      }
      const name = variableNameKey(node);
      if (!name) {
        continue;
      }
      setScopeFrameLiveBinding(frame, name, {
        value: node.value instanceof Node ? node.value : undefined,
        sourceNode: node,
        readonly: node.options?.readonly
      } satisfies BindingCell);
    }
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

    const location = sourceSpanOf(this);
    // @import has no block body — it is a semicolon at-rule statement.
    return new AtRuleStatement({
      name: '@import',
      prelude
    }, undefined, location);
  }

  /**
   * STATIC (eval-free) spine-fold admissibility for the single-pass import fold
   * (cutover IMPORTS increment 1, UNIFIED-EVAL-EMIT-DESIGN §2/§4.0). Decides —
   * from the source node alone, no path resolution, no eval — whether this import
   * is one of the two shapes the spine folds:
   *
   *   - CSS-PASSTHROUGH (`@import url(...)`, a static `.css`/remote specifier): the
   *     spine reuses the KEPT `queueTopImport` → top-of-doc emitter (nearly free),
   *   - plain Less `@import "x.less"` (`type: 'import'`, static Quoted path, `once`
   *     default): the spine `getTree`s the parsed body and descends it inline.
   *
   * DEFERRED (each stays a REQUIRED P4 item — a false here keeps the import on the
   * eval path, byte-identical): `reference`, interpolated path, `inline`,
   * `multiple`/dedupe, `optional`, `postlude`/`with`, `@-compose`/`forward`. The
   * runtime body-simplicity gate is applied by the caller (`isSpineEligibleBody`
   * on the resolved Less body); a non-simple body falls back to eval there.
   */
  isSpineFoldableStyleImport(): boolean {
    if (this.options.type !== 'import') {
      return false;
    }
    if (this.with) {
      return false;
    }
    const io = this.options.importOptions;
    if (io) {
      // Foldable so far: `multiple`/`once:false` (inc 4), `reference` (inc 5),
      // `optional` + `postlude` (inc 6), `inline` (inc 7 — the imported file's RAW
      // source text is emitted verbatim via an `Any` node; no parse, no scope, no
      // descent). Still deferred (each a REQUIRED P4 item): `mutable`
      // (protected/extend-reach), `forward`, `with`.
      if (
        io.mutable === true
        || io.mutable === false
        || io.forward === true
      ) {
        return false;
      }
    }
    // A static Quoted specifier is the plain foldable Less path shape. An INTERPOLATED
    // path (`@import "theme-@{t}.less"`, a `Quoted` whose value is an Interpolated node)
    // is now SPECULATIVELY foldable (import-spec routing): the two sub-cases are not
    // separable statically, so the STATIC gate admits both and the pre-emit wire pass
    // decides by ATTEMPTING resolution against the live frame —
    //   (A) DOWNWARD-RESOLVABLE — the interpolation var is bound EARLIER in document
    //       order (`@t: dark; @import "theme-@{t}.less"`). `resolveForSpine`'s path eval
    //       resolves it against the root frame (populated at wire time), so it FOLDS.
    //   (B) FORWARD-DEPENDENT — the var is bound by a LATER sibling/import
    //       (`import-interpolation.less`). Path eval throws `_isPathResolutionError`;
    //       the wire pass catches it and ABORTS to eval, where the `_isPathResolutionError`
    //       RETRY lane reorders + resolves it. Byte-identical (eval owns the retry).
    // The abort is CLEAN because the wire pass runs BEFORE the first byte (the Tier-A
    // pre-emit boundary) — the old "surfaces mid-wire where the spine is committed"
    // constraint no longer holds. Tier-B (a strictly-downward spine retry) stays
    // DEFERRED: case B is sequenced to eval, not folded.
    if (this.path instanceof Url) {
      return true;
    }
    if (!isNode(this.path, N.Quoted)) {
      return false;
    }
    const quoted = this.path as Quoted;
    if (quoted.options?.escaped) {
      return false;
    }
    // A plain STRING value is the original foldable static path shape. A genuinely INTERPOLATED value
    // (an `Interpolated` node, `theme-@{t}.less`) is admitted SPECULATIVELY — the wire pass resolves it
    // against the live frame (case A folds; case B throws `_isPathResolutionError` → abort). Any OTHER
    // non-string value (e.g. a Quoted wrapping a bare `Any`) is NOT an interpolation and stays UNFOLDABLE,
    // exactly as before (the old `typeof value === 'string'` discriminator) — so no static-path shape's
    // routing changes.
    return typeof quoted.value === 'string' || quoted.value instanceof Interpolated;
  }

  /**
   * Drive a spine-foldable import's resolution ONCE (the import analogue of
   * `resolveSpineMixinCall`, UNIFIED-EVAL-EMIT-DESIGN §2/§4.0). Caller has
   * confirmed `isSpineFoldableStyleImport`.
   *
   *   - `{ kind: 'css' }` — CSS-passthrough: this method has ALREADY queued the
   *     `@import` at-rule to `context.topImports` (the KEPT top-of-doc emitter);
   *     the caller emits nothing inline.
   *   - `{ kind: 'fold', body }` — a plain Less import: `body` is the parsed
   *     imported tree wrapped in an import-site placement surface (a value-frame
   *     whose lexical parent is the import site — free vars resolve up the import
   *     chain). The caller descends `body`'s children INLINE through the spine,
   *     REPLACING the eval terminal's `rules.eval()` + splice. `derive` is NOT
   *     called (ratchet: import folds via the Compiler with `Rules.derive` = 0).
   *
   * No eval of the imported body happens here — that is the whole point of the
   * fold (§2): the parsed body is descended, resolving each leaf against the live
   * placement frame at its emit moment.
   */
  resolveForSpine(context: Context): MaybePromise<SpineImportResolution> {
    const maybePath = this._preparePathIdentity(context);
    const finish = (pathNode: Node): MaybePromise<SpineImportResolution> => {
      const finalPath = String(pathNode.valueOf());
      const evaluatedPathNode = this.toImportPathNode(pathNode);
      if (this.isPlainCssImport(finalPath)) {
        queueTopImport(context, this.createCssImportAtRule(evaluatedPathNode));
        return { kind: 'css' };
      }
      return this._foldLessImportForSpine(context, finalPath);
    };
    return isThenable(maybePath) ? maybePath.then(finish) : finish(maybePath);
  }

  private isClosedLiteralMultipleImport(path: string): boolean {
    const io = this.options.importOptions;
    if (
      this.options.type !== 'import'
      || this.with !== undefined
      || io?.multiple !== true
      || !isNode(this.path, N.Quoted)
    ) {
      return false;
    }
    for (const key in io) {
      if (key !== 'multiple' && (key !== 'once' || io.once !== false)) {
        return false;
      }
    }
    const quoted = this.path as Quoted;
    return quoted.options?.escaped !== true
      && typeof quoted.value === 'string'
      && quoted.value === path;
  }

  private canDiscardSpinePlacementState(context: Context, sourceRules: Rules, importSite: Rules): boolean {
    const path = isNode(this.path, N.Quoted) && typeof (this.path as Quoted).value === 'string'
      ? (this.path as Quoted).value
      : undefined;
    if (
      path === undefined
      || !this.isClosedLiteralMultipleImport(path)
      || importSite !== context.root
    ) {
      return false;
    }
    if (context.opts.output?.sourceMap === true || hasPlacementTrivia(sourceRules) || !isStaticPlacementScalarChild(sourceRules)) {
      return false;
    }
    for (let i = 0; i < context.root.rules.length; i++) {
      const node = context.root.rules[i]!;
      if (!(node instanceof StyleImport) || !node.isClosedLiteralMultipleImport(path)) {
        return false;
      }
    }
    return true;
  }

  private async _foldLessImportForSpine(context: Context, finalPath: string): Promise<SpineImportResolution> {
    const io = this.options.importOptions ?? {};
    // Bracket `context.treeContext` around `getTree` exactly as `evalNode`'s
    // `finalize` does: a relative import path (`one/two/2`) resolves against the
    // IMPORTING file's treeContext, so it must be set to this import's own source
    // treeContext for the resolution and RESTORED after. Without this bracketing,
    // resolving several imports in sequence (the spine pre-registration pass) leaves
    // a deeply-nested import's treeContext in place, so the NEXT sibling import
    // resolves against the wrong directory (an empty/failed tree → dropped output).
    const previousTreeContext = context.treeContext;
    const nodeTreeContext = this.sourceRoot?._treeContext;
    if (nodeTreeContext) {
      context.treeContext = nodeTreeContext;
    }
    // `multiple` OR `once: false` both opt out of `once` dedup (always re-emit).
    const multiple = io.multiple === true || io.once === false;
    // `(reference)` suppresses OUTPUT (scope + extend still run) — increment 5.
    const reference = io.reference === true;
    // An empty-surface resolution (unsupported/optional-missing) — no output, no scope.
    const emptyFold = (resolvedPath: string | undefined): SpineImportResolution => ({
      kind: 'fold',
      body: this.deriveRulesSurface(this.getImportAnchorRules(context), [], { resetScopeFrame: true }),
      resolvedPath,
      multiple,
      reference
    });
    try {
      // `(inline)` (increment 7): emit the imported file's RAW source text verbatim.
      // NO parse, NO scope, NO descent — build the same inline-source placement the
      // eval path does (an `Any` node holding the raw bytes, wrapped in a `Rules` with
      // the inlined file's own `TreeContext` for source-map provenance). The spine
      // descends this `Any` leaf, which writes its text unchanged. `(optional) inline`
      // still swallows a missing file; a postlude wraps the inlined text.
      if (io.inline === true) {
        try {
          const resolved = await context.resolveImportPath(finalPath);
          const sourceGetter = context.plugins.find(plugin => plugin.getSource);
          if (!sourceGetter) {
            throwMissingImportSourceGetter();
          }
          const source = await sourceGetter.getSource!(resolved.resolvedPath);
          const sourceNode = this.createInlineSourceNode(source, resolved.resolvedPath);
          let placement = this.deriveRulesSurface(this.getImportAnchorRules(context), [sourceNode], { resetScopeFrame: true });
          if (io.postlude !== undefined) {
            placement = this.wrapRulesWithPostlude(placement, io.postlude);
          }
          return { kind: 'fold', body: placement, resolvedPath: resolved.resolvedPath, multiple, reference };
        } catch (error) {
          if (io.optional === true) {
            return emptyFold(undefined);
          }
          throw error;
        }
      }
      let loaded: Awaited<ReturnType<Context['getTree']>>;
      try {
        loaded = await context.getTree(finalPath, io);
      } catch (error) {
        // `(optional)` swallows a resolution/parse failure and folds to empty
        // (increment 6, mirrors `evalNode`'s optional catch).
        if (io.optional === true) {
          return emptyFold(undefined);
        }
        // `breakOnError: false` — mirror `Context.getTree`'s parse-error handling:
        // COLLECT the failure on `context.errors` and fold to empty, rather than
        // hard-throwing out of the whole render. `_getPath` throws unconditionally
        // on an unresolvable path (before `getTree`'s own breakOnError guard runs),
        // so a resolution failure would otherwise escape even under breakOnError:false.
        if (context.opts.breakOnError === false) {
          context.errors.push(importFailureToDiagnostic(error, finalPath));
          return emptyFold(undefined);
        }
        throw error;
      }
      if (!loaded.node) {
        // Nothing to emit (unsupported/empty) — mirror the eval path's empty surface.
        return emptyFold(loaded.resolvedPath);
      }
      const importSite = this.getImportAnchorRules(context);
      const retainPlacementState = !this.canDiscardSpinePlacementState(context, loaded.node, importSite);
      // Build the import-site placement over the parsed (un-evaled) imported body:
      // shares the canonical children, frame parent = the import site so a free var
      // resolves up the import chain (reuses `materializeImportPlacementState`'s
      // wiring). The spine descends these children resolving each leaf live.
      let placement = this.materializeImportPlacementState(
        this.createFirstUseImportPlacementState(loaded.node, retainPlacementState),
        importSite,
        retainPlacementState
      );
      // A `(reference)` placement carries `referenceMode` (mirrors `getFinalRules`):
      // the descent SUPPRESSES its output while registration + extend-reach still run.
      if (reference) {
        placement.options.referenceMode = true;
        placement._hasReferenceImports = true;
      }
      // A POSTLUDE (`@import "x" (min-width: …)` / `layer(…)` / `supports(…)`) wraps
      // the folded body in the corresponding at-rule surface(s) — increment 6, reuses
      // the eval path's `wrapRulesWithPostlude`. The wrapper is a plain at-rule the
      // spine descends normally (its own hoist/compose). The wrap is applied AFTER
      // reference marking so a `(reference)` postlude import stays suppressed.
      if (io.postlude !== undefined) {
        placement = this.wrapRulesWithPostlude(placement, io.postlude);
      }
      // `resolvedPath` is the dedup key (increment 4): the wire pass emits the
      // FIRST occurrence and scope-onlys the rest of the same path (under `once`).
      return { kind: 'fold', body: placement, resolvedPath: loaded.resolvedPath, multiple, reference };
    } finally {
      context.treeContext = previousTreeContext;
    }
  }

  constructor(value: StyleImportValue, options?: StyleImportOptions, location?: NodeLocation) {
    super(value, options, location);
    this.path = value.path;
    this.with = value.with;
    this.withNode = value.with?.node;
    // Style imports are always non-static
    this.addFlags(F_NON_STATIC);
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
      // A plain `@import` or a wildcard `@compose (namespace: *)` dumps its members
      // into the enclosing scope (linked as a fallback frame there). A named/plain
      // compose keeps its members behind its namespace. A `@forward` re-exports
      // downstream but is NOT visible in the forwarder's OWN local scope, so it
      // never inlines its members here (see the forward comment above).
      inlinesMembersToParent: !isForward
        && (this.options.type === 'import' || this.options.namespace === '*'),
      referenceMode: isReferenceMode,
      readonly
    };
    // A boundary wrapper IS the import boundary: its members belong to itself, so
    // the boundary is tracked on this surface's own options — not inherited from
    // upstream source provenance. Re-point sourceNode to self so boundary checks
    // (and declaration ownership) read from this wrapper, not the imported tree.
    if (hasImportBoundary) {
      out.sourceNode = out;
    }
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
        // A plain `@import` or a wildcard `@compose (namespace: *)` inlines its
        // members into the enclosing scope (the enclosing frame links this as a
        // fallback). A named/plain compose keeps its members behind its namespace.
        rules.options.inlinesMembersToParent
          ??= this.options.type === 'import' || this.options.namespace === '*';
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
          // A configured (`with`/`set`) compose is a distinct instance whose child
          // surface is re-derived and re-emitted below, so it is never a dedup re-import.
          if (!importOptions!.multiple && !withValues) {
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
  // Canonical factory parents one level (invariant 7); raw `new StyleImport` shares.
  return new StyleImport(...args).parentChildren();
};
