/**
 * Functional SCSS grammar — the macro-compiled counterpart to the class-based
 * ScssGrammar. This file is JUST the grammar: `scssGrammar = compose([lessGrammar,
 * <SCSS delta>])`. Every rule is a structural `node(type, parser)` that builds via
 * the injected `ctx.build` host. The host + parse entry (`parseScssFn`,
 * `ScssParser`) live in ./functional-parser.ts; the shared driver in
 * @jesscss/css-parser.
 */
import {
  rules, compose,
  node, regex, literal, sequence, choice, optional, parser, noTrivia, trivia,
  many, expect, sepBy, oneOrMore, scanTo, balanced
} from 'parseman' with { type: 'macro' };
import { lessGrammar } from '@jesscss/less-parser';

// ---------------------------------------------------------------------------
// Grammar — SCSS = Less + the SCSS delta. `compose` fuses the imported compiled
// `lessGrammar` (pieces travel on the value — no source) with the inline SCSS
// delta; the delta's rules win by name (its `Stylesheet` etc. override Less's),
// and its references to Less/CSS rules resolve into the fused set. One grammar =
// one `rules()`; no fragment spreads.
// ---------------------------------------------------------------------------

export const scssGrammar = compose([lessGrammar, rules((g: any) => {
  // SCSS `$variable` token — first char may be a letter or `-` after `$`.
  const scssVar = regex(/\$-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const plainIdent = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  // Trivia defined LOCALLY (not `g.rw`): a rule's trivia parser is baked inline at
  // compile time, so it can't be an external by-name ref. Same shape as Less/CSS
  // (whitespace + block + `//` line comments).
  const ws = regex(/[ \t\n\r\f]+/);
  const comment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
  const lineComment = regex(/\/\/[^\n\r]*/);
  const rw = trivia(oneOrMore(choice(ws, comment, lineComment)));

  const VarDeclaration = node('VarDeclaration',
    parser({ trivia: rw }, sequence(
      scssVar,
      literal(':'),
      g.valueList,
      optional(choice(literal('!default'), literal('!global'))),
      optional(literal(';'))
    )));

  // SCSS references are bare `$var` (no Less accessor-chain syntax).
  const Reference = node('Reference',
    noTrivia(scssVar));

  // ── Interpolation (#{…}) ───────────────────────────────────────────────────
  // SCSS uses `#{expr}` (not Less `@{var}`). Override the Less interpolation
  // hooks: bare `#{…}` values, interpolated idents in names/selectors/strings.
  const scssInterpKey = regex(/(?:-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*|-)?#\{-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*\}(?:#\{-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*\}|[-_a-zA-Z0-9\u0080-\uffff])*/);
  const scssCustomPropInterp = regex(/--(?:[-_a-zA-Z0-9\u0080-\uffff]|#\{[^}]*\})+/);
  const customProp = regex(/--[-_a-zA-Z0-9\u0080-\uffff]*/);
  const scssDeclPropName = regex(/\*?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n])|#\{[^}]*\})(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n])|#\{[^}]*\})*/);
  const important = sequence(literal('!'), literal('important'));

  const ScssInterpBare = node('ScssInterpBare',
    parser({ trivia: rw }, sequence(literal('#'), literal('{'), g.valueSequence, expect(literal('}'), '}'))));

  const InterpValue = node('InterpValue',
    parser({ trivia: rw }, scssInterpKey));

  // ── Sass map literals + module-qualified idents ────────────────────────────
  const dotName = regex(/\.-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const ScssMapPair = node('ScssMapPair',
    parser({ trivia: rw }, sequence(g.value, literal(':'), g.valueSequence)));
  // A Sass map literal REQUIRES at least one `key: value` pair. `expect(')')`
  // recovers in place (zero-width success), so if this rule matched an empty or
  // pairless `(…)` it would swallow every parenthesized value before the value
  // paren rule is tried. Requiring a real pair (the `:` is a soft `literal`) lets a
  // non-map paren like `(15px/30px)` or `(1 + 2)` fail here and fall through.
  const ScssMapLiteral = node('ScssMapLiteral',
    parser({ trivia: rw }, sequence(
      literal('('),
      ScssMapPair,
      many(sequence(literal(','), ScssMapPair)),
      optional(literal(',')),
      expect(literal(')'), ')')
    )));
  const scssHashName = regex(/#-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const ScssIdentValue = node('ScssIdentValue',
    parser({ trivia: rw }, sequence(
      plainIdent,
      optional(choice(
        sequence(
          literal('.'), literal('\\'), choice(scssHashName, dotName),
          literal('('), optional(g.ScssCallArgsInner), expect(literal(')'), ')')
        ),
        sequence(literal('.'), scssVar),
        sequence(dotName, literal('('), optional(g.ScssCallArgsInner), expect(literal(')'), ')'))
      ))
    )));

  // Value-position paren. Unlike Less's strict single-expression `Paren`, SCSS
  // allows space/comma-separated value lists inside parens (e.g.
  // `(bold 15px/30px sans-serif)`). We parse permissively and let `_buildScssParen`
  // decide: an isolated arithmetic form (`(15px/30px)`, `(1 + 2)`) becomes an
  // `Expression(Operation)`; anything else stays a grouped `Paren`.
  const ScssValueParen = node('Paren',
    parser({ trivia: rw }, sequence(literal('('), g.permissiveParenBody)));

  // Sass allows trailing commas in comma-separated lists (Less v5 rejects them).
  const valueList = parser({ trivia: rw }, sequence(
    g.valueSequence,
    many(sequence(literal(','), g.valueSequence)),
    optional(literal(','))
  ));
  const callArgSeq = choice(g.AnonymousMixinDefinition, g.DetachedRuleset, g.valueSequence);
  const callArgList = choice(g.AnonymousMixinDefinition, g.DetachedRuleset, valueList);
  const functionCallArgs = parser({ trivia: rw }, sequence(
    optional(sequence(
      callArgSeq,
      many(sequence(literal(','), callArgSeq)),
      optional(literal(',')),
      many(sequence(literal(';'), optional(callArgList)))
    )),
    literal(')')
  ));
  const fnIdent = regex(/-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))*/);
  const Call = node('Call',
    parser({ trivia: rw }, sequence(fnIdent, literal('('), functionCallArgs)));

  const value = choice(
    ScssInterpBare, InterpValue, g.Reference, g.Dimension, g.Num, g.Color, g.NamedColor,
    g.Url, g.CalcCall, g.Call, ScssIdentValue, g.EscapedValue, g.GluedParen, ScssMapLiteral,
    ScssValueParen, g.SquareParen, g.Quoted, g.anyValue
  );

  const staticSeg = regex(/[-_a-zA-Z0-9]+/);
  const nameSegment = choice(staticSeg, ScssInterpBare);
  const ScssInterpolatedName = node('ScssInterpolatedName',
    parser({ trivia: rw }, oneOrMore(nameSegment)));

  const InterpolatedSelector = node('InterpolatedSelector',
    parser({ trivia: rw }, sequence(
      optional(regex(/[.#]/)),
      oneOrMore(nameSegment)
    )));

  const CustomDeclaration = node('CustomDeclaration',
    parser({ trivia: rw }, sequence(
      choice(scssCustomPropInterp, customProp),
      literal(':'),
      choice(g.customCurlyBlock, g.customValue, g.cpValue),
      optional(literal(';'))
    )));

  // A nested prop (`size: 1rem`) is built AS a `Declaration` (structural node →
  // ctx.build('Declaration')); `_buildScssNestedProps` filters children for
  // Declaration nodes. The rule's own name stays local (`many(ScssNestedDecl)`).
  const ScssNestedDecl = node('Declaration',
    parser({ trivia: rw }, sequence(
      scssDeclPropName,
      literal(':'),
      g.valueList,
      optional(literal(';'))
    )));

  const ScssNestedProps = node('ScssNestedProps',
    parser({ trivia: rw }, sequence(
      literal('{'),
      many(ScssNestedDecl),
      expect(literal('}'), '}')
    )));

  const Declaration = node('Declaration',
    parser({ trivia: rw }, sequence(
      scssDeclPropName,
      optional(choice(literal('+_'), literal('+'))),
      literal(':'),
      choice(
        ScssNestedProps,
        sequence(
          optional(g.valueList),
          optional(ScssNestedProps)
        )
      ),
      optional(important),
      optional(literal(';'))
    )));

  // ── Control flow: @if / @else if / @else ───────────────────────────────────
  // Faithful port of the Chevrotain scssCondition* / scssIfAtRule productions
  // (productions/conditions.ts, productions/atRules.ts). The condition sub-
  // grammar is structurally the Less guard grammar (or → and → term → parens /
  // comparison), so the SCSS builders mirror LessGrammar's guard builders.
  const scssCompareOp = regex(/==|!=|>=|<=|=|>|</);
  const kwOr = regex(/or(?![-\w])/i);
  const kwAnd = regex(/and(?![-\w])/i);
  const kwNot = regex(/not(?![-\w])/i);

  // A single comparison operand. Specific value rules first; `anyValue` last —
  // it stops at whitespace so it cannot swallow a spaced ` == ` / `and` / `{`.
  const condOperand = choice(g.Reference, g.Dimension, g.Num, g.Color, g.NamedColor, g.Quoted, g.Call, g.Paren, g.anyValue);
  const ScssComparison = node('ScssComparison',
    parser({ trivia: rw }, sequence(condOperand, optional(sequence(scssCompareOp, condOperand)))));
  // `(` condOr `)` (Paren-wrapped) OR a bare comparison.
  const ScssCondInParens = node('ScssCondInParens',
    parser({ trivia: rw }, choice(
      sequence(literal('('), g.ScssCondOr, literal(')')),
      g.ScssComparison
    )));
  // A term: optional `not`, then a paren-group or a comparison.
  const ScssCondTerm = node('ScssCondTerm',
    parser({ trivia: rw }, sequence(optional(kwNot), g.ScssCondInParens)));
  // 'and' chain (left-associative).
  const ScssCondAnd = node('ScssCondAnd',
    parser({ trivia: rw }, sequence(g.ScssCondTerm, many(sequence(kwAnd, g.ScssCondTerm)))));
  // 'or' / ',' chain (left-associative). `,` is allowed in @if (legacy syntax).
  const ScssCondOr = node('ScssCondOr',
    parser({ trivia: rw }, sequence(g.ScssCondAnd, many(sequence(choice(kwOr, literal(',')), g.ScssCondAnd)))));

  // A `{ … }` block body → Rules (statements come from atRuleBody).
  const ScssRules = node('ScssRules',
    parser({ trivia: rw }, sequence(literal('{'), g.atRuleBody, expect(literal('}'), '}'))));

  const ifKw = regex(/@if(?![-\w])/i);
  const elseKw = regex(/@else(?![-\w])/i);
  const ifWord = regex(/if(?![-\w])/i);
  const ScssIf = node('ScssIf',
    parser({ trivia: rw }, sequence(
      ifKw, g.ScssCondOr, g.ScssRules,
      many(sequence(elseKw, choice(
        sequence(ifWord, g.ScssCondOr, g.ScssRules),
        g.ScssRules
      )))
    )));

  // ── Control flow: @each / @for / @while ────────────────────────────────────
  // Faithful ports of scssEachAtRule / scssForAtRule / scssWhileAtRule
  // (productions/atRules.ts). All normalize to Jess `For` / `While` nodes.
  const inKw = regex(/\bin\b/);
  const fromKw = regex(/\bfrom\b/);
  const forThrough = regex(/\bthrough\b/);
  const forTo = regex(/\bto\b/);
  const eachKw = regex(/@each(?![-\w])/i);
  const forKw = regex(/@for(?![-\w])/i);
  const whileKw = regex(/@while(?![-\w])/i);

  const ScssEach = node('ScssEach',
    parser({ trivia: rw }, sequence(
      eachKw,
      sepBy(scssVar, literal(',')),
      inKw,
      g.valueSequence,
      g.ScssRules
    )));

  const ScssFor = node('ScssFor',
    parser({ trivia: rw }, sequence(
      forKw,
      scssVar,
      fromKw,
      g.topSum,
      choice(forThrough, forTo),
      g.topSum,
      g.ScssRules
    )));

  const ScssWhile = node('ScssWhile',
    parser({ trivia: rw }, sequence(whileKw, g.ScssCondOr, g.ScssRules)));

  // ── Mixins: @mixin / @include / @content ───────────────────────────────────
  // Faithful ports of scssMixinAtRule / scssIncludeAtRule / scssContentAtRule.
  const mixinKw = regex(/@mixin(?![-\w])/i);
  const includeKw = regex(/@include(?![-\w])/i);
  const contentKw = regex(/@content(?![-\w])/i);
  const usingKw = regex(/\busing\b/);

  // SCSS call/mixin argument: `$x: val`, `val...`, or a plain value.
  const ScssCallArg = node('ScssCallArg',
    parser({ trivia: rw }, choice(
      sequence(scssVar, literal(':'), g.valueSequence),
      sequence(g.value, literal('...')),
      sequence(g.valueSequence, literal('...')),
      g.valueSequence
    )));
  const ScssCallArgsInner = node('ScssCallArgsInner',
    parser({ trivia: rw }, optional(sequence(
      g.ScssCallArg,
      many(sequence(literal(','), optional(g.ScssCallArg)))
    ))));
  const optionalCallParens = optional(sequence(
    literal('('), g.ScssCallArgsInner, expect(literal(')'), ')')
  ));

  // Mixin parameter: `...$rest`, `$rest...`, `$a: default`, or bare `$a`.
  const ScssMixinParam = node('ScssMixinParam',
    parser({ trivia: rw }, choice(
      sequence(literal('...'), scssVar),
      sequence(scssVar, literal('...')),
      sequence(scssVar, optional(sequence(literal(':'), g.valueSequence)))
    )));
  const ScssMixinParams = node('ScssMixinParams',
    parser({ trivia: rw }, sequence(
      literal('('),
      optional(sequence(
        g.ScssMixinParam,
        many(sequence(literal(','), optional(g.ScssMixinParam)))
      )),
      expect(literal(')'), ')')
    )));

  // Mixin/include name: `foo`, module-qualified `ns.foo`, or `foo-#{$bar}`.
  const scssMixinIdent = choice(ScssInterpolatedName, plainIdent);
  const ScssMixinName = node('ScssMixinName',
    parser({ trivia: rw }, choice(
      sequence(plainIdent, literal('.'), plainIdent),
      ScssInterpolatedName,
      plainIdent
    )));

  const ScssDeclBody = node('ScssDeclBody',
    parser({ trivia: rw }, sequence(literal('{'), g.declarationList, expect(literal('}'), '}'))));

  const ScssMixin = node('ScssMixin',
    parser({ trivia: rw }, sequence(
      mixinKw, scssMixinIdent, optional(g.ScssMixinParams), g.ScssDeclBody
    )));

  const ScssIncludeUsing = node('ScssIncludeUsing',
    parser({ trivia: rw }, sequence(
      usingKw, literal('('), sepBy(scssVar, literal(',')), expect(literal(')'), ')')
    )));

  const ScssInclude = node('ScssInclude',
    parser({ trivia: rw }, sequence(
      includeKw, g.ScssMixinName, optionalCallParens,
      optional(g.ScssIncludeUsing), optional(g.ScssRules), optional(literal(';'))
    )));

  const ScssContent = node('ScssContent',
    parser({ trivia: rw }, sequence(contentKw, optionalCallParens, optional(literal(';')))));

  // ── @function / @return ─────────────────────────────────────────────────────
  const functionKw = regex(/@function(?![-\w])/i);
  const returnKw = regex(/@return(?![-\w])/i);

  const ScssFunction = node('ScssFunction',
    parser({ trivia: rw }, sequence(
      functionKw, scssMixinIdent, optional(g.ScssMixinParams), g.ScssDeclBody
    )));

  const ScssReturn = node('ScssReturn',
    parser({ trivia: rw }, sequence(returnKw, g.valueList, expect(literal(';'), ';'))));

  // ── @use / @forward / @import / @extend ───────────────────────────────────
  // Faithful ports of scssUseAtRule / scssForwardAtRule / importAtRule /
  // scssExtendAtRule (productions/atRules.ts).
  const singleStr = regex(/'(?:[^'\\]|\\[\s\S])*'/);
  const doubleStr = regex(/"(?:[^"\\]|\\[\s\S])*"/);
  const strHole = [singleStr, doubleStr];
  const bParen = balanced('(', ')', { skip: strHole });
  const bSquare = balanced('[', ']', { skip: strHole });
  const bCurly = balanced('{', '}', { skip: strHole });
  const scanSkip = [bParen, bSquare, bCurly, singleStr, doubleStr];

  const kwAs = regex(/\bas\b/);
  const kwWith = regex(/\bwith\b/);
  const useKw = regex(/@use(?![-\w])/i);
  const forwardKw = regex(/@forward(?![-\w])/i);
  const extendKw = regex(/@extend(?![-\w])/i);
  const extendOptional = regex(/!optional\b/);
  const importKw = regex(/@import(?![-\w])/i);

  const ScssWithConfigEntry = node('ScssWithConfigEntry',
    parser({ trivia: rw }, sequence(
      scssVar, literal(':'), g.valueSequence,
      optional(choice(literal('!default'), literal('!global')))
    )));
  const ScssWithConfig = node('ScssWithConfig',
    parser({ trivia: rw }, sequence(
      literal('('),
      optional(sepBy(ScssWithConfigEntry, literal(','))),
      expect(literal(')'), ')')
    )));

  const ScssUseAs = node('ScssUseAs',
    parser({ trivia: rw }, sequence(kwAs, choice(literal('*'), plainIdent))));

  const ScssUse = node('ScssUse',
    parser({ trivia: rw }, sequence(
      useKw, g.Quoted,
      optional(ScssUseAs),
      optional(sequence(kwWith, ScssWithConfig)),
      expect(literal(';'), ';')
    )));

  const forwardExtra = optional(scanTo(
    choice(sequence(kwWith, literal('(')), literal(';')),
    { skip: scanSkip }
  ));
  const ScssForward = node('ScssForward',
    parser({ trivia: rw }, sequence(
      forwardKw, g.Quoted,
      forwardExtra,
      optional(sequence(kwWith, ScssWithConfig)),
      expect(literal(';'), ';')
    )));

  const scssPlaceholder = regex(/%-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const ScssPlaceholderSelector = node('ScssPlaceholderSelector',
    scssPlaceholder);
  const scssExtendComplex = choice(ScssPlaceholderSelector, g.ComplexSelector);
  const ScssExtendTarget = node('ScssExtendTarget',
    parser({ trivia: rw }, sequence(
      scssExtendComplex,
      many(sequence(literal(','), scssExtendComplex))
    )));
  const ScssExtend = node('ScssExtend',
    parser({ trivia: rw }, sequence(
      extendKw, ScssExtendTarget,
      optional(extendOptional),
      expect(literal(';'), ';')
    )));

  const importOptionsParen = sequence(
    literal('('),
    scanTo(literal(')'), { skip: scanSkip }),
    literal(')')
  );
  const importPostlude = scanTo(choice(literal(','), literal(';')), { skip: scanSkip });
  const ScssImportItem = node('ScssImportItem',
    parser({ trivia: rw }, sequence(
      expect(choice(g.Url, g.Quoted), 'import path'),
      optional(importPostlude)
    )));
  const ImportAtRuleStatement = node('ScssImportAtRule',
    parser({ trivia: rw }, sequence(
      importKw,
      optional(importOptionsParen),
      sepBy(ScssImportItem, literal(',')),
      expect(literal(';'), ';')
    )));

  const atRootKw = regex(/@at-root(?![-\w])/i);
  const debugKw = regex(/@debug(?![-\w])/i);
  const warnKw = regex(/@warn(?![-\w])/i);
  const errorKw = regex(/@error(?![-\w])/i);

  const ScssDiagnostic = node('ScssDiagnostic',
    parser({ trivia: rw }, sequence(
      choice(debugKw, warnKw, errorKw),
      g.valueSequence,
      expect(literal(';'), ';')
    )));

  const ScssAtRootFilter = node('ScssAtRootFilter',
    parser({ trivia: rw }, sequence(
      atRootKw,
      literal('('),
      g.valueSequence,
      literal(')'),
      ScssRules
    )));

  const ScssAtRootSelector = node('ScssAtRootSelector',
    parser({ trivia: rw }, sequence(
      atRootKw,
      g.SelectorList,
      ScssDeclBody
    )));

  const ScssAtRootPlain = node('ScssAtRootPlain',
    parser({ trivia: rw }, sequence(atRootKw, ScssRules)));

  // ── SCSS at-rule prelude interpolation (segments) ────────────────────────
  const scssPreludeText = regex(/(?:[^{#]|#(?!\{))+/);
  const scssPreludeSegment = choice(ScssInterpBare, scssPreludeText);
  const scssPermissivePrelude = parser({ trivia: rw }, oneOrMore(scssPreludeSegment));

  // ── Statement injection ─────────────────────────────────────────────────
  // Override Less's containers to try the SCSS control statements first, then
  // fall back to Less's full statement set (`g.stylesheetItem` / `g.blockItem`).
  const scssStatement = choice(
    g.ScssIf, g.ScssEach, g.ScssFor, g.ScssWhile,
    g.ScssMixin, g.ScssInclude, g.ScssContent,
    g.ScssFunction, g.ScssReturn,
    g.ScssUse, g.ScssForward,
    ScssDiagnostic,
    ScssAtRootFilter, ScssAtRootSelector, ScssAtRootPlain
  );
  const declarationList = parser({ trivia: rw }, many(choice(
    scssStatement, g.ScssExtend, Declaration, CustomDeclaration, g.blockItem
  )));
  const atRuleBody = parser({ trivia: rw }, many(choice(scssStatement, g.blockItem)));

  const ScssPlaceholderRuleset = node('ScssPlaceholderRuleset',
    parser({ trivia: rw }, sequence(
      ScssPlaceholderSelector,
      optional(g.Guard),
      literal('{'),
      declarationList,
      expect(literal('}'), '}')
    )));
  const queryAtKeyword = regex(/@(?:media|container|supports)(?![-\w])/i);
  const QueryAtRuleBlock = node('QueryAtRuleBlock',
    parser({ trivia: rw }, sequence(
      queryAtKeyword,
      scssPermissivePrelude,
      expect(literal('{'), '{'),
      atRuleBody,
      expect(literal('}'), '}')
    )));
  const scopeKw = regex(/@scope(?![-\w])/i);
  const ScssScopeBlock = node('ScssScopeBlock',
    parser({ trivia: rw }, sequence(
      scopeKw,
      scssPermissivePrelude,
      literal('{'),
      atRuleBody,
      expect(literal('}'), '}')
    )));
  const layerKw = regex(/@layer(?![-\w])/i);
  const ScssLayerBlock = node('ScssLayerBlock',
    parser({ trivia: rw }, sequence(
      layerKw,
      optional(ScssInterpolatedName),
      literal('{'),
      atRuleBody,
      expect(literal('}'), '}')
    )));
  const Stylesheet = node('Stylesheet',
    parser({ trivia: rw }, many(choice(
      scssStatement, ScssPlaceholderRuleset, ScssScopeBlock, ScssLayerBlock, g.stylesheetItem
    ))));

  return {
    VarDeclaration, Reference,
    ScssInterpBare, InterpValue, value, valueList, functionCallArgs, Call,
    ScssMapLiteral, ScssIdentValue,
    ScssInterpolatedName, InterpolatedSelector,
    Declaration, CustomDeclaration,
    ScssComparison, ScssCondInParens, ScssCondTerm, ScssCondAnd, ScssCondOr, ScssRules, ScssIf,
    ScssEach, ScssFor, ScssWhile,
    ScssCallArg, ScssCallArgsInner, ScssMixinParam, ScssMixinParams, ScssMixinName,
    ScssDeclBody, ScssMixin, ScssIncludeUsing, ScssInclude, ScssContent,
    ScssFunction, ScssReturn,
    ScssWithConfigEntry, ScssWithConfig, ScssUseAs, ScssUse, ScssForward,
    ScssPlaceholderSelector, ScssPlaceholderRuleset, ScssExtendTarget, ScssExtend,
    ScssImportItem, ImportAtRuleStatement,
    ScssNestedProps,
    ScssDiagnostic, ScssAtRootFilter, ScssAtRootSelector, ScssAtRootPlain,
    QueryAtRuleBlock, ScssScopeBlock, ScssLayerBlock,
    Stylesheet, declarationList, atRuleBody
  };
})]);
