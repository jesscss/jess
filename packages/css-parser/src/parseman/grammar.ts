/**
 * CssParser — Parséman-based CSS parser producing Jess core AST nodes.
 *
 * Convention:
 *   Capital rules   → CST node via buildNode(); type name should match Jess node
 *                     type names (needed for incremental re-parsing).
 *   Lowercase rules → transparent helpers; their tokens bubble into the
 *                     nearest enclosing capital rule.
 *
 * Trivia (whitespace + block comments) is registered via `_trivia` and
 * auto-skipped between sequence terms — no explicit whitespace in rules.
 *
 * Thunk parameters typed as `any` to avoid "type instantiation is excessively
 * deep" errors on large mutual-recursive grammars. Runtime safety comes from
 * the combinator library, not the static type.
 */

import {
  Parser,
  sequence,
  choice,
  many,
  oneOrMore,
  optional,
  regex,
  literal,
  not,
  scanTo,
  balanced
} from 'parseman';
import type { Span, RuleKeys } from 'parseman';
import type { CSTLeaf, CSTError } from 'parseman';
import { buildTriviaIndex } from 'parseman';
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
  createTriviaMap,
  nil,
  Rules, Ruleset,
  type Selector,
  BasicSelector, CompoundSelector, type CompoundSelectorComponent,
  ComplexSelector, type ComplexSelectorValue,
  Combinator,
  SelectorList,
  Declaration, CustomDeclaration,
  Any, Dimension, Num, Color, ColorFormat,
  Sequence, List,
  Call, Paren, Url,
  Quoted,
  AtRule, AtRuleStatement,
  AttributeSelector, type AttributeSelectorValue,
  PseudoSelector
} from '@jesscss/core';

// ---------------------------------------------------------------------------
// Regex fragments — used ONLY to build single-regex token rules.
// ---------------------------------------------------------------------------

const nonAscii = '\\u0080-\\uffff';
const nmStart  = `[_a-zA-Z${nonAscii}]`;
const nmChar   = `[-_a-zA-Z0-9${nonAscii}]`;

// Matches input that is ENTIRELY trailing trivia: whitespace, block comments,
// or line comments. Used to decide whether content left unconsumed after a
// whole-document parse is a real error or just trailing trivia.
const TRAILING_TRIVIA_ONLY = /^(?:\s|\/\*(?:[^*]|\*(?!\/))*\*\/|\/\/[^\n\r]*)*$/;

const IDENT_RE = new RegExp(`-?${nmStart}${nmChar}*`);

// Recognized CSS color keywords (full match, case-insensitive). Exported so the
// Less grammar can reuse it instead of maintaining a parallel list.
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

// Pseudo-classes/elements whose argument is itself a selector (kept structured);
// any other (unknown) pseudo gets a generic component array as its argument.
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

// A built child may be a Node, a CSTLeaf, or — when a sub-rule collapsed to a
// plain string (e.g. a simple selector or plain-ident value) — a raw string.
export type Component = string | JessNode;

// Convert a raw child entry into an AST component: strings pass through, leaves
// become their text, nodes pass through. Trivia/errors are dropped (returns null).
export function toComponent(c: unknown): Component | null {
  if (typeof c === 'string') {
    return c;
  }
  if (c && typeof c === 'object' && '_tag' in c) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const tag = (c as { _tag: string })._tag;
    if (tag === 'leaf') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return (c as CSTLeaf).value;
    }
    if (tag === 'node') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return c as JessNode;
    }
  }
  return null;
}

// A non-trivia child with its source span. Leaves (including collapsed string
// results, recorded as spanned leaves by the framework) yield their text; nodes
// pass through. Trivia/errors are skipped.
export type Spanned = { comp: Component; span: Span };

export function spannedComponents(rawChildren: ReadonlyArray<{ _tag: string }>): Spanned[] {
  const out: Spanned[] = [];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  for (const rc of rawChildren as Array<{ _tag: string; value?: string; span?: Span }>) {
    if (rc._tag === 'leaf' && rc.span) {
      out.push({ comp: rc.value ?? '', span: rc.span });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    } else if (rc._tag === 'node' && (rc as unknown as JessNode).span) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      out.push({ comp: rc as unknown as JessNode, span: (rc as unknown as JessNode).span });
    }
  }
  return out;
}

// Record one direct-field source span (by childKeys index) on a node.
export function setFieldSpan(node: JessNode, fieldIndex: number, fieldCount: number, span: Span) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const n = node as unknown as { fieldSpans?: number[] };
  n.fieldSpans ??= createPackedFieldSpans(fieldCount);
  setPackedFieldSpan(n.fieldSpans, fieldIndex, span.start, span.end);
}

// Record per-segment source spans for an array-backed `value`.
export function setValueSpans(node: JessNode, spans: ReadonlyArray<Span>) {
  const packed = createPackedSegmentSpans(spans.length);
  spans.forEach((s, i) => setPackedSegmentSpan(packed, i, s.start, s.end));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  (node as unknown as { valueSpans?: number[] }).valueSpans = packed;
}

// childKeys index lookup for a node's static childKeys array.
export function fieldIndexOf(node: JessNode, key: string): { index: number; count: number } {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const keys = (node.constructor as unknown as { childKeys?: readonly string[] }).childKeys ?? [];
  return { index: keys.indexOf(key), count: keys.length };
}

// ---------------------------------------------------------------------------
// Parse result + trivia tokens
// ---------------------------------------------------------------------------

/** Minimal IToken-compatible trivia token (what TriviaMap consumers read). */
type TriviaToken = {
  image: string;
  startOffset: number;
  endOffset: number;
  tokenType: { name: string };
};

function makeTriviaToken(value: string, span: Span): TriviaToken {
  const isComment = value.startsWith('/*');
  return {
    image: value,
    startOffset: span.start,
    endOffset: span.end,
    tokenType: { name: isComment ? 'Comment' : 'WS' }
  };
}

function rawSpan(c: { span?: Span }): Span | undefined {
  const s = c.span;
  return s && typeof s.start === 'number' ? s : undefined;
}

export type CssParseResult<T extends Node = Node> = {
  tree: T;
  errors: Array<{ message: string; offset?: number }>;
  warnings: Array<{ message: string }>;
  trivia: TriviaMap;
};

// ---------------------------------------------------------------------------
// CssParser
// ---------------------------------------------------------------------------

export class CssParser extends Parser<JessNode> {
  // Trivia tokens — whitespace runs and block comments parsed *separately* so
  // capture records them as distinct tokens (and so whitespace, the descendant
  // combinator, is distinguishable from a comment-only gap).
  ws = regex(/[ \t\n\r\f]+/);
  comment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);

  // `rw` (declared before `_trivia` so it can reference it) consumes a run of
  // mixed whitespace and comments, each recorded as its own trivia token.
  rw = oneOrMore(choice(this.ws, this.comment));

  // Registers whitespace+comments as trivia; auto-skipped between sequence terms.
  protected override _trivia = this.rw;

  // Record consumed trivia as separate CSTTrivia tokens in rawChildren.
  protected override _captureTrivia = true;

  // Makes the rule name optional in parse(): parse(text) === parse('Stylesheet', text).
  // @ts-expect-error -- 'Stylesheet' is a valid RuleKeys<CssParser>; circular type inference prevents assignment
  protected override _defaultRule = 'Stylesheet' as const;

  /** Source text of the in-progress parse; used by builders that emit verbatim text. */
  protected _source = '';

  /**
   * When true, parse() reports an "Unexpected input" error if the top-level rule
   * stops before consuming the whole source (modulo trailing trivia). CSS leaves
   * this off (its fixture tests tolerate prefix parses); Less/SCSS/Jess enable it
   * so malformed inputs surface a hard parse error. */
  protected _strictEOF = false;

  /** Deprecation/diagnostic warnings collected by builders during a parse. */
  protected _warnings: Array<{ message: string; deprecation?: string }> = [];

  /** Record a warning (e.g. a deprecated Less construct) during buildNode. */
  protected _warn(message: string, deprecation?: string) {
    this._warnings.push(deprecation ? { message, deprecation } : { message });
  }

  ident = regex(IDENT_RE);

  singleStr = regex(/'(?:[^'\\]|\\[\s\S])*'/);
  doubleStr = regex(/"(?:[^"\\]|\\[\s\S])*"/);

  // Single-leaf tokens (no reconstruction from parts needed in builders).
  customProp = regex(new RegExp(`--${nmChar}*`));
  atKeyword  = regex(new RegExp(`@-?${nmStart}${nmChar}*`));

  // ── Root ──────────────────────────────────────────────────────────────────

  // many() skips leading trivia before each item, so no explicit rw is needed
  // here (and `unknown` no longer captures leading whitespace).
  Stylesheet = (g: any) => many(
    choice(g.AtRuleBlock, g.AtRuleStatement, g.Ruleset, g.unknown)
  );

  // ── Rulesets ─────────────────────────────────────────────────────────────

  Ruleset = (g: any) => sequence(
    g.SelectorList,
    literal('{'),
    g.declarationList,
    literal('}')
  );

  // ── Selectors ────────────────────────────────────────────────────────────

  SelectorList = (g: any) => sequence(
    g.ComplexSelector,
    many(sequence(literal(','), g.ComplexSelector))
  );

  // Absent combinator = descendant; detected structurally in _buildComplexSelector.
  ComplexSelector = (g: any) => sequence(
    g.CompoundSelector,
    many(sequence(optional(g.combinator), g.CompoundSelector))
  );

  // lowercase: combinator leaves bubble up to ComplexSelector
  combinator = choice(
    literal('||'),
    literal('>'),
    literal('+'),
    literal('~'),
    literal('|')
  );

  // oneOrMore skips trivia (whitespace) between simple selectors. buildNode
  // inspects rawChildren: if whitespace separates two simple selectors, the
  // result is reinterpreted as a ComplexSelector with a descendant combinator.
  CompoundSelector = (g: any) => oneOrMore(g.simpleSelector);

  // lowercase: actual node type comes from inner capital rule; basicSelector
  // contributes a plain string leaf (no node).
  simpleSelector = (g: any) => choice(
    g.AttributeSelector,
    g.PseudoSelector,
    g.basicSelector
  );

  // lowercase: a single simple selector (.class, #id, *, type) as one leaf.
  // (Keyframe percentage selectors like 0%/100% are handled in the dedicated
  // at-rule workstream — Ruleset rejects them as scanner-native string selectors.)
  basicSelector = regex(new RegExp(`(?:[.#]?-?${nmStart}${nmChar}*|\\*)`));

  AttributeSelector = (g: any) => sequence(
    literal('['),
    g.ident,
    optional(sequence(
      regex(/[*~|^$]?=/),
      choice(g.singleStr, g.doubleStr, g.ident),
      optional(regex(/[is]/i))
    )),
    literal(']')
  );

  PseudoSelector = (g: any) => sequence(
    regex(/::?/),
    g.ident,
    optional(sequence(literal('('), g.pseudoArg, literal(')')))
  );

  pseudoArg = (g: any) => choice(
    regex(/even|odd|[-+]?\d*n(?:[ \t\n\r\f]*[+-][ \t\n\r\f]*\d+)?|[-+]?\d+/i),
    g.SelectorList,
    scanTo(literal(')'), { skip: [balanced('(', ')')] })
  );

  // ── Declarations ─────────────────────────────────────────────────────────

  // many() skips leading trivia before each item — no explicit rw needed.
  declarationList = (g: any) => many(
    choice(
      g.Declaration,
      g.CustomDeclaration,
      g.Ruleset,            // CSS nesting: a nested ruleset in a declaration block
      literal(';'),
      sequence(g.unknown, optional(literal(';')))
    )
  );

  Declaration = (g: any) => sequence(
    g.ident,
    literal(':'),
    g.valueList,
    optional(g.important),
    optional(literal(';'))
  );

  CustomDeclaration = (g: any) => sequence(
    g.customProp,
    literal(':'),
    scanTo(
      choice(literal(';'), literal('}')),
      { skip: [balanced('(', ')'), balanced('[', ']'), balanced('{', '}')] }
    ),
    optional(literal(';'))
  );

  // lowercase: '!' and 'important' leaves bubble up to Declaration.
  // '!' is excluded from anyValue so ValueList stops before !important.
  important = (_g: any) => sequence(literal('!'), literal('important'));

  // ── Values ───────────────────────────────────────────────────────────────

  // lowercase: value content (nodes, plain-ident leaves, ',' separators) bubbles
  // directly into the enclosing capital rule (Declaration, etc.), so trivia and
  // exact token spans are preserved on that node rather than lost in a collapse.
  valueList = (g: any) => sequence(
    g.valueSequence,
    many(sequence(literal(','), g.valueSequence))
  );

  valueSequence = (g: any) => oneOrMore(g.value);

  // lowercase: value nodes appear directly as children of valueSequence
  value = (g: any) => choice(
    g.Dimension,
    g.Num,
    g.Color,
    g.Url,
    g.Call,
    g.Paren,
    g.Quoted,
    g.anyValue
  );

  numPart = regex(
    /[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?|\d+)/
  );

  Dimension = (g: any) => sequence(g.numPart, choice(g.ident, literal('%')));

  Num = (g: any) => sequence(
    g.numPart,
    not(regex(new RegExp(`[a-zA-Z${nonAscii}%]`)))
  );

  Color = regex(/#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])/);

  Url = (g: any) => sequence(
    regex(/url\(/i),
    optional(choice(g.singleStr, g.doubleStr, regex(/[^)"'\s]+/))),
    literal(')')
  );

  parenBody = (g: any) => sequence(
    optional(sequence(
      g.valueList,
      many(sequence(literal(';'), optional(g.valueList)))
    )),
    literal(')')
  );

  Call = (g: any) => sequence(g.ident, literal('('), g.parenBody);

  Paren = (g: any) => sequence(literal('('), g.parenBody);

  Quoted = (g: any) => choice(g.singleStr, g.doubleStr);

  // '!' excluded so ValueList stops cleanly before !important.
  anyValue = (g: any) => choice(
    g.ident,
    regex(/[+\-*/=<>|~^]+|[^\s;{}\[\]()'",!]+/)
  );

  // ── At-rules ─────────────────────────────────────────────────────────────

  // Scans to { or ; after trivia has positioned us past the @keyword.
  // scanTo always succeeds (empty string if sentinel is immediate).
  atPrelude = (g: any) => optional(
    scanTo(choice(literal('{'), literal(';')), {
      skip: [balanced('(', ')'), balanced('[', ']'), g.singleStr, g.doubleStr]
    })
  );

  AtRuleBlock = (g: any) => sequence(
    g.atKeyword,
    g.atPrelude,
    literal('{'),
    g.atRuleBody,
    literal('}')
  );

  AtRuleStatement = (g: any) => sequence(
    g.atKeyword,
    g.atPrelude,
    literal(';')
  );

  atRuleBody = (g: any) => many(
    choice(
      g.AtRuleBlock,
      g.AtRuleStatement,
      g.Ruleset,
      g.Declaration,
      g.CustomDeclaration,
      literal(';')
    )
  );

  unknown = scanTo(
    choice(literal(';'), literal('{'), literal('}'), literal(',')),
    { orEOF: true }
  );

  // ── buildNode ─────────────────────────────────────────────────────────────
  //
  // CST children arrive as Node<any,any>[] and must be placed into constructors
  // expecting specific structural subtypes. TypeScript cannot narrow through
  // the dynamic dispatch of buildNode(), so we opt out of the
  // no-unsafe-type-assertion rule for this bounded section only.
  /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */

  protected override buildNode(
    type: string,
    span: Span,
    children: ReadonlyArray<JessNode | CSTLeaf | CSTError>,
    state: unknown,
    rawChildren: ReadonlyArray<{ _tag: string }>
  ) {
    const node = this._dispatchBuild(type, span, children, rawChildren);
    // Retain the raw children (structural + trivia, in source order) on the node
    // so the parser can reconstruct a before/after trivia map after parsing.
    // Skip when the builder passed a child through unchanged (node is itself in
    // rawChildren) — that would create a self-referential cycle.
    if (node instanceof Node && rawChildren.length && !rawChildren.includes(node as { _tag: string })) {
      node._setCstChildren(rawChildren);
    }
    return node;
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
      case 'Paren':             return this._buildParen(rawChildren, loc);
      case 'Quoted':            return this._buildQuoted(children, loc);
      case 'AtRuleBlock':       return this._buildAtRuleBlock(children, loc) as unknown as JessNode;
      case 'AtRuleStatement':   return this._buildAtRuleStatement(children, loc);
      default:                  return new Any(leafText(children) || type, {}, loc);
    }
  }

  // ── Private AST builders ──────────────────────────────────────────────────

  protected _buildStylesheet(children: ReadonlyArray<Child>, loc: LocationInfo) {
    return new Rules(nodeChildren(children), undefined, loc);
  }

  protected _buildRuleset(
    children: ReadonlyArray<Child>,
    rawChildren: ReadonlyArray<{ _tag: string }>,
    loc: LocationInfo
  ) {
    // rawChildren = [selector (string|node, spanned), '{' leaf, ...rule nodes, '}' leaf]
    const sel = spannedComponents(rawChildren)[0];
    const selector = (sel?.comp ?? '') as string | Selector;
    const rules = nodeChildren(children.slice(1));
    const node = new Ruleset({ selector, rules }, undefined, loc);
    if (sel) {
      const { index, count } = fieldIndexOf(node as unknown as JessNode, 'selector');
      if (index >= 0) {
        setFieldSpan(node as unknown as JessNode, index, count, sel.span);
      }
    }
    return node;
  }

  protected _buildSelectorList(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    // Drop ',' separators; keep ComplexSelector results (string | node) + spans.
    const items = spannedComponents(rawChildren).filter(i => i.comp !== ',');
    if (items.length === 1) {
      return items[0]!.comp as unknown as JessNode;
    }
    const node = new SelectorList(
      items.map(i => i.comp) as unknown as (Selector | string)[],
      undefined, loc
    );
    setValueSpans(node as unknown as JessNode, items.map(i => i.span));
    return node;
  }

  protected _buildComplexSelector(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    // rawChildren = [CompoundSelector result (string|node), combinator leaf, ...].
    // Simple selectors and combinators are plain strings; only compound/attr/
    // pseudo selectors are nodes.
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
    // oneOrMore(simpleSelector) greedily collects simple selectors across any
    // trivia. Whitespace between two simple selectors is the descendant
    // combinator (a comment-only gap is NOT) — so we walk rawChildren and split
    // into a ComplexSelector (with a ' ' combinator string) whenever whitespace
    // separates adjacent simple selectors.
    const parts: Component[] = [];          // complex-level: compounds + ' '
    const partSpans: Span[] = [];
    let group: Spanned[] = [];
    let pendingWhitespace = false;

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

    let lastEnd = span.start;
    for (const rc of rawChildren as Array<{ _tag: string; value?: string; span?: Span }>) {
      if (rc._tag === 'trivia') {
        // Only a pure-whitespace token implies a descendant combinator; a comment
        // token (e.g. '/*x */', which may contain spaces internally) does not.
        if (/^[ \t\n\r\f]+$/.test(rc.value ?? '')) {
          pendingWhitespace = true;
        }
      } else if ((rc._tag === 'leaf' || rc._tag === 'node') && rc.span) {
        if (pendingWhitespace && group.length) {
          const prevEnd = group[group.length - 1]!.span.end;
          flush();
          // descendant combinator: a ' ' string sits between the two compounds
          parts.push(' ');
          partSpans.push({ start: prevEnd, end: rc.span.start });
        }
        group.push({ comp: rc._tag === 'leaf' ? (rc.value ?? '') : (rc as unknown as JessNode), span: rc.span });
        lastEnd = rc.span.end;
        pendingWhitespace = false;
      }
    }
    void lastEnd;
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

  // An attribute value that is a quoted string becomes a Quoted node; otherwise
  // a plain Any.
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
    const argNode = nodeChildren(children)[0] as Node | undefined;
    let arg = argNode;
    // Selector-accepting pseudos keep their parsed selector node; for unknown
    // pseudos the argument is a generic sequence, so flatten the speculatively
    // parsed selector back into its raw component array (preserving the node's
    // valueSpans on the PseudoSelector so the printer can recover trivia).
    let argValueSpans: number[] | undefined;
    if (argNode && !SELECTOR_PSEUDOS.has(pseudoName.toLowerCase())) {
      const v = (argNode as unknown as { value?: unknown }).value;
      if (Array.isArray(v)) {
        arg = v as unknown as Node;
        argValueSpans = (argNode as unknown as { valueSpans?: number[] }).valueSpans;
      }
    }
    const node = new PseudoSelector({ name: prefix + pseudoName, arg }, undefined, loc);
    if (argValueSpans) {
      (node as unknown as { valueSpans?: number[] }).valueSpans = argValueSpans;
    }
    return node;
  }

  protected _buildDeclaration(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    // items = [name (spanned), ':' , ...value content (spanned), '!'?, 'important'?, ';'?]
    const items = spannedComponents(rawChildren);
    const nameItem = items[0];
    const name = (typeof nameItem?.comp === 'string' ? nameItem.comp : '') || '';
    const colonIdx = items.findIndex(i => i.comp === ':');
    // value content runs from after ':' up to '!important' / ';'
    let end = items.length;
    for (let i = colonIdx + 1; i < items.length; i++) {
      const c = items[i]!.comp;
      if (c === '!' || c === 'important' || c === ';') {
        end = i;
        break;
      }
    }
    const valueItems = items.slice(colonIdx + 1, end);
    const { value, span: valueSpan } = this._assembleValue(valueItems, loc);
    const hasImportant = items.some(i => i.comp === '!');
    const node = new Declaration(
      { name, value, important: hasImportant || undefined },
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

  // Assemble a CSS value from its bubbled content items:
  //   - split on ',' into comma segments
  //   - each segment: one item → that item; many → a plain array (a sequence)
  //   - multiple segments → a List node
  // Returns the assembled value and its overall (trimmed) source span.
  protected _assembleValue(items: Spanned[], loc: LocationInfo): { value: Component; span: Span | undefined } {
    const content = items.filter(i => i.comp !== ',');
    if (content.length === 0) {
      return { value: new Any('', {}, loc), span: undefined };
    }
    const span: Span = {
      start: content[0]!.span.start,
      end: content[content.length - 1]!.span.end
    };

    // Split into comma-separated segments.
    const segments: Spanned[][] = [[]];
    for (const it of items) {
      if (it.comp === ',') {
        segments.push([]);
      } else {
        segments.at(-1)!.push(it);
      }
    }
    const segValues = segments.map(seg => this._assembleSegment(seg, loc));

    if (segValues.length === 1) {
      return { value: segValues[0]!, span };
    }
    // Inside a comma List, a multi-item (space-delimited) segment must be a
    // Sequence node so it serializes structurally rather than being stringified.
    // A lone space-array (single segment, handled above) stays a plain array.
    const listValues = segValues.map((v) => {
      if (!Array.isArray(v)) {
        return v;
      }
      const parts = (v as Component[]).map(c =>
        typeof c === 'string' ? (new Any(c, { role: 'ident' }, loc) as unknown as Component) : c);
      return new Sequence(parts as unknown as Node[], undefined, loc) as unknown as Component;
    });
    const list = new List(listValues as unknown as Node[], undefined, loc);
    setValueSpans(list as unknown as JessNode, segments.map(seg => ({
      start: seg[0]!.span.start,
      end: seg[seg.length - 1]!.span.end
    })));
    return { value: list as unknown as Component, span };
  }

  // One comma-segment: a single value passes through; multiple space-separated
  // values become a plain array (an ordered sequence with no operator).
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

  // Collapse '/'-separated runs (e.g. `small/20px`, `1/2/3`) into slash Lists.
  // Items without a neighbouring '/' pass through unchanged.
  protected _groupSlashes(comps: Component[], loc: LocationInfo): Component[] {
    if (!comps.includes('/' as unknown as Component)) {
      return comps;
    }
    // List children must be nodes (the serializer reads each child's location),
    // so bare ident strings in a slash run are coerced to Any[role=ident].
    const asNode = (c: Component): Component =>
      typeof c === 'string' ? (new Any(c, { role: 'ident' }, loc) as unknown as Component) : c;
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

  protected _buildCustomDeclaration(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const propName = ls[0]?.value ?? '';  // single leaf: '--foo-bar'
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
    // A node child that already parsed (Quoted url) passes through; otherwise the
    // raw url contents are a bare string.
    const innerNode = nodeChildren(children)[0];
    if (innerNode) {
      return new Url(innerNode as Node, undefined, loc);
    }
    const inner = ls
      .filter(l => !/^url\($/i.test(l.value) && l.value !== ')')
      .map(l => l.value).join('').trim();
    return new Url(inner as unknown as Node, undefined, loc);
  }

  protected _buildCall(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const items = spannedComponents(rawChildren);
    const name = typeof items[0]?.comp === 'string' ? items[0]!.comp : '';
    const args = this._assembleArgs(this._betweenParens(items), loc);
    return new Call({ name, args: args as unknown as List<Node> }, undefined, loc);
  }

  protected _buildParen(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const inner = this._betweenParens(spannedComponents(rawChildren));
    const { value } = this._assembleValue(inner, loc);
    return new Paren(value as unknown as Node, undefined, loc);
  }

  // The spanned items strictly inside the outermost '(' … ')'.
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

  // Function args: always a List, one element per comma-segment (each a value).
  protected _assembleArgs(items: Spanned[], loc: LocationInfo): List {
    // Semicolon-separated args take precedence: split on ';' and assemble each
    // part as its own (comma) arg list, wrapping in an outer List with sep ';'.
    if (items.some(it => it.comp === ';')) {
      const semiSegs: Spanned[][] = [[]];
      for (const it of items) {
        if (it.comp === ';') {
          semiSegs.push([]);
        } else {
          semiSegs.at(-1)!.push(it);
        }
      }
      const parts = semiSegs.filter(s => s.length > 0).map(s => this._assembleArgs(s, loc));
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
      // A space-delimited segment assembles to an array of components → wrap in a
      // Sequence so positional args like `extract(1 2 3, 2)` keep their grouping.
      if (Array.isArray(assembled)) {
        const parts = (assembled as Component[]).map(c => this._argComponent(c, loc));
        return new Sequence(parts as unknown as Node[], undefined, loc) as unknown as Component;
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

  // A function-argument component: colorize first (color keywords win), then a
  // remaining bare ident string becomes an Any[role=ident] node (args are nodes,
  // unlike plain declaration values which stay bare strings).
  protected _argComponent(comp: Component, loc: LocationInfo): Component {
    const colored = this._colorize(comp, loc);
    if (typeof colored === 'string') {
      return new Any(colored, { role: 'ident' }, loc) as unknown as Component;
    }
    return colored;
  }

  // A bare ident that is a recognized CSS color keyword becomes a Color node.
  protected _colorize(comp: Component, loc: LocationInfo): Component {
    if (typeof comp === 'string' && CSS_COLOR_NAMES.has(comp.toLowerCase())) {
      return new Color({ node: comp }, {}, loc) as unknown as Component;
    }
    return comp;
  }

  protected _buildQuoted(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const text = leafText(children);
    return new Quoted(text.slice(1, -1), { quote: text[0] as '"' | '\'' }, loc);
  }

  protected _buildAtRuleBlock(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const name = ls[0]?.value ?? '';  // single leaf: '@media' — kept as a string
    const preludeText = ls.slice(1)
      .find(l => l.value !== '{' && l.value !== '}')
      ?.value.trim();
    // Model the prelude as a List of ident tokens (whitespace-separated).
    const preludeNode = preludeText
      ? new List(
        preludeText.split(/[ \t\n\r\f]+/).map(tok => new Any(tok, { role: 'ident' }, loc)),
        undefined, loc
      )
      : undefined;
    return new AtRule(
      { name, prelude: preludeNode, rules: nodeChildren(children) },
      undefined, loc
    );
  }

  protected _buildAtRuleStatement(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const name = ls[0]?.value ?? '';  // kept as a string
    // @charset is modeled as a single verbatim Any token (role=charset), not a
    // structured at-rule — it must round-trip its exact source including spaces.
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
  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */

  // ── Public parse: tree + errors + warnings + trivia map ────────────────────

  // Overrides Parser.parse to return a Jess-shaped result: the built tree, any
  // parse errors/warnings, and a before/after trivia map reconstructed from the
  // trivia tokens captured on each node's rawChildren during parsing.
  // CssParseResult intentionally does not extend ParseDoc (different shape).
  // @ts-expect-error -- CssParseResult is wider than ParseDoc; intentional override
  override parse(input: string): CssParseResult<Rules>;
  // @ts-expect-error -- CssParseResult is wider than ParseDoc; intentional override
  override parse(ruleName: RuleKeys<this>, input: string): CssParseResult;
  // @ts-expect-error -- CssParseResult is wider than ParseDoc; intentional override
  override parse(a: string, b?: string): CssParseResult {
    /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
    // Stash the source so builders can recover exact (trivia-inclusive) text
    // for rules that serialize their whole span verbatim (e.g. @charset).
    this._source = b === undefined ? a : b;
    this._warnings = [];  // collected by builders during the parse below
    const doc = b === undefined
      ? super.parse(a as RuleKeys<this>)
      : super.parse(a as RuleKeys<this>, b);

    // Parseman builds the generic before/after trivia index from captured
    // rawChildren; we adapt its {value, span} tokens to Jess IToken-shaped
    // tokens for the TriviaMap.
    const index = buildTriviaIndex(doc.tree);
    const adapt = (m: Map<number, Array<{ value: string; span: Span }>>) => {
      const out = new Map<number, TriviaToken[]>();
      for (const [offset, run] of m) {
        out.set(offset, run.map(t => makeTriviaToken(t.value, t.span)));
      }
      return out;
    };

    const errors = doc.errors.map(e => ({
      message: e.expected?.join(', ') ?? 'Parse error',
      offset: e.span?.start
    }));

    // Completeness check: a tolerant top-level rule (e.g. Stylesheet's many())
    // can match a valid prefix and silently stop at malformed input. If the
    // built tree doesn't reach the end of the source (modulo trailing trivia),
    // the leftover is a parse error. Only applies to whole-document parses.
    if (this._strictEOF && doc.tree && errors.length === 0) {
      const end = doc.consumedEnd;
      const rest = this._source.slice(end);
      if (rest.length > 0 && !TRAILING_TRIVIA_ONLY.test(rest)) {
        errors.push({ message: 'Unexpected input', offset: end });
      }
    }

    return {
      tree: (doc.tree ?? nil()) as Node,
      errors,
      warnings: this._warnings.slice(),
      trivia: createTriviaMap({
        before: adapt(index.before) as unknown as Map<number, never[]>,
        after: adapt(index.after) as unknown as Map<number, never[]>
      })
    };
    /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
  }
}
