/**
 * Functional Less grammar — the macro-compiled counterpart to the class-based
 * LessGrammar. This file is JUST the grammar: `lessGrammar = compose([cssGrammar,
 * <Less delta>])`. Most returned rules are structural `node(parser)` entries that build via
 * the injected `ctx.build` host. The host + parse entry (`parseLessFn`,
 * `LessParser`) live in ./functional-parser.ts; the shared driver in
 * @jesscss/css-parser.
 */
import {
  rules, compose,
  node, regex, literal, sequence, choice, many, oneOrMore, optional,
  not, scanTo, balanced, parser, trivia, noTrivia, expect, sepBy, label
} from 'parseman' with { type: 'macro' };
import { cssGrammar } from '@jesscss/css-parser/grammar';

// ---------------------------------------------------------------------------
// Grammar — Less = CSS + the Less delta. `compose` fuses the imported compiled
// `cssGrammar` (its linkable pieces travel on the value — no source) with the
// inline Less delta: the delta's rules win by name, and its references to CSS
// value rules (Num/Quoted/Paren/query) resolve into the fused set. One grammar =
// one `rules()`; no fragment spreads.
// ---------------------------------------------------------------------------

// Trivia (`rw`) is declared ONCE on the grammar via `rules({ trivia: rw }, …)`,
// honored through `compose()`, making it ambient in every rule — no per-rule
// trivia-establisher wrappers are needed. Hoisted to module scope (mirroring
// css-parser) so the options-first `rules({ trivia: rw }, …)` call below can
// reference it. Same shape as CSS (whitespace + block + `//` line comments).
const ws = regex(/[ \t\n\r\f]+/);
const comment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const lineComment = regex(/\/\/[^\n\r]*/);
const rw = trivia(oneOrMore(choice(label('whitespace', ws), label('blockComment', comment), label('lineComment', lineComment))));

export const lessGrammar = compose([cssGrammar, rules({ trivia: rw }, (g: any) => {
  // ---------------------------------------------------------------------------
  // Terminals (CSS base + Less @var / @{interp}).
  // ---------------------------------------------------------------------------

  // Whitespace-only trivia for url() bodies: inside `url(…)`, `//` and `/*` are URL
  // characters, not comments (`url(//host/x)` is protocol-relative), so the normal
  // `rw` (which skips line/block comments) must not apply there.
  const urlWs = trivia(ws);

  const ident = regex(/-?(?:[_a-zA-Z-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
  // Selectors / mixin names / idents include CSS escapes (\hex, \char) — same
  // definition as css-parser grammar.ts (a mixin call is just a selector).
  const basicSel = regex(/(?:[.#]?-?(?:[_a-zA-Z-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*|\d+(?:\.\d+)?%|\*)/);
  const combinator = choice(literal('||'), literal('>'), literal('+'), literal('~'), literal('|'));
  const pseudoColon = regex(/::?/);
  const attrOp = regex(/[*~|^$]?=/);
  // Only `i` / `s` are defined today; for forwards-compatibility any single ASCII
  // letter is accepted (`[a=b c]`). A digit / underscore / other non-letter is
  // still rejected.
  const attrMod = regex(/[a-zA-Z]/);
  /** @todo(css-spec-parity): ad-hoc An+B microsyntax regex — mirror the css-parser `nth` once its spec audit (css-syntax-3 §the-anb-type / selectors-4 §6.6.2) lands; overrides the CSS base so any tightening there must be ported here too. */
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
  const atKeyword = regex(/@-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const urlOpen = regex(/url\(/i);
  // Unquoted url() body — spec-exact <url-token> code points (consume-a-url-token,
  // css-syntax-3 §4.3.6). A url code point is any code point EXCEPT `"` `'` `(` `)`,
  // whitespace (tab/newline/form-feed/CR/space), a non-printable (U+0000–08, U+000B,
  // U+000E–1F, U+007F), and `\`; a `\` begins an escaped code point (§4.3.7): `\` +
  // 1–6 hex digits with one optional trailing whitespace terminator, OR `\` + any
  // single non-newline code point — the same escape idiom `ident` uses. Ported
  // verbatim from css-parser (5250b736b); Less inherits it and SCSS inherits it from
  // Less.
  const urlInner = regex(/(?:[^"'()\\ \t\n\f\r\x00-\x08\x0B\x0E-\x1F\x7F]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);
  const anyValueTok = regex(/[+\-*/=<>|~^]+|[^\s;{}\[\]()'",!]+/);

  // Less-specific terminals.
  // First char may be a digit \u2014 Less allows numeric variable names (`@3`, `@{3}`).
  // `@` + one or more name chars (dash included), so a dash-only name like `@-` is
  // valid (Less accepts it). Digits are allowed anywhere (`@3` \u2014 flagged, not rejected).
  const lessVar = regex(/@[-_a-zA-Z0-9\u0080-\uffff]+/);
  // \u00a74.1 amendment (owner-approved 2026-07-18): the interpolation BODY is a
  // READ-ONLY value REFERENCE \u2014 a bare-name/var head followed by zero or more
  // `[key]` accessors (`@{theme[variant]}`, `@{map[@key]}`). The body is STRUCTURED
  // by the grammar (P0 KEYSTONE: parser is the sole source of structure) \u2014 a
  // `LessInterp` node whose children are the `@{` / `}` delimiter leaves, the head
  // leaf, and each `[` / key / `]` accessor leaf \u2014 so a host consumes those child
  // tokens directly and NEVER re-scans the `@{\u2026}` body bytes to rebuild the split.
  // The zero-accessor case `@{name}` builds a plain variable ref (byte-identical).
  // Accessor keys admit ident / `@var` / `$prop` / numeric tokens; a `.`-call
  // (`@{head.call()}`) is intentionally NOT accepted (read-only). The `@{`\u2026`}`
  // delimiters are owner-LOCKED. This single production is the shared interp-body
  // seam \u2014 every `@{\u2026}` position (Quoted, selector, custom-prop, prelude, value)
  // references `lessInterp` (or the parallel `interpKey`) so they all agree.
  // `noTrivia` keeps the whole token contiguous (matching the former single regex):
  // a spaced `@{ x }` / `@{a.b}` / `@{}` false-start does NOT match and stays literal.
  const interpHead = regex(/-?[_a-zA-Z0-9\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const interpAccessorKey = regex(/[-_a-zA-Z0-9@$\u0080-\uffff]+/);
  const interpAccessor = sequence(literal('['), interpAccessorKey, literal(']'));
  const lessInterp = node('LessInterp',
    noTrivia(sequence(literal('@{'), interpHead, many(interpAccessor), literal('}'))));
  // Interpolated custom-property name (`--@{key}`, `--foo-@{key}-bar`).
  // TODO(tier-b/A4): WHAT \u2014 kept as ONE token (NOT leaf-split like the value below).
  // WHY \u2014 the legacy BuilderHost that drives the less-compat bridge consumes this
  // single-leaf shape; splitting it into `@{\u2026}` leaves regressed the bridge's
  // custom-prop name emission (`--@{k}` \u2192 `--`), an external-contract break. RETIREMENT
  // TRIGGER \u2014 split into `--` + ident-chunk + isolated `lessInterp` leaves (mirroring
  // `InterpolatedSelector`) when the legacy BuilderHost is retired (reorg Phase A4);
  // the tree2 host's `declName` re-tokenizer retires with it. (The VALUE below IS
  // split \u2014 the legacy builder tolerates that.)
  // Both `@{var}` and `${prop}` interpolation sigils are accepted (`--z-${prop}`);
  // the host `declName` structures each (`@`\u2192VarRef, `$`\u2192PropRef).
  const customPropInterp = regex(/--(?:-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*|-)?[@$]\{-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*(?:\[[-_a-zA-Z0-9@$\u0080-\uffff]+\])*\}(?:[@$]\{-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*(?:\[[-_a-zA-Z0-9@$\u0080-\uffff]+\])*\}|[-_a-zA-Z0-9\u0080-\uffff])*/);

  // \u2500\u2500 Quoted (Less \u00a73.3: structure `@{name}` interpolation inside a string) \u2500\u2500\u2500\u2500
  // The shared css `Quoted` is one flat `singleStr`/`doubleStr` leaf that swallows
  // any interior `@{\u2026}`. Less OVERRIDES it so the PARSER is the sole source of the
  // interpolation structure (P0 KEYSTONE): a string carrying a strict `@{name}`
  // token is emitted as interleaved leaves \u2014 quote/literal chunks + isolated
  // `lessInterp` leaves \u2014 that the value / import host consume with the SAME
  // `interpFromLeaves` seam the selector / custom-prop paths use, never a byte
  // re-scan. A plain string with no `@{\u2026}` backtracks to the flat leaf and is
  // BYTE-IDENTICAL to the css base (fast path: no children array is materialized).
  //
  // A chunk is any run up to a `"`/`'` or the next VALID `@{name}`; the `@(?!\u2026)`
  // negative-lookahead is the exact complement of `lessInterp`, so a `@` only ends
  // a chunk when it opens a strict `@{name}` \u2014 a bare `@name`, an escaped `\@{x}`
  // (`\\[\s\S]`), and a NON-interpolation false-start (`@{box-\u2026`, `@{ x }`, `@{a.b}`,
  // `@{}`) all stay INSIDE the chunk as literal text. This matches real Less 4.x /
  // the strict \u00a74.1 (owner-LOCKED) rule and finds a valid `@{name}` even after a
  // false-start (`"@{box-@{suffix}}"` \u2192 literal `@{box-`, ref `@{suffix}`, literal
  // `}`). Less has no nested interpolation, so `@{@{x}}` falls to the chunk verbatim.
  // The interpolated arm REQUIRES at least one `lessInterp`, so a string with none
  // fails it and falls to the flat `singleStr`/`doubleStr` leaf (byte-identical).
  const dqChunk = regex(/(?:[^"\\@]|\\[\s\S]|@(?!\{-?[_a-zA-Z0-9\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*(?:\[[-_a-zA-Z0-9@$\u0080-\uffff]+\])*\}))+/);
  const sqChunk = regex(/(?:[^'\\@]|\\[\s\S]|@(?!\{-?[_a-zA-Z0-9\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*(?:\[[-_a-zA-Z0-9@$\u0080-\uffff]+\])*\}))+/);
  // The interp-BODY seam (dialect-varying, owner note). In LESS the body is a
  // READ-ONLY value REFERENCE opened by `@{` \u2014 a name/var head + zero or more
  // `[key]` accessors (\u00a74.1 amendment; see `lessInterp`). `strInterp` IS
  // `lessInterp`, so the string-interp body agrees with every other `@{\u2026}` site.
  // Kept as its own const so a dialect that composes a DIFFERENT string-interp
  // body plugs it here WITHOUT rewriting the content-gobble loop below: SCSS/.jess
  // use `#{ <expression> }` (a full expression, opened by `#{`), and Less may later
  // add `${name}` property-interp. This override is LESS-SCOPED (the delta's
  // `Quoted` wins by name); SCSS composes on the CSS base, NOT on Less, so it never
  // inherits this Less body.
  //
  // TODO(\u00a74.1/interp-body-accessor-resolution): the GRAMMAR structures the widened
  // `@{head[key]}` body at every `@{\u2026}` site (byte-identical for `@{name}`), but the
  // legacy BuilderHost interp-reference builder (`createInterpolatedReference` /
  // `getInterpolatedOrString` in ./utils.ts) still captures the whole body as a FLAT
  // `Reference{ key: "head[key]" }` (a bogus variable NAME), so `@{head[key]}` does
  // not yet RESOLVE (it evaluates to an "undefined variable @head[key]" error, the
  // same as any unresolvable interp \u2014 no silent corruption). To resolve, that builder
  // must emit the SAME structured accessor `Reference{ key, target, options:index }`
  // the value-position `@head[key]` path (`_buildReference` + `refIndex`) already
  // builds, AND the ast/ bridge `replacementToValue` (packages/core/.../__tests__/
  // bridge.ts) must route an accessor `Reference` to `buildMapAccessor` (today it
  // only maps a flat `varRef`). Both live on the load-bearing legacy eval path.
  const strInterp = lessInterp;
  const Quoted = node('Quoted', choice(
    sequence(literal('"'), many(dqChunk), strInterp, many(choice(strInterp, dqChunk)), literal('"')),
    sequence(literal('\''), many(sqChunk), strInterp, many(choice(strInterp, sqChunk)), literal('\'')),
    singleStr,
    doubleStr,
  ));

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
    g.VarDeclaration, g.VarCall, g.QueryAtRuleBlock, g.SupportsAtRuleBlock, g.AtRuleBlock, g.ImportAtRuleStatement, g.AtRuleStatement, g.AtRuleMalformed, g.ExtendStatement, g.Ruleset, g.MixinOrQualifiedRule, g.EachFor,
    sequence(g.Call, optional(literal(';'))), literal(';')
  );
  const Stylesheet = node(
    many(g.stylesheetItem));

  // Plain helper consts referenced before their section must be defined up-front
  // (Phase-1 evaluation is sequential; only g.* refs resolve lazily).
  const important = sequence(literal('!'), literal('important'));

  // ── Less variable declaration / reference ───────────────────────────────────
  // A detached ruleset assigned to a variable: `@name: { … }`. The structured branch
  // parses the body as a declaration list (→ Mixin). If that fails — e.g. bootstrap's
  // `@escaped-characters: { <: %3c; … }`, whose keys (`<`, `>`, `(`, `)`) are not valid
  // property names — the raw fallback captures the balanced `{ … }` verbatim. Historical
  // Less treats such a block as a raw string (only re-parsed on interpolation); the
  // builder then produces a `Quoted` so `@plugin` functions (e.g. escape-svg) read it as
  // a string. The fallback is a plain balanced scan (no node wrapper); the builder
  // distinguishes it by the absence of structured child nodes.
  const rawDetachedBlock = sequence(literal('{'), noTrivia(scanTo(literal('}'), { skip: [bParen, bSquare, bCurly, singleStr, doubleStr] })), literal('}'));
  const detachedBlock = choice(
    sequence(literal('{'), g.declarationList, literal('}')),
    rawDetachedBlock
  );
  // Var-decl colon. Spaces around it are fine (`@x : y` is a declaration). It is
  // NOT a declaration only in the pseudo pattern `<space>:<word>` — the colon has a
  // space before AND clings to the following ident (e.g. `@page :first { … }` is an
  // at-rule prelude, not `@page: first`). So: colon adjacent to the name (noTrivia),
  // OR colon not immediately followed by an ident-start.
  const varColon = choice(
    noTrivia(sequence(lessVar, literal(':'))),
    sequence(lessVar, regex(/:(?![-_a-zA-Z-￿])/))
  );
  const VarDeclaration = node(
    sequence(varColon, choice(detachedBlock, sequence(g.valueList, optional(important), optional(literal(';'))))));
  const mixinArgsContent = scanTo(literal(')'), { skip: [bParen, bSquare, bCurly, singleStr, doubleStr] });
  // Accessor key tokens, in lookupOrCall's OR2 order: NestedReference ($@x / @@x),
  // AtKeyword (@x), PropertyReference ($x), InterpolatedIdent (…@{x}…), Ident.
  // The builder applies the index/variable typing + Quoted-wrap (see _buildReference).
  const nestedRef = regex(/(?:[@$]+(?:-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*)?){2,}/);
  const propRef = regex(/\$-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*/);
  const interpKey = regex(/(?:-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*|-)?[@$]\{-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*(?:\[[-_a-zA-Z0-9@$-￿]+\])*\}(?:[@$]\{-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*(?:\[[-_a-zA-Z0-9@$-￿]+\])*\}|[-_a-zA-Z0-9-￿])*/);
  // A purely-numeric name (`100:`) is a Less detached-ruleset map key, e.g.
  // `@grays: { 100: @gray-100; }` (Bootstrap). Not valid CSS, but Less accepts it
  // and `@grays[100]` reads it back; the whole-number alternative is tried first.
  const declPropName = regex(/[0-9]+|\*?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f])|[@$]\{[^}]*\})(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f])|[@$]\{[^}]*\})*/);
  const refKey = choice(nestedRef, lessVar, propRef, interpKey, ident);
  // One accessor: glued '[' / '(', trivia re-enabled inside the brackets/parens.
  const refIndex = sequence(literal('['), optional(refKey), literal(']'));
  const refCall = sequence(literal('('), optional(mixinArgsContent), literal(')'));
  // varReference + lookupOrCall: a @variable OR $property glued to a chain of
  // [accessor]/(call). `$color` is a bare property reference (read declaration
  // `color`); `@a[k]` is a variable + accessor chain. noTrivia() forbids trivia
  // (whitespace/comments) between the head and '[' / '(', keeping the chain
  // contiguous (production's noSep()). The builder types `$`-headed refs as
  // `property` and `@`-headed as `variable` (see _buildReference).
  // `nestedRef` (tried first) admits the indirect head `@@name` (a variable whose
  // NAME is another variable's value) as a value reference; `lessVar` cannot match
  // the doubled `@@`. A single `@x` / `$x` needs only one sigil group, so it falls
  // through to `lessVar` / `propRef` (nestedRef requires `{2,}`).
  const Reference = node(
    noTrivia(sequence(choice(nestedRef, lessVar, propRef), many(choice(refIndex, refCall)))));

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
  const VarCall = node(
    choice(
      // A var call is `@name(...)` with the `(` ADJACENT to the name (no space).
      // `@foo (bar)` — space before `(` — is never a var call; it's an unknown
      // at-rule prelude, so noTrivia makes this branch defer to AtRuleBlock.
      sequence(noTrivia(sequence(nonKnownAtVar, regex(/(?=\()/))), g.MixinArgs, optional(important), optional(literal(';'))),
      // Known at-rule name with EMPTY parens only.
      sequence(knownAtVar, literal('('), literal(')'), optional(important), optional(literal(';')))
    ));

  // ── Mixins ───────────────────────────────────────────────────────────────
  // Mixin arguments are composed from the SAME value combinators as function-call
  // args (`callArgSeq`) — NOT captured as raw text — so an arithmetic arg like
  // `@a * 2` is a real Operation, not a Reference whose key is the raw string. The
  // `MixinArgs` production lives next to `callArgSeq`/`callArgList` (below) so it can
  // reuse them directly. See `_buildMixinArgs` (which reuses the shared `_assembleArgs`).
  const mixinNamePath = sequence(basicSel, many(sequence(optional(combinator), basicSel)));
  // MixinCall names must start with . or # — plain idents are properties, not mixins.
  const mixinCallBasicSel = regex(/[.#]-?(?:[_a-zA-Z-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
  const mixinCallPath = sequence(g.mixinCallBasicSel, many(sequence(optional(combinator), basicSel)));
  const MixinCall = node(
    sequence(g.mixinCallPath, optional(g.MixinArgs), optional(important), optional(literal(';'))));
  // Anonymous mixin callback: `.(…){…}` OR `#(…){…}` — the Chevrotain
  // AnonMixinStart token is `/[.#]\(/`, so both prefixes are valid.
  const AnonymousMixinDefinition = node(
    sequence(regex(/[.#]/), g.MixinArgs, literal('{'), g.declarationList, literal('}')));
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
  const MixinOrQualifiedRule = node(
    choice(
      sequence(g.mixinNamePath, optional(g.MixinArgs), optional(g.Guard), literal('{'), g.declarationList, literal('}')),
      sequence(g.mixinCallPath, optional(g.MixinArgs), optional(g.Guard), optional(important), optional(literal(';')))
    ));

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
  // `NsAccessor` (`#ns.opts[key]`) is a valid guard operand — `when (#ns.opts[flag])`
  // / `when (#ns.opts[flag] = true)` — so it must parse as ONE operand (ordered
  // before Reference/Paren) rather than falling to the value-Paren, which would
  // swallow `= true` into a Sequence instead of a comparison.
  // `EscapedValue` (`~"…"`, `~(…)`) is a valid comparison operand — `when (~"a" = @s)`
  // — so it must parse as ONE operand (ordered before Quoted/anyValue), else the bare
  // `Quoted` alt fails on the leading `~` and `anyValue` swallows `~"…" = @s` into a
  // Sequence, dropping the comparison.
  const guardOperand = choice(g.NsAccessor, g.Reference, g.numeric, g.Color, g.NamedColor, g.EscapedValue, g.Quoted, g.Call, g.Paren, g.anyValue);
  const Comparison = node(
    sequence(g.Reference, compareOp, choice(g.Reference, g.numeric, g.Color, g.NamedColor, g.EscapedValue, g.Quoted, g.anyValue)));
  const GuardDefault = node(
    regex(/default(?:[ \t\n\r\f]*\([ \t\n\r\f]*\))?(?![-\w])/));
  // '(' guardOr ')' → Paren; or a bare default(). Wrapped in a Paren node.
  const GuardInParens = node(
    choice(
      g.GuardDefault,
      sequence(literal('('), g.GuardOr, literal(')'))
    ));
  // A single guard term: optional `not`, then either a parenthesized guard or a
  // bare comparison (`left <op> right`) / value.
  const GuardTerm = node(
    sequence(
      optional(regex(/not(?![-\w])/)),
      choice(
        g.GuardInParens,
        sequence(guardOperand, optional(sequence(compareOp, guardOperand)))
      )
    ));
  // 'and' chain of terms (left-associative).
  const GuardAnd = node(
    sequence(g.GuardTerm, many(sequence(regex(/and(?![-\w])/), g.GuardTerm))));
  // 'or' / ',' chain of and-expressions (left-associative).
  const GuardOr = node(
    sequence(g.GuardAnd, many(sequence(choice(regex(/or(?![-\w])/), literal(',')), g.GuardAnd))));
  const Guard = node(
    sequence(regex(/when(?![-\w])/), g.GuardOr));

  // ── Less ampersand / interpolated / extend ──────────────────────────────────
  // `&` (the parent reference) optionally glued to a SUFFIX (`&1`, `&-bar`), which
  // Less appends to the parent's trailing selector (`.rule` + `-bar` → `.rule-bar`).
  // A number/`-` suffix reads as a merge (elements can't start with those). A `.`/`#`
  // PREFIX is NOT part of the ampersand: `.foo-` is a complete, valid dash-ending class,
  // so `.foo-&` is a COMPOUND of the BasicSelector `.foo-` and a plain `&` — it parses
  // as `['.foo-', &]` (two independent simple selectors), never one merge node. The
  // `&(…)` form keeps its paren scan.
  const ampToken = regex(/&[-_a-zA-Z0-9-￿]*/);
  const LessAmpersand = node(
    sequence(ampToken, optional(sequence(literal('('), scanTo(literal(')'), { skip: [bParen, bSquare, bCurly, singleStr, doubleStr] }), literal(')')))));
  // Selector interpolation: an ident/`.`/`#` run interleaved with `@{…}`, with at
  // least one interpolation. Three dispatch heads so the compiled first-set routes
  // every leading form (a single sequence starting with two empty-matchable runs
  // never exposed `@` as a first token, so a bare/leading `@{…}` was unreachable):
  //   • `.`/`#`-prefixed   → `.a-@{n}`, `.@{n}`, `#id-@{x}`
  //   • ident-prefixed     → `div@{n}`, `a@{parent}` (interp right after a type sel)
  //   • bare interpolation → `@{parent}` (interp is the whole simple selector)
  const interpPart = choice(lessInterp, regex(/[-_a-zA-Z0-9]+/));
  const InterpolatedSelector = node(
    choice(
      sequence(regex(/[.#]/), many(regex(/[-_a-zA-Z0-9]+/)), lessInterp, many(interpPart)),
      sequence(oneOrMore(regex(/[-_a-zA-Z0-9]+/)), lessInterp, many(interpPart)),
      sequence(lessInterp, many(interpPart))
    ));

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
  // `InterpolatedSelector` (`.a-@{n}`, `@{p}`) and `basicSel` (`.btn`, `*`, `10%`)
  // share the `.`/`#`/ident leading char, so as two sibling arms they forced the
  // whole `simpleSelector` choice onto firstMatch. Nesting them into ONE ordered
  // sub-rule (interp first, unchanged order → byte-identical) lets the outer choice
  // see a single arm whose first-set is disjoint from `[` / `:` / `&`, so it
  // dispatches by first char. (The inner interp/basic order is preserved exactly.)
  const interpOrBasic = choice(g.InterpolatedSelector, basicSel);
  const simpleSelector = choice(g.AttributeSelector, g.PseudoSelector, g.LessAmpersand, g.interpOrBasic);
  // unwrap: a single simple selector (76% of compounds — `.btn`, `a`, `:hover`)
  // IS that token; skip the build+frame and pass the child straight through. The
  // builder's single-child path already returned the bare component, so this is
  // byte-identical — a 2+-simple / whitespace-descendant run still builds.
  const CompoundSelector = node(
    sequence(g.simpleSelector, many(sequence(not(selectorBoundary), g.simpleSelector))), undefined, { unwrap: true });
  // A complex selector, optionally terminated by a single `:extend(...)` pseudo.
  // Mirrors Chevrotain's `complexSelector`, which consumes extend (OPTION3) AFTER
  // the whole compound/combinator run — so extend is the LAST thing in the
  // selector, and `.a:extend(.b).c` leaves `.c` unconsumed → parse error
  // (extend-must-be-last). The compound run also stops at `:extend(` (extendAhead).
  // unwrap: single compound (no combinator, no extend) IS the compound.
  const ComplexSelector = node(
    sequence(optional(combinator), g.CompoundSelector, many(sequence(optional(combinator), not(selectorBoundary), g.CompoundSelector)), optional(g.ExtendPseudo)), undefined, { unwrap: true });
  // unwrap: single complex selector (no comma) IS that selector.
  const SelectorList = node(
    sequence(g.ComplexSelector, many(sequence(literal(','), g.ComplexSelector))), undefined, { unwrap: true });
  // Attribute name may carry a CSS namespace prefix (`ns|attr`, `*|attr`,
  // `|attr`). Less also allows interpolation in the name and value: `[@{n}=@{v}]`,
  // `[data=@{attr-data}]`. interpKey matches a run containing `@{…}`.
  // `|` is a namespace separator (`ns|attr`, `*|attr`, `|attr`) ONLY when not
  // followed by `=` — `[prop|="x"]` is the `|=` dash-match operator, not a namespace.
  const attrNsPrefix = optional(sequence(optional(choice(literal('*'), ident)), regex(/\|(?!=)/)));
  const AttributeSelector = node(
    sequence(literal('['), attrNsPrefix, choice(interpKey, ident), optional(sequence(attrOp, choice(singleStr, doubleStr, interpKey, ident), optional(attrMod))), literal(']')));
  // pseudoArg: content inside pseudo parens (used in ExtendStatement too).
  // PseudoSelector uses a two-branch outer choice so PEG backtracking works when
  // SelectorList succeeds internally but ')' doesn't follow (e.g. "!all" suffix).
  const pseudoArg = choice(nth, g.SelectorList, scanTo(literal(')'), { skip: [bParen, bSquare, bCurly, singleStr, doubleStr] }));
  const pseudoSelectorParens = choice(
    sequence(literal('('), choice(nth, g.SelectorList), literal(')')),
    sequence(literal('('), scanTo(literal(')'), { skip: [bParen, bSquare, bCurly, singleStr, doubleStr] }), literal(')'))
  );
  // `:extend(` tail (after the pseudo colon) — a `:extend(...)` is NOT a generic
  // pseudo (it routes through ExtendPseudo), so PseudoSelector rejects it. The
  // guard sits AFTER the non-nullable `pseudoColon` so this rule's first-set stays
  // `:` — a leading `not()` would union `any()` and force the `simpleSelector`
  // choice off its O(1) first-char dispatch onto firstMatch.
  const extendTailAhead = regex(/extend[ \t\n\r\f]*\(/);
  const PseudoSelector = node(
    sequence(pseudoColon, not(extendTailAhead), choice(interpKey, ident), optional(g.pseudoSelectorParens)));

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
    sequence(g.simpleSelector, many(sequence(not(selectorBoundary), not(extendFlagAhead), g.simpleSelector))));
  const extendComplex = node('ComplexSelector',
    sequence(optional(combinator), g.extendCompound, many(sequence(optional(combinator), not(whenAhead), not(extendFlagAhead), g.extendCompound))));
  // A single extend target: a complex selector + its optional flag.
  const ExtendTarget = node(
    sequence(g.extendComplex, optional(extendFlag)));
  // The comma-separated target list inside `extend( … )` (selectorList[inExtend]).
  const extendBody = sepBy(g.ExtendTarget, literal(','));
  // `:extend(` body `)` — the in-selector pseudo form (selectors.ts `extend`).
  const ExtendPseudo = node(
    sequence(pseudoColon, literal('extend'), literal('('), extendBody, expect(literal(')'), ')')));
  // `&:extend(...)` statement, terminated by `;` (selectors.ts `ampersandExtend`).
  // The leading `&` is REQUIRED: the reference's `ampersandExtend` does an
  // unconditional `$.CONSUME(T.Ampersand)`, so a bare `:extend(...)` is NOT a valid
  // standalone statement. Making `&` mandatory keeps `.a:extend(.b).c { … }` from
  // mis-splitting into `.a` (mixin call) + bare `:extend(.b)` + `.c { … }`; instead
  // the leftover `:extend(` after the `.a` mixin call is unconsumed input → one
  // parse error (faithful: extend must be the last thing in its selector).
  const ExtendStatement = node(
    sequence(g.LessAmpersand, g.ExtendPseudo, optional(literal(';'))));

  // ── Ruleset / declarations (Less-aware) ─────────────────────────────────────
  const Ruleset = node(
    sequence(g.SelectorList, optional(g.Guard), literal('{'), g.declarationList, expect(literal('}'), '}')));
  // A nested mixin DEFINITION inside a rule body: `.name(args) [guard] { … }`.
  // Strict — requires the `()` arg list AND a `{}` body, so it never matches a
  // plain declaration or a `.name { }` ruleset. (declarationList only had MixinCall,
  // which has no body, so nested definitions e.g. `.vars(){…}` were unmodelled.)
  const NestedMixinDefinition = node('MixinOrQualifiedRule',
    sequence(g.mixinCallPath, g.MixinArgs, optional(g.Guard), literal('{'), g.declarationList, literal('}')));
  // The per-statement choice for a `{ … }` body (ruleset body + at-rule body).
  // Exposed as a named rule so extending grammars (SCSS) can inject their own
  // block statements ahead of it — `many(choice(g.ScssIf, …, g.blockItem))`.
  // `NestedMixinDefinition` stays a local const referenced here (Less-only).
  const blockItem = choice(
    g.VarDeclaration, g.VarCall, g.QueryAtRuleBlock, g.SupportsAtRuleBlock, g.AtRuleBlock, g.ImportAtRuleStatement, g.AtRuleStatement, g.AtRuleMalformed, g.ExtendStatement, g.Ruleset, NestedMixinDefinition, g.EachFor, g.MixinCall, g.Declaration, g.CustomDeclaration,
    // A bare function-call statement in a body, e.g. `each(@list, { … });`. Needs
    // `ident(` so it never shadows a Declaration (which needs `:`).
    sequence(g.Call, optional(literal(';'))), literal(';')
  );
  const declarationList = many(g.blockItem);
  // Property name may itself be interpolated (`@{prop}: …`, `pre-@{x}-post: …`).
  // Chevrotain lexes the name as a single Ident/InterpolatedIdent token whose image
  // carries the `@{…}` runs; `declaration` then routes an image containing `@`/`$`
  // through getInterpolatedNode. We mirror that: try the interpolated-ident regex
  // first (it requires at least one `@{…}`), else a plain ident.
  //
  // Narrow deferred-value POC: an ordinary, plain-name declaration with exactly
  // one unsigned integer/dimension/percent token can retain that authored token
  // as a scalar instead of constructing the value-expression subtree. `noTrivia`
  // makes comments ineligible; the explicit whitespace is deliberately limited
  // to whitespace, and the terminal guard rejects every trailing value syntax.
  // This is an experimental Jess-native family, not a general raw-value grammar.
  const deferredNumericScalar = regex(/\d+(?:[a-zA-Z]+|%)?/);
  const DeferredScalarDeclaration = node('Declaration',
    noTrivia(sequence(
      ident,
      optional(ws),
      literal(':'),
      optional(ws),
      deferredNumericScalar,
      optional(ws),
      not(regex(/[^\s;}]/)),
      optional(literal(';'))
    ))
  );
  const Declaration = choice(
    DeferredScalarDeclaration,
    node('Declaration', sequence(declPropName, optional(choice(literal('+_'), literal('+'))), literal(':'), optional(g.valueList), optional(important), optional(literal(';'))))
  );
  // Kept as a composition seam for SCSS's custom-property override. Less no
  // longer selects this permissive value rule; its own CustomDeclaration uses
  // only the interpolation-only `cpValue` fallback below.
  const customValue = sequence(g.valueList, not(regex(/[^\s;}]/)));
  // Opportunistic structuring for a `{ … }` custom-property value: try it as a
  // real declaration body (so a `--foo: { color: @a; }` map-style block still
  // structures), tolerant of anything that isn't CSS-shaped. No `expect()` on the
  // closing `}` — a non-declaration body (arbitrary tokens) simply fails this alt
  // with no error recorded, and `choice` falls through to the raw-text cpValue
  // capture below.
  const customCurlyBlock = node('Block',
    sequence(literal('{'), g.declarationList, literal('}')));
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
  //
  // Owner rule (Less `--*` = interpolation-ONLY): the value is captured VERBATIM
  // here; the builder resolves ONLY `@{…}` interpolation within it. Bare `@var`
  // references and function calls stay LITERAL — the value is NOT parsed as a Less
  // value expression. This is why the structured `valueList` path is intentionally
  // absent: it would (wrongly) evaluate bare `@var`/calls and drop comments/spacing.
  // @see https://www.w3.org/TR/css-variables-1/#defining-variables
  const cpSingleStr = regex(/'(?:[^'\n\\]|\\.)*'/);
  const cpDoubleStr = regex(/"(?:[^"\n\\]|\\.)*"/);
  // Content runs include CSS escapes (`\'`, `\(`, `\;`): `\` + any non-newline is an
  // escaped code point (§4.3.7), so an escaped quote/bracket/semicolon is literal
  // content, NOT a string/bracket/terminator. A lone `/` (division) is content;
  // `/*` is left for the comment alt.
  const cpInnerContent = regex(/(?:\\[^\n]|[^(){}[\]'"\/\\])+|\/(?!\*)/);
  const cpOuterContent = regex(/(?:\\[^\n]|[^(){}[\];'"\/\\])+|\/(?!\*)/);
  // Tier-B: `lessInterp` is tried FIRST so a strict `@{name}` is isolated as its own
  // leaf the host consumes (owner rule: a custom-prop value resolves ONLY `@{…}`).
  // A bare `@var` or a non-strict `@{ base }`/`@{a.b}` falls through to the content
  // runs and stays LITERAL — `@` is still an ordinary content char, so the isolation
  // is additive (no content-regex boundary tweak, no over-structuring).
  const cpInner = many(choice(lessInterp, cpInnerContent, comment, g.cpParen, g.cpSquare, g.cpCurly, cpSingleStr, cpDoubleStr));
  const cpParen = sequence(literal('('), g.cpInner, expect(literal(')')));
  const cpSquare = sequence(literal('['), g.cpInner, expect(literal(']')));
  const cpCurly = sequence(literal('{'), g.cpInner, expect(literal('}')));
  const cpValue = noTrivia(many(choice(lessInterp, cpOuterContent, comment, g.cpParen, g.cpSquare, g.cpCurly, cpSingleStr, cpDoubleStr)));
  const CustomDeclaration = node(
    sequence(choice(customPropInterp, customProp), literal(':'),
      choice(g.customCurlyBlock, g.cpValue),
      optional(literal(';'))));
  const declaration = choice(g.VarDeclaration, g.CustomDeclaration, g.Declaration);

  // ── Values (Less: + Reference, NamedColor, EscapedValue) ────────────────────
  // A comma-separated value list, tolerating a single trailing comma (`a, b,`) as
  // Less 4.x does — its `value` parser breaks out of the comma loop when no
  // expression follows, silently dropping the dangling comma (the value builder's
  // empty-segment filter mirrors this, so the trailing comma adds no list item).
  const valueList = sequence(g.valueSequence, many(sequence(literal(','), g.valueSequence)), optional(literal(',')));
  // A space-separated value sequence: each item is a full top-level EXPRESSION
  // (topSum), so arithmetic folds into the grammar (`1 + 2` → one Operation) while
  // non-operator items stay a list (`1px 2px 3px`). topSum collapses to the bare
  // operand when there is no operator, so a plain list is byte-identical to before.
  const valueSequence = oneOrMore(g.topSum);
  // Interpolated value token (`@{colorVar}`, `pre-@{x}`). Chevrotain lexes this as
  // InterpolatedIdent and `processValueToken` runs it through getInterpolatedOrString
  // → Interpolated (role=ident). Ordered before Reference: `@{` cannot match lessVar,
  // and anyValueTok excludes `{`, so this is the only rule that accepts it.
  const InterpValue = node(
    interpKey);
  // A namespace INDEXED-accessor reference in value position: a `.`/`#` compound
  // selector-path head (`#ns.options`, `.mixin`) glued (noTrivia) to a `[accessor]`
  // and then any further `[accessor]`/`(call)` chain. This must parse as ONE value
  // operand BEFORE arithmetic folding — otherwise `#ns.options[val1] + 5px` splits
  // into the bare string `#ns.options` plus an Operation whose left operand is the
  // lone `[val1]` SquareParen, so the accessor never binds to the namespace path.
  // Ordered before Color/SquareParen/anyValue in `value`: a hex-color-shaped head
  // (`#DEF.colors[primary]`) would otherwise be eaten by Color as a bare `#DEF`,
  // stranding `.colors[primary]` as a separate single-segment accessor that loses
  // the `#DEF` namespace hop. NsAccessor requires a glued `[` (refIndex first), so a
  // plain color `#DEF` — no bracket — still falls through to Color unchanged.
  // Requiring the FIRST segment be
  // a `[` (not a `(`) keeps every call-headed form — `.mixin()`, `.mixin()[k]`,
  // `#ns.x(.a[])[k]`, chained `.a() > .b()` — on the existing GluedParen /
  // _tryParseNamespaceRef reassembly paths, which structure call args richly.
  // The builder (_buildNsAccessor) reuses the same mixin-ruleset assembly as the
  // declaration-value _assembleSegment path.
  const nsHead = regex(/(?<![>+~|][ \t]?)[.#]-?(?:[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*)(?:[.#]-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*)*/);
  const NsAccessor = node(
    noTrivia(sequence(nsHead, refIndex, many(choice(refIndex, refCall)))));
  // A CSS `unicode-range` token (`U+A5`, `U+0-7F`, `U+0???`, `U+??????`). Ordered
  // before Dimension/Num/anyValue so the whole `U+…` run is one verbatim value — a
  // bare `ident` would stop at the `+` and leave `+0???`/`0-7F` to be mis-folded as
  // arithmetic. @see https://drafts.csswg.org/css-syntax/#urange-syntax
  const UnicodeRange = node(
    regex(/[Uu]\+[0-9A-Fa-f?]{1,6}(?:-[0-9A-Fa-f]{1,6})?/));
  const value = choice(g.InterpValue, g.Reference, g.UnicodeRange, g.numeric, g.NsAccessor, g.Color, g.NamedColor, g.Url, g.FormatCall, g.Call, g.EscapedValue, g.SelectorCapture, g.GluedParen, g.Paren, g.SquareParen, g.Quoted, g.anyValue);
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
  const Negative = node(
    sequence(regex(/-(?![0-9.])/), g.value));
  const operand = choice(g.Negative, g.value);
  const mathProduct = node('Operation',
    sequence(operand, many(sequence(prodOp, operand))), undefined, { collapse: true });
  const mathSum = node('Operation',
    sequence(g.mathProduct, many(sequence(sumOp, g.mathProduct))), undefined, { collapse: true });
  // Top-level (declaration / space-list) variant of the same precedence grammar.
  // Identical shape, but built as `OperationTop`, whose slash-vs-list decision uses
  // the DECLARATION context: `/` divides only under `math: always` (default
  // `parens-division` keeps a top-level `/` a slash-List, e.g. `font: 12px/1.5`).
  // A math paren nested inside a top-level value still uses the `Operation` variant
  // (slash divides), since being in-parens turns division on.
  const topProduct = node('OperationTop',
    sequence(operand, many(sequence(prodOp, operand))), undefined, { collapse: true });
  const topSum = node('OperationTop',
    sequence(g.topProduct, many(sequence(sumOp, g.topProduct))), undefined, { collapse: true });
  // An escaped paren `~( … )` is a RAW list, not a math expression: it holds an
  // arbitrary space / comma / `;`-separated value sequence (`~(1 2 3)`, `~(1; 2)`),
  // so it uses the permissive body — unlike a bare `( … )`, which is one expression.
  const escapedParen = node('Paren', sequence(literal('('), g.permissiveParenBody));
  const EscapedValue = node(
    sequence(literal('~'), choice(escapedParen, g.Quoted)));
  const NamedColor = node(regex(/(?:lightgoldenrodyellow|mediumspringgreen|mediumaquamarine|mediumslateblue|mediumturquoise|mediumvioletred|blanchedalmond|cornflowerblue|darkolivegreen|lightslategray|lightslategrey|lightsteelblue|mediumseagreen|darkgoldenrod|darkslateblue|darkslategray|darkslategrey|darkturquoise|lavenderblush|lightseagreen|palegoldenrod|paleturquoise|palevioletred|rebeccapurple|antiquewhite|currentcolor|darkseagreen|lemonchiffon|lightskyblue|mediumorchid|mediumpurple|midnightblue|darkmagenta|deepskyblue|floralwhite|forestgreen|greenyellow|lightsalmon|lightyellow|navajowhite|saddlebrown|springgreen|transparent|yellowgreen|aquamarine|blueviolet|chartreuse|darkorange|darkorchid|darksalmon|darkviolet|dodgerblue|ghostwhite|lightcoral|lightgreen|mediumblue|papayawhip|powderblue|sandybrown|whitesmoke|aliceblue|burlywood|cadetblue|chocolate|darkgreen|darkkhaki|firebrick|gainsboro|goldenrod|indianred|lawngreen|lightblue|lightcyan|lightgray|lightgrey|lightpink|limegreen|mintcream|mistyrose|olivedrab|orangered|palegreen|peachpuff|rosybrown|royalblue|slateblue|slategray|slategrey|steelblue|turquoise|cornsilk|darkblue|darkcyan|darkgray|darkgrey|deeppink|honeydew|lavender|moccasin|seagreen|seashell|crimson|darkred|dimgray|dimgrey|fuchsia|hotpink|magenta|oldlace|skyblue|thistle|bisque|indigo|maroon|orange|orchid|purple|salmon|sienna|silver|tomato|violet|yellow|azure|beige|black|brown|coral|green|ivory|khaki|linen|olive|wheat|white|aqua|blue|cyan|gold|gray|grey|lime|navy|peru|pink|plum|snow|teal|red|tan)(?![-_a-zA-Z0-9(])/i));
  // `Dimension` / `Num` / the unified `numeric` leaf are inherited verbatim from
  // the shared CSS grammar (number + optional unit, contiguous via noTrivia).
  // `Num` and `Color` now come from the shared `numericRules` fragment, spread into
  // the return object below (identical to the CSS grammar's definitions).
  /** @todo(css-spec-parity): closing `)` is `literal(')')`, so an unquoted url with interior whitespace backtracks instead of committing to a <bad-url-token> error — port the `expect(literal(')'))` commit from css-parser c5ff7836e; see css-syntax-3 §4.3.6 (consume-a-url-token / bad-url). */
  // The quoted body routes through `g.Quoted` (not a flat `singleStr`/`doubleStr`)
  // so a `url("…@{x}…")` string carries the §3.3 interpolation structure the value
  // host resolves — a plain string still falls to Quoted's flat leaf (byte-identical).
  // A bare `url(@var)` body is a value `Reference`, spliced by the host without
  // unquoting (`url(@a)` with `@a: 'x'` → `url('x')`); the unquoted url-token body
  // (`urlInner`) is the last arm, so a plain `url(image.png)` is unchanged.
  const Url = node(parser({ trivia: urlWs }, sequence(urlOpen, optional(choice(g.Quoted, g.Reference, urlInner)), literal(')'))));
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
  const parenExpr = sequence(g.mathSum, optional(sequence(parenSep, g.mathSum)));
  // A paren whose content BEGINS with a `#`/`.` namespace selector is a
  // namespace-lookup reference (`(#ns.options[option])`, `(.mixin()[key])`), not an
  // arithmetic expression — its `[…]`/`(…)` accessor chain is captured as a value
  // sequence and the Paren builder reassembles it into a Reference/Call
  // (_tryParseNamespaceRef). The lookahead requires a selector START (`.`/`#` + a
  // name char), so `.5` (a number) and a bare `12 (13)` are NOT namespace refs and
  // stay strict expressions — the incoherent `12 (13)` still fails the `)`.
  const namespaceAhead = regex('(?=[.#]-?[_a-zA-Z\\u0080-\\uffff])');
  const parenItem = choice(sequence(namespaceAhead, g.valueSequence), parenExpr);
  const parenExprList = sequence(parenItem, many(sequence(literal(','), parenItem)));
  const parenBody = sequence(optional(sequence(g.parenExprList, many(sequence(literal(';'), optional(g.parenExprList))))), expect(literal(')')));
  // Permissive paren body (the pre-expression valueList form). Used ONLY by
  // GluedParen — a `(` glued (no space) to a preceding selector/accessor token,
  // i.e. mixin-reference ARGS (`.mixin1(@foo: bar)`, `#ns.x(.valToGet[])`), which
  // hold arbitrary named args / accessor chains, not arithmetic. A `(` with space
  // before it (or at value start) is a real value paren and takes the strict
  // single-expression `parenBody` above, so `(12 (13))` still errors.
  const permissiveParenBody = sequence(optional(sequence(g.valueList, many(sequence(literal(';'), optional(g.valueList))))), expect(literal(')')));
  // A bare detached ruleset `{ … }` in value / function-argument position → a Mixin.
  const DetachedRuleset = node(sequence(literal('{'), g.declarationList, literal('}')));
  // Function-call arguments are their OWN production (parity with the Chevrotain
  // functionCallArgs/callArgument rules), NOT `parenBody`: unlike a parenthesized
  // value, a function argument may be an anonymous mixin `.(…){…}` or a bare
  // detached ruleset `{…}` — e.g. `each(@list, { … })`, `func({a:1}, {b:2})`. The
  // comma phase takes value SEQUENCES (comma is the arg separator); after a `;` the
  // args become value LISTS (comma allowed within an arg).
  // Function-call args and mixin-call args share ONE set of arg productions, so an
  // arithmetic arg like `@a * 2` is a real Operation in both, and values are
  // assembled by the shared `_assembleArgs` builder (Keyword-ification + trivia — no
  // raw text, no manual trimming). Beyond values / anon-mixin / detached-ruleset,
  // the args admit the `@x: value` NAMED form and the `...` / `@x...` VARIADIC form.
  // Named args flow through function calls too (dispatch to a named-param function,
  // e.g. a Sass fn); the runtime rejects them if the target declares no names.
  // Ordered choice: `...`/`:` lookahead lets variadic/named win, else the value
  // combinator consumes the whole expression (so `@a * 2` is never truncated at
  // `@a`). A bare `@a` is a Reference (the CALL shape); the mixin-DEFINITION builder
  // reinterprets a lone `@name` as a param.
  const argRest = node('Rest', choice(sequence(lessVar, literal('...')), literal('...')));
  const argNamedSeq = node('NamedArg', sequence(lessVar, literal(':'), choice(DetachedRuleset, g.valueSequence)));
  // ── Name-independent condition arguments ─────────────────────────────────────
  // A top-level condition operator (`> < >= <= = and or not`) inside ANY call's
  // argument makes that argument a `Condition` — no name dispatch on `if`/`boolean`.
  // The condition operators layer ON TOP of the ordinary value production, so nesting
  // (`not(2 < 1)`, `true and isnumber(6)`) falls out of the grammar's own recursion:
  // the `(…)` value-Paren already parses an inner comparison (parenSep = compareOp),
  // and `and`/`or` split terms so a bare keyword never swallows the operator.
  //
  // The whole layer is GATED to only match when a real operator is present: each
  // `ArgCondition` alternative's distinguishing token past the operand is an operator
  // (leading `not`, a `compareOp`, or `and`/`or`), so a plain value / space-list arg
  // matches NONE and falls through to the unchanged `valueSequence` below — the
  // pre-existing arg is byte-identical, and mixin-DEFINITION params (never a top-level
  // condition) are unaffected.
  const notKw = regex(/not(?![-\w])/i);
  const andKw = regex(/and(?![-\w])/i);
  const orKw = regex(/or(?![-\w])/i);
  // A standalone top-level condition operator — used as a negative lookahead so the
  // bounded value operand stops before it instead of eating it as a keyword/anyValue.
  const condStopAhead = regex(/(?:>=|<=|=>|=<|=~|[<>=]|(?:and|or)(?![-\w]))/i);
  // A bounded value/space-list operand: a `valueSequence` that stops at a top-level
  // condition operator (so `@a > 5 and @b` splits into operands, not one space-list).
  const condOperand = oneOrMore(sequence(not(condStopAhead), g.topSum));
  // A PARENTHESIZED sub-condition operand: `( CondArgOr )`. Necessary because a `(`
  // glued to a preceding word (`not(…)`) takes the permissive mixin-arg Paren, whose
  // body is a raw value list — it would NOT parse the inner `2 > 1` as a comparison.
  // Parsing the paren body as a full `CondArgOr` restores the guard-grammar behaviour
  // (`not(2 > 1)`, `(@a > 0)`, `(true)`), built into a `Paren` wrapping the condition.
  const CondArgParen = node('GuardInParens',
    sequence(literal('('), g.CondArgOr, literal(')')));
  // A single-operand core: a parenthesized sub-condition OR a bounded value, with an
  // optional trailing `<op> right` comparison.
  const condCore = sequence(
    choice(g.CondArgParen, condOperand),
    optional(sequence(compareOp, choice(g.CondArgParen, condOperand))));
  // A single condition term: optional leading `not`, then the operand core. `not`
  // negates the term into a `Condition{negate}`; a bare comparison folds into
  // `Condition[left, op, right]`; a plain operand passes through.
  const CondArgTerm = node(
    sequence(optional(notKw), condCore));
  const CondArgAnd = node('CondArgAnd',
    sequence(g.CondArgTerm, many(sequence(andKw, g.CondArgTerm))));
  const CondArgOr = node('CondArgOr',
    sequence(g.CondArgAnd, many(sequence(orKw, g.CondArgAnd))));
  // An OPERATOR-BEARING term: a leading `not`, OR a comparison (`left <op> right`).
  // (A bare operand with no `not`/`compareOp` is NOT operator-bearing — that path is
  // reserved for the plain `valueSequence` arg.) Built via the same `CondArgTerm`
  // builder — the tag is shared, so `not`/comparison fold into a `Condition`.
  const CondArgTermOp = node('CondArgTerm',
    choice(
      sequence(notKw, condCore),
      sequence(choice(g.CondArgParen, condOperand), compareOp, choice(g.CondArgParen, condOperand))
    ));
  // An `and`-group that carries ≥1 operator: either its FIRST term is operator-bearing,
  // or it has an explicit `and`. Built via the shared `CondArgAnd` fold.
  const CondArgAndOp = node('CondArgAnd',
    choice(
      sequence(g.CondArgTermOp, many(sequence(andKw, g.CondArgTerm))),
      sequence(g.CondArgTerm, oneOrMore(sequence(andKw, g.CondArgTerm)))
    ));
  // GATE — `ArgCondition` matches ONLY an arg that carries a REAL top-level condition
  // operator (a `not`, a comparison, or an `and`/`or`); a plain value / space-list
  // matches NEITHER alternative and falls through to the unchanged `valueSequence`,
  // so ordinary args (and mixin-def params, never a top-level condition) build
  // byte-identically. No paren-aware lookahead scan: the operator requirement is
  // structural (`CondArgAndOp` / a mandatory `oneOrMore` `or`), and nesting
  // (`not(2 < 1)`, `true and isnumber(6)`) falls out of the grammar's own recursion —
  // the value-Paren parses its inner comparison; `and`/`or` split terms. Built as a
  // `CondArgOr` (shared fold): a leading op-bearing and-group, or a bare-headed `or`.
  // Fast pre-gate for the (speculative, build-heavy) ArgCondition attempt. Without
  // it, every plain value / space-list arg pays a full speculative ArgCondition
  // parse — `condOperand` builds a whole `topSum` node tree — only to fail at the
  // missing operator and re-parse as `valueSequence` (a double parse of every call
  // arg; ~25% of parse self-time on real fixtures). The gate is a NON-CONSUMING,
  // depth-aware lookahead: scan (skipping balanced brackets + strings, so a nested
  // `(@a > 5)` / `"a,b"` is opaque) to the FIRST depth-0 condition operator OR arg
  // terminator (`,` `;` `)`), then require an operator THERE. It succeeds iff a
  // top-level condition operator precedes the arg's end — exactly when ArgCondition
  // could match — so it never skips a real condition (no false negative); a stray
  // operator (e.g. inside an un-parenthesised value) only costs a harmless extra
  // attempt that falls through to `valueSequence`, byte-identically. `not(not(…))`
  // is a positive lookahead: it rolls back all scan side effects, consumes zero and —
  // unlike a bare `regex()` lookahead — pushes NO CST child, so placed as the first
  // element of the node's sequence it leaves `CondArgOr`'s built children unchanged.
  const condOpAhead = regex(/>=|<=|=>|=<|=~|[<>=]|(?<![-\w])(?:and|or|not)(?![-\w])/i);
  const condOrArgEnd = choice(condOpAhead, regex(/[,;)]/));
  const argHasCondAhead = not(not(sequence(
    scanTo(condOrArgEnd, { skip: [bParen, bSquare, bCurly, singleStr, doubleStr] }),
    condOpAhead)));
  const ArgCondition = node('CondArgOr',
    sequence(argHasCondAhead, choice(
      sequence(g.CondArgAndOp, many(sequence(orKw, g.CondArgAnd))),
      sequence(g.CondArgAnd, oneOrMore(sequence(orKw, g.CondArgAnd)))
    )));
  const callArgSeq = choice(argRest, argNamedSeq, g.AnonymousMixinDefinition, DetachedRuleset, ArgCondition, g.valueSequence);
  // Function-call args and mixin-call args are now IDENTICAL — one `argsInner`. After
  // a semicolon, commas keep splitting args (`sepBy(callArgSeq, ',')`), so both `.m(…)`
  // and `foo(…)` catch the one illegal case: mixing the comma and semicolon ARG
  // separators — i.e. two named params in a single semicolon-group (`@a: 1, @b: 2`) —
  // rather than mis-parsing it as one list-valued param. (This is only about the comma
  // vs semicolon argument separators; a `/` inside a value — `16px/1.5`, `1fr / 2fr` —
  // is a value-internal separator and is never involved.) Value assembly is identical
  // (`_assembleArgs` folds a comma run into a List). Named args + spreads flow through
  // FUNCTION calls too — a `.jess` extension; validity is a dialect concern
  // (Less-4-compat flags them; the runtime rejects a target that declares no names).
  const argsInner = optional(sequence(sepBy(callArgSeq, literal(',')), many(sequence(literal(';'), optional(sepBy(callArgSeq, literal(',')))))));
  const functionCallArgs = sequence(argsInner, literal(')'));
  const MixinArgs = node(sequence(literal('('), argsInner, literal(')')));
  // `calc(…)` follows the CSS math grammar, whose only operators are `+ - * /` — a
  // bare `%` operand (e.g. `calc(1 %)`) is a syntax error (Chevrotain: mathProduct
  // has no `%` alt, so the trailing `%` fails the closing `)`). We model calc as a
  // Call whose body excludes a standalone `%` token, so `1 %` leaves the `%`
  // unconsumed and the `)` fails → one parse error. A percentage glued to a number
  // (`100%`) is a Dimension and unaffected.
  // A calc-scoped catch-all leaf. Unlike an ordinary value token it must NOT be a
  // bare operator run: inside `calc(…)` the chars `+ - * /` (and `= < > | ~ ^`) are
  // ONLY operators (handled by `calcProdOp`/`sumOp`), never operands, so a lone
  // `+` / `*` is not a <calc-value> (css-values-4 §10). Excluding the operator
  // chars — and `%`, kept out so a standalone `%` stays unconsumed and errors at
  // the `)` — from the leaf keeps `calc(+)` / `calc(*)` from matching an operator
  // as a value; they now fail the required <calc-value> and error. Non-operator
  // keyword operands (`pi`, `e`, `infinity`) still match via `ident`, so valid
  // calc is unchanged. Mirrors css-parser 7627722c2 (operator-excluding calc leaf).
  const calcAnyTok = regex(/[^\s;{}\[\]()'",!%+\-*\/=<>|~^]+/);
  const calcAnyValue = choice(ident, calcAnyTok);
  const calcValue = choice(g.InterpValue, g.Reference, g.numeric, g.Color, g.NamedColor, g.Url, g.Call, g.EscapedValue, g.Paren, g.SquareParen, g.Quoted, calcAnyValue);
  // calc math grammar (port of mathSum/mathProduct): operators are ONLY `+ - * /` —
  // NO `%` (a standalone `%` stays unconsumed → the `)` fails → syntax error, per
  // CSS calc). `/` always divides here (calc is a math context), built as
  // `Operation`. Precedence + collapse identical to the value-position rules.
  const calcProdOp = regex(/[*\/]/);
  const calcProduct = node('Operation',
    sequence(calcValue, many(sequence(calcProdOp, calcValue))), undefined, { collapse: true });
  const calcSum = node('Operation',
    sequence(calcProduct, many(sequence(sumOp, calcProduct))), undefined, { collapse: true });
  const calcSequence = oneOrMore(calcSum);
  const calcList = sequence(calcSequence, many(sequence(literal(','), calcSequence)));
  // A `calc(…)` body is a <calc-sum>, which REQUIRES ≥1 <calc-value> (css-values-4
  // §10): an empty `calc()` produces no value, so the leading `calcList` is
  // `expect`ed rather than `optional`. Without this the calc arm would fail and
  // backtrack into the generic `Call` arm, which silently accepts `calc()` as an
  // ordinary function call; `expect` commits the `calc(` open and reports the
  // missing value in place. Well-formed calc is unchanged (`calcList` matches and
  // `expect` passes straight through). The trailing `; calcList` groups stay
  // optional. Mirrors css-parser 7627722c2 (`expect(mathSum, 'calc value')`).
  const calcBody = sequence(expect(calcList, 'calc value'), many(sequence(literal(';'), optional(calcList))), expect(literal(')')));
  // `calc(…)` OR a generic function call as ONE node, so a generic call no longer
  // pays a separate `calc(` node frame ahead of it in the value choice. The calc arm
  // (its body is the folded math grammar) is tried first so `calc(` routes to math;
  // any other ident takes the generic call-args tail. Built identically to the old
  // inherited `CalcCall` / `Call` (same `Call` node type + children per arm). The
  // plain value-position `Paren` still comes from the shared fragment (g.parenBody).
  // A function call requires the `(` GLUED to the name — no trivia between. The SPACE
  // before `(` is the discriminator (Less 4.x): `name(expr)` (no space) is a CSS
  // function SHAPE, kept verbatim (`solid(#a8000b)` → `solid(#a8000b)`); `name (expr)`
  // (space) is a keyword followed by a GROUPED math expression whose grouping parens
  // dissolve on evaluation (`1px solid (@bg*.66 + @black*.33)` → `1px solid #a8000b`,
  // like `(2px + 3px)` → `5px`). The `calc` arm's `(?=\()` lookahead already asserts
  // this glue; the generic arm wraps `ident '('` in `noTrivia` so the `(` must sit
  // immediately after the name (args after the `(` keep normal trivia via
  // `functionCallArgs`), so `name (…)` falls through to the value `Paren` instead.
  const Call = node(choice(
    sequence(regex(/calc(?=\()/i), literal('('), g.calcBody),
    sequence(noTrivia(sequence(ident, literal('('))), functionCallArgs)
  ));
  // A bare value paren `( … )`. Defined locally (not inherited from CSS) so the `(`→body
  // trivia uses Less `rw`, which skips `//` line comments — CSS `rw` does not, so a `//`
  // right after `(` (e.g. `(@a * // c\n @b)`) would otherwise not be consumed as trivia.
  const Paren = node(sequence(literal('('), g.parenBody));
  // Mixin-argument paren: `(` immediately preceded (lookbehind, no trivia) by a
  // selector / accessor char — the args of a `.name(…)` / `#ns.x(…)` reference.
  // Parsed permissively; the Declaration builder reassembles the selector +
  // round-paren-args + square-paren-accessor items into a Reference/Call chain.
  // A trailing `-` counts ONLY when it terminates an identifier (`.my-mixin-(…)`),
  // never a standalone unary minus — `-(@a / 2)` is a Negative around a math Paren,
  // so its `(` must fall through to the strict `g.Paren` (slash divides in-parens).
  const GluedParen = node('Paren', sequence(regex('(?<=[)\\]\\w.#\\u0080-\\uffff]|[\\w.#\\u0080-\\uffff]-)\\('), g.permissiveParenBody));
  const squareParenBody = sequence(optional(g.valueList), literal(']'));
  const SquareParen = node(sequence(literal('['), g.squareParenBody));
  // Selector-list CAPTURE `*[ <selector-list> ]` — a Less value that captures a
  // comma-separated selector list for later interpolation into a selector
  // (`@classes: *[.a, .b, .c]; @{classes} { … }`). The `*[` sigil is GLUED
  // (noTrivia) so a bare universal `*` (multiply / selector) and a plain
  // `[attr]`-shaped SquareParen value stay on their existing paths; only the
  // contiguous `*[` opens a capture. The body reuses the selector-grammar
  // `SelectorList` so the branch split is parser-owned (never a byte re-scan).
  const SelectorCapture = node(
    sequence(regex(/\*\[/), g.SelectorList, expect(literal(']'), ']')));
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
    sequence(
      regex(/each(?![-\w])/i), literal('('), functionCallArgs, optional(literal(';'))
    ));

  // ── Logical / conditional functions (Less) ──────────────────────────────────
  // `if(cond, then[, else])` and `boolean(cond)` are NOT name-dispatched in the
  // grammar: they are ordinary function `Call`s whose condition argument parses
  // through the name-independent `ArgCondition` layer (a top-level `> < >= <= = and
  // or not` in ANY call's argument becomes a `Condition`). Eval already registers
  // `if`/`boolean` as ordinary functions that consume the parsed condition — so this
  // is a parse-only unification: `if`/`boolean`/`#ns.if`/`.if`/`foo` all route through
  // one `Call` production. The `and`/`or`/`not`/comparison sub-grammar the `when`
  // guard uses (GuardOr) is unchanged; only the value-position call dispatch merged.

  // ── Deprecated Less `%()` string-format function ─────────────────────────────
  // `%(format, args…)` is printf-style formatting. We LOWER it at build time into a
  // `Quoted(Interpolated)` — the canonical string-interpolation node — with a
  // deprecation warning (see `_buildFormatCall`). The `%(?=\()` lookahead matches
  // ONLY when the `(` follows immediately, so the bare `%` mod operator (`10 % 3`,
  // parsed by `prodOp`) is UNAFFECTED. Ordered before the generic `Call` in `value`.
  const FormatCall = node(
    sequence(regex(/%(?=\()/), literal('('), functionCallArgs));

  // ── At-rules ───────────────────────────────────────────────────────────────
  // Generic at-rule prelude (`@keyframes @name`, `@page :first`, `@layer a.b`,
  // `@unknown foo 42`), structured into value tokens so the tree2 host consumes
  // leaves instead of re-tokenizing the prelude bytes with regex (Tier-B). The
  // Less value tokens — `@{interp}`, `@@indirect`, `@var` — are isolated as their
  // own leaves; everything else (idents, `:`, whitespace, and balanced `()`/`[]`
  // groups + strings, which may themselves contain `{`/`;`) is a literal chunk.
  // `noTrivia` keeps internal whitespace inside the chunk bytes (the old opaque
  // `scanTo` leaf included it), so a multi-token prelude round-trips verbatim.
  //
  // Isolating `@{…}` as a real `lessInterp` leaf also FIXES the early-termination
  // bug: the old `scanTo` sentinel matched the `{` of `@{n}` before the (dead)
  // `bCurly` skip could run, so `@keyframes @{n} {` cut the prelude at the
  // interpolation's brace. A token run consumes `@{n}` whole and runs on to the
  // real block `{` (validated against Less 4.x — this is a deliberate correction,
  // not a byte-preserving pass). `@media`/`@container`/`@supports` are unaffected
  // (structured `QueryAtRuleBlock`); this generic prelude serves the block/
  // statement at-rules that misparsed before.
  // A literal chunk stops before a Less value token (`@{`/`@@`/`@name`), a
  // terminator (`{`/`;`), or a bracket/string opener; a bare `@` not introducing a
  // token (`@ `, `@)`) stays literal content.
  const preludeChunk = regex(/(?:[^@{};()[\]'"]|@(?![{@\-_a-zA-Z0-9-￿]))+/);
  // Balanced `()`/`[]` groups are STRUCTURED (recursive `preludeToken`), not opaque
  // scans, so a Less value token inside a group — `@media (min-width: @bp)` — stays
  // an isolated `@var`/`@{…}` leaf the host consumes, and nested groups nest by
  // recursion. Strings stay opaque leaves (`@{…}` inside a string is string
  // interpolation, a separate Tier-B shape). The `{`/`;` terminators are never
  // consumed here — a `{` ends the prelude at the block opener.
  // A `(`/`[` must open a BALANCED group (plain `literal(')')`, no recovery): an
  // unclosed `@unknown url( {` leaves the `(` unconsumed, so the prelude ends before
  // it and the block `{` never matches — the at-rule fails and the malformed input
  // is rejected, exactly as the old opaque scan did (a `<bad-token>` parse error).
  const preludeToken = choice(lessInterp, nestedRef, lessVar, preludeChunk, g.preludeParen, g.preludeSquare, singleStr, doubleStr);
  const preludeParen = sequence(literal('('), many(g.preludeToken), literal(')'));
  const preludeSquare = sequence(literal('['), many(g.preludeToken), literal(']'));
  // TOP-LEVEL token set: `preludeToken` MINUS the bare `@var` (`lessVar`) and
  // `@@indirect`/multi-ref (`nestedRef`) forms, so a top-level bare variable stops
  // the prelude → hard error. `@{…}` interpolation, chunks, balanced groups (whose
  // inner `@var` stays valid), and strings remain. v5 STRICT: a top-level bare
  // `@variable`/`@@indirect` is a HARD parse error (generalizes the @supports
  // precedent b799d9a49; 4.x only warned) — the committed `AtRuleMalformed` fallback
  // reports it. A `@var` INSIDE `(…)`/`[…]` stays a valid declaration value via the
  // recursive `preludeToken` (even inside an unknown at-rule's `(x: @v)`).
  const preludeTokenTop = choice(lessInterp, preludeChunk, g.preludeParen, g.preludeSquare, singleStr, doubleStr);
  const atPrelude = optional(noTrivia(oneOrMore(preludeTokenTop)));
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
  // The condition sub-grammar (QueryFeature / QueryInParens / QueryCondition) is
  // inherited from CSS verbatim. `queryPrelude` is overridden locally (below) so a
  // comma-separated list may carry bare <media-type> items alongside conditions.
  // Only this block wrapper differs (Less commits its opening brace via `expect`),
  // so it stays here and reads `g.queryPrelude`.
  //
  // ── Media-query list (CSS Media Queries L4 <media-query-list>) ────────────────
  // The inherited CSS `queryPrelude` models a @supports/@container-flavoured list
  // whose every comma item is a parenthesised / `not`-led <media-condition>. It
  // rejects a bare <media-type> (`all`, `print`, `screen`) as a list item, so a
  // prelude whose FIRST item parses structurally but whose tail is a bare type —
  // `@media ((color) and (hover)), all`, `@media (min-width: 100px), print` —
  // hard-errors at the committed `{`: the first item is consumed, the `, all` tail
  // is not, and the structured rule has already passed the point where it could
  // backtrack to the (bracket-swallowing) generic AtRuleBlock. Per the L4 grammar a
  // <media-query> list item is EITHER a <media-condition> OR
  //   [ not | only ]? <media-type> [ and <media-condition-without-or> ]?
  // so each comma-list position also admits the media-type form. The emitted AST is
  // unaffected: the Less QueryAtRuleBlock builder reconstructs the prelude from
  // SOURCE TEXT (identical to the generic AtRuleBlock path — both converge on
  // `_buildAtRulePrelude`), so the grammar only has to CONSUME a well-formed prelude
  // and reach the commit point; no stray/unbalanced bracket is ever swallowed (the
  // media-type form's `and` sub-conditions are balanced `QueryInParens`).
  // @see https://www.w3.org/TR/mediaqueries-5/#media-query-list
  // A <media-type> is an <ident> other than the query keywords (`not only and or`,
  // plus `layer` — reserved). Mirrors the CSS `containerName` exclusion set.
  const mediaType = regex(/(?!(?:not|only|and|or|layer)(?![-\w]))-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*/i);
  const containerName = mediaType;
  // `[ not | only ]? <media-type> [ and <media-in-parens> ]*`.
  const mediaTypeQuery = sequence(
    optional(regex(/(?:not|only)(?![-\w])/i)),
    mediaType,
    many(sequence(regex(/and(?![-\w])/i), g.QueryInParens)));
  const mediaQueryItem = choice(g.QueryCondition, mediaTypeQuery);
  const queryPrelude = sequence(
    optional(containerName), g.QueryCondition, many(sequence(literal(','), mediaQueryItem)));
  // `@supports` stays in the STRUCTURED query block for well-formed parenthesized /
  // `not` conditions (so a stray/unbalanced bracket is still rejected, not
  // swallowed). Its stricter opener rule is enforced by the dedicated
  // `SupportsAtRuleBlock` fallback below, which catches the leftovers this
  // structured shape can't parse.
  const queryAtKeyword = regex(/@(?:media|container|supports)(?![-\w])/i);
  const QueryAtRuleBlock = node(
    sequence(queryAtKeyword, g.queryPrelude, expect(literal('{'), '{'), g.atRuleBody, expect(literal('}'), '}')));

  // ── Strict `@supports` prelude (v5 .less) ────────────────────────────────────
  // `@supports`'s prelude is a `<supports-condition>` (css-conditional-3 §2), which
  // — unlike a `@media`/`@container` query — has NO bare form. It must OPEN with
  // `(` (parenthesized), the `not` keyword, a `<function-token>` (an ident glued to
  // `(`, e.g. `selector(…)` / `<general-enclosed>`), OR — the Less addition — a
  // `@{…}` interpolation (the migration target: an interpolated condition is
  // allowed where a bare `@var` is not). A bare CSS ident (`@supports color {}`) or
  // a bare variable reference (`@supports @cond {}`) is INVALID. v5 .less makes this
  // a HARD PARSE ERROR — stricter by design than Less 4.x, which only deprecates the
  // bare form with a warning (4.x `feat: deprecate bare @variable in non-value
  // at-rule positions`). Well-formed parenthesized/`not` conditions are already
  // taken by the structured `QueryAtRuleBlock` above; this required-condition
  // fallback exists so the leftovers that reach it (a bare ident, a bare `@var`, or
  // — now VALID — a `@{…}` interpolation opener) either commit or report the missing
  // condition, instead of being swallowed by the permissive generic `AtRuleBlock`.
  // A zero-width lookahead asserts the opener without consuming, so the shared
  // `atPrelude` scan still owns the walk to `{`; on failure `expect` recovers in
  // place and the scan continues, so the block still parses (one error, no cascade).
  // Ordered AFTER `QueryAtRuleBlock` and BEFORE the generic `AtRuleBlock` in the
  // statement choice, so `@supports` never falls through to the permissive arm.
  // @see https://www.w3.org/TR/css-conditional-3/#at-supports
  const supportsAtKeyword = regex(/@supports(?![-\w])/i);
  const supportsCondAhead = regex(/(?=\(|not(?![-\w])|@\{|-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*\()/i);
  // After the committed opener lookahead, the condition uses the SAME leaf-split
  // prelude as the generic `atPrelude` (`preludeTokenTop`): `(…)`/`not`/function-token
  // conditions become chunk + balanced-group leaves, and a `@{…}` interpolation is an
  // isolated `lessInterp` leaf — so the tree2 host RESOLVES `@supports @{cond}`
  // (a bare `@cond`/ident is already rejected by the opener lookahead, and this token
  // run stops at the block `{` rather than colliding with a `@{…}` interpolation brace).
  const supportsPreludeScan = optional(noTrivia(oneOrMore(preludeTokenTop)));
  const reqSupportsPrelude = sequence(expect(supportsCondAhead, 'supports condition'), supportsPreludeScan);
  const SupportsAtRuleBlock = node('AtRuleBlock',
    sequence(supportsAtKeyword, reqSupportsPrelude, expect(literal('{'), '{'), g.atRuleBody, expect(literal('}'), '}')));

  // Generic block at-rule. `atPrelude` (the strict atom sequence above) stops before
  // a top-level bare `@var`, so `literal('{')` is reached only for a well-formed
  // prelude (bare ident, `@{…}` interpolation, parenthesized/bracketed groups,
  // strings). A prelude that stopped at a bare `@var` fails `literal('{')` here (and
  // `literal(';')` in AtRuleStatement), and the committed `AtRuleMalformed` fallback
  // reports it. `literal('{')` (not `expect`) stays non-committing so a statement-
  // form at-rule (`@foo bar;`) can fall through to AtRuleStatement.
  const AtRuleBlock = node(
    sequence(atKeyword, atPrelude, literal('{'), g.atRuleBody, expect(literal('}'), '}')));

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
    sequence(
      importKeyword, optional(importOptionsParen),
      expect(choice(g.Url, g.Quoted), 'import path'),
      optional(importMedia), expect(literal(';'))
    ));

  const AtRuleStatement = node(
    sequence(atKeyword, atPrelude, literal(';')));

  // ── Strict generic at-rule fallback (v5 .less) ──────────────────────────────
  // A generic at-rule whose strict `atPrelude` stopped BEFORE a top-level bare
  // `@var` / `@@var` (or other junk) that neither the block `{` nor the statement
  // `;` tail can consume — `@keyframes @v {}`, `@layer @v {}`, `@namespace @@v "u";`,
  // `@charset @v;`, unknown `@foo @v {}`, custom `@-blah @v {}`, `@layer a.@v.c;`.
  // Ordered AFTER AtRuleBlock / AtRuleStatement so it only ever catches the
  // leftovers those well-formed tails could not. A zero-width lookahead asserts the
  // required `{`/`;` tail; on a bare `@var` it fails, so the committed `expect`
  // records ONE legible error AT that position (not the keyword) and recovers in
  // place. The trailing `scanTo` then consumes the rest of the malformed prelude up
  // to the real block/statement tail, and the tail itself, so `many` resumes cleanly
  // (one error, no cascade) — the same recover-and-consume shape as
  // `SupportsAtRuleBlock`. Built as `AtRuleBlock` (a doomed branch's emitted node is
  // moot — the parse already carries the error). v5 makes the bare form a HARD parse
  // error; 4.x only deprecated it with a warning.
  const atTailAhead = regex(/(?=[{;])/);
  const AtRuleMalformed = node('AtRuleBlock',
    sequence(
      atKeyword, atPrelude,
      expect(atTailAhead, 'at-rule block or ;'),
      scanTo(choice(literal('{'), literal(';')), { skip: [bParen, bSquare, bCurly, lessInterp, singleStr, doubleStr] }),
      choice(sequence(literal('{'), g.atRuleBody, expect(literal('}'), '}')), literal(';'))
    ));

  // An at-rule body (@media / @supports / @starting-style / …) holds the SAME
  // statements as a ruleset body — nested rules, mixin calls, each(), extends,
  // var calls — not just declarations. Mirror declarationList's choice set.
  // Same statement set as a ruleset body (shares `blockItem`).
  const atRuleBody = many(g.blockItem);

  return {
    rw,
    stylesheetItem, blockItem,
    Stylesheet, VarDeclaration, VarCall, Reference, MixinArgs, mixinNamePath, mixinCallBasicSel, mixinCallPath, MixinCall,
    AnonymousMixinDefinition, MixinOrQualifiedRule, Comparison, GuardDefault, GuardInParens, GuardTerm, GuardAnd, GuardOr, Guard,
    CondArgParen, CondArgTerm, CondArgAnd, CondArgOr, CondArgTermOp, CondArgAndOp, ArgCondition,
    LessAmpersand, InterpolatedSelector, interpOrBasic, ExtendStatement, ExtendPseudo, ExtendTarget, extendCompound, extendComplex, simpleSelector,
    CompoundSelector, ComplexSelector, SelectorList, AttributeSelector, PseudoSelector, pseudoArg, pseudoSelectorParens,
    Ruleset, declarationList, Declaration, customValue, customCurlyBlock, cpInner, cpParen, cpSquare, cpCurly, cpValue, CustomDeclaration, declaration,
    valueList, valueSequence, value, UnicodeRange, Negative, mathProduct, mathSum, topProduct, topSum, parenExprList, InterpValue, NsAccessor, EscapedValue, NamedColor, Url, Quoted,
    parenBody, permissiveParenBody, Paren, GluedParen, DetachedRuleset, functionCallArgs, squareParenBody, calcBody, Call, FormatCall, SquareParen, SelectorCapture, anyValue, EachFor,
    queryPrelude, QueryAtRuleBlock, SupportsAtRuleBlock, ImportAtRuleStatement,
    preludeToken, preludeParen, preludeSquare,
    AtRuleBlock, AtRuleStatement, AtRuleMalformed, atRuleBody,
    // Exposed so composing dialects (SCSS) can re-derive `simpleSelector` with a
    // gated `&` arm without duplicating these token regexes. Non-behavioral.
    basicSel, extendAhead
  };
})]);
