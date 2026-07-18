/**
 * Functional Jess grammar — `jessGrammar = compose([cssGrammar, <Jess delta>])`.
 *
 * Jess is authored deliberately on the CSS base (cleanest AST shapes), NOT on the
 * Less/SCSS grammars: we cherry-pick only the constructs Jess actually needs and
 * add the `$`-sigil layer + `//` comments on top. Rules whose names match a CSS
 * rule OVERRIDE it by name; every cross-reference is by `g.RuleName`, so the
 * overrides take effect everywhere in the composed grammar.
 *
 * Trivia note: Jess `rw` (CSS whitespace + block comments + `//` line comments) is
 * declared ONCE on the grammar via `rules({ trivia: rw }, …)`, making it ambient in
 * every Jess rule — no per-rule `parser({ trivia: rw }, …)` establishers are needed.
 * `rw` is hoisted to module scope (mirroring css-parser) so the options-first
 * `rules({ trivia: rw }, …)` call can reference it.
 * (Composed CSS rules keep their own baked CSS `rw`, so a `//` inside a construct
 * that stays entirely in a CSS rule is still not skipped — unchanged by this.)
 *
 * The build host + parse entry live in ./functional-parser.ts; the shared driver
 * in @jesscss/css-parser.
 */
import {
  rules, compose,
  node, regex, literal, sequence, choice, optional, noTrivia, trivia,
  many, oneOrMore, expect, label, not, withCtx
} from 'parseman' with { type: 'macro' };
import { cssGrammar } from '@jesscss/css-parser/grammar';

// ── Trivia: CSS whitespace + block comments + `//` line comments ────────────
// Hoisted to module scope so the options-first `rules({ trivia: rw }, …)` below
// can reference it.
const ws = regex(/[ \t\n\r\f]+/);
const comment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const lineComment = regex(/\/\/[^\n\r]*/);
// Label the trivia kinds (matching css/less/scss): the whitespace label carries
// the `whitespace` trivia-kind that the selector builder reads to infer descendant
// combinators (`.foo .bar`). Under `compose()` composing-wins, this `rw` governs
// the inherited css CompoundSelector too, so it MUST tag whitespace or the
// builder's kind-driven descendant split can't fire.
const rw = trivia(oneOrMore(choice(label('whitespace', ws), label('blockComment', comment), label('lineComment', lineComment))));

export const jessGrammar = compose([cssGrammar, rules({ trivia: rw }, (g: any) => {
  // CSS identifier (same shape as the css-parser base terminal).
  const ident = regex(/-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))*/);
  const important = sequence(literal('!'), regex(/important/i));

  // ── `$` references ──────────────────────────────────────────────────────────
  // Accessor model (CSS/Jess, NOT JS — a keyword is not an identifier):
  //   $foo              variable read           ($!foo = live binding)
  //   $base.name        STATIC member — `name` is a literal keyword key
  //   $base[0]          index
  //   $base['k']        literal string key
  //   $base[$key]       DYNAMIC member — value of `$key` is the key
  //   $foo?             optional (undefined → nil)
  // The builder folds `.name` / `[key]` accessors left-associatively into nested
  // Reference nodes. (Reference-CALL `$foo.bar(…)` lands with the call feature.)
  // The `$` sigil is its OWN leaf so the name is captured without it \u2014 jess treats
  // `$` as a real operator (it also heads `$\u2026{}`/`${}`/`:=`), and this lets the CST
  // carry the sigil and the name as distinct nodes (e.g. for two-color highlighting)
  // instead of a fused `$foo` token. `!` (live-binding) stays on the name leaf, where
  // the builder already strips it.
  const dollarName = regex(/!?-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const dollarVar = sequence(literal('$'), dollarName);
  // Bracket key as ONE leaf: `$var` (dynamic) | quoted string | number | keyword.
  const refIndexKey = regex(/\$-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*|'(?:[^'\\]|\\[\s\S])*'|"(?:[^"\\]|\\[\s\S])*"|[+-]?\d+(?:\.\d+)?|-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const refDot = sequence(literal('.'), ident);
  const refIndex = sequence(literal('['), refIndexKey, literal(']'));
  const Reference = node(
    noTrivia(sequence(dollarVar, many(choice(refDot, refIndex)), optional(literal('?')))));

  // ── Interpolation `$[key]` (identifier-style) ────────────────────────────────
  // Base-less `$[foo]` (bare → variable) / `$['foo']` (quoted → property), role
  // 'ident'. Valid in identifiers, selectors, property names, strings, and value
  // position. Renders back as `$[foo]` / `$['foo']`.
  const interpKey = regex(/'(?:[^'\\]|\\[\s\S])*'|"(?:[^"\\]|\\[\s\S])*"|-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const DollarInterp = node(
    noTrivia(sequence(literal('$'), literal('['), interpKey, expect(literal(']'), ']'))));

  // ── Interpolation in SELECTORS ───────────────────────────────────────────────
  // `.widget-$[side]` → InterpolatedSelector wrapping an Interpolated (source with
  // %% placeholders + Reference replacements). Only the ident form `$[…]` is valid
  // in selectors. Tried before `basicSel` so a run containing `$[…]` is claimed
  // whole; a plain selector (no `$[…]`) fails this and falls back to `basicSel`.
  const basicSel = regex(/(?:[.#]?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n]))*|\d+(?:\.\d+)?%|\*)/);
  const dollarInterpTok = regex(/\$\[[^\]]*\]/);
  const selTextRun = regex(/[-_a-zA-Z0-9\u0080-\uffff]+/);
  const InterpolatedSelector = node(
    noTrivia(sequence(optional(regex(/[.#]/)), many(selTextRun), dollarInterpTok, many(choice(dollarInterpTok, selTextRun)))));
  const simpleSelector = choice(g.AttributeSelector, g.PseudoSelector, { gate: (s: any) => !!(s && s.inner), combinator: literal('&') }, g.InterpolatedSelector, basicSel);

  // ── Variable declarations ───────────────────────────────────────────────────
  // `$name: value;` — the variable's name is `name` (no `$`). Assignment ops:
  // `:` normal, `?:` conditional (assign only if undefined), `:=` non-shadowing
  // (reassign the outer binding). `:=` MUST precede `:` in the alternation so it
  // wins over `:` + a `=`-led value (`$foo := bar`).
  //
  // NOTE: variable `+:` is INTENTIONALLY absent — there is no Jess VARIABLE
  // compound-add operator; write it explicitly (`$foo: $foo + 1`). Less PROPERTY
  // `+:` merge is a separate feature on plain Declarations, unaffected by this.
  //
  // `$!foo: bar` is a live-binding ASSIGNMENT — the `!` right after `$` mirrors the
  // `$!foo` read form. It parses (with a warning; eval is a TODO), so the name regex
  // allows an optional `!` before the identifier.
  const dollarDeclName = regex(/\$!?-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const assignOp = regex(/\?:|:=|:/);
  const VarDeclaration = node(
    sequence(
      dollarDeclName, assignOp, choice(g.JessCollection, g.valueList), optional(important), optional(literal(';'))
    ));

  // ── Expressions: `$( … )` ────────────────────────────────────────────────────
  // A single Expression node wrapping an arithmetic / comparison tree. Inside
  // `$(…)` bare idents are keyword/value literals; `$x` is a reference. Precedence
  // is grammar-encoded (`* / %` over `+ -`, both over comparisons), left-assoc;
  // `collapse` passes a single operand through so `$(red)` wraps just the keyword.
  //
  // Binary operators REQUIRE surrounding whitespace (`1 + 2`, `5 % 2`), unlike
  // Less (`1+2`). The whitespace is baked INTO the operator token (` * `, ` + `),
  // which is exactly the op leaf `_buildOperation` already `.trim()`s — so it never
  // pollutes the operand children, and glued `$(1+2)` / `$(5%2)` are NOT operations.
  // The operand levels are `noTrivia` so a glued `50%` reads as a percent Dimension
  // while spaced `5 % 2` is `Num 5` ` % ` `Num 2`.
  const prodOp = regex(/[ \t\n\r\f]+[*/%][ \t\n\r\f]+/);
  const sumOp = regex(/[ \t\n\r\f]+[-+][ \t\n\r\f]+/);
  const compareOp = regex(/[ \t\n\r\f]+(?:>=|<=|>|<|=)[ \t\n\r\f]+/);
  // Glued dimension for `$(…)`: number + unit with NO space between (inline, so
  // `noTrivia` actually applies — unlike the compiled `g.Dimension`). Keeps `50%`
  // a Dimension while letting `5 %` fall through to `Num` + modulo.
  const numPart = regex(/[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?|\d+)/);
  const unitPart = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*|%/);
  const exprDimension = node('Dimension', noTrivia(sequence(numPart, unitPart)));
  // Bare ident inside `$(…)` is a keyword/value literal. A NODE (not a raw leaf)
  // so a lone keyword survives the `collapse` on exprProduct/Sum/Compare.
  const JessKeyword = node(regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/));
  const exprAtom = choice(g.Reference, exprDimension, g.Num, g.Color, g.Quoted, g.JessKeyword);
  const exprProduct = node('Operation',
    noTrivia(sequence(exprAtom, many(sequence(prodOp, exprAtom)))), undefined, { collapse: true });
  const exprSum = node('Operation',
    noTrivia(sequence(g.exprProduct, many(sequence(sumOp, g.exprProduct)))), undefined, { collapse: true });
  const exprCompare = node('Condition',
    noTrivia(sequence(g.exprSum, optional(sequence(compareOp, g.exprSum)))), undefined, { collapse: true });
  const Expression = node(
    sequence(literal('$('), g.exprCompare, expect(literal(')'), ')')));

  // ── Quoted with `$[…]` / `$(…)` interpolation (mirrors Less §3.3) ─────────────
  // Jess is the sole source of string-interpolation STRUCTURE: the shared CSS
  // `Quoted` is one flat `singleStr`/`doubleStr` leaf that swallows any interior
  // `$[…]`/`$(…)`; this override structures both interpolation forms as isolated
  // child nodes interleaved with literal string-content leaves (the builder folds
  // them into an `Interpolated` value — never a byte re-scan).
  //
  // `dqContents`/`sqContents` = the "string contents" primitive: a run up to the
  // closing quote, an escape, or the next interp opener. The `\$(?![\[(])`
  // negative-lookahead is the EXACT complement of the two interp openers (`$[`,
  // `$(`), so a `$` only ends a chunk when it opens interpolation — a lone `$` or
  // a `$x` (property-ish false start) stays INSIDE the chunk as literal text.
  const dqContents = regex(/(?:[^"\\$]|\\[\s\S]|\$(?![\[(]))+/);
  const sqContents = regex(/(?:[^'\\$]|\\[\s\S]|\$(?![\[(]))+/);
  // The two `.jess` interpolation forms (owner-confirmed):
  //   `$[key]` = KEY interpolation (DollarInterp; body stays a lookup key)
  //   `$(expr)` = FULL-EXPRESSION interpolation (the `$(…)` Expression form)
  // Interp tried FIRST in the arm so a `$[`/`$(` opener wins over a contents chunk.
  const strInterpJess = choice(g.DollarInterp, g.Expression);
  // `noTrivia` on each arm: string spaces are literal content, NOT trivia — the
  // ambient `rw` must not skip them between the quote / contents / interp elements.
  // A referenced interp node (`g.Expression`) re-establishes the ambient trivia
  // inside its own scope, so spaced operators in `$(1 + 2)` still parse.
  // A string with NO interpolation matches only contents/quote leaves (no child
  // node); the builder reconstructs it BYTE-IDENTICALLY via the flat CSS builder.
  const Quoted = node('Quoted', choice(
    noTrivia(sequence(literal('"'), many(choice(strInterpJess, dqContents)), literal('"'))),
    noTrivia(sequence(literal('\''), many(choice(strInterpJess, sqContents)), literal('\'')))
  ));

  // ── Unwrapped leading-`$var` arithmetic (value position) ─────────────────────
  // A targeted relaxation of the double-`$` rule: in value position, arithmetic
  // that LEADS with a `$var` may be written WITHOUT the `$(…)` wrapper — `$w + 1`
  // builds the SAME `Operation` node as `$($w + 1)`. Reuses the wrapped operator
  // precedence (`*` over `+ -`) and `_buildOperation` verbatim; the ONLY difference
  // is the first operand must be a `Reference` (gates keyword arithmetic: `w + 1`
  // does NOT trigger this, stays a literal list) and ≥1 operator is required (a
  // bare `$w` falls through to the plain `g.Reference`).
  //
  // `/` is EXCLUDED (still needs the wrapper) — `font: 16px/1.5` slash ambiguity.
  // Operators are STANDALONE tokens (whitespace both sides, baked into the op leaf):
  // `$w - 1` → subtract; `$w -1` → the `-1` fuses into a signed `Num` (no standalone
  // `-` token) so it stays a list — this falls out of tokenization, no heuristic.
  const unwrapProdOp = regex(/[ \t\n\r\f]+[*][ \t\n\r\f]+/);
  const unwrapSumOp = regex(/[ \t\n\r\f]+[-+][ \t\n\r\f]+/);
  // Product level (leads with `$var`): mirrors `exprProduct` but `*`-only and the
  // first operand is a `Reference` (the lead gate); rest operands are any atom.
  // `collapse` passes a lone `$w` through, so this alone can't require an operator —
  // the ≥1-operator requirement lives in `UnwrapArith` below.
  const unwrapProductLead = node('Operation',
    noTrivia(sequence(g.Reference, many(sequence(unwrapProdOp, exprAtom)))), undefined, { collapse: true });
  // Chained products (after a `+`/`-`) may lead with any atom (`$w + 1 * 2`).
  const unwrapProductRest = node('Operation',
    noTrivia(sequence(exprAtom, many(sequence(unwrapProdOp, exprAtom)))), undefined, { collapse: true });
  // Sum level: a `$var`-led product, then a REQUIRED tail of ≥1 (`+`/`-` product).
  // Requiring the tail via `oneOrMore` means a bare `$w` (no operator) does NOT
  // match — it falls through to the plain `g.Reference`. Nesting the product inside
  // the sum gives `*`-over-`+`/`-` precedence for free (same as the wrapped path);
  // `_buildOperation` folds each level left-assoc.
  //
  // But `$w * 2` (a `*` with NO `+`/`-`) must ALSO match — there the sum tail is
  // empty, so we require the operator in EITHER level: the product-lead has ≥1 `*`,
  // OR the sum tail has ≥1 `+`/`-`.
  const unwrapSumTail = many(sequence(unwrapSumOp, g.unwrapProductRest));
  const UnwrapArith = node('Operation',
    noTrivia(choice(
      // `$w * 2 [+ …]` — the lead product carries ≥1 `*`, sum tail optional.
      sequence(
        node('Operation', noTrivia(sequence(g.Reference, oneOrMore(sequence(unwrapProdOp, exprAtom)))), undefined, { collapse: true }),
        unwrapSumTail
      ),
      // `$w + …` — no `*` at the lead; require ≥1 `+`/`-`.
      sequence(g.unwrapProductLead, oneOrMore(sequence(unwrapSumOp, g.unwrapProductRest)))
    )), undefined, { collapse: true });

  // ── Collections / maps: `{ key: value; nested: { … } }` ─────────────────────
  // A brace-delimited block of arbitrary key/value pairs → `Collection` node
  // (an anonymous-mixin-shaped Rules subclass holding Declarations). Keys are
  // bare idents (a leading `_` marks a private key — parse-transparent, honoured
  // by eval). A value may be a nested Collection or an ordinary value list.
  // Distinct from a Ruleset: a Collection appears only in value position (a
  // VarDeclaration RHS or a nested entry), never as a top-level statement.
  const collKey = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const CollectionEntry = node(
    sequence(
      collKey, literal(':'), choice(g.JessCollection, g.valueList), optional(literal(';'))
    ));
  const JessCollection = node('Collection',
    sequence(literal('{'), many(g.CollectionEntry), expect(literal('}'))));

  // ── Control flow: `$if` / `$else` / `$for` / `$while` ────────────────────────
  // Control-flow keywords start with `$`, but the parenthesised header EXITS
  // expression mode: an operand that is a variable read must be written `$foo`
  // (a bare ident is a keyword literal — e.g. `true`/`false`). Comparison ops
  // (`=` `>` `<` `>=` `<=`) and logical `and`/`or`/`not` join operands.
  //
  // `condAtom` covers a variable read, a number/dimension/color/string, or a
  // bare keyword. `condCompare` folds an optional comparison into a Condition;
  // `condAnd`/`condOr` chain logical operators; `not (…)` negates a sub-cond.
  const condCmpOp = regex(/>=|<=|>|<|=/);
  const condKeyword = node('JessKeyword', regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/));
  const condAtom = choice(g.Reference, g.Dimension, g.Num, g.Color, g.Quoted, condKeyword);
  const condNot = node('Condition',
    sequence(regex(/not(?![-\w])/), literal('('), g.condOr, expect(literal(')'))));
  // A join OPERAND: a `not(…)`, a parenthesised sub-condition, or a bare atom — but
  // NOT a bare comparison. `condPrimary`'s comparison route is the `( condOr )` alt.
  const condPrimary = choice(
    g.condNot,
    sequence(literal('('), g.condOr, literal(')')),
    condAtom
  );
  // ── Jess condition grammar (LOCKED — owner-final spec) ───────────────────────
  // Jess conditions are STRICT (media-query MQ4 style), NOT Less-permissive:
  //
  //   ATOM (no wrapping needed):
  //     • a single comparison            `$a > 5`
  //     • a bare value/keyword/variable  `true`, `$c`
  //     • `not(<condition>)`             `not($a)`
  //     • a parenthesised `(<condition>)`
  //
  //   JOIN (operands combined by `and` OR by `or` — one operator kind per level):
  //     • a COMPARISON operand MUST be parenthesised — `($a>5) and ($b>2)`. A bare
  //       comparison join `$a>5 and $b>2` is a PARSE ERROR (operator-boundary
  //       ambiguity; only comparisons carry it).
  //     • a bare NON-comparison atom operand is allowed — `($a>5) and true`,
  //       `($a>5) and $c` (no ambiguity).
  //     • same-operator chains are fine — `(A) and (B) and (C)`, `(A) or (B) or (C)`.
  //     • MIXING `and` and `or` at one level is a PARSE ERROR — must group:
  //       `((A) and (B)) or (C)` or `(A) and ((B) or (C))`. No implicit precedence
  //       in Jess (unlike Less, where `and` binds tighter and the parser normalises).
  //
  // Mechanism: a pure `and`-chain / pure `or`-chain each consume ONLY their own
  // operator via `many`. A mixed `(A) and (B) or (C)` parses `(A) and (B)` then
  // leaves ` or (C)` unconsumed — the enclosing header's `)`/body never matches, so
  // the whole construct fails to parse (a rejection). The `.less` side deliberately
  // DIVERGES: it accepts these permissive forms and inserts implicit `Paren` nodes to
  // reach this same grouped AST shape (see less-parser `_buildCondArgJoin`).
  const condCompare = node('Condition',
    sequence(g.condPrimary, optional(sequence(condCmpOp, g.condPrimary))),
    undefined, { collapse: true });
  // Pure `and`-chain: ≥2 operands joined ONLY by `and`. A trailing `or` is NOT
  // consumed here, so a mixed chain surfaces as unconsumed input (a parse error).
  const condPureAnd = node('Condition',
    sequence(g.condPrimary, oneOrMore(sequence(regex(/and(?![-\w])/), g.condPrimary))),
    undefined, { collapse: true });
  // Pure `or`-chain: ≥2 operands joined ONLY by `or`. A trailing `and` is likewise
  // left unconsumed (a parse error), enforcing the no-mixing rule.
  const condPureOr = node('Condition',
    sequence(g.condPrimary, oneOrMore(sequence(regex(/or(?![-\w])/), g.condPrimary))),
    undefined, { collapse: true });
  // A whole condition: a pure `and`-chain, a pure `or`-chain, or a lone `condCompare`
  // (single comparison or bare atom). The bare-`condCompare` alternative is guarded by
  // a negative lookahead so it can't win when an `and`/`or` follows — forcing the
  // strict chain alternatives (which reject bare-comparison operands and mixing).
  const condOr = node('Condition',
    choice(
      g.condPureAnd,
      g.condPureOr,
      sequence(g.condCompare, not(regex(/\s*(?:and|or)(?![-\w])/)))
    ),
    undefined, { collapse: true });
  const controlBody = sequence(literal('{'), g.declarationList, expect(literal('}')));

  // `$if (cond) { … } [$else if (cond) { … }]* [$else { … }]`
  const elseClause = sequence(regex(/\$else(?![-\w])/),
    choice(sequence(regex(/if(?![-\w])/), literal('('), g.condOr, expect(literal(')'), ')'), controlBody), controlBody));
  const If = node(
    sequence(
      regex(/\$if(?![-\w])/), literal('('), g.condOr, expect(literal(')')), controlBody, many(g.elseClause)
    ));

  // `$while (cond) { … }`
  const While = node(
    sequence(regex(/\$while(?![-\w])/), literal('('), g.condOr, expect(literal(')'), ')'), controlBody));

  // `$for (<binding> of <iterable>) { … }`
  //   binding : `$x` | `$x, $i` | `[$k, $v]`  (destructure)
  //   iterable: `$list` | `<from> to <to>`  (range; `>`/`<` on a bound excludes it)
  const forVar = regex(/\$-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const forBinding = choice(
    sequence(literal('['), forVar, many(sequence(literal(','), forVar)), literal(']')),
    sequence(forVar, many(sequence(literal(','), forVar)))
  );
  // `g.Num` before `g.Dimension`: for `1 to 3` a bare `1` must read as Num — the
  // compiled Dimension is trivia-permissive and would otherwise swallow the `to`
  // as a unit (`Dimension(1, "to")`). Num's `(?![a-zA-Z…%])` guard keeps `1px`
  // (glued unit) falling through to Dimension while a space-followed `1` is a Num.
  const rangeBound = choice(g.Reference, g.Num, g.Dimension);
  const forRange = sequence(
    optional(literal('>')), rangeBound, regex(/to(?![-\w])/), optional(literal('<')), rangeBound,
    optional(sequence(regex(/step(?![-\w])/), rangeBound))
  );
  const For = node(
    sequence(
      regex(/\$for(?![-\w])/), literal('('),
      forBinding, regex(/of(?![-\w])/), choice(g.forRange, g.Reference, g.value),
      expect(literal(')')), controlBody
    ));

  // ── Mixins ───────────────────────────────────────────────────────────────────
  // DEFINITION: `name(params) [when guard] { body }`. Names are Less-style
  // (`.mixin`/`#mixin`) or Sass-style (`mixin`). Params are comma-separated
  // `$name[: default]` entries (a `$name` reference or a VarDeclaration with a
  // default). The optional `when` guard reuses the condition grammar.
  //
  // Argument/param separator: per the language doc's stated rule, Jess uses
  // COMMAS. (Some doc EXAMPLES show `;` — a doc self-contradiction; `;`-separated
  // args + rest params `...$x` + content callbacks are DEFERRED, see NOTES.)
  const mixinName = regex(/[.#]?-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const mixinParamName = regex(/\$-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const MixinParam = node(
    sequence(mixinParamName, optional(sequence(literal(':'), g.valueSequence))));
  const mixinParams = optional(sequence(
    g.MixinParam, many(sequence(literal(','), g.MixinParam))
  ));
  const mixinGuard = sequence(regex(/when(?![-\w])/), g.condOr);
  const Mixin = node(
    sequence(
      mixinName, literal('('), mixinParams, literal(')'),
      optional(g.mixinGuard),
      literal('{'), g.declarationList, expect(literal('}'))
    ));

  // CALL: `$ > <chain>(args)`. The call operator is `$ >` ONLY. A chain step is a
  // mixin name (`.m`/`#ns`/`name`); intermediate steps may omit `()`, the final
  // step takes `(args)`. Builds `Call{ name: nested mixin-References, args }`.
  const callStep = regex(/[.#]?-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const callArgs = optional(sequence(
    g.valueSequence, many(sequence(literal(','), g.valueSequence))
  ));
  const MixinCall = node(
    sequence(
      literal('$'), literal('>'),
      callStep, many(sequence(literal('>'), callStep)),
      literal('('), callArgs, expect(literal(')')),
      optional(literal(';'))
    ));

  // A direct variable call is a statement-level call to a variable holding a
  // callable value, e.g. `$rounded(8px)`. Keep it separate from Reference so
  // ordinary `$name` value reads retain their existing shape.
  const VariableMixinCall = node(
    sequence(
      dollarVar, literal('('), callArgs, expect(literal(')')),
      optional(literal(';'))
    ));

  // ── `$extend` statement ──────────────────────────────────────────────────────
  // `$extend <target> [!exact];` — a statement (NOT Less's `:extend()` pseudo).
  // The target is a selector (complex/compound/simple — incl. `&`, `$[…]` interp,
  // and namespaced `ns|.sel`) or a variable reference (`$type`). Jess/Sass default
  // is a partial (`All`) match; `!exact` flips it to Less's exact match. Builds a
  // core `Extend{ target, flag }` — which serializes back with the `$extend` sigil.
  // NOTE: a `*[…]` capture is NOT an extend target — the target position already
  // accepts a selector directly; `*[…]` (SelectorCapture) is value-position only.
  const extendNs = regex(/-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*\|/);
  const extendTargetPart = choice(g.AttributeSelector, g.PseudoSelector, literal('&'), g.InterpolatedSelector, basicSel);
  // Reference (`$type`) tried first so a `$…` is claimed before the selector fallback.
  const extendTarget = choice(
    g.Reference,
    sequence(optional(extendNs), oneOrMore(extendTargetPart))
  );
  const Extend = node(
    sequence(
      regex(/\$extend(?![-\w])/),
      extendTarget, many(sequence(literal(','), extendTarget)),
      optional(regex(/!exact(?![-\w])/)),
      optional(literal(';'))
    ));

  // ── Selector capture `*[…]` ──────────────────────────────────────────────────
  // `*[.notice]` / `*[.a, .b]` — a selector-VALUED payload (core `SelectorCapture`,
  // which serializes back as `*[…]`, NO `$` sigil; adjudicated). Appears in VALUE
  // position only (`$type: *[.notice];`) — NOT an `$extend` target (that position
  // takes a selector directly: `$extend .notice`).
  // The inner is a selector list; the builder coerces the (possibly string) inner
  // selector to a proper Selector node so writeSyntax/eval have a real node.
  const SelectorCapture = node(
    sequence(
      literal('*['),
      g.SelectorList, expect(literal(']'), ']')
    ));

  // ── `$apply` — selectors as mixins ───────────────────────────────────────────
  // `$apply .rounded, .shadow;` — applies (calls) rulesets as mixins. Surface is
  // `$apply <selector-list>` (space after `$apply`), NEVER `$|…` (adjudicated).
  // Each listed selector lowers to a mixin CALL of the shape `$ > *[.sel]()` — a
  // `Call` whose name is a base-less `type:'mixin'` Reference keyed by a selector
  // capture (`$apply .foo` ≈ `$ > *[.foo]`). A comma list → one Call per selector.
  const applyTargetPart = choice(g.AttributeSelector, g.PseudoSelector, literal('&'), g.InterpolatedSelector, basicSel);
  const applyTarget = oneOrMore(applyTargetPart);
  const Apply = node(
    sequence(
      regex(/\$apply(?![-\w])/),
      applyTarget, many(sequence(literal(','), applyTarget)),
      optional(literal(';'))
    ));

  // ── Jess `@-` at-rules (compiler at-rules; dash-prefixed for future-CSS safety) ─
  //   @-compose 'path' [as ns|*];   → StyleImport{ type:'compose' }
  //   @-export 'path';              → StyleImport{ type:'compose', forward }
  //   @-import 'path';              → StyleImport{ type:'import' } (renders @import)
  //   @-use 'path' [as ns];         → JsImport{ source:'use' } (namespace module)
  //   @-from 'path' import (a as b) | * as ns;  → JsImport{ source:'from' } (ESM)
  // `@-use` and `@-from` are DISTINCT constructs (adjudication #3), not aliases.
  // Path is a Quoted string; namespace / import names are bare idents (or `*`).
  const importPath = g.Quoted;
  const importNs = regex(/-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*|\*/);
  const asClause = sequence(regex(/as(?![-\w])/), importNs);
  // Import specifier: `name` | `name as alias` | `* as ns`.
  const importName = regex(/-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*|\*/);
  const importSpec = sequence(importName, optional(asClause));

  const ComposeAtRule = node(
    sequence(
      regex(/@-compose(?![-\w])/), importPath, optional(asClause), optional(literal(';'))
    ));
  const ExportAtRule = node(
    sequence(
      regex(/@-export(?![-\w])/), importPath, optional(literal(';'))
    ));
  const ImportAtRule = node(
    sequence(
      regex(/@-import(?![-\w])/), importPath, optional(literal(';'))
    ));
  const UseAtRule = node(
    sequence(
      regex(/@-use(?![-\w])/), importPath, optional(asClause), optional(literal(';'))
    ));
  const FromAtRule = node(
    sequence(
      regex(/@-from(?![-\w])/), importPath, regex(/import(?![-\w])/),
      choice(
        // `import * as ns`
        sequence(literal('*'), asClause),
        // `import (a, b as c, …)`
        sequence(literal('('), importSpec, many(sequence(literal(','), importSpec)), literal(')'))
      ),
      optional(literal(';'))
    ));

  // ── Anonymous mixins & functions ─────────────────────────────────────────────
  // A nameless Mixin in VALUE position, started with `@(` or `@{`. Four shapes:
  //   @() { … }          anon mixin (params, block body)
  //   @{ … }             anon mixin (no params, block body)
  //   @() > { … }        FUNCTION, block body (looks up final `result:`)
  //   @() > <expr>       FUNCTION, single-expression body (sugar → `result: <expr>`)
  // The `>` marker distinguishes a function from a plain anon mixin; the builder
  // normalises the single-expr form into a `result` Declaration body so a function
  // is uniformly "a Mixin whose body assigns `result`" (per the docs; aligns with
  // the CSS `@function` `result:` return descriptor).
  const AnonMixin = node(
    sequence(
      literal('@'),
      choice(
        // `@(params) [>] { body }` | `@(params) > <expr>`
        sequence(
          literal('('), mixinParams, literal(')'),
          choice(
            sequence(literal('>'), literal('{'), g.declarationList, expect(literal('}'))),
            sequence(literal('>'), g.valueSequence),
            sequence(literal('{'), g.declarationList, expect(literal('}')))
          )
        ),
        // `@{ body }` — no params
        sequence(literal('{'), g.declarationList, expect(literal('}')))
      )
    ));

  // ── Values: prepend Jess `$` forms before the CSS value set ─────────────────
  const value = choice(
    g.Expression, g.UnwrapArith, g.DollarInterp, g.AnonMixin, g.SelectorCapture, g.Reference,
    g.Dimension, g.Num, g.Color, g.Url, g.CalcCall, g.Call, g.Paren, g.Quoted, g.anyValue
  );

  // ── Root + rule bodies (re-declared so Jess `rw`/`//` + `$` items apply) ─────
  const Stylesheet = node(
    many(choice(
      g.ComposeAtRule, g.ExportAtRule, g.ImportAtRule, g.UseAtRule, g.FromAtRule,
      g.Extend, g.Apply, g.VarDeclaration, g.If, g.For, g.While, g.VariableMixinCall, g.MixinCall, g.Mixin,
      g.QueryAtRuleBlock, g.AtRuleBlock, g.AtRuleStatement, g.UnknownAtRuleBlock, g.Ruleset
    )));

  const Ruleset = node(
    sequence(g.SelectorList, literal('{'), g.declarationList, expect(literal('}'), '}')));

  const declarationList = withCtx({ inner: true }, many(choice(
    g.ComposeAtRule, g.ExportAtRule, g.ImportAtRule, g.UseAtRule, g.FromAtRule,
    g.Extend, g.Apply, g.VarDeclaration, g.If, g.For, g.While, g.VariableMixinCall, g.MixinCall, g.Mixin,
    g.QueryAtRuleBlock, g.AtRuleBlock, g.AtRuleStatement, g.UnknownAtRuleBlock,
    g.Declaration, g.CustomDeclaration, g.Ruleset, literal(';')
  )));

  return {
    rw,
    Reference, DollarInterp, VarDeclaration, value,
    InterpolatedSelector, simpleSelector,
    Quoted,
    Expression, exprProduct, exprSum, exprCompare, JessKeyword,
    unwrapProductLead, unwrapProductRest, UnwrapArith,
    CollectionEntry, JessCollection,
    condNot, condPrimary, condCompare, condPureAnd, condPureOr, condOr,
    elseClause, forRange,
    If, For, While,
    MixinParam, mixinParams, mixinGuard, Mixin, callArgs, MixinCall, VariableMixinCall,
    AnonMixin, Extend, SelectorCapture, Apply,
    ComposeAtRule, ExportAtRule, ImportAtRule, UseAtRule, FromAtRule,
    Stylesheet, Ruleset, declarationList
  };
})]);
