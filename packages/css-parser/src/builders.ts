/**
 * CssBuilders — builder methods and AST helpers for the CSS grammar.
 *
 * This is the builder-only half of the CSS parser: no grammar rules,
 * no Parséman Parser base class. Grammar rules live in grammar-fn.ts
 * (the macro-compiled functional grammar), which uses CssBuilders via
 * a thin BuilderHost subclass.
 */
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */

import type { Span } from 'parseman';
import type { CSTLeaf, CSTError } from 'parseman';
import {
  createPackedFieldSpans,
  setPackedFieldSpan,
  createPackedSegmentSpans,
  setPackedSegmentSpan
} from '@jesscss/parser';

import {
  Node,
  type LocationInfo,
  type TriviaMap,
  type Trivia,
  makeTrivia,
  Rules, Ruleset,
  Comment,
  type Selector,
  CompoundSelector, type CompoundSelectorComponent,
  ComplexSelector, type ComplexSelectorValue,
  Declaration, CustomDeclaration,
  Any, Dimension, Num, Color, ColorFormat,
  Sequence, List,
  Operation,
  Call, Paren, Url,
  Quoted,
  QueryCondition, Keyword,
  AtRule, AtRuleStatement,
  AttributeSelector, type AttributeSelectorValue,
  PseudoSelector
} from '@jesscss/core';

// ---------------------------------------------------------------------------
// Recognized CSS color keywords (full match, case-insensitive). Exported so the
// Less grammar can reuse it instead of maintaining a parallel list.
// ---------------------------------------------------------------------------

export const CSS_COLOR_NAMES = new Set([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque',
  'black', 'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood',
  'cadetblue', 'chartreuse', 'chocolate', 'coral', 'cornflowerblue', 'cornsilk',
  'crimson', 'cyan', 'currentcolor', 'darkblue', 'darkcyan', 'darkgoldenrod',
  'darkgray', 'darkgrey', 'darkgreen', 'darkkhaki', 'darkmagenta',
  'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon',
  'darkseagreen', 'darkslateblue', 'darkslategray', 'darkslategrey',
  'darkturquoise', 'darkviolet', 'deeppink', 'deepskyblue', 'dimgray', 'dimgrey',
  'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen', 'fuchsia', 'gainsboro',
  'ghostwhite', 'gold', 'goldenrod', 'gray', 'grey', 'green', 'greenyellow',
  'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender',
  'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral',
  'lightcyan', 'lightgoldenrodyellow', 'lightgray', 'lightgrey', 'lightgreen',
  'lightpink', 'lightsalmon', 'lightseagreen', 'lightskyblue', 'lightslategray',
  'lightslategrey', 'lightsteelblue', 'lightyellow', 'lime', 'limegreen', 'linen',
  'magenta', 'maroon', 'mediumaquamarine', 'mediumblue', 'mediumorchid',
  'mediumpurple', 'mediumseagreen', 'mediumslateblue', 'mediumspringgreen',
  'mediumturquoise', 'mediumvioletred', 'midnightblue', 'mintcream', 'mistyrose',
  'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange',
  'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise',
  'palevioletred', 'papayawhip', 'peachpuff', 'peru', 'pink', 'plum',
  'powderblue', 'purple', 'rebeccapurple', 'red', 'rosybrown', 'royalblue',
  'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell', 'sienna',
  'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow',
  'springgreen', 'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'transparent',
  'turquoise', 'violet', 'wheat', 'white', 'whitesmoke', 'yellow', 'yellowgreen'
]);

// Pseudo-classes/elements whose argument is itself a selector (kept structured).
const SELECTOR_PSEUDOS = new Set([
  'is', 'where', 'not', 'has', 'matches', 'any', '-moz-any', '-webkit-any',
  'host', 'host-context', 'slotted', 'nth-child', 'nth-last-child',
  'nth-of-type', 'nth-last-of-type'
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type JessNode = Node<any, any>;
type Child = JessNode | CSTLeaf | CSTError;

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

function spanToLocation(span: Span): LocationInfo {
  return [span.start, 0, 0, span.end, 0, 0];
}

function nodeChildren(children: ReadonlyArray<Child>): JessNode[] {
  return children.filter((c): c is JessNode => c._tag === 'node') as JessNode[];
}

function leafText(children: ReadonlyArray<Child>): string {
  return children
    .filter((c): c is CSTLeaf => c._tag === 'leaf')
    .map(l => l.value)
    .join('');
}

export type Component = string | JessNode;

export function toComponent(c: unknown): Component | null {
  if (typeof c === 'string') {
    return c;
  }
  if (c && typeof c === 'object' && '_tag' in c) {
    const tag = (c as { _tag: string })._tag;
    if (tag === 'leaf') {
      return (c as CSTLeaf).value;
    }
    if (tag === 'node') {
      return c as JessNode;
    }
  }
  return null;
}

export type Spanned = { comp: Component; span: Span };

export function spannedComponents(rawChildren: ReadonlyArray<{ _tag: string }>): Spanned[] {
  const out: Spanned[] = [];
  for (const rc of rawChildren as Array<{ _tag: string; value?: string; span?: Span }>) {
    if (rc._tag === 'leaf' && rc.span) {
      out.push({ comp: rc.value ?? '', span: rc.span });
    } else if (rc._tag === 'node' && (rc as unknown as JessNode).span) {
      out.push({ comp: rc as unknown as JessNode, span: (rc as unknown as JessNode).span });
    }
  }
  return out;
}

function firstRawNodeSpan(rawChildren: ReadonlyArray<{ _tag: string }>): Span | undefined {
  for (const rc of rawChildren as Array<{ _tag: string; span?: Span }>) {
    if (rc._tag === 'node' && rc.span) {
      return rc.span;
    }
  }
  return undefined;
}

/** Member source spans for parser-delivered selector-list arrays (plain arrays carry no spans). */
const selectorListSpans = new WeakMap<object, Span[]>();

function readPseudoArg(children: ReadonlyArray<Child>, pseudoName: string): {
  arg: Node | string | unknown[] | undefined;
  memberSpans?: Span[];
  valueSpans?: number[];
} {
  const keepStructured = SELECTOR_PSEUDOS.has(pseudoName.toLowerCase());
  for (const ch of children) {
    if (ch._tag === 'leaf') {
      continue;
    }
    if (Array.isArray(ch)) {
      return { arg: ch, memberSpans: selectorListSpans.get(ch) };
    }
    if (ch._tag === 'node') {
      const node = ch as unknown as JessNode & { value?: unknown; valueSpans?: number[] };
      if (Array.isArray(node.value) && selectorListSpans.has(node.value)) {
        return { arg: node.value, memberSpans: selectorListSpans.get(node.value) };
      }
      if (!keepStructured && Array.isArray(node.value)) {
        return { arg: node.value, valueSpans: node.valueSpans };
      }
      return { arg: node };
    }
  }
  return { arg: undefined };
}

function readRulesetSelector(children: ReadonlyArray<Child>): string | Selector {
  const first = children[0];
  if (first === undefined) {
    return '';
  }
  // Collapsed selector-list / basic-selector builds land as bare strings or arrays.
  if (typeof first === 'string' || Array.isArray(first)) {
    return first as string | Selector;
  }
  if (first._tag === 'node') {
    return first as unknown as JessNode;
  }
  return (nodeChildren(children)[0] ?? '') as string | Selector;
}

function selectorListMemberSpans(rawChildren: ReadonlyArray<{ _tag: string }>): Span[] | undefined {
  const listNode = rawChildren.find(rc => rc._tag === 'node') as {
    rawChildren?: Array<{ _tag: string; span?: Span }>;
    children?: Array<{ _tag: string; span?: Span }>;
  } | undefined;
  const inner = listNode?.rawChildren ?? listNode?.children;
  if (!inner?.length) {
    return undefined;
  }
  const items = spannedComponents(inner).filter(i => i.comp !== ',');
  if (items.length < 2) {
    return undefined;
  }
  return items.map(i => i.span);
}

export function selectorListSpansFor(value: unknown): Span[] | undefined {
  return value && typeof value === 'object' ? selectorListSpans.get(value) : undefined;
}

export function setFieldSpan(node: JessNode, fieldIndex: number, fieldCount: number, span: Span) {
  const n = node as unknown as { fieldSpans?: number[] };
  n.fieldSpans ??= createPackedFieldSpans(fieldCount);
  setPackedFieldSpan(n.fieldSpans, fieldIndex, span.start, span.end);
}

export function setValueSpans(node: JessNode, spans: ReadonlyArray<Span>) {
  const packed = createPackedSegmentSpans(spans.length);
  spans.forEach((s, i) => setPackedSegmentSpan(packed, i, s.start, s.end));
  (node as unknown as { valueSpans?: number[] }).valueSpans = packed;
}

export function fieldIndexOf(node: JessNode, key: string): { index: number; count: number } {
  const keys = (node.constructor as unknown as { childKeys?: readonly string[] }).childKeys ?? [];
  return { index: keys.indexOf(key), count: keys.length };
}

// ---------------------------------------------------------------------------
// Parse result + trivia
// ---------------------------------------------------------------------------

/**
 * Build a TriviaMap backed by the flat log written by scanTrivia during parsing.
 * log = [runStart_0, runEnd_0, ...] — two numbers per run.
 * The before/after Maps are built lazily on first lookup.
 */
export function buildLazyTriviaMap(log: number[], src: string): TriviaMap {
  let before: Map<number, Trivia> | undefined;
  let after: Map<number, Trivia> | undefined;

  const build = () => {
    before = new Map<number, Trivia>();
    after = new Map<number, Trivia>();
    for (let i = 0; i < log.length; i += 2) {
      const run = makeTrivia(src, log[i]!, log[i + 1]!);
      after.set(log[i]!, run);
      before.set(log[i + 1]!, run);
    }
  };

  return {
    lookup(offset, direction) {
      if (offset === undefined) {
        return undefined;
      }
      if (!before) {
        build();
      }
      return direction === 'before' ? before!.get(offset) : after!.get(offset);
    },
    entries(direction) {
      if (!before) {
        build();
      }
      return (direction === 'before' ? before! : after!).entries();
    },
    has(offset, direction) {
      if (offset === undefined) {
        return false;
      }
      if (!before) {
        build();
      }
      return (direction === 'before' ? before! : after!).has(offset);
    }
  };
}

export type CssParseResult<T extends Node = Node> = {
  tree: T;
  errors: Array<{ message: string; offset?: number }>;
  warnings: Array<{ message: string }>;
  trivia: TriviaMap;
};

// ---------------------------------------------------------------------------
// Helpers used by builders
// ---------------------------------------------------------------------------

/** True if [start, end) in src contains whitespace outside a block comment. */
// AUDIT - Massive code smell. Either Parseman has a big API gap or we're doing something dumb.
function hasWhitespaceOutsideComments(src: string, start: number, end: number): boolean {
  let i = start;
  while (i < end) {
    const c = src.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13 || c === 12) {
      return true;
    }
    if (c === 47 && i + 1 < end && src.charCodeAt(i + 1) === 42) {
      i += 2;
      while (i + 1 < end && !(src.charCodeAt(i) === 42 && src.charCodeAt(i + 1) === 47)) {
        i++;
      }
      i += 2;
      continue;
    }
    i++;
  }
  return false;
}

// ---------------------------------------------------------------------------
// CssParser — builder methods only (no grammar rules, no Parser base).
// Subclassed by BuilderHost in grammar-fn.ts to provide an instance for mk().
// ---------------------------------------------------------------------------

export class CssParser {
  protected _source = '';
  protected _strictEOF = false;
  protected _warnings: Array<{ message: string; deprecation?: string }> = [];
  protected _errors: Array<{ message: string; offset?: number }> = [];

  protected _warn(message: string, deprecation?: string) {
    this._warnings.push(deprecation ? { message, deprecation } : { message });
  }

  protected _error(message: string, offset?: number) {
    this._errors.push(offset !== undefined ? { message, offset } : { message });
  }

  // ── buildNode ─────────────────────────────────────────────────────────────
  /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */

  protected buildNode(
    type: string,
    span: Span,
    children: ReadonlyArray<JessNode | CSTLeaf | CSTError>,
    state: unknown,
    rawChildren: ReadonlyArray<{ _tag: string }>
  ) {
    return this._dispatchBuild(type, span, children, rawChildren);
  }

  protected _dispatchBuild(
    type: string,
    span: Span,
    children: ReadonlyArray<JessNode | CSTLeaf | CSTError>,
    rawChildren: ReadonlyArray<{ _tag: string }>
  ) {
    const loc = spanToLocation(span);
    switch (type) {
      case 'Stylesheet':        return this._buildStylesheet(children, loc);
      case 'Ruleset':           return this._buildRuleset(children, rawChildren, loc) as unknown as JessNode;
      case 'SelectorList':      return this._buildSelectorList(rawChildren, loc);
      case 'ComplexSelector':   return this._buildComplexSelector(rawChildren, loc);
      case 'CompoundSelector':  return this._buildCompoundSelector(rawChildren, span);
      case 'AttributeSelector': return this._buildAttributeSelector(children, loc);
      case 'PseudoSelector':    return this._buildPseudoSelector(children, loc);
      case 'Declaration':       return this._buildDeclaration(rawChildren, loc);
      case 'CustomDeclaration': return this._buildCustomDeclaration(children, loc);
      case 'Dimension':         return this._buildDimension(children, loc);
      case 'Num':               return new Num(parseFloat(leafText(children)), undefined, loc);
      case 'Color':             return this._buildColor(leafText(children), loc);
      case 'Url':               return this._buildUrl(children, loc);
      case 'Call':              return this._buildCall(rawChildren, loc);
      case 'Operation':         return this._buildOperation(children, loc, true) as unknown as JessNode;
      case 'Paren':             return this._buildParen(rawChildren, loc);
      case 'SquareParen':       return this._buildSquareParen(rawChildren, loc);
      case 'Quoted':            return this._buildQuoted(children, loc);
      case 'AtRuleBlock':       return this._buildAtRuleBlock(children, loc) as unknown as JessNode;
      case 'AtRuleStatement':   return this._buildAtRuleStatement(children, loc);
      case 'UnknownAtRuleBlock': return this._buildUnknownAtRuleBlock(children, loc) as unknown as JessNode;
      case 'QueryAtRuleBlock':  return this._buildQueryAtRuleBlock(children, loc) as unknown as JessNode;
      case 'QueryCondition':    return this._buildQueryConditionRule(children, loc) as unknown as JessNode;
      case 'QueryInParens':     return this._buildQueryInParens(children, loc) as unknown as JessNode;
      case 'QueryFeature':      return this._buildQueryFeature(children, loc) as unknown as JessNode;
      default:                  return new Any(leafText(children) || type, {}, loc);
    }
  }

  /**
   * The grammar's last-resort catch-all (a `scanTo` arm) matched, meaning no real
   * rule could parse this run of input. Record ONE syntax error (first failure
   * wins — default "1 error and stop") and return a bare string so the swallowed
   * text drops out of the AST instead of becoming a node. Empty / `;`-only runs
   * are normal recovery and are not errors.
   */
  /**
   * The grammar's last-resort recovery arm matched — no real rule could parse this
   * run of input. Log ONE syntax error (default: first failure wins, "1 error and
   * stop") and return a bare string so the swallowed text drops out of the AST.
   * Empty / `;`-only runs are normal recovery, not errors. Unknown at-rule bodies
   * are opaque and parsed by a separate non-erroring rule, so they never reach here.
   */

  /**
   * Lift STANDALONE comments out of the trivia gaps between body children into
   * `Comment` nodes, in source order. Ports the historical Chevrotain behavior
   * (`getRulesWithComments` → `addStandaloneRuleComments` → `isStandaloneRuleComment`):
   * a comment is standalone when it is NOT on the same source line as the node that
   * FOLLOWS it. Inline comments (e.g. `color: /* *​/blue`, same line as the value)
   * stay in trivia. Both block comments (`/* … *​/`) and line comments (`// …`,
   * used by Less) are recognized.
   *
   * @param orderedRuleNodes body child nodes, in source order (their `.location`
   *   gives start/end offsets)
   * @param bodyStart offset in `this._source` where the body content begins (after
   *   the opening `{`, or the stylesheet start)
   * @param bodyEnd offset where the body content ends (before the closing `}`)
   */
  protected _liftStandaloneComments(
    orderedRuleNodes: JessNode[],
    bodyStart: number,
    bodyEnd: number,
    loc: LocationInfo
  ): JessNode[] {
    const src = this._source;
    const out: JessNode[] = [];
    let gapStart = bodyStart;
    for (const rule of orderedRuleNodes) {
      const nextStart = rule.location[0];
      if (typeof nextStart === 'number' && nextStart >= gapStart) {
        const followingIsNestedRule = (rule as { type?: string }).type === 'Ruleset';
        out.push(...this._scanStandaloneComments(src, gapStart, nextStart, nextStart, followingIsNestedRule, loc));
        const nextEnd = rule.location[3];
        gapStart = typeof nextEnd === 'number' ? nextEnd : nextStart;
      }
      out.push(rule);
    }
    // Trailing gap (after the last node): no following node → always standalone.
    out.push(...this._scanStandaloneComments(src, gapStart, bodyEnd, undefined, false, loc));
    return out;
  }

  /**
   * Scan `src[gapStart, gapEnd)` for block/line comments and emit a `Comment` for
   * each STANDALONE one. `followingStart` is the start offset of the node that
   * follows this gap (undefined for the trailing gap); a comment is inline (kept
   * as trivia) when it ends on the same source line the following node starts on.
   */
  private _scanStandaloneComments(
    src: string,
    gapStart: number,
    gapEnd: number,
    followingStart: number | undefined,
    followingIsNestedRule: boolean,
    loc: LocationInfo
  ): JessNode[] {
    const comments: JessNode[] = [];
    let i = gapStart;
    while (i < gapEnd) {
      const c = src.charCodeAt(i);
      // Block comment: /* … */
      if (c === 47 /* / */ && src.charCodeAt(i + 1) === 42 /* * */) {
        let j = i + 2;
        while (j + 1 < gapEnd && !(src.charCodeAt(j) === 42 && src.charCodeAt(j + 1) === 47)) {
          j++;
        }
        const end = Math.min(j + 2, gapEnd);
        this._maybeEmitComment(src, i, end, followingStart, followingIsNestedRule, comments, loc);
        i = end;
        continue;
      }
      // Line comment: // … (to end of line)
      if (c === 47 /* / */ && src.charCodeAt(i + 1) === 47 /* / */) {
        let j = i + 2;
        while (j < gapEnd && src.charCodeAt(j) !== 10 && src.charCodeAt(j) !== 13) {
          j++;
        }
        this._maybeEmitComment(src, i, j, followingStart, followingIsNestedRule, comments, loc);
        i = j;
        continue;
      }
      i++;
    }
    return comments;
  }

  /**
   * Emit a `Comment` for `src[start, end)` unless it is inline — i.e. it ends on
   * the same source line the following node starts on (reproduces
   * `isStandaloneRuleComment`: `next?.location?.[1] === token.endLine` → not
   * standalone). Node locations in this parser carry offsets but zeroed lines, so
   * lines are derived from `src` here.
   */
  private _maybeEmitComment(
    src: string,
    start: number,
    end: number,
    followingStart: number | undefined,
    followingIsNestedRule: boolean,
    out: JessNode[],
    loc: LocationInfo
  ) {
    // A comment on the same source line as the FOLLOWING node stays inline (trivia)
    // ONLY when that node is a nested ruleset/selector: its leading trivia is
    // recovered from the position-indexed trivia map at serialize time (`a { /*x*/
    // b {…} }`). Same-line comments ahead of a DECLARATION are lifted to `Comment`
    // nodes instead, so they survive eval — which transforms the tree and drops the
    // trivia map (`#x { /* c *​/ prop: val }`).
    if (followingIsNestedRule && followingStart !== undefined && this._sameLine(src, end - 1, followingStart)) {
      return;
    }
    out.push(new Comment(src.slice(start, end), undefined, loc) as unknown as JessNode);
  }

  /**
   * Whether offsets `a` and `b` sit on the same source line — true iff no `\n`
   * lies between them. Scans only the (small) span between the two offsets, NOT
   * from the start of the source: the previous absolute-line-number form was
   * O(offset) per call and O(n²) across a comment-dense file.
   */
  private _sameLine(src: string, a: number, b: number): boolean {
    const lo = Math.min(a, b);
    const hi = Math.min(Math.max(a, b), src.length);
    for (let i = lo; i < hi; i++) {
      if (src.charCodeAt(i) === 10 /* \n */) {
        return false;
      }
    }
    return true;
  }

  protected _buildStylesheet(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const nodes = nodeChildren(children);
    const lifted = this._liftStandaloneComments(nodes, loc[0], loc[3], loc);
    return new Rules(lifted, undefined, loc);
  }

  protected _buildRuleset(
    children: ReadonlyArray<Child>,
    rawChildren: ReadonlyArray<{ _tag: string }>,
    loc: LocationInfo
  ) {
    const selector = readRulesetSelector(children);
    const sel = spannedComponents(rawChildren)[0];
    const selectorSpan = sel?.span ?? firstRawNodeSpan(rawChildren);
    const rawRules = nodeChildren(children.slice(1));
    const braceIdx = this._source.indexOf('{', selectorSpan ? selectorSpan.end : loc[0]);
    const bodyStart = braceIdx >= 0 ? braceIdx + 1 : loc[0];
    const closeIdx = this._source.lastIndexOf('}', loc[3] - 1);
    const bodyEnd = closeIdx >= bodyStart ? closeIdx : loc[3];
    const rules = this._liftStandaloneComments(rawRules, bodyStart, bodyEnd, loc);
    const node = new Ruleset({ selector, rules }, undefined, loc);
    if (selectorSpan) {
      const { index, count } = fieldIndexOf(node as unknown as JessNode, 'selector');
      if (index >= 0) {
        setFieldSpan(node as unknown as JessNode, index, count, selectorSpan);
      }
    }
    if (Array.isArray(selector)) {
      const memberSpans = selectorListSpans.get(selector) ?? selectorListMemberSpans(rawChildren);
      if (memberSpans && memberSpans.length === selector.length) {
        setValueSpans(node as unknown as JessNode, memberSpans);
      }
    }
    return node;
  }

  // ── Selector-node construction seams ───────────────────────────────────────
  // `SelectorList` and `BasicSelector` are slated for removal: a selector list
  // becomes a plain array, and a basic selector becomes a bare string. Every
  // functional-builder construction routes through these two helpers so that
  // migration is a one-line change here instead of ~20 scattered edits.
  protected _makeSelectorList(items: unknown, _loc: LocationInfo): (Selector | string)[] {
    return items as (Selector | string)[];
  }

  protected _makeBasicSelector(value: string, _loc: LocationInfo): string {
    return value;
  }

  protected _valueKeyword(text: string, loc: LocationInfo): Keyword {
    return new Keyword(text, undefined, loc);
  }

  protected _buildSelectorList(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const items = spannedComponents(rawChildren).filter(i => i.comp !== ',');
    if (items.length === 1) {
      return items[0]!.comp as unknown as JessNode;
    }
    const list = this._makeSelectorList(items.map(i => i.comp), loc) as object;
    selectorListSpans.set(list, items.map(i => i.span));
    return list as unknown as JessNode;
  }

  protected _buildComplexSelector(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const items = spannedComponents(rawChildren);
    if (items.length === 1) {
      return items[0]!.comp as unknown as JessNode;
    }
    const node = new ComplexSelector(
      items.map(i => i.comp) as unknown as ComplexSelectorValue,
      undefined, loc
    );
    setValueSpans(node as unknown as JessNode, items.map(i => i.span));
    return node;
  }

  protected _buildCompoundSelector(
    rawChildren: ReadonlyArray<{ _tag: string }>,
    span: Span
  ) {
    const loc = spanToLocation(span);
    const parts: Component[] = [];
    const partSpans: Span[] = [];
    let group: Spanned[] = [];

    const flush = () => {
      if (group.length === 0) {
        return;
      }
      if (group.length === 1) {
        parts.push(group[0]!.comp);
        partSpans.push(group[0]!.span);
      } else {
        const start = group[0]!.span.start;
        const end = group[group.length - 1]!.span.end;
        const compound = new CompoundSelector(
          group.map(g => g.comp) as unknown as CompoundSelectorComponent[],
          undefined,
          spanToLocation({ start, end })
        );
        setValueSpans(compound as unknown as JessNode, group.map(g => g.span));
        parts.push(compound as unknown as JessNode);
        partSpans.push({ start, end });
      }
      group = [];
    };

    let prevEnd = span.start;
    for (const rc of rawChildren as Array<{ _tag: string; value?: string; span?: Span }>) {
      if ((rc._tag !== 'leaf' && rc._tag !== 'node') || !rc.span) {
        continue;
      }
      if (group.length > 0 && hasWhitespaceOutsideComments(this._source, prevEnd, rc.span.start)) {
        const prevSpanEnd = group[group.length - 1]!.span.end;
        flush();
        parts.push(' ');
        partSpans.push({ start: prevSpanEnd, end: rc.span.start });
      }
      group.push({
        comp: rc._tag === 'leaf' ? (rc.value ?? '') : (rc as unknown as JessNode),
        span: rc.span
      });
      prevEnd = rc.span.end;
    }
    flush();

    if (parts.length === 1) {
      return parts[0]! as unknown as JessNode;
    }
    const node = new ComplexSelector(parts as unknown as ComplexSelectorValue, undefined, loc);
    setValueSpans(node as unknown as JessNode, partSpans);
    return node;
  }

  protected _buildAttributeSelector(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children
      .filter((c): c is CSTLeaf => c._tag === 'leaf')
      .filter(l => l.value !== '[' && l.value !== ']');
    const name = ls[0]?.value ?? '';
    const opRe = /^[*~|^$]?=$/;
    const opIdx = ls.findIndex(l => opRe.test(l.value));
    const rawValue = opIdx >= 0 ? ls[opIdx + 1]?.value : undefined;
    const attrNode: AttributeSelectorValue = {
      name,
      ...(opIdx >= 0 ? { op: ls[opIdx]!.value } : {}),
      ...(rawValue !== undefined ? { value: this._attrValueNode(rawValue, loc) } : {}),
      ...(opIdx >= 0 && ls[opIdx + 2] ? { mod: ls[opIdx + 2]!.value } : {})
    };
    return new AttributeSelector(attrNode, undefined, loc);
  }

  protected _attrValueNode(raw: string, loc: LocationInfo) {
    if ((raw.startsWith('\'') && raw.endsWith('\'')) || (raw.startsWith('"') && raw.endsWith('"'))) {
      return new Quoted(raw.slice(1, -1), { quote: raw[0] as '"' | '\'' }, loc);
    }
    return new Any(raw, {}, loc);
  }

  protected _buildPseudoSelector(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const prefix = ls[0]?.value ?? ':';
    const pseudoName = ls[1]?.value ?? '';
    const { arg, memberSpans, valueSpans } = readPseudoArg(children, pseudoName);
    const node = new PseudoSelector(
      { name: prefix + pseudoName, arg: arg as Node | undefined },
      undefined,
      loc
    );
    if (memberSpans) {
      setValueSpans(node as unknown as JessNode, memberSpans);
    } else if (valueSpans) {
      (node as unknown as { valueSpans?: number[] }).valueSpans = valueSpans;
    }
    return node;
  }

  protected _buildDeclaration(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const items = spannedComponents(rawChildren);
    const nameItem = items[0];
    const name = (typeof nameItem?.comp === 'string' ? nameItem.comp : '') || '';
    const colonIdx = items.findIndex(i => i.comp === ':');
    let end = items.length;
    let bangIdx = -1;
    for (let i = colonIdx + 1; i < items.length; i++) {
      const c = items[i]!.comp;
      if (c === '!') {
        end = i;
        bangIdx = i;
        break;
      }
      if (c === 'important' || c === ';') {
        end = i;
        break;
      }
    }
    const valueItems = items.slice(colonIdx + 1, end);
    const { value, span: valueSpan } = this._assembleValue(valueItems, loc);
    // `important` is the verbatim source text (`!important`, `! important`, …),
    // not a boolean — the declaration stores the string it will re-emit.
    let important: string | undefined;
    if (bangIdx >= 0) {
      const bang = items[bangIdx]!;
      const kw = items[bangIdx + 1];
      const impEnd = kw && typeof kw.comp === 'string' && kw.comp.toLowerCase() === 'important'
        ? kw.span.end
        : bang.span.end;
      important = this._source.slice(bang.span.start, impEnd);
    }
    const node = new Declaration(
      { name, value, important },
      undefined, loc
    );
    const jn = node as unknown as JessNode;
    const { index: nameIdx, count } = fieldIndexOf(jn, 'name');
    if (nameItem && nameIdx >= 0) {
      setFieldSpan(jn, nameIdx, count, nameItem.span);
    }
    const valueIdx = fieldIndexOf(jn, 'value').index;
    if (valueSpan && valueIdx >= 0) {
      setFieldSpan(jn, valueIdx, count, valueSpan);
    }
    return node;
  }

  protected _assembleValue(items: Spanned[], loc: LocationInfo): { value: Component; span: Span | undefined } {
    const content = items.filter(i => i.comp !== ',');
    if (content.length === 0) {
      return { value: '', span: undefined };
    }
    const span: Span = {
      start: content[0]!.span.start,
      end: content[content.length - 1]!.span.end
    };
    const segments: Spanned[][] = [[]];
    for (const it of items) {
      if (it.comp === ',') {
        segments.push([]);
      } else {
        segments.at(-1)!.push(it);
      }
    }
    const filledSegments = segments.filter(seg => seg.length > 0);
    const segValues = filledSegments.map(seg => this._assembleSegment(seg, loc));
    if (segValues.length === 1) {
      return { value: segValues[0]!, span };
    }
    const listValues = segValues.map((v) => {
      if (Array.isArray(v)) {
        return v.map(c => typeof c === 'string' ? this._valueKeyword(c, loc) as unknown as Component : c);
      }
      if (typeof v === 'string') {
        return this._valueKeyword(v, loc) as unknown as Component;
      }
      return v;
    });
    const list = new List(listValues as unknown as Node[], undefined, loc);
    if (filledSegments.length) {
      setValueSpans(list as unknown as JessNode, filledSegments.map(seg => ({
        start: seg[0]!.span.start,
        end: seg[seg.length - 1]!.span.end
      })));
    }
    return { value: list as unknown as Component, span };
  }

  protected _assembleSegment(seg: Spanned[], loc: LocationInfo): Component {
    if (seg.length === 1) {
      return seg[0]!.comp;
    }
    const grouped = this._groupSlashes(seg.map(s => s.comp), loc);
    if (grouped.length === 1) {
      return grouped[0]!;
    }
    return grouped as unknown as Component;
  }

  protected _groupSlashes(comps: Component[], loc: LocationInfo): Component[] {
    if (!comps.includes('/' as unknown as Component)) {
      return comps;
    }
    const asNode = (c: Component): Component =>
      typeof c === 'string' ? (this._valueKeyword(c, loc) as unknown as Component) : c;
    const out: Component[] = [];
    let i = 0;
    while (i < comps.length) {
      if (i + 1 < comps.length && comps[i + 1] === ('/' as unknown as Component)) {
        const run: Component[] = [asNode(comps[i]!)];
        i += 1;
        while (i < comps.length && comps[i] === ('/' as unknown as Component)) {
          i += 1;
          if (i < comps.length) {
            run.push(asNode(comps[i]!));
            i += 1;
          }
        }
        out.push(new List(run as unknown as Node[], { sep: '/' } as any, loc) as unknown as Component);
      } else {
        out.push(comps[i]!);
        i += 1;
      }
    }
    return out;
  }

  /**
   * Fold one precedence level's flat `operand op operand …` children (from the
   * grammar's Product / Sum rules) into a left-associative Operation chain. A
   * Product level only ever carries `* / %`, a Sum level only `+ -`, so this single
   * left-fold serves both. `/` divides only when `slashEnabled` and both operands
   * are division-like (port of expressionProduct's shouldParseSlashDivision); else
   * it accumulates into a slash-List. `slashEnabled` is true in a math context
   * (in-parens / calc); a top-level Operation passes false unless `mathMode:always`.
   */
  protected _buildOperation(
    children: ReadonlyArray<JessNode | CSTLeaf | CSTError>,
    loc: LocationInfo,
    slashEnabled: boolean
  ): JessNode {
    const asOperand = (c: unknown): unknown =>
      c && typeof c === 'object' && (c as { _tag?: string })._tag === 'leaf'
        ? this._valueKeyword((c as CSTLeaf).value, loc)
        : c;
    const opOf = (c: unknown): string =>
      c && typeof c === 'object' && (c as { _tag?: string })._tag === 'leaf'
        ? (c as CSTLeaf).value.trim()
        : '';
    let left: unknown = asOperand(children[0]);
    for (let i = 1; i + 1 < children.length; i += 2) {
      const op = opOf(children[i]);
      const right = asOperand(children[i + 1]);
      if (op === '/' && !(slashEnabled && this._isDivisionLike(left) && this._isDivisionLike(right))) {
        const leftList = left as { type?: string; value?: unknown[]; options?: { sep?: string } };
        left = leftList && leftList.type === 'List' && leftList.options?.sep === '/'
          ? new List([...leftList.value!, right] as unknown as Node[], { sep: '/' }, loc) as unknown as JessNode
          : new List([left, right] as unknown as Node[], { sep: '/' }, loc) as unknown as JessNode;
      } else {
        left = new Operation(
          [left, op, right] as unknown as ConstructorParameters<typeof Operation>[0],
          undefined, loc
        ) as unknown as JessNode;
      }
    }
    return left as JessNode;
  }

  /**
   * Operands a `/` can divide (isDivisionLikeNode, values.ts). A Paren/Expression
   * defers to its inner value. Anything else keeps `/` as a slash-list separator.
   */
  protected _isDivisionLike(node: unknown): boolean {
    if (!node || typeof node !== 'object') {
      return false;
    }
    const t = (node as { type?: string }).type;
    if (t && ['Color', 'Dimension', 'Num', 'Reference', 'Call', 'Operation', 'Negative', 'Expression'].includes(t)) {
      return true;
    }
    if (t === 'Paren' || t === 'Expression') {
      return this._isDivisionLike((node as { value?: unknown }).value);
    }
    return false;
  }

  protected _buildCustomDeclaration(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const propName = ls[0]?.value ?? '';
    const valueText = ls.slice(2).filter(l => l.value !== ';').map(l => l.value).join('').trim();
    return new CustomDeclaration(
      { name: propName, value: new Any(valueText, {}, loc) },
      undefined, loc
    );
  }

  protected _buildDimension(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    return new Dimension(
      { number: parseFloat(ls[0]?.value ?? '0'), unit: ls[1]?.value ?? '' },
      undefined, loc
    );
  }

  protected _buildColor(text: string, loc: LocationInfo) {
    return new Color(text, { format: ColorFormat.HEX }, loc);
  }

  protected _buildUrl(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const innerNode = nodeChildren(children)[0];
    if (innerNode) {
      return new Url(innerNode as Node, undefined, loc);
    }
    const inner = ls
      .filter(l => !/^url\($/i.test(l.value) && l.value !== ')')
      .map(l => l.value).join('').trim();
    return new Url(inner as unknown as Node, undefined, loc);
  }

  protected _buildCall(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo): JessNode {
    const items = spannedComponents(rawChildren);
    const name = typeof items[0]?.comp === 'string' ? items[0]!.comp : '';
    if (!items.some(it => it.comp === '(')) {
      return this._valueKeyword(name, loc) as unknown as JessNode;
    }
    const inner = this._betweenParens(items);
    // Arithmetic (calc bodies, nested groups) is folded into Operation nodes by the
    // grammar's math rules in both the CSS and Less grammars, so `inner` already
    // carries the built expression — no builder-side precedence fold is needed.
    const args = this._assembleArgs(inner, loc);
    return new Call({ name, args: args as unknown as List<Node> }, undefined, loc);
  }

  protected _buildParen(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const inner = this._betweenParens(spannedComponents(rawChildren));
    // Arithmetic inside the paren is already folded into an Operation node by the
    // grammar (calcParen / Less mathSum), so `inner` carries the built expression —
    // assemble directly.
    const { value } = this._assembleValue(inner, loc);
    return new Paren(value as unknown as Node, undefined, loc);
  }

  protected _buildSquareParen(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const items = spannedComponents(rawChildren);
    const open = items.findIndex(i => i.comp === '[');
    let close = items.length;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i]!.comp === ']') {
        close = i;
        break;
      }
    }
    const inner = items.slice(open + 1, close);
    const { value } = this._assembleValue(inner, loc);
    return new Paren(value as unknown as Node, { delimiter: 'square' } as any, loc);
  }

  protected _betweenParens(items: Spanned[]): Spanned[] {
    const open = items.findIndex(i => i.comp === '(');
    let close = items.length;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i]!.comp === ')') {
        close = i;
        break;
      }
    }
    return items.slice(open + 1, close);
  }

  protected _assembleArgs(items: Spanned[], loc: LocationInfo): List {
    if (items.some(it => it.comp === ';')) {
      const semiSegs: Spanned[][] = [[]];
      for (const it of items) {
        if (it.comp === ';') {
          semiSegs.push([]);
        } else {
          semiSegs.at(-1)!.push(it);
        }
      }
      const parts = semiSegs.filter(s => s.length > 0).map((s) => {
        const arg = this._assembleArgs(s, loc);
        const items = (arg as List<Node>).value;
        const sep = (arg as List<Node>).options?.sep;
        if (!sep && items?.length === 1) {
          return items[0]!;
        }
        return arg;
      });
      return new List(parts as unknown as Node[], { sep: ';' } as any, loc);
    }
    const segments: Spanned[][] = [[]];
    for (const it of items) {
      if (it.comp === ',') {
        segments.push([]);
      } else {
        segments.at(-1)!.push(it);
      }
    }
    const nonEmpty = segments.filter(s => s.length > 0);
    const values = nonEmpty.map((seg) => {
      const assembled = this._assembleSegment(seg, loc);
      if (Array.isArray(assembled)) {
        return (assembled as Component[]).map(c => this._argComponent(c, loc));
      }
      return this._argComponent(assembled, loc);
    });
    const list = new List(values as unknown as Node[], undefined, loc);
    if (nonEmpty.length) {
      setValueSpans(list as unknown as JessNode, nonEmpty.map(seg => ({
        start: seg[0]!.span.start,
        end: seg[seg.length - 1]!.span.end
      })));
    }
    return list;
  }

  protected _argComponent(comp: Component, loc: LocationInfo): Component {
    const colored = this._colorize(comp, loc);
    if (typeof colored === 'string') {
      return this._valueKeyword(colored, loc) as unknown as Component;
    }
    return colored;
  }

  protected _colorize(comp: Component, loc: LocationInfo): Component {
    const text = typeof comp === 'string'
      ? comp
      : comp instanceof Keyword
        ? comp.valueOf()
        : undefined;
    if (text && CSS_COLOR_NAMES.has(text.toLowerCase())) {
      return new Color({ node: text }, {}, loc) as unknown as Component;
    }
    return comp;
  }

  protected _buildQuoted(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const text = leafText(children);
    return new Quoted(text.slice(1, -1), { quote: text[0] as '"' | '\'' }, loc);
  }

  protected _buildAtRuleBlock(children: ReadonlyArray<Child>, loc: LocationInfo): JessNode | string {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const name = ls[0]?.value ?? '';
    // The prelude is the single scanTo leaf between the at-keyword and `{`.
    const preludeLeaf = ls[1] && ls[1].value !== '{' && ls[1].value !== '}' ? ls[1] : undefined;
    const preludeText = preludeLeaf?.value.trim();
    // Give the prelude its own span (not the whole at-rule's loc) so before/after
    // trivia lookups anchor to the prelude edges. Trailing trivia is already
    // excluded from the leaf by the atPrelude sentinel.
    const preludeLoc = preludeLeaf?.span ? spanToLocation(preludeLeaf.span) : loc;
    const preludeNode = preludeText
      ? new List(
        preludeText.split(/[ \t\n\r\f]+/).map(tok => new Any(tok, { role: 'ident' }, preludeLoc)),
        undefined, preludeLoc
      )
      : undefined;
    return new AtRule(
      { name, prelude: preludeNode, rules: nodeChildren(children) },
      undefined, loc
    );
  }

  protected _buildAtRuleStatement(children: ReadonlyArray<Child>, loc: LocationInfo): JessNode | string {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const name = ls[0]?.value ?? '';
    if (name.toLowerCase() === '@charset') {
      const text = this._source.slice(loc[0], loc[3]);
      return new Any(text, { role: 'charset' }, loc);
    }
    const preludeText = ls.slice(1).filter(l => l.value !== ';').map(l => l.value).join('').trim();
    return new AtRuleStatement(
      { name, prelude: preludeText ? new Any(preludeText, {}, loc) : undefined },
      undefined, loc
    );
  }

  /**
   * An unknown at-rule with a `{}` block. The block is opaque (the UA owns its
   * meaning), so it is scanned over without parsing or erroring — we keep the
   * name and prelude text and drop the opaque body.
   */
  protected _buildUnknownAtRuleBlock(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const name = ls[0]?.value ?? '';
    const braceIdx = ls.findIndex(l => l.value === '{');
    const preludeText = (braceIdx > 1 ? ls.slice(1, braceIdx) : [])
      .map(l => l.value).join('').trim();
    const prelude = preludeText ? new Any(preludeText, {}, loc) : undefined;
    return new AtRule({ name, prelude: prelude as unknown as Node, rules: [] }, undefined, loc) as unknown as JessNode;
  }

  /**
   * A media/container feature inside `(...)`. Node shapes (improved over the
   * Chevrotain `Any(x,{role})` wrapping): `name <op> value` → QueryCondition with
   * the name and operator as PLAIN STRINGS and a real value node; `name: value`
   * → Declaration; a bare boolean feature → QueryCondition(['name']).
   */
  protected _buildQueryFeature(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const nodes = nodeChildren(children);
    const name = ls[0]?.value ?? '';
    if (ls[1]?.value === ':') {
      const value = nodes[0] ?? new Any('', {}, loc);
      return new Declaration({ name, value: value as unknown as Node }, undefined, loc) as unknown as JessNode;
    }
    if (ls.length >= 2) {
      const parts: Array<string | Node> = [name];
      let ni = 0;
      for (let i = 1; i < ls.length; i++) {
        parts.push(ls[i]!.value);
        if (nodes[ni]) {
          parts.push(nodes[ni++]!);
        }
      }
      return new QueryCondition(parts as unknown as Node[], undefined, loc) as unknown as JessNode;
    }
    return new QueryCondition([name] as unknown as Node[], undefined, loc) as unknown as JessNode;
  }

  /** `( condition | feature )` → Paren(inner). */
  protected _buildQueryInParens(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const inner = nodeChildren(children)[0];
    return new Paren(inner as unknown as Node, undefined, loc) as unknown as JessNode;
  }

  /**
   * `not (X)` → QueryCondition([Keyword('not'), Paren]); `(X) (and|or) (Y)…` →
   * QueryCondition([Paren, Keyword('and'), Paren, …]); a single `(X)` passes the
   * Paren through unwrapped (matching the Chevrotain "single node returns directly").
   */
  protected _buildQueryConditionRule(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const opLeaves = children.filter(
      (c): c is CSTLeaf => c._tag === 'leaf' && /^(?:not|and|or)$/i.test((c as CSTLeaf).value)
    );
    const nodes = nodeChildren(children);
    if (opLeaves[0]?.value.toLowerCase() === 'not') {
      return new QueryCondition(
        [new Keyword('not', undefined, loc), nodes[0]!] as unknown as Node[], undefined, loc
      ) as unknown as JessNode;
    }
    if (opLeaves.length === 0) {
      return nodes[0] as JessNode;
    }
    const parts: Node[] = [nodes[0]!];
    let ni = 1;
    for (const op of opLeaves) {
      parts.push(new Keyword(op.value, undefined, loc) as unknown as Node);
      if (nodes[ni]) {
        parts.push(nodes[ni++]!);
      }
    }
    return new QueryCondition(parts, undefined, loc) as unknown as JessNode;
  }

  /** `@media/@container/@supports <queryPrelude> { body }` → AtRule with a parsed
   *  Sequence prelude (query conditions + optional leading container name). */
  protected _buildQueryAtRuleBlock(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const name = ls[0]?.value ?? '';
    const braceIdx = children.findIndex(c => c._tag === 'leaf' && (c as CSTLeaf).value === '{');
    const preludeChildren = braceIdx >= 0 ? children.slice(1, braceIdx) : children.slice(1);
    const bodyChildren = braceIdx >= 0 ? children.slice(braceIdx + 1) : [];
    const nameLeaf = preludeChildren.find(
      (c): c is CSTLeaf => c._tag === 'leaf' && (c as CSTLeaf).value !== ','
    );
    const preludeItems: Node[] = [];
    if (nameLeaf) {
      preludeItems.push(new Any(nameLeaf.value, { role: 'ident' }, loc) as unknown as Node);
    }
    preludeItems.push(...nodeChildren(preludeChildren));
    const prelude = new Sequence(preludeItems, undefined, loc);
    return new AtRule(
      { name, prelude: prelude as unknown as Node, rules: nodeChildren(bodyChildren) },
      undefined, loc
    ) as unknown as JessNode;
  }
  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
}
