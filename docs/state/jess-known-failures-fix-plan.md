# Jess suite known-failures — remediation plan

Companion to `packages/jess/test/known-failures.json`. Every entry in that
baseline points here. These are **long-standing, deterministic** failures on
`dev` (none are timeouts). They are baselined so the PR quality gate reflects
reality; this document is the plan to actually clear them, so the baseline
shrinks rather than calcifies.

Diagnosis date: 2026-08-28. Traced against `dev` at the CI-setup fix.

## Recommended order (quickest / highest-value first)

1. **#2 dialect-builtins** (S, zero-risk) — stale test exemplars.
2. **#1 diagnostics** (S, or M) — stale `instanceof Error`; **owner call** on the public-throw contract first.
3. **#3 `$extend &`** (S–M) — Jess extend-policy parser gap.
4. **#5 + #6 reference/inline** (M, one fix) — reference-visibility over-suppression.
5. **#4 `@import url(${…})`** (M) — Jess interpolation grammar gap.
6. **#7 + #8 bootstrap** (M diagnostic + owner-gated dialect) — escalate before touching.

---

## #1 — diagnostics: `renderString` throws a value that isn't `instanceof Error`
- **Test:** `test/diagnostics.test.ts > Diagnostic display tiers > renderString reports a collected parser diagnostic without a plain duplicate error`
- **Category:** stale-test-expectation + owner design question
- **Root cause:** `class JessError` no longer extends `Error` (perf commit `b16d69578`, 2026-07-28, dropped `extends Error` to avoid stack capture on every diagnostic). The test's `expect(thrown).toBeInstanceOf(Error)` (line 432) now fails; `renderString` re-throws the raw diagnostic (`packages/compiler/src/index.ts:1252`).
- **Fix approach:** Mechanical fix is test-side — assert the real contract (`toBeInstanceOf(JessError)` or `toMatchObject({ code: 'parse/dynamic-charset' })`). **ESCALATE FIRST:** should a public `renderString` throw a value user `catch (e) { if (e instanceof Error) … }` code cannot recognize? If public throws must stay `Error`-catchable, the alternative fix is re-adding `extends Error` to `JessError` (reverting the perf change) — an owner call.
- **Effort:** S (test) / M (if reverting perf decision)
- **Owner-gated:** YES (public-throw contract)

## #2 — dialect-builtins: stale "still-unconverted" exemplars
- **Test:** `test/dialect-builtins.test.ts > per-dialect built-ins > registers only what a dialect index exports`
- **Category:** stale-test-expectation
- **Root cause:** Test asserts Sass `quote`/`unquote` register nothing as "still-unconverted globals" (lines 81–82). Both are now real built-ins: `packages/fns/src/sass/string/{quote,unquote}.ts` use `defineFunction(...)`, exported at `sass/index.ts:88-89`, so `isFn` registers them.
- **Fix approach:** The invariant (a dialect registers only what its index exports as an `Fn`) still holds; the exemplars are stale. Repoint the assertion at globals that are *genuinely* still unconverted (grep `sass/index.ts` re-exports whose module has no `defineFunction`/`params`), or drop the two lines. Do NOT un-register the functions.
- **Effort:** S
- **Owner-gated:** no

## #3 — jess-render: `$extend &` rejected at parse
- **Test:** `test/jess-render.test.ts > Jess parser plugin render-through > parent selector > accepts \`&\` as a $extend target while keeping $apply class-only by default`
- **Category:** dialect-feature-gap (parser policy)
- **Root cause:** `isSimpleAllowed` (`packages/syntax/jess/jess-parser/src/parse-with.ts:89-97`) has no branch for the parent-reference `&` term, so `validateSelectorList` throws (`parse-with.ts:107-109`). `DEFAULT_EXTEND_SELECTOR_KINDS = ['class','placeholder']` (`parse-with.ts:68`). Intended: `$extend &` should *parse* and match nothing at eval (like Less `:extend(&)`).
- **Fix approach:** Add a term-type case permitting a lone parent-reference `&` as an `$extend` target under the default policy. Verify the second assertion (`$apply &(-1)` still rejects) stays green; eval side is expected to already no-op.
- **Effort:** S–M
- **Owner-gated:** no (but touches Jess extend semantics — run semantics-reviewer)

## #4 — jess-render: `${…}` interpolation not parsed inside `@import url(...)`
- **Test:** `test/jess-render.test.ts > Jess parser plugin render-through > reports unresolved Jess interpolation through the public structured diagnostic route`
- **Category:** parser-bug (grammar gap)
- **Root cause:** Parser chokes on `{` of `${path}` inside `@import url(${path})` → `parse/syntax-error @1:14` instead of building an interpolation node. Intended: parse `${path}`, then fail at resolve with `resolve/name-not-found @1:13` (`$path` unbound at import time). `${name}` is a documented Jess interpolation form.
- **Fix approach:** Extend the Jess grammar to accept the `${…}` interpolation production inside an `@import` `url(...)` prelude, producing a node that reaches resolve. Grammar work — gated by `docs/architecture/parser/GRAMMAR-REVIEW-STANDARD.md`, run grammar-reviewer.
- **Effort:** M
- **Owner-gated:** no

## #5 + #6 — path-resolution: `@import (reference)` suppresses nested `@import (inline)` payload
- **Tests:**
  - `test/path-resolution.test.ts > Less path resolution > keeps a second document base through reference-url imports and inline multiple`
  - `test/path-resolution.test.ts > Less path resolution > preserves that base when legacy compatibility hooks are also configured`
- **Category:** semantics-bug (reference-visibility over-suppression). Titles say "base"/"path" but path resolution is fine — the inline payload is silently dropped.
- **Root cause:** When an import chain is marked `(reference)`, a nested `@import (inline)` payload is suppressed from output. Variant matrix confirmed the trigger is the `(reference)` flag, NOT `url()` and NOT `multiple`. Area: inline-import branch in `packages/core/src/ast/serialize.ts` (~`serialize.ts:9099`, `importHasOption(options,'reference')` ~`9104`). `.target`→`.extension` extend still works, proving chain/base resolution is intact.
- **Fix approach:** Ensure `@import (inline)` content emits raw CSS verbatim regardless of an ancestor `(reference)` flag — inline imports must not inherit reference-hidden visibility. One fix covers both tests. Run semantics-reviewer (emitted-CSS change); cite/append a DESIGN-DECISIONS row.
- **Effort:** M
- **Owner-gated:** no (but emitted-CSS semantics — semantics-reviewer required)

## #7 + #8 — bootstrap: root-level leading combinator + mislocated diagnostic
- **Tests:**
  - `test/less/bootstrap-clean-repro.test.ts > bootstrap clean render > renders and collects rejections`
  - `test/less/bootstrap-memory-bisect.test.ts > bootstrap execution-memory bisect > renders the requested ordered import prefix`
- **Category:** (a) dialect-feature-gap / settled-semantics + (b) parser diagnostic bug
- **Root cause:** `bootstrap-less-port@2.5.1` `_navbar.less:250` authors a root-level leading-combinator selector `> .container, > .container-fluid { … }` (Sass-placeholder emulation, Less-4.x-accepted). jess v5 rejects a stylesheet-top selector starting with a combinator **by design** (DESIGN-DECISIONS `P29`, settled 2026-08-15; memory `root-leading-combinator-open-p20`; nested `> .child` is accepted). The render aborts, so bootstrap never emits CSS. Separately, the parser's error recovery **mislocates** the failure to the following `each()` at `256:50` with a misleading "Missing closing parenthesis" instead of reporting at `250:1`.
- **Fix approach:**
  - **(b) independent & shippable:** Fix error recovery so a root leading-combinator selector reports at its own location (`250:1`) with an accurate message. Grammar/diagnostic work; run grammar-reviewer. Effort **M**.
  - **(a) owner-gated:** These tests assert full bootstrap render with zero rejections — impossible while root leading combinators are rejected. Either the owner decides the **Less dialect** should accept + emit root-level leading combinators for Less-4.x corpus compat (reverses/narrows settled P29 → **ESCALATE**, then grammar work, effort **L**), or the rejection stands and these two stay baselined as known-failing real-world-corpus cases. `_navbar.less:250` is the *first* such site; more root-`>` sites may surface after it.
- **Effort:** M (diagnostic) + L / owner-gated (dialect)
- **Owner-gated:** YES (whether jess-Less accepts root leading combinators — reverses P29)
