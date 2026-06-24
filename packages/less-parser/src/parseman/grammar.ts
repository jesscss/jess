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
  keywords,
  not,
  scanTo,
  balanced
} from 'parseman';
import type { Span } from 'parseman';
import type { CSTLeaf, CSTError } from 'parseman';
import {
  CssParser, CSS_COLOR_NAMES,
  spannedComponents, type Spanned
} from '@jesscss/css-parser';

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
  Ampersand, List, DefaultGuard, Extend, Call,
  Interpolated, InterpolatedSelector, Sequence, CustomDeclaration,
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

// CSS named color keywords — shared set from css-parser, compiled to an optimal
// longest-first matcher with a word boundary by Parseman's keywords().

// ---------------------------------------------------------------------------
// LessGrammar
// ---------------------------------------------------------------------------

export class LessGrammar extends CssParser {
  // Public entry-point aliases (Chevrotain-era lowercase names → grammar rules),
  // resolved by Parseman's parse()/rule() so the adapter needs no lookup table.
  protected override _aliases = {
    stylesheet: 'Stylesheet',
    main: 'Stylesheet',
    declaration: 'anyDeclaration',
    declarationList: 'declarationList',
    selector: 'LessSelectorList',
    complexSelector: 'LessComplexSelector',
    selectorList: 'LessSelectorList',
    atRule: 'AtRuleBlock',
    value: 'valueList',
    valueList: 'valueList',
    comparison: 'Comparison',
    guard: 'Guard',
    guardOr: 'Guard',
    guardAnd: 'Guard',
    qualifiedRule: 'MixinOrQualifiedRule',  // Less qualified rules may carry a `when` guard
    mixinOrQualifiedRule: 'MixinOrQualifiedRule',
    mixinArgs: 'MixinArgs',
    anonymousMixinDefinition: 'AnonymousMixinDefinition'
  };

  // ── Less-specific token rules ─────────────────────────────────────────────

  // @varname (same regex as atKeyword; no conflict because they appear in
  // mutually exclusive contexts: atKeyword at statement level, lessVar inside
  // values and variable declarations).
  lessVar = regex(/@-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*/);

  // @{varname} — Less string interpolation placeholder
  lessInterp = regex(/@\{-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*\}/);

  // ── Override Stylesheet to include VarDeclaration ─────────────────────────

  // many() skips leading trivia before each item — no explicit rw needed.
  override Stylesheet = (g: any) => many(
    choice(
      g.VarDeclaration,
      g.AtRuleBlock,
      g.AtRuleStatement,
      g.Ruleset,
      g.MixinCall,        // .mixin; / .mixin();  (terminated by ';', disjoint from Ruleset's '{')
      sequence(g.Call, optional(literal(';'))),  // detached function call: func(1, 2, 3);
      g.unknown
    )
  );

  // A standalone mixin call statement, e.g. `.mixin;` or `.mixin(1, 2);`.
  // Distinguished from a Ruleset by the trailing ';' (Rulesets require '{').
  MixinCall = (g: any) => sequence(
    g.mixinNamePath,
    optional(g.MixinArgs),
    literal(';')
  );

  // ── Override declarationList to include VarDeclaration and nested Rulesets ─

  override declarationList = (g: any) => many(
    choice(
      g.VarDeclaration,
      g.ExtendStatement,   // &:extend(.base [all]);  — Less extend statement
      g.Ruleset,           // Less nesting: .parent { .child { } }
      g.Declaration,
      g.CustomDeclaration,
      literal(';'),
      sequence(g.unknown, optional(literal(';')))
    )
  );

  // A standalone Less extend statement inside a rule body: `&:extend(.base all);`
  ExtendStatement = (g: any) => sequence(
    optional(g.LessAmpersand),
    regex(/::?/),
    literal('extend'),
    literal('('),
    g.pseudoArg,
    literal(')'),
    optional(literal(';'))
  );

  // ── VarDeclaration: @color: value; ───────────────────────────────────────

  VarDeclaration = (g: any) => sequence(
    g.lessVar,
    literal(':'),
    g.valueList,
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
  NamedColor = keywords([...CSS_COLOR_NAMES], { caseInsensitive: true, boundary: 'a-zA-Z0-9_-' });

  // ── Override value to add Reference and NamedColor ────────────────────────

  override value = (g: any) => choice(
    g.Reference,    // @var — before Dimension/Num (no @-prefixed dimensions in CSS)
    g.Dimension,
    g.Num,
    g.Color,        // hex colors
    g.NamedColor,   // named CSS color keywords (red, blue, etc.)
    g.Url,
    g.Call,
    g.EscapedValue, // Less ~(...) / ~"..." — before Paren/Quoted
    g.Paren,
    g.Quoted,
    g.anyValue
  );

  // Less escaped value: ~(content) or ~"string" → inner node with escaped: true.
  EscapedValue = (g: any) => sequence(literal('~'), choice(g.Paren, g.Quoted));

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

  // ── Mixins ─────────────────────────────────────────────────────────────────

  // Argument list: ( ... ). Permissive — scans to the matching ')' while
  // preserving nested parens and strings (covers @a, @a: default, @rest..., etc).
  MixinArgs = (g: any) => sequence(
    literal('('),
    optional(scanTo(literal(')'), { skip: [balanced('(', ')'), g.singleStr, g.doubleStr] })),
    literal(')')
  );

  // Anonymous mixin definition: .(args) { } or .() { }
  AnonymousMixinDefinition = (g: any) => sequence(
    literal('.'),
    g.MixinArgs,
    literal('{'),
    g.declarationList,
    literal('}')
  );

  // A mixin name path: .name / #name, optionally chained (#foo > .bar).
  mixinNamePath = (g: any) => sequence(
    g.basicSelector,
    many(sequence(optional(g.combinator), g.basicSelector))
  );

  // Mixin definition/call or qualified rule:
  //   .mixin(args) when (guard) { body }   definition
  //   .mixin(args);  /  .mixin(args)        call
  //   .selector { body }                    qualified rule
  MixinOrQualifiedRule = (g: any) => sequence(
    g.mixinNamePath,
    optional(g.MixinArgs),
    optional(g.Guard),
    optional(choice(
      sequence(literal('{'), g.declarationList, literal('}')),
      literal(';')
    ))
  );

  // ── Ampersand: & in Less selectors ────────────────────────────────────────

  // & optionally followed by a Less append/merge template: &(.foo-&), &(nil), &("").
  LessAmpersand = (g: any) => sequence(
    literal('&'),
    optional(sequence(
      literal('('),
      scanTo(literal(')'), { skip: [balanced('(', ')'), g.singleStr, g.doubleStr] }),
      literal(')')
    ))
  );

  // Override simpleSelector to include & and interpolated selectors (.@{var}).
  // InterpolatedSelector is tried before basicSelector and requires at least one
  // @{…} so plain selectors still fall through to basicSelector.
  override simpleSelector = (g: any) => choice(
    g.AttributeSelector,
    g.PseudoSelector,
    g.LessAmpersand,
    g.InterpolatedSelector,
    g.basicSelector
  );

  InterpolatedSelector = (g: any) => sequence(
    optional(regex(/[.#]/)),
    many(regex(/[-_a-zA-Z0-9]+/)),
    g.lessInterp,
    many(choice(g.lessInterp, regex(/[-_a-zA-Z0-9]+/)))
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
  override Ruleset = (g: any) => sequence(
    g.LessSelectorList,
    literal('{'),
    g.declarationList,
    literal('}')
  );

  // ── Override Declaration: support Less merge operators (+: and +_:) ───────

  // Explicit `any` return avoids structural-type mismatch with CssParser.Declaration
  // which infers a different tuple arity from its sequence() call.

  override Declaration = (g: any): any => sequence(
    g.ident,
    optional(choice(literal('+_'), literal('+'))),  // Less property merge
    literal(':'),
    g.valueList,
    optional(g.important),
    optional(literal(';'))
  );

  // ── Override CustomDeclaration: add orEOF so it works as a standalone entry point ───────

  // CssParser's CustomDeclaration requires ; or } as sentinel — fails when parsing
  // custom properties standalone. orEOF: true lets the scan reach EOF if neither appears.
  // Try a structured value first (so functions etc. parse as Call/Sequence);
  // fall back to a permissive scan for arbitrary custom-property content.
  override CustomDeclaration = (g: any): any => sequence(
    g.customProp,
    literal(':'),
    choice(
      g.customValue,
      scanTo(
        choice(literal(';'), literal('}')),
        { skip: [balanced('(', ')'), balanced('[', ']'), balanced('{', '}')], orEOF: true }
      )
    ),
    optional(literal(';'))
  );

  // A structured custom-property value: a value list that must reach a
  // terminator (';', '}', or EOF) — otherwise the permissive scan is used.
  customValue = (g: any) => sequence(g.valueList, not(regex(/[^\s;}]/)));

  // ── anyDeclaration: unified entry point for tests that call parse(text, 'declaration') ─

  // lowercase → transparent; whichever inner capital rule matches produces the node
  anyDeclaration = (g: any) => choice(g.VarDeclaration, g.CustomDeclaration, g.Declaration);

  // ── Override atRuleBody to also include VarDeclaration ───────────────────

  override atRuleBody = (g: any) => many(
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
    const raw = _rawChildren;
    switch (type) {
      case 'VarDeclaration':      return this._buildVarDeclaration(raw, loc);
      case 'Reference':           return this._buildReference(children, loc);
      case 'LessAmpersand':       return this._buildAmpersand(children, loc);
      // Less selector/ruleset/declaration use the shared CSS string-AST builders.
      // LessComplexSelector's optional leading combinator falls out as a leading
      // string component.
      case 'LessComplexSelector': return this._buildComplexSelector(raw, loc);
      case 'LessSelectorList':    return this._buildSelectorList(raw, loc);
      case 'Ruleset':             return this._buildRuleset(children, raw, loc) as unknown as JessNode;
      case 'Declaration':         this._warnDeprecatedValue(span);
        return this._buildLessDeclaration(raw, loc);
      case 'CustomDeclaration':   this._warnCustomPropVars(span);
        return this._buildLessCustomDecl(children, loc);
      case 'AtRuleBlock':         this._warnAtRulePreludeVars(span);
        return this._buildAtRuleBlock(children, loc) as unknown as JessNode;
      case 'NamedColor':          return this._buildNamedColor(children, loc);
      case 'GuardCondition':      return new Paren(nodeChildren(children)[0] ?? new Any('', {}, loc), {}, loc) as unknown as JessNode;
      case 'Comparison':          return this._buildComparison(children, loc);
      case 'Guard':               return this._buildGuard(children, loc);
      case 'PseudoSelector':      return this._buildLessPseudo(type, span, children, _state, raw, loc);
      case 'InterpolatedSelector': return this._buildInterpolatedSelector(children, loc);
      case 'MixinCall':           return this._buildMixinCall(children, raw, loc);
      case 'MixinArgs':           return this._buildMixinArgs(children, loc);
      case 'AnonymousMixinDefinition': return this._buildAnonMixin(children, loc) as unknown as JessNode;
      case 'MixinOrQualifiedRule': return this._buildMixinOrQualified(children, loc);
      case 'EscapedValue':        return this._buildEscapedValue(children, loc);
      case 'ExtendStatement':     return this._buildExtendStatement(children, raw, loc);
      default:                    return super.buildNode(type, span, children, _state, raw);
    }
  }

  // ── Private Less AST builders ─────────────────────────────────────────────

  private _buildVarDeclaration(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    // strings-not-nodes: name is the bare ident (@ stripped); value via the
    // shared CSS string-AST value builder.
    const items = spannedComponents(rawChildren);
    const rawName = typeof items[0]?.comp === 'string' ? items[0]!.comp : '';
    const name = rawName.startsWith('@') ? rawName.slice(1) : rawName;
    const colonIdx = items.findIndex(i => i.comp === ':');
    let end = items.length;
    for (let i = colonIdx + 1; i < items.length; i++) {
      const c = items[i]!.comp;
      if (c === '!' || c === 'important' || c === ';') {
        end = i;
        break;
      }
    }
    const valItems = items.slice(colonIdx + 1, end);
    // Legacy: a variable whose value is an unquoted class-selector list
    // (e.g. `@classes: .a, .b, .c`) is a deprecated "selector capture".
    if (valItems.length) {
      const vText = this._source.slice(valItems[0]!.span.start, valItems[valItems.length - 1]!.span.end);
      if (/(?:^|[\s,])\.-?[_a-zA-Z]/.test(vText)) {
        this._warn(
          `Unquoted selector capture in variable "@${name}" is deprecated; wrap the value in quotes or ~"...".`,
          'unquoted-selector-capture'
        );
      }
    }
    const { value } = this._assembleValue(valItems, loc);
    const hasImportant = items.some(i => i.comp === '!');
    return new VarDeclaration(
      { name, value, important: hasImportant || undefined } as any,
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
    // default() guard → Paren(DefaultGuard), wrapped in a negated Condition when `not`.
    if (ls.some(l => l.value === 'default()')) {
      const paren = new Paren(
        new DefaultGuard('default()', {}, loc) as any,
        {}, loc
      );
      return (hasNot
        ? new Condition([paren as any], { negate: true }, loc)
        : paren) as unknown as JessNode;
    }
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

  // .@{var} / foo@{var} → InterpolatedSelector wrapping an Interpolated value
  // (source text with @{…} placeholders + their Reference replacements).
  private _buildInterpolatedSelector(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const source = ls.map(l => l.value).join('');
    const replacements = ls
      .filter(l => l.value.startsWith('@{'))
      .map(l => new Reference(l.value.slice(2, -1), { type: 'variable' }, loc) as unknown as Node);
    const interp = new Interpolated({ source, replacements }, {}, loc);
    return new InterpolatedSelector(interp as any, {}, loc) as unknown as JessNode;
  }

  // :extend(target [all]) is a Less pseudo that becomes an Extend node; any
  // other pseudo uses the shared CSS builder.
  private _buildLessPseudo(
    type: string, span: Span,
    children: ReadonlyArray<JessNode | CSTLeaf | CSTError>,
    state: unknown, raw: ReadonlyArray<{ _tag: string }>, loc: LocationInfo
  ): JessNode {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    if (ls.some(l => l.value === 'extend')) {
      const argNode = nodeChildren(children)[0];
      const argText = ls.find(l => !/^::?$/.test(l.value) && l.value !== 'extend')?.value ?? '';
      const target = (argNode ?? argText) as unknown as Selector;
      return new Extend({ target }, {}, loc) as unknown as JessNode;
    }
    return super.buildNode(type, span, children, state, raw);
  }

  // Declaration with optional Less merge operator: `prop+: v` (list merge) or
  // `prop+_: v` (sequence merge) → set the assign option on the built node.
  private _buildLessDeclaration(raw: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const items = spannedComponents(raw);
    const decl = this._buildDeclaration(raw, loc);
    const colonIdx = items.findIndex(i => i.comp === ':');
    const merge = colonIdx > 0 ? items[colonIdx - 1]?.comp : undefined;
    const assign = merge === '+_' ? '+_:' : merge === '+' ? '+,:' : undefined;
    if (assign) {
      const d = decl as unknown as { _options?: Record<string, unknown>; options?: Record<string, unknown> };
      d._options = { ...(d._options ?? {}), assign };
    }
    return decl;
  }

  // & with optional append/merge template → Ampersand with appendValue.
  //   &        → appendValue undefined
  //   &(nil)   → '' (explicit empty parent)
  //   &("")    → '' (empty quoted template)
  //   &(.foo-&)→ '.foo-&' (merge template; templateMerge derived from the '&')
  private _buildAmpersand(children: ReadonlyArray<Child>, loc: LocationInfo): JessNode {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const hasParen = ls.some(l => l.value === '(');
    if (!hasParen) {
      return new Ampersand(undefined, {}, loc) as unknown as JessNode;
    }
    const content = ls.find(l => l.value !== '&' && l.value !== '(' && l.value !== ')')?.value ?? '';
    const trimmed = content.trim();
    const appendValue = trimmed === 'nil'
      ? ''
      : trimmed.replace(/^(['"])([\s\S]*)\1$/, '$2');
    return new Ampersand(appendValue, {}, loc) as unknown as JessNode;
  }

  // `&:extend(target [all]);` statement → an Extend node (with optional 'all' flag).
  private _buildExtendStatement(
    children: ReadonlyArray<Child>, raw: ReadonlyArray<{ _tag: string }>, loc: LocationInfo
  ): JessNode {
    const argNode = nodeChildren(children)[0];
    const text = this._source.slice(loc[0], loc[3]);
    const flag = /\ball\s*\)/.test(text) ? 'all' : undefined;
    const m = /:extend\(\s*([^)]*?)(?:\s+all)?\s*\)/.exec(text);
    const target = (argNode ?? (m ? m[1]!.trim() : '')) as unknown as Selector;
    return new Extend({ target, flag } as any, {}, loc) as unknown as JessNode;
  }

  // Less ~(...) / ~"..." → the inner Paren/Quoted node flagged escaped: true.
  private _buildEscapedValue(children: ReadonlyArray<Child>, loc: LocationInfo): JessNode {
    const inner = nodeChildren(children)[0];
    if (!inner) {
      return new Any('', { role: 'ident' }, loc) as unknown as JessNode;
    }
    const n = inner as unknown as { _options?: Record<string, unknown> };
    n._options = { ...(n._options ?? {}), escaped: true };
    return inner;
  }

  // Less models a function call's name as a Reference (type 'function',
  // fallbackValue) so it resolves like a variable, with silentFail on the Call.
  protected override _buildCall(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo): Call {
    const call = super._buildCall(rawChildren, loc) as unknown as {
      name: unknown; args: unknown; _options?: Record<string, unknown>;
    };
    const key = typeof call.name === 'string' ? call.name : '';
    const nameRef = new Reference(key, { type: 'function', fallbackValue: true } as any, loc);
    const next = new Call({ name: nameRef as any, args: call.args as any }, { silentFail: true } as any, loc);
    return next as unknown as Call;
  }

  // Custom property: structured value (from valueList) → wrapped in a Sequence;
  // otherwise fall back to the shared CSS scanned-text Any builder.
  private _buildLessCustomDecl(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const propName = ls[0]?.value ?? '';
    const valueNodes = nodeChildren(children);
    if (valueNodes.length > 0) {
      const value = valueNodes.length === 1 && valueNodes[0]!.type === 'Sequence'
        ? valueNodes[0]!
        : new Sequence(valueNodes as any, undefined, loc);
      return new CustomDeclaration({ name: propName, value: value as any }, undefined, loc);
    }
    return this._buildCustomDeclaration(children, loc);
  }

  // ── Deprecation detectors (scan the node's source span) ─────────────────────

  private _warnDeprecatedValue(span: Span) {
    const text = this._source.slice(span.start, span.end);
    if (/\d\s*\.\//.test(text)) {
      this._warn('The ./ operator is deprecated and will be removed.', 'dot-slash-operator');
    }
  }

  private _warnCustomPropVars(span: Span) {
    const text = this._source.slice(span.start, span.end);
    const colon = text.indexOf(':');
    const value = colon >= 0 ? text.slice(colon + 1) : text;
    const at = value.match(/@[a-zA-Z][\w-]*/);
    if (at && !value.includes('@{')) {
      this._warn(
        `"${at[0]}" in custom property values is treated as literal text. Use @{${at[0].slice(1)}} for interpolation.`,
        'variable-in-unknown-value'
      );
    }
    const dollar = value.match(/\$[a-zA-Z][\w-]*/);
    if (dollar && !value.includes('${')) {
      this._warn(
        `"${dollar[0]}" in custom property values is treated as literal text. Use \${${dollar[0].slice(1)}} for interpolation.`,
        'property-in-unknown-value'
      );
    }
  }

  private _warnAtRulePreludeVars(span: Span) {
    const text = this._source.slice(span.start, span.end);
    const brace = text.indexOf('{');
    const prelude = (brace >= 0 ? text.slice(0, brace) : text).replace(/^\s*@-?[\w-]+/, '');
    const at = prelude.match(/@[a-zA-Z][\w-]*/);
    if (at && !prelude.includes('@{')) {
      this._warn(
        `"${at[0]}" in at-rule preludes is deprecated. Use @{${at[0].slice(1)}} for interpolation.`,
        'at-rule-prelude-variable'
      );
    }
  }

  // A standalone mixin call statement; emits Less deprecation warnings for the
  // no-parens and whitespace-before-parens forms.
  private _buildMixinCall(
    children: ReadonlyArray<Child>,
    raw: ReadonlyArray<{ _tag: string }>,
    loc: LocationInfo
  ): JessNode {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const nameParts: string[] = [];
    for (const l of ls) {
      if (l.value === '(' || l.value === ';') {
        break;
      }
      nameParts.push(l.value);
    }
    const name = nameParts.join('');
    const argsList = nodeChildren(children).find(n => n.type === 'List');
    if (!argsList) {
      this._warn(
        'Calling a mixin without parentheses is deprecated and will be removed.',
        'mixin-call-no-parens'
      );
    } else {
      // Whitespace between the name and '(' → trivia immediately before the args
      // node (the '(' lives inside the MixinArgs node, so check the boundary).
      const items = raw as Array<{ _tag: string }>;
      const argsIdx = items.findIndex(i => i._tag === 'node');
      if (argsIdx > 0 && items[argsIdx - 1]?._tag === 'trivia') {
        this._warn(
          'Whitespace between a mixin name and parentheses is deprecated.',
          'mixin-call-whitespace'
        );
      }
    }
    const ref = new Reference(
      { key: name } as unknown as ReferenceValue,
      { type: 'mixin-ruleset', role: 'name' } as any,
      loc
    );
    return new Call(
      { name: ref as any, args: (argsList ?? new List([] as any, {} as any, loc)) as any },
      {}, loc
    ) as unknown as JessNode;
  }

  // ── Mixin builders ─────────────────────────────────────────────────────────

  private _buildMixinArgs(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const inner = ls.find(l => l.value !== '(' && l.value !== ')')?.value ?? '';
    const trimmed = inner.trim();
    if (!trimmed) {
      return new List([] as any, {} as any, loc);
    }
    // Top-level separator: ';' takes precedence (Less's coarser arg separator).
    const sep = trimmed.includes(';') ? ';' : ',';
    const items = this._splitTopLevel(trimmed, sep)
      .map(p => p.trim()).filter(Boolean)
      .map(p => this._mixinArgPart(p, loc));
    return new List(items as any, { sep } as any, loc);
  }

  // A single mixin argument: ~(...) → escaped Paren wrapping a comma List;
  // a comma-bearing arg → nested comma List; otherwise an Any[role=ident].
  private _mixinArgPart(part: string, loc: LocationInfo): JessNode {
    const esc = /^~\(([\s\S]*)\)$/.exec(part);
    if (esc) {
      const innerItems = this._splitTopLevel(esc[1]!, ',')
        .map(s => new Any(s.trim(), { role: 'ident' }, loc));
      const innerList = new List(innerItems as any, undefined as any, loc);
      return new Paren(innerList as any, { escaped: true } as any, loc) as unknown as JessNode;
    }
    if (this._splitTopLevel(part, ',').length > 1) {
      const innerItems = this._splitTopLevel(part, ',')
        .map(s => new Any(s.trim(), { role: 'ident' }, loc));
      return new List(innerItems as any, undefined as any, loc) as unknown as JessNode;
    }
    return new Any(part, { role: 'ident' }, loc) as unknown as JessNode;
  }

  // Split a string on `sep`, ignoring separators nested inside (), [], "" or ''.
  private _splitTopLevel(text: string, sep: string): string[] {
    const out: string[] = [];
    let depth = 0, quote = '', start = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (quote) {
        if (ch === quote) {
          quote = '';
          continue;
        }
      }
      if (ch === '"' || ch === '\'') {
        quote = ch;
      } else if (ch === '(' || ch === '[') {
        depth++;
      } else if (ch === ')' || ch === ']') {
        depth--;
      } else if (ch === sep && depth === 0) {
        out.push(text.slice(start, i));
        start = i + 1;
      }
    }
    out.push(text.slice(start));
    return out;
  }

  private _buildAnonMixin(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const nodes = nodeChildren(children);
    const rules = nodes.filter(n => n.type !== 'List');
    // '.' isn't a scanner-native selector; defer materialization so the Ruleset
    // constructor accepts the anonymous-mixin placeholder selector.
    return new Ruleset(
      { selector: '.', rules },
      { deferSelectorMaterialization: true } as any,
      loc
    );
  }

  private _buildMixinOrQualified(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const nodes = nodeChildren(children);
    const hasBlock = ls.some(l => l.value === '{');
    // Name path: leading selector/combinator leaves before any '(' / '{' / ';'.
    const nameParts: string[] = [];
    for (const l of ls) {
      if (l.value === '(' || l.value === '{' || l.value === '}' || l.value === ';' || l.value === ')') {
        break;
      }
      nameParts.push(l.value);
    }
    const name = nameParts.join('');
    const argsList = nodes.find(n => n.type === 'List');
    const guard = nodes.find(n => n.type === 'Paren' || n.type === 'Condition' || n.type === 'DefaultGuard');
    if (hasBlock) {
      // Mixin definition or qualified rule → a Ruleset (carrying any when-guard).
      const ruleNodes = nodes.filter(n => n !== argsList && n !== guard);
      return new Ruleset(
        { selector: name || '&', rules: ruleNodes, guard: guard as any },
        undefined, loc
      ) as unknown as JessNode;
    }
    // Mixin call → Call(name: mixin-ruleset Reference, args: List).
    const ref = new Reference(
      { key: name } as unknown as ReferenceValue,
      { type: 'mixin-ruleset', role: 'name' } as any,
      loc
    );
    return new Call(
      { name: ref as any, args: (argsList ?? new List([] as any, {} as any, loc)) as any },
      {}, loc
    ) as unknown as JessNode;
  }

  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
}
