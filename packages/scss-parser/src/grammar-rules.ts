/**
 * Exportable SCSS grammar fragment — the delta on top of the Less grammar.
 *
 * Spread AFTER `lessGrammarRules` in a consumer's `rules()` map; these keys
 * override Less's `@`-variable rules with SCSS `$`-variable rules and inject the
 * SCSS control-flow statements (@if/@else, …) ahead of Less's generic at-rules.
 * See docs/guide/extending.md (parseman) for the composition model.
 *
 * Macro-neutral: imports `'parseman'` without `with { type: 'macro' }`.
 * Self-contained: terminals are block-local inside the factory.
 */
import { node, regex, literal, sequence, choice, optional, parser, noTrivia, many, expect, sepBy, oneOrMore, scanTo, balanced } from 'parseman';

export type ScssGrammarDeps = { build: (type: string, c: any, r: any, s: any) => any };

/**
 * SCSS-specific rule overrides. `g.rw`, `g.valueList`, the statement-item
 * choices (`g.stylesheetItem`, `g.blockItem`) and the rest of the Less grammar
 * come from the spread of `lessGrammarRules` in the consumer.
 */
export const scssGrammarRules = (g: any, { build }: ScssGrammarDeps) => {
  // SCSS `$variable` token — first char may be a letter or `-` after `$`.
  const scssVar = regex(/\$-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const plainIdent = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const rw = g.rw;

  const VarDeclaration = node('VarDeclaration',
    parser({ trivia: rw }, sequence(
      scssVar,
      literal(':'),
      g.valueList,
      optional(choice(literal('!default'), literal('!global'))),
      optional(literal(';'))
    )),
    (c: any, r: any, s: any) => build('VarDeclaration', c, r, s));

  // SCSS references are bare `$var` (no Less accessor-chain syntax).
  const Reference = node('Reference',
    noTrivia(scssVar),
    (c: any, r: any, s: any) => build('Reference', c, r, s));

  // ── Interpolation (#{…}) ───────────────────────────────────────────────────
  // SCSS uses `#{expr}` (not Less `@{var}`). Override the Less interpolation
  // hooks: bare `#{…}` values, interpolated idents in names/selectors/strings.
  const scssInterpKey = regex(/(?:-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*|-)?#\{-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*\}(?:#\{-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*\}|[-_a-zA-Z0-9\u0080-\uffff])*/);
  const scssCustomPropInterp = regex(/--(?:[-_a-zA-Z0-9\u0080-\uffff]|#\{[^}]*\})+/);
  const customProp = regex(/--[-_a-zA-Z0-9\u0080-\uffff]*/);
  const scssDeclPropName = regex(/\*?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n])|#\{[^}]*\})(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n])|#\{[^}]*\})*/);
  const important = sequence(literal('!'), literal('important'));

  const ScssInterpBare = node('ScssInterpBare',
    parser({ trivia: rw }, sequence(literal('#'), literal('{'), g.valueSequence, expect(literal('}'), '}'))),
    (c: any, r: any, s: any) => build('ScssInterpBare', c, r, s));

  const InterpValue = node('InterpValue',
    parser({ trivia: rw }, scssInterpKey),
    (c: any, r: any, s: any) => build('InterpValue', c, r, s));

  // ── Sass map literals + module-qualified idents ────────────────────────────
  const dotName = regex(/\.-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const ScssMapPair = node('ScssMapPair',
    parser({ trivia: rw }, sequence(g.value, literal(':'), g.valueSequence)),
    (c: any, r: any, s: any) => build('ScssMapPair', c, r, s));
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
    )),
    (c: any, r: any, s: any) => build('ScssMapLiteral', c, r, s));
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
    )),
    (c: any, r: any, s: any) => build('ScssIdentValue', c, r, s));

  // Value-position paren. Unlike Less's strict single-expression `Paren`, SCSS
  // allows space/comma-separated value lists inside parens (e.g.
  // `(bold 15px/30px sans-serif)`). We parse permissively and let `_buildScssParen`
  // decide: an isolated arithmetic form (`(15px/30px)`, `(1 + 2)`) becomes an
  // `Expression(Operation)`; anything else stays a grouped `Paren`.
  const ScssValueParen = node('Paren',
    parser({ trivia: rw }, sequence(literal('('), g.permissiveParenBody)),
    (c: any, r: any, s: any) => build('Paren', c, r, s));

  const value = choice(
    ScssInterpBare, InterpValue, g.Reference, g.Dimension, g.Num, g.Color, g.NamedColor,
    g.Url, g.CalcCall, g.Call, ScssIdentValue, g.EscapedValue, g.GluedParen, ScssMapLiteral,
    ScssValueParen, g.SquareParen, g.Quoted, g.anyValue
  );

  const staticSeg = regex(/[-_a-zA-Z0-9]+/);
  const nameSegment = choice(staticSeg, ScssInterpBare);
  const ScssInterpolatedName = node('ScssInterpolatedName',
    parser({ trivia: rw }, oneOrMore(nameSegment)),
    (c: any, r: any, s: any) => build('ScssInterpolatedName', c, r, s));

  const InterpolatedSelector = node('InterpolatedSelector',
    parser({ trivia: rw }, sequence(
      optional(regex(/[.#]/)),
      oneOrMore(nameSegment)
    )),
    (c: any, r: any, s: any) => build('InterpolatedSelector', c, r, s));

  const CustomDeclaration = node('CustomDeclaration',
    parser({ trivia: rw }, sequence(
      choice(scssCustomPropInterp, customProp),
      literal(':'),
      choice(g.customCurlyBlock, g.customValue, g.cpValue),
      optional(literal(';'))
    )),
    (c: any, r: any, s: any) => build('CustomDeclaration', c, r, s));

  const ScssNestedDecl = node('ScssNestedDecl',
    parser({ trivia: rw }, sequence(
      scssDeclPropName,
      literal(':'),
      g.valueList,
      optional(literal(';'))
    )),
    (c: any, r: any, s: any) => build('Declaration', c, r, s));

  const ScssNestedProps = node('ScssNestedProps',
    parser({ trivia: rw }, sequence(
      literal('{'),
      many(ScssNestedDecl),
      expect(literal('}'), '}')
    )),
    (c: any, r: any, s: any) => build('ScssNestedProps', c, r, s));

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
    )),
    (c: any, r: any, s: any) => build('Declaration', c, r, s));

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
    parser({ trivia: rw }, sequence(condOperand, optional(sequence(scssCompareOp, condOperand)))),
    (c: any, r: any, s: any) => build('ScssComparison', c, r, s));
  // `(` condOr `)` (Paren-wrapped) OR a bare comparison.
  const ScssCondInParens = node('ScssCondInParens',
    parser({ trivia: rw }, choice(
      sequence(literal('('), g.ScssCondOr, literal(')')),
      g.ScssComparison
    )),
    (c: any, r: any, s: any) => build('ScssCondInParens', c, r, s));
  // A term: optional `not`, then a paren-group or a comparison.
  const ScssCondTerm = node('ScssCondTerm',
    parser({ trivia: rw }, sequence(optional(kwNot), g.ScssCondInParens)),
    (c: any, r: any, s: any) => build('ScssCondTerm', c, r, s));
  // 'and' chain (left-associative).
  const ScssCondAnd = node('ScssCondAnd',
    parser({ trivia: rw }, sequence(g.ScssCondTerm, many(sequence(kwAnd, g.ScssCondTerm)))),
    (c: any, r: any, s: any) => build('ScssCondAnd', c, r, s));
  // 'or' / ',' chain (left-associative). `,` is allowed in @if (legacy syntax).
  const ScssCondOr = node('ScssCondOr',
    parser({ trivia: rw }, sequence(g.ScssCondAnd, many(sequence(choice(kwOr, literal(',')), g.ScssCondAnd)))),
    (c: any, r: any, s: any) => build('ScssCondOr', c, r, s));

  // A `{ … }` block body → Rules (statements come from atRuleBody).
  const ScssRules = node('ScssRules',
    parser({ trivia: rw }, sequence(literal('{'), g.atRuleBody, expect(literal('}'), '}'))),
    (c: any, r: any, s: any) => build('ScssRules', c, r, s));

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
    )),
    (c: any, r: any, s: any) => build('ScssIf', c, r, s));

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
    )),
    (c: any, r: any, s: any) => build('ScssEach', c, r, s));

  const ScssFor = node('ScssFor',
    parser({ trivia: rw }, sequence(
      forKw,
      scssVar,
      fromKw,
      g.topSum,
      choice(forThrough, forTo),
      g.topSum,
      g.ScssRules
    )),
    (c: any, r: any, s: any) => build('ScssFor', c, r, s));

  const ScssWhile = node('ScssWhile',
    parser({ trivia: rw }, sequence(whileKw, g.ScssCondOr, g.ScssRules)),
    (c: any, r: any, s: any) => build('ScssWhile', c, r, s));

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
    )),
    (c: any, r: any, s: any) => build('ScssCallArg', c, r, s));
  const ScssCallArgsInner = node('ScssCallArgsInner',
    parser({ trivia: rw }, optional(sequence(
      g.ScssCallArg,
      many(sequence(literal(','), optional(g.ScssCallArg)))
    ))),
    (c: any, r: any, s: any) => build('ScssCallArgsInner', c, r, s));
  const optionalCallParens = optional(sequence(
    literal('('), g.ScssCallArgsInner, expect(literal(')'), ')')
  ));

  // Mixin parameter: `...$rest`, `$rest...`, `$a: default`, or bare `$a`.
  const ScssMixinParam = node('ScssMixinParam',
    parser({ trivia: rw }, choice(
      sequence(literal('...'), scssVar),
      sequence(scssVar, literal('...')),
      sequence(scssVar, optional(sequence(literal(':'), g.valueSequence)))
    )),
    (c: any, r: any, s: any) => build('ScssMixinParam', c, r, s));
  const ScssMixinParams = node('ScssMixinParams',
    parser({ trivia: rw }, sequence(
      literal('('),
      optional(sequence(
        g.ScssMixinParam,
        many(sequence(literal(','), optional(g.ScssMixinParam)))
      )),
      expect(literal(')'), ')')
    )),
    (c: any, r: any, s: any) => build('ScssMixinParams', c, r, s));

  // Mixin/include name: `foo`, module-qualified `ns.foo`, or `foo-#{$bar}`.
  const scssMixinIdent = choice(ScssInterpolatedName, plainIdent);
  const ScssMixinName = node('ScssMixinName',
    parser({ trivia: rw }, choice(
      sequence(plainIdent, literal('.'), plainIdent),
      ScssInterpolatedName,
      plainIdent
    )),
    (c: any, r: any, s: any) => build('ScssMixinName', c, r, s));

  const ScssDeclBody = node('ScssDeclBody',
    parser({ trivia: rw }, sequence(literal('{'), g.declarationList, expect(literal('}'), '}'))),
    (c: any, r: any, s: any) => build('ScssDeclBody', c, r, s));

  const ScssMixin = node('ScssMixin',
    parser({ trivia: rw }, sequence(
      mixinKw, scssMixinIdent, optional(g.ScssMixinParams), g.ScssDeclBody
    )),
    (c: any, r: any, s: any) => build('ScssMixin', c, r, s));

  const ScssIncludeUsing = node('ScssIncludeUsing',
    parser({ trivia: rw }, sequence(
      usingKw, literal('('), sepBy(scssVar, literal(',')), expect(literal(')'), ')')
    )),
    (c: any, r: any, s: any) => build('ScssIncludeUsing', c, r, s));

  const ScssInclude = node('ScssInclude',
    parser({ trivia: rw }, sequence(
      includeKw, g.ScssMixinName, optionalCallParens,
      optional(g.ScssIncludeUsing), optional(g.ScssRules), optional(literal(';'))
    )),
    (c: any, r: any, s: any) => build('ScssInclude', c, r, s));

  const ScssContent = node('ScssContent',
    parser({ trivia: rw }, sequence(contentKw, optionalCallParens, optional(literal(';')))),
    (c: any, r: any, s: any) => build('ScssContent', c, r, s));

  // ── @function / @return ─────────────────────────────────────────────────────
  const functionKw = regex(/@function(?![-\w])/i);
  const returnKw = regex(/@return(?![-\w])/i);

  const ScssFunction = node('ScssFunction',
    parser({ trivia: rw }, sequence(
      functionKw, scssMixinIdent, optional(g.ScssMixinParams), g.ScssDeclBody
    )),
    (c: any, r: any, s: any) => build('ScssFunction', c, r, s));

  const ScssReturn = node('ScssReturn',
    parser({ trivia: rw }, sequence(returnKw, g.valueList, expect(literal(';'), ';'))),
    (c: any, r: any, s: any) => build('ScssReturn', c, r, s));

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
    )),
    (c: any, r: any, s: any) => build('ScssWithConfigEntry', c, r, s));
  const ScssWithConfig = node('ScssWithConfig',
    parser({ trivia: rw }, sequence(
      literal('('),
      optional(sepBy(ScssWithConfigEntry, literal(','))),
      expect(literal(')'), ')')
    )),
    (c: any, r: any, s: any) => build('ScssWithConfig', c, r, s));

  const ScssUseAs = node('ScssUseAs',
    parser({ trivia: rw }, sequence(kwAs, choice(literal('*'), plainIdent))),
    (c: any, r: any, s: any) => build('ScssUseAs', c, r, s));

  const ScssUse = node('ScssUse',
    parser({ trivia: rw }, sequence(
      useKw, g.Quoted,
      optional(ScssUseAs),
      optional(sequence(kwWith, ScssWithConfig)),
      expect(literal(';'), ';')
    )),
    (c: any, r: any, s: any) => build('ScssUse', c, r, s));

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
    )),
    (c: any, r: any, s: any) => build('ScssForward', c, r, s));

  const scssPlaceholder = regex(/%-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const ScssPlaceholderSelector = node('ScssPlaceholderSelector',
    scssPlaceholder,
    (c: any, r: any, s: any) => build('ScssPlaceholderSelector', c, r, s));
  const scssExtendComplex = choice(ScssPlaceholderSelector, g.LessComplexSelector);
  const ScssExtendTarget = node('ScssExtendTarget',
    parser({ trivia: rw }, sequence(
      scssExtendComplex,
      many(sequence(literal(','), scssExtendComplex))
    )),
    (c: any, r: any, s: any) => build('ScssExtendTarget', c, r, s));
  const ScssExtend = node('ScssExtend',
    parser({ trivia: rw }, sequence(
      extendKw, ScssExtendTarget,
      optional(extendOptional),
      expect(literal(';'), ';')
    )),
    (c: any, r: any, s: any) => build('ScssExtend', c, r, s));

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
    )),
    (c: any, r: any, s: any) => build('ScssImportItem', c, r, s));
  const ImportAtRuleStatement = node('ScssImportAtRule',
    parser({ trivia: rw }, sequence(
      importKw,
      optional(importOptionsParen),
      sepBy(ScssImportItem, literal(',')),
      expect(literal(';'), ';')
    )),
    (c: any, r: any, s: any) => build('ScssImportAtRule', c, r, s));

  const atRootKw = regex(/@at-root(?![-\w])/i);
  const debugKw = regex(/@debug(?![-\w])/i);
  const warnKw = regex(/@warn(?![-\w])/i);
  const errorKw = regex(/@error(?![-\w])/i);

  const ScssDiagnostic = node('ScssDiagnostic',
    parser({ trivia: rw }, sequence(
      choice(debugKw, warnKw, errorKw),
      g.valueSequence,
      expect(literal(';'), ';')
    )),
    (c: any, r: any, s: any) => build('ScssDiagnostic', c, r, s));

  const ScssAtRootFilter = node('ScssAtRootFilter',
    parser({ trivia: rw }, sequence(
      atRootKw,
      literal('('),
      g.valueSequence,
      literal(')'),
      ScssRules
    )),
    (c: any, r: any, s: any) => build('ScssAtRootFilter', c, r, s));

  const ScssAtRootSelector = node('ScssAtRootSelector',
    parser({ trivia: rw }, sequence(
      atRootKw,
      g.LessSelectorList,
      ScssDeclBody
    )),
    (c: any, r: any, s: any) => build('ScssAtRootSelector', c, r, s));

  const ScssAtRootPlain = node('ScssAtRootPlain',
    parser({ trivia: rw }, sequence(atRootKw, ScssRules)),
    (c: any, r: any, s: any) => build('ScssAtRootPlain', c, r, s));

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
    )),
    (c: any, r: any, s: any) => build('ScssPlaceholderRuleset', c, r, s));
  const queryAtKeyword = regex(/@(?:media|container|supports)(?![-\w])/i);
  const QueryAtRuleBlock = node('QueryAtRuleBlock',
    parser({ trivia: rw }, sequence(
      queryAtKeyword,
      scssPermissivePrelude,
      expect(literal('{'), '{'),
      atRuleBody,
      expect(literal('}'), '}')
    )),
    (c: any, r: any, s: any) => build('QueryAtRuleBlock', c, r, s));
  const scopeKw = regex(/@scope(?![-\w])/i);
  const ScssScopeBlock = node('ScssScopeBlock',
    parser({ trivia: rw }, sequence(
      scopeKw,
      scssPermissivePrelude,
      literal('{'),
      atRuleBody,
      expect(literal('}'), '}')
    )),
    (c: any, r: any, s: any) => build('ScssScopeBlock', c, r, s));
  const layerKw = regex(/@layer(?![-\w])/i);
  const ScssLayerBlock = node('ScssLayerBlock',
    parser({ trivia: rw }, sequence(
      layerKw,
      optional(ScssInterpolatedName),
      literal('{'),
      atRuleBody,
      expect(literal('}'), '}')
    )),
    (c: any, r: any, s: any) => build('ScssLayerBlock', c, r, s));
  const Stylesheet = node('Stylesheet',
    parser({ trivia: rw }, many(choice(
      scssStatement, ScssPlaceholderRuleset, ScssScopeBlock, ScssLayerBlock, g.stylesheetItem
    ))),
    (c: any, r: any, s: any) => build('Stylesheet', c, r, s));

  return {
    VarDeclaration, Reference,
    ScssInterpBare, InterpValue, value, ScssMapLiteral, ScssIdentValue,
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
};
