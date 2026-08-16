# Compose migration — spec and method of record

**Status: ACTIVE (2026-08-15).** This is the current source of truth for the
lean-grammar compose migration. It **supersedes** the "compose is blocked /
proceed as terminal leaves" framing in `GRAMMAR-REBUILD-SPEC.md` §0.5 / §5.x and
in `../architecture/parser/PRODUCTION-COMPOSE-FEASIBILITY.md`: the parseman
constraint those sections describe is real but has been **lifted** (see §3), and
the remaining work is a specific, tractable blocker plus a css-side factoring —
not an open design question.

Owner requirement (OR-1 rule 2, `docs/OWNER-REQUIREMENTS.md`, verbatim): *"Each
downstream grammar MUST extend CSS grammar (import and compose)."* Owner goal,
2026-08-14, verbatim: *"concise, lean grammars, only extended to the extent that
they NEED to be. And in most cases, even if a PARENT rule gets extended in a
downstream grammar, Parseman should support that the child rules it references
don't automatically need to be extended."*

---

## 1. The success criterion — settle it once

The migration is **behavior-preserving**. A superset that composes on the CSS
base must parse to the **same AST/CST** as its current standalone grammar.

- **The criterion is AST/CST IDENTITY of parse results** — same node types, same
  fields, and for CST the same spans + trivia — measured per corpus file against
  the pre-migration parse.
- **NOT compiled-grammar / fused-table byte-identity.** The parseman table WILL
  differ after compose (different fusion). It is a parseman implementation detail
  Jess never observes. Owner, 2026-08-15: *"What matters is AST/CST identity, not
  compiled grammar identity, that's an implementation detail that is none of
  Jess's concern."* Do not measure or chase it.
- **NOT superset-source == css-source.** "How many superset rules are textually
  byte-identical to css" is the wrong question. Reuse is behavior-equivalence.

**Gates (definition of done for any slice):**
1. AST/CST structural diff == 0 vs the pre-slice parse, across the parser suites
   and the relevant oracle corpus.
2. Emitted-CSS oracle green (whole-pipeline correctness).
3. `check:macro` — 0 interpreter fallbacks (the composed grammar macro-fuses to a
   static table). This is a build/perf property, reported **separately** from #1;
   never conflate "fuses" with "same output."

Deliberate node changes (e.g. the tracked `NamedColor → Keyword` convergence,
task #57) are separate semantic decisions, not compose regressions.

---

## 2. What compose is — open-recursion is the lever

`compose([base, delta])` fuses grammars by rule name: later entries **override**
earlier ones, and the override is **open-recursive** — an override of a parent
rule reaches the base's own internal calls, and a rule *referenced by* an
overridden parent is **inherited from the base** unless the delta also overrides
it. (Parseman `docs/guide/extending.md`; demonstrated by
`compose-proof-probes/scss-cross-package-compose-probe.ts`, which overrode one
leaf and inherited the entire selector chain above it, unredefined.)

**The consequence that makes grammars lean:** to admit a dialect construct,
override the **leaf** where that construct enters the language. Every structural
rule that references that leaf inherits the widened behavior automatically. **Do
not override the structural parents.** A superset defines only:
1. the leaves it genuinely widens (e.g. a simple-selector atom that also accepts
   `#{…}` interpolation or `%placeholder`),
2. the rules whose **own reducer/production genuinely diverges** (different
   accepted language or different emitted node), and
3. its genuine **additions** (constructs CSS has no counterpart for).

Everything else is inherited.

---

## 3. Parseman status

### 3.1 SHIPPED in 0.49.0 (branch `release/0.49.0-compose-lifts`, green)

The three analyzer lifts — imported/free bindings in a direct builder, block-
statement bodies, and non-arrow `function` reducers — are implemented and pass
parseman's full suite (4086 tests, 0 invariant findings, 6/6 differentials,
version-lock + release gates). With CSS's reducer helpers made importable, the
**whole hole-free CSS base composes and macro-fuses** to a 208-rule static table
that parses **AST-identical to standalone `cssGrammar`**
(`COMPOSE-SIMPLIFICATION-PROOF-REDO.md` finding 1). This refutes the earlier
"a hole-free base cannot fuse" claim.

### 3.2 RESOLVED — `compose([importedBase, delta])` now re-emits a cross-referenced base's imports

**Fixed in parseman `release/0.49.0-compose-lifts` commit `e1dbc98`.** The dialect
pattern — a downstream module composing an *already-built* base plus a delta — now
macro-fuses.

The residual gap was **narrower** than first documented (the initial spec, written
against a pre-fix tarball, said the re-emit "does not fire at all" — it in fact
fired for many patterns). Real root cause: `collectBuilderImports` walked the merged
rule graph with `Object.values` (own enumerable properties), but a rule that
*another rule references* (`g.X`) is materialized as a `lazy` proxy whose definition
sits behind `_def.thunk()` — never an own property. So the imports of every
**cross-referenced inherited rule** were silently dropped. A rule referenced by
nobody was fine; the moment a third rule referenced it, its imports vanished — which
is exactly the real dialect case (css `VarCall`, referenced by its selector/value
parents, dropped `funcCall`/`isValueSlotValue`), producing the two observed symptoms
(same-package "identifiers bound by nothing", cross-package runtime-`compose()`
throw). The fix follows a rule reference to its **winning** definition via the
entry's thunk, stopping at named `lazy` references (already covered as their own
entries), with the fail-closed boundary untouched.

Regression test: `parseman test/unit/compose-direct-builder-ir.test.ts` — a base
compiled to its own module, a separate downstream module composing a delta that
overrides one leaf and inherits an import-bearing block-body rule; asserts fuse
(0 fallbacks, no runtime `compose(`), the inherited rule's import re-emitted, the
overridden rule's import NOT re-emitted, and an AST-correct parse. Fails pre-fix,
passes after. Full parseman suite green (4087 tests), both release gates green.

**Note:** for a css base to *have* importable provenance to re-emit, css's reducer
helpers must live in an importable module (the helper hoist, §4.1 / Stage B) — the
fix re-emits imports that exist; it does not invent provenance for a module-private
helper. Remaining end-to-end validation (Stage C): compose a real superset selector
tower on the factored css base and confirm AST/CST identity — see §5.

---

## 4. The two towers — the classification method, VERIFIED against the code

A superset rule falls into exactly one of: **leaf-factor-and-inherit** (not a
genuine override), **genuine override**, or **addition**. The distinction is
what a correct classification measures — the earlier "83% genuine overrides"
number counted inlined-choice structural rules and additions as overrides, which
is why it read far too high.

### 4.1 Structural rules that differ only by an inlined choice → factor + inherit

**Verified example (selector tower).** scss `Compound` (`scss-parser/src/grammar.ts:5486`)
has the **same shape** as CSS's compound — `oneOrMore(choice(…))` then
`not(pseudoColon)` — and differs by exactly two added choice arms: `g.Placeholder`
and `g.InterpolatedSimple`. `ComplexTail`, `Complex`, `SelectorTail`, `Selector`
(5511–5560) are the same shape as CSS and differ **only** by transitively reaching
that one widened choice. These are genuine overrides **today only because CSS
inlines its simple-selector-atom choice directly into `Compound`** instead of
naming it.

**Fix — the css-side factoring (behavior-neutral, AST-identical):** extract CSS's
inlined choice-points into named leaf rules (the simple-selector atom, the
combinator, the value atom, and any other inlined `choice(…)` a superset widens).
Then a superset overrides the **leaf** (adds its arms) and inherits the entire
structural tower via open-recursion. This is a one-time refactor of CSS, shared
by all three supersets.

### 4.2 Genuine overrides → the rule's own production/reducer diverges

**Verified example (value/math tower).** scss `MathProduct` / `MathSum` /
`MathUnary` / `MathTopSum` (`scss-parser/src/grammar.ts:1922–2038`) fold
arithmetic into `operation()` nodes, and `ValueLogicalAnd` / `ValueLogicalOr`
(2054–2067) add Sass `and`/`or` — CSS does neither outside `calc()`. Same input,
**different emitted node**; no factoring makes these inheritable. These are real
overrides and stay in the delta.

### 4.3 Additions → Sass-only constructs with no CSS counterpart

`@mixin`, `@if`, `@each`, `$variable` declarations, module rules, etc. These are
the legitimate delta; they are defined, not inherited, but they are **not**
overrides and must not be counted as such. Compose still frees the superset from
redefining all the CSS structure they sit among.

### 4.4 Interpolation enters at leaves

`InterpolatedValue` (1632), `InterpolatedSimple` (5128), `InterpolatedProperty`,
`InterpolatedUrlValue` — `#{…}` is admitted at atom/leaf rules; `ValueAtom` (1898)
lists `InterpolatedValue` as one choice arm. A structural rule that merely
*contains* interpolation inherits; only the leaf is overridden. This is why §4.1's
tower collapses to a leaf override.

---

## 5. The plan — staged and gated

| Stage | Work | Depends on | Gate |
|---|---|---|---|
| **A** (parseman) | Fix §3.2: re-emit a composed base's `buildImports` into the downstream fused module | — | parseman full suite; cross-package probe fuses + parses AST-identical |
| **B** (css) | §4.1 factoring: extract CSS's inlined choice-points into named leaf rules | — (parallel with A) | css parser suite + oracle AST/CST-identical; `check:macro` 0 |
| **C** (supersets) | Per dialect (scss → less → jess): override genuine-divergent rules (§4.2) + additions (§4.3), widen the factored leaves (§4.1), **delete the inherited structural skeleton**, compose on `cssBaseRules` | A + B | §1 gates, one dialect at a time |
| **D** | Re-measure the realized delta; ship 0.49.0 (publish is owner-only) | C | — |

Stage A and Stage B are independent and run in parallel worktrees. Stage C is the
payoff and cannot start until both land (it needs the fused cross-module compose
from A and the factored leaves from B). Land one dialect at a time — grammar files
do not take parallel edits.

---

## 6. Non-goals / anti-patterns

- **Do not** chase compiled-table byte-identity, or superset-source == css-source.
- **Do not** override a structural parent to admit a leaf-level construct — widen
  the leaf and let open-recursion carry it.
- **Do not** count additions (§4.3) as overrides.
- **Do not** publish 0.49.0 or advance Stage C until the §3.2 blocker fix proves
  the real dialect pattern fuses AST-identical — the capability is not real until
  the cross-module compose is demonstrated end-to-end.

## 7. Stage-B worklist + the payoff axis (enumerated 2026-08-15, all four grammars)

**The key refinement:** a leaf-factor pays off **only where the tower above the
atom is pure inheritable structure.** Where the dialect overrides that tower
anyway (different reducer / different emitted node), naming the atom saves only
the re-listing of the base arms — the tower is still a genuine override.

**High payoff — factor these:**
- **`simpleSelectorAtom`** — DONE (pilot, css `9f2ad4f89`; CompoundSelector 1619).
  **Still needed:** its twin `TopLevelCompoundSelector` (1639) inlines the same
  atom and must also reference `g.simpleSelectorAtom`, or the top-level selector
  won't inherit the widened atom. All three supersets widen it (scss +2, jess +3,
  less +9 interpolation arms); the tower above (Complex/SelectorList) is pure
  structure → inherited. This is the clean §4.1 case.
- **`calcValueAtom`** — css `CalcValue` (2224, choice 2226); jess widens it
  byte-cleanly (+`MathDollarValue`, +`InterpolatedValue`, same reducer). scss/less
  have no `CalcValue` (calc routes through their math tower) so they don't conflict.

**Partial payoff — factor, but the tower above is overridden regardless:**
- **`valueAtom`** — css `Value` (2707, choice 2720); all three widen it, but
  `ValueSequence`/`ValueList`/the math tower above are §4.2 genuine overrides in
  every dialect. jess already extracted its own `nonBlockValueAtom` (the template).
  Factoring lets a dialect inherit the `Value` node's projector and stop re-listing
  css's base arms; it does NOT let it inherit the value tower.

**Borderline — naming a terminal, single-dialect, parent overridden anyway (defer
unless Stage C needs it):** `propertyNameAtom`, `customPropertyNameAtom`,
`selectorCombinator` (css `combinator` 990, less-only +`|`).

**Already-named leaves (NO extraction; Stage-C override targets):** the body-item
choices `declarationListItem`/`stylesheetBodyItem`/`descriptorBodyItem`/… (3749–3757),
`OpaqueBodyPart`, `varFallbackComponent`, `IdentBlockOrKeyword`. css already returns
these in the rules object, so a superset overrides by name and inherits the framing.

**Genuine overrides — NOT factoring candidates (§4.2), stay in each dialect's delta:**
the value/math tower (Sass/Less arithmetic → `operation()` nodes, slash-list
semantics); `Declaration` (terminator/unterminated/`+` merge/custom-prop divergence);
the query feature/term/supports machinery; and — notably — the **at-rule prelude**:
css `AtRulePreludeSegments` (3087) scans it as raw `Any` text while every superset
replaces it with a structured value/query model. **Flag:** the raw-`Any` prelude
scan may be a css *under-structuring* (ties to the `Opaque*` chopping-block, tasks
#55/#56); if css structured its prelude, supersets could inherit more. Open question,
not resolved here.

**Net:** compose's clean, proven inheritance win is the **selector subsystem** +
the already-named **body/stylesheet framing** + the shared **terminals**. The
value/declaration/query subsystems are genuine per-dialect overrides — real, not
factoring artifacts. So a superset becomes "css base + genuine value/declaration/
query deltas + additions," not a tiny file — but the drift-prone selector and
framing duplication is eliminated and single-sourced. **Stage C proves the actual
per-dialect deletion; do not over-factor speculatively — factor an atom when a
dialect's compose demonstrably needs to inherit the tower above it.**

## 8. Stage C pilot result (2026-08-15) — mechanism PROVEN; one OPEN owner decision

Branch `stage-c-scss-selector-pilot` (`9ff4ff39d`), scss selector delta composed on
`cssBaseRules` with the fixed parseman 0.49.0.

**STEP 1 — the compose mechanism WORKS, but needed a second fix beyond parseman.**
Cross-package `compose([cssBaseRules, delta])` now fuses (0 fallbacks, 0 runtime
`compose(`, 133 kB inlined table) and parses `.a%ph > .b` with the widened
`%placeholder` leaf routed through the **inherited** `CompoundSelector`/
`ComplexSelector`. BUT parseman 0.49.0 alone did **not** unblock it: `@jesscss/
parser-shared` was a devDependency, so tsdown **bundled** the recognition grammars
as local consts, and `resolveModulePieces` can only follow the base's piece spread
through a resolvable **import** — so ~69 bundled recognition rules were silently
dropped (140/209 winners). **Fix (jess-side, behavior-neutral):** externalize
`@jesscss/parser-shared` in the css grammar build + declare it a peerDependency.
This is a Stage-B packaging requirement, not another parseman gap. Committed.

**STEP 2 — AST inherits, CST does NOT: the selector tower is a genuine CST-level
override, correcting §4.1.** Composing css's selector tower and comparing to
standalone scss on a selector corpus: **AST identical**, **CST divergent**. scss's
tower emits a structurally different concrete tree:
- different node names (`Selector`/`Complex`/`Compound` vs css `SelectorList`/
  `ComplexSelector`/`CompoundSelector`),
- coarser leaf granularity (scss one `SimpleSelector` vs css `ClassSelector`/
  `IdSelector`/`TypeSelector`),
- different shape (scss wraps combinators in a `ComplexTail` node; css inlines),
- a `not(pseudoColon)` guard scss carries and css does not.

So widening the atom **cannot** reproduce scss's current CST — earlier §4.1 was
wrong that the selector tower is a free leaf-factor inherit. It inherits at the AST
level only.

**THE OPEN DECISION (owner). Most of that CST divergence is gratuitous — scss chose
different names/granularity/shape than css.** So compose forces a choice, and it is
the same choice the whole migration turns on:
- **(A) Converge** — dialects inherit css's canonical selector CST (`CompoundSelector`,
  typed leaves, inline combinators). This IS the "one representation" goal, and it
  leans. But it **changes scss's emitted selector CST**, which ripples into eval/
  render (they consume these node shapes) and must be re-validated against the
  emitted-CSS oracle. It is a deliberate output change, not a transparent inherit.
- **(B) Preserve** — dialects keep their current CST. Then the selector tower is a
  genuine override (scss redefines it to reproduce its shapes), and the leanness win
  for selectors is lost.

§1's "AST/CST identity vs the pre-migration parse" is therefore the wrong criterion
under (A): the point of (A) is to *change* scss's gratuitously-different CST to the
canonical one. **This decision is UNSETTLED and is the owner's** — it determines
whether Stage C is "override the towers" or "converge the towers + update eval/render."
Banked regardless of the decision (all behavior-neutral, committed): the css helper
hoist, `cssBaseRules`, the `simpleSelectorAtom` factoring + `TopLevelCompoundSelector`
twin, and the parser-shared externalization.

Cross-refs: `COMPOSE-SIMPLIFICATION-PROOF-REDO.md` (the evidence), parseman
`release/0.49.0-compose-lifts` (the shipped lifts), `GRAMMAR-REVIEW-STANDARD.md`
(per-const review), `docs/state/GRAMMAR-DEDUP-LOG.md` (the live worklog).
