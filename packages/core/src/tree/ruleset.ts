import { Node, F_STATIC, F_VISIBLE, F_AMPERSAND, F_EXTENDED, F_EXTEND_TARGET, F_IMPLICIT_AMPERSAND, defineType, type LocationInfo, type NodeOptions } from './node.js';
import { Rules } from './rules.js';
import type { Context } from '../context.js';
import { createPublicNil, Nil } from './nil.js';
import { Bool } from './bool.js';
import { Condition } from './condition.js';
import { attachSelectorBitLibrary, Selector } from './selector.js';
import { isNode } from './util/is-node.js';
import { isCombinator } from './util/combinator.js';
import { N } from './node-type.js';
import { Combinator } from './combinator.js';
import { ComplexSelector, type ComplexSelectorComponent } from './selector-complex.js';
import {
  CompoundSelector,
  isStringCompoundSelectorComponent,
  type CompoundSelectorComponent
} from './selector-compound.js';
import { SimpleSelector } from './selector-simple.js';
import { BasicSelector } from './selector-basic.js';
import { SelectorList, type SelectorListItem } from './selector-list.js';
import { selectorListItemForMatch } from './util/selector-match-core.js';
import { PseudoSelector } from './selector-pseudo.js';
import { Ampersand } from './ampersand.js';
import {
  type PrintOptions,
  type FinalPrintOptions,
  OutputWriter,
  getPrintOptions,
  prepareRenderPrintState,
  savePrintState,
  restorePrintState,
  getCachedComposedSelector,
  setCachedComposedSelector
} from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import type { AtRule } from './at-rule.js';
import { AtRuleStatement } from './at-rule-statement.js';
import { serializeRulesContainer, normalizeIndent, normalizeLeadingBlockTrivia, indent } from './util/serialize-helper.js';
import { isRenderBuffer, prepareBufferPrintState, writeRenderText, type RenderBuffer } from './util/render-buffer.js';
import { registerRulesetWithRoot } from './util/extend-roots.js';
import { createTriviaMap } from './util/trivia.js';
import { copyOwnedWithReusableLeaves, copyWithReusableLeavesPreservingComments } from './util/cloning.js';
import { canRenderStaticRulesDirectly } from './util/static-rules.js';
import { callableGuardContainsDefault } from './util/callable-entry.js';
import {
  isScannerNativeRawRelativeSelector,
  isScannerNativeRawSimpleSelector,
  readScannerNativeNestedAmpersandPseudoSelector
} from './util/raw-selector.js';

export type RulesetValue = {
  selector: string | Selector | Nil;
  /**
   * It's important that any Node that defines a Rules
   * sets it to the `rules` property. This allows us to
   * generalize nodes for the `frames` property in Context
   */
  rules: Node[];
  guard?: string | Condition | Nil;
  /**
   * When this ruleset is extended, we store its selector before the first extend.
   * Nested rulesets' implicit & (selectorContainer → parent value) use this when set, so they
   * do not "see" the extended form (EXTEND_RULES §5: do not materialize ampersands
   * that were not matched and extended).
   */
  selectorBeforeExtend?: Selector | Nil;
};

type RawComplexSelectorPart = string | ' ' | '>' | '+' | '~';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function copySelectorForRulesetMetadata(selector: Selector | string): Selector | string {
  // A bare-string selector (strings-not-nodes model) is immutable — return as-is.
  if (typeof selector === 'string') {
    return selector;
  }
  const copied = copyOwnedWithReusableLeaves(selector);
  if (isRulesetSelectorMetadata(copied)) {
    return copied;
  }
  throw new TypeError('Expected selector metadata copy to remain selector-like');
}

function isRulesetSelectorMetadata(value: unknown): value is Selector {
  return value instanceof Selector
    || (
      !!value
      && typeof value === 'object'
      && (value as { isSelector?: unknown }).isSelector === true
    );
}

function canMaterializeRawSimpleSelector(value: string): boolean {
  return isScannerNativeRawSimpleSelector(value);
}

function readRawAttributeSelector(value: string, start: number): { text: string; end: number } | undefined {
  if (value[start] !== '[') {
    return undefined;
  }
  let quoteCode = 0;
  for (let i = start + 1; i < value.length; i++) {
    const char = value[i]!;
    if (quoteCode !== 0) {
      if (char === '\\') {
        i++;
        continue;
      }
      if (char.charCodeAt(0) === quoteCode) {
        quoteCode = 0;
      }
      continue;
    }
    const charCode = char.charCodeAt(0);
    if (charCode === 34 || charCode === 39) {
      quoteCode = charCode;
      continue;
    }
    if (char === ']') {
      const text = value.slice(start, i + 1);
      return isScannerNativeRawSimpleSelector(text) ? { text, end: i + 1 } : undefined;
    }
    if (char === '\r' || char === '\n') {
      return undefined;
    }
  }
  return undefined;
}

function isRawSelectorIdentifierStart(char: string | undefined): boolean {
  return char !== undefined && /[-_a-zA-Z]/u.test(char);
}

function isRawSelectorIdentifierPart(char: string | undefined): boolean {
  return char !== undefined && /[\w-]/u.test(char);
}

function readRawSelectorIdentifier(value: string, start: number): number {
  if (!isRawSelectorIdentifierStart(value[start])) {
    return start;
  }
  let end = start + 1;
  while (isRawSelectorIdentifierPart(value[end])) {
    end++;
  }
  return end;
}

function readRawPseudoSelectorName(value: string, start: number): number {
  const first = value[start];
  const nameStart = first === '-' ? start + 1 : start;
  if (!/[_a-zA-Z]/u.test(value[nameStart] ?? '')) {
    return start;
  }
  let end = nameStart + 1;
  while (isRawSelectorIdentifierPart(value[end])) {
    end++;
  }
  return end;
}

function readRawCompoundSelectorPart(value: string, start: number): { text: string; end: number } | undefined {
  const first = value[start];
  if (first === '[') {
    return readRawAttributeSelector(value, start);
  }
  if (first === '*') {
    return { text: '*', end: start + 1 };
  }
  if (first === '.' || first === '#') {
    const end = readRawSelectorIdentifier(value, start + 1);
    return end > start + 1 ? { text: value.slice(start, end), end } : undefined;
  }
  if (first === ':') {
    const nameStart = value[start + 1] === ':' ? start + 2 : start + 1;
    const end = readRawPseudoSelectorName(value, nameStart);
    return end > nameStart ? { text: value.slice(start, end), end } : undefined;
  }
  const end = readRawSelectorIdentifier(value, start);
  return end > start ? { text: value.slice(start, end), end } : undefined;
}

function splitRawCompoundSelector(value: string): string[] | undefined {
  const parts: string[] = [];
  let offset = 0;
  while (offset < value.length) {
    const part = readRawCompoundSelectorPart(value, offset);
    if (!part) {
      return undefined;
    }
    const text = part.text;
    if (text === '*' && parts.length > 0) {
      return undefined;
    }
    if (
      !text.startsWith('.')
      && !text.startsWith('#')
      && !text.startsWith('[')
      && !text.startsWith(':')
      && text !== '*'
      && parts.length > 0
    ) {
      return undefined;
    }
    parts.push(text);
    offset = part.end;
  }
  return parts.length > 0 && offset === value.length ? parts : undefined;
}

function readRawAmpersandPseudoSelector(value: string): string | undefined {
  return readScannerNativeNestedAmpersandPseudoSelector(value);
}

function splitRawSelectorList(value: string): string[] | undefined {
  const selectors: string[] = [];
  let branchStart = 0;
  let quoteCode = 0;
  let bracketDepth = 0;
  let sawComma = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!;
    if (quoteCode !== 0) {
      if (char === '\\') {
        i++;
        continue;
      }
      if (char.charCodeAt(0) === quoteCode) {
        quoteCode = 0;
      }
      continue;
    }
    const charCode = char.charCodeAt(0);
    if (charCode === 34 || charCode === 39) {
      quoteCode = charCode;
      continue;
    }
    if (char === '[') {
      bracketDepth++;
      continue;
    }
    if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
    if (char !== ',' || bracketDepth !== 0) {
      continue;
    }
    sawComma = true;
    const selector = value.slice(branchStart, i).trim();
    if (!pushRawSelectorListBranch(selector, selectors)) {
      return undefined;
    }
    branchStart = i + 1;
  }
  if (!sawComma || quoteCode !== 0 || bracketDepth !== 0) {
    return undefined;
  }
  const finalSelector = value.slice(branchStart).trim();
  if (!pushRawSelectorListBranch(finalSelector, selectors)) {
    return undefined;
  }
  return selectors.length > 1 ? selectors : undefined;
}

function pushRawSelectorListBranch(selector: string, selectors: string[]): boolean {
  if (
    selector.length === 0
    || (
      !isMaterializableRawSelectorBranch(selector)
      && splitRawComplexSelector(selector) === undefined
    )
  ) {
    return false;
  }
  selectors.push(selector);
  return true;
}

function isRawSelectorBranchBoundary(value: string, offset: number): boolean {
  const char = value[offset];
  return char === undefined || /[ \t>+~]/u.test(char);
}

function readRawSelectorBranch(value: string, start: number): { text: string; end: number } | undefined {
  let end = start;
  while (end < value.length) {
    const attr = readRawAttributeSelector(value, end);
    if (attr) {
      end = attr.end;
      continue;
    }
    if (isRawSelectorBranchBoundary(value, end)) {
      break;
    }
    end++;
  }
  if (end === start) {
    return undefined;
  }
  const text = value.slice(start, end);
  return isMaterializableRawSelectorBranch(text) ? { text, end } : undefined;
}

function isMaterializableRawSelectorBranch(value: string): boolean {
  return (
    canMaterializeRawSimpleSelector(value)
    || splitRawCompoundSelector(value) !== undefined
  );
}

function splitRawComplexSelector(value: string): RawComplexSelectorPart[] | undefined {
  if (value.trim() !== value || !/[ \t>+~]/u.test(value) || /[\r\n]/u.test(value)) {
    return undefined;
  }
  const parts: RawComplexSelectorPart[] = [];
  let offset = 0;
  let selectorCount = 0;
  while (offset < value.length) {
    while (/[ \t]/u.test(value[offset] ?? '')) {
      offset++;
    }
    const branch = readRawSelectorBranch(value, offset);
    if (!branch) {
      return undefined;
    }
    parts.push(branch.text);
    selectorCount++;
    offset = branch.end;
    let whitespace = 0;
    while (/[ \t]/u.test(value[offset] ?? '')) {
      offset++;
      whitespace++;
    }
    if (offset >= value.length) {
      break;
    }
    const combinator = value[offset];
    if (combinator === '>' || combinator === '+' || combinator === '~') {
      parts.push(combinator);
      offset++;
      continue;
    }
    if (whitespace === 0) {
      return undefined;
    }
    parts.push(' ');
  }
  return selectorCount > 1 ? parts : undefined;
}

function splitRawRelativeSelector(value: string): RawComplexSelectorPart[] | undefined {
  if (!isScannerNativeRawRelativeSelector(value) || /[\r\n]/u.test(value)) {
    return undefined;
  }
  let offset = 0;
  while (/[ \t]/u.test(value[offset] ?? '')) {
    offset++;
  }
  const combinator = value[offset];
  if (combinator !== '>' && combinator !== '+' && combinator !== '~') {
    return undefined;
  }
  const tail = value.slice(offset + 1).trimStart();
  const tailParts = splitRawComplexSelector(tail);
  const firstBranch = tailParts ?? (isMaterializableRawSelectorBranch(tail) ? [tail] : undefined);
  return firstBranch ? [combinator, ...firstBranch] : undefined;
}

function markStaticSelector<T extends Selector>(selector: T): T {
  selector.addFlag(F_STATIC);
  return selector;
}

function createRawSelectorBranchNode(
  value: string,
  location: LocationInfo | undefined,
  treeContext: Context['treeContext'] | undefined
): SimpleSelector | CompoundSelector | undefined {
  const pseudoName = readRawAmpersandPseudoSelector(value);
  if (pseudoName) {
    const compound = new CompoundSelector([
      new Ampersand(undefined, undefined, location, treeContext),
      new PseudoSelector({ name: pseudoName }, undefined, location, treeContext)
    ], undefined, location, treeContext);
    compound.generated = true;
    return markStaticSelector(compound);
  }
  const parts = splitRawCompoundSelector(value);
  if (!parts) {
    return undefined;
  }
  const compound = new CompoundSelector(parts, undefined, location, treeContext);
  compound.generated = true;
  return markStaticSelector(compound);
}

function createRawSelectorNode(
  value: string,
  location: LocationInfo | undefined,
  treeContext: Context['treeContext'] | undefined
): Selector | undefined {
  const selectorList = splitRawSelectorList(value);
  if (selectorList) {
    const branches: Selector[] = [];
    for (const branch of selectorList) {
      const surface = createRawSelectorNode(branch, location, treeContext)
        ?? createRawSelectorBranchNode(branch, location, treeContext);
      if (!surface) {
        return undefined;
      }
      branches.push(surface);
    }
    const list = new SelectorList(branches, undefined, location, treeContext);
    list.generated = true;
    // Canonical materialization parents its branches (invariant 7).
    list.parentChildren();
    return markStaticSelector(list);
  }
  const relativeParts = splitRawRelativeSelector(value);
  if (relativeParts) {
    return createRawComplexSelectorSurface(relativeParts, location, treeContext);
  }
  const complexParts = splitRawComplexSelector(value);
  if (complexParts) {
    return createRawComplexSelectorSurface(complexParts, location, treeContext);
  }
  const compoundParts = splitRawCompoundSelector(value);
  if (compoundParts && compoundParts.length > 1) {
    const compound = new CompoundSelector(compoundParts, undefined, location, treeContext);
    compound.generated = true;
    compound.parentChildren();
    return markStaticSelector(compound);
  }
  return undefined;
}

function createRawComplexSelectorSurface(
  parts: RawComplexSelectorPart[],
  location: LocationInfo | undefined,
  treeContext: Context['treeContext'] | undefined
): ComplexSelector | undefined {
  const components: ComplexSelectorComponent[] = [];
  for (const part of parts) {
    if (part === ' ' || part === '>' || part === '+' || part === '~') {
      components.push(Combinator.create(part));
      continue;
    }
    const branch = createRawSelectorNode(part, location, treeContext);
    const component = branch ?? createRawSelectorBranchNode(part, location, treeContext);
    if (!component) {
      return undefined;
    }
    components.push(component as ComplexSelectorComponent);
  }
  const complex = new ComplexSelector(components, undefined, location, treeContext);
  complex.generated = true;
  complex.parentChildren();
  return markStaticSelector(complex);
}

type RulesetOptions = NodeOptions & {
  parentSelector?: Selector | Nil;
  /** Own selector before parent resolution (getImplicitSelector); used by extend so nested rulesets extend .replace,.c not the resolved form. */
  ownSelector?: Selector | Nil;
  hasDefault?: boolean;
};

/**
 * A qualified rule. This is historically called a "Ruleset"
 * by older CSS documentation and by Less.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Syntax#css_rulesets
 *
 * @example
 * .box {
 *   color: black;
 * }
 */
export class Ruleset extends Rules<RulesetValue, RulesetOptions> {
  static override childKeys = ['selector', 'rules', 'guard', 'selectorBeforeExtend'] as const;
  override allowRuleRoot = true;
  override allowRoot = true;
  // Ruleset owns registration prep and marks `registrationPrepared` directly.
  frames: (Ruleset | AtRule)[] | undefined;
  selector: RulesetValue['selector'] | undefined;
  declare readonly rules: Node[];
  guard: RulesetValue['guard'];
  selectorBeforeExtend: RulesetValue['selectorBeforeExtend'];
  /** Legacy canonical composed selector slot still used by extend post-processing. */
  declare _composedSelector?: Selector;
  /** Canonical selector-cache owner for derived registration-prep wrappers. */
  declare _selectorCacheOwner?: Ruleset;

  constructor(
    value: RulesetValue,
    options?: RulesetOptions,
    location?: LocationInfo,
    treeContext?: Context['treeContext']
  ) {
    if (
      options?.hasDefault === undefined
      && 'guard' in value
      && value.guard instanceof Node
      && callableGuardContainsDefault(value.guard)
    ) {
      options = { ...options, hasDefault: true };
    }
    super(value.rules, options, location, treeContext);
    // Invariant 7: store, don't adopt. `parentChildren()` (factory) parents.
    if (typeof value.selector === 'string') {
      // The parser is the authority on selector syntax; the runtime stores
      // whatever string it produced (materializing to nodes lazily when needed).
      this.selector = value.selector.trim();
      this.guard = 'guard' in value ? value.guard : undefined;
      this.selectorBeforeExtend = 'selectorBeforeExtend' in value ? value.selectorBeforeExtend : undefined;
    } else {
      this.selector = value.selector;
      this.guard = value.guard;
      this.selectorBeforeExtend = value.selectorBeforeExtend;
    }
    // R2 SINGLE-FRAME: the Ruleset IS its own canonical body. Body children are
    // parented to the Ruleset by the `ruleset()` factory's parentChildren
    // (childKeys includes 'rules'); the Ruleset's own scope frame is the single
    // body-decl frame. (Formerly a factory-passed `rules([...])` wrapper was
    // recorded as `_passedRulesWrapper` and the children re-parented to it — a
    // DUPLICATE body frame the parser path never created, splitting placement
    // scope from body decls. Eliminated, mirroring the Mixin.sourceNode removal.)
  }

  /**
   * §2.7 copy-on-write surface for Ruleset. Construct an EMPTY Ruleset (no
   * selector node passed, so the constructor adopts nothing), then SHARE the
   * canonical selector/guard by direct assignment — never re-adopt, so the
   * shared nodes keep their canonical parent. Children + sourceNode are wired by
   * the base `derive`.
   */
  protected override _deriveShell(sourceLocation: LocationInfo | undefined): Rules {
    const shell = new Ruleset(
      { selector: '', rules: [] },
      this.options ? { ...this.options } : undefined,
      sourceLocation,
      this.sourceRoot?._treeContext
    );
    shell.selector = this.selector;
    shell.guard = this.guard;
    shell.selectorBeforeExtend = this.selectorBeforeExtend;
    return shell;
  }

  private ownSelector(value: RulesetValue['selector']): RulesetValue['selector'] {
    if (value instanceof Nil) {
      return value;
    }
    if (!(value instanceof Selector)) {
      return value;
    }
    const owned = copyOwnedWithReusableLeaves(value);
    if (owned instanceof Selector) {
      return owned;
    }
    throw new TypeError('Expected ruleset selector copy');
  }

  private ownRules(value: RulesetValue['rules']): Node[] {
    const owned = new Array<Node>(value.length);
    for (let i = 0; i < value.length; i++) {
      const copied = copyOwnedWithReusableLeaves(value[i]!);
      if (!(copied instanceof Node)) {
        throw new TypeError('Expected ruleset rule copy to remain a node');
      }
      owned[i] = copied;
    }
    return owned;
  }

  private attachSelectorBits(selector: RulesetValue['selector'], selectorBits: Context['selectorBits']): void {
    if (selector instanceof Nil) {
      return;
    }
    if (!(selector instanceof Selector)) {
      return;
    }
    this.attachSelectorBitsToNode(selector, selectorBits);
  }

  private attachSelectorBitsToNode(node: Node, selectorBits: Context['selectorBits']): void {
    if (node instanceof Selector) {
      node.keySetLibrary ??= selectorBits;
      const { sourceNode } = node;
      if (sourceNode !== node && sourceNode instanceof Selector) {
        this.attachSelectorBitsToNode(sourceNode, selectorBits);
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    this.attachSelectorBitsToValue('value' in node ? (node as unknown as { value: unknown }).value : undefined, selectorBits);
  }

  private attachSelectorBitsToValue(value: unknown, selectorBits: Context['selectorBits']): void {
    if (value instanceof Node) {
      this.attachSelectorBitsToNode(value, selectorBits);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        this.attachSelectorBitsToValue(item, selectorBits);
      }
      return;
    }
    if (isRecord(value)) {
      for (const key in value) {
        this.attachSelectorBitsToValue(value[key], selectorBits);
      }
    }
  }

  private materializeRawSelectorForSemantics(): Selector | Nil {
    const selector = this.selector;
    if (selector instanceof Selector || selector instanceof Nil) {
      return selector;
    }
    if (typeof selector === 'string') {
      const rawSelector = selector.trim();
      const materialized = createRawSelectorNode(
        rawSelector,
        this.location.length ? this.location : undefined,
        this.sourceRoot?._treeContext
      ) ?? this.materializeRawSelectorBranch(rawSelector);
      this.adopt(materialized);
      this.selector = materialized;
      return materialized;
    }
    throw new TypeError('Ruleset requires a selector before semantic materialization.');
  }

  private materializeRawSelectorBranch(rawSelector: string): SimpleSelector | CompoundSelector {
    const pseudoName = readRawAmpersandPseudoSelector(rawSelector);
    if (pseudoName) {
      return new CompoundSelector([
        new Ampersand(undefined, undefined, this.location.length ? this.location : undefined, this.sourceRoot?._treeContext),
        new PseudoSelector({ name: pseudoName }, undefined, this.location.length ? this.location : undefined, this.sourceRoot?._treeContext)
      ], undefined, this.location.length ? this.location : undefined, this.sourceRoot?._treeContext);
    }
    const parts = splitRawCompoundSelector(rawSelector);
    if (!parts || parts.length < 1) {
      // Not a recognized compound (e.g. a keyframe selector like `0%`): hold it
      // verbatim as a basic selector rather than rejecting parser output.
      return markStaticSelector(new BasicSelector(
        rawSelector,
        undefined,
        this.location.length ? this.location : undefined,
        this.sourceRoot?._treeContext
      ));
    }
    return new CompoundSelector(parts, undefined, this.location.length ? this.location : undefined, this.sourceRoot?._treeContext);
  }

  private withParts(
    parts: RulesetValue,
    sourceParts: RulesetValue = {
      selector: this.selector!,
      rules: this.rules,
      ...(this.guard !== undefined && { guard: this.guard }),
      ...(this.selectorBeforeExtend !== undefined && {
        selectorBeforeExtend: this.selectorBeforeExtend
      })
    },
    options: { ownRules?: boolean } = {}
  ): Ruleset {
    const node = new Ruleset(
      {
        selector: parts.selector === sourceParts.selector ? this.ownSelector(parts.selector) : parts.selector,
        rules: options.ownRules && parts.rules === sourceParts.rules ? this.ownRules(parts.rules) : parts.rules,
        ...(parts.guard !== undefined && { guard: parts.guard }),
        ...(parts.selectorBeforeExtend !== undefined && {
          selectorBeforeExtend: parts.selectorBeforeExtend
        })
      },
      this._options ? { ...this._options } : undefined,
      this.location.length ? this.location : undefined,
      this.sourceRoot?._treeContext
    ).inherit(this);
    node.hoistToRoot = this.hoistToRoot;
    node.frames = this.frames ? [...this.frames] : undefined;
    return node;
  }

  override clone(cloneFn?: (n: Node) => Node): this {
    const clonePart = <T extends Node | string | undefined>(part: T): T => (
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- cloneFn preserves the concrete selector/guard field type supplied by this ruleset part.
      cloneFn && part instanceof Node ? cloneFn(part) as T : part
    );
    const rules = cloneFn
      ? this.rules.map(rule => cloneFn(rule))
      : [...this.rules];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return new Ruleset(
      {
        selector: clonePart(this.selector) ?? this.selector!,
        rules,
        ...(this.guard !== undefined && { guard: clonePart(this.guard) }),
        ...(this.selectorBeforeExtend !== undefined && {
          selectorBeforeExtend: clonePart(this.selectorBeforeExtend)
        })
      },
      this._options ? { ...this._options } : undefined,
      this.location.length ? this.location : undefined,
      this.sourceRoot?._treeContext
    ).inherit(this) as this;
  }

  /**
   * Compose a child selector with its parent selector, resolving `&`.
   *
   * Two cases:
   * - **Child contains `&`** (explicit): recursively substitutes every `&`
   *   with `parent`, wrapping `parent` in `:is()` only at positions where a
   *   raw substitution would change combinator precedence, break a tight
   *   compound, or require distributing across a list.
   * - **Child has no `&`** (implicit): prepends `parent` to `child` via a
   *   descendant combinator. A `SelectorList` parent is wrapped in `:is()`
   *   to avoid distribution; simple/compound/complex parents splice inline.
   */
  static composeSelector(child: Selector, parent: Selector): Selector {
    // String-backed selectors (scanner-native simple selectors) compose
    // textually: substitute `&` with the parent, or prepend the parent via a
    // descendant combinator. Returned as a string so the flattened ruleset keeps
    // a string selector.
    if (typeof child === 'string' || typeof parent === 'string') {
      const childStr = typeof child === 'string' ? child : child.toString();
      const parentStr = typeof parent === 'string' ? parent : parent.toString();
      const composed = childStr.includes('&')
        ? childStr.replace(/&/g, parentStr)
        : `${parentStr} ${childStr}`;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return composed as unknown as Selector;
    }
    const library = child.keySetLibrary ?? parent.keySetLibrary;
    // Child is a parent-replacement: its `&` has already been fully resolved
    // against the parent context (e.g. `.a, .b { &-1 { ... } }` →
    // `.a-1, .b-1`). The selector already contains the parent; composing
    // further would re-prepend it. Signaled by `hoistToRoot` on the selector,
    // set by `Ampersand.evalNode` when substituting a bare `&` or `&-X`.
    if (child.hoistToRoot === true) {
      return attachSelectorBitLibrary(child, library);
    }
    // Child is a SelectorList: compose each item independently. Each item
    // carries its own explicit-vs-implicit & semantics.
    if (isNode(child, N.SelectorList)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const items = (child as SelectorList).value as Selector[];
      const out: Selector[] = [];
      for (const item of items) {
        const composed = Ruleset.composeSelector(item, parent);
        // A bare-& item substituted with a list parent comes back as a list:
        // flatten its items into the outer result.
        if (isNode(composed, N.SelectorList)) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          out.push(...((composed as SelectorList).value as Selector[]));
        } else {
          out.push(composed);
        }
      }
      if (out.length === 1) {
        return attachSelectorBitLibrary(out[0]!, library);
      }
      return attachSelectorBitLibrary(SelectorList.create(out).inherit(child), library);
    }

    const childHasAmp = child.hasFlag(F_AMPERSAND)
      || (child.sourceNode ?? child).hasFlag(F_AMPERSAND);

    if (childHasAmp) {
      return attachSelectorBitLibrary(Ruleset._substituteAmpersand(child, parent), library);
    }

    // Implicit descendant compose: `parent child`.
    return attachSelectorBitLibrary(Ruleset._prependParent(parent, child), library);
  }

  private static _toComplexComponent(selector: Selector): ComplexSelectorComponent {
    if (
      selector instanceof SimpleSelector
      || isNode(selector, N.CompoundSelector)
      || isCombinator(selector)
      || isNode(selector, N.Ampersand)
    ) {
      return selector;
    }
    return Ruleset._wrapIs(selector);
  }

  private static _ownComplexComponentForCompose(component: ComplexSelectorComponent): ComplexSelectorComponent {
    if (typeof component === 'string') {
      return component;
    }
    const owned = copyOwnedWithReusableLeaves(component);
    if (
      owned instanceof SimpleSelector
      || isNode(owned, N.CompoundSelector)
      || isCombinator(owned)
      || isNode(owned, N.Ampersand)
    ) {
      return owned;
    }
    throw new TypeError('Expected selector component copy');
  }

  private static _toSimpleSelector(selector: Selector): SimpleSelector {
    if (selector instanceof SimpleSelector || isNode(selector, N.Ampersand)) {
      return selector;
    }
    return Ruleset._wrapIs(selector);
  }

  private static _prependParent(parent: Selector, child: Selector): Selector {
    const library = child.keySetLibrary ?? parent.keySetLibrary;
    const leading: ComplexSelectorComponent[] = isNode(parent, N.ComplexSelector)
      ? parent.value.map(component => Ruleset._ownComplexComponentForCompose(component))
      : isNode(parent, N.SelectorList)
        ? [Ruleset._wrapIs(parent)]
        : [Ruleset._ownComplexComponentForCompose(Ruleset._toComplexComponent(parent))];

    const trailing: ComplexSelectorComponent[] = isNode(child, N.ComplexSelector)
      ? child.value.map(component => Ruleset._ownComplexComponentForCompose(component))
      : [Ruleset._ownComplexComponentForCompose(Ruleset._toComplexComponent(child))];

    const childStartsWithCombinator = trailing.length > 0 && isCombinator(trailing[0]!);
    const merged = childStartsWithCombinator
      ? [...leading, ...trailing]
      : [...leading, Combinator.create(' '), ...trailing];

    return attachSelectorBitLibrary(ComplexSelector.create(merged).inherit(child), library);
  }

  /**
   * Recursively substitute every `&` in `child` with `parent`. Assumes
   * `child` contains at least one `&`. Does not mutate `child` or `parent`.
   *
   * `insideComplex` signals that `child` is a component of an enclosing
   * ComplexSelector. In that case a compound with leading `&` cannot be
   * smart-spliced into a complex parent, because the surrounding
   * combinators in the outer complex would misattach to the wrong end of
   * the parent chain.
   */
  private static _substituteAmpersand(child: Selector, parent: Selector, insideComplex = false): Selector {
    const library = child.keySetLibrary ?? parent.keySetLibrary;
    // Bare `&` — substitute raw. `&` is in "whole position": no wrapping.
    if (isNode(child, N.Ampersand)) {
      return attachSelectorBitLibrary(parent, library);
    }

    // SelectorList — delegate back to composeSelector so per-item semantics apply.
    if (isNode(child, N.SelectorList)) {
      return Ruleset.composeSelector(child, parent);
    }

    if (isNode(child, N.CompoundSelector)) {
      return attachSelectorBitLibrary(
        Ruleset._substituteAmpInCompound(child, parent, insideComplex),
        library
      );
    }

    if (isNode(child, N.ComplexSelector)) {
      return attachSelectorBitLibrary(Ruleset._substituteAmpInComplex(child, parent), library);
    }

    if (isNode(child, N.PseudoSelector)) {
      return attachSelectorBitLibrary(Ruleset._substituteAmpInPseudo(child, parent), library);
    }

    return attachSelectorBitLibrary(child, library);
  }

  private static _substituteAmpInCompound(compound: CompoundSelector, parent: Selector, insideComplex = false): Selector {
    const library = compound.keySetLibrary ?? parent.keySetLibrary;
    const components = compound.value;

    // Count direct `&` components and find the position of the first one.
    let ampCount = 0;
    let firstAmpIdx = -1;
    for (let i = 0; i < components.length; i++) {
      if (isNode(components[i]!, N.Ampersand)) {
        ampCount++;
        if (firstAmpIdx === -1) {
          firstAmpIdx = i;
        }
      }
    }

    // Smart splice candidate: exactly one `&`, at the leading position, and
    // the compound is not itself a component of an enclosing complex where
    // splicing would misattach surrounding combinators.
    const canSmartSplice = ampCount === 1 && firstAmpIdx === 0 && !insideComplex;

    if (canSmartSplice) {
      const suffix = components.slice(1);
      // Simple / Compound parent — splice directly into the compound.
      if (!isNode(parent, N.ComplexSelector) && !isNode(parent, N.SelectorList)) {
        const parentComponents: CompoundSelectorComponent[] = isNode(parent, N.CompoundSelector)
          ? parent.value
          : [Ruleset._toSimpleSelector(parent)];
        const merged = [...parentComponents, ...suffix];
        if (merged.length === 1) {
          const single = merged[0]!;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          return attachSelectorBitLibrary(single instanceof Selector ? single : single as unknown as Selector, library);
        }
        return attachSelectorBitLibrary(CompoundSelector.create(merged).inherit(compound), library);
      }
      // ComplexSelector parent — attach the suffix to the parent's last
      // non-combinator part, returning a new complex.
      if (isNode(parent, N.ComplexSelector)) {
        const parentParts = parent.value.slice();
        let lastIdx = -1;
        for (let i = parentParts.length - 1; i >= 0; i--) {
          if (!isCombinator(parentParts[i]!)) {
            lastIdx = i;
            break;
          }
        }
        if (lastIdx !== -1 && suffix.length > 0) {
          const lastPart = parentParts[lastIdx]!;
          const existing: CompoundSelectorComponent[] = isNode(lastPart, N.CompoundSelector)
            ? lastPart.value
            : typeof lastPart !== 'string' ? [Ruleset._toSimpleSelector(lastPart)] : [lastPart];
          const merged = [...existing, ...suffix];
          const mergedSingle = merged[0]!;
          parentParts[lastIdx] = merged.length === 1
            ? (typeof mergedSingle !== 'string' ? Ruleset._toComplexComponent(mergedSingle) : mergedSingle)
            : CompoundSelector.create(merged);
        }
        return attachSelectorBitLibrary(ComplexSelector.create(parentParts).inherit(compound), library);
      }
      // SelectorList parent falls through to the general path below.
    }

    // General path: walk components, substituting each `&` in place.
    // Simple/Compound parents splice; Complex/List parents wrap in `:is()`.
    const newComponents: CompoundSelectorComponent[] = [];
    for (const comp of components) {
      if (isNode(comp, N.Ampersand)) {
        if (isNode(parent, N.ComplexSelector) || isNode(parent, N.SelectorList)) {
          newComponents.push(Ruleset._wrapIs(parent));
        } else if (isNode(parent, N.CompoundSelector)) {
          newComponents.push(...parent.value);
        } else {
          newComponents.push(Ruleset._toSimpleSelector(parent));
        }
      } else if (!isStringCompoundSelectorComponent(comp) && comp.hasFlag(F_AMPERSAND)) {
        // `&` is nested deeper (e.g. inside a pseudo arg).
        const sub = Ruleset._substituteAmpersand(comp, parent);
        if (isNode(sub, N.CompoundSelector)) {
          newComponents.push(...sub.value);
        } else {
          newComponents.push(Ruleset._toSimpleSelector(sub));
        }
      } else {
        newComponents.push(comp);
      }
    }
    if (newComponents.length === 1) {
      const single = newComponents[0]!;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return attachSelectorBitLibrary(single instanceof Selector ? single : single as unknown as Selector, library);
    }
    return attachSelectorBitLibrary(CompoundSelector.create(newComponents).inherit(compound), library);
  }

  private static _substituteAmpInComplex(complex: ComplexSelector, parent: Selector): Selector {
    const library = complex.keySetLibrary ?? parent.keySetLibrary;
    const parts = complex.value;
    const newParts: ComplexSelectorComponent[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (typeof part === 'string') {
        continue;
      }
      if (isNode(part, N.Ampersand)) {
        const leftTight = Ruleset._isTightCombinatorAt(parts, i - 1);
        const rightTight = Ruleset._isTightCombinatorAt(parts, i + 1);
        if (isNode(parent, N.SelectorList)) {
          // Lists can't be distributed; wrap in `:is()`.
          newParts.push(Ruleset._wrapIs(parent));
        } else if (isNode(parent, N.ComplexSelector)) {
          if (leftTight || rightTight) {
            // Splicing would attach a tight combinator to the wrong end of
            // the parent chain; wrap in `:is()` to preserve meaning.
            newParts.push(Ruleset._wrapIs(parent));
          } else {
            newParts.push(...parent.value);
          }
        } else {
          // Simple or Compound parent: single-component insertion, always safe.
          newParts.push(Ruleset._toComplexComponent(parent));
        }
      } else if (!isCombinator(part) && part.hasFlag(F_AMPERSAND)) {
        const rightTight = Ruleset._isTightCombinatorAt(parts, i + 1);
        const allowSmartSpliceInPlace = i === 0 && !rightTight;
        const sub = Ruleset._substituteAmpersand(
          part,
          parent,
          !allowSmartSpliceInPlace
        );
        if (isNode(sub, N.ComplexSelector)) {
          // Flatten a complex sub into this complex's components.
          newParts.push(...sub.value);
        } else {
          newParts.push(Ruleset._toComplexComponent(sub));
        }
      } else {
        newParts.push(part);
      }
    }
    return attachSelectorBitLibrary(ComplexSelector.create(newParts).inherit(complex), library);
  }

  private static _substituteAmpInPseudo(pseudo: PseudoSelector, parent: Selector): Selector {
    const library = pseudo.keySetLibrary ?? parent.keySetLibrary;
    const { arg } = pseudo;
    if (arg && !isNode(arg, N.Selector)) {
      return attachSelectorBitLibrary(pseudo, library);
    }
    if (!arg) {
      return attachSelectorBitLibrary(pseudo, library);
    }
    // Pseudo arg is a full selector slot, so its content is effectively in
    // "whole position" w.r.t. the enclosing pseudo. Recurse without any
    // extra wrapping at the arg boundary.
    const newArg = Ruleset._substituteAmpersand(arg, parent);
    const newPseudo = PseudoSelector.create({
      name: pseudo.name,
      arg: newArg
    });
    if (pseudo.generated) {
      newPseudo.generated = true;
    }
    return attachSelectorBitLibrary(newPseudo.inherit(pseudo), library);
  }

  private static _isTightCombinatorAt(parts: ComplexSelectorComponent[], idx: number): boolean {
    if (idx < 0 || idx >= parts.length) {
      return false;
    }
    const c = parts[idx];
    if (!c || !isCombinator(c)) {
      return false;
    }
    const v = String((c as Combinator).valueOf() ?? '');
    return v.trim().length > 0;
  }

  private static _wrapIs(selector: Selector): PseudoSelector {
    const library = selector.keySetLibrary;
    const is = PseudoSelector.create({ name: ':is', arg: selector });
    is.generated = true;
    return attachSelectorBitLibrary(is, library);
  }

  isHoisted(options: PrintOptions) {
    return this.hoistToRoot ?? options.collapseNesting ?? false;
  }

  protected _valueOf: string | undefined;

  /** Used for equality comparison with other rulesets */
  override valueOf() {
    if (this._valueOf !== undefined) {
      return this._valueOf;
    }
    const selector = this.selector;
    if (selector === undefined) {
      this._valueOf = '';
      return this._valueOf;
    }
    if (typeof selector === 'string') {
      this._valueOf = selector;
      return this._valueOf;
    }
    if (selector instanceof Nil) {
      this._valueOf = '';
      return this._valueOf;
    }
    this._valueOf = (selector as Selector).valueOf();
    return this._valueOf;
  }

  /**
   * Invalidate cached selector-based string value.
   *
   * `Ruleset.valueOf()` is used by serialization frame tracking; when an extend
   * mutates `selector`, we must clear this cache so frame/header caching
   * reflects the updated selector.
   */
  invalidateSelectorValueCache(nextSelector?: Selector | Nil): void {
    this._valueOf = undefined;
    this._composedSelector = undefined;
    if (nextSelector === undefined) {
      const sel = this.selector;
      nextSelector = typeof sel === 'string' ? undefined : sel;
    }

    const cacheOwner = this._selectorCacheOwner;
    if (!cacheOwner || cacheOwner === this) {
      return;
    }

    cacheOwner._composedSelector = undefined;
    if (nextSelector instanceof Nil) {
      cacheOwner._valueOf = '';
      return;
    }
    if (nextSelector) {
      cacheOwner._valueOf = nextSelector.valueOf();
      return;
    }
    cacheOwner._valueOf = undefined;
  }

  override toTrimmedString(options?: PrintOptions): string {
    const opts = getPrintOptions(options);
    const w = opts.writer!;
    const position = w.position();
    this.writeSyntax(opts);
    return w.getSince(position);
  }

  override writeSyntax(options: FinalPrintOptions): void {
    if (
      options.referenceMode === true
      && options.referenceRenderEnabled !== false
      && this.hoistToRoot
    ) {
      const ownSelector = (this.options as RulesetOptions | undefined)?.ownSelector;
      if (ownSelector && Ruleset.isBareAmpersandSelector(ownSelector)) {
        return;
      }
    }
    serializeRulesContainer(this, options);
  }

  private canSourceRenderStaticRule(rule: Node, context: Context): boolean {
    if (isNode(rule, N.Comment) || isNode(rule, N.Nil)) {
      return true;
    }
    if (rule instanceof AtRuleStatement && rule.hasFlag(F_STATIC)) {
      return true;
    }
    if (isNode(rule, N.Declaration) && rule.hasFlag(F_STATIC)) {
      return true;
    }
    if (isNode(rule, N.VarDeclaration) && rule.hasFlag(F_STATIC) && !rule.visible) {
      return true;
    }
    if (!isNode(rule, N.AtRule)) {
      return false;
    }
    if (!rule.hasFlag(F_STATIC)) {
      return false;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const atRule = rule as AtRule;
    if (atRule.getRenderRules().length === 0) {
      return true;
    }
    return !context.opts.output?.collapseNesting
      && !context.bubbleRootAtRules
      && atRule.isRootOnly();
  }

  private canRenderSourceDirectly(context: Context): boolean {
    if (this.registrationPrepared || this.guard) {
      return false;
    }
    const { selector } = this;
    if (typeof selector === 'string') {
      return !this.guard
        && !this.registrationPrepared
        && this.hasFlag(F_STATIC)
        && canRenderStaticRulesDirectly(this);
    }
    if (selector === undefined) {
      return false;
    }
    if (selector instanceof Nil || !selector.hasFlag(F_STATIC) || !this.hasFlag(F_STATIC)) {
      return false;
    }
    for (let i = 0; i < this.rules.length; i++) {
      if (!this.canSourceRenderStaticRule(this.rules[i]!, context)) {
        return false;
      }
    }
    return true;
  }

  private evalNilSelectorBodyForRender(context: Context): MaybePromise<Rules | Nil> {
    return this.createNilSelectorOutputRules().eval(context);
  }

  private canRenderNilSelectorBodyDirectly(): boolean {
    return !this.guard
      && !this.registrationPrepared
      && canRenderStaticRulesDirectly(this);
  }

  private createNilSelectorOutputRules(): Rules {
    // The passed `_passedRulesWrapper` is gone (the Ruleset IS its own body); the
    // nil-selector output copies the body children (as the parser path always did —
    // parser-built nil-selector rulesets never had a wrapper). Copying keeps the
    // canonical source tree unmutated: rendering the output surface adopts its
    // children, so sharing would reparent the source nodes mid-render.
    const copiedBody = new Array<Node>(this.rules.length);
    for (let i = 0; i < this.rules.length; i++) {
      const copied = copyWithReusableLeavesPreservingComments(this.rules[i]!);
      if (!(copied instanceof Node)) {
        throw new TypeError('Expected nil-selector body child copy to remain a Node');
      }
      copiedBody[i] = copied;
    }
    return new Rules(
      copiedBody,
      {
        ...this.options,
        rulesVisibility: {
          Ruleset: 'public',
          Declaration: 'public',
          VarDeclaration: 'public',
          Mixin: 'public'
        }
      },
      this.location.length ? this.location : undefined,
      this.sourceRoot?._treeContext
    ).inherit(this);
  }

  private evalNilSelectorForRender(context: Context): MaybePromise<Rules | Nil> {
    if (this.canRenderNilSelectorBodyDirectly()) {
      return this.createNilSelectorOutputRules();
    }
    const { guard } = this;
    if (!guard) {
      return this.evalNilSelectorBodyForRender(context);
    }
    if (guard instanceof Nil) {
      return guard;
    }
    if (guard instanceof Condition) {
      const guardPasses = guard.evaluateBoolean(context);
      return isThenable(guardPasses)
        ? (guardPasses as Promise<boolean>).then(passes => passes ? this.evalNilSelectorBodyForRender(context) : new Nil())
        : guardPasses ? this.evalNilSelectorBodyForRender(context) : new Nil();
    }
    if (typeof guard === 'string') {
      throw new TypeError('String guard must be materialized before nil-selector render evaluation');
    }
    const ownedGuard = copyOwnedWithReusableLeaves(guard);
    if (!(ownedGuard instanceof Node)) {
      throw new TypeError('Expected nil-selector render guard copy to remain a Node');
    }
    const finishGuard = (guardResult: Node): MaybePromise<Rules | Nil> => {
      const guardPasses = Boolean(guardResult instanceof Bool && guardResult.value === true);
      return guardPasses ? this.evalNilSelectorBodyForRender(context) : new Nil();
    };
    const guardResult = ownedGuard.eval(context);
    return isThenable(guardResult)
      ? guardResult.then(finishGuard)
      : finishGuard(guardResult);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const finishNilSelectorBodyRender = (rendered: string): string => {
      if (rendered.endsWith('\n')) {
        return rendered;
      }
      if (isRenderBuffer(bufferOrOptions)) {
        writeRenderText(bufferOrOptions, '\n');
      }
      return `${rendered}\n`;
    };
    const renderNilSelectorBodyDirectly = (): MaybePromise<string> => {
      const output = this.createNilSelectorOutputRules();
      const rendered = isRenderBuffer(bufferOrOptions)
        ? output.render(context, bufferOrOptions, options)
        : output.render(context, bufferOrOptions);
      return isThenable(rendered)
        ? rendered.then(finishNilSelectorBodyRender)
        : finishNilSelectorBodyRender(rendered);
    };
    const renderEvaluatedRuleset = (node: Ruleset) => {
      if (isRenderBuffer(bufferOrOptions)) {
        return writeRenderText(
          bufferOrOptions,
          serializeRulesContainer(node, prepareBufferPrintState(context, options))
        );
      }
      return serializeRulesContainer(node, prepareRenderPrintState(context, bufferOrOptions));
    };
    const renderEvaluated = (node: Node) => {
      if (node instanceof Nil) {
        return '';
      }
      if (node instanceof Ruleset) {
        return renderEvaluatedRuleset(node);
      }
      const rendered = isRenderBuffer(bufferOrOptions)
        ? node.render(context, bufferOrOptions, options)
        : node.render(context, bufferOrOptions);
      // A Nil-selector ruleset renders its body directly. The body Rules is
      // rendered as a nested fragment (sourceWasRoot=false → trailing newline
      // trimmed), so re-apply the nil-body newline finish — matching the
      // canRenderNilSelectorBodyDirectly() fast path above.
      if (this.selector instanceof Nil) {
        return isThenable(rendered)
          ? rendered.then(finishNilSelectorBodyRender)
          : finishNilSelectorBodyRender(rendered);
      }
      return rendered;
    };
    if (
      this.selector instanceof Nil
      && this.canRenderNilSelectorBodyDirectly()
    ) {
      return renderNilSelectorBodyDirectly();
    }
    const evalForRender = (): MaybePromise<Node> => {
      if (this.canRenderSourceDirectly(context)) {
        return this;
      }
      if (
        this.selector instanceof Nil
        && !this.registrationPrepared
      ) {
        return this.evalNilSelectorForRender(context);
      }
      return this.registrationPrepared
        ? this.eval(context)
        : this.evalPrepared(context, { ownRules: true });
    };
    const node = evalForRender();
    return isThenable(node)
      ? node.then(renderEvaluated)
      : renderEvaluated(node);
  }

  override resolve(context: Context): MaybePromise<Node> {
    if (this.registrationPrepared) {
      return this.eval(context);
    }
    return this.evalPrepared(context, { ownRules: true });
  }

  private evalPrepared(context: Context, options: { ownRules?: boolean } = {}): MaybePromise<Node> {
    const node = this.registrationPrepared
      ? this
      : this._prepareRulesetRegistration(context, options);
    return isThenable(node)
      ? node.then(prepared => prepared.evalNode(context))
      : node.evalNode(context);
  }

  /**
   * Make authored selector nodes printable while keeping implicit ampersands
   * invisible so nested output stays short.
   */
  private static ensureSelectorVisible(sel: string | Selector | Nil): void {
    if (typeof sel === 'string') {
      return;
    }
    if (!sel || sel instanceof Nil) {
      return;
    }
    if (isNode(sel, N.Ampersand) && sel.hasFlag(F_IMPLICIT_AMPERSAND)) {
      return;
    }
    if (!sel.hasFlag(F_VISIBLE)) {
      sel.addFlag(F_VISIBLE);
    }
    if (isNode(sel, N.SelectorList)) {
      for (const item of sel.value) {
        Ruleset.ensureSelectorVisible(item);
      }
      return;
    }
    if (isNode(sel, N.ComplexSelector)) {
      for (const c of sel.value) {
        if (typeof c === 'string') {
          continue;
        }
        Ruleset.ensureSelectorVisible(c);
      }
      return;
    }
    if (isNode(sel, N.CompoundSelector)) {
      for (const c of sel.value) {
        if (typeof c === 'string') {
          continue;
        }
        Ruleset.ensureSelectorVisible(c);
      }
    }
  }

  private static needsVisibleSelectorClone(sel: string | Selector | Nil): boolean {
    if (typeof sel === 'string') {
      return false;
    }
    if (!sel || sel instanceof Nil) {
      return false;
    }
    if (!(isNode(sel, N.Ampersand) && sel.hasFlag(F_IMPLICIT_AMPERSAND)) && !sel.hasFlag(F_VISIBLE)) {
      return true;
    }
    if (isNode(sel, N.SelectorList)) {
      for (let i = 0; i < sel.value.length; i++) {
        if (Ruleset.needsVisibleSelectorClone(sel.value[i]!)) {
          return true;
        }
      }
      return false;
    }
    if (isNode(sel, N.ComplexSelector)) {
      for (let i = 0; i < sel.value.length; i++) {
        if (typeof sel.value[i] === 'string') {
          continue;
        }
        if (Ruleset.needsVisibleSelectorClone(sel.value[i]!)) {
          return true;
        }
      }
      return false;
    }
    if (!isNode(sel, N.CompoundSelector)) {
      return false;
    }
    for (let i = 0; i < sel.value.length; i++) {
      if (typeof sel.value[i] === 'string') {
        continue;
      }
      if (Ruleset.needsVisibleSelectorClone(sel.value[i]!)) {
        return true;
      }
    }
    return false;
  }

  static isBareAmpersandSelector(sel: string | Selector | Nil): boolean {
    if (typeof sel === 'string') {
      return false;
    }
    const isBareAmpNode = (node: Selector): boolean => {
      return isNode(node, N.Ampersand)
        && (node.appendValue === undefined || node.appendValue === '');
    };
    if (!sel || sel instanceof Nil) {
      return false;
    }
    if (isBareAmpNode(sel)) {
      return true;
    }
    if (isNode(sel, N.ComplexSelector) || isNode(sel, N.CompoundSelector)) {
      const only = sel.value[0];
      return sel.value.length === 1 && only instanceof Selector && isBareAmpNode(only);
    }
    if (isNode(sel, N.SelectorList)) {
      for (let i = 0; i < sel.value.length; i++) {
        if (!Ruleset.isBareAmpersandSelector(sel.value[i]!)) {
          return false;
        }
      }
      return true;
    }
    return false;
  }

  static hasExtendedTopLevelSelector(sel: string | Selector | Nil): boolean {
    if (typeof sel === 'string') {
      return false;
    }
    if (!sel || sel instanceof Nil) {
      return false;
    }
    if (isNode(sel, N.SelectorList)) {
      for (let i = 0; i < sel.value.length; i++) {
        const item = sel.value[i]!;
        if (typeof item !== 'string' && item.hasFlag(F_EXTENDED)) {
          return true;
        }
      }
      return false;
    }
    if (isNode(sel, N.PseudoSelector) && sel.generated === true && sel.name === ':is' && sel.arg instanceof Selector) {
      return Ruleset.hasExtendedTopLevelSelector(sel.arg);
    }
    if (isNode(sel, N.CompoundSelector) || isNode(sel, N.ComplexSelector)) {
      for (const component of sel.value) {
        if (
          !isStringCompoundSelectorComponent(component)
          && component instanceof Selector
          && Ruleset.hasExtendedTopLevelSelector(component)
        ) {
          return true;
        }
      }
    }
    return sel.hasFlag(F_EXTENDED);
  }

  private static filterExtendedTopLevelSelectorItems(sel: Selector): Selector | Nil {
    if (!isNode(sel, N.SelectorList)) {
      const simplified = Ruleset.simplifyGeneratedIsSelector(sel);
      return (
        sel.hasFlag(F_EXTENDED)
        || sel.hasFlag(F_EXTEND_TARGET)
        || Ruleset.hasExtendedTopLevelSelector(sel)
      )
        ? (() => {
            const unwrapped = simplified ?? Ruleset.unwrapGeneratedReferenceIs(sel);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            return typeof unwrapped === 'string' ? unwrapped as unknown as Selector : unwrapped;
          })()
        : new Nil();
    }
    const seen = new Set<string>();
    const kept: SelectorListItem[] = [];
    let sawAddedSelector = false;
    for (const item of sel.value) {
      if (typeof item === 'string') {
        continue;
      }
      if (item.hasFlag(F_EXTENDED) && !item.hasFlag(F_EXTEND_TARGET)) {
        sawAddedSelector = true;
        const key = item.valueOf();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        kept.push(copySelectorForRulesetMetadata(
          Ruleset.simplifyGeneratedIsSelector(item) ?? Ruleset.unwrapGeneratedReferenceIs(item)
        ));
      }
    }
    if (!sawAddedSelector) {
      for (const item of sel.value) {
        if (typeof item === 'string') {
          continue;
        }
        if (!item.hasFlag(F_EXTENDED) && !item.hasFlag(F_EXTEND_TARGET)) {
          continue;
        }
        const key = item.valueOf();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        kept.push(copySelectorForRulesetMetadata(
          Ruleset.simplifyGeneratedIsSelector(item) ?? Ruleset.unwrapGeneratedReferenceIs(item)
        ));
      }
    }
    if (kept.length === 0) {
      return new Nil();
    }
    if (kept.length === 1) {
      const single = kept[0]!;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return typeof single === 'string' ? single as unknown as Selector : single;
    }
    return SelectorList.create(kept).inherit(sel);
  }

  private static unwrapGeneratedReferenceIs(sel: Selector | string, includeUntouchedSiblings = false): Selector | string {
    // A bare-string selector has no generated reference-:is() wrapper to unwrap.
    if (typeof sel === 'string') {
      return sel;
    }
    if (sel instanceof SelectorList) {
      const kept: SelectorListItem[] = [];
      const seen = new Set<string>();
      for (const item of sel.value) {
        if (typeof item === 'string') {
          continue;
        }
        const keepItem = includeUntouchedSiblings
          ? !item.hasFlag(F_EXTEND_TARGET)
          : item.hasFlag(F_EXTENDED) && !item.hasFlag(F_EXTEND_TARGET);
        if (!keepItem) {
          continue;
        }
        const unwrapped = Ruleset.unwrapGeneratedReferenceIs(item, includeUntouchedSiblings);
        const key = unwrapped.valueOf();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        kept.push(unwrapped);
      }
      if (kept.length === 1) {
        return kept[0]!;
      }
      if (kept.length > 1) {
        return SelectorList.create(kept).inherit(sel);
      }
      return sel;
    }
    if (!isNode(sel, N.PseudoSelector) || sel.generated !== true || sel.name !== ':is') {
      return sel;
    }
    const { arg } = sel;
    if (arg instanceof SelectorList) {
      const kept: SelectorListItem[] = [];
      const seen = new Set<string>();
      for (const item of arg.value) {
        if (typeof item === 'string') {
          continue;
        }
        const keepItem = includeUntouchedSiblings
          ? !item.hasFlag(F_EXTEND_TARGET)
          : item.hasFlag(F_EXTENDED) && !item.hasFlag(F_EXTEND_TARGET);
        if (!keepItem) {
          continue;
        }
        const unwrapped = Ruleset.unwrapGeneratedReferenceIs(item, includeUntouchedSiblings);
        const key = unwrapped.valueOf();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        kept.push(unwrapped);
      }
      if (kept.length === 1) {
        return kept[0]!;
      }
      if (kept.length > 1) {
        return SelectorList.create(kept).inherit(arg);
      }
      if (arg.value.length === 1) {
        return arg.value[0]!;
      }
    }
    return arg instanceof Selector ? arg : sel;
  }

  /**
   * Filter a compose-parent selector for reference-mode rendering. Reference
   * imports hide non-extended selectors from output, so when we compose a
   * child against a parent that came from a reference import, the compose
   * parent should contain only the items that remain visible.
   *
   * Returns the filtered parent, or `undefined` if the original parent is
   * already correct for use as-is (nothing to filter, no visibility flags
   * present). Returns `undefined` rather than the original so callers can
   * distinguish "filter was no-op" from "filter reduced the parent".
   */
  /**
   * Filter a compose-parent selector for reference-mode rendering. Reference
   * imports hide content not reached by an extend; when a reference-imported
   * parent gains visible selector items via extend, nested descendants should
   * compose against those visible items rather than the hidden original targets.
   *
   * Returns the filtered parent, or `undefined` when the filter is a no-op
   * so callers can fall through to their own parent handling.
   */
  static filterExtendedForReferenceCompose(parent: Selector, includeUntouchedSiblings: boolean = false): Selector | undefined {
    if (!isNode(parent, N.SelectorList)) {
      return undefined;
    }
    let hasAnyAdded = false;
    for (let i = 0; i < parent.value.length; i++) {
      const item = parent.value[i]!;
      if (typeof item === 'string') {
        continue;
      }
      if (item.hasFlag(F_EXTENDED) && !item.hasFlag(F_EXTEND_TARGET)) {
        hasAnyAdded = true;
        break;
      }
    }
    if (!hasAnyAdded) {
      return undefined;
    }
    const seen = new Set<string>();
    const kept: SelectorListItem[] = [];
    for (const item of parent.value) {
      if (typeof item === 'string') {
        if (includeUntouchedSiblings && !seen.has(item)) {
          seen.add(item);
          kept.push(item);
        }
        continue;
      }
      const keepItem = includeUntouchedSiblings
        ? !item.hasFlag(F_EXTEND_TARGET)
        : item.hasFlag(F_EXTENDED) && !item.hasFlag(F_EXTEND_TARGET);
      if (!keepItem) {
        continue;
      }
      const key = item.valueOf();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      kept.push(
        Ruleset.simplifyGeneratedIsSelector(item)
        ?? Ruleset.unwrapGeneratedReferenceIs(item, includeUntouchedSiblings)
      );
    }
    if (kept.length === 0 || kept.length === parent.value.length) {
      return undefined;
    }
    if (kept.length === 1) {
      const single = kept[0]!;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return typeof single === 'string' ? single as unknown as Selector : single;
    }
    return SelectorList.create(kept).inherit(parent);
  }

  static expandGeneratedIsForReferenceCompose(selector: Selector): Selector | undefined {
    if (isNode(selector, N.SelectorList)) {
      const expanded: Selector[] = [];
      let changed = false;
      const seen = new Set<string>();
      for (const item of selector.value) {
        const next = Ruleset.expandGeneratedIsForReferenceCompose(selectorListItemForMatch(item)) ?? item;
        const items = isNode(next, N.SelectorList) ? next.value : [next];
        changed ||= next !== item;
        for (const expandedItem of items) {
          const key = expandedItem.valueOf();
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          expanded.push(selectorListItemForMatch(expandedItem));
        }
      }
      if (!changed) {
        return undefined;
      }
      if (expanded.length === 1) {
        return expanded[0]!;
      }
      return SelectorList.create(expanded).inherit(selector);
    }

    if (!isNode(selector, N.ComplexSelector)) {
      return undefined;
    }

    const slots: Array<Array<{ parts: ComplexSelectorComponent[]; hasAdded: boolean }>> = [];
    let sawGeneratedIs = false;
    const complex = selector;
    for (const part of complex.value) {
      if (isNode(part, N.PseudoSelector)) {
        const { arg } = part;
        if (!(part.generated === true && part.name === ':is' && arg instanceof Selector)) {
          slots.push([{ parts: [part], hasAdded: false }]);
          continue;
        }
        const alternatives: Array<{ parts: ComplexSelectorComponent[]; hasAdded: boolean }> = [];
        const items = isNode(arg, N.SelectorList) ? arg.value : [arg];
        for (const item of items) {
          if (typeof item === 'string') {
            continue;
          }
          if (item.hasFlag(F_EXTEND_TARGET)) {
            continue;
          }
          alternatives.push({
            parts: isNode(item, N.ComplexSelector)
              ? [...item.value]
              : [Ruleset._toComplexComponent(selectorListItemForMatch(item))],
            hasAdded: item.hasFlag(F_EXTENDED)
          });
        }
        if (alternatives.length === 0) {
          slots.push([{ parts: [part], hasAdded: false }]);
          continue;
        }
        sawGeneratedIs = true;
        slots.push(alternatives);
        continue;
      }
      slots.push([{ parts: [part], hasAdded: false }]);
    }

    if (!sawGeneratedIs) {
      return undefined;
    }

    const expanded: Selector[] = [];
    const seen = new Set<string>();
    const build = (
      index: number,
      parts: ComplexSelectorComponent[],
      hasAdded: boolean
    ): void => {
      if (index >= slots.length) {
        if (!hasAdded) {
          return;
        }
        const built = attachSelectorBitLibrary(
          ComplexSelector.create(parts).inherit(complex),
          complex.keySetLibrary
        ) as Selector;
        built.addFlag(F_EXTENDED);
        const key = built.valueOf();
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        expanded.push(built);
        return;
      }
      for (const option of slots[index]!) {
        build(index + 1, [...parts, ...option.parts], hasAdded || option.hasAdded);
      }
    };

    build(0, [], false);
    if (expanded.length === 0) {
      return undefined;
    }
    if (expanded.length === 1) {
      return expanded[0]!;
    }
    return SelectorList.create(expanded).inherit(selector);
  }

  static simplifyGeneratedIsSelector(selector: Selector | string): Selector | undefined {
    // A bare-string selector has no generated :is() structure to simplify.
    if (typeof selector === 'string') {
      return undefined;
    }
    if (isNode(selector, N.PseudoSelector) && selector.generated === true && selector.name === ':is') {
      if (!(selector.arg instanceof Selector)) {
        return undefined;
      }
      const unwrapped = Ruleset.unwrapGeneratedReferenceIs(selector.arg);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return typeof unwrapped === 'string' ? unwrapped as unknown as Selector : unwrapped;
    }
    if (isNode(selector, N.SelectorList)) {
      let changed = false;
      const items = selector.value.map((item) => {
        const next = Ruleset.simplifyGeneratedIsSelector(item) ?? item;
        changed ||= next !== item;
        return next;
      });
      return changed ? SelectorList.create(items).inherit(selector) : undefined;
    }
    if (isNode(selector, N.CompoundSelector)) {
      let changed = false;
      const components: CompoundSelectorComponent[] = [];
      for (const component of selector.value) {
        if (
          !isStringCompoundSelectorComponent(component)
          && isNode(component, N.PseudoSelector)
          && component.generated === true
          && component.name === ':is'
          && component.arg instanceof Selector
        ) {
          const unwrapped = Ruleset.unwrapGeneratedReferenceIs(component.arg);
          if (isNode(unwrapped, N.CompoundSelector)) {
            components.push(...unwrapped.value);
          } else if (typeof unwrapped !== 'string') {
            components.push(Ruleset._toSimpleSelector(unwrapped));
          } else {
            components.push(unwrapped);
          }
          changed = true;
          continue;
        }
        components.push(component);
      }
      if (!changed) {
        return undefined;
      }
      if (components.length === 1) {
        const single = components[0]!;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        return typeof single === 'string' ? single as unknown as Selector : single;
      }
      return CompoundSelector.create(components).inherit(selector);
    }
    if (isNode(selector, N.ComplexSelector)) {
      let changed = false;
      const parts: ComplexSelectorComponent[] = [];
      for (const part of selector.value) {
        if (
          isNode(part, N.PseudoSelector)
          && part.generated === true
          && part.name === ':is'
          && part.arg instanceof Selector
        ) {
          const unwrapped = Ruleset.unwrapGeneratedReferenceIs(part.arg);
          if (isNode(unwrapped, N.ComplexSelector)) {
            parts.push(...unwrapped.value);
          } else if (typeof unwrapped !== 'string') {
            parts.push(Ruleset._toComplexComponent(unwrapped));
          } else {
            parts.push(unwrapped);
          }
          changed = true;
          continue;
        }
        parts.push(part);
      }
      return changed ? ComplexSelector.create(parts).inherit(selector) : undefined;
    }
    return undefined;
  }

  composeHeaderSelector(
    options: FinalPrintOptions,
    renderSelector: Selector,
    referenceFilteredLocal?: Selector | Nil,
    behavior: { skipCurrentCachedParent?: boolean; skipSameSelectorCompose?: boolean } = {}
  ): Selector {
    let rawParentComposed = options.composedSelectorStack?.at(-1);
    const cachedCurrentComposed = getCachedComposedSelector(options, this);
    if (
      behavior.skipCurrentCachedParent !== false
      && rawParentComposed
      && cachedCurrentComposed
      && rawParentComposed.valueOf() === cachedCurrentComposed.valueOf()
    ) {
      rawParentComposed = options.composedSelectorStack?.at(-2);
    }
    const ownSelector = (this.options as RulesetOptions | undefined)?.ownSelector;
    const referenceComposeSelectorText = (ownSelector ?? renderSelector).valueOf();
    let referenceComposeAmpCount = 0;
    for (let index = 0; index < referenceComposeSelectorText.length; index++) {
      if (referenceComposeSelectorText.charCodeAt(index) === 38) {
        referenceComposeAmpCount++;
      }
    }
    const parentComposed = (
      options.referenceMode === true
      && options.referenceRenderEnabled === true
      && rawParentComposed
    )
      ? Ruleset.filterExtendedForReferenceCompose(
        rawParentComposed,
        referenceComposeAmpCount > 1
      ) ?? rawParentComposed
      : rawParentComposed;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const parentAtRule = isNode(this.parent, N.AtRule) ? this.parent as AtRule : undefined;
    const structuralParent = (
      !parentAtRule?.isRootOnly()
      && this.hoistToRoot === true
      && this.parent?.parent
      && isNode(this.parent.parent, N.Ruleset)
    )
      ? this.parent.parent.selector
      : null;
    const composeParent: Selector | null = parentComposed ?? (
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      structuralParent && !(structuralParent instanceof Nil) ? structuralParent as Selector : null
    );
    let cached = getCachedComposedSelector(options, this);
    if (!cached) {
      const hasExtendedComposeContext = Boolean(
        Ruleset.hasExtendedTopLevelSelector(renderSelector)
        || (composeParent && Ruleset.hasExtendedTopLevelSelector(composeParent))
        || this.hasFlag(F_EXTENDED)
      );
      const composeInput: Selector = (
        ownSelector
        && !(ownSelector instanceof Nil)
        && ownSelector.hasFlag(F_AMPERSAND)
        && !Ruleset.isBareAmpersandSelector(ownSelector)
        && composeParent
        && hasExtendedComposeContext
      )
        ? ownSelector
        : (referenceFilteredLocal instanceof Nil ? renderSelector : (referenceFilteredLocal ?? renderSelector));
      cached = composeParent
        ? (
            behavior.skipSameSelectorCompose !== false
            && composeInput.valueOf() === composeParent.valueOf()
              ? composeInput
              : Ruleset.composeSelector(composeInput, composeParent)
          )
        : composeInput;
      if (options.referenceMode === true && options.referenceRenderEnabled === true) {
        cached = Ruleset.expandGeneratedIsForReferenceCompose(cached) ?? cached;
        cached = Ruleset.simplifyGeneratedIsSelector(cached) ?? cached;
      }
      if (composeParent) {
        setCachedComposedSelector(options, this, cached);
      }
    }
    return cached;
  }

  private writeHeaderSelector(options: FinalPrintOptions, withoutComments: boolean): boolean {
    const { selector } = this;

    if (typeof selector === 'string') {
      if (
        options.collapseNesting
        || options.referenceMode === true
        || withoutComments
      ) {
        return false;
      }
      options.writer.add(selector);
      return selector.length > 0;
    }

    // Should never be called for Nil selectors (serializeRulesContainer guards this),
    // but keep it safe for TypeScript and invariants.
    if (selector === undefined || selector instanceof Nil) {
      return false;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    let renderSelector: Selector | Nil = withoutComments ? this.ownSelector(selector) as Selector | Nil : selector;
    const canReferenceFilter = !(renderSelector instanceof Nil)
      && (
        Ruleset.hasExtendedTopLevelSelector(renderSelector)
        || renderSelector.hasFlag(F_EXTEND_TARGET)
      );
    const simplifiedGeneratedIs = canReferenceFilter && !options.collapseNesting && !(renderSelector instanceof Nil)
      ? Ruleset.simplifyGeneratedIsSelector(renderSelector)
      : undefined;
    const referenceFilteredLocal = (
      options.referenceMode === true
      && options.referenceRenderEnabled === true
      && canReferenceFilter
      && !(renderSelector instanceof Nil)
    )
      ? (simplifiedGeneratedIs ?? Ruleset.filterExtendedTopLevelSelectorItems(renderSelector))
      : undefined;
    if (options.collapseNesting && !(renderSelector instanceof Nil)) {
      renderSelector = this.composeHeaderSelector(options, renderSelector, referenceFilteredLocal);
      if (
        options.referenceMode === true
        && options.referenceRenderEnabled === true
        && Ruleset.hasExtendedTopLevelSelector(renderSelector)
      ) {
        renderSelector = Ruleset.simplifyGeneratedIsSelector(renderSelector) ?? renderSelector;
      }
    }
    // Header filter: in reference mode, top-level selector output should
    // reflect the selectors that were actually unlocked. When an extend adds
    // visible selectors, we emit those; for self-extends with no added items,
    // we fall back to the touched original selector.
    if (referenceFilteredLocal) {
      renderSelector = (
        renderSelector.valueOf() === referenceFilteredLocal.valueOf()
          ? renderSelector
          : renderSelector instanceof Nil
            ? renderSelector
            : referenceFilteredLocal
      );
      if (renderSelector instanceof Nil) {
        return false;
      }
    }
    const saved = savePrintState(options, ['referenceFilterTargets']);
    if (
      options.referenceMode === true
      && options.referenceRenderEnabled === true
    ) {
      options.referenceFilterTargets = true;
    }
    const renderSelectorSourceRef = renderSelector;
    if (!(renderSelector instanceof Nil)) {
      const needsVisibleSelectorClone = Ruleset.needsVisibleSelectorClone(renderSelector);
      if (options.referenceFilterTargets || needsVisibleSelectorClone) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        renderSelector = copySelectorForRulesetMetadata(renderSelector) as Selector;
      }
    }
    // For reusable-leaf selectors, copySelectorForRulesetMetadata returns the source node
    // unchanged. Ensure we restore visibility after writing so the source is not mutated.
    const renderSelectorWasVisible = renderSelector instanceof Nil || renderSelector.hasFlag(F_VISIBLE);
    Ruleset.ensureSelectorVisible(renderSelector);
    const savedTrivia = options.trivia;
    const position = options.writer.position();
    if (withoutComments) {
      options.trivia = createTriviaMap();
    }
    try {
      renderSelector.writeSyntax(options);
      options.writer.trimEndSince(position);
    } finally {
      options.trivia = savedTrivia;
      restorePrintState(options, saved);
      // Restore source selector visibility if renderSelector is the same as the source
      // (happens when the selector is a reusable leaf and no copy was made).
      if (!renderSelectorWasVisible && renderSelector === renderSelectorSourceRef && !(renderSelector instanceof Nil)) {
        renderSelector.removeFlag(F_VISIBLE);
      }
    }
    return options.writer.position() !== position;
  }

  private renderHeaderSelectorString(options: FinalPrintOptions, withoutComments: boolean): string {
    const writer = new OutputWriter(options.compress);
    this.writeHeaderSelector({
      ...options,
      writer
    }, withoutComments);
    return writer.toString();
  }

  getComparableHeaderString(options: FinalPrintOptions): string {
    return this.renderHeaderSelectorString(options, true);
  }

  writeHeader(options: FinalPrintOptions, withoutComments?: boolean): boolean {
    const w = options.writer;
    const position = w.position();
    const idt = indent(options.depth);
    if (idt) {
      w.add(idt);
    }
    if (!this.writeHeaderSelector(options, withoutComments === true)) {
      w.restore(position);
      return false;
    }
    w.add(' {\n');
    return true;
  }

  getHeaderString(options: FinalPrintOptions, withoutComments?: boolean): string {
    const header = this.renderHeaderSelectorString(options, withoutComments === true) + ' {';
    const idt = indent(options.depth);
    return (/^\s*\/\*/u.test(header)
      ? normalizeLeadingBlockTrivia(header, idt)
      : normalizeIndent(header, idt)) + '\n';
  }

  override prepareRegistration(context: Context): MaybePromise<this> {
    if (!this.registrationPrepared) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return this._prepareRulesetRegistration(context) as MaybePromise<this>;
    }
    return this;
  }

  private _prepareRulesetRegistration(
    context: Context,
    options: { ownRules?: boolean } = {}
  ): MaybePromise<Ruleset> {
    const sourceSelector = this.materializeRawSelectorForSemantics();
    this.attachSelectorBits(sourceSelector, context.selectorBits);
    const sourceParts: RulesetValue = {
      selector: sourceSelector,
      rules: this.rules,
      ...(this.guard !== undefined && { guard: this.guard }),
      ...(this.selectorBeforeExtend !== undefined && {
        selectorBeforeExtend: this.selectorBeforeExtend
      })
    };
    const node = this.withParts(sourceParts, sourceParts, options);
    node._selectorCacheOwner = this;
    node.registrationPrepared = true;
    const selector = node.materializeRawSelectorForSemantics();
    const { selectorBits } = context;
    this._prepareRulesVisibility(node, context);
    this._storeOwnSelector(node, selector, selectorBits);
    /* getImplicitSelector removed — selector stays as-authored.
     * Composed form (with parent context) computed on-demand during:
     * - serialization (composedSelectorStack in PrintOptions)
     * - extend matching (parent context parameter)
     */
    // DO NOT evaluate guard here - guards are evaluated at call time in getFunctionFromMixins
    // Just evaluate the selector
    const sel = this._prepareRulesetSelectorIdentity(selector, context);
    return isThenable(sel)
      ? sel.then(resolved => this._finishRulesetSelectorPrep(node, resolved, context))
      : this._finishRulesetSelectorPrep(node, sel, context);
  }

  private _prepareRulesetSelectorIdentity(selector: Selector | Nil, context: Context): MaybePromise<Selector | Nil> {
    return selector.eval(context);
  }

  private _prepareRulesVisibility(node: Ruleset, context: Context): void {
    // Generated wrapper rulesets (e.g. implicit `& { ... }` created by AtRule hoisting)
    // should not force var visibility to `private`, otherwise sibling vars inside the wrapper
    // (like Less `@base`) become inaccessible.
    if (node.options.generated) {
      return;
    }
    node.options.rulesVisibility ??= {};
    if (context.leakyRules) {
      node.options.rulesVisibility.Mixin = 'public';
      node.options.rulesVisibility.VarDeclaration = 'optional';
    } else {
      node.options.rulesVisibility.Mixin = 'private';
      node.options.rulesVisibility.VarDeclaration = 'private';
    }
  }

  private _storeOwnSelector(node: Ruleset, selector: Selector | Nil, selectorBits: Context['selectorBits']): void {
    // Store own selector before parent resolution so extend can extend .replace,.c not the resolved form.
    this.attachSelectorBits(selector, selectorBits);
    const ownSelector: Selector | Nil = !(selector instanceof Nil)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      ? copySelectorForRulesetMetadata(selector) as Selector
      : selector;
    this.attachSelectorBits(ownSelector, selectorBits);
    if (node._options) {
      (node._options as RulesetOptions).ownSelector = ownSelector;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      node._options = { ownSelector } as unknown as RulesetOptions & NodeOptions;
    }
  }

  private _finishRulesetSelectorPrep(
    node: Ruleset,
    sel: Selector | Nil,
    context: Context
  ): MaybePromise<Ruleset> {
    const rulesetNode: Ruleset = node;
    // Store the evaluated selector - this is what will be in the frame
    node.adopt(sel);
    node.selector = sel;
    node.invalidateSelectorValueCache(sel);
    if (sel.hoistToRoot) {
      node.hoistToRoot = true;
    }
    // Wire up the BitSet library on the evaluated selector so that
    // extend fast-rejection via keySet/requiredKeySet works. The
    // library is shared across all selectors in a compilation via
    // context.selectorBits; assigning it here ensures that when the
    // lazy `keySet` getter fires during extend matching, it produces
    // real BitSets instead of undefined.
    if ('keySetLibrary' in sel && !(sel instanceof Nil)) {
      (sel as Selector).keySetLibrary ??= context.selectorBits;
    }
    // Register the concrete Ruleset with the current extend root.
    const extendRoot = context.extendRoots.getCurrentExtendRoot();
    if (extendRoot) {
      registerRulesetWithRoot(extendRoot, rulesetNode);
    }
    return this._prepareChildRulesRegistration(node, context, extendRoot);
  }

  private _prepareChildRulesRegistration(node: Ruleset, context: Context, extendRoot: Rules | undefined): MaybePromise<Ruleset> {
    // Depth-first: prepare child rules immediately so all nested rulesets/extends
    // are registered in source order before we process extends.
    // Push this ruleset to the frame so nested rulesets get the correct parent selector
    // when building implicit selectors (e.g. .header-nav inside .header → .header .header-nav).
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Ruleset intentionally checks Rules' private prep marker; public registrationPrepared is already true for derived ruleset prep surfaces.
    if (!(node as unknown as { _registrationPrepared?: boolean })._registrationPrepared) {
      const rulesetNode: Ruleset = node;
      const rulesetFrameCount = context.rulesetFrames.length;
      context.rulesetFrames.push(rulesetNode);
      if (extendRoot) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        context.extendRoots.registerRoot(node as unknown as Rules, extendRoot);
      }
      let preparedRules: MaybePromise<Node>;
      try {
        preparedRules = Rules.prototype.prepareRegistration.call(node, context);
      } catch (error) {
        context.rulesetFrames.length = rulesetFrameCount;
        throw error;
      }
      if (isThenable(preparedRules)) {
        return preparedRules.then(
          (prepared) => {
            context.rulesetFrames.pop();
            if (prepared !== node) {
              throw new TypeError('Expected child rules registration prep to return source Ruleset');
            }
            return node;
          },
          (error) => {
            context.rulesetFrames.length = rulesetFrameCount;
            throw error;
          }
        );
      }
      context.rulesetFrames.pop();
      if (preparedRules !== node) {
        throw new TypeError('Expected child rules registration prep to return source Ruleset');
      }
    }
    return node;
  }

  override evalNode(context: Context): MaybePromise<Rules> {
    let pushedFrames = false;
    let pushedRulesetFrameCount = 0;
    let pushedFrameCount = 0;
    const restorePushedEvalFrames = () => {
      if (!pushedFrames) {
        return;
      }
      context.rulesetFrames.length = pushedRulesetFrameCount;
      context.frames.length = pushedFrameCount;
      pushedFrames = false;
    };
    const collapseNesting = context.opts.output?.collapseNesting;
    // Store frames snapshot for collapseNesting serialization
    if (collapseNesting) {
      this.frames = [...context.frames];
    }

    const finishEvaluatedRules = (evaluatedRules: Rules | Nil): Rules | Nil => {
      restorePushedEvalFrames();
      if (evaluatedRules instanceof Nil) {
        return evaluatedRules;
      }

      // If selector was Nil, evaluatedRules is already Rules (not wrapped in Ruleset)
      // In that case, return it directly without wrapping back in Ruleset
      if (this.selector instanceof Nil) {
        return (evaluatedRules as unknown) === this
          ? new Rules(
              this.rules,
              this.options ? { ...this.options } : undefined,
              this.location.length ? this.location : undefined,
              this.sourceRoot?._treeContext
            ).inherit(this)
          : evaluatedRules;
      }

      if ((evaluatedRules as unknown) !== this) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (this as unknown as { rules: Node[] }).rules = evaluatedRules.rules;
        for (let i = 0; i < this.rules.length; i++) {
          this.adopt(this.rules[i]!);
        }
      }

      if (!this.hasVisibleRules()) {
        this.removeFlag(F_VISIBLE);
      }
      return this;
    };
    const evalBodyAfterGuard = (guardResult: Nil | undefined): MaybePromise<Rules | Nil> => {
      // If guard failed, return Nil (ruleset produces no output)
      if (guardResult instanceof Nil) {
        return finishEvaluatedRules(guardResult);
      }
      let selector = this.materializeRawSelectorForSemantics();

      if (selector instanceof Nil) {
        // If selector evaluates to Nil, return the rules body directly instead of the ruleset.
        this.adopt(selector);
        this.selector = selector;
        this.invalidateSelectorValueCache(selector);
        const evaluatedRules = Rules.prototype.evalNode.call(this, context);
        if (isThenable(evaluatedRules)) {
          return (evaluatedRules as Promise<Rules>).then((rules) => {
            return finishEvaluatedRules(rules);
          });
        }
        return finishEvaluatedRules(evaluatedRules);
      }
      this.adopt(selector);
      this.selector = selector;
      this.invalidateSelectorValueCache(selector);
      if (context.opts.output?.collapseNesting) {
        this.hoistToRoot = true;
      }
      pushedRulesetFrameCount = context.rulesetFrames.length;
      pushedFrameCount = context.frames.length;
      context.rulesetFrames.push(this);
      context.frames.push(this);
      pushedFrames = true;
      let evaluatedRules: MaybePromise<Rules>;
      try {
        evaluatedRules = Rules.prototype.evalNode.call(this, context);
      } catch (error) {
        restorePushedEvalFrames();
        throw error;
      }
      return isThenable(evaluatedRules)
        ? (evaluatedRules as Promise<Rules>).then(
            finishEvaluatedRules,
            (error) => {
              restorePushedEvalFrames();
              throw error;
            }
          )
        : finishEvaluatedRules(evaluatedRules);
    };
    let { guard } = this;
    // Guard was already set to Nil (failed in a previous eval)
    if (guard instanceof Nil) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return finishEvaluatedRules(guard) as MaybePromise<Rules>;
    }
    // Evaluate guard at definition time (not call time like mixins)
    // This is different from mixins because rulesets can't use caller scope for guards
    if (guard) {
      const guardResult = guard instanceof Condition
        ? guard.evaluateBoolean(context)
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        : (guard as unknown as Node).eval(context);
      const finishGuard = (result: boolean | Node): Nil | undefined => {
        const guardPasses = typeof result === 'boolean'
          ? result
          : Boolean(result instanceof Bool && result.value === true);
        if (!guardPasses) {
          const nil = createPublicNil();
          this.adopt(nil);
          this.guard = nil;
          return nil;
        }
        this.guard = undefined;
        return undefined;
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return (isThenable(guardResult)
        ? guardResult.then(result => evalBodyAfterGuard(finishGuard(result)))
        : evalBodyAfterGuard(finishGuard(guardResult))) as MaybePromise<Rules>;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return evalBodyAfterGuard(undefined) as MaybePromise<Rules>;
  }
}

type RulesetParams = ConstructorParameters<typeof Ruleset>;

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
export const ruleset = defineType<RulesetValue>(Ruleset, 'Ruleset') as (
  value: RulesetValue | RulesetParams[0],
  options?: RulesetParams[1],
  location?: RulesetParams[2]
) => Ruleset;
