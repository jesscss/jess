/**
 * Functional Jess grammar — `jessGrammar = compose([cssGrammar, <Jess delta>])`.
 *
 * Jess is authored deliberately on the CSS base (cleanest AST shapes), NOT on the
 * Less/SCSS grammars: we cherry-pick only the constructs Jess actually needs and
 * add the `$`-sigil layer + `//` comments on top. Rules whose names match a CSS
 * rule OVERRIDE it by name; every cross-reference is by `g.RuleName`, so the
 * overrides take effect everywhere in the composed grammar.
 *
 * Trivia note: a rule's `parser({ trivia }, …)` bakes its trivia parser inline at
 * compile time, so it cannot be an external by-name ref. To get `//` line comments
 * inside a context we must re-declare that context's rule here with Jess `rw`.
 *
 * The build host + parse entry live in ./functional-parser.ts; the shared driver
 * in @jesscss/css-parser.
 */
import {
  rules, compose,
  node, regex, literal, sequence, choice, optional, parser, noTrivia, trivia,
  many, oneOrMore, expect
} from 'parseman' with { type: 'macro' };
import { cssGrammar } from '@jesscss/css-parser/grammar';

export const jessGrammar = compose([cssGrammar, rules((g: any) => {
  // ── Trivia: CSS whitespace + block comments + `//` line comments ────────────
  const ws = regex(/[ \t\n\r\f]+/);
  const comment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
  const lineComment = regex(/\/\/[^\n\r]*/);
  const rw = trivia(oneOrMore(choice(ws, comment, lineComment)));

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
  const dollarVar = regex(/\$!?-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  // Bracket key as ONE leaf: `$var` (dynamic) | quoted string | number | keyword.
  const refIndexKey = regex(/\$-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*|'(?:[^'\\]|\\[\s\S])*'|"(?:[^"\\]|\\[\s\S])*"|[+-]?\d+(?:\.\d+)?|-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const refDot = sequence(literal('.'), ident);
  const refIndex = sequence(literal('['), parser({ trivia: rw }, sequence(refIndexKey, literal(']'))));
  const Reference = node(
    noTrivia(sequence(dollarVar, many(choice(refDot, refIndex)), optional(literal('?')))));

  // ── Interpolation `$[key]` (identifier-style) ────────────────────────────────
  // Base-less `$[foo]` (bare → variable) / `$['foo']` (quoted → property), role
  // 'ident'. Valid in identifiers, selectors, property names, strings, and value
  // position. Renders back as `$[foo]` / `$['foo']`.
  const interpKey = regex(/'(?:[^'\\]|\\[\s\S])*'|"(?:[^"\\]|\\[\s\S])*"|-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const DollarInterp = node(
    noTrivia(sequence(literal('$'), literal('['), parser({ trivia: rw }, sequence(interpKey, expect(literal(']'), ']'))))));

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
  const simpleSelector = choice(g.AttributeSelector, g.PseudoSelector, literal('&'), g.InterpolatedSelector, basicSel);

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
    parser({ trivia: rw }, sequence(
      dollarDeclName, assignOp, choice(g.JessCollection, g.valueList), optional(important), optional(literal(';'))
    )));

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
    parser({ trivia: rw }, sequence(literal('$('), g.exprCompare, expect(literal(')'), ')'))));

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
    parser({ trivia: rw }, sequence(
      collKey, literal(':'), choice(g.JessCollection, g.valueList), optional(literal(';'))
    )));
  const JessCollection = node('Collection',
    parser({ trivia: rw }, sequence(literal('{'), many(g.CollectionEntry), expect(literal('}')))));

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
    parser({ trivia: rw }, sequence(regex(/not(?![-\w])/), literal('('), g.condOr, expect(literal(')')))));
  const condPrimary = choice(
    g.condNot,
    parser({ trivia: rw }, sequence(literal('('), g.condOr, literal(')'))),
    condAtom
  );
  const condCompare = node('Condition',
    parser({ trivia: rw }, sequence(g.condPrimary, optional(sequence(condCmpOp, g.condPrimary)))),
    undefined, { collapse: true });
  const condAnd = node('Condition',
    parser({ trivia: rw }, sequence(g.condCompare, many(sequence(regex(/and(?![-\w])/), g.condCompare)))),
    undefined, { collapse: true });
  const condOr = node('Condition',
    parser({ trivia: rw }, sequence(g.condAnd, many(sequence(regex(/or(?![-\w])/), g.condAnd)))),
    undefined, { collapse: true });
  const controlBody = parser({ trivia: rw }, sequence(literal('{'), g.declarationList, expect(literal('}'))));

  // `$if (cond) { … } [$else if (cond) { … }]* [$else { … }]`
  const elseClause = parser({ trivia: rw }, sequence(regex(/\$else(?![-\w])/),
    choice(sequence(regex(/if(?![-\w])/), literal('('), g.condOr, expect(literal(')'), ')'), controlBody), controlBody)));
  const If = node(
    parser({ trivia: rw }, sequence(
      regex(/\$if(?![-\w])/), literal('('), g.condOr, expect(literal(')')), controlBody, many(g.elseClause)
    )));

  // `$while (cond) { … }`
  const While = node(
    parser({ trivia: rw }, sequence(regex(/\$while(?![-\w])/), literal('('), g.condOr, expect(literal(')'), ')'), controlBody)));

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
  const forRange = parser({ trivia: rw }, sequence(
    optional(literal('>')), rangeBound, regex(/to(?![-\w])/), optional(literal('<')), rangeBound,
    optional(sequence(regex(/step(?![-\w])/), rangeBound))
  ));
  const For = node(
    parser({ trivia: rw }, sequence(
      regex(/\$for(?![-\w])/), literal('('),
      forBinding, regex(/of(?![-\w])/), choice(g.forRange, g.Reference, g.value),
      expect(literal(')')), controlBody
    )));

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
    parser({ trivia: rw }, sequence(mixinParamName, optional(sequence(literal(':'), g.valueSequence)))));
  const mixinParams = parser({ trivia: rw }, optional(sequence(
    g.MixinParam, many(sequence(literal(','), g.MixinParam))
  )));
  const mixinGuard = parser({ trivia: rw }, sequence(regex(/when(?![-\w])/), g.condOr));
  const Mixin = node(
    parser({ trivia: rw }, sequence(
      mixinName, literal('('), mixinParams, literal(')'),
      optional(g.mixinGuard),
      literal('{'), g.declarationList, expect(literal('}'))
    )));

  // CALL: `$ > <chain>(args)`. The call operator is `$ >` ONLY. A chain step is a
  // mixin name (`.m`/`#ns`/`name`); intermediate steps may omit `()`, the final
  // step takes `(args)`. Builds `Call{ name: nested mixin-References, args }`.
  const callStep = regex(/[.#]?-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const callArgs = parser({ trivia: rw }, optional(sequence(
    g.valueSequence, many(sequence(literal(','), g.valueSequence))
  )));
  const MixinCall = node(
    parser({ trivia: rw }, sequence(
      literal('$'), literal('>'),
      callStep, many(sequence(literal('>'), callStep)),
      literal('('), callArgs, expect(literal(')')),
      optional(literal(';'))
    )));

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
    parser({ trivia: rw }, sequence(optional(extendNs), oneOrMore(extendTargetPart)))
  );
  const Extend = node(
    parser({ trivia: rw }, sequence(
      regex(/\$extend(?![-\w])/),
      extendTarget, many(sequence(literal(','), extendTarget)),
      optional(regex(/!exact(?![-\w])/)),
      optional(literal(';'))
    )));

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
  const applyTarget = parser({ trivia: rw }, oneOrMore(applyTargetPart));
  const Apply = node(
    parser({ trivia: rw }, sequence(
      regex(/\$apply(?![-\w])/),
      applyTarget, many(sequence(literal(','), applyTarget)),
      optional(literal(';'))
    )));

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
  const asClause = parser({ trivia: rw }, sequence(regex(/as(?![-\w])/), importNs));
  // Import specifier: `name` | `name as alias` | `* as ns`.
  const importName = regex(/-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*|\*/);
  const importSpec = parser({ trivia: rw }, sequence(importName, optional(asClause)));

  const ComposeAtRule = node(
    parser({ trivia: rw }, sequence(
      regex(/@-compose(?![-\w])/), importPath, optional(asClause), optional(literal(';'))
    )));
  const ExportAtRule = node(
    parser({ trivia: rw }, sequence(
      regex(/@-export(?![-\w])/), importPath, optional(literal(';'))
    )));
  const ImportAtRule = node(
    parser({ trivia: rw }, sequence(
      regex(/@-import(?![-\w])/), importPath, optional(literal(';'))
    )));
  const UseAtRule = node(
    parser({ trivia: rw }, sequence(
      regex(/@-use(?![-\w])/), importPath, optional(asClause), optional(literal(';'))
    )));
  const FromAtRule = node(
    parser({ trivia: rw }, sequence(
      regex(/@-from(?![-\w])/), importPath, regex(/import(?![-\w])/),
      choice(
        // `import * as ns`
        sequence(literal('*'), asClause),
        // `import (a, b as c, …)`
        sequence(literal('('), importSpec, many(sequence(literal(','), importSpec)), literal(')'))
      ),
      optional(literal(';'))
    )));

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
    parser({ trivia: rw }, sequence(
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
    )));

  // ── Values: prepend Jess `$` forms before the CSS value set ─────────────────
  const value = choice(
    g.Expression, g.UnwrapArith, g.DollarInterp, g.AnonMixin, g.SelectorCapture, g.Reference,
    g.Dimension, g.Num, g.Color, g.Url, g.CalcCall, g.Call, g.Paren, g.Quoted, g.anyValue
  );

  // ── Root + rule bodies (re-declared so Jess `rw`/`//` + `$` items apply) ─────
  const Stylesheet = node(
    parser({ trivia: rw }, many(choice(
      g.ComposeAtRule, g.ExportAtRule, g.ImportAtRule, g.UseAtRule, g.FromAtRule,
      g.Extend, g.Apply, g.VarDeclaration, g.If, g.For, g.While, g.MixinCall, g.Mixin,
      g.QueryAtRuleBlock, g.AtRuleBlock, g.AtRuleStatement, g.UnknownAtRuleBlock, g.Ruleset
    ))));

  const Ruleset = node(
    parser({ trivia: rw }, sequence(g.SelectorList, literal('{'), g.declarationList, expect(literal('}'), '}'))));

  const declarationList = parser({ trivia: rw }, many(choice(
    g.ComposeAtRule, g.ExportAtRule, g.ImportAtRule, g.UseAtRule, g.FromAtRule,
    g.Extend, g.Apply, g.VarDeclaration, g.If, g.For, g.While, g.MixinCall, g.Mixin,
    g.QueryAtRuleBlock, g.AtRuleBlock, g.AtRuleStatement, g.UnknownAtRuleBlock,
    g.Declaration, g.CustomDeclaration, g.Ruleset, literal(';')
  )));

  return {
    rw,
    Reference, DollarInterp, VarDeclaration, value,
    InterpolatedSelector, simpleSelector,
    Expression, exprProduct, exprSum, exprCompare, JessKeyword,
    unwrapProductLead, unwrapProductRest, UnwrapArith,
    CollectionEntry, JessCollection,
    condNot, condPrimary, condCompare, condAnd, condOr,
    elseClause, forRange,
    If, For, While,
    MixinParam, mixinParams, mixinGuard, Mixin, callArgs, MixinCall,
    AnonMixin, Extend, SelectorCapture, Apply,
    ComposeAtRule, ExportAtRule, ImportAtRule, UseAtRule, FromAtRule,
    Stylesheet, Ruleset, declarationList
  };
})]);
