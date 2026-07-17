/**
 * Functional SCSS grammar — the macro-compiled counterpart to the class-based
 * ScssGrammar. This file is JUST the grammar: `scssGrammar = compose([lessGrammar,
 * <SCSS delta>])`. Most returned rules are structural `node(parser)` entries that build via
 * the injected `ctx.build` host. The host + parse entry (`parseScssFn`,
 * `ScssParser`) live in ./functional-parser.ts; the shared driver in
 * @jesscss/css-parser.
 */
import {
  rules, compose,
  node, regex, literal, sequence, choice, optional, trivia,
  many, expect, sepBy, oneOrMore, scanTo, balanced, label, not, withCtx
} from 'parseman' with { type: 'macro' };
import { lessGrammar } from '@jesscss/less-parser/grammar';

// ---------------------------------------------------------------------------
// Grammar — SCSS = Less + the SCSS delta. `compose` fuses the imported compiled
// `lessGrammar` (pieces travel on the value — no source) with the inline SCSS
// delta; the delta's rules win by name (its `Stylesheet` etc. override Less's),
// and its references to Less/CSS rules resolve into the fused set. One grammar =
// one `rules()`; no fragment spreads.
// ---------------------------------------------------------------------------

// Trivia (`rw`) is declared ONCE on the grammar via `rules({ trivia: rw }, …)`,
// honored through `compose()`, making it ambient in every rule — no per-rule
// trivia-establisher wrappers are needed. Hoisted to module scope (mirroring
// css-parser) so the options-first `rules({ trivia: rw }, …)` call below can
// reference it. Same shape as Less/CSS (whitespace + block + `//` line comments).
const ws = regex(/[ \t\n\r\f]+/);
const comment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const lineComment = regex(/\/\/[^\n\r]*/);
const rw = trivia(oneOrMore(choice(label('whitespace', ws), label('blockComment', comment), label('lineComment', lineComment))));

export const scssGrammar = compose([lessGrammar, rules({ trivia: rw }, (g: any) => {
  // SCSS `$variable` token — first char may be a letter or `-` after `$`.
  const scssVar = regex(/\$-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const plainIdent = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);

  const VarDeclaration = node(
    sequence(
      scssVar,
      literal(':'),
      g.valueList,
      optional(choice(literal('!default'), literal('!global'))),
      optional(literal(';'))
    ));

  // SCSS references are bare `$var` (no Less accessor-chain syntax) — a single
  // token, so no trivia handling is needed.
  const Reference = node(scssVar);

  // Namespaced variable ASSIGNMENT — `ns.$var: value [!default|!global];`. Writes
  // into another module's variable (distinct from the member READ `ns.get-x()`).
  // The `plainIdent '.' scssVar` head can't be confused with a Declaration
  // (`scssDeclPropName` stops before `.`) or a class-selector ruleset (`.` there
  // is followed by an ident, not `$`), so this is safe at statement head.
  const NsVarDeclaration = node(
    sequence(
      plainIdent,
      literal('.'),
      scssVar,
      literal(':'),
      g.valueList,
      optional(choice(literal('!default'), literal('!global'))),
      optional(literal(';'))
    ));

  // ── Interpolation (#{…}) ───────────────────────────────────────────────────
  // SCSS uses `#{expr}` (not Less `@{var}`). Override the Less interpolation
  // hooks: bare `#{…}` values, interpolated idents in names/selectors/strings.
  const scssInterpKey = regex(/(?:-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*|-)?#\{-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*\}(?:#\{-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*\}|[-_a-zA-Z0-9\u0080-\uffff])*/);
  const scssCustomPropInterp = regex(/--(?:[-_a-zA-Z0-9\u0080-\uffff]|#\{[^}]*\})+/);
  const customProp = regex(/--[-_a-zA-Z0-9\u0080-\uffff]*/);
  const scssDeclPropName = regex(/\*?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f])|#\{[^}]*\})(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f])|#\{[^}]*\})*/);
  const important = sequence(literal('!'), literal('important'));

  const ScssInterpBare = node(
    sequence(literal('#'), literal('{'), g.valueSequence, expect(literal('}'), '}')));

  const InterpValue = node(
    scssInterpKey);

  // ── Sass map literals + module-qualified idents ────────────────────────────
  const dotName = regex(/\.-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const ScssMapPair = node('ScssMapPair',
    sequence(g.value, literal(':'), g.valueSequence));
  // A Sass map literal REQUIRES at least one `key: value` pair. `expect(')')`
  // recovers in place (zero-width success), so if this rule matched an empty or
  // pairless `(…)` it would swallow every parenthesized value before the value
  // paren rule is tried. Requiring a real pair (the `:` is a soft `literal`) lets a
  // non-map paren like `(15px/30px)` or `(1 + 2)` fail here and fall through.
  const ScssMapLiteral = node(
    sequence(
      literal('('),
      ScssMapPair,
      many(sequence(literal(','), ScssMapPair)),
      optional(literal(',')),
      expect(literal(')'))
    ));
  const scssHashName = regex(/#-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const ScssIdentValue = node(
    sequence(
      plainIdent,
      optional(choice(
        sequence(
          literal('.'), literal('\\'), choice(scssHashName, dotName),
          literal('('), optional(g.ScssCallArgsInner), expect(literal(')'))
        ),
        sequence(literal('.'), scssVar),
        sequence(dotName, literal('('), optional(g.ScssCallArgsInner), expect(literal(')')))
      ))
    ));

  // Value-position paren. Unlike Less's strict single-expression `Paren`, SCSS
  // allows space/comma-separated value lists inside parens (e.g.
  // `(bold 15px/30px sans-serif)`). We parse permissively and let `_buildScssParen`
  // decide: an isolated arithmetic form (`(15px/30px)`, `(1 + 2)`) becomes an
  // `Expression(Operation)`; anything else stays a grouped `Paren`.
  const ScssValueParen = node('Paren',
    sequence(literal('('), g.permissiveParenBody));

  // Sass allows trailing commas in comma-separated lists (as does Less v5, matching Less 4.x).
  const valueList = sequence(
    g.valueSequence,
    many(sequence(literal(','), g.valueSequence)),
    optional(literal(','))
  );
  const callArgSeq = choice(g.AnonymousMixinDefinition, g.DetachedRuleset, g.valueSequence);
  const callArgList = choice(g.AnonymousMixinDefinition, g.DetachedRuleset, valueList);
  const functionCallArgs = sequence(
    optional(sequence(
      callArgSeq,
      many(sequence(literal(','), callArgSeq)),
      optional(literal(',')),
      many(sequence(literal(';'), optional(callArgList)))
    )),
    literal(')')
  );
  const fnIdent = regex(/-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
  const Call = node(
    sequence(fnIdent, literal('('), functionCallArgs));

  const value = choice(
    ScssInterpBare, InterpValue, g.Reference, g.Dimension, g.Num, g.Color, g.NamedColor,
    g.Url, g.CalcCall, g.Call, ScssIdentValue, g.EscapedValue, g.GluedParen, ScssMapLiteral,
    ScssValueParen, g.SquareParen, g.Quoted, g.anyValue
  );

  const staticSeg = regex(/[-_a-zA-Z0-9]+/);
  const nameSegment = choice(staticSeg, ScssInterpBare);
  const ScssInterpolatedName = node(
    oneOrMore(nameSegment));

  const InterpolatedSelector = node(
    sequence(
      optional(regex(/[.#]/)),
      oneOrMore(nameSegment)
    ));

  const CustomDeclaration = node(
    sequence(
      choice(scssCustomPropInterp, customProp),
      literal(':'),
      choice(g.customCurlyBlock, g.customValue, g.cpValue),
      optional(literal(';'))
    ));

  // A nested prop (`size: 1rem`) is built AS a `Declaration` (structural node →
  // ctx.build('Declaration')); `_buildScssNestedProps` filters children for
  // Declaration nodes. The rule's own name stays local (`many(ScssNestedDecl)`).
  const ScssNestedDecl = node('Declaration',
    sequence(
      scssDeclPropName,
      literal(':'),
      g.valueList,
      optional(literal(';'))
    ));

  // A nested-properties block (`font: { … }`) normally holds inner
  // sub-declarations, but Sass also allows control flow (`@for`, `@if`, …) and
  // namespaced variable ASSIGNMENTS inside it. Try those before the plain
  // sub-declaration.
  const ScssNestedProps = node(
    sequence(
      literal('{'),
      many(choice(
        g.ScssIf, g.ScssEach, g.ScssFor, g.ScssWhile,
        g.NsVarDeclaration, g.VarDeclaration,
        ScssNestedDecl
      )),
      expect(literal('}'))
    ));

  const Declaration = node(
    sequence(
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
    ));

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
  const ScssComparison = node(
    sequence(condOperand, optional(sequence(scssCompareOp, condOperand))));
  // `(` condOr `)` (Paren-wrapped) OR a bare comparison.
  const ScssCondInParens = node(
    choice(
      sequence(literal('('), g.ScssCondOr, literal(')')),
      g.ScssComparison
    ));
  // A term: optional `not`, then a paren-group or a comparison.
  const ScssCondTerm = node(
    sequence(optional(kwNot), g.ScssCondInParens));
  // 'and' chain (left-associative).
  const ScssCondAnd = node(
    sequence(g.ScssCondTerm, many(sequence(kwAnd, g.ScssCondTerm))));
  // 'or' / ',' chain (left-associative). `,` is allowed in @if (legacy syntax).
  const ScssCondOr = node(
    sequence(g.ScssCondAnd, many(sequence(choice(kwOr, literal(',')), g.ScssCondAnd))));

  // A `{ … }` block body → Rules (statements come from atRuleBody).
  const ScssRules = node(
    sequence(literal('{'), g.atRuleBody, expect(literal('}'), '}')));

  const ifKw = regex(/@if(?![-\w])/i);
  const elseKw = regex(/@else(?![-\w])/i);
  const ifWord = regex(/if(?![-\w])/i);
  // A REQUIRED condition. `@if { … }` (no condition) is a real error. `not('{')`
  // asserts we are not sitting directly on the block opener; `expect` reports the
  // missing condition and RECOVERS IN PLACE (zero-width) so the `{ … }` block still
  // parses (as an `@if` with a recovered error) rather than the whole rule failing
  // and `@if` falling through to the opaque unknown-at-rule handler. Structural,
  // context-free — no `withCtx`/`guard`, so the grammar stays macro-compiled.
  const reqIfCond = expect(sequence(not(literal('{')), g.ScssCondOr), 'condition');
  const ScssIf = node(
    sequence(
      ifKw, reqIfCond, g.ScssRules,
      many(sequence(elseKw, choice(
        sequence(ifWord, g.ScssCondOr, g.ScssRules),
        g.ScssRules
      )))
    ));

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

  // A REQUIRED loop variable. `@each in $list { … }` (no variable) is a real error.
  // `not(inKw | '{')` asserts a variable is actually present (missing → we are at
  // `in` or the block); `expect` reports it and recovers zero-width so `in $list
  // { … }` still parses as an `@each` with a recovered error.
  const reqEachVars = expect(
    sequence(not(choice(inKw, literal('{'))), sepBy(scssVar, literal(','))), 'variable');
  const ScssEach = node(
    sequence(
      eachKw,
      reqEachVars,
      inKw,
      g.valueSequence,
      g.ScssRules
    ));

  // A REQUIRED `from … through/to …` range. `@for $i { … }` (no range) is a real
  // error. The whole range tail is wrapped in one `expect`: on failure it recovers
  // zero-width (as a unit — `fromKw` is a hard token that fails at `{` without
  // consuming) so the trailing `{ … }` block still parses as a `@for` with a
  // recovered error rather than the rule failing and falling through.
  const forRangeTail = sequence(fromKw, g.topSum, choice(forThrough, forTo), g.topSum);
  const ScssFor = node(
    sequence(
      forKw,
      expect(scssVar, 'variable'),
      expect(forRangeTail, '"from"'),
      g.ScssRules
    ));

  const ScssWhile = node(
    sequence(whileKw, g.ScssCondOr, g.ScssRules));

  // ── Mixins: @mixin / @include / @content ───────────────────────────────────
  // Faithful ports of scssMixinAtRule / scssIncludeAtRule / scssContentAtRule.
  const mixinKw = regex(/@mixin(?![-\w])/i);
  const includeKw = regex(/@include(?![-\w])/i);
  const contentKw = regex(/@content(?![-\w])/i);
  const usingKw = regex(/\busing\b/);

  // SCSS call/mixin argument: `$x: val`, `val...`, or a plain value.
  const ScssCallArg = node(
    choice(
      sequence(scssVar, literal(':'), g.valueSequence),
      sequence(g.value, literal('...')),
      sequence(g.valueSequence, literal('...')),
      g.valueSequence
    ));
  const ScssCallArgsInner = node(
    optional(sequence(
      g.ScssCallArg,
      many(sequence(literal(','), optional(g.ScssCallArg)))
    )));
  const optionalCallParens = optional(sequence(
    literal('('), g.ScssCallArgsInner, expect(literal(')'))
  ));

  // Mixin parameter: `...$rest`, `$rest...`, `$a: default`, or bare `$a`.
  const ScssMixinParam = node(
    choice(
      sequence(literal('...'), scssVar),
      sequence(scssVar, literal('...')),
      sequence(scssVar, optional(sequence(literal(':'), g.valueSequence)))
    ));
  const ScssMixinParams = node(
    sequence(
      literal('('),
      optional(sequence(
        g.ScssMixinParam,
        many(sequence(literal(','), optional(g.ScssMixinParam)))
      )),
      expect(literal(')'))
    ));

  // Mixin/include name: `foo`, module-qualified `ns.foo`, or `foo-#{$bar}`.
  const scssMixinIdent = choice(ScssInterpolatedName, plainIdent);
  const ScssMixinName = node(
    choice(
      sequence(plainIdent, literal('.'), plainIdent),
      ScssInterpolatedName,
      plainIdent
    ));

  const ScssDeclBody = node(
    sequence(literal('{'), g.declarationList, expect(literal('}'), '}')));

  // A REQUIRED mixin name. `@mixin { … }` (no name) is a real error. `expect` reports
  // the missing name and recovers zero-width so the `{ … }` body still parses (as a
  // `@mixin` with a recovered error) rather than the rule falling through.
  const ScssMixin = node(
    sequence(
      mixinKw, expect(scssMixinIdent, 'name'), optional(g.ScssMixinParams), g.ScssDeclBody
    ));

  const ScssIncludeUsing = node(
    sequence(
      usingKw, literal('('), sepBy(scssVar, literal(',')), expect(literal(')'))
    ));

  // A REQUIRED mixin name. `@include ;` and `.a { @include }` (no name) are real
  // errors. `expect` reports the missing name and recovers zero-width so the trailing
  // `;`/`}` still closes the statement rather than the rule falling through.
  const ScssInclude = node(
    sequence(
      includeKw, expect(g.ScssMixinName, 'name'), optionalCallParens,
      optional(g.ScssIncludeUsing), optional(g.ScssRules), optional(literal(';'))
    ));

  const ScssContent = node(
    sequence(contentKw, optionalCallParens, optional(literal(';'))));

  // ── @function / @return ─────────────────────────────────────────────────────
  const functionKw = regex(/@function(?![-\w])/i);
  const returnKw = regex(/@return(?![-\w])/i);

  const ScssFunction = node(
    sequence(
      functionKw, scssMixinIdent, optional(g.ScssMixinParams), g.ScssDeclBody
    ));

  // A REQUIRED return value. `@return }` / `@return ;` (no expression) is a real
  // error. `not('}' | ';')` asserts a value is actually present (valueList can match
  // zero-width); `expect` reports it and recovers zero-width so the enclosing block's
  // `}` still closes.
  const ScssReturn = node(
    sequence(
      returnKw,
      expect(sequence(not(choice(literal('}'), literal(';'))), g.valueList), 'expression'),
      optional(literal(';'))
    ));

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

  const ScssWithConfigEntry = node(
    sequence(
      scssVar, literal(':'), g.valueSequence,
      optional(choice(literal('!default'), literal('!global')))
    ));
  const ScssWithConfig = node(
    sequence(
      literal('('),
      optional(sequence(
        sepBy(ScssWithConfigEntry, literal(',')),
        optional(literal(','))
      )),
      expect(literal(')'))
    ));

  const ScssUseAs = node(
    sequence(kwAs, choice(literal('*'), plainIdent)));

  const ScssUse = node(
    sequence(
      useKw, g.Quoted,
      optional(ScssUseAs),
      optional(sequence(kwWith, ScssWithConfig)),
      optional(literal(';'))
    ));

  // Capture the post-path prelude (`as *`, `show …`, `hide …`, `as prefix-*`) up
  // to `with (`, `;`, `}`, or EOF — so an unterminated `@forward "x" as a-*` (the
  // owner-rejected prefix form, which the sass-spec corpus writes without a `;`,
  // sometimes with comments/newlines around `as`) still reaches the builder's
  // "will never be" check rather than dangling as unparsed input. `{` bounds the
  // scan so a following ruleset is never swallowed.
  const forwardExtra = optional(scanTo(
    choice(sequence(kwWith, literal('(')), literal(';'), literal('{'), literal('}')),
    { skip: scanSkip, orEOF: true }
  ));
  const ScssForward = node(
    sequence(
      forwardKw, g.Quoted,
      forwardExtra,
      optional(sequence(kwWith, ScssWithConfig)),
      optional(literal(';'))
    ));

  const scssPlaceholder = regex(/%-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const ScssPlaceholderSelector = node(
    scssPlaceholder);
  const scssExtendComplex = choice(ScssPlaceholderSelector, g.ComplexSelector);
  const ScssExtendTarget = node(
    sequence(
      scssExtendComplex,
      many(sequence(literal(','), scssExtendComplex))
    ));
  const ScssExtend = node(
    sequence(
      extendKw, ScssExtendTarget,
      optional(extendOptional),
      optional(literal(';'))
    ));

  const importOptionsParen = sequence(
    literal('('),
    scanTo(literal(')'), { skip: scanSkip }),
    literal(')')
  );
  // An `@import` prelude is a comma-separated list of items, each `<path>
  // <modifiers>?`. The modifiers are a CSS media-query list / `supports(...)`
  // that MAY itself contain commas (`@import "a" b, (c: d), e;` is ONE import
  // with a three-part media list). So a comma only begins a NEW import when the
  // token after it is another path (a string / url) — `not(not(...))` is the
  // positive lookahead. The modifier scan skips balanced groups, strings, and
  // comments, and terminates at `;`, `}`, EOF, or such a new-import comma.
  const importPathStart = choice(g.Url, g.Quoted);
  // `#{ … }` interpolation hole (handles `#{$a}` and `#{"(a: b)"}` with a string
  // that may itself carry braces). Kept ahead of the generic brace skip so the
  // leading `#` is consumed together with the group.
  const scssInterpHole = regex(/#\{(?:[^{}'"]|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")*\}/);
  const importSkip = [scssInterpHole, bParen, bSquare, bCurly, singleStr, doubleStr, comment, lineComment];
  const newImportComma = sequence(literal(','), not(not(importPathStart)));
  const importModifier = scanTo(
    choice(literal(';'), literal('}'), newImportComma),
    { skip: importSkip, orEOF: true }
  );
  const ScssImportItem = node(
    sequence(
      expect(importPathStart, 'import path'),
      optional(importModifier)
    ));
  const ImportAtRuleStatement = node('ScssImportAtRule',
    sequence(
      importKw,
      optional(importOptionsParen),
      ScssImportItem,
      many(sequence(literal(','), ScssImportItem)),
      optional(literal(';'))
    ));

  const atRootKw = regex(/@at-root(?![-\w])/i);
  const debugKw = regex(/@debug(?![-\w])/i);
  const warnKw = regex(/@warn(?![-\w])/i);
  const errorKw = regex(/@error(?![-\w])/i);

  const ScssDiagnostic = node(
    sequence(
      choice(debugKw, warnKw, errorKw),
      g.valueSequence,
      optional(literal(';'))
    ));

  const ScssAtRootFilter = node(
    sequence(
      atRootKw,
      literal('('),
      g.valueSequence,
      literal(')'),
      ScssRules
    ));

  const ScssAtRootSelector = node(
    sequence(
      atRootKw,
      g.SelectorList,
      ScssDeclBody
    ));

  const ScssAtRootPlain = node(
    sequence(atRootKw, ScssRules));

  // ── SCSS at-rule prelude interpolation (segments) ────────────────────────
  const scssPreludeText = regex(/(?:[^{#]|#(?!\{))+/);
  const scssPreludeSegment = choice(ScssInterpBare, scssPreludeText);
  /** @todo(css-spec-parity): this fully permissive raw-text prelude feeds `QueryAtRuleBlock` for @media/@container/@supports (below), so a bare `@supports color` is accepted with no <supports-condition> check — unlike the tightened css-parser (726124397). Once SCSS interpolation is factored out, require a real <supports-condition> for @supports while keeping @media/@container bare forms valid; see css-conditional-3 §2. (Url/urlInner, calc grammar, and generic AtRuleBlock are inherited from less-parser/grammar and flagged there.) */
  const scssPermissivePrelude = oneOrMore(scssPreludeSegment);

  // Generic unknown at-rule statement (`@charset "x";`, or a bare `@c` used as a
  // content placeholder in the sass-spec corpus). Overrides Less's
  // `AtRuleStatement`, whose `;` is mandatory and whose prelude scan stops only
  // at `{`/`;`: Sass allows omitting the terminator before `}`/EOF, so the
  // prelude also stops at `}`/EOF and the trailing `;` is optional.
  const scssAtKeyword = regex(/@-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*/);
  const scssAtPrelude = optional(scanTo(
    choice(literal('{'), literal(';'), literal('}')),
    { skip: scanSkip, orEOF: true }
  ));
  const AtRuleStatement = node('AtRuleStatement',
    sequence(scssAtKeyword, scssAtPrelude, optional(literal(';'))));

  // ── Statement injection ─────────────────────────────────────────────────
  // Override Less's containers to try the SCSS control statements first, then
  // fall back to Less's full statement set (`g.stylesheetItem` / `g.blockItem`).
  const scssStatement = choice(
    g.ScssIf, g.ScssEach, g.ScssFor, g.ScssWhile,
    g.ScssMixin, g.ScssInclude, g.ScssContent,
    g.ScssFunction, g.ScssReturn,
    g.ScssUse, g.ScssForward,
    // Tried ahead of Less's `blockItem`, so an `@import` whose modifier carries
    // `#{ … }` interpolation is handled by the SCSS import rule rather than being
    // misread by Less's generic `AtRuleBlock` (which would treat the `{` in `#{`
    // as a block opener).
    g.ImportAtRuleStatement,
    g.NsVarDeclaration,
    ScssDiagnostic,
    ScssAtRootFilter, ScssAtRootSelector, ScssAtRootPlain
  );
  // SCSS parent selector `&` is valid only inside a rule block (nested), never at
  // top level — dart-sass rejects a bare top-level `&`. Mirror of the jess gate:
  // re-derive Less's `simpleSelector` (Less's `SelectorList`/`CompoundSelector`
  // resolve `g.simpleSelector` late, so this override applies to inherited rules
  // too) with the `&` (LessAmpersand) arm gated on the dynamic `inner` flag, which
  // `declarationList` sets true for any rule body at any depth. `g.basicSel` /
  // `g.extendAhead` are Less's own token regexes (exposed on its namespace) so
  // this stays byte-identical to Less apart from the gate. O(1) gated dispatch.
  const simpleSelector = choice(
    g.AttributeSelector,
    g.PseudoSelector,
    { gate: (s: any) => !!(s && s.inner), combinator: g.LessAmpersand },
    g.InterpolatedSelector,
    g.basicSel
  );
  const declarationList = withCtx({ inner: true }, many(choice(
    scssStatement, g.ScssExtend, g.ScssPlaceholderRuleset, Declaration, CustomDeclaration, g.blockItem
  )));
  const atRuleBody = many(choice(scssStatement, g.ScssPlaceholderRuleset, g.blockItem));

  const ScssPlaceholderRuleset = node(
    sequence(
      ScssPlaceholderSelector,
      optional(g.Guard),
      literal('{'),
      declarationList,
      expect(literal('}'))
    ));
  const queryAtKeyword = regex(/@(?:media|container|supports)(?![-\w])/i);
  const QueryAtRuleBlock = node(
    sequence(
      queryAtKeyword,
      scssPermissivePrelude,
      expect(literal('{')),
      atRuleBody,
      expect(literal('}'))
    ));
  const scopeKw = regex(/@scope(?![-\w])/i);
  const ScssScopeBlock = node(
    sequence(
      scopeKw,
      scssPermissivePrelude,
      literal('{'),
      atRuleBody,
      expect(literal('}'))
    ));
  const layerKw = regex(/@layer(?![-\w])/i);
  const ScssLayerBlock = node(
    sequence(
      layerKw,
      optional(ScssInterpolatedName),
      literal('{'),
      atRuleBody,
      expect(literal('}'))
    ));
  const Stylesheet = node(
    many(choice(
      scssStatement, ScssPlaceholderRuleset, ScssScopeBlock, ScssLayerBlock, g.stylesheetItem
    )));

  return {
    VarDeclaration, Reference, NsVarDeclaration, AtRuleStatement,
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
    Stylesheet, simpleSelector, declarationList, atRuleBody
  };
})]);
