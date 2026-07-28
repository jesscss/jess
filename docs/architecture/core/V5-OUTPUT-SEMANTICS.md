# V5 Output-Formatting + Evaluation-Semantics Reference (STEP 0)

The **single scannable cheat sheet** every render / DIFF / eval agent reads
_before_ debugging an output or evaluation mismatch — so these rules stop being
re-derived (and mis-called) one at a time.

- **Correctness = the documented intended v5 design** (DD `E1`), NOT less@4, NOT
  the alpha `.css` test-data, NOT the dying eval code. When actual output
  disagrees with a rule below, the rule wins unless the rule is marked
  **OPEN**/**PROPOSED**.
- Each entry: **the rule**, a tiny **INPUT → OUTPUT** example, the **WHY**, and a
  **cross-ref** to its `DESIGN-DECISIONS.md` (`DD`) row / detail doc / memory note.
- `DD Xn` = row `Xn` in [`DESIGN-DECISIONS.md`](./DESIGN-DECISIONS.md).
  `memory:<name>` = `.claude/projects/-Users-matthew-git-oss-jess/memory/<name>.md`.

---

## A. Output formatting (serialization)

### A1 · Un-operated VALUES = source-verbatim

**Rule.** Un-operated value literals — dimensions, colors, keywords, quoted
strings — emit their **source bytes**. Only **COMPUTED** results (values that an
operation actually touched) and **`compress` mode** canonicalize.

```
1.0px            → 1.0px            (not 1px)
2PX              → 2PX              (case preserved)
1e3px            → 1e3px
#989             → #989             (not #998899)
rgb(50%,0,0)     → rgb(50%,0,0)     (verbatim; see A6)
(2px + 3px)      → 5px              (computed → canonical)
```

**Why.** v5 treats valid CSS as a superset that passes through unchanged;
round-tripping un-operated literals through the numeric/color model mangles
precision + spelling for zero benefit. Diverges from 4.x (which canonicalizes
un-operated dimensions).
**Ref.** DD `V1`, `V2` · `VALUE-LITERAL-TAG-SPEC.md` §0 ·
`memory:v5-preserve-unoperated-values-verbatim`, `memory:css-superset-verbatim-passthrough`

### A2 · OPERATORS / SEPARATORS = SPACED

**Rule.** `/`, `+`, `-`, `*` and list commas emit **with spaces around them**,
regardless of source spacing. They are **separators, not values** — the
verbatim-value rule (A1) does NOT govern them. Do **not** copy 4.x's tight
`12px/16px` convention.

```
12px/16px               → 12px / 16px
10px / 2px + 6px        → 10px / 2px + 6px   (preserved math, spaced)
grid-area:1/2/3/4       → grid-area: 1 / 2 / 3 / 4
a,b,c                   → a, b, c
```

**Why.** Separators are structural tokens the parser owns (DD `C2`); their
spacing is a formatting decision of the emitter, not source-verbatim data. 4.x's
tight slash was a legacy quirk, not the v5 target.
**Ref.** DD `F1`

### A3 · EXCEPTION — `:nth-*()` An+B microsyntax stays unspaced

**Rule.** The `An+B` microsyntax inside `:nth-child()` / `:nth-of-type()` / etc.
is **selector syntax**: unspaced, never evaluated, never routed through the
value/operator path (so A2 does NOT apply).

```
:nth-child(2n+1)   → :nth-child(2n+1)   (not 2n + 1)
:nth-child(-n+3)   → :nth-child(-n+3)
```

**Why.** `2n+1` is one grammar token-run in the selector, not an arithmetic
expression; treating its `+` as an operator would both mis-space it and risk
evaluating it.
**Ref.** DD `F2`

### A4 · CSS-function-SHAPE = verbatim

**Rule.** `name(...)` with **NO space** before `(` passes through **verbatim**,
even when `name` is not a real CSS function.

```
solid(#a8000b)   → solid(#a8000b)
translateX(3px)  → translateX(3px)
```

**Why.** The no-space call shape is unambiguously a function token; the engine
must not "helpfully" evaluate or reformat an unknown function. Contrast A5 (a
**space** before `(` is grouping, not a call).
**Ref.** DD `F3` · `memory:css-superset-verbatim-passthrough`

### A5 · Grouping-parens dissolve after evaluation

**Rule.** `keyword (expr)` — a **SPACE** then parens — is **math grouping**. Once
the expression computes, the grouping-parens do **NOT** survive to output.

```
solid (@a*.66 + @b*.33)   → solid #a8000b      (parens gone)
width: (2px + 3px)        → 5px                (never (5px))
```

Corollary for `ast/`: a **space** before `(` must stay grouping — `solid (x)`
must **not** collapse into the no-space function shape `solid(x)` (A4).
**Why.** Grouping-parens exist only to control evaluation order; they are not
part of the computed result's spelling. Symmetric with the plain
`(2px+3px) → 5px` case.
**Status.** SETTLED — owner-confirmed (2026-07-18), demonstrated by operation
tests + `.less` fixtures. Distinct from A4.
**Ref.** DD `F4`

### A6 · CSS value-functions un-operated = bare verbatim Call

**Rule.** CSS-shaped `rgb` / `rgba` / `hsl` / `hsla` calls with **three or more
argument slots and no enclosing operation** emit **VERBATIM** (a `Call` node
tagged as a color, NOT an eager-invoked native fn). Modern space/slash and
relative forms arrive as one nested structured slot and follow the same
three-slot rule. Less one-/two-slot overloads (for example `rgba(#fff)` and
`rgba(#fff, .5)`) dispatch normally; malformed numeric arities reach the
call-level `functionMode` policy. Run a selected fn for a CSS-shaped call only
when the value is **operated** (`lighten(hsl(...))`, arithmetic) or when a Less
overload/variable argument requires evaluation (`hsl(@h, ...)`).

```
color: rgb(50%,0,0)       → color: rgb(50%,0,0)     (bare, verbatim)
color: hsl(200,50%,40%)   → color: hsl(200,50%,40%)
rgba(#fff)                → computed Less color      (one-slot overload → invoke)
lighten(hsl(200,50%,40%)) → #.. (computed)          (operated → invoke)
hsl(@h, 50%, 40%)         → #.. (computed)          (Less arg → invoke)
```

**Why.** Eager-invoking + round-tripping through rgb mangles precision and
spelling (A1 for functions). Only a real Less operation forces the compute.
**Ref.** DD `F5`, `V2` · `memory:css-superset-verbatim-passthrough`

### A7 · `:is()` compaction — compact PREFIX-FACTORED nesting join

**Rule.** Collapsing a nested `&`-less descendant `B` onto its accumulated
ancestor `A` emits `<A> <combinator> render(B)`, where **each side** wraps in a
single `:is(...)` **iff it is a multi-branch comma list** (a single selector joins
plainly). `A` is emitted **ONCE**, as **one opaque unit** (it may already carry an
`:is()` from a shallower level) — it is **never** repeated inside the child's
`:is()` and **never** cartesian-distributed.

```
render(side) = side.isMultiBranchList ? `:is(${branches.join(', ')})` : side
```

- **`&`-based** child is a **different** path: each `&` substitutes over the full
  cartesian ancestor array (no `:is()`) — the `selectors`-fixture cartesian form.
- a rule's **own top-level** header (no ancestor) stays a plain comma list.
- The extend engine's own `:is()` grafting (DD `X3`) is a **separate**, correct
  path — don't conflate it with this nesting compaction.

```
.a, .b { .c {…} }      →  :is(.a, .b) .c {…}           (multi × single)
.a { .c, .d {…} }      →  .a :is(.c, .d) {…}           (single × multi)
.a, .b { .c, .d {…} }  →  :is(.a, .b) :is(.c, .d) {…}  (multi × multi, ONE row)
.a, .b { & .c {…} }    →  .a .c, .b .c {…}              (& nesting → cartesian)
.a, .b {…}             →  .a, .b {…}                    (own header stays a list)

#…#deux { #fourth,#five,#six { .seven,.eight>#nine {…} #ten {…} } }
   → #…#deux :is(#fourth, #five, #six) :is(.seven, .eight > #nine) {…}
   → #…#deux :is(#fourth, #five, #six) #ten {…}
```

**Why.** v5 keeps output nested + compact instead of 4.x's fully-expanded
cartesian cascade; the prefix is factored so a deep multi-selector block stays one
row per rule instead of a combinatorial explosion. **Supersedes** the earlier
verbose form that repeated the full ancestor prefix inside the `:is()`
(`:is(A x, A y) …`) and cartesian-expanded a rule's own multi-branch header —
owner ruling 2026-07-18; the corpus `rulesets` golden was reconciled to this form.
**Ref.** DD `O2`, `X3` · `EXTEND-SEMANTICS.md` §3/§5 ·
`memory:v5-is-compaction-rule` · `serialize.ts` `opaqueJoin`/`wrapIsList`/`flatten`

### A8 · collapseNesting + adjacent-sibling merge

**Rule.** Nesting collapse is **per-fixture** (`styles.config`): the less.js
`.css` expected output defaults **FLAT**; the Jess CLI defaults **NESTED**
(`collapseNesting:false`). Adjacent same-selector sibling merge is **NARROW** —
same parent-key **AND** byte-identical header **AND** strict adjacency. Merge
(`+:` / `+_:`) anchors at the **LAST** occurrence.

```
Jess CLI default:      .a { .b {…} }     stays nested
less.js expected `.css`: flattened
merge chain a; …; a:   emits at LAST a's position
```

**Why.** v5's default is authored-structure-preserving; 4.x flatten is an opt-in
flag owned by `jess-plugin-less`.
**Ref.** DD `O1`, `O2`, `M1` · `memory:less-v5-default-collapsenesting-false`,
`memory:fixture-v5-vs-4x-legacy-convention`, `memory:spine-merge-last-occurrence-anchor`

### A9 · COMPUTED numbers = shortest decimal within 1e-10, in every position

**Rule.** A **computed** number emits the shortest decimal lying within a
**relative** tolerance of `1e-10` of the double. Noise removal, not a precision
limit: `String(n)` is already shortest-round-trip, so it is obliged to print
`0.30000000000000004`; this is the tolerance-aware variant. **No** significant-figure
cap, **no** per-unit policy. An **exact integer is never trimmed** (no float noise to
remove). Scientific notation is never emitted (CSSOM §6.7.2). The same value spells
itself identically in a declaration value, an interpolation splice, a property name,
and a selector — there is no per-position variant.

```
0.1 + 0.2        → 0.3                (noise removed)
100% / 3         → 33.333333333%      (digits are earned; no cap shortens a third)
pi()             → 3.1415926536       (same bytes spliced: ~"@{n}" → 3.1415926536)
15.4px + 10cm    → 393.3527559px      (cm→px is 96/2.54; a cap would destroy this)
0.0000001 * 0.01 → 0.000000001        (8 dp used to flatten this to 0)
123456789012     → 123456789012       (exact integer, untouched)
1.50000px        → 1.50000px          (un-operated literal → A1, not this rule)
```

**Why.** One policy with one owner. The predecessor was `round(n, 8)` inlined at
every emit site plus a full-precision escape on the interpolation path, so `pi()`
printed two ways in one stylesheet depending on which code reached the serializer.
A decimal-place floor is also the wrong axis: it annihilates small magnitudes and
under-trims large ones.
**Ref.** DD `V4` (the ruling; `F6` cross-refs it) · `../../design/numeric-precision-policy.md` ·
`packages/core/src/ast/format-number.ts` · closes SEMANTIC-INVARIANTS `S1`

---

## B. Evaluation semantics

### B1 · Escaped `~"..."` = opaque Anonymous (never numeric-sniffed)

**Rule.** An escaped string `~"..."` is an **opaque Anonymous** value — never
parsed as a number for comparison.

- `=` cross-compares by **content**: `3 = ~"3"` → **true**.
- `<` / `>` against a number = **not-comparable** → the guard does **not** fire.

```
guard (3 = ~"3")   → true   (content match)
guard (~"3" > 2)   → guard does not fire (not comparable)
```

**Why.** Escaping opts the value OUT of the numeric model; sniffing it back into
a number would defeat the escape.
**Ref.** DD `V3`

### B2 · Mixin self-reference = parent-exclusion (no-op, never errors)

**Rule.** A non-parametric ruleset self-call excludes the **enclosing** mixin
from its own candidate set — it is a **no-op**, and **NEVER** an error. (A
parametric self-call with different args legitimately recurses; a genuine runaway
with a bad guard is the only error, via a high depth backstop.)

```
.a { color: red; .a(); }   → .a { color: red; }   (self-call excluded, no error)
```

**Why.** Same "excluded because it can't make progress" principle as no-cyclic-vars
(DD `R4`) — not "recursion detection".
**Ref.** DD `R8`

### B3 · Mixin var-unlock = low-priority leak

**Rule.** A variable unlocked by a mixin call is a **low-priority** binding: a
**lexical** binding always wins; the leaked var is used **only** where nothing
lexical binds.

```
@c: blue;
.m() { @c: red; }
.x { .m(); color: @c; }   → color: blue   (lexical @c wins over the leak)
```

**Why.** Mixin-injected bindings must not silently override the caller's own
lexical scope; they fill gaps, not shadow.
**Ref.** DD `R9`

### B4 · Bare `@var` in an at-rule prelude = HARD ERROR

**Rule.** A bare `@var` in an at-rule prelude is a **hard error** in v5
(stricter than 4.x's warning). The parser should recognize the removed shape,
report a fatal unsupported-syntax diagnostic, and give `@{var}` interpolation as
the exact migration target.
**Exception:** a `@var` inside a **declaration-value paren** is fine.

```
@supports (@cond) {…}      → ERROR   (bare @var in prelude)
@supports (@{cond}) {…}    → ok      (interpolation is the migration target)
```

**Why.** Preludes are structured, parser-owned token streams (DD `C2`, `P2`); a
bare `@var` there is ambiguous, so v5 rejects rather than guesses.
**Ref.** DD `P7` · `memory:less-supports-variable-prelude-strict`

### B5 · `if()` / `boolean()` / `not()` = structured conditions, branch-lazy

**Rule.** These are **first-class structured conditions** (no parse-time
name-special-casing), and they are **branch-lazy** — the **untaken** branch is
**not evaluated**.

```
if(true, @a, @undefined)   → @a         (@undefined never evaluated)
if(false, 1/0, 7)          → 7          (1/0 never evaluated)
```

**Why.** Conditions are control flow; evaluating the dead branch would surface
errors/side-effects that never logically run.
**Ref.** DD `P3`, `P8`

### B6 · `@import (reference)` = hidden rules, visible only where pulled in

**Rule.** Rules from an `@import (reference)` are **hidden** from normal output;
they become visible **only** where pulled in via `:extend` or a mixin call —
**per-branch** visibility. Implemented as a **cheap flag**, not by marking nodes.

```
@import (reference) "lib";   → emits nothing on its own
.x:extend(.lib-thing) {…}    → the referenced rule surfaces here only
```

**Why.** `reference` imports are a dependency surface, not output; visibility is
a property of the _pull site_, so a flag (not node mutation) is the leanest model.
**Ref.** DD `A7`

### B7 · Resolve-failure = eval error unless explicitly optional; NO cyclic vars

**Rule.** ANY failed resolve is a **hard EVAL ERROR**, except an explicitly
**OPTIONAL** resolve (→ sentinel). There are **NO cyclic variables** — cycles are
handled by per-declaration-node **exclusion** (`@a:1; @a:@a+1` → `2`), not a
recursion depth-cap.

```
color: @undefined;    → EVAL ERROR
@a: 1; @a: @a + 1;    → 2   (second decl excludes only itself)
```

**Why.** No silent `@name`-as-literal passthrough; failures must surface. The
depth-cap in `ast/` is a load-bearing STOPGAP until exclusion fully lands.
**Ref.** DD `R3`, `R4` · `memory:v5-resolve-failure-is-eval-error-unless-optional`

---

## Docusaurus (L3) coverage gaps — flagged, NOT blocking

These feed the existing 3-location docs task ([`DOC-COVERAGE.md`](./DOC-COVERAGE.md)),
not this doc. Rules with solid L3 coverage already: A1 (`verbatim-values`), A7 /
A8 (`output-model` + `selector-compaction`), B7 (`variables` / guards).

The output-formatting gaps below are now **CLOSED** — each has a dedicated Advanced
page on both the Less and Jess sites (docs-only landing, 2026-07-18):

- ~~**A2 operators/separators spaced + comma value-list normalization**~~ →
  `advanced/value-formatting` (Less) · `06-Advanced/08-value-formatting` (Jess).
- ~~**A3 `:nth-*()` An+B exception**~~ → same value-formatting pages.
- ~~**A4 / A5 function-shape vs grouping-paren dissolve**~~ → `verbatim-values`
  (§ added, both sites).
- ~~**A6 bare `rgb`/`hsl` verbatim Call**~~ → `verbatim-values` (§ added) +
  `color-output` (both sites).
- ~~**A7 compact `:is()` nesting-collapse**~~ → `advanced/selector-compaction`
  (Less) · `06-Advanced/09-selector-compaction` (Jess).
- ~~**A9 number precision (shortest decimal within 1e-10, every position)**~~ →
  `advanced/number-precision` · `06-Advanced/10-number-precision`.
- ~~**Alpha colors → `rgba`; alpha-hex preserved; gamut clamp**~~ →
  `advanced/color-output` · `06-Advanced/11-color-output`.

Still thin or absent on the user-facing sites (evaluation-semantics gaps):

- **B1 escaped `~"..."` comparison semantics** — undocumented.
- **B3 mixin var-unlock leak priority** — undocumented.
- **B4 bare-`@var`-in-prelude hard error** — undocumented (migration-relevant;
  belongs on a Less migration page).
- **B5 branch-laziness of `if()`/`boolean()`** — conditions are documented but
  laziness isn't stated.
- **B6 `@import (reference)` per-branch visibility** — imports page exists; the
  reference-visibility nuance is not spelled out.
