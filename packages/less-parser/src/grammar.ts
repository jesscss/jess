/**
 * Functional Less grammar — the macro-compiled counterpart to the class-based
 * LessGrammar. This file is JUST the grammar: `lessGrammar = compose([cssGrammar,
 * <Less delta>])`. Every rule is a structural `node(type, parser)` that builds via
 * the injected `ctx.build` host. The host + parse entry (`parseLessFn`,
 * `LessParser`) live in ./functional-parser.ts; the shared driver in
 * @jesscss/css-parser.
 */
import {
  rules, compose,
  node, regex, literal, sequence, choice, many, oneOrMore, optional,
  not, scanTo, balanced, parser, trivia, noTrivia, expect, sepBy
} from 'parseman' with { type: 'macro' };
import { cssGrammar } from '@jesscss/css-parser';

// ---------------------------------------------------------------------------
// Grammar — Less = CSS + the Less delta. `compose` fuses the imported compiled
// `cssGrammar` (its linkable pieces travel on the value — no source) with the
// inline Less delta: the delta's rules win by name, and its references to CSS
// value rules (Num/Quoted/Paren/query) resolve into the fused set. One grammar =
// one `rules()`; no fragment spreads.
// ---------------------------------------------------------------------------

export const lessGrammar = compose([cssGrammar, rules((g: any) => {
  // ---------------------------------------------------------------------------
  // Trivia + terminals (CSS base + Less @var / @{interp}).
  // ---------------------------------------------------------------------------

  const ws = regex(/[ \t\n\r\f]+/);
  const comment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
  const lineComment = regex(/\/\/[^\n\r]*/);
  const rw = trivia(oneOrMore(choice(ws, comment, lineComment)));
  // Whitespace-only trivia for url() bodies: inside `url(…)`, `//` and `/*` are URL
  // characters, not comments (`url(//host/x)` is protocol-relative), so the normal
  // `rw` (which skips line/block comments) must not apply there.
  const urlWs = trivia(ws);

  const ident = regex(/-?(?:[_a-zA-Z-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))(?:[-_a-zA-Z0-9-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))*/);
  // Selectors / mixin names / idents include CSS escapes (\hex, \char) — same
  // definition as css-parser grammar.ts (a mixin call is just a selector).
  const basicSel = regex(/(?:[.#]?-?(?:[_a-zA-Z-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))(?:[-_a-zA-Z0-9-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))*|\d+(?:\.\d+)?%|\*)/);
  const combinator = choice(literal('||'), literal('>'), literal('+'), literal('~'), literal('|'));
  const pseudoColon = regex(/::?/);
  const attrOp = regex(/[*~|^$]?=/);
  const attrMod = regex(/[is]/i);
  const nth = regex(/even|odd|[-+]?\d*n(?:[ \t\n\r\f]*[+-][ \t\n\r\f]*\d+)?|[-+]?\d+/i);
  // Same pattern as shared-value-rules.ts `singleStr`/`doubleStr` — local so the macro
  // can statically evaluate regex(); `\\` + newline is valid CSS line continuation.
  const singleStr = regex(/'(?:[^'\\]|\\[\s\S])*'/);
  const doubleStr = regex(/"(?:[^"\\]|\\[\s\S])*"/);
  // Balanced bracket scans that treat strings as opaque holes — a bracket inside
  // a string (`(foo: "(" x ")")`) takes token precedence and must NOT affect depth.
  const strHole = [singleStr, doubleStr];
  const bParen = balanced('(', ')', { skip: strHole });
  const bSquare = balanced('[', ']', { skip: strHole });
  const bCurly = balanced('{', '}', { skip: strHole });
  const customProp = regex(/--[-_a-zA-Z0-9\u0080-\uffff]*/);
  // Interpolated custom-property name (`--@{key}`, `--foo-@{key}-bar`). Port of the
  // reference's InterpolatedCustomProperty token: `--` + optional ident run, then
  // one-or-more `@{...}` interpolations interleaved with further ident runs. Tried
  // before the plain `customProp` regex, which stops at `@` (not an ident char) and
  // would otherwise match only `--`, failing the declaration outright.
  const customPropInterp = regex(/--(?:-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*|-)?@\{-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*\}(?:@\{-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*\}|[-_a-zA-Z0-9\u0080-\uffff])*/);
  const atKeyword = regex(/@-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const numPart = regex(/[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?|\d+)/);
  const urlOpen = regex(/url\(/i);
  // Unquoted url() body: any run of non-delimiter chars, with CSS escapes (\" \( …)
  // so escaped quotes/parens inside the URL don't terminate it.
  const urlInner = regex(/(?:\\.|[^)"'\s])+/);
  const anyValueTok = regex(/[+\-*/=<>|~^]+|[^\s;{}\[\]()'",!]+/);

  // Less-specific terminals.
  // First char may be a digit \u2014 Less allows numeric variable names (`@3`, `@{3}`).
  // `@` + one or more name chars (dash included), so a dash-only name like `@-` is
  // valid (Less accepts it). Digits are allowed anywhere (`@3` \u2014 flagged, not rejected).
  const lessVar = regex(/@[-_a-zA-Z0-9\u0080-\uffff]+/);
  const lessInterp = regex(/@\{-?[_a-zA-Z0-9\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*\}/);

  // ---------------------------------------------------------------------------
  // Grammar — CSS base rules + Less overrides/additions (mirrors LessGrammar).
  // ---------------------------------------------------------------------------

  // ── Root (Less: + VarDeclaration, MixinCall, detached Call) ─────────────────
  // No catch-all: unmatched input stops `many`; the driver reports the unconsumed
  // offset as one syntax error (parseLessFn). Bare `;` is an empty statement.
  // The per-statement choice used by the root `many(...)`. Exposed as a named
  // rule so grammars that EXTEND Less (e.g. SCSS) can inject their own
  // statements ahead of it — `many(choice(g.ScssIf, …, g.stylesheetItem))` —
  // without re-listing the whole set. Keeps the extension seam in one place.
  const stylesheetItem = choice(
    g.VarDeclaration, g.VarCall, g.QueryAtRuleBlock, g.AtRuleBlock, g.ImportAtRuleStatement, g.AtRuleStatement, g.ExtendStatement, g.Ruleset, g.MixinOrQualifiedRule, g.EachFor,
    sequence(g.Call, optional(literal(';'))), literal(';')
  );
  const Stylesheet = node('Stylesheet',
    parser({ trivia: rw }, many(g.stylesheetItem)));

  // Plain helper consts referenced before their section must be defined up-front
  // (Phase-1 evaluation is sequential; only g.* refs resolve lazily).
  const important = sequence(literal('!'), literal('important'));

  // ── Less variable declaration / reference ───────────────────────────────────
  const detachedBlock = sequence(literal('{'), g.declarationList, literal('}'));
  // Var-decl colon. Spaces around it are fine (`@x : y` is a declaration). It is
  // NOT a declaration only in the pseudo pattern `<space>:<word>` — the colon has a
  // space before AND clings to the following ident (e.g. `@page :first { … }` is an
  // at-rule prelude, not `@page: first`). So: colon adjacent to the name (noTrivia),
  // OR colon not immediately followed by an ident-start.
  const varColon = choice(
    noTrivia(sequence(lessVar, literal(':'))),
    sequence(lessVar, regex(/:(?![-_a-zA-Z-￿])/))
  );
  const VarDeclaration = node('VarDeclaration',
    parser({ trivia: rw }, sequence(varColon, choice(detachedBlock, sequence(g.valueList, optional(important), optional(literal(';')))))));
  // Regex-based content scan: one level of nested parens + strings, all as one leaf.
  // Avoids the balanced('(',')')-inside-scanTo CSTLeaf pollution bug (balanced uses
  // literal() internally, which pushes leaves into the enclosing node()'s collector).
  // Defined here (before Reference) because refCall reuses it for accessor-chain calls.
  const mixinArgsContent = regex(/(?:[^()'"]|'(?:[^'\\]|\\[\s\S])*'|"(?:[^"\\]|\\[\s\S])*"|\((?:[^()'"]|'(?:[^'\\]|\\[\s\S])*'|"(?:[^"\\]|\\[\s\S])*")*\))*/);
  // Accessor key tokens, in lookupOrCall's OR2 order: NestedReference ($@x / @@x),
  // AtKeyword (@x), PropertyReference ($x), InterpolatedIdent (…@{x}…), Ident.
  // The builder applies the index/variable typing + Quoted-wrap (see _buildReference).
  const nestedRef = regex(/(?:[@$]+(?:-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*)?){2,}/);
  const propRef = regex(/\$-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*/);
  const interpKey = regex(/(?:-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*|-)?[@$]\{-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*\}(?:[@$]\{-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*\}|[-_a-zA-Z0-9-￿])*/);
  const declPropName = regex(/\*?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n])|[@$]\{[^}]*\})(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n])|[@$]\{[^}]*\})*/);
  const refKey = choice(nestedRef, lessVar, propRef, interpKey, ident);
  // One accessor: glued '[' / '(', trivia re-enabled inside the brackets/parens.
  const refIndex = sequence(literal('['), parser({ trivia: rw }, sequence(optional(refKey), literal(']'))));
  const refCall = parser({ trivia: rw }, sequence(literal('('), optional(mixinArgsContent), literal(')')));
  // varReference + lookupOrCall: a @variable glued to a chain of [accessor]/(call).
  // noTrivia() forbids trivia (here: whitespace/comments) between the var and
  // '[' / '(', keeping the chain contiguous (production's noSep()).
  const Reference = node('Reference',
    noTrivia(sequence(lessVar, many(choice(refIndex, refCall)))));

  // ── Detached-ruleset variable call ─────────────────────────────────────────
  // `@name(...)` (no `:`) is a variable CALL of a detached ruleset, not a var
  // decl or an at-rule. Faithful port of `varDeclarationOrCall`'s LParen branch
  // (selectors.ts) + the `isVariableLike` disambiguation (root.ts): a KNOWN
  // at-rule name (@media, @supports, …) followed by NON-empty parens stays an
  // at-rule — `@media() ` (empty parens) is a deprecated var call, and any other
  // `@var(...)` is a var call regardless of parens content. The builder emits the
  // production's `Expression(Call{ name: Reference[role=name], args })` shape.
  // A var name that is NOT a known at-rule name (negative lookahead asserts the
  // known name is not the COMPLETE ident before the call parens).
  const nonKnownAtVar = regex(/@-?(?!(?:(?:-moz-)?document|(?:-[a-z]+-)?keyframes|(?:-ms-)?viewport|import|media|supports|layer|container|scope|page|font-face|starting-style|property|counter-style|color-profile|font-palette-values|namespace)(?![-_a-zA-Z0-9]))[_a-zA-Z0-9-￿][-_a-zA-Z0-9-￿]*/);
  const knownAtVar = regex(/@(?:(?:-moz-)?document|(?:-[a-z]+-)?keyframes|(?:-ms-)?viewport|import|media|supports|layer|container|scope|page|font-face|starting-style|property|counter-style|color-profile|font-palette-values|namespace)(?![-_a-zA-Z0-9])/);
  const VarCall = node('VarCall',
    parser({ trivia: rw }, choice(
      // A var call is `@name(...)` with the `(` ADJACENT to the name (no space).
      // `@foo (bar)` — space before `(` — is never a var call; it's an unknown
      // at-rule prelude, so noTrivia makes this branch defer to AtRuleBlock.
      sequence(noTrivia(sequence(nonKnownAtVar, regex(/(?=\()/))), g.MixinArgs, optional(important), optional(literal(';'))),
      // Known at-rule name with EMPTY parens only.
      sequence(knownAtVar, literal('('), literal(')'), optional(important), optional(literal(';')))
    )));

  // ── Mixins ───────────────────────────────────────────────────────────────
  // Structured mixin args: the COMBINATORS split on the separators (sepBy), each
  // arg VALUE an opaque chunk scanned to the next top-level `,` `;` or `)` (values
  // are freeform — scanTo is the right tool *here*, and balanced skips keep commas
  // inside nested ()/[]/{}/strings out of the split). The builder reads the
  // pre-split chunks/separators (no string _splitTopLevel) and rejects mixing `,`
  // and `;` to separate args. See _buildMixinArgs.
  const argChunk = scanTo(choice(literal(','), literal(';'), literal(')')),
    { skip: [bParen, bSquare, bCurly, singleStr, doubleStr] });
  const MixinArgs = node('MixinArgs',
    parser({ trivia: rw }, sequence(literal('('), optional(sepBy(sepBy(argChunk, literal(',')), literal(';'))), literal(')'))));
  const mixinNamePath = parser({ trivia: rw }, sequence(basicSel, many(sequence(optional(combinator), basicSel))));
  // MixinCall names must start with . or # — plain idents are properties, not mixins.
  const mixinCallBasicSel = regex(/[.#]-?(?:[_a-zA-Z-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))(?:[-_a-zA-Z0-9-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))*/);
  const mixinCallPath = parser({ trivia: rw }, sequence(g.mixinCallBasicSel, many(sequence(optional(combinator), basicSel))));
  const MixinCall = node('MixinCall',
    parser({ trivia: rw }, sequence(g.mixinCallPath, optional(g.MixinArgs), optional(important), optional(literal(';')))));
  // Anonymous mixin callback: `.(…){…}` OR `#(…){…}` — the Chevrotain
  // AnonMixinStart token is `/[.#]\(/`, so both prefixes are valid.
  const AnonymousMixinDefinition = node('AnonymousMixinDefinition',
    parser({ trivia: rw }, sequence(regex(/[.#]/), g.MixinArgs, literal('{'), g.declarationList, literal('}'))));
  // A bare name with nothing after it is NOT a statement — require args (a mixin
  // call), or a `{}` body / `;` (a qualified rule or mixin call). Otherwise a lone
  // ident like `x` or `nonsense` would be silently accepted.
  // Two combinator-distinguished forms — the PARSER decides validity, not a
  // post-hoc name check:
  //   block form: `name [args] [guard] { … }` — a mixin definition or qualified
  //               rule (name path may be a bare selector); a `{}` body is required.
  //   call  form: `path [args] [guard] [;]` — a mixin CALL; the path MUST start
  //               with `.`/`#` (mixinCallPath). A bare ident like `nonsense;` is
  //               not a `.`/`#` path and has no block, so it matches NEITHER and is
  //               reported as unconsumed input.
  const MixinOrQualifiedRule = node('MixinOrQualifiedRule',
    parser({ trivia: rw }, choice(
      sequence(g.mixinNamePath, optional(g.MixinArgs), optional(g.Guard), literal('{'), g.declarationList, literal('}')),
      sequence(g.mixinCallPath, optional(g.MixinArgs), optional(g.Guard), optional(important), optional(literal(';')))
    )));

  // ── Guards / comparisons ───────────────────────────────────────────────────
  // Faithful port of the Chevrotain guard productions (src/productions/guards.ts):
  //   guard → 'when' guardOr
  //   guardOr  → guardAnd ( ('or' | ',') guardAnd )*        (left-assoc, 'or')
  //   guardAnd → guardTerm ( 'and' guardTerm )*             (left-assoc, 'and')
  //   guardTerm → [not] ( guardInParens | comparison/value )
  //   guardInParens → guardDefault | '(' guardOr ')'        (wrapped in Paren)
  //   guardDefault  → 'default()'  →  DefaultGuard
  // Precedence: 'or' loops over 'and'; parens nest a fresh guardOr. `not` negates a
  // single term, producing a Condition(negate:true). Comparisons are a left operand
  // followed by an optional `<op> right`.
  const compareOp = regex(/>=|<=|=>|=<|=~|[<>=]/);
  // A single comparison operand (mirrors expressionSum's value role here).
  const guardOperand = choice(g.Reference, g.Dimension, g.Num, g.Color, g.NamedColor, g.Quoted, g.Call, g.Paren, g.anyValue);
  const Comparison = node('Comparison',
    parser({ trivia: rw }, sequence(g.Reference, compareOp, choice(g.Reference, g.Dimension, g.Num, g.Color, g.NamedColor, g.Quoted, g.anyValue))));
  const GuardDefault = node('GuardDefault',
    parser({ trivia: rw }, regex(/default(?:[ \t\n\r\f]*\([ \t\n\r\f]*\))?(?![-\w])/)));
  // '(' guardOr ')' → Paren; or a bare default(). Wrapped in a Paren node.
  const GuardInParens = node('GuardInParens',
    parser({ trivia: rw }, choice(
      g.GuardDefault,
      sequence(literal('('), g.GuardOr, literal(')'))
    )));
  // A single guard term: optional `not`, then either a parenthesized guard or a
  // bare comparison (`left <op> right`) / value.
  const GuardTerm = node('GuardTerm',
    parser({ trivia: rw }, sequence(
      optional(regex(/not(?![-\w])/)),
      choice(
        g.GuardInParens,
        sequence(guardOperand, optional(sequence(compareOp, guardOperand)))
      )
    )));
  // 'and' chain of terms (left-associative).
  const GuardAnd = node('GuardAnd',
    parser({ trivia: rw }, sequence(g.GuardTerm, many(sequence(regex(/and(?![-\w])/), g.GuardTerm)))));
  // 'or' / ',' chain of and-expressions (left-associative).
  const GuardOr = node('GuardOr',
    parser({ trivia: rw }, sequence(g.GuardAnd, many(sequence(choice(regex(/or(?![-\w])/), literal(',')), g.GuardAnd)))));
  const Guard = node('Guard',
    parser({ trivia: rw }, sequence(regex(/when(?![-\w])/), g.GuardOr)));

  // ── Less ampersand / interpolated / extend ──────────────────────────────────
  // `&` glued to a suffix (`&1`, `&-bar`) OR a prefix (`.foo-&`, `#bar-&`) — Less
  // appends/prepends it to the parent selector. Mirrors the reference Ampersand
  // token pattern `(?:[.#]({{ident}}-)?&|&){{nmchar}}*` (lessTokens.ts), so a
  // prefix template parses as ONE Ampersand node (image `.foo-&`), not a
  // CompoundSelector of `['.foo-', &]`. The `&(…)` form keeps its paren scan; the
  // paren only follows a bare `&` in practice (prefix forms have no `(`).
  const ampToken = regex(/(?:[.#](?:-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*-)?&|&)[-_a-zA-Z0-9-￿]*/);
  const LessAmpersand = node('LessAmpersand',
    parser({ trivia: rw }, sequence(ampToken, optional(sequence(literal('('), scanTo(literal(')'), { skip: [bParen, bSquare, bCurly, singleStr, doubleStr] }), literal(')'))))));
  const InterpolatedSelector = node('InterpolatedSelector',
    parser({ trivia: rw }, sequence(optional(regex(/[.#]/)), many(regex(/[-_a-zA-Z0-9]+/)), lessInterp, many(choice(lessInterp, regex(/[-_a-zA-Z0-9]+/))))));

  // ── Selectors (Less: + ampersand/interp, relative combinator) ───────────────
  // `sel when …` is a guarded ruleset: the `when` KEYWORD is the guard boundary,
  // never a selector token — stop the selector run before it (the reference gets
  // this from its lexer's `When` token; scannerless, we assert the keyword). The
  // guard body (`(…)`, `not (…)`, `default()`, `and`/`or` chains) is then parsed
  // by the atomic Guard rule — so the boundary must be just `when`, NOT `when (`
  // (which missed `when not (…)`, `when default()`, …).
  const whenAhead = regex(/when(?![-\w])/i);
  // `:extend(` lookahead — keeps the generic PseudoSelector from claiming extend
  // (extend goes through ExtendPseudo) and lets the compound run stop before it.
  const extendAhead = regex(/::?extend[ \t\n\r\f]*\(/);
  // The two selector-run boundaries (`when` guard keyword, `:extend(`) combined
  // into ONE lookahead regex: `not(selectorBoundary)` ran two regex
  // execs at every simple/compound iteration — ~8% of parse on a selector-dense
  // file. `not(selectorBoundary)` is equivalent (not A ∧ not B = not(A∨B)) at one
  // exec. Used only in the `many(...)` run stops; the standalone extendAhead gate
  // before PseudoSelector is unchanged.
  const selectorBoundary = regex(/when(?![-\w])|::?extend[ \t\n\r\f]*\(/i);
  const simpleSelector = choice(g.AttributeSelector, sequence(not(extendAhead), g.PseudoSelector), g.LessAmpersand, g.InterpolatedSelector, basicSel);
  // collapse: a single simple selector (76% of compounds — `.btn`, `a`, `:hover`)
  // IS that token; skip the build+frame and pass the child straight through. The
  // builder's single-child path already returned the bare component, so this is
  // byte-identical — a 2+-simple / whitespace-descendant run still builds.
  const CompoundSelector = node('CompoundSelector',
    parser({ trivia: rw }, sequence(g.simpleSelector, many(sequence(not(selectorBoundary), g.simpleSelector)))), undefined, { collapse: true });
  // A complex selector, optionally terminated by a single `:extend(...)` pseudo.
  // Mirrors Chevrotain's `complexSelector`, which consumes extend (OPTION3) AFTER
  // the whole compound/combinator run — so extend is the LAST thing in the
  // selector, and `.a:extend(.b).c` leaves `.c` unconsumed → parse error
  // (extend-must-be-last). The compound run also stops at `:extend(` (extendAhead).
  // collapse: single compound (no combinator, no extend) IS the compound.
  const LessComplexSelector = node('LessComplexSelector',
    parser({ trivia: rw }, sequence(optional(combinator), g.CompoundSelector, many(sequence(optional(combinator), not(selectorBoundary), g.CompoundSelector)), optional(g.ExtendPseudo))), undefined, { collapse: true });
  // collapse: single complex selector (no comma) IS that selector.
  const LessSelectorList = node('LessSelectorList',
    parser({ trivia: rw }, sequence(g.LessComplexSelector, many(sequence(literal(','), g.LessComplexSelector)))), undefined, { collapse: true });
  // Attribute name may carry a CSS namespace prefix (`ns|attr`, `*|attr`,
  // `|attr`). Less also allows interpolation in the name and value: `[@{n}=@{v}]`,
  // `[data=@{attr-data}]`. interpKey matches a run containing `@{…}`.
  // `|` is a namespace separator (`ns|attr`, `*|attr`, `|attr`) ONLY when not
  // followed by `=` — `[prop|="x"]` is the `|=` dash-match operator, not a namespace.
  const attrNsPrefix = optional(sequence(optional(choice(literal('*'), ident)), regex(/\|(?!=)/)));
  const AttributeSelector = node('AttributeSelector',
    parser({ trivia: rw }, sequence(literal('['), attrNsPrefix, choice(interpKey, ident), optional(sequence(attrOp, choice(singleStr, doubleStr, interpKey, ident), optional(attrMod))), literal(']'))));
  // pseudoArg: content inside pseudo parens (used in ExtendStatement too).
  // PseudoSelector uses a two-branch outer choice so PEG backtracking works when
  // LessSelectorList succeeds internally but ')' doesn't follow (e.g. "!all" suffix).
  const pseudoArg = choice(nth, g.LessSelectorList, scanTo(literal(')'), { skip: [bParen, bSquare, bCurly, singleStr, doubleStr] }));
  const pseudoSelectorParens = choice(
    sequence(literal('('), choice(nth, g.LessSelectorList), literal(')')),
    sequence(literal('('), scanTo(literal(')'), { skip: [bParen, bSquare, bCurly, singleStr, doubleStr] }), literal(')'))
  );
  const PseudoSelector = node('PseudoSelector',
    parser({ trivia: rw }, sequence(pseudoColon, choice(interpKey, ident), optional(g.pseudoSelectorParens))));

  // ── Extend grammar (faithful port of selectors.ts `extend`/`ampersandExtend`)
  // Chevrotain models extend as: `:extend(` selectorList[inExtend] `)` where each
  // complexSelector inside consumes an optional trailing `all` flag (OPTION2 on
  // T.All / T.AllFlag). The statement form `&:extend(...)` ends with `;`. Here
  // each piece is real grammar (comma list + per-target flag) rather than
  // re-parsing the source text.
  //
  // A per-target `all` / `!all` flag (Chevrotain's T.All / T.AllFlag); both
  // collapse to ExtendFlag.All in the builder.
  const extendFlag = regex(/!?all(?![-\w])/);
  // Lookahead used to stop the target's compound/complex run before the flag, so
  // `all` is consumed as the flag — not swallowed as a trailing ident selector.
  const extendFlagAhead = regex(/!?all(?![-\w])[ \t\n\r\f]*[,)]/);
  // Extend-local compound/complex selectors: identical to the normal ones but they
  // halt before a trailing flag (so `.x all` parses as target `.x` + flag `all`).
  const extendCompound = node('CompoundSelector',
    parser({ trivia: rw }, sequence(g.simpleSelector, many(sequence(not(selectorBoundary), not(extendFlagAhead), g.simpleSelector)))));
  const extendComplex = node('LessComplexSelector',
    parser({ trivia: rw }, sequence(optional(combinator), g.extendCompound, many(sequence(optional(combinator), not(whenAhead), not(extendFlagAhead), g.extendCompound)))));
  // A single extend target: a complex selector + its optional flag.
  const ExtendTarget = node('ExtendTarget',
    parser({ trivia: rw }, sequence(g.extendComplex, optional(extendFlag))));
  // The comma-separated target list inside `extend( … )` (selectorList[inExtend]).
  const extendBody = sepBy(g.ExtendTarget, literal(','));
  // `:extend(` body `)` — the in-selector pseudo form (selectors.ts `extend`).
  const ExtendPseudo = node('ExtendPseudo',
    parser({ trivia: rw }, sequence(pseudoColon, literal('extend'), literal('('), extendBody, expect(literal(')'), ')'))));
  // `&:extend(...)` statement, terminated by `;` (selectors.ts `ampersandExtend`).
  // The leading `&` is REQUIRED: the reference's `ampersandExtend` does an
  // unconditional `$.CONSUME(T.Ampersand)`, so a bare `:extend(...)` is NOT a valid
  // standalone statement. Making `&` mandatory keeps `.a:extend(.b).c { … }` from
  // mis-splitting into `.a` (mixin call) + bare `:extend(.b)` + `.c { … }`; instead
  // the leftover `:extend(` after the `.a` mixin call is unconsumed input → one
  // parse error (faithful: extend must be the last thing in its selector).
  const ExtendStatement = node('ExtendStatement',
    parser({ trivia: rw }, sequence(g.LessAmpersand, g.ExtendPseudo, optional(literal(';')))));

  // ── Ruleset / declarations (Less-aware) ─────────────────────────────────────
  const Ruleset = node('Ruleset',
    parser({ trivia: rw }, sequence(g.LessSelectorList, optional(g.Guard), literal('{'), g.declarationList, expect(literal('}'), '}'))));
  // A nested mixin DEFINITION inside a rule body: `.name(args) [guard] { … }`.
  // Strict — requires the `()` arg list AND a `{}` body, so it never matches a
  // plain declaration or a `.name { }` ruleset. (declarationList only had MixinCall,
  // which has no body, so nested definitions e.g. `.vars(){…}` were unmodelled.)
  const NestedMixinDefinition = node('MixinOrQualifiedRule',
    parser({ trivia: rw }, sequence(g.mixinCallPath, g.MixinArgs, optional(g.Guard), literal('{'), g.declarationList, literal('}'))));
  // The per-statement choice for a `{ … }` body (ruleset body + at-rule body).
  // Exposed as a named rule so extending grammars (SCSS) can inject their own
  // block statements ahead of it — `many(choice(g.ScssIf, …, g.blockItem))`.
  // `NestedMixinDefinition` stays a local const referenced here (Less-only).
  const blockItem = choice(
    g.VarDeclaration, g.VarCall, g.QueryAtRuleBlock, g.AtRuleBlock, g.ImportAtRuleStatement, g.AtRuleStatement, g.ExtendStatement, g.Ruleset, NestedMixinDefinition, g.EachFor, g.MixinCall, g.Declaration, g.CustomDeclaration,
    // A bare function-call statement in a body, e.g. `each(@list, { … });`. Needs
    // `ident(` so it never shadows a Declaration (which needs `:`).
    sequence(g.Call, optional(literal(';'))), literal(';')
  );
  const declarationList = parser({ trivia: rw }, many(g.blockItem));
  // Property name may itself be interpolated (`@{prop}: …`, `pre-@{x}-post: …`).
  // Chevrotain lexes the name as a single Ident/InterpolatedIdent token whose image
  // carries the `@{…}` runs; `declaration` then routes an image containing `@`/`$`
  // through getInterpolatedNode. We mirror that: try the interpolated-ident regex
  // first (it requires at least one `@{…}`), else a plain ident.
  const Declaration = node('Declaration',
    parser({ trivia: rw }, sequence(declPropName, optional(choice(literal('+_'), literal('+'))), literal(':'), optional(g.valueList), optional(important), optional(literal(';')))));
  const customValue = parser({ trivia: rw }, sequence(g.valueList, not(regex(/[^\s;}]/))));
  // Opportunistic structuring for a `{ … }` custom-property value: try it as a
  // real declaration body (so nested `@var`/calls evaluate normally, same as the
  // `[…]` case already does via customValue's valueList), tolerant of anything
  // that isn't CSS-shaped. No `expect()` on the closing `}` — a non-declaration
  // body (arbitrary tokens) simply fails this alt with no error recorded, and
  // `choice` falls through to the raw-text cpValue capture below.
  const customCurlyBlock = node('Block',
    parser({ trivia: rw }, sequence(literal('{'), g.declarationList, literal('}'))));
  // Predictive custom-property value region — NO scanTo, NO skip. Content runs
  // interleaved with recursively-balanced ()/[]/{} groups, each closed by expect().
  // So an unmatched, stray, or CROSS-TYPE bracket (`({[ })`) surfaces a syntax error
  // instead of being swallowed. noTrivia keeps the value verbatim; inside a group a
  // `;` is content (only the group's own close ends it), at top level `;`/`}` end it.
  // Custom-property value = CSS `<declaration-value>` (spec-close, not Less 4.x's
  // permissive pass): opaque tokens with ()/[]/{} balanced; `/* … */` comments are
  // preserved and their contents NOT tokenized (`/* { ; } */`); strings are
  // line-bounded, so a quote left unclosed before the newline is a
  // `<bad-string-token>` → hard error (matches browsers — `--x: don't` is invalid).
  // `//` is NOT a comment here (CSS), just delim content. A `{ … }` value that fits
  // a declaration list is structured upstream by customCurlyBlock; this is the
  // fallback for non-CSS-shaped values.
  const cpSingleStr = regex(/'(?:[^'\n\\]|\\.)*'/);
  const cpDoubleStr = regex(/"(?:[^"\n\\]|\\.)*"/);
  // Content runs include CSS escapes (`\'`, `\(`, `\;`): `\` + any non-newline is an
  // escaped code point (§4.3.7), so an escaped quote/bracket/semicolon is literal
  // content, NOT a string/bracket/terminator. A lone `/` (division) is content;
  // `/*` is left for the comment alt.
  const cpInnerContent = regex(/(?:\\[^\n]|[^(){}[\]'"\/\\])+|\/(?!\*)/);
  const cpOuterContent = regex(/(?:\\[^\n]|[^(){}[\];'"\/\\])+|\/(?!\*)/);
  const cpInner = many(choice(cpInnerContent, comment, g.cpParen, g.cpSquare, g.cpCurly, cpSingleStr, cpDoubleStr));
  const cpParen = sequence(literal('('), g.cpInner, expect(literal(')'), ')'));
  const cpSquare = sequence(literal('['), g.cpInner, expect(literal(']'), ']'));
  const cpCurly = sequence(literal('{'), g.cpInner, expect(literal('}'), '}'));
  const cpValue = noTrivia(many(choice(cpOuterContent, comment, g.cpParen, g.cpSquare, g.cpCurly, cpSingleStr, cpDoubleStr)));
  const CustomDeclaration = node('CustomDeclaration',
    parser({ trivia: rw }, sequence(choice(customPropInterp, customProp), literal(':'),
      choice(g.customCurlyBlock, g.customValue, g.cpValue),
      optional(literal(';')))));
  const anyDeclaration = choice(g.VarDeclaration, g.CustomDeclaration, g.Declaration);

  // ── Values (Less: + Reference, NamedColor, EscapedValue) ────────────────────
  // A comma must be followed by a value — a trailing comma (`a, b,`) is a parse
  // error in Less v5 (stricter than Less 4.x, which tolerated it). The dangling
  // comma is left unconsumed and surfaces as one syntax error via the net.
  const valueList = parser({ trivia: rw }, sequence(g.valueSequence, many(sequence(literal(','), g.valueSequence))));
  // A space-separated value sequence: each item is a full top-level EXPRESSION
  // (topSum), so arithmetic folds into the grammar (`1 + 2` → one Operation) while
  // non-operator items stay a list (`1px 2px 3px`). topSum collapses to the bare
  // operand when there is no operator, so a plain list is byte-identical to before.
  const valueSequence = parser({ trivia: rw }, oneOrMore(g.topSum));
  // Interpolated value token (`@{colorVar}`, `pre-@{x}`). Chevrotain lexes this as
  // InterpolatedIdent and `processValueToken` runs it through getInterpolatedOrString
  // → Interpolated (role=ident). Ordered before Reference: `@{` cannot match lessVar,
  // and anyValueTok excludes `{`, so this is the only rule that accepts it.
  const InterpValue = node('InterpValue',
    parser({ trivia: rw }, interpKey));
  const value = choice(g.InterpValue, g.Reference, g.Dimension, g.Num, g.Color, g.NamedColor, g.Url, g.CalcCall, g.Call, g.EscapedValue, g.GluedParen, g.Paren, g.SquareParen, g.Quoted, g.anyValue);
  // ── Math expressions — precedence in the grammar (port of expressionSum /
  // expressionProduct). `* / %` bind tighter than `+ -`; left-associative. The
  // `collapse` option makes a single-operand level pass its operand straight
  // through (no Operation wrapper), so a plain value is byte-identical to the
  // pre-expression grammar. The build folds the flat `operand op operand …`
  // children into Operation nodes (see _buildOperation).
  //
  // `+`/`-` operator token: a sign NOT glued to a following number. A glued
  // `-23`/`+5` is ONE signed operand (Num/Dimension eats the sign), mirroring the
  // lexer's Plus/Minus-vs-Signed split — so `1 - 2` subtracts, but `1 -23` (space
  // before, glued) does NOT continue the sum: the sign belongs to the next
  // operand. At top level that trailing operand makes a space-list; inside a bare
  // paren it has no operator before it, so the paren's `)` fails (a parse error,
  // matching Less 4.x on `(12 (13))` / `(… 5 -23)`).
  // The deprecated `./` dot-slash operator is intentionally NOT accepted — it was
  // obscure, rarely used, and removed in v5. A `./` in a math context therefore
  // leaves the `.` unconsumed and surfaces as a parse error (wrap division in
  // parens instead).
  const prodOp = regex(/[*\/%]/);
  // A `+`/`-` operator fires when it is NOT a signed operand glued after a space:
  //   • `[-+](?![0-9.])` — standalone (space / non-number after): `8 + 4`, `8 - (…)`.
  //   • `(?<=\S)[-+](?=[0-9.])` — glued with NO space before (port of the Signed
  //     branch's noSep gate): `8+4`, `8-4` are arithmetic. `8 +4` (space before,
  //     glued) matches NEITHER — the `+4` is a separate signed operand (a list at
  //     top level, a paren error inside `( … )`).
  const sumOp = regex(/[-+](?![0-9.])|(?<=\S)[-+](?=[0-9.])/);
  // Leading unary minus → Negative (port of expressionValue's OPTION(Minus)). Only
  // a STANDALONE `-` (not glued to a number — that's a signed operand) at an operand
  // position: `-(@a * 2)`, `-@var`. The sum level consumes a binary `-` first, so
  // this only fires where an operand is expected.
  const Negative = node('Negative',
    parser({ trivia: rw }, sequence(regex(/-(?![0-9.])/), g.value)));
  const operand = choice(g.Negative, g.value);
  const mathProduct = node('Operation',
    parser({ trivia: rw }, sequence(operand, many(sequence(prodOp, operand)))), undefined, { collapse: true });
  const mathSum = node('Operation',
    parser({ trivia: rw }, sequence(g.mathProduct, many(sequence(sumOp, g.mathProduct)))), undefined, { collapse: true });
  // Top-level (declaration / space-list) variant of the same precedence grammar.
  // Identical shape, but built as `OperationTop`, whose slash-vs-list decision uses
  // the DECLARATION context: `/` divides only under `math: always` (default
  // `parens-division` keeps a top-level `/` a slash-List, e.g. `font: 12px/1.5`).
  // A math paren nested inside a top-level value still uses the `Operation` variant
  // (slash divides), since being in-parens turns division on.
  const topProduct = node('OperationTop',
    parser({ trivia: rw }, sequence(operand, many(sequence(prodOp, operand)))), undefined, { collapse: true });
  const topSum = node('OperationTop',
    parser({ trivia: rw }, sequence(g.topProduct, many(sequence(sumOp, g.topProduct)))), undefined, { collapse: true });
  // An escaped paren `~( … )` is a RAW list, not a math expression: it holds an
  // arbitrary space / comma / `;`-separated value sequence (`~(1 2 3)`, `~(1; 2)`),
  // so it uses the permissive body — unlike a bare `( … )`, which is one expression.
  const escapedParen = node('Paren', parser({ trivia: rw }, sequence(literal('('), g.permissiveParenBody)));
  const EscapedValue = node('EscapedValue',
    parser({ trivia: rw }, sequence(literal('~'), choice(escapedParen, g.Quoted))));
  const NamedColor = node('NamedColor', regex(/(?:lightgoldenrodyellow|mediumspringgreen|mediumaquamarine|mediumslateblue|mediumturquoise|mediumvioletred|blanchedalmond|cornflowerblue|darkolivegreen|lightslategray|lightslategrey|lightsteelblue|mediumseagreen|darkgoldenrod|darkslateblue|darkslategray|darkslategrey|darkturquoise|lavenderblush|lightseagreen|palegoldenrod|paleturquoise|palevioletred|rebeccapurple|antiquewhite|currentcolor|darkseagreen|lemonchiffon|lightskyblue|mediumorchid|mediumpurple|midnightblue|darkmagenta|deepskyblue|floralwhite|forestgreen|greenyellow|lightsalmon|lightyellow|navajowhite|saddlebrown|springgreen|transparent|yellowgreen|aquamarine|blueviolet|chartreuse|darkorange|darkorchid|darksalmon|darkviolet|dodgerblue|ghostwhite|lightcoral|lightgreen|mediumblue|papayawhip|powderblue|sandybrown|whitesmoke|aliceblue|burlywood|cadetblue|chocolate|darkgreen|darkkhaki|firebrick|gainsboro|goldenrod|indianred|lawngreen|lightblue|lightcyan|lightgray|lightgrey|lightpink|limegreen|mintcream|mistyrose|olivedrab|orangered|palegreen|peachpuff|rosybrown|royalblue|slateblue|slategray|slategrey|steelblue|turquoise|cornsilk|darkblue|darkcyan|darkgray|darkgrey|deeppink|honeydew|lavender|moccasin|seagreen|seashell|crimson|darkred|dimgray|dimgrey|fuchsia|hotpink|magenta|oldlace|skyblue|thistle|bisque|indigo|maroon|orange|orchid|purple|salmon|sienna|silver|tomato|violet|yellow|azure|beige|black|brown|coral|green|ivory|khaki|linen|olive|wheat|white|aqua|blue|cyan|gold|gray|grey|lime|navy|peru|pink|plum|snow|teal|red|tan)(?![-_a-zA-Z0-9])/i));
  // unit collapsed to one regex (Dimension still reads number + unit as two leaves).
  // number + unit must be contiguous \u2014 the surrounding valueSequence runs with
  // trivia enabled, so without noTrivia() a space (`1 %`, `10 px`) would still be
  // glued into a Dimension. Chevrotain lexes those as Num + a separate token.
  const Dimension = node('Dimension', noTrivia(sequence(numPart, regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*|%/))));
  // `Num` and `Color` now come from the shared `numericRules` fragment, spread into
  // the return object below (identical to the CSS grammar's definitions).
  const Url = node('Url', parser({ trivia: urlWs }, sequence(urlOpen, optional(choice(singleStr, doubleStr, urlInner)), literal(')'))));
  // A bare paren holds ONE expression per comma-segment (a Sum), NOT a
  // space-separated value sequence — `(12 13)` / `(12 (13))` are incoherent (two
  // operands, no operator) and error, matching Less 4.x. `;`-separated segments
  // (used by `~( … ; … )` escapes) and commas are still lists. The closing `)` is
  // committed (`expect`), so a leftover operand surfaces as `Expected ')'` at the
  // offending token rather than being silently left unconsumed.
  // A paren item is one expression, optionally followed by a single comparison
  // (`(@i > 5)`) OR a declaration-form `feature: value` pair (`(min-width: @val)` —
  // a media condition stored for reuse). The separator/operator stays a raw leaf in
  // the stream (not folded into an Operation), so the Paren builder sees the same
  // flat `left op right` it always did. A bare `12 (13)` has NO separator, so it
  // still fails the `)`.
  const parenSep = choice(compareOp, literal(':'));
  const parenExpr = parser({ trivia: rw }, sequence(g.mathSum, optional(sequence(parenSep, g.mathSum))));
  // A paren whose content BEGINS with a `#`/`.` namespace selector is a
  // namespace-lookup reference (`(#ns.options[option])`, `(.mixin()[key])`), not an
  // arithmetic expression — its `[…]`/`(…)` accessor chain is captured as a value
  // sequence and the Paren builder reassembles it into a Reference/Call
  // (_tryParseNamespaceRef). The lookahead requires a selector START (`.`/`#` + a
  // name char), so `.5` (a number) and a bare `12 (13)` are NOT namespace refs and
  // stay strict expressions — the incoherent `12 (13)` still fails the `)`.
  const namespaceAhead = regex('(?=[.#]-?[_a-zA-Z\\u0080-\\uffff])');
  const parenItem = choice(sequence(namespaceAhead, g.valueSequence), parenExpr);
  const parenExprList = parser({ trivia: rw }, sequence(parenItem, many(sequence(literal(','), parenItem))));
  const parenBody = parser({ trivia: rw }, sequence(optional(sequence(g.parenExprList, many(sequence(literal(';'), optional(g.parenExprList))))), expect(literal(')'), ')')));
  // Permissive paren body (the pre-expression valueList form). Used ONLY by
  // GluedParen — a `(` glued (no space) to a preceding selector/accessor token,
  // i.e. mixin-reference ARGS (`.mixin1(@foo: bar)`, `#ns.x(.valToGet[])`), which
  // hold arbitrary named args / accessor chains, not arithmetic. A `(` with space
  // before it (or at value start) is a real value paren and takes the strict
  // single-expression `parenBody` above, so `(12 (13))` still errors.
  const permissiveParenBody = parser({ trivia: rw }, sequence(optional(sequence(g.valueList, many(sequence(literal(';'), optional(g.valueList))))), expect(literal(')'), ')')));
  // A bare detached ruleset `{ … }` in value / function-argument position → a Mixin.
  const DetachedRuleset = node('DetachedRuleset', parser({ trivia: rw }, sequence(literal('{'), g.declarationList, literal('}'))));
  // Function-call arguments are their OWN production (parity with the Chevrotain
  // functionCallArgs/callArgument rules), NOT `parenBody`: unlike a parenthesized
  // value, a function argument may be an anonymous mixin `.(…){…}` or a bare
  // detached ruleset `{…}` — e.g. `each(@list, { … })`, `func({a:1}, {b:2})`. The
  // comma phase takes value SEQUENCES (comma is the arg separator); after a `;` the
  // args become value LISTS (comma allowed within an arg).
  const callArgSeq = choice(g.AnonymousMixinDefinition, DetachedRuleset, g.valueSequence);
  const callArgList = choice(g.AnonymousMixinDefinition, DetachedRuleset, g.valueList);
  const functionCallArgs = parser({ trivia: rw }, sequence(optional(sequence(sepBy(callArgSeq, literal(',')), many(sequence(literal(';'), optional(callArgList))))), literal(')')));
  // `calc(…)` follows the CSS math grammar, whose only operators are `+ - * /` — a
  // bare `%` operand (e.g. `calc(1 %)`) is a syntax error (Chevrotain: mathProduct
  // has no `%` alt, so the trailing `%` fails the closing `)`). We model calc as a
  // Call whose body excludes a standalone `%` token, so `1 %` leaves the `%`
  // unconsumed and the `)` fails → one parse error. A percentage glued to a number
  // (`100%`) is a Dimension and unaffected.
  const calcAnyTok = regex(/[+\-*/=<>|~^]+|[^\s;{}\[\]()'",!%]+/);
  const calcAnyValue = choice(ident, calcAnyTok);
  const calcValue = choice(g.InterpValue, g.Reference, g.Dimension, g.Num, g.Color, g.NamedColor, g.Url, g.Call, g.EscapedValue, g.Paren, g.SquareParen, g.Quoted, calcAnyValue);
  // calc math grammar (port of mathSum/mathProduct): operators are ONLY `+ - * /` —
  // NO `%` (a standalone `%` stays unconsumed → the `)` fails → syntax error, per
  // CSS calc). `/` always divides here (calc is a math context), built as
  // `Operation`. Precedence + collapse identical to the value-position rules.
  const calcProdOp = regex(/[*\/]/);
  const calcProduct = node('Operation',
    parser({ trivia: rw }, sequence(calcValue, many(sequence(calcProdOp, calcValue)))), undefined, { collapse: true });
  const calcSum = node('Operation',
    parser({ trivia: rw }, sequence(calcProduct, many(sequence(sumOp, calcProduct)))), undefined, { collapse: true });
  const calcSequence = parser({ trivia: rw }, oneOrMore(calcSum));
  const calcList = parser({ trivia: rw }, sequence(calcSequence, many(sequence(literal(','), calcSequence))));
  const calcBody = parser({ trivia: rw }, sequence(optional(sequence(calcList, many(sequence(literal(';'), optional(calcList))))), expect(literal(')'), ')')));
  // `CalcCall` (calc(…)) and the plain value-position `Paren` come from the shared
  // `parenRules` fragment (spread below); they defer to g.calcBody / g.parenBody here.
  const Call = node('Call', parser({ trivia: rw }, sequence(ident, literal('('), functionCallArgs)));
  // Mixin-argument paren: `(` immediately preceded (lookbehind, no trivia) by a
  // selector / accessor char — the args of a `.name(…)` / `#ns.x(…)` reference.
  // Parsed permissively; the Declaration builder reassembles the selector +
  // round-paren-args + square-paren-accessor items into a Reference/Call chain.
  const GluedParen = node('Paren', parser({ trivia: rw }, sequence(regex('(?<=[)\\]\\w.#\\u0080-\\uffff-])\\('), g.permissiveParenBody)));
  const squareParenBody = parser({ trivia: rw }, sequence(optional(g.valueList), literal(']')));
  const SquareParen = node('SquareParen', parser({ trivia: rw }, sequence(literal('['), g.squareParenBody)));
  const anyValue = choice(ident, anyValueTok);

  // `each(<iterable>, { … })` (or `.(@p) { … }`) is a $for control form, not a
  // function call — parse it straight into a `For` node. The callback is a literal
  // detached ruleset / anonymous mixin; a bare `each(list)` with no block callback
  // falls through to a normal Call.
  // `each(<iterable>, { … })` builds a `For` directly (not a throwaway Call). Its
  // ARGUMENTS reuse the shared `functionCallArgs` — same args any function accepts,
  // so the iterable + detached-ruleset / `.(…){…}` callback parse uniformly. The
  // builder pulls the callback (a Mixin) out of the parsed args.
  const EachFor = node('For',
    parser({ trivia: rw }, sequence(
      regex(/each(?![-\w])/i), literal('('), functionCallArgs, optional(literal(';'))
    )));

  // ── At-rules ───────────────────────────────────────────────────────────────
  const atPrelude = optional(scanTo(choice(literal('{'), literal(';')), { skip: [bParen, bSquare, bCurly, singleStr, doubleStr] }));

  // ── Structured, committed query block (@media / @container / @supports) ──────
  // The flat `atPrelude` above walks past ANY bracket content to the first
  // top-level `{`/`;`, so a stray/unbalanced bracket (`@media (extra: bracket))`)
  // is silently swallowed — 0 errors. This structured prelude mirrors the CSS
  // query grammar (grammar.ts QueryCondition/QueryInParens/QueryFeature): each
  // `(…)` is a real balanced group, so a top-level stray `)` is NOT consumed by
  // the prelude, and the committed `expect('{')` then fails ON that `)` → 1 error.
  // Because the query keyword IS consumed, this rule does not fall through to the
  // swallowing generic AtRuleBlock. Well-formed Less-specific preludes that this
  // structured shape can't parse (bare `@var`, `#ns.x[@k]`, `~"…"`, `@media
  // screen`) fail the prelude BEFORE the commit point, so the sequence backtracks
  // cleanly and the generic AtRuleBlock (→ `_buildAtRulePrelude`) handles them.
  // @see https://www.w3.org/TR/mediaqueries-5/#mq-syntax
  // The condition sub-grammar (QueryFeature / QueryInParens / QueryCondition /
  // queryPrelude) comes from the shared `queryRules` fragment (spread below) — it is
  // identical to CSS. Only this block wrapper differs (Less commits its opening
  // brace via `expect`), so it stays here and reads `g.queryPrelude` from the fragment.
  const queryAtKeyword = regex(/@(?:media|container|supports)(?![-\w])/i);
  const QueryAtRuleBlock = node('QueryAtRuleBlock',
    parser({ trivia: rw }, sequence(queryAtKeyword, g.queryPrelude, expect(literal('{'), '{'), g.atRuleBody, expect(literal('}'), '}'))));

  const AtRuleBlock = node('AtRuleBlock',
    parser({ trivia: rw }, sequence(atKeyword, atPrelude, literal('{'), g.atRuleBody, expect(literal('}'), '}'))));

  // ── Structured, committed import statement (@import / @-import / @-export) ────
  // The flat `atPrelude` also swallows a bare ident before the path, so
  // `@import malformed "x.less";` is accepted with 0 errors. This rule requires,
  // right after the keyword and an optional `(options)` paren, a quoted string or
  // `url(...)` as the path — committed via `expect`. For `@import malformed "…"`,
  // the token after the keyword is the bare ident `malformed` (neither `(` nor
  // Quoted/Url), so the committed `expect(choice(Quoted, Url))` fails → 1 error.
  // Ordered before the generic AtRuleStatement; the existing
  // `_buildImportAtRuleFromPrelude` builder reconstructs the AST from source.
  const importKeyword = regex(/@(?:-import|-export|import)(?![-\w])/i);
  const importOptionsParen = sequence(literal('('), scanTo(literal(')'), { skip: [bParen, bSquare, bCurly, singleStr, doubleStr] }), literal(')'));
  const importMedia = scanTo(literal(';'), { skip: [bParen, bSquare, bCurly, singleStr, doubleStr] });
  const ImportAtRuleStatement = node('AtRuleStatement',
    parser({ trivia: rw }, sequence(
      importKeyword, optional(importOptionsParen),
      expect(choice(g.Url, g.Quoted), 'import path'),
      optional(importMedia), expect(literal(';'), ';')
    )));

  const AtRuleStatement = node('AtRuleStatement',
    parser({ trivia: rw }, sequence(atKeyword, atPrelude, literal(';'))));
  // An at-rule body (@media / @supports / @starting-style / …) holds the SAME
  // statements as a ruleset body — nested rules, mixin calls, each(), extends,
  // var calls — not just declarations. Mirror declarationList's choice set.
  // Same statement set as a ruleset body (shares `blockItem`).
  const atRuleBody = parser({ trivia: rw }, many(g.blockItem));

  return {
    rw,
    stylesheetItem, blockItem,
    Stylesheet, VarDeclaration, VarCall, Reference, MixinArgs, mixinNamePath, mixinCallBasicSel, mixinCallPath, MixinCall,
    AnonymousMixinDefinition, MixinOrQualifiedRule, Comparison, GuardDefault, GuardInParens, GuardTerm, GuardAnd, GuardOr, Guard,
    LessAmpersand, InterpolatedSelector, ExtendStatement, ExtendPseudo, ExtendTarget, extendCompound, extendComplex, simpleSelector,
    CompoundSelector, LessComplexSelector, LessSelectorList, AttributeSelector, PseudoSelector, pseudoArg, pseudoSelectorParens,
    Ruleset, declarationList, Declaration, customValue, customCurlyBlock, cpInner, cpParen, cpSquare, cpCurly, cpValue, CustomDeclaration, anyDeclaration,
    valueList, valueSequence, value, Negative, mathProduct, mathSum, topProduct, topSum, parenExprList, InterpValue, EscapedValue, NamedColor, Dimension, Url,
    parenBody, permissiveParenBody, GluedParen, DetachedRuleset, functionCallArgs, squareParenBody, calcBody, Call, SquareParen, anyValue, EachFor,
    QueryAtRuleBlock, ImportAtRuleStatement,
    AtRuleBlock, AtRuleStatement, atRuleBody
  };
})]);
