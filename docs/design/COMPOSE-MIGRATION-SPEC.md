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

## 1. The success criterion — SETTLED (owner P28, converge)

The migration **converges** all four dialects onto CSS's canonical CST. The
criterion is NOT "composed == the dialect's pre-migration CST" — that would forbid
the convergence, which is the whole point. Owner, P28 (2026-08-15): *"All of them
should be pulled towards CSS... the CST names for the same rules / shapes should
NOT diverge."*

When a superset composes on the CSS base and inherits a rule, it **adopts CSS's
node names, leaf granularity, and tree shape**. A gratuitously-different spelling
of the same shape (scss `Compound` vs css `CompoundSelector`; one `SimpleSelector`
vs typed leaves; a `ComplexTail` wrapper vs inline combinators) is **converged**,
not preserved. A genuinely-required difference (a construct the dialect really must
parse differently — the Sass value/math tower, `#{…}` injection, dialect additions)
stays an override.

**Gates (definition of done for any slice):**
1. **Same accepted language** — the composed dialect parses the same inputs and
   rejects the same, verified on the parser suites + corpus.
2. **Emitted-CSS oracle GREEN** — convergence changes the tree *shape*, not the
   rendered CSS; the oracle is the guard that the semantic output is preserved.
3. **eval / render / extend updated to the canonical shapes** — they consume these
   nodes; converging the CST means adapting the consumers to CSS's node vocabulary
   (this is the ripple, and it is in-scope, not a regression).
4. `check:macro` — 0 interpreter fallbacks (the composed grammar macro-fuses).
   Build/perf property, reported separately.

**Not the criterion:** compiled-grammar / fused-table byte-identity (a parseman
internal Jess never observes — owner: *"none of Jess's concern"*), and
superset-source == css-source (textual byte-count is the wrong question). Deliberate
node changes like `NamedColor → Keyword` (task #57) are the *same* convergence
principle, not regressions.

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

**Scoping correction (2026-08-15, read-only, supersedes the leaf-granularity claim
above).** The "coarser leaf granularity (scss `SimpleSelector` vs css `ClassSelector`/
`IdSelector`/`TypeSelector`)" bullet is WRONG at the AST level: there are NO typed-leaf
AST node types anywhere — css's leaf reducer builds the SAME generic `simpleSelector`
as scss (`css .../grammar.ts:1245` `BasicSelector` → `simpleSelector`). `ClassSelector`/
`IdSelector`/`TypeSelector` exist only at the **public-CST** layer, computed from leaf
text by the shared `cst-host` (`css cst-host` maps grammar type `BasicSelector` →
`.`/`#`/digit/else → typed name). So:
- **The selector AST is already fully converged across all four dialects** — every
  reducer builds the same `@jesscss/core/ast` `CompoundSelector`/`ComplexSelector`/
  `SelectorList`/`SimpleSelector`. No live consumer (eval, `ast/serialize`,
  `ast/extend/**` — which flattens compounds to text and never sees `ComplexTail`
  or typed leaves) reads the divergent grammar rule names.
- **The divergence is confined to the grammar RULE names** (scss `Compound`/`Complex`/
  `Selector`/`SimpleSelector` vs css `CompoundSelector`/`ComplexSelector`/`SelectorList`/
  `BasicSelector`), the transient `ComplexTail` reducer (never persisted), and the
  genuine leaf widenings + `not(pseudoColon)` guard (which STAY as real overrides).
- The `tree/**` ~30-file count is **legacy eval (chopping block)**, not live. The one
  live reader of the divergent public-CST names is the editor language-service, which
  already tolerates both spellings (a rename just leaves dead entries to prune).

**So §1 gate-3's "eval/render/extend updated to canonical shapes" is ALREADY SATISFIED
for selectors** — the ripple was paid when the reducers were pointed at the shared
`core/ast` constructors. Selector convergence is a **grammar-local rename/inherit**
(adopt css's rule names, inline `ComplexTail`; supersets then inherit css's typed
public-CST leaves for free), producing byte-identical AST. Cheap and low-risk, not a
consumer migration.

**THE DECISION — SETTLED: CONVERGE (owner P28, 2026-08-15).** Most of that CST
divergence is gratuitous — scss chose different names/granularity/shape than css —
and the owner ruled *"All of them should be pulled towards CSS... the CST names for
the same rules / shapes should NOT diverge."* So dialects **inherit css's canonical
selector CST** (`CompoundSelector`, typed leaves, inline combinators); scss's
`Compound`/`SimpleSelector`/`ComplexTail` shapes are converged away. This changes the
dialect's emitted CST, which ripples into eval/render/extend — that ripple is
**in-scope**, gated by the §1 criterion (same language + oracle green + consumers
updated). Where a difference is genuinely required, it stays an override; a mere
different spelling of the same shape is converged. See `DESIGN-DECISIONS.md` P28.

Banked (all behavior-neutral, committed): the css helper hoist, `cssBaseRules`, the
`simpleSelectorAtom` factoring + `TopLevelCompoundSelector` twin, and the parser-shared
externalization.

## 9. Bump-independent CST convergence worklist (enumerated 2026-08-15)

Every case where a superset emits a gratuitously-different CST node NAME/shape for an
AST that is ALREADY identical to css's = a grammar-local rename, byte-identical AST,
**no parseman publish needed** (the copy-DELETION dedup is the only bump-gated part).
Convergence direction is TO css's name. Each rename ripples into `language-service` +
`diagnostics-core` (grammarType-string consumers, ungated by pre-push) — converge those
in the same change; see [[grammar-renames-ripple-into-ungated-language-service]].

**DONE:** main selector tower (scss/jess/less `Compound`/`Complex`/`Selector`→
`CompoundSelector`/`ComplexSelector`/`SelectorList`, leaf→`BasicSelector`, `ComplexTail`
inlined) — `094eb17a6`/`12d0754a6`/`2af6d7386`; LS fix `b3eda4dce`.

**Clean batch (AST-identical, ≤1 consumer edit) — IN FLIGHT `converge-selector-cst-batch2`:**
| # | target | dialects | current→canonical | AST (shared ctor) |
|---|---|---|---|---|
| 1 | keyframe leaf | less/scss/jess | `KeyframeSelector`→`SimpleSelector` | `simpleSelector` |
| 2 | comma-tail | less/scss/jess | `SelectorTail`→inline `oneOrMoreSep` | `selist` (parent) |
| 3 | `&` node name | scss/jess | `NestingSelector`/`Parent`→`SimpleSelector` | `simpleSelector` |
| 4 | nested comma-tail | scss | `NestedSelectorTail`→inline | pass-through |
| 5 | relative complex | scss/less | `RelativeComplex`→`RelativeComplexSelector` | `relativeSelector` |
| 7 | pseudo-arg `*ComplexTail` | less/jess | inline the wrapper | pass-through |

**Entangled residuals (need per-case care, still bump-independent):**
- **NestedSelector→SelectorList** (scss): AST-identical (`selist`) but the nested list
  accepts leading combinators css's top-level does not — tied to **P20 OPEN** (root
  `> .a`), and a bare `SelectorList` name would collide with the top-level rule. Owner
  call on whether css owns a canonical relative-nested-list name.
- **Pseudo-argument tower merge** (less `PseudoArgument*`, jess `PseudoSelector*`): a
  full duplicate selector tower building the identical AST — a structural merge, not a
  rename; DC-3 ripple (`EXTEND_TARGET_TYPES`/`NTH_ARGUMENT_TYPES`). Leaf-sets differ.
- **less simple-selector leaf**: no `BasicSelector` node (bare regex + `mixinName`,
  shared with mixin-call + extend heads). Converging the CST/public-leaf name keeps the
  AST identical but can't be split cleanly from the mixin/extend paths; converging it is
  what would let LS delete the less-only `LESS_SELECTOR_TYPES` special-case.
- **nth-argument names** (less/scss/jess `Nth*`): same AST *vocabulary* but per-rule
  guards/interpolation differ — verify reducers byte-identical before treating as renames.

**GENUINE OVERRIDES — NOT convergence targets (different AST / language):** value+math
towers (`operation()`), interpolation leaves, declarations (terminator/merge/custom-prop),
at-rule preludes (css raw-`Any` scan vs structured — §7 flag), query/supports machinery,
and all dialect additions (variables, mixins, control rules, maps, modules, the extend
subsystem whose `SelectorBranch` builds a `{selector,extensions}` pair, not the AST node).

Cross-refs: `COMPOSE-SIMPLIFICATION-PROOF-REDO.md` (the evidence), parseman
`release/0.49.0-compose-lifts` (the shipped lifts), `GRAMMAR-REVIEW-STANDARD.md`
(per-const review), `docs/state/GRAMMAR-DEDUP-LOG.md` (the live worklog).
