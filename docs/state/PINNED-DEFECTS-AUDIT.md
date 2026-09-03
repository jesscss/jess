# Pinned-defect audit

Snapshot of every `PINNED DEFECT` test in the repo, one row per distinct
defect. A pinned defect asserts the CURRENT, WRONG behaviour with a reason so
that a fix fails loudly; the pin is then flipped to the correct expectation
(convention: `packages/syntax/css/css-parser/test/css-superset-constructs.test.ts`
header, `docs/architecture/core/DESIGN-DECISIONS.md` G22).

Source: `grep -rIi "pinned defect" packages scripts test --exclude-dir=node_modules`
at `a0b1e66ba` (origin/dev, 2026-09-03). Every pin was re-run on that tree
(see "Pin status"); every "current output" below is quoted from the test body
or its reason comment, not inferred.

## Summary

| Severity | Meaning | Count |
| --- | --- | --- |
| HIGH | wrong CSS reaches the user silently (parses, emits the wrong thing) | 3 |
| HIGH-R | valid CSS (or valid dialect syntax) is REJECTED — loud, but the user cannot compile the file | 21 |
| MEDIUM | only comment placement / spans / trivia metadata are wrong; emitted rules are right | 8 |
| LOW | internal shape, diagnostic text, or a settled by-design divergence | 6 |

38 rows; 118 grep hits collapse to 38 because the same defect is pinned once
per dialect and once per assertion style (parse / CST / render).

Unowned (no row in `DESIGN-DECISIONS.md` or `OWNER-REQUIREMENTS.md` names the
construct): **22** of 38. The 16 owned rows are the trivia/comment family
(G25, G26, G28, G29), G30, P2, P11, P18, and the `byte-identity.divergences.json`
entries, two of which already say "needs an owner ruling".
`OWNER-REQUIREMENTS.md` names none of the constructs.

Pins that now FAIL because the defect was fixed (pins to flip): **0**. All
pins reproduce on `a0b1e66ba`. One pin was already flipped in-tree
(`less-parser/test/operator-adjacency.test.ts:81`, calc comment forms, G25)
and is no longer a pin.

### Top 5 for the owner (HIGH first, then open rulings that change emitted bytes)

1. **D16 — SCSS `*color: red` drops the property name.** AST is
   `name: "*"`, value `red`; `color` is discarded, the parse "succeeds".
   Unowned. `scss-parser/test/discovered-constructs.test.ts:92`.
2. **D19 — Jess `a/*c*/.b` is parsed as the DESCENDANT `a .b`.** Different
   elements match. Byte-identical to the source, so nothing sees it. G26 is
   OPEN ("owner has not ruled; do not change behaviour").
   `jess-parser/test/discovered-constructs.test.ts:112`,
   `packages/jess/test/jess/selector-comment-adjacency.test.ts:51`.
3. **D25 — Less `1px/**/-2px` / `1px-/**/2px` emitted as a two-item list
   where lessc folds to `-1px`.** Unowned (G24/G25 cover the mechanism, not
   this input). `packages/jess/test/less/operator-comment-boundary.test.ts:110`.
4. **D36 — `12px/1.5` emits as `12px / 1.5`** (font/grid shorthands in
   ordinary CSS). Two SETTLED rules collide; the json entry itself says "needs
   an owner ruling". `css-parser/test/byte-identity.divergences.json` (open).
5. **D14 — Jess rejects `a { b: (c) }`**, a plain CSS simple block that
   css/less/scss accept. P18 is OPEN on exactly where the `.jess` CSS-superset
   guarantee stops. `jess-parser/test/discovered-constructs.test.ts:55`.

Next after those: the rest of the HIGH-R group where Jess alone rejects
plain CSS — `:has(> .b)` (D20), `@page :first` (D6), `url(a\ b.png)` (D8),
`@layer a, b.c` (D1) — each is a stylesheet that compiles in css/less/scss
and fails in `.jess`.

## Reporter noise

The strings scroll by because the root `vitest.config.ts:285` sets
`reporters: [['tree', { summary: true }]]`, which every package suite
inherits (none overrides it). In a TTY the tree reporter prints every test
title, so each pinned case prints its full `PINNED DEFECT — …` title on every
run. In a non-TTY run (log file, CI) only the per-file lines print, which is
why the release logs captured for this audit contain zero occurrences. The
release preflight runs three of the suites that carry pins: `jess-parser`
(directly), `less-parser` and `css-parser` (inside `verify:baseline`). The
`scss-parser` suite and the three `packages/jess/test` pins are not in the
preflight. The titles are the convention working as designed ("grep `PINNED
DEFECT` for the set"); if the scroll is unwanted, the lever is the reporter
(`--reporter=dot` or `basic` for release runs), not the tests.

## Rows

Columns: **Dialects** = where the pin asserts the wrong behaviour.
**Pin status** = result of running the pin on `a0b1e66ba`: `holds` means the
wrong behaviour still reproduces (the pin passes); `FIXED` would mean the
pin fails and must be flipped. **Owner record** cites the DESIGN-DECISIONS row
or says `unowned`.

### A. Valid CSS rejected by some dialect (spec-derived corpus, `test/css-superset-corpus.ts`)

Pinned through `<dialect>-parser/test/css-superset-constructs.test.ts:58`
(`PINNED DEFECT — rejects %s`) for each dialect in `brokenIn`.

| Id | Defect | Pin | Dialects | Input → current → correct | Sev | Pin status | Owner record | Fix direction |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D1 | `@layer` dotted sub-layer name | corpus:157-165 | jess | `@layer a, b.c;` → parse error (consumes nothing) → one layer name `b.c` (css-cascade-5 §6.1 `<ident> ["." <ident>]*`) | HIGH-R | holds | unowned | Jess `@layer` prelude reads `.c` as a class/mixin; give the prelude a `<layer-name>` production before the selector reading |
| D2 | `@container` parenthesised condition group | corpus:203-212 | css, jess | `@container ((width > 1px) and (height > 1px)) {…}` → parse error → accepted (css-contain-3 §3 `<boolean-expr>`); less and scss accept it | HIGH-R | holds | unowned (SEMANTIC-INVARIANTS §4 states the one-way rule) | add the `( <boolean-expr> )` group to the css container prelude; jess inherits |
| D3 | `@container style()` | corpus:214-218 | jess | `@container style(--x: 1) {…}` → parse error → accepted (§3.3 `<style-query>`) | HIGH-R | holds | unowned | needs investigation (css/less/scss accept; jess overrides the prelude) |
| D4 | `@container` parenthesised `style()` | corpus:221-228 | css, less, jess | `@container (style(--x: 1)) {…}` → parse error → accepted; only scss accepts | HIGH-R | holds | unowned | same root as D2 |
| D5 | `@property` unterminated last descriptor | corpus:298-305 | jess | `@property --x { syntax: "*"; inherits: true }` → parse error → accepted (css-syntax-3 §5.4.4 final `;` optional); adding `;` parses | HIGH-R | holds | P11 (`;` is a separator, never required) makes this a ruled violation | make the jess `@property` body use the shared declaration-list separator rule |
| D6 | `@page` pseudo-page selector | corpus:313-327 | jess | `@page :first {…}`, `@page wide:left {…}` → parse error (consumes nothing) → accepted (css-page-3 §3); `@page wide {…}` parses | HIGH-R | holds | unowned | needs investigation (jess prelude has no `<pseudo-page>` arm) |
| D7 | `var()` empty fallback | corpus:559-566 | scss | `a { color: var(--x,) }` → parse error → accepted (css-variables-1 §3 `<declaration-value>?`) | HIGH-R | holds | unowned | scss `var()` argument arm requires a non-empty fallback; allow empty |
| D8 | `url()` escapes | corpus:604-618 | jess | `url(a\ b.png)`, `url(a\)b.png)` → parse error → accepted (css-syntax-3 §4.3.6 url-token escapes) | HIGH-R | holds | unowned | jess unquoted-url token does not admit escapes; reuse the css url-token |
| D9 | `!important` with interior comment | corpus:686-693 | scss | `red !/*x*/important` → parse error → accepted (§5.4.4 comments where whitespace is allowed); spaced form parses in all four | HIGH-R | holds | G29 (scss trivia table omits block comments) | declare `blockComment` in the scss trivia table (G29 prerequisite: G28-style statement-boundary comment carry) |
| D10 | CDO/CDC at top level | corpus:701-709 | css, less, scss, jess | `<!-- a { color: red } -->` → parse error in all four → accepted (css-syntax-3 §5.4.1 ignores `<!--`/`-->` at top level) | HIGH-R | holds | unowned | add top-level CDO/CDC skip to the css base; the three supersets inherit |

### B. Constructs discovered outside the suites (`<dialect>-parser/test/discovered-constructs.test.ts`)

| Id | Defect | Pin | Dialects | Input → current → correct | Sev | Pin status | Owner record | Fix direction |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D11 | Unbalanced `]` inside a custom property | css:183, less:146, scss:145, jess:156 | all four | `a{--x: foo(] bar}` → parse error → declaration keeps the token stream (css-syntax-3 §5.4.8: stray `]` is a consumed, non-fatal parse error) | HIGH-R | holds | P2 (custom-property values are a permissive arbitrary token stream) — this input violates the ruled shape | the custom-property value production balances brackets; make a stray closer a consumed token |
| D12 | Attribute-flag spacing divergence | less:110 (Less keeps `[href="x" i]`); css side pinned as normal expectation in css `discovered-constructs.test.ts`; `css-parser/test/byte-identity.divergences.json` "open" | less vs css/scss/jess | `a[href="x" i]` → Less emits `[href="x" i]`, css/scss/jess emit `[href="x"i]` → ONE spelling in all four (which one is the ruling) | MEDIUM | holds | the json entry records it as needing an owner ruling; unruled | owner picks: byte-identity (keep authored space) or canonicalise; then align the other side |
| D13 | Functional media-query prelude | less:182 | less | `@media foo(bar) {…}` → parse error → accepted (css, scss, jess accept) | HIGH-R | holds | unowned | Less media-query prelude override lacks the `<general-enclosed>` function form the css base has |
| D14 | Bare parenthesised component value | jess:55 | jess | `a { b: (c) }`, `( c )`, `(1 + 2)` → parse error → accepted (css-syntax-3 §5.4.7 simple block); css/less/scss accept the tight form | HIGH-R | holds | P18 OPEN (where the CSS-superset guarantee stops in `.jess`) | needs the P18 ruling; test comment says `$(…)` does not license rejecting the plain paren block |
| D15 | Less/Jess reject Sass module forms | less:206 (`ns.fn()`, `ns.$var`, `map.get($m,k)`, `color.mix(red,blue)`, `ns.$v: value;`), jess:249 (`ns.fn()`, `ns.$var`, `f($x: 1)`, `f($x...)`) | less, jess | Sass-only syntax → parse error → parse error is "arguably right"; pinned as leakage guards for whatever admits them in scss | LOW | holds | unowned (deliberate guard, not a defect claim) | none; flip only if a ruling admits these in Less/Jess |
| D16 | SCSS star-hack property name lost | scss:92 | scss | `a{*color:red}` → `Declaration{name:"*", value:red}` (`color` discarded, parse succeeds) → `name:"*color"` as Less produces | HIGH | holds | unowned | scss property-name production takes `*` as the whole name; extend it to `*` + ident like Less |
| D17 | SCSS error class for garbage after a comment | scss:149 | scss | `/* c */ !!!` → "Unexpected SCSS input after a complete stylesheet." at offset 8 → "Unexpected SCSS syntax." (css/less/jess) | LOW | holds | unowned | the leading comment is parsed as a `Comment` rule node, so "a stylesheet was parsed"; resolved by G29 (comment as trivia) |
| D18 | SCSS `ns.$v: value;` and `f($x...)` rejected | scss:205, scss:230 | scss | namespaced variable assignment and spread argument → parse error → accepted (valid Sass) | HIGH-R | holds | unowned | `ns.fn()`/`ns.$var`/`f($x: 1)` were admitted in-tree; the assignment-target and spread arms are still missing |
| D19 | Comment splits a compound selector | jess:112 (AST `a .b`), `packages/jess/test/jess/selector-comment-adjacency.test.ts:51` (`.e/*y*/.f` renders `.e .f`); scss:120, scss `operator-adjacency.test.ts:168`, scss `selector-span-trivia.test.ts:100` (rejects) | jess (wrong CSS), scss (rejects) | `a/*c*/.b{c:d}` → jess: descendant `a .b`; scss: parse error → compound `a.b` (css-syntax-3 §4; css and less already give `a.b`) | HIGH (jess), HIGH-R (scss) | holds | **G26 OPEN** — "owner has not ruled; do not change behaviour" | jess: comment must not manufacture a descendant combinator; scss: G29 |
| D20 | Leading combinator in a relative selector | jess:134 | jess | `a:has(> .b){c:d}`, `a:has(+ .b)` → parse error → accepted (selectors-4 §4.2); css/less/scss accept | HIGH-R | holds | P29 covers nested leading combinators, not `:has()` arguments; unowned here | jess `:has()` argument uses the non-relative selector list; use the relative one |
| D21 | SCSS comment not trivia in at-rule preludes | scss:250 | scss | `@at-root /**/ {}`, `@for $i from /**/ 1 through 10 {}`, `@forward "o" with ($a: /**/ b)` → parse error → accepted | HIGH-R | holds | G29 | declare `blockComment` in scss trivia (G29) |
| D22 | Jess escaped interpolated string loses escape and quotes | jess:215 | jess | `~"x$(1 + 1)y"` → bare `Interpolation`, no quote parts, no `escaped` → one `Quoted{escaped:true}` whose value admits interpolation | MEDIUM (model; the pin asserts the tree, not the emitted bytes) | holds | unowned | AST model change: `Quoted.value` admits an `Interpolation` (test comment) |
| D23 | SCSS comment before a value-list comma | scss:279 | scss | `a { b: c /* z */, d }` → parse error → two-item list `c, d` (css/less/jess parse it) | HIGH-R | holds | G29 | same as D21 |
| D24 | SCSS `&` in value position | scss:387 | scss | `a { b: & }`, `#{&} { c: d }` → parse error → accepted (Sass evaluates `&` to the parent selector) | HIGH-R | holds | unowned — test says "needs a model decision, not a grammar arm" | model decision: a node for `&`-as-value |
| D24a | SCSS `@-…` compiler namespace unrouted | scss:461 | scss | `@-use "x";`, `@-compose`, `@-export`, `@-import`, `@-from` → "Unexpected SCSS syntax." (excluded from opaque, no production) → routed to the typed productions jess-parser already has | HIGH-R (for `.scss` users of the compiler namespace) | holds | **G30** (ten unparseable at-rules; the five `@-…` names are the remainder after `@while`/`@debug`/`@warn`/`@error`/`@content` were routed) | add the five productions; G30 says opaque capture is NOT the fix |

### C. Operator adjacency (`<dialect>-parser/test/operator-adjacency.test.ts`, `packages/jess/test/less/operator-comment-boundary.test.ts`)

| Id | Defect | Pin | Dialects | Input → current → correct | Sev | Pin status | Owner record | Fix direction |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D25 | Less one-sided comment pad not folded | `packages/jess/test/less/operator-comment-boundary.test.ts:110` | less | `.a { width: 1px/**/-2px; }`, `1px-/**/2px` → emitted unchanged as a list → `-1px` (lessc folds) | HIGH | holds | G24 (adjacency, not lookahead) names the mechanism; the input itself is unruled | glued arms use `(?![0-9.])` lookahead which sees `/`; assert operand adjacency via `notAdjacent()` (test comment) |
| D26 | Comment around a `calc()` sum rejected | css:69 (3 forms), jess:90 (3 forms), scss:92 (right side only; left accepted at scss:88) | css, jess, scss | `calc(1px/**/-/**/2px)` etc. → parse error → accept, emit `calc(1px - 2px)`, WARN | HIGH-R | holds | **G25 SETTLED** (accept + normalise + warn); Less side already flipped (`less-parser/test/operator-adjacency.test.ts:81`) | css/jess: sum pad names the dialect trivia table instead of hand-spelling whitespace (what fixed Less); scss: G29 first |
| D27 | SCSS comment-glued sum rejected | scss:79 | scss | `a { b: 1px/**/-/**/2px }` → parse error → `-1px` (dart-sass) | HIGH-R | holds | G29 lists it as a symptom | G29 |

### D. Spans and comment placement (`*-span-trivia.test.ts`, `packages/jess/test/less/block-interior-comment.test.ts`, `variant-matrix*.ts`)

| Id | Defect | Pin | Dialects | Input → current → correct | Sev | Pin status | Owner record | Fix direction |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D28 | Comment inside selector text dropped | css `declaration-span-trivia.test.ts:103`, css `selector-span-trivia.test.ts:93`, jess `declaration-span-trivia.test.ts:126`, jess `selector-span-trivia.test.ts:93` | css, jess | `s0/*test*/,/*test*/s1{p:v}` → `s0,\ns1 {…}` (comments gone) → Less keeps them | MEDIUM | holds | unowned (test: "selector TERM's provenance") | selector terms need spans so the replay can place the run |
| D29 | Comment inside an at-rule body dropped | css `selector-span-trivia.test.ts:84`, jess `selector-span-trivia.test.ts:84`, jess `body-span-trivia.test.ts:102` | css, jess | `@media test { a {…} /* inner */ b {…} }` → `/* inner */` dropped (not misplaced) → emitted in place (scss keeps it, `scss selector-span-trivia.test.ts:87`) | MEDIUM | holds | G28 (nested emitter now replays block-interior comments) covers rulesets; at-rule bodies unowned | `emitAtRuleBody` replays only before a spanned statement and has no closing flush (test comment) |
| D30 | Body comment before a nested ruleset dropped / misplaced | jess `body-span-trivia.test.ts:92` (dropped); `packages/jess/test/less/block-interior-comment.test.ts:120` (Less, nested-emitter, moved AFTER the nested block when it is unterminated) | jess, less | `.a { /* outer */ .b {…} }` → jess drops it; less emits `a { b: c; .n { d: e; } /* z */ }` → comment before `.n` | MEDIUM | holds | G28 records the Less half; jess unowned | Less grammar tags a ruleset `withSourceSpan` only when terminated (`;`); give unterminated nested rulesets a statement span |
| D31 | Jess drops a trailing document comment | jess `body-span-trivia.test.ts:114` | jess | `.a { color: red; }\n/* trail */\n` → `/* trail */` dropped → kept (css/less/scss keep it) | MEDIUM | holds | unowned | Jess root span stops at the last statement; extend it to cover trailing trivia |
| D32 | Root-span convention split 2-2 | `scss-parser/test/variant-matrix.test.ts:44` (`ROOT_SPAN_END = length - 1`); `variant-matrix-cells.ts:117` in all four (comment); `scss-parser/test/body-span-trivia.test.ts:119` (scss captures no document trivia) | css/less (whole doc), scss (doc minus final newline), jess (last statement) | root `span.end` differs per dialect for the same bytes → one convention | LOW (metadata; D31 is its user-visible half) | holds | unowned | pick "root span covers the whole document" (css/less) and align scss and jess |
| D33 | SCSS document trivia never captured | `scss-parser/test/body-span-trivia.test.ts:119` | scss | `/* lead */\n.a {…}\n/* trail */\n` → `commentRuns() === []` (comments reach output only as `Comment` RULE NODES) → captured as trivia like css/less | LOW (output currently right through the workaround) | holds | **G29** — "the single most load-bearing fact for the trivia-model change" | G29; do not delete the `g.Comment` arms before this is fixed |
| D34 | SCSS `@if` body has no body span | `scss-parser/test/body-span-trivia.test.ts:134` | scss | `@if true { .a {…} }` → `bodySpanOf(node) === undefined` → a span | LOW | holds | unowned | `IfBody` reduces to a bare `Statement[]`; add a body-span-carrying fact (test comment) |
| D35 | SCSS inline trailing comment lifted to its own line | `scss-parser/test/declaration-span-trivia.test.ts:116` | scss | `.a { p: v /* c */; }` → `p: v;\n  /* c */` → `p: v /* c */;` (css/less) | MEDIUM | holds | G29 | G29 (the `Comment` rule node is a statement) |

### E. `css-parser/test/byte-identity.divergences.json`

| Id | Defect | Pin | Dialects | Input → current → correct | Sev | Pin status | Owner record | Fix direction |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D36 | Authored slash separator spaced | `byte-identity.divergences.json` "open": `value-slash-separator.css` | css (and, per the json, "for real stylesheets") | `12px/1.5`, `1/2`, `16/9` → `12px / 1.5`, `1 / 2`, `16 / 9` → unruled: "preserve unoperated values verbatim" vs "operators and separators are spaced" collide | MEDIUM (valid CSS, different bytes) | holds | json says "Needs an owner ruling"; both colliding rules are SETTLED | owner ruling on which rule governs an unoperated authored `/` |
| D37 | Attribute-flag spacing | json "open": `selector-attribute-case-flag.css` | see D12 | see D12 | MEDIUM | holds | see D12 | see D12 |
| D38 | Empty-block elision | json "settled": `empty-blocks.css` | all | `.empty {}` / `@media screen {}` → dropped → by design (TREE2-DESIGN-SPEC invariant #4) | LOW (not a defect) | holds | SETTLED (cited in the json) | none |

## Counting notes

- D12 and D37 are one defect recorded in two places; counted once.
- HIGH (3): D16, D19 (jess half), D25.
- HIGH-R (21): D1–D11, D13, D14, D18, D20, D21, D23, D24, D24a, D26, D27.
  D19's scss half is folded into D19.
- MEDIUM (8): D12, D22, D28, D29, D30, D31, D35, D36.
- LOW (6): D15, D17, D32, D33, D34, D38 (D38 is by design).
- Unowned (22): D1, D2, D3, D4, D6, D7, D8, D10, D13, D15, D16, D17, D18,
  D20, D22, D24, D25, D28, D29, D31, D32, D34.
