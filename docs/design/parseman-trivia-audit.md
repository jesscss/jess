# Trivia handling audit — parseman model + jess grammars

Status: **RESOLVED** — the compiler change this audit proposed shipped as #85
(`47f66f8b0`, "grammar-level trivia via `rules({ trivia })` across css/less/scss/jess").
The north star below (set `rw` once at the top; strip per-rule wrappers) is now the
adopted, shipped model on `dev`; the per-rule `parser({trivia:rw})` wrappers this doc
catalogs have been removed. Read the model/evidence sections as the RATIONALE for #85,
not as an open problem. The interior-trivia regression baseline (jess-parser
`corpus/13-interior-trivia`) locks the post-#85 behavior and is fully green on `dev`.

Original status (pre-#85): audit + proposal (no sweeping surgery landed). Branch
`work/trivia-audit` (base `origin/dev`). Owner decided the parseman change from this doc.

The north star (owner): **trivia set ONCE at the top rule and inherited downward;
almost no per-rule `parser({trivia:rw})` wrappers; `noTrivia` reserved for the rare
genuinely-glued token.** This doc reports whether parseman as-is supports that, the
per-grammar wrapper/`noTrivia` categorization, a latent-regression check, and the
parseman-compiler change (with perf + byte-identity + payoff) needed to reach the
north star.

---

## 1. Parseman's real trivia model (two paths — this is the crux)

Parseman has **two** parse paths, and they resolve trivia DIFFERENTLY. The jess
grammars run the compiled path, so that one governs.

### 1a. Interpreted path — runtime inheritance (NOT what the grammars run)

`combinators/grammar.ts` `parser({ trivia })`:
- `trivia: <Combinator>` → set; `null` → clear; `undefined` → inherit (spreads `{}`
  onto ctx, keeping the caller's `_ctx.trivia`). `noTrivia(x) === parser({trivia:null}, x)`.
- `combinators/sequence.ts:34` `if (ctx.trivia && i > 0)` skips trivia BETWEEN terms
  (not before the first) using the inherited `ctx.trivia`, and passes the SAME `ctx`
  straight to each child `.parse(input, pos, ctx)`. `node`/`ref`/`repeat` likewise
  thread the same ctx down without resetting `ctx.trivia`.

So on the interpreted path, trivia IS inherited by default — exactly the north star.
**But the grammars do not run this path.**

### 1b. Compiled path — compile-time, frozen per rule, fused by name (what runs)

The grammars import `from 'parseman' with { type: 'macro' }` → they are COMPILED
(`compiler/codegen.ts` + `compiler/linker.ts`). Here trivia is resolved STATICALLY
at compile time:

- `codegen.ts` tracks `ctx.activeTrivia` (a COMPILE-TIME var; starts `undefined`).
  It is set only while the compiler descends THROUGH a `parser({trivia})` `grammar`
  node (`codegen.ts:2337-2338`), and restored on exit (`:2344`). `noTrivia`/`null`
  sets it to `undefined` (`:2335`).
- Sequence codegen emits a trivia-skip between terms ONLY IF `activeTrivia` is set at
  compile time: `codegen.ts:1026` `if (i > 0 && ctx.activeTrivia)`. If it is
  `undefined`, **no skip code is emitted at all** — the runtime `ctx.trivia` is never
  consulted for that boundary.
- Each named rule `_r_<Name>` is compiled ONCE, at its FIRST reference during the
  emit walk (`emitLazy`). Whatever `activeTrivia` holds at that point is FROZEN into
  the rule body.
- `compose()` (`linker.ts`) fuses independently-compiled `_r_<Name>` bodies BY NAME
  and **never recompiles** them under the composing grammar's trivia. So a rule that
  references a base-grammar rule (`g.valueList` from `cssGrammar`) gets the base's
  precompiled body with the BASE's baked trivia.

**Consequence:** on the compiled path, trivia does NOT inherit at runtime and does NOT
propagate across the named-rule / `compose()` boundary. A rule's trivia is fixed at
its own compile point.

### Evidence

- Built `css-parser/lib/grammar.js`: `_r_Ruleset` has NO `parser()` wrapper yet emits
  3 trivia-skips (`_tf0`) — because it is first-reached under `Stylesheet`'s
  `parser({trivia:rw})`. `_r_valueList`/`_r_valueSequence` emit skips for the same
  reason. `_r_value` emits 0 (first-reached under a cleared scope).
- Empirical: dropping `VarDeclaration`'s wrapper makes `$color: red;` fail
  "Unexpected input" (23 corpus tests) — `_r_VarDeclaration`'s sequence baked NO skip
  between the `:` and the value because `activeTrivia` was `undefined` at its compile
  point. (The grammar's "measured, not reasoned / deferred-trivia-commit boundaries"
  note is a MISDIAGNOSIS; the real cause is compile-time `activeTrivia`.)
- Empirical: dropping `SelectorCapture`'s wrapper makes `*[ .notice ]` (interior
  trivia) fail while glued `*[.notice]` still parses — the regression fixed in
  `be826ec02`.

---

## 2. Latent-regression hunt (SelectorCapture class)

Risk pattern: a rule whose wrapper was dropped during this session's thinning, whose
compiled body therefore bakes NO trivia skip, and whose thin (glued-only) test
coverage hides the interior-trivia break.

I probed interior trivia (extra ws / block comment / `//`) across every Jess construct
(var decl, collection + nested, mixin def, `$if/$else/$for/$while`, `$extend`, `$apply`,
selector-capture, anon mixin/function, mixin-call, `@-compose/@-from`, ruleset +
nested). Result: **no additional latent SelectorCapture-class regression** — the
current wrappers cover the reachable interior-trivia cases. Added as a permanent
ratchet: `packages/jess-parser/test/corpus/13-interior-trivia.test.ts` (27 cases,
green). Coverage was thin exactly where the regression hid; this closes that gap.

### One NEW latent correctness bug found (distinct from the wrapper audit)

`$c: red // c` <newline> `green;` parses with NO error but WRONG: the `//` is captured
as VALUE tokens (`' //'`, keyword `c`, keyword `green`) instead of being skipped as a
Jess line comment. Cause: the value rules (`g.value`/`g.valueSequence`/`g.valueList`)
are COMPOSED from `cssGrammar`, whose compiled bodies bake CSS trivia (whitespace +
block comments, NO `//`); `compose()` does not recompile them under jess's `//`-aware
`rw`. A block comment in the same position IS skipped (CSS trivia includes `/* */`).
This is the cross-grammar-ref limitation of §1b made concrete. Filed as a separate
task (fix: jess re-declares `value/valueSequence/valueList` under jess `rw`, OR the
parseman change in §4). Not fixed here — it needs the value-shape sign-off.

---

## 3. Per-grammar wrapper / noTrivia categorization

Call-site counts (excluding import lines/comments):

| grammar | `parser({trivia:rw})` | `noTrivia` |
|--------|:--:|:--:|
| css   | 7  | 0  |
| less  | 8  | 7  |
| scss  | 13 | 1  |
| jess  | 4  | 11 |

### `noTrivia` categorization

**Genuine glue (KEEP — this is what `noTrivia` is for):**
- less: `rawDetachedBlock` (verbatim `{…}` scan), `varColon` (`@x:` colon glued to
  name — disambiguates `@page :first`), `Reference` (head glued to `[accessor]`/`(call)`
  — the production's `noSep()`), the `nonKnownAtVar` `(?=()` glue in `VarCall`,
  `cpValue`/`cp*` (custom-property `<declaration-value>` verbatim tokenization),
  `NsAccessor` (selector-path head glued to `[accessor]`), `Dimension` (number-unit glue).
- jess: `Reference`, `DollarInterp`, `InterpolatedSelector`, `exprDimension` (glued
  `50%`) — genuine glue. The arithmetic operand levels `exprProduct/Sum/Compare`,
  `unwrapProduct*`, `UnwrapArith` are `noTrivia` BY DESIGN: the operators bake the
  surrounding whitespace INTO the op token (` + `, ` * `), so a glued `1+2` is NOT an
  operation. Legitimate; not the anti-pattern.

**Redundant / weak (candidate to simplify):**
- scss: `Reference = noTrivia(scssVar)` — `scssVar` is a SINGLE regex; `noTrivia`
  around one terminal has no interior boundary to clear. Harmless but pointless; drop.

**The anti-pattern shape (`noTrivia` that FORCES a downstream `parser({trivia:rw})`
restore):** none of the `noTrivia` call-sites literally nest a `parser({trivia:rw})`
inside them today. The anti-pattern manifests INDIRECTLY via §1b: `SelectorCapture`
needs `parser({trivia:rw})` not because a lexical `noTrivia` wraps it, but because its
compiled first-reference point lacked `activeTrivia`. That is the same disease
(compiled trivia doesn't inherit) with a different surface.

### `parser({trivia:rw})` categorization (jess, representative)

- `Stylesheet` (line 434) — the ESTABLISHER (top rule). Keep regardless.
- `VarDeclaration` (100), `AnonMixin` (409), `SelectorCapture` (334) — LOAD-BEARING
  under §1b: dropping any of them breaks parsing (proven). NOT redundant given the
  current compiled model. They are the interim workaround; they become removable only
  after the §4 parseman change.

css/less/scss `parser({trivia:rw})` wrappers are the same story: a mix of the top
establisher plus rules whose compiled first-reference point would otherwise lack
`activeTrivia` (e.g. `Paren`, `CalcCall`, `atRuleBody`, `calcBody`, `declarationList`,
less `VarDeclaration`/`VarCall`/guards, the many scss statement wrappers). Under the
current model these are necessary; a blanket strip WILL regress (that is exactly how
the SelectorCapture regression happened).

---

## 4. Recommendation — the parseman compiler change (owner call)

> **Resolved by #85.** The compiler change recommended here shipped: parseman now
> resolves an unwrapped rule's trivia from grammar-level ambient trivia
> (`rules({ trivia })`) instead of baking `undefined`, so the per-rule wrappers below
> were stripped across all four grammars. The two options below are retained as the
> design record behind that decision.

The north star (set `rw` once at the top; strip per-rule wrappers) is **NOT** reachable
by grammar cleanup alone on the compiled path. It REQUIRES a parseman compiler change
so an unwrapped rule inherits an ambient trivia instead of baking `undefined`. Two
options; both must be perf-neutral and CST-byte-identical.

### Option A (lighter) — grammar-level DEFAULT trivia at fuse time

Give `rules()` / `compose()` a single default trivia for the fused grammar. In codegen,
initialize `ctx.activeTrivia` to that default (instead of `undefined`) at the start of
each rule's compilation, so an unwrapped rule bakes the default; `parser({trivia})`
still overrides locally and `noTrivia` still clears.

- Codegen change: thread a `defaultTrivia` into `compileLinkable`/the `Ctx`; seed
  `activeTrivia` from it per rule. `compose()` picks the composing grammar's default.
- CST byte-identity: the emitted `_tf` skip is the SAME shape as today's wrapped rules
  produce; risk is limited to rules that TODAY bake `undefined` and would now bake the
  default. Those are exactly the rules that currently REQUIRE a wrapper — so behavior
  converges, it does not diverge. Verify against all 4 corpora + the CST snapshot tests.
- Perf: trivia stays COMPILE-TIME-resolved → zero added runtime cost (the whole point
  of §1b). No new runtime `ctx.trivia` reads. Measure parse throughput to confirm
  neutral.
- **Cross-grammar caveat:** a fused rule from a BASE grammar keeps the base's baked
  trivia (it was compiled in the base's artifact with the base's default). So jess's
  `//` still would NOT reach the CSS-composed `valueList` (the §2 bug) unless the base
  rule is re-compiled under the composing default. Option A alone does NOT fix the §2
  `//`-in-value bug; jess must still re-declare those value rules (as it already does
  for `Stylesheet`/`declarationList`/`Ruleset`).

### Option B (heavier) — resolve each rule's trivia from its CALLER/fuse context

Make a fused rule's trivia a parameter resolved at the CALL site (or re-emit the rule
per composing trivia), so `g.valueList` called from jess uses jess `rw` and from CSS
uses CSS `rw`.

- Fixes the §2 cross-grammar `//` bug outright (base value rules inherit the composer's
  trivia) and unlocks the FULL strip.
- Cost: either (a) pass the active trivia fn as a runtime parameter to each `_r_<Name>`
  (adds a runtime read/skip decision per boundary — a REAL runtime cost, must be
  measured; risks regressing the "compile-time = free" property), or (b) emit
  per-composer specializations of shared rules (code-size blow-up, compile-time cost).
- CST byte-identity: higher risk (a rule that previously never skipped `//` now does)
  — must diff every corpus + CST snapshot.

### Payoff (what the change unlocks)

With Option A, the removable per-rule `parser({trivia:rw})` wrappers (everything except
the top establisher) are roughly: css 6, less 7, scss 12, jess 3 (VarDeclaration,
AnonMixin, SelectorCapture) — ~28 of the ~32 real wrapper call-sites collapse to ONE
establisher per grammar. `noTrivia` is largely UNAFFECTED (it is genuine glue, not the
anti-pattern) except the scss redundant single-token one. Option B additionally lets
the shared CSS value rules carry jess `//`, removing the need for jess to re-declare
value rules and fixing §2.

### Sequencing (IMPORTANT — do not strip wrappers first)

Until the parseman change lands, the per-rule `parser({trivia:rw})` wrappers are
NECESSARY. The `be826ec02` SelectorCapture fix is the correct INTERIM workaround and
must NOT be removed yet. The mass wrapper-strip is the PAYOFF of the parseman change,
sequenced AFTER it — attempting the strip first reproduces the SelectorCapture
regression rule-by-rule.

**Recommendation:** pursue Option A first (perf-free, converges behavior, ~28 wrappers
removed) and keep jess's value-rule re-declarations; treat Option B as a follow-up only
if the owner wants the shared value rules to carry `//` (fixing §2 at the model level
rather than by re-declaration). Measure parse throughput + CST byte-identity on all 4
corpora at each step.
