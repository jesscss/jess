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
  oneOrMore,
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
  Ampersand
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

function leafText(children: ReadonlyArray<Child>): string {
  return children
    .filter((c): c is CSTLeaf => c._tag === 'leaf')
    .map(l => l.value)
    .join('');
}

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

  // ── Override value to add Reference before other value types ─────────────

  value = (g: any) => choice(
    g.Reference,   // @var — before Dimension/Num (no @-prefixed dimensions in CSS)
    g.Dimension,
    g.Num,
    g.Color,
    g.Url,
    g.Call,
    g.Paren,
    g.Quoted,
    g.anyValue
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
  /* eslint-disable-next-line @typescript-eslint/no-unsafe-return */
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
  /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */

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
        if (prevWasNode) parts.push(' ');
        parts.push(c as JessNode);
        prevWasNode = true;
      } else if (c._tag === 'leaf' && (c as CSTLeaf).value) {
        if (i === 0 && hasLeadingCombinator) continue;  // already pushed
        parts.push((c as CSTLeaf).value);
        prevWasNode = false;
      }
    }

    if (parts.length === 0) return new Any('', {}, loc);
    if (parts.length === 1 && typeof parts[0] !== 'string') return parts[0]!;
    return new ComplexSelector(parts as unknown as ComplexSelectorValue, undefined, loc);
  }

  private _buildLessSelectorList(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const sels = nodeChildren(children);
    if (sels.length === 1) return sels[0]!;
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
  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
}
