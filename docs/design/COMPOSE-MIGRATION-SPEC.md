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

### 3.2 BLOCKER — `compose([importedBase, delta])` does not re-emit the base's imports

The **dialect pattern** — a downstream module composing an *already-built* base
plus a delta — does **not** fuse under 0.49.0. The macro emits the base's reducer
bodies but does not re-emit the module imports those bodies reference:

- **same-package** (delta module does not itself import the base's helpers):
  `N identifier(s) are read but bound by nothing … would throw ReferenceError`
  → fail-closed refusal.
- **cross-package** (`scss-parser` importing `cssBaseRules` from
  `@jesscss/css-parser/grammar`): the macro cannot lower it (`ref() used before
  .define()`), leaves a runtime `compose()`, which throws (`… references module
  import(s) … a runtime compose() cannot supply`).

Repro: `docs/design/compose-proof-probes/scss-cross-package-compose-probe.ts`.
Root cause: the lift harvests import provenance for builders **in the module
being compiled**; it does not propagate a composed base's own import manifest
(`buildImports`, present in the lifted `dist`) into the module that composes onto
it. **Fix (parseman lane, folds into the unpublished 0.49.0):** when the downstream
compose macro incorporates an imported composed base, read that base's
`buildImports` manifest and re-emit those imports into the fused downstream
module. Acceptance: the cross-package probe fuses (0 runtime `compose(`,
0 fallbacks) and parses AST-identical.

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

Cross-refs: `COMPOSE-SIMPLIFICATION-PROOF-REDO.md` (the evidence), parseman
`release/0.49.0-compose-lifts` (the shipped lifts), `GRAMMAR-REVIEW-STANDARD.md`
(per-const review), `docs/state/GRAMMAR-DEDUP-LOG.md` (the live worklog).
