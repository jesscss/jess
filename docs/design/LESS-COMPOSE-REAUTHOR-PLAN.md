# Less compose re-author — plan of record

**Status: PLAN (2026-08-31, read-only analysis).** Base: `origin/dev` @
`699608039`, parseman `^0.50.4` (the compose recognizer-reroute fix is landed —
see the `docs/state/GRAMMAR-DEDUP-LOG.md` reconciliation banner). No grammar was
edited to produce this; it is the classification + ordered worklist for
re-authoring `packages/syntax/less/less-parser/src/grammar.ts` as a true CSS
delta (Stage C, owner order `css → less → scss → jess`).

---

## ✅ Parseman is NOT the blocker — the work is a grammar-side helper hoist

**Correction (2026-08-31, superseding an earlier "blocked on parseman" banner).**
Re-measured at parseman **0.50.4** (`PRODUCTION-COMPOSE-FEASIBILITY.md` §6, probe
`scripts/probe/parseman-compose-reducer-census.mjs`) and corroborated by owner
ledger **P28** (SETTLED 2026-08-15: *"compose proven end-to-end, parseman 0.49.0
cross-module fix"*). Both parseman IR fixes the old 0.46.0 doc called for **already
landed**: block-bodied reducers serialize (**0 structural rejects across all four
grammars** — the exact 0.46.0 `unsupported BlockStatement` offender now classifies
clean), and imported free bindings are carried via `buildImports` provenance. css
already ships `cssBaseRules = compose([...])` and macro-fuses end-to-end (0 artifact
fallbacks). **No parseman change is required.**

**The ONE remaining blocker is grammar-side and mechanical: hoist each dialect's
module-scope reducer helpers into importable modules (as css already did).** css
has **0** local reducer helpers (all imported from `@jesscss/core/ast`); the census
@0.50.4 shows the supersets are rejected ONLY by their local helpers:

| grammar | inline reducers | compose rejects | distinct local reducer-helper bindings to hoist |
|---|---:|---:|---:|
| css  | 130 | **0** | 0 (done) |
| less | 247 | 236 | **106** |
| scss | 146 | 140 | **55** |
| jess | 160 | 156 | **70** |

Hoisting these to importable modules (shared ones → `core/ast/grammar-helpers.ts`;
dialect-specific → a new `*-grammar-helpers.ts`) clears the census to 0 and lets
`compose([cssBaseRules, rules(delta)])` fuse. This is enforced by a gate
(`no reducer helper defined in grammar.ts`) with css as the 0 proof-point.

**Corrected SEQUENCE:** (Phase B0) hoist gate + helper hoist per dialect
less→scss→jess, census→0 → (W0) compose-wiring flip, now a genuine behaviour-neutral
change → convergence increments 1…10 (below). The cst-rehost probe (GO) still holds.

---

## ⏱ Progress tracker (single source of truth for this workstream)

**Goal:** Less composes on `cssBaseRules` (OR-1 compliance) so that "valid CSS
is valid in all dialects" holds by construction (P28; the SCSS ident-start fork
class becomes inexpressible), inheriting genuinely shared css shape; the delta
keeps only genuine overrides + additions + widened leaves. Deletion payoff is
modest by design (~11–20 rules) — **the win is correctness-by-construction +
OR-1 single-sourcing, not shrinkage** (see §1).

**Cadence:** one increment at a time, each oracle-gated (same accepted language +
emitted-CSS oracle + `check:macro` 0 fallbacks, all 4 variants) and landed on dev
green before the next. Alpha releases run in parallel and are never blocked.

**Current position:** W0 (compose-wiring flip) is ☑ DONE — re-landed after
fixing the source-test blocker at its root. The build-free "Source tests" job
now also primes `@jesscss/css-parser`, so parseman resolves the bare
`@jesscss/css-parser/grammar` specifier to a BUILT lib and macro-fuses from its
`composedPieces` provenance (instead of source-lowering the external base to a
runtime `compose()` that throws `IR direct node builder for VarCall references
module import(s) … a runtime compose() cannot supply`). less's four variants now
compose on `cssBaseRules` and fuse to `tableRules(`. The scss/jess W-phase
compose flips need **no further infra** — they inherit this same prime (the base
lib exists once built). Next is increment 1 (`Color`).

| # | Increment | Status | Landed | Notes |
|---|---|---|---|---|
| B0-gate | reducer-helper purity gate (census-probe `--check`) | ☑ DONE | this commit | all 4 grammars verified at 0 rejects; `check:reducer-purity` + CI "Reducer-purity gate" step (ci.yml) lock it in |
| B0-less | hoist less's 106 local reducer helpers | ☑ DONE | `61642dc5c` (2026-08-31) | PURE code motion → co-located `less-parser/src/grammar-helpers.ts` (relative import); census 106→0 (162 carried); cross-dialect dedup DEFERRED (see finding below) |
| B0-scss | hoist scss's 55 local reducer helpers | ☑ DONE | `6ba05f917` (2026-08-31) | PURE code motion → co-located `scss-parser/src/grammar-helpers.ts` (relative import); census 140→0 rejected / 55→0 unresolved (107 carried); cross-dialect dedup DEFERRED (same open-recursion guard as B0-less) |
| B0-jess | hoist jess's 70 local reducer helpers | ☑ DONE | `3a43df5b3` (2026-08-31) | PURE code motion → co-located `jess-parser/src/grammar-helpers.ts` (relative import); census 70→0 (122 carried); 108 helpers + 8 helper types moved byte-identical, dead top-imports pruned; cross-dialect dedup DEFERRED |
| probe | cst-rehost verification (§2) | ☑ GO | probe 2026-08-31 | base re-hosts to cst+positions; still holds |
| **W0** | Compose-wiring flip (§2) | ☑ DONE | this commit (re-land of `385c8b300`) | Re-landed: less's four variants compose on `cssBaseRules` and macro-fuse to `tableRules(` (0 runtime `compose(`). The source-test blocker is fixed at root: the build-free `test-source` CI job now also primes `@jesscss/css-parser` (added `--filter '@jesscss/css-parser'` to the prime), so parseman resolves the bare `@jesscss/css-parser/grammar` specifier to a BUILT lib and reads its `composedPieces` provenance to macro-fuse — instead of falling to source-lowering → runtime `compose()` throw. Carried inert since the earlier land: parseman **0.50.5** bump (`cb2d3d466`), **Gap C** rename (`2ea7bb448`), build-then-load gate (`76dcf96dc`, `check:less-fused`). |
| **W0-scss** | Compose-wiring flip for SCSS (§2) | ☑ DONE | this commit | scss's four variants compose on `cssBaseRules` (`compose([cssBaseRules, opaqueAtRuleRecognition, cssPseudoSyntax, rules<ScssRules>(…)], { hostMode })`) and macro-fuse to `tableRules(` (0 runtime `compose(`, 28 tableRules per variant). tsdown `COMPOSE_EXTERNAL` mirrors less. **Gap C**: 14 scss grammar-helpers shadowing `@jesscss/core/ast` builder imports renamed `scss*`/`isScss*` (byte-neutral). Fused gate generalized to Less+SCSS (`scripts/probe/compose-fused-check.mjs`, `check:compose-fused`, ci step "Compose fused + load gate (Less + SCSS)"). Byte-identity held: scss-parser 622 + jess Foundation/Bootstrap SCSS corpus 375 green & unchanged. Test correction: `VarCall` (CSS `var()` base rule, legitimately inherited) removed from compose-integrity's Less-only reject list. |
| **W0-jess** | Compose-wiring flip for Jess (§2) | ☑ DONE | this commit | jess's four variants compose on `cssBaseRules` (`compose([cssBaseRules, opaqueAtRuleRecognition, cssPseudoSyntax, rules<JessRules>(…)], { hostMode })`) and macro-fuse to `tableRules(` (0 runtime `compose(`, 47 tableRules per variant). tsdown `COMPOSE_EXTERNAL` mirrors less/scss. Orphaned `cssSyntax` import dropped (jess types the base via a hand-written `SharedSyntax`, not `typeof cssSyntax`). **Gap C**: 9 jess grammar-helpers shadowing `@jesscss/core/ast` builder imports renamed `jess*`/`isJess*` / `JESS_*` (byte-neutral, contained to grammar.ts + grammar-helpers.ts): `branchSegments`, `functionOpenName`, `isDeclaration`, `isInterpolation`, `isSelectorBranch`, `isSelectorList`, `isValueSlotValue`, `valueSlot`, `STRUCTURED_PSEUDOS`. Fused gate + ci step generalized to Less+SCSS+Jess (`scripts/probe/compose-fused-check.mjs`, "Compose fused + load gate (Less + SCSS + Jess)"). Byte-identity held: jess-parser 510 green & unchanged; jess suite ratchet pass set matches baseline exactly (1396 tests, 2 pre-existing known failures). No compose-integrity correction needed — jess's Less-only reject list never listed `VarCall`. |
| 1 | Inherit `Color` | ☑ DONE | this branch | CONVERGED. AST byte-identical across 666-file corpus; emitted-CSS oracle (jess test-data unit 82 + config 31) unchanged; less-parser 740 + LS 264 green. Sole CST delta: parse-error `expected` label `HexColor`→`Color` (css uses inline `hexColor` regex, less used named `g.HexColor`) — a diagnostic-label convergence toward css convention, referenced by no test/LS consumer |
| 2 | Inherit `UnicodeRange` | ☑ DONE | this branch | CONVERGED. Same named UnicodeRangeToken in both; AST byte-identical; emitted-CSS oracle (82+31) + less-parser 740 unchanged. Sole CST delta: parse-error `expected` label `UnicodeRangeToken`→`UnicodeRange` (node-name), no test/LS consumer |
| 3 | Inherit `Dimension` | ☐ TODO | — | first oracle proof |
| 4 | Inherit `CustomPropertyValue` | ☐ TODO | — | first token-override proof |
| 5 | Inherit `OpaqueBody` | ☐ TODO | — | brace-scan equivalence |
| 6 | Inherit `KeyframeSelector` | ☐ TODO | — | rule-name lowercase |
| 7 | Inherit `NamespaceTypeSelector` | ☐ TODO | — | LS ripple |
| 8 | Inherit `AttributeSelector` (static) | ☐ TODO | — | LS ripple |
| 9 | Inherit `RelativeComplex` | ☐ TODO | — | diagnostics-core ripple |
| 10 | Inherit `SupportsInParens`+`SupportsCondition` | ☐ TODO | — | needs parseman leaf-rebind probe |
| W-widen | WIDEN-LEAF → leaf-overrides | ☐ TODO | — | Enclosed family etc. |

Legend: ☐ TODO · ◐ IN PROGRESS · ☑ DONE(commit) · ⚠ BLOCKED(reason).
Update the Status/Landed cells as each increment lands; keep the DEDUP-LOG
Stage-C row pointed here.

After less: repeat for scss then jess (owner order). Those get their own
classification + worklist when less reaches W-widen.

**B0-less finding (2026-08-31, `61642dc5c`):**
- **Module location — co-located wins.** less's helpers were moved to a
  less-parser-package-local module `packages/syntax/less/less-parser/src/grammar-helpers.ts`
  and imported with a **relative** `./grammar-helpers.js` specifier. The census
  cleared to **0** (106→0, 162 carried). So parseman's compose analyzer carries
  a reducer's free binding when it is imported from a **same-package relative
  module** — it does **not** require the css pattern of importing from a
  workspace package (`@jesscss/core/ast`). Dialect-specific helpers can live in
  the dialect package; they do not have to sit in core/ast. Apply the same
  co-located `grammar-helpers.ts` for B0-scss / B0-jess.
- **Cross-dialect dedup DEFERRED (not skipped).** Promoting helpers that are
  byte-identical across css/scss/jess into the shared `core/ast/grammar-helpers.ts`
  is a **separate** pass, gated by the open-recursion rule: a helper is only
  safely shareable when its **whole transitive helper-closure** is identical too.
  Measured for less, the realistic shareable set is near-empty — its guards
  delegate to a richer `isValueNode`/`isInterp`, its `require*` helpers carry
  dialect-branded error strings (`'Less grammar produced…'` vs `'SCSS…'`), and
  the two same-name css twins (`isSelectorBranch`, `isValueSlotValue`) dispatch
  to divergent less-local callees. B0 only needs helpers to be **importable**,
  not **shared**; the dedup pass is tracked separately.

**Method of record consulted:** `docs/design/COMPOSE-MIGRATION-SPEC.md` §4 (the
four-bucket classification), §7 (payoff axis), §8 (packaging + the scss pilot
result), §9 (bump-independent convergence);
`docs/architecture/parser/GRAMMAR-REVIEW-STANDARD.md` (the four hard rules);
`docs/OWNER-REQUIREMENTS.md` OR-1 rule 2 (*"Each downstream grammar MUST extend
CSS grammar (import and compose)"*); `docs/state/GRAMMAR-DEDUP-LOG.md`
reconciliation banner (the confirmed less overrides + the Stage-C escalation).

---

## 0. Goal state

```
lessGrammar = compose([cssBaseRules, lessSyntax-recognition, rules(opts, lessDelta)], { hostMode })
```

for all four variants (ast / ast+positions / cst / cst+positions), where
`lessDelta` is ONLY Less's genuine overrides + additions + widened-leaf
overrides. Every rule that is a gratuitous divergence from a css equivalent is
converged to css's name/token/reducer convention and then deleted from the delta
(inherited via open-recursion). Today less is a **self-contained** ~186-rule
graph: it imports css RECOGNITION (`@jesscss/parser-shared/recognition`) and css
AST CONSTRUCTORS (`@jesscss/core/ast`) but NOT css's grammar RULES, so it
re-states css structure implicitly. The parseman 0.50.4 fix means inheritance now
works once less references css's rules (`cssBaseRules`).

---

## 1. Executive summary — the payoff is MODEST, and that is the finding

Every one of the 186 returned Less rules was classified against its css twin by
reading both bodies. The result confirms the DEDUP-LOG verdict ("most superset
structure is genuine override; realized byte payoff is modest"):

| Bucket | Count | % | Meaning |
|---|---:|---:|---|
| **ADDITION** | 105 | 56% | Less-only construct, no css twin — KEEP in delta |
| **GENUINE OVERRIDE** | 60 | 32% | Different accepted language or emitted AST — KEEP in delta |
| **WIDEN-LEAF** | 10 | 5% | css leaf that Less widens — becomes a leaf-override; may let a css structural parent inherit |
| **CONVERGE? NEEDS-ORACLE-PROOF** | 9 | 5% | Convergeable only if a stated token/reducer/span equivalence holds |
| **CONVERGE→INHERIT (firm)** | 2 | 1% | Provable gratuitous rename/convention — DELETE now |

**Realistic deletion payoff:** 2 rules firm (`Color`, `UnicodeRange`), up to +9
more if their oracle proofs pass, plus a handful of structural parents that a
WIDEN-LEAF override lets inherit (chiefly the Enclosed family). Net **~11–20 rule
deletions (~6–11%)** in the best case. Less does NOT collapse to a tiny file —
88% of it (overrides + additions) is genuine, per-dialect delta. **The primary
win is OR-1 compliance and single-sourcing, not deletion count:** after the flip,
Less composes on css instead of implicitly re-stating its structure, and the
~40 name-overlapping structural rules that are pure css shape inherit instead of
drifting.

Why so few converges: the subsystems where a superset would inherit — value,
math, declaration, selector tower, query/supports/container prelude — are all
**genuine per-dialect overrides** in Less (interpolation `@{…}`, `@name`
operands, the `operation()` math tower, `:extend`-threaded selectors, the
`|`-combinator and `not(whenGuardAhead)` mixin-guard lookahead, structured
at-rule preludes where css scans raw `Any`). The clean inheritance is confined
to a few terminal leaves.

---

## 2. Compose-wiring prerequisite — MUST land first (before any deletion)

Deletions can only inherit once less actually references `cssBaseRules`. This
step is a **single behavior-neutral flip** and lands ahead of every convergence
increment. Much of the §8 packaging the spec anticipated is **already done**:

**Already in place (verified):**
- `@jesscss/css-parser: workspace:*` is a runtime **dependency** of less-parser
  (`packages/syntax/less/less-parser/package.json` — the spec's "add dep" is
  done). less already imports `@jesscss/css-parser/cst-host` in `src/cst.ts`.
- `cssBaseRules` is **already exported** for cross-package compose at
  `@jesscss/css-parser/grammar` (re-export in
  `packages/syntax/css/css-parser/src/grammar/ast.ts:17`, backed by
  `packages/syntax/css/css-parser/src/grammar.ts:3911`). css-parser already
  externalizes `@jesscss/parser-shared` in its own build
  (`css-parser/tsdown.config.ts`), so the base's recognition spread is
  statically followable.

**Still required (the actual wiring work):**
1. **Externalize the base in less-parser's build.** `less-parser/tsdown.config.ts`
   currently sets NO `external` (unlike css-parser). Add
   `external: [/^@jesscss\/css-parser(\/|$)/, /^@jesscss\/parser-shared(\/|$)/, /^@jesscss\/core(\/|$)/]`
   so the compose analyzer can follow `cssBaseRules`'s `parseman.composedPieces`
   spread and re-emit its `buildImports` provenance statically. This is the exact
   §8 STEP-1 lesson: bundled as a local const, the spread is unfollowable and a
   cross-package `compose([cssBaseRules, delta])` silently drops the ~69
   recognition rules and throws at runtime.
2. **Import `compose`.** less currently imports `composeLeaf` only
   (`grammar.ts:24-27`); add `compose` to the parseman macro import.
3. **Flip the four variant exports** (`grammar.ts:6840-6849`) from
   `composeLeaf([cssSyntax, lessSyntax, cssPseudoSyntax, rules(delta)])` to
   `compose([cssBaseRules, lessSyntax, cssPseudoSyntax, rules(delta, {…})], { hostMode })`,
   **keeping the ENTIRE current less rule set in the delta** so every rule still
   overrides its css twin by name. Nothing inherits yet ⇒ the composed grammar is
   byte-identical to today's. Gate: same accepted language + emitted-CSS oracle
   green + `check:macro` 0 fallbacks, on all four variants.

**OPEN wiring verification (the one real risk):** `cssBaseRules` is pinned
`{ hostMode: 'ast' }` (`css grammar.ts:3911`), and css exposes NO cst-mode base
(`css grammar/cst.ts` re-exports the compiled `cssCstGrammar`, not a base rules
map). The DEDUP-LOG banner asserts "a single host-mode-complete `cssBaseRules`
serves all four variants via the outer `compose(…, { hostMode })`." **Verify
before the flip** that composing the ast-pinned base under an outer `cst` (and
`+positions`) compose actually re-hosts it; if it does not, the base must be
re-exported host-mode-parametric (as the rules/pieces map without a pinned
hostMode) so less's outer compose sets the mode. This is the gating question for
the cst/positions variants and should be proven with a one-rule probe first.

---

## 3. Ordered CONVERGE worklist (safest / cheapest first)

Each increment deletes one (or a small tight group of) delta rule(s), lets the
css twin inherit, and is oracle-verified (same language + emitted-CSS oracle +
`check:macro`) before the next. All are **bump-independent** (no parseman
publish). Consumer ripple noted per item.

| # | Increment | Rules | css twin | Proof obligation | Consumer ripple |
|---|---|---|---|---|---|
| **W0** | Compose-wiring flip (§2) | — (keep all) | — | oracle byte-identical, 4 variants, macro 0 | none (no-op flip) |
| **1** | Inherit `Color` | `Color` (less:3101) | `Color` (css:1263) | trivial: shared `HexColor` token (recognition.ts:499, not overridden by `lessSyntax`); reducer differs only `requireToken(c[0]).value` vs `tokenText(c[0])` over one matched token | none |
| **2** | Inherit `UnicodeRange` | `UnicodeRange` (less:3134) | `UnicodeRange` (css:1274) | trivial: shared `UnicodeRangeToken` (recognition.ts:500); reducer convention-only | none |
| **3** | Inherit `Dimension` | `Dimension` (less:3122) | `Dimension` (css:1294) | prove Less's `Percentage`-as-token model (less:3121) lets `Dimension` inherit css's `numberNoPercentage` split without changing accepted `%` handling | none |
| **4** | Inherit `CustomPropertyValue` | `CustomPropertyValue` (less:3941) | `CustomPropertyValue` (css:1258) | prove Less intends CSS-escape acceptance in `var(--x)` names — the divergence is the `lessSyntax` token override `CustomPropertyToken: lessCustomProperty` (recognition.ts:573, escape-free), NOT the const | none |
| **5** | Inherit `OpaqueBody` | `OpaqueBody` (less:5635) | `OpaqueBody` (css:2714) | prove Less's brace-scan (`scanTo('}')`) skips strings/comments byte-identically to css's `many(OpaqueBodyPart)` | none |
| **6** | Inherit `KeyframeSelector` | `KeyframeSelector` (less:5375) | `keyframeSelector` (css:3576) | prove `keyframeEndpoint`/`Percentage` accept identical bytes AND `requireToken().value === sourceText()`; also css lowercases the rule name (`keyframeSelector`) | none |
| **7** | Inherit `NamespaceTypeSelector` | `NamespaceTypeSelector` (less:6017) | `NamespaceTypeSelector` (css:766) | prove Less `AttributeNamespace` ≡ css inline `attributeNamespace` (css:542) and the missing `noTrivia` wrapper (css:768) is equivalent | LS `cst-syntactic`/`cst-analysis` key grammar-type strings (verify) |
| **8** | Inherit `AttributeSelector` (static only) | `AttributeSelector` (less:6084) | `AttributeSelector` (css:774) | prove byte-identical incl. modifier spacing; Less interpolation is a SEPARATE rule (`InterpolatedAttributeSelector`), so the static one can converge | LS selector-type sets |
| **9** | Inherit `RelativeComplex` | `RelativeComplex` (less:6274) | `RelativeComplexSelector` (css:1002) | only intrinsic delta is `withSourceSpan` (less:6283); css open-recurses `g.ComplexSelector` so it auto-inherits Less's `ComplexSelector` override — prove the span attachment is foldable | diagnostics-core `EXTEND_TARGET_TYPES` (`ComplexSelector`) |
| **10** | Inherit `SupportsInParens` + `SupportsCondition` | less:4973, 4984 | css:3185, 3201 | needs parseman **per-subtree leaf-rebind**: converge only if the `@supports` subtree rebinds its feature-leaf (`SupportsFeature`) + widened `Enclosed` WITHOUT disturbing media's shared `QueryFeature`. Probe parseman first | none |
| **W-widen** | Convert WIDEN-LEAF rules to leaf-overrides; delete any css structural parent that only wraps them | Enclosed family (4→1 leaf + inherit), Quoted/EscapedQuoted plain arms, `OpaqueAtPrelude`, `CustomPropertyName`, `PlainUrl`/`VariableUrl` | Enclosed (css:3095–3143), Quoted (css:1310), OpaqueAtPrelude (css:2665), CustomProperty leaf, Url (css:1357) | per §4.1: override the leaf, confirm the css parent inherits the widened arm | Enclosed = none; selector-adjacent = LS |

**First 5 increments in order:** W0 (wiring flip) → 1 `Color` → 2 `UnicodeRange`
→ 3 `Dimension` (first proof) → 4 `CustomPropertyValue` (first token-override
proof).

The scss/jess compose-wiring flips (their own W0-equivalents) need **no further
CI infra** — the source-test job's css-parser prime (added for W0) already makes
the built base lib available for any cross-package `compose([cssBaseRules, …])`
fusion, so those flips are pure grammar-file edits.

---

## 4. Rule-by-rule classification (all 186)

Buckets: **C** = CONVERGE→INHERIT (firm), **C?** = CONVERGE? NEEDS-ORACLE-PROOF,
**W** = WIDEN-LEAF, **O** = GENUINE OVERRIDE, **A** = ADDITION. Evidence is
`less:line` (and css twin where relevant).

### 4.1 Variables / interpolation / references / import / plugin (less 2599–3095, 2759–2977)
| Rule | less | Bucket | css twin | Note |
|---|---|---|---|---|
| IndirectVariableReference | 2599 | A | — | `@@name` two-step scoped lookup |
| VariableReference | 2610 | A | — | `@name` scoped var ref |
| BareVariableInterpolation | 2618 | A | — | error guard for bare `@name` in interp pos |
| PropertyReference | 2626 | A | — | `$ident` property ref |
| InterpolationAccessor | 2631 | A | — | `[k]`/`[$@x]`/`[@x]` map accessors |
| VariableReferenceChain | 2692 | A | — | left-factored `@name` + lookup tails |
| VariableInterpolation | 2721 | A | — | `@{name}` interpolation |
| PropertyInterpolation | 2729 | A | — | `${…}` interpolation |
| Interpolation | 2734 | A | — | choice wrapper over the two interp forms |
| AtRuleInterpolation | 2742 | A | — | `@{…}`-deferred at-rule header |
| interpolatedValueTail | 2750 | A | — | interp value-tail helper |
| InterpolatedValue | 2751 | A | — | interp template value |
| Quoted | 2759 | **W** | Quoted:1310 | adds `@{}`/`${}` interp arms; less `QuotedDoubleText` stops at `@{` where css `doubleQuotedText` accepts it |
| LiteralQuoted | 2782 | **O** | Quoted:1310 | same `quoted()` AST but NARROWS: rejects literal `@{`/`${` to reserve interpolation |
| EscapedQuoted | 2794 | **W** | Quoted:1310 | css already has `~"…"`; Less adds interp arms |
| PlainUrl | 2813 | **W** | Url:1357 | widens url() body (`EscapedQuoted`, data-url) + reserves leading `@name`/`@{` |
| UrlInterpolation | 2840 | A | — | `@{}`-bodied url template |
| VariableUrl | 2848 | **W** | Url:1357 | url() arm carrying variable-ref/interp body |
| ImportOption | 2883 | A | — | `@import (reference|inline|…)` option |
| ImportOptions | 2888 | A | — | parenthesized option list |
| ImportTailParen/Group/Text | 2909/2914/2915 | A | — | Less import-tail machinery |
| ImportTarget | 2937 | **O** | ImportStatement inline target | widened target set (EscapedQuoted/VariableUrl/interp) |
| ImportTail | 2948 | **O** | ImportTail:2500 | typed tail (query op / interp / text) vs css opaque `any` |
| ImportStatement | 2977 | **O** | ImportStatement:2508 | StyleImport (compile-time) vs AtRuleStatement split; rejects compile-time postlude |
| PluginDirective | 3021 | A | — | `@plugin` directive |
| VarDeclaration | 3065 | A | — | `@name: value` |
| ValueBlockDeclaration | 3077 | A | — | `@name: { block }` detached ruleset |

### 4.2 Leaves + functions / conditions / calls (less 3096–3555)
| Rule | less | Bucket | css twin | Note |
|---|---|---|---|---|
| Keyword | 3096 | **O** | Keyword:1246 | less `ValueIdentifier`=`lessBareIdentifier` (no escapes) narrower than css `Identifier`=`cssIdentifier` |
| Color | 3101 | **C** | Color:1263 | shared `HexColor` token; reducer convention-only |
| Percentage | 3121 | **O** | Percentage:1279 | less emits a raw math-atom `token`, css emits a `Dimension` node |
| Dimension | 3122 | **C?** | Dimension:1294 | prove inheritance safe given Percentage owns `%` |
| UnicodeRange | 3134 | **C** | UnicodeRange:1274 | shared `UnicodeRangeToken`; reducer convention-only |
| EscapeValue | 3142 | A | — | declaration-hack escape `#000 \9` |
| PagePseudo | 3154 | A | — | `@page :left` value-position pseudo atom |
| DoubledQuoteArgument | 3162 | A | — | legacy `""…""` unknown-fn arg |
| FunctionCondition{Operand,Paren,Term,And,Or} + FunctionCondition | 3170–3243 | A | — | Less mixin/fn guard-condition tower |
| FunctionScalarArgument | 3264 | **O** | valueFunctionArguments:743 | wraps `MathSum` (math tower folds arithmetic) |
| FunctionAssignmentArgument | 3289 | A | — | legacy `key=value` verbatim pair |
| FunctionKeywordArgument | 3316 | A | — | `@name: value` keyword arg |
| FunctionArgument | 3327 | **O** | valueFunctionArguments:743 | choice over condition/keyword/assignment/scalar |
| FunctionArguments | 3369 | **O** | genericFunctionArguments | admits `DoubledQuoteArgument`/`ValueBlock` + `;`/`,` capture |
| GenericFunction | 3384 | **O** | GenericFunction:2003 | Less args + `functionCallFromChildren` reducer |
| Call | 3390 | **O** | Call:1377 | same skeleton, Less args + reducer |
| CallArgumentFunction | 3405 | A | — | detached-ruleset call-arg function |
| FormatFunction | 3412 | A | — | deprecated `%(…)` percent-format |
| FunctionStatement | 3439 | A | — | bare call STATEMENT (dispatch `each(`/generic) |
| CalcFunction | 3468 | **O** | CalcCall:1835 | interior `MathSum` (Less math tower) vs css `CalcSum` |
| EscapedParen | 3505 | A | — | `~(…)` escaped list |
| Paren | 3516 | **O** | ParenValue:1861 / CalcParen:1407 | bare `(…)` is Less math grouping everywhere |
| QueryColonFeature | 3548 | **O** | QueryColonFeature:2798 | value=`MathSum`, key interp-capable, dynamic math flag |

### 4.3 Value / math tower + custom-props + declaration (less 3557–4090)
| Rule | less | Bucket | css twin | Note |
|---|---|---|---|---|
| Value | 3557 | **O** | Value:2241 | adds MixinReference/InterpolatedValue/refs/backtick arms; css is bare `project` of `valueAtom` |
| MathUnary/MathAtom/MathProduct/MathSum/TopProduct/TopSum | 3587–3633 | **O** | (calc-only in css) | fold arithmetic into `operation()` (`foldOperation` less:2287); css confines math to `CalcSum`/`CalcProduct` |
| PreservedDivision | 3642 | **O** | — | Less parens-division slash-group → `spaced()` + `withValueLayout` |
| valuePiece | 3725 | **O** | valueAtom:2229 | routes into math tower + literal `/ - %` |
| ValueSequence | 3775 | **O** | ValueSequence:2246 | glued `@`-var boundary + math pieces + custom reducer |
| ArgumentValueSequence | 3789 | A | — | fn-arg value term w/ `functionConditionStop` guard |
| ValueList | 3798 | **O** | ValueList:2273 | MixinReference accessor arm + reference short-circuit |
| VariableValue | 3821 | A | — | `@name:` decl value layout (leading trivia, trailing comma) |
| ImportantValue | 3837 | A | — | wraps ValueList in `important()` so refs hoist priority |
| ValueListWithPriority | 3852 | A | — | left-factored value + optional important |
| CustomPropertyName | 3872 | **W** | CustomProperty leaf | widens `--name` to accept `--@{x}` interpolation |
| CustomGroup/AtKeywordText/InnerPart/Part | 3890–3924 | A | — | Less-only structured custom-value interior (interp/refs) |
| CustomValue | 3925 | **O** | CustomValue:1241 | structured parts surfacing interp/refs vs css opaque `any(text)` |
| CustomPropertyValue | 3941 | **C?** | CustomPropertyValue:1258 | identical `keyword(--name)` AST; hinges on the escape-free `lessSyntax` token override |
| CustomDeclaration | 3946 | **O** | Declaration custom arm:2374 | interpolatable name + structured value + explicit important tail |
| InterpolatedProperty | 3976 | A | — | interpolated property names `color-@{n}` |
| Declaration | 4069 | **O** | Declaration:2371 | `+`/`+_` merge, empty-value, interp-name, value-layout |

### 4.4 Mixins / guards / references / each / enclosed / supports (less 4090–5000)
| Rule | less | Bucket | css twin | Note |
|---|---|---|---|---|
| MixinArgumentGroup / MixinArguments / MixinInterior | 4116/4136/4203 | A | — | Less mixin call-args + signature params |
| ReferenceTail | 4237 | A | — | lookup/call chain step `[k]`/`.m`/`(args)` |
| FlatMixinCall / NamespacedMixinCall / NamespacedMixinValue / MixinReference | 4377–4473 | A | — | Less mixin-call value forms |
| ReferenceCall | 4484 | A | — | `@name(args)` detached-ruleset call (reuses `'VarCall'` type, disjoint language) |
| MixinGuard{Operand,Term,And,Or,TopTerm,TopAnd,TopOr} + MixinGuard | 4506–4633 | A | — | Less `when <guard>` tower |
| blockBody | 4767 | **O** | declarationListBlock body | adds mixin/function/guarded-ruleset arms to the body-item set |
| EachName / EachCallback / EachFunctionStatement | 4775/4810/4855 | A | — | Less `each(...)` → `For` |
| BodyStatement / ValueBlock / CallArgumentValue | 4793/4794/4799 | A | — | Less detached-ruleset body + value |
| EnclosedQuoted / EnclosedGroup / EnclosedContent / Enclosed | 4894/4902/4911/4927 | **W** | Enclosed family css:3095–3143 | widening point is `EnclosedContent` (adds interp arms → structured `Interpolation`); parents can inherit css structure if the widened leaf is re-referenced |
| EnclosedFunctionName | 4922 | A | — | Less factoring node (css inlines `QueryFunctionOpen`) |
| SupportsValue | 4946 | **O** | — | typed `@supports` value permitting `@var`/interp |
| SupportsFeature | 4957 | **O** | QueryFeature:2886 | emits `operation(':')` w/ Less-math flag; narrower than the media-shared QueryFeature |
| SupportsInParens | 4973 | **C?** | SupportsInParens:3185 | recognition byte-identical; needs per-subtree leaf-rebind proof |
| SupportsCondition | 4984 | **C?** | SupportsCondition:3201 | same not/and-or shape; convergeable only with SupportsInParens |
| SupportsBlock | 4997 | **O** | ConditionalBlock:3648 | Less interp prelude arms + Less `blockBody` |

### 4.5 Query / container / media / keyframes / at-rule prelude + blocks (less 5015–5740)
| Rule | less | Bucket | css twin | Note |
|---|---|---|---|---|
| QueryValue | 5039 | **O** | QueryValue:2764 | different leaf set (`@var`), ratio relocated |
| QueryFeatureValue | 5052 | A | — | Less-only ratio-folding node |
| QueryFeature | 5126 | **O** | QueryFeature:2886 | adds container-boolean arms |
| QueryNonOnlyKeyword | 5132 | **O** | QueryNonOnlyKeyword:2904 | different reserved-word guard (accepts `layer`) |
| QueryTerm | 5137 | **O** | QueryTerm:2971 | adds MixinReference + VariableReference arms |
| QueryClause | 5163 | **O** | QueryClause:2999 | terms joined by and/or vs whitespace |
| MediaQueryTerm | 5187 | A | — | Less media interpolation term |
| ContainerStyleQuery / ContainerScrollStateQuery | 5243/5250 | A | — | structured `style()`/`scroll-state()` queries |
| ContainerName | 5257 | **O** | containerName:3029 | named node w/ extra guards vs css inline helper |
| ContainerQueryAtom / ContainerCondition | 5271/5280 | **O** | ContainerQueryClause:3034 | style/scroll-state atoms + structured boolean model |
| MediaContainerBody | 5333 | A | — | shared body permitting detached-ruleset Call |
| MediaContainerBlock | 5343 | **O** | ConditionalGroupAtRule:3513 | structured prelude w/ interpolation |
| KeyframeSelector | 5375 | **C?** | keyframeSelector:3576 | same body+node; prove leaf bytes + `requireToken().value===sourceText()` |
| KeyframeBlock | 5380 | **O** | KeyframeBlock:3584 | body accepts FunctionStatement/Call/less-decl |
| Keyframes | 5404 | **O** | Keyframes:3327 | structured prelude + ReferenceCall body vs raw Any |
| DottedAtRuleKeyword | 5441 | A | — | dotted layer-name keyword |
| AtRulePreludeValueAtom/Term/Value | 5467/5482/5490 | A | — | Less structured prelude-value model (css scans prelude as raw Any) |
| AtRulePrelude | 5525 | **O** | AtRulePrelude:2649 | same `Any` output but accepts `@{interp}`, breaks on bare `@` |
| NamespacePrelude | 5560 | A | — | structured `@namespace` prelude w/ `@{prefix}` |
| AtRuleBlock | 5601 | **O** | StylesheetAtRule:3465 / DeclarationListAtRule:3489 | generic structured block + layer arm + Call body |
| OpaqueAtPrelude | 5624 | **W** | OpaqueAtPrelude:2665 | raw-text leaf widened w/ `@{interp}`/bare-`@` arm |
| OpaqueBody | 5635 | **C?** | OpaqueBody:2714 | both emit verbatim text; prove brace-skip == css string/comment skip |
| CustomValueAtKeyword / StaticAtRuleStatementName / AtRuleName | 5647/5653/5657 | A | — | Less name gates for typed routes |
| OpaqueAtRuleBlock | 5662 | **O** | OpaqueAtRuleBlock:2719 | wires `AtRuleName` + `not(:)` guard + widened prelude |
| AtRuleStatement | 5702 | **O** | AtRuleStatement:2537 | structured preludes + `@charset`/`@namespace`/`@layer` special-casing |

### 4.6 Pseudo + attribute + selector tower + extend (less 5739–6638)
| Rule | less | Bucket | css twin | Note |
|---|---|---|---|---|
| NthPseudoArgument | 5739 | **O** | TypedNthPseudoArgument:868 | An+B-first, no bare-selector arm — `:nth-child(.a)` rejected (css accepts) |
| NthPseudoSelector | 5751 | **O** | PseudoSelector nth cases | separate node-layer rejecting selector-only nth |
| InterpolatedNthPseudo / InterpolatedArgumentPseudo | 5775/5804 | A | — | `:nth-child(@{n})` / `:lang(@{x})` interp args |
| pseudoArgumentInner / PseudoArgumentGroup / PseudoArgumentText | 5825/5826/5834 | A | — | structured raw-arg reader vs css `scanTo(')')` |
| PseudoArgumentCompound | 5859 | **O** | CompoundSelector:1145 | SEPARATE pseudo-arg compound tower (admits NthPseudoSelector) |
| PseudoArgumentComplex | 5875 | **O** | ComplexSelector:1156 | duplicate complex tower carrying `not(whenGuardAhead)` + `staticCombinator` (incl `\|`) |
| PseudoArgumentSelectorTail / PseudoArgumentSelector | 5889/5894 | **O** | SelectorList:1188 | Less-private pseudo-arg selector list on the duplicate tower |
| SelectorCapture | 5903 | A | — | `*[selector]` selector-valued value |
| PseudoSelector | 5984 | **O** | PseudoSelector:1048 | different whitelist (`:global(`/`:local(`), excludes `:extend(`, Less arg tower |
| InterpolatedPseudo | 5993 | A | — | `:@{pseudo}` interpolated pseudo NAME |
| AttributeNamespace / AttributeName / AttributeMatch | 6005/6022/6060 | A | — | Less decomposition nodes (`{namespace,name}`/`{operator,value,modifier}` facts) reused for attr interpolation |
| NamespaceTypeSelector | 6017 | **C?** | NamespaceTypeSelector:766 | same language + `simpleSelector(join)`; prove `AttributeNamespace`≡css inline + `noTrivia` equiv |
| InterpolatedAttributeToken/ValueToken/Quoted/Selector | 6042–6106 | A | — | Less attribute interpolation family |
| AttributeSelector | 6084 | **C?** | AttributeSelector:774 | same language, flat `SimpleSelector`; interpolation is a separate rule — prove bytes incl. modifier spacing |
| BareInterpolatedSelector / AdjacentInterpolatedSelector / BareInterpolatedSelectorWithSuffix / InterpolatedSimpleSelector / InterpolatedParentSuffix | 6152–6197 | A | — | Less selector-interpolation leaves |
| ClassIdSelectorPrefix | 6239 | A | — | statement-position class/id prefix shared w/ mixin paths |
| CompoundSelector | 6250 | **O** | CompoundSelector:1145 | `compoundSimple` folds Less interp arms + NthPseudoSelector into the compound |
| ComplexSelector | 6266 | **O** | ComplexSelector:1156 | combinator loop carries `not(whenGuardAhead)` + `staticCombinator` incl `\|` (less:2413) that css `combinator`:496 excludes |
| RelativeComplex | 6274 | **C?** | RelativeComplexSelector:1002 | same shape/name; css open-recurses `g.ComplexSelector` (auto-inherits Less override); only delta = `withSourceSpan` |
| SelectorList | 6286 | **O** | SelectorList:1188 | intrinsic delta = `parser({trivia: outerSelectorTrivia})` scope (inter-branch trivia); part of confirmed override tower |
| ExtendTarget / ExtendStatement / SelectorBranchTail | 6334/6362/6393 | A | — | Less `:extend` machinery |
| RulesetWithExtends | 6440 | **O** | Ruleset:3603 | extend-threaded selector list + `MixinGuard` + body-extends + trailing `;` (extensions/guard fields) |
| NestedRulesetWithExtends | 6461 | **O** | Ruleset:3603 (nested) | same over `relativeSelectorListWithExtends` |
| ClassIdStatement | 6570 | A | — | class/id statement dispatch → MixinDefinition/MixinCall/Ruleset |
| Stylesheet | 6625 | **O** | Stylesheet:3726 | root body admits mixins/functions/guarded-ruleset + trailing Call |

**Trivia / aliases (not classification rules):** less `whitespace` (`classifiedTrivia`
at less:2310, admits `//` line comments) is a dialect trivia CONFIG override, not
a rule shape — supplied via the `rules(opts)` trivia option, kept. `Document:
Stylesheet` and `rw: whitespace` are aliases.

---

## 5. Genuine-override anchors (the load-bearing KEEPs, confirmed in code)

These are why the payoff is modest — they are re-verified, not assumed:
- **Selector tower** — `staticCombinator = keywords(['\|\|','>','+','~','\|'])`
  (less:2413) includes `\|`; css `combinator` excludes it (css:496, "`\|` is NOT a
  combinator"). The compound/complex loops carry `not(whenGuardAhead)` (less:2593,
  the `when` mixin-guard lookahead) at less:6243/6270/5880. Rulesets use the
  extend-threaded `selectorListWithExtends` (less:6404) / `RulesetWithExtends`
  (less:6442), not plain `SelectorList`.
- **Value / math tower** — `foldOperation` (less:2287) builds
  `operation(op, l, r, false, lessMathOutsideParens(state, op))` for every
  product/sum; `MathUnary` builds `operation('*', -1, x)`; `PreservedDivision`
  emits `spaced()` + `withValueLayout`. css `Value`/`ValueSequence`/`ValueList`
  never call `operation()` (css:2241/2246/2273) — arithmetic is confined to
  `CalcSum`/`CalcProduct` inside `calc()`.
- **Declaration** (less:4069) — `+`/`+_` merge, empty-value, interpolated-property
  name, value-on-new-line layout; css `Declaration` (css:2371) has none.
- **Query / supports / container preludes** — Less carries `@var`/interpolation/
  typed value structure where css scans the prelude as raw `Any`
  (`AtRulePreludeSegments` css:2599). `SupportsFeature` emits `operation(':')`.
- **Keyword** (less:3096) — `ValueIdentifier`=`lessBareIdentifier` (recognition.ts:
  350/561, no CSS escapes) is a NARROWER token than css `Identifier`=`cssIdentifier`.

---

## 6. NEEDS-ORACLE-PROOF ledger (do not converge until proven)

| Rule | The exact equivalence to prove | Kind |
|---|---|---|
| Dimension (3122) | Less's `Percentage`-as-token model makes inheriting css's `numberNoPercentage`+Percentage-node split language/AST-preserving | token split |
| CustomPropertyValue (3941) | Less intends CSS-escape acceptance in `var(--x)` names (the divergence is the `lessSyntax` `CustomPropertyToken: lessCustomProperty` override, recognition.ts:573) | token override |
| OpaqueBody (5635) | Less `scanTo('}')` skips strings/comments byte-identically to css `many(OpaqueBodyPart)` | scanner |
| KeyframeSelector (5375) | `keyframeEndpoint`/`Percentage` bytes identical + `requireToken().value === sourceText()` | leaf + convention |
| NamespaceTypeSelector (6017) | `AttributeNamespace` ≡ css inline `attributeNamespace` (css:542) + missing `noTrivia` equivalent | leaf + trivia |
| AttributeSelector (6084) | static-attr bytes identical incl. modifier spacing (css ident-boundary space vs Less explicit ` ${mod}`) | serialization |
| RelativeComplex (6274) | `withSourceSpan` (less:6283) attachment is foldable/droppable when inheriting css's | span |
| SupportsInParens (4973) + SupportsCondition (4984) | parseman can rebind the `@supports` subtree's feature-leaf (`SupportsFeature`) + widened `Enclosed` WITHOUT disturbing media's shared `QueryFeature` | parseman capability |

Use the `grammar-reviewer` (evidence per const) and the emitted-CSS oracle to
discharge each before deleting the rule.
