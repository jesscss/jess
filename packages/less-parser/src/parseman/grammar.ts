/**
 * LessGrammar — Parséman-based Less parser, extending CssParser.
 *
 * Adds Less-specific grammar on top of CSS:
 *   - Variable declarations: @var: value;  →  VarDeclaration
 *   - Variable references:   @var           →  Reference
 *   - Ampersand selectors:   &              →  Ampersand
 *   - Nested rulesets inside declarationList
 *   - Less merge operators:  +: and +_:
 *   - Variable accessor:     @var[key]
 *
 * Inherits trivia handling, all CSS rules, and buildNode dispatch from
 * CssParser. Capital rules call buildNode(); lowercase rules are transparent.
 */

import {
  sequence,
  choice,
  many,
  optional,
  regex,
  literal,
  scanTo,
  balanced
} from 'parseman';
import type { Span } from 'parseman';
import type { CSTLeaf, CSTError } from 'parseman';
import { CssParser } from '@jesscss/css-parser';

import {
  type Node,
  type LocationInfo,
  Any, Ruleset,
  type Selector,
  ComplexSelector, type ComplexSelectorValue,
  SelectorList,
  Declaration, type DeclarationOptions,
  VarDeclaration, type VarDeclarationOptions,
  Reference, type ReferenceValue,
  Ampersand,
  Color, Paren, Condition, type ConditionOperator
} from '@jesscss/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type JessNode = Node<any, any>;
type Child = JessNode | CSTLeaf | CSTError;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function spanToLocation(span: Span): LocationInfo {
  return [span.start, 0, 0, span.end, 0, 0];
}

function nodeChildren(children: ReadonlyArray<Child>): JessNode[] {
  return children.filter((c): c is JessNode => c._tag === 'node') as JessNode[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// CSS named color keywords (sorted longest-first so regex engine picks the
// most specific name first; negative lookahead prevents matching 'red' in 'redish').
const CSS_COLOR_NAMES_RE = /(?:lightgoldenrodyellow|mediumspringgreen|mediumaquamarine|mediumslateblue|mediumturquoise|mediumvioletred|blanchedalmond|cornflowerblue|darkolivegreen|lightslategray|lightslategrey|lightsteelblue|mediumseagreen|darkgoldenrod|darkslateblue|darkslategray|darkslategrey|darkturquoise|lavenderblush|lightseagreen|palegoldenrod|paleturquoise|palevioletred|rebeccapurple|antiquewhite|darkseagreen|lemonchiffon|lightskyblue|mediumorchid|mediumpurple|midnightblue|currentcolor|darkmagenta|deepskyblue|floralwhite|forestgreen|greenyellow|lightsalmon|lightyellow|navajowhite|saddlebrown|springgreen|yellowgreen|transparent|aquamarine|blueviolet|chartreuse|darkorange|darkorchid|darksalmon|darkviolet|dodgerblue|ghostwhite|lightcoral|lightgreen|mediumblue|papayawhip|powderblue|sandybrown|whitesmoke|aliceblue|burlywood|cadetblue|chocolate|darkgreen|darkkhaki|firebrick|gainsboro|goldenrod|indianred|lawngreen|lightblue|lightcyan|lightgray|lightgrey|lightpink|limegreen|mintcream|mistyrose|olivedrab|orangered|palegreen|peachpuff|rosybrown|royalblue|slateblue|slategray|slategrey|steelblue|turquoise|cornsilk|darkblue|darkcyan|darkgray|darkgrey|deeppink|honeydew|lavender|moccasin|seagreen|seashell|crimson|darkred|dimgray|dimgrey|fuchsia|hotpink|magenta|oldlace|skyblue|thistle|bisque|indigo|maroon|orange|orchid|purple|salmon|sienna|silver|tomato|violet|yellow|azure|beige|black|brown|coral|green|ivory|khaki|linen|olive|wheat|white|aqua|blue|cyan|gold|gray|grey|lime|navy|peru|pink|plum|snow|teal|red|tan)(?![a-zA-Z0-9_-])/i;

// ---------------------------------------------------------------------------
// LessGrammar
// ---------------------------------------------------------------------------

export class LessGrammar extends CssParser {
  // ── Less-specific token rules ─────────────────────────────────────────────

  // @varname (same regex as atKeyword; no conflict because they appear in
  // mutually exclusive contexts: atKeyword at statement level, lessVar inside
  // values and variable declarations).
  lessVar = regex(/@-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*/);

  // @{varname} — Less string interpolation placeholder
  lessInterp = regex(/@\{-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*\}/);

  // ── Override Stylesheet to include VarDeclaration ─────────────────────────

  // Leading optional(g.rw) needed: unknown (catch-all scanTo) is infallible,
  // so many()'s trivia-retry would never fire otherwise.
  Stylesheet = (g: any) => many(
    sequence(optional(g.rw), choice(
      g.VarDeclaration,
      g.AtRuleBlock,
      g.AtRuleStatement,
      g.Ruleset,
      g.unknown
    ))
  );

  // ── Override declarationList to include VarDeclaration and nested Rulesets ─

  declarationList = (g: any) => many(sequence(
    optional(g.rw),
    choice(
      g.VarDeclaration,
      g.Ruleset,           // Less nesting: .parent { .child { } }
      g.Declaration,
      g.CustomDeclaration,
      literal(';'),
      sequence(g.unknown, optional(literal(';')))
    )
  ));

  // ── VarDeclaration: @color: value; ───────────────────────────────────────

  VarDeclaration = (g: any) => sequence(
    g.lessVar,
    literal(':'),
    g.ValueList,
    optional(g.important),
    optional(literal(';'))
  );

  // ── Reference: @var or @var[key] in value positions ──────────────────────

  Reference = (g: any) => sequence(
    g.lessVar,
    optional(sequence(
      literal('['),
      choice(g.ident, g.Quoted, g.lessVar),
      literal(']')
    ))
  );

  // ── CSS named color keywords → Color nodes ────────────────────────────────
  NamedColor = regex(CSS_COLOR_NAMES_RE);

  // ── Override value to add Reference and NamedColor ────────────────────────

  value = (g: any) => choice(
    g.Reference,    // @var — before Dimension/Num (no @-prefixed dimensions in CSS)
    g.Dimension,
    g.Num,
    g.Color,        // hex colors
    g.NamedColor,   // named CSS color keywords (red, blue, etc.)
    g.Url,
    g.Call,
    g.Paren,
    g.Quoted,
    g.anyValue
  );

  // ── Less comparison expression: @var op value ─────────────────────────────
  //   Used as an entry point by guards.test.ts: parse('@a = white', 'comparison')
  Comparison = (g: any) => sequence(
    g.Reference,
    regex(/>=|<=|=~|[<>=]/),
    choice(g.Reference, g.Dimension, g.Num, g.Color, g.NamedColor, g.Quoted, g.anyValue)
  );

  // Parenthesized comparison in a guard — produces a Paren(Condition) node
  GuardCondition = (g: any) => sequence(literal('('), g.Comparison, literal(')'));

  // ── Less guard: when(comparison) ─────────────────────────────────────────
  //   Handles: when(@a = white)
  //            when((@a = white) and (@b = black))
  //            when((@a = white))
  Guard = (g: any) => sequence(
    regex(/when/),
    optional(regex(/not/)),
    literal('('),
    many(choice(
      g.GuardCondition,    // (comparison) → Paren(Condition)
      g.Comparison,        // bare comparison
      regex(/default\(\)/),
      regex(/and|or/)
    )),
    literal(')')
  );

  // ── Ampersand: & in Less selectors ────────────────────────────────────────

  LessAmpersand = (_g: any) => literal('&');

  // Override simpleSelector to include &
  simpleSelector = (g: any) => choice(
    g.AttributeSelector,
    g.PseudoSelector,
    g.LessAmpersand,
    g.BasicSelector
  );

  // ── Override ComplexSelector for relative selectors (.parent { > .child }) ─

  // Relative selector: optional leading combinator before first CompoundSelector.
  // Handles: `> .child { }` inside a nested ruleset.
  LessComplexSelector = (g: any) => sequence(
    optional(g.combinator),    // optional leading combinator (relative selector)
    g.CompoundSelector,
    many(sequence(optional(g.combinator), g.CompoundSelector))
  );

  LessSelectorList = (g: any) => sequence(
    g.LessComplexSelector,
    many(sequence(literal(','), g.LessComplexSelector))
  );

  // Override Ruleset to use Less-aware selector list
  Ruleset = (g: any) => sequence(
    g.LessSelectorList,
    literal('{'),
    g.declarationList,
    literal('}')
  );

  // ── Override Declaration: support Less merge operators (+: and +_:) ───────

  // Explicit `any` return avoids structural-type mismatch with CssParser.Declaration
  // which infers a different tuple arity from its sequence() call.

  Declaration = (g: any): any => sequence(
    g.ident,
    optional(choice(literal('+_'), literal('+'))),  // Less property merge
    literal(':'),
    g.ValueList,
    optional(g.important),
    optional(literal(';'))
  );

  // ── Override CustomDeclaration: add orEOF so it works as a standalone entry point ───────

  // CssParser's CustomDeclaration requires ; or } as sentinel — fails when parsing
  // custom properties standalone. orEOF: true lets the scan reach EOF if neither appears.
  CustomDeclaration = (g: any) => sequence(
    g.customProp,
    literal(':'),
    scanTo(
      choice(literal(';'), literal('}')),
      { skip: [balanced('(', ')'), balanced('[', ']'), balanced('{', '}')], orEOF: true }
    ),
    optional(literal(';'))
  );

  // ── anyDeclaration: unified entry point for tests that call parse(text, 'declaration') ─

  // lowercase → transparent; whichever inner capital rule matches produces the node
  anyDeclaration = (g: any) => choice(g.VarDeclaration, g.CustomDeclaration, g.Declaration);

  // ── Override atRuleBody to also include VarDeclaration ───────────────────

  atRuleBody = (g: any) => many(
    choice(
      g.AtRuleBlock,
      g.AtRuleStatement,
      g.VarDeclaration,
      g.Ruleset,
      g.Declaration,
      g.CustomDeclaration,
      literal(';')
    )
  );

  // ── buildNode ─────────────────────────────────────────────────────────────
  /* eslint-disable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/naming-convention */

  protected override buildNode(
    type: string,
    span: Span,
    children: ReadonlyArray<JessNode | CSTLeaf | CSTError>,

    _state: unknown,

    _rawChildren: ReadonlyArray<{ _tag: string }>
  ): JessNode {
    const loc = spanToLocation(span);
    switch (type) {
      case 'VarDeclaration':      return this._buildVarDeclaration(children, loc);
      case 'Reference':           return this._buildReference(children, loc);
      case 'LessAmpersand':       return new Ampersand(undefined, {}, loc);
      case 'LessComplexSelector': return this._buildLessComplexSelector(children, span);
      case 'LessSelectorList':    return this._buildLessSelectorList(children, loc);
      case 'Ruleset':             return this._buildLessRuleset(children, loc) as unknown as JessNode;
      case 'Declaration':         return this._buildLessDeclaration(children, loc);
      case 'NamedColor':          return this._buildNamedColor(children, loc);
      case 'GuardCondition':      return new Paren({ node: nodeChildren(children)[0] ?? new Any('', {}, loc) }, {}, loc) as unknown as JessNode;
      case 'Comparison':          return this._buildComparison(children, loc);
      case 'Guard':               return this._buildGuard(children, loc);
      default:                    return super.buildNode(type, span, children, _state, _rawChildren);
    }
  }

  // ── Private Less AST builders ─────────────────────────────────────────────

  private _buildVarDeclaration(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const varName = ls[0]?.value ?? '';
    // Strip leading @ from variable name
    const nameStr = varName.startsWith('@') ? varName.slice(1) : varName;
    const nameNode = new Any(nameStr, { role: 'ident' }, loc);
    const valueNode = nodeChildren(children)[0] ?? new Any('', {}, loc);
    const hasImportant = ls.some(l => l.value === '!');
    return new VarDeclaration(
      { name: nameNode, value: valueNode, important: hasImportant || undefined } as any,
      {} as VarDeclarationOptions,
      loc
    );
  }

  private _buildReference(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const varName = ls[0]?.value ?? '';
    const key = varName.startsWith('@') ? varName.slice(1) : varName;

    // Check for accessor bracket: @var[key] or @var[Quoted]
    const hasAccessor = ls.some(l => l.value === '[');
    if (hasAccessor) {
      const accessorNode = nodeChildren(children)[0];  // Quoted if present
      const accessorLeaf = ls.find(l => l.value !== varName && l.value !== '[' && l.value !== ']');
      const accessKey = accessorNode
        ? String(accessorNode)
        : (accessorLeaf?.value ?? '');
      const target = new Reference(key, { type: 'variable' }, loc);
      return new Reference(
        { target, key: accessKey } as unknown as ReferenceValue,
        { type: 'index' },
        loc
      );
    }

    return new Reference(key, { type: 'variable' }, loc);
  }

  private _buildLessComplexSelector(children: ReadonlyArray<Child>, span: Span) {
    const loc = spanToLocation(span);
    const parts: (JessNode | string)[] = [];

    // Track if the very first child is a combinator leaf (relative selector)
    const firstChild = children[0];
    const hasLeadingCombinator = firstChild?._tag === 'leaf' && Boolean((firstChild as CSTLeaf).value);

    if (hasLeadingCombinator) {
      parts.push((firstChild as CSTLeaf).value);
    }

    let prevWasNode = false;
    for (let i = 0; i < children.length; i++) {
      const c = children[i]!;
      if (c._tag === 'node') {
        if (prevWasNode) {
          parts.push(' ');
        }
        parts.push(c as JessNode);
        prevWasNode = true;
      } else if (c._tag === 'leaf' && (c as CSTLeaf).value) {
        if (i === 0 && hasLeadingCombinator) {
          continue;
        }  // already pushed
        parts.push((c as CSTLeaf).value);
        prevWasNode = false;
      }
    }

    if (parts.length === 0) {
      return new Any('', {}, loc);
    }
    if (parts.length === 1 && typeof parts[0] !== 'string') {
      return parts[0]!;
    }
    return new ComplexSelector(parts as unknown as ComplexSelectorValue, undefined, loc);
  }

  private _buildLessSelectorList(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const sels = nodeChildren(children);
    if (sels.length === 1) {
      return sels[0]!;
    }
    return new SelectorList(sels as unknown as (Selector | string)[], undefined, loc);
  }

  private _buildLessRuleset(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const nodes = nodeChildren(children);
    return new Ruleset({
      selector: (nodes[0] ?? new Any('', {}, loc)) as unknown as Selector,
      rules: nodes.slice(1)
    }, undefined, loc);
  }

  private _buildLessDeclaration(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');

    // Detect Less merge operators: +_ or + appear between ident and :
    const colonIdx = ls.findIndex(l => l.value === ':');
    let assign: string | undefined;
    if (colonIdx > 1) {
      const mergeLeaf = ls[colonIdx - 1];
      if (mergeLeaf?.value === '+_') {
        assign = '+_:';
      } else if (mergeLeaf?.value === '+') {
        assign = '+,:';
      }
    }

    const nameNode = new Any(ls[0]?.value ?? '', { role: 'property' }, loc);
    const valueNode = nodeChildren(children)[0] ?? new Any('', {}, loc);
    const hasImportant = ls.some(l => l.value === '!');

    const opts: DeclarationOptions = assign ? { assign: assign as any } : {};
    return new Declaration(
      { name: nameNode, value: valueNode, important: hasImportant || undefined },
      opts,
      loc
    );
  }
  private _buildNamedColor(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const name = ls[0]?.value ?? '';
    return new Color({ node: name }, {}, loc) as unknown as JessNode;
  }

  private _buildComparison(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const nodes = nodeChildren(children);
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    // leaves: first is the operator (regex match); nodes: left/right values
    const left = nodes[0] ?? new Any('', {}, loc);
    const op = ls.find(l => />=|<=|=~|[<>=]/.test(l.value));
    const right = nodes[1] ?? new Any('', {}, loc);
    if (op) {
      return new Condition(
        [left, op.value as ConditionOperator, right],
        {},
        loc
      ) as unknown as JessNode;
    }
    return new Condition([left], {}, loc) as unknown as JessNode;
  }

  private _buildGuard(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const nodes = nodeChildren(children);
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const hasNot = ls.some(l => l.value === 'not');
    // Find 'and'/'or' leaves to construct multi-condition Condition chains
    const andOrIdx = ls.findIndex(l => l.value === 'and' || l.value === 'or');
    if (andOrIdx >= 0 && nodes.length >= 2) {
      const op = ls[andOrIdx]!.value as ConditionOperator;
      const left = nodes[0]!;
      const right = nodes[1]!;
      return new Condition([left, op, right], { negate: hasNot }, loc) as unknown as JessNode;
    }
    if (nodes.length === 1) {
      return new Condition([nodes[0]!], { negate: hasNot }, loc) as unknown as JessNode;
    }
    return new Condition([new Any('', {}, loc)], { negate: hasNot }, loc) as unknown as JessNode;
  }

  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
}
