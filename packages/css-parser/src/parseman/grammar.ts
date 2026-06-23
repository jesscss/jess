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
import type { Span, Combinator, ParseContext, ParseResult } from 'parseman';
import type { CSTLeaf, CSTError } from 'parseman';

// Run a combinator with trivia disabled. Used for CompoundSelector to prevent
// whitespace (descendant combinator) from being consumed between simple selectors.
function noTrivia<T>(p: Combinator<T>): Combinator<T> {
  return {
    _tag: p._tag,
    _meta: p._meta,
    _def: p._def,
    parse(input: string, pos: number, ctx: ParseContext): ParseResult<T> {
      return p.parse(input, pos, { ...ctx, trivia: undefined });
    }
  };
}

import {
  type Node,
  type LocationInfo,
  Rules, Ruleset,
  type Selector,
  BasicSelector, CompoundSelector, type CompoundSelectorComponent,
  ComplexSelector, type ComplexSelectorValue,
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

const IDENT_RE = new RegExp(`-?${nmStart}${nmChar}*`);

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

// ---------------------------------------------------------------------------
// CssParser
// ---------------------------------------------------------------------------

export class CssParser extends Parser<JessNode> {
  // `rw` must be declared first so `_trivia = this.rw` can reference it.
  rw = regex(/(?:[ \t\n\r\f]+|\/\*(?:[^*]|\*(?!\/))*\*\/)+/);

  // Registers whitespace+comments as trivia; auto-skipped between sequence terms.
  protected override _trivia = this.rw;

  ident = regex(IDENT_RE);

  singleStr = regex(/'(?:[^'\\]|\\.)*'/);
  doubleStr = regex(/"(?:[^"\\]|\\.)*"/);

  // Single-leaf tokens (no reconstruction from parts needed in builders).
  customProp = regex(new RegExp(`--${nmChar}*`));
  atKeyword  = regex(new RegExp(`@-?${nmStart}${nmChar}*`));

  // ── Root ──────────────────────────────────────────────────────────────────

  // Leading optional(g.rw) is needed: many()'s trivia-retry only fires when
  // the item fails outright, but choice(..., unknown) is infallible (unknown
  // is a catch-all), so Ruleset would never get a trivia-retry opportunity.
  Stylesheet = (g: any) => many(
    sequence(optional(g.rw), choice(g.AtRuleBlock, g.AtRuleStatement, g.Ruleset, g.unknown))
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

  // noTrivia prevents whitespace from being silently consumed between simple
  // selectors. Without it, `.a .b` collapses into one CompoundSelector instead
  // of two (with an implicit descendant combinator between them).
  CompoundSelector = (g: any) => noTrivia(oneOrMore(g.simpleSelector));

  // lowercase: actual node type comes from inner capital rule
  simpleSelector = (g: any) => choice(
    g.AttributeSelector,
    g.PseudoSelector,
    g.BasicSelector
  );

  BasicSelector = (g: any) => choice(
    sequence(literal('.'), g.ident),
    sequence(literal('#'), g.ident),
    literal('*'),
    g.ident
  );

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

  // Same catch-all issue as Stylesheet: unknown makes choice infallible,
  // so leading optional(g.rw) is required for trivia to reach Declaration.
  declarationList = (g: any) => many(sequence(
    optional(g.rw),
    choice(
      g.Declaration,
      g.CustomDeclaration,
      literal(';'),
      sequence(g.unknown, optional(literal(';')))
    )
  ));

  Declaration = (g: any) => sequence(
    g.ident,
    literal(':'),
    g.ValueList,
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

  ValueList = (g: any) => sequence(
    g.ValueSequence,
    many(sequence(literal(','), g.ValueSequence))
  );

  ValueSequence = (g: any) => oneOrMore(g.value);

  // lowercase: value nodes appear directly as children of ValueSequence
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

  parenBody = (g: any) => sequence(optional(g.ValueList), literal(')'));

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

  protected buildNode(
    type: string,
    span: Span,
    children: ReadonlyArray<JessNode | CSTLeaf | CSTError>,
    _state: unknown,
    _rawChildren: ReadonlyArray<{ _tag: string }>
  ) {
    const loc = spanToLocation(span);
    switch (type) {
      case 'Stylesheet':        return this._buildStylesheet(children, loc);
      case 'Ruleset':           return this._buildRuleset(children, loc) as unknown as JessNode;
      case 'SelectorList':      return this._buildSelectorList(children, loc);
      case 'ComplexSelector':   return this._buildComplexSelector(children, span);
      case 'CompoundSelector':  return this._buildCompoundSelector(children, loc);
      case 'BasicSelector':     return new BasicSelector(leafText(children), undefined, loc);
      case 'AttributeSelector': return this._buildAttributeSelector(children, loc);
      case 'PseudoSelector':    return this._buildPseudoSelector(children, loc);
      case 'Declaration':       return this._buildDeclaration(children, loc);
      case 'CustomDeclaration': return this._buildCustomDeclaration(children, loc);
      case 'ValueList':         return this._buildValueList(children, loc);
      case 'ValueSequence':     return this._buildValueSequence(children, loc);
      case 'Dimension':         return this._buildDimension(children, loc);
      case 'Num':               return new Num(parseFloat(leafText(children)), undefined, loc);
      case 'Color':             return this._buildColor(leafText(children), loc);
      case 'Url':               return this._buildUrl(children, loc);
      case 'Call':              return this._buildCall(children, loc);
      case 'Paren':             return this._buildParen(children, loc);
      case 'Quoted':            return this._buildQuoted(children, loc);
      case 'AtRuleBlock':       return this._buildAtRuleBlock(children, loc) as unknown as JessNode;
      case 'AtRuleStatement':   return this._buildAtRuleStatement(children, loc);
      default:                  return new Any(leafText(children) || type, {}, loc);
    }
  }

  // ── Private AST builders ──────────────────────────────────────────────────

  private _buildStylesheet(children: ReadonlyArray<Child>, loc: LocationInfo) {
    return new Rules(nodeChildren(children), undefined, loc);
  }

  private _buildRuleset(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const nodes = nodeChildren(children);
    return new Ruleset({
      selector: (nodes[0] ?? new Any('', {}, loc)) as unknown as Selector,
      rules: nodes.slice(1)
    }, undefined, loc);
  }

  private _buildSelectorList(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const sels = nodeChildren(children);
    if (sels.length === 1) {
      return sels[0]!;
    }
    return new SelectorList(sels as unknown as (Selector | string)[], undefined, loc);
  }

  private _buildComplexSelector(children: ReadonlyArray<Child>, span: Span) {
    const loc = spanToLocation(span);
    const parts: (JessNode | string)[] = [];
    let prevWasNode = false;
    for (const c of children) {
      if (c._tag === 'node') {
        // Two adjacent compound nodes with no intervening combinator leaf = descendant
        if (prevWasNode) {
          parts.push(' ');
        }
        parts.push(c as JessNode);
        prevWasNode = true;
      } else if (c._tag === 'leaf' && (c as CSTLeaf).value) {
        parts.push((c as CSTLeaf).value);
        prevWasNode = false;
      }
    }
    if (parts.length === 1 && typeof parts[0] !== 'string') {
      return parts[0]!;
    }
    return new ComplexSelector(parts as unknown as ComplexSelectorValue, undefined, loc);
  }

  private _buildCompoundSelector(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const parts = nodeChildren(children);
    if (parts.length === 1) {
      return parts[0]!;
    }
    return new CompoundSelector(parts as unknown as CompoundSelectorComponent[], undefined, loc);
  }

  private _buildAttributeSelector(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children
      .filter((c): c is CSTLeaf => c._tag === 'leaf')
      .filter(l => l.value !== '[' && l.value !== ']');
    const name = ls[0]?.value ?? '';
    const opRe = /^[*~|^$]?=$/;
    const opIdx = ls.findIndex(l => opRe.test(l.value));
    const attrNode: AttributeSelectorValue = {
      name,
      ...(opIdx >= 0 ? { op: ls[opIdx]!.value } : {}),
      ...(opIdx >= 0 && ls[opIdx + 1] ? { value: new Any(ls[opIdx + 1]!.value, {}, loc) } : {}),
      ...(opIdx >= 0 && ls[opIdx + 2] ? { mod: ls[opIdx + 2]!.value } : {})
    };
    return new AttributeSelector(attrNode, undefined, loc);
  }

  private _buildPseudoSelector(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const prefix = ls[0]?.value ?? ':';
    const pseudoName = ls[1]?.value ?? '';
    return new PseudoSelector(
      { name: prefix + pseudoName, arg: nodeChildren(children)[0] as Node | undefined },
      undefined, loc
    );
  }

  private _buildDeclaration(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const nameNode = new Any(ls[0]?.value ?? '', { role: 'property' }, loc);
    const valueNode = nodeChildren(children)[0] ?? new Any('', {}, loc);
    // '!' only appears in Declaration children via the lowercase `important` rule
    const hasImportant = ls.some(l => l.value === '!');
    return new Declaration(
      { name: nameNode, value: valueNode, important: hasImportant || undefined },
      undefined, loc
    );
  }

  private _buildCustomDeclaration(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const propName = ls[0]?.value ?? '';  // single leaf: '--foo-bar'
    const valueText = ls.slice(2).filter(l => l.value !== ';').map(l => l.value).join('').trim();
    return new CustomDeclaration(
      { name: propName, value: new Any(valueText, {}, loc) },
      undefined, loc
    );
  }

  private _buildValueList(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const nodes = nodeChildren(children);
    const hasComma = children.some(c => c._tag === 'leaf' && (c as CSTLeaf).value === ',');
    if (!hasComma) {
      return nodes[0] ?? new Any('', {}, loc);
    }
    return new List(nodes, undefined, loc);
  }

  private _buildValueSequence(children: ReadonlyArray<Child>, loc: LocationInfo) {
    // Mix nodes and non-trivial leaves. Lowercase rules (anyValue, ident, etc.)
    // produce leaves; we lift them to Any so callers see a non-empty result.
    const mixed: JessNode[] = [];
    for (const c of children) {
      if (c._tag === 'node') {
        mixed.push(c as JessNode);
      } else if (c._tag === 'leaf' && (c as CSTLeaf).value.trim()) {
        mixed.push(new Any((c as CSTLeaf).value, {}, loc) as JessNode);
      }
    }
    if (mixed.length === 1) {
      return mixed[0]!;
    }
    return new Sequence(mixed, undefined, loc);
  }

  private _buildDimension(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    return new Dimension(
      { number: parseFloat(ls[0]?.value ?? '0'), unit: ls[1]?.value ?? '' },
      undefined, loc
    );
  }

  private _buildColor(text: string, loc: LocationInfo) {
    return new Color(text, { format: ColorFormat.HEX }, loc);
  }

  private _buildUrl(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const inner = ls
      .filter(l => !/^url\($/i.test(l.value) && l.value !== ')')
      .map(l => l.value).join('').trim();
    return new Url(new Any(inner, { role: 'urlvalue' }, loc), undefined, loc);
  }

  private _buildCall(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    return new Call(
      { name: ls[0]?.value ?? '', args: nodeChildren(children)[0] as unknown as List<Node> },
      undefined, loc
    );
  }

  private _buildParen(children: ReadonlyArray<Child>, loc: LocationInfo) {
    return new Paren(nodeChildren(children)[0] as Node | undefined, undefined, loc);
  }

  private _buildQuoted(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const text = leafText(children);
    return new Quoted(text.slice(1, -1), { quote: text[0] as '"' | '\'' }, loc);
  }

  private _buildAtRuleBlock(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const keyword = ls[0]?.value ?? '';  // single leaf: '@media'
    const nameNode = new Any(keyword, { role: 'atkeyword' }, loc);
    const preludeText = ls.slice(1)
      .find(l => l.value !== '{' && l.value !== '}')
      ?.value.trim();
    const preludeNode = preludeText ? new Any(preludeText, {}, loc) : undefined;
    return new AtRule(
      { name: nameNode, prelude: preludeNode, rules: nodeChildren(children) },
      undefined, loc
    );
  }

  private _buildAtRuleStatement(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const keyword = ls[0]?.value ?? '';
    const nameNode = new Any(keyword, { role: 'atkeyword' }, loc);
    const preludeText = ls.slice(1).filter(l => l.value !== ';').map(l => l.value).join('').trim();
    return new AtRuleStatement(
      { name: nameNode, prelude: preludeText ? new Any(preludeText, {}, loc) : undefined },
      undefined, loc
    );
  }
  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
}
