# Parser dialect architecture + error-coverage program

Owner-directed program (2026-07-17). Canonical sequencing/tracking doc for the
css/less/scss/jess parser dialect-architecture re-base and the cross-parser
error-coverage burn-down. Update this doc as items land; do not duplicate its
status elsewhere.

## Problem (why this exists)

1. **Dialects sibling-inherit.** `scss = compose([lessGrammar, …])` +
   `class ScssGrammar extends LessGrammar` (`scss-parser/src/grammar.ts:34`,
   `builders.ts:126`). SCSS and Less are siblings over CSS — SCSS must NOT inherit
   Less. This leaks the entire Less surface into SCSS and caused a concrete bug:
   Less's builder dispatch (`less-parser/src/builders.ts:129`) hard-routes
   `'QueryAtRuleBlock'` to `_buildLessQueryAtRuleBlock`, which SCSS never overrides,
   so `scss builders.ts:1148 _buildQueryAtRuleBlock` is DEAD CODE (Less builds
   SCSS's `@media`). Symptom already fixed once via a workaround node name
   (`ScssQueryInterpBlock`, commit 1d160dae1).

2. **"Green" has been hiding wrong-accepts.** SCSS passed its suite while silently
   accepting Less-isms and with unreachable rules. Each parser has the same class
   of holes. Reference implementations are authoritative: dart-sass (sass-spec) for
   SCSS, less.js for Less.

3. **The inversion BLOCKS cleanups in Less, not just in SCSS** — added 2026-07-25,
   verified by building it. Because `scssGrammar = compose([lessGrammar, …])`,
   `lessGrammar` may not itself become a non-final carried piece: composing the shared
   recognition map into the Less CST (`compose([cssGrammar, lessAstSyntax, rules(…)])`
   — the shape scss-parser's own CST already uses) compiles fine in less-parser, but
   scss-parser then reports `compose(): argument 0 isn't a build-resolvable grammar`
   and **degrades to the runtime interpreter, which emits a different tree**
   ([`PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md`](./PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md)
   §1). So the Less CST cannot reach the shared recognition surface at all while the
   inversion stands.

   First concrete casualty: the Less CST keeps a 150-name copy of the CSS named-colour
   list (`less-parser/src/grammar.ts`, `TODO(parseman-compose-depth)`) that the Less
   **AST** grammar already gets from the shared rule. The copy is not a design choice
   and not merely redundant — it is also **wrong**: it admits `currentcolor`, which the
   shared rule correctly excludes (owner ruling 2026-07-25 — not computable, so not a
   named colour). Deleting it is a fix, and the re-base is what unblocks it.

   **This makes the re-base load-bearing rather than cosmetic.** Expect more of this
   class: any CSS-recognition duplicate in the Less CST is stuck for the same reason.
   Unblocked by EITHER Phase 3 or a parseman that resolves deeper compose chains.

## Target architecture (owner: shared macro-compiled base, NO sibling inheritance)

- `cssGrammar` (unchanged): CSS tokenizer regexes, plain CSS selectors, CSS
  at-rules, CSS value grammar, nesting, calc. Common to all four.
- NEW `preprocessorBase = compose([cssGrammar, preprocDelta])`: sigil-NEUTRAL
  preprocessor machinery — ampersand-suffix selector concat, value-arithmetic
  parameterized by a math-mode hook, bracketed lists, a GENERIC interpolation seam
  (dialect fills `@{}` vs `#{}`), custom-prop-with-interpolation, and named override
  seams (`stylesheetItem`, `blockItem`, `interpolation`, `variableRef`).
- `less  = compose([preprocessorBase, lessSigilDelta])` — `@var`, `@{}`, `~"…"`,
  `.mixin()`, guards, `@import (options)`.
- `scss  = compose([preprocessorBase, scssSigilDelta])` — `$var`, `#{}`,
  `@mixin/@include/@function`, `@if/@each/@for/@while`, `@use/@forward`, `@extend %`.
- `jess  = compose([preprocessorBase, jessSigilDelta])`.
- INVARIANT: no dialect composes on another; what is Less-sigil-specific stays in
  `lessSigilDelta` and never reaches SCSS.

**Builder-dispatch fix:** replace the `buildNode` switch-over-inheritance (css/less/
scss) with a name-keyed builder MAP merged base⊕delta (last-wins). INVARIANT:
builder key ≡ grammar rule name, 1:1 — no private renamed builder
(`_buildLessQueryAtRuleBlock`) may shadow a rule name. This makes override-by-name
total and removes the sibling/ancestor interception class.

## Work items (the full discovered program)

Priority order; [dep] = sequencing dependency.

### Phase 0 — mechanical, conflict-free, do first
- **W1 Builder-map dispatch.** Convert the three `buildNode` switches (css/less/scss)
  to name-keyed maps merged in host construction. Byte-identical; fixes the dead-
  override trap; de-risks everything after. Coordinate with the at-rule-prelude
  sessions — their `_buildLessQueryAtRuleBlock`/`_buildQueryAtRuleBlock` workaround
  may become unnecessary once the map lands.

### Phase 1 — SCSS correctness (highest-value; reference-invisible)
- **W2 SCSS Less-construct leak (6 items).** SCSS wrongly accepts every non-`@` Less
  construct — reject: `.mixin()` calls, `when()` guards, detached rulesets `@dr:{}`,
  `+:` merge, `#ns[]` namespace lookup, and numeric-ident selectors (`1a{}`). These
  are INVISIBLE to the dart-sass reference (sass-spec has no Less fixtures) → need
  dedicated reject tests. Structurally killed by the re-base (W5), but can/should be
  gated sooner. [note: `@`-form Less-isms leaking is BY DESIGN per the permissive
  unknown-at-rule owner decision — not a bug.]
- **W3 SCSS branch-skew regression.** The audit (run on `feat/mixin-recursion`) found
  `issue_1355` regressed + 8 no-prelude hardening assertions failing
  (`@mixin`/`@include`/`@if`/`@while`/`@for`/`@return` with no prelude). VERIFY these
  against `origin/dev` first (audit base was stale) before acting.

### Phase 2 — shared-base validations (build ONCE, cascade to all four) [dep: W1, prelude sessions]
- **W4 ~98 CSS-level validations** (from the sass-spec 187 categorization): media-query
  logic/range operators (~38+9), calc/math-fn arg syntax (~25), selector validation
  numeric-ident/trailing-combinator (~17), `@supports` operator syntax, empty
  list/map value grammar. Build in `preprocessorBase`/`cssGrammar` so css+less+scss+
  jess inherit at once. Also closes the equivalent Less gaps + the shared `bad-url`.

### Phase 3 — the re-base [dep: in-flight prelude sessions must land first]
- **W5 Factor `preprocessorBase`** out of the Less delta (move sigil-neutral rules;
  re-express `less = compose([preprocessorBase, lessSigilDelta])`; prove less suite
  byte-identical).
- **W6 Re-point SCSS** to `compose([preprocessorBase, scssSigilDelta])` +
  host = cssBuilders⊕preprocBuilders⊕scssBuilders. Drop SCSS refs to Less seams
  (`g.stylesheetItem`/`g.blockItem`/`g.EscapedValue`/`g.Guard`/`g.GluedParen`/
  `g.AnonymousMixinDefinition`/`g.DetachedRuleset`). Dropping `stylesheetItem`/
  `blockItem` removes ~80% of the W2 leaks structurally.
- **W7 Fill SCSS gaps** exposed by removing the Less fallback — SCSS's own selector
  stack (shared ampersand + `#{}` interp + `%` placeholder), arithmetic (shared math
  grammar + SCSS `/`-deprecation math-mode), custom-prop values, named colors. Each
  is now a POSITIVE addition, not an inherited leak. Highest risk: math-mode
  divergence (SCSS `/`-deprecation vs Less parens-division).

### Phase 4 — SCSS SassScript-specific validations (~89) [dep: W6]
- **W8** Validate `@if`/`@else`/`@while` condition expressions (~31), `@use`/`@forward`
  member/url/`with`/`as` preludes (~18), mixin/fn param + arglist splat/trailing-comma
  (~12), `@debug`/`@warn`/`@error`/`@extend`/`@import` no-arg (~7), tokenizer/lexical
  (unterminated loud comment, escape too-high, unicode-range, map key) (~6).

### Phase 5 — Less + CSS + JESS tail
- **W9 Less** — promote the 4 known wrong-accepts out of `error-parsing.test.ts`
  skip-list: `parens-error-1/2/3` (juxtaposed parens `(12 (13+5))`) and
  `mixins-guards-cond-expected` (bare-value guard condition). Deepen the less.js
  harness with the W4 CSS-level fixtures (Less shares those gaps).
- **W10 CSS** — port the bad-url `expect(')')` fix to less/scss Url (the deferred
  `@todo` at `less grammar.ts:604`; blocked by Less `url(~"…")` — needs a Less-aware
  variant that accepts the escaped-string form while rejecting interior whitespace).
  Add at-rule-ordering rejection tests (`@charset` not-first, `@import` after rule) —
  low priority, matches less.js.
- **W11 JESS** — deferred per trailing-parser policy; mirror CSS strictness when it
  graduates.

### Cross-cutting test infrastructure
- **W12 Cross-dialect leakage suite.** Add per-parser reject tests (the leakage
  matrix: scss rejects Less-isms, less rejects Scss-isms, etc.). No bundled reference
  covers this — it's the exact gap that let W2 hide behind green tests.
- **W13 sass-spec-errors harness on mainline.** The `sass-spec-errors.test.ts`
  harness (187 `XFAIL_PARSE_MISSES`, symmetric-diff regression guard) is the biggest
  ready SCSS inventory. Confirm it is current on `origin/dev` (it IS present;
  the audit's "off-branch" note was branch skew from running on
  `feat/mixin-recursion`) and drive `XFAIL_PARSE_MISSES` toward zero as W4/W8 land.

## References (reuse, don't hand-roll)
- **dart-sass** — `sass-spec` dep; harness `packages/scss-parser/test/sass-spec-errors.test.ts`;
  187 parse-time misses categorized ~98 CSS-level + ~89 SassScript-specific.
- **less.js** — `packages/less-parser/test/error-parsing.test.ts` globs
  `/Users/matthew/git/worktrees/less.js/less-4x/packages/test-data/tests-error/parse/`
  (29 parse fixtures, 21 enforced, 4 genuine wrong-accepts skipped). READ-ONLY.
- CSS/JESS — spec-driven (css-syntax-3 etc.); no bundled reference.

## Sequencing / conflict map
- **W1** now (independent). **W2/W3** can proceed in parallel with prelude work
  (scss-focused, different rules) — VERIFY W3 vs origin/dev first.
- **W5/W6/W7 (the re-base) MUST wait** for the two in-flight prelude sessions to
  land — they edit `less grammar.ts` `QueryAtRuleBlock`/`atPrelude`/`AtRuleBlock`/
  `queryPrelude`, the exact rules the re-base moves into `preprocessorBase`.
  Factoring before they finish = hard merge conflicts. Re-base consumes their FINAL
  shape.
- **W4** (shared-base validations) ideally after W5 so it lands in `preprocessorBase`;
  interim CSS-level fixes can land in `cssGrammar` and migrate.
- In-flight sessions: at-rule prelude restructure (task_3bd93f77), bare-`@var`-in-
  at-rule-prelude review (task_724c20d1).

## Landed this session (baseline on origin/dev)
- CSS: numeric-slot + Category-B error coverage (14→51 fixtures); Category-A
  tightenings bad-url/calc/@supports (`c5ff7836e`/`7627722c2`/`726124397`); spec-exact
  `urlInner` + escape (`102bb4c9f`/`5250b736b`); builders regex thinning (`4966ea0ad`).
- Dialect `@todo(css-spec-parity)` flags (`ff8177892`).
- less/scss: urlInner + escape + calc (`b7509626a`/`6d3fa2beb`); strict `@supports`
  prelude `@{cond}` valid / bare-ident+`@var` invalid (`b799d9a49`); scss query-prelude
  interp emit fix `#{$cond}`→`$[cond]` (`1d160dae1`/`701b06415`).

## CAVEAT — audit branch skew
The cross-parser audit built from `feat/mixin-recursion`, which is BEHIND `origin/dev`.
Its CSS accept/reject rows (bad-url, calc, @supports) predate this session's origin/dev
fixes — re-verify any CSS-specific claim against `origin/dev` before acting. The
qualitative findings (scss Less-leak, the 187 categorization, less.js reference) hold.
