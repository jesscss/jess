# Semantic Invariants — the semantics-governance checklist

Canonical, tool-neutral checklist for anyone (human or agent) deciding **what
Jess emits** — value serialization, selector composition, dialect recognition,
and any behavior a user could observe in output CSS. The sibling of
[`docs/perf/V8-ARCHITECTURE.md`](../perf/V8-ARCHITECTURE.md), which governs what
Jess _costs_. Same contract: every entry is a reviewer question that needs
**evidence, not a verdict** — **RULE** · _why_ · **INCIDENT** · **DETECTOR** ·
**STATUS**.

This document does not restate owner rulings. The rulings live in the ledger,
[`DESIGN-DECISIONS.md`](./core/DESIGN-DECISIONS.md), and
this checklist tells you when you are obligated to consult or extend it.

**STATUS vocabulary** — every invariant carries one, because a list that
presents an aspiration and a gate in the same voice trains reviewers to skim
both:

- **GATE-READY** — a detector exists or is a small, obvious build; violations
  are countable today.
- **BUILDABLE** — the detector is specified here and cheap, but does not exist.
- **MIGRATION** — the tree violates this in known, counted places. It is a
  burn-down with a reviewer obligation ("do not add row N+1"), not a gate.
- **REVIEWER-ONLY** — not mechanizable. It survives on the reviewer refusing to
  pass it without a cited artifact.

---

## Why this document exists — the incident

`emitValueInterp` ([`serialize-value.ts:34`](../../packages/core/src/ast/serialize-value.ts))
emits an interpolated `Dimension` at full double precision while the same value
in a declaration gets `round(number, 8)`, so `pi()` prints `3.14159265` or
`3.141592653589793` depending on the path it took. Landed `3031131ce` with
`--no-verify`.

It is worth being precise about how far it got, because every stage was a place
a check could have stood and none did:

1. **Justified from the reference implementation.** The commit message reads
   "less.js applies its 8-dp numPrecision rounding only when a Dimension is
   emitted as a declaration VALUE… An interpolated dimension is serialized at
   EVAL time with no numPrecision." That is a description of a _leak_ in
   less.js's context threading. Ledger rows **E1**, **E2**, and **E5** already
   forbade this justification. Nothing asked.
2. **Pinned by six tests that pinned the divergence.** The tests asserted that
   the two positions print _differently_. A test suite can lock in a defect as
   firmly as it locks in a rule.
3. **The pins were deleted.** `interp-number-precision.test.ts` was removed in
   `2bd16eb89` ("delete parse host bridge") — an unrelated refactor. `grep -rn
emitValueInterp packages --include=*.test.ts` returns nothing. The behavior
   ships today with no test.
4. **The cited evidence was deleted too.** The commit's proof was "alpha-oracle
   differential MATCH 64 unchanged". `alpha-oracle-differential.test.ts` and
   `alpha-oracle-baseline.json` went in that same commit;
   [`GOAL1-SCORECARD.md`](./core/archive/GOAL1-SCORECARD.md) now
   carries a banner saying its counts are not evidence of anything.
5. **It was promoted to a language feature.** It is documented for users at
   `packages/docs-content/docs/less/advanced/number-precision.md` — where the
   stated rationale is "This mirrors less.js" — and, with no rationale at all,
   at `packages/docs-content/docs/jess/06-Advanced/10-number-precision.md`.
   Jess is a new language. "Mirrors less.js" is not available to it as a reason.
6. **The code does more than the rule says.** `evalBytesInterp`
   ([`serialize.ts:3717`](../../packages/core/src/ast/serialize.ts)) diverges
   from `evalBytes` (`:3703`) in _three_ ways, not the one that was documented:
   it emits at full precision, it calls `evalValue` instead of `evalValueSlot`
   (losing authored slot layout), and **it never calls
   `validateValueGroupUnits`** — so a unit error that is a hard error in a
   declaration value is silently accepted in an interpolation. Nobody decided
   that. It rode along.

**This was not a knowledge failure.** The rule that forbids it (E1/E5) was
already SETTLED and had already caught this exact mistake once — see **S2**
below. What was missing was an obligation to check.

---

## 1. A rule is stated over the construct, never over the code path

**RULE:** a behavior must be statable as a rule about a **construct** — a value
kind, a selector shape, an at-rule — without naming the code path, call site,
evaluation stage, or bug that prompted it. If the sentence needs the words
"when it reaches", "at eval time", "on the … path", or "because the context
carries no …", it is a description of the implementation, not a rule.

_Why:_ this is the difference between a language and an accretion of
special cases. A rule stated over a construct can be checked against every
other construct; a rule stated over a path can only be checked against itself,
so it never conflicts with anything and never gets caught.

**INCIDENT:** S1. Note that the _draft_ form of this invariant — "statable
without naming the case that prompted it" — does **not** catch it: "an
interpolated dimension keeps full precision" is a perfectly general sentence
that names no case. It names a _path_. The path/construct distinction is the
whole content of this invariant.

**DETECTOR:** none. Read the rule as written in the JSDoc, the ledger row, or
the user-facing doc, and ask whether it survives being restated as "a
`<construct>` emits `<bytes>`". `emitValueInterp` cannot be: the construct is
"a computed `Dimension`", and the sentence needs the splice site to be true.
**STATUS: REVIEWER-ONLY.**

## 2. The same value prints the same bytes regardless of position

**RULE:** a value that compares equal emits identical bytes in every position —
declaration value, interpolation splice, property name, selector, at-rule
prelude, guard operand. Position may change _whether_ a value is emitted; it
must not change _how_ it is spelled. Provenance may legitimately change
spelling (an un-operated `1.0px` stays `1.0px` per ledger **V1**) — but that is
a property of the value, and it therefore travels with it into every position.

_Why:_ this is the user-visible definition of a language having a value model
at all. Once bytes depend on position, every downstream comparison —
deduplication, extend matching, `Map` keys built from canonical text — silently
depends on where the value was standing.

**INCIDENT:** S1 (precision + the two undocumented riders), S3 (`, ` vs `,` in
selector arguments).

**DETECTOR: BUILDABLE, and it does not exist.** A positional-equivalence
fixture: one source file binding a set of values (computed dimension, un-operated
literal, color, quoted string, list) and emitting each in all six positions;
the assertion is that the substring emitted for a given binding is identical
across positions, with a **named, ledger-cited allowlist** for deliberate
divergences. This is roughly one fixture and one test file. Today the repo has
**no test asserting anything about value-vs-position byte behavior** — the only
one that ever existed asserted the divergence and was deleted.
**STATUS: BUILDABLE.** Known violations: 1 documented (S1) + 2 undocumented
riders on it + 1 cross-dialect (S3).

## 3. A policy has one owner

**RULE:** numeric precision, quantization, color format selection, list glue,
whitespace normalization, and escaping are **policies**. Each has exactly one
module that decides it, and every emit site reads that decision. A policy
constant appearing at a call site is a violation even when its value happens to
match every other call site.

_Why:_ invariant 2 is the symptom; this is the cause. Distributed constants do
not diverge on the day they are written — they diverge on the day someone
changes one of them for a good local reason. This invariant is what makes the
next S1 impossible rather than merely detectable.

**INCIDENT:** S1. Also **S6**: `packages/fns/src/less/fadein.ts:30` quantizes
alpha with `Math.round(newAlpha * 1e12) / 1e12` while
`packages/fns/src/builtins/color-helper.ts:46` quantizes the same quantity with
`round(newAlpha, 8)` — two precisions for one physical quantity, in two
implementations of one function family that ledger **C6** requires be merged.

**DETECTOR: GATE-READY.** There is no precision-policy object anywhere in the
tree; the literal is inline at every site. Baseline, verified:

```sh
grep -rn "round(" packages/core/src/ast/*.ts | grep -v "/round.ts"
```

→ **7 sites passing a literal `8`** (`serialize-value.ts:18`,
`literal-tag.ts:105`, `color.ts:118,137,149,150,151`) and **4 bare integer
roundings** (`color.ts:95` ×3, `:103`), across 3 files. None reads `e.modes` or
any policy field. The gate is a lint with a zero-debt ledger, modelled exactly
on `verify:parser-runtime-boundary` (see invariant 6): precision literals are
legal in the policy module and nowhere else. Color format is the harder half —
it is a per-value field chosen by three different rules in three kernels of
`packages/fns/src/builtins/color-helper.ts` (`withAlpha` `:45`, `mixColors`
`:91`, `colorBlend` `:119`) — and needs a stated policy before it can be gated.
**STATUS: GATE-READY** for numeric precision; **MIGRATION** for color format.

## 4. Valid CSS is dialect-invariant

**RULE:** an input that is valid CSS is **accepted by all four dialects and
emits identical bytes from all four**. AST shape may differ where a dialect
genuinely carries extra structure; output may not. There is no such thing as a
dialect-specific reading of plain CSS.

_Why:_ CSS is the shared floor, not four parallel re-implementations of a
common subset. Divergence here is never a feature — no dialect's definition
says anything about CSS that another's contradicts — so every instance is a
bug by construction. That is what makes this invariant unusually strong: unlike
invariant 5, it needs no judgement call.

**INCIDENT:** S3, S4 — currently the only two documented valid-CSS divergences,
and _both_ are caused by invariant-6 violations (parser-side joins and SCSS's
text-valued pseudo arguments). That is the whole-system finding: fixing 6
closes 4 for free.

**DETECTOR: BUILDABLE, and it does not exist.** A conformance corpus of valid
CSS parsed and serialized by all four parsers, asserting byte-identical output.
This is item **W12** ("Cross-dialect leakage suite") in
[`DIALECT-ARCHITECTURE-AND-ERROR-COVERAGE.md`](./parser/DIALECT-ARCHITECTURE-AND-ERROR-COVERAGE.md),
recorded as unimplemented. There is no cross-dialect harness in the repo today:
of the three test files importing more than one parser, none feeds one input to
all four, and `test/ast-shape/shape-stability.test.ts` — the closest thing —
imports only three parsers and uses **per-dialect disjoint corpora**.
**STATUS: BUILDABLE.** Known violations: 2 (S3, S4).

## 5. Divergence is licensed by the dialect's own definition, and recorded where it is introduced

**RULE:** where dialects differ _above_ the CSS floor, the difference must be
demanded by that dialect's own definition — its syntax, its type model, its
compatibility contract — and must be recorded in the ledger at the moment it is
introduced, not reconstructed later. "Dialect X's parser happens to do this" is
not a definition.

_Why:_ invariant 4 is the floor; this governs the superset above it. Unlicensed
divergence is how four grammars become four languages. Recording is half the
rule: a divergence discovered by archaeology has already cost more than it
would have to write down.

**Boundary with invariant 4:** if the construct is valid CSS, 4 applies and 5
never licenses anything. 5 only operates where a dialect adds syntax CSS does
not have. A "divergence" on plain CSS is not a candidate for licensing — it is
invariant 4's bug.

**INCIDENT:** the four tracked pseudo-argument divergences (D1–D3, plus the
`nth-of-type` `of S` restriction) in
[`PSEUDO-ARGUMENT-CONSOLIDATION-DESIGN.md`](./core/PSEUDO-ARGUMENT-CONSOLIDATION-DESIGN.md)
§7a. All four are on _invalid_ CSS, all four are recorded, and the tracker's own
verdict on each is that no dialect definition licenses it — which is the correct
shape of an answer: recorded, and marked unjustified rather than rationalized.

**DETECTOR: REVIEWER-ONLY.** Demand: for a diff that adds or changes a
per-dialect production, either a ledger row / §7a tracker entry, or the
statement that behavior is unchanged. The tracker table is the artifact; its
existence is what makes this reviewable at all. **STATUS: REVIEWER-ONLY.**

## 6. The parser owns structure — and neither side re-derives it from bytes

**RULE:** ledger **C2** / `TREE2-CONSTITUTION.md` **P0**. Two halves, and the
second is routinely forgotten: (a) core never serializes a structured node and
scans the string to recover structure; (b) **the parser never joins structure
into text either.** A grammar that emits `` `${nth} of ${list.map(complexCanonical).join(', ')}` ``
has destroyed the structure at the only point in the system that had it.

_Why:_ re-derivation is not merely wasteful — it is **lossy in a way that
changes semantics**. A byte scan cannot distinguish a structural token from the
same character inside a string. `compoundHasAmpersand`
([`nodes.ts:527`](../../packages/core/src/ast/nodes.ts)) decides whether a
compound contains a parent reference by `pseudoCanonical(sim).includes('&')`;
the probe for whether that is sound is `:not([title="&"])`. And because
canonical text is what the two joins in S3 disagree about, this invariant is
the upstream cause of an invariant-4 violation.

**INCIDENT:** S3, S5, and perf catalogue row **R1** — `selectorAtoms`
([`serialize.ts:1268`](../../packages/core/src/ast/serialize.ts)) regex-tokenizes
serialized selector text at **6 call sites** (`:1287, :1291, :1303, :1307,
:1345, :1379`); two of the six have the `CompoundSelector` directly in hand,
three are blocked by `MixinDef.name` / `MixinCall.path[].sel` being typed
`string` in the node model. This is one of the sites where the perf checklist
and this one point at the same line for different reasons.

**DETECTOR: MIGRATION, with a broken pin.** A survey of `packages/core/src/ast`
counts **~62 re-derivation sites in 7 groups** (selector 27, `@{}` re-scan 5,
`calc` operand unwrapping 8, at-rule prelude 11, declaration bytes 3, literal
re-typing 12, import options 4), plus 181 raw scan sites in legacy `tree/`. Some
have no structured alternative today and are parser/node-model gaps rather than
authoring mistakes — the burn-down needs that split made explicitly, per group.

The existing pin does not see any of it, and the reason is quotable:
`eslint.config.mjs:273-286` scopes `local/no-serialize-rederivation` to
`packages/*/src/ast/**` and then sets `ignores: ['**/serialize*.{ts,tsx}', …]`,
with the comment "serializers/debug are the legitimate owners of byte scanning,
so they are excluded." For a _perf_ rule that is defensible. For this invariant
it is backwards: the serializer is precisely where structure gets flattened,
and ~36 of the ~57 scans live in the excluded file. The rule is also `warn`, and
same-function taint only, so the dominant shape here —
`selectorAtoms(compoundCanonical(x))`, a producer and consumer one call apart —
is invisible to it twice over.

The working template exists: `pnpm run verify:parser-runtime-boundary:clean`
enforces this same prohibition on the four parser packages, AST-based and
TS-aware, with a zero-debt ledger at `scripts/parser-runtime-boundary-debt.json`.
Extending it to `packages/core/src/ast` with the ~62 sites as seeded debt turns
this from prose into a ratchet. **STATUS: MIGRATION.**

## 7. The parser rejects the ill-formed, not the meaningless

**RULE:** a parser rejects input that is not in the grammar. It does not reject
well-formed input for being semantically meaningless — an unknown property, an
unknown function, an unknown at-rule, a nonsensical unit, an unresolvable
reference. Those are diagnostics owned by the language service and by
evaluation, where they can be reported without stopping the parse.

**This is not "the parser never rejects on semantic grounds."** The ledger
already settles three cases where it does, and they are all the same kind:
a construct the dialect's _definition_ removes or forbids, decidable from
syntax alone — **A3** (backtick JS removed in v5; the grammar recognizes the
shape and reports a fatal unsupported-syntax diagnostic), **P7** (bare `@var`
in an at-rule prelude is a hard error with the exact `@{var}` migration),
**P4** (Sass+ rejects invalid CSS that Sass tolerates). Contrast **P2**:
custom-property values and unknown at-rule preludes are permissive token
streams precisely because _unknown_ is not _ill-formed_.

The line is: **the grammar decides grammaticality; nothing else.** Rejecting
`@unknown-thing` because we do not recognize the name is a violation; rejecting
`` `js` `` because v5 has no such production is not.

_Why:_ a parser that rejects on meaning cannot produce a tree for tooling to
work on, which costs completions and diagnostics on exactly the broken input
where a user needs them most.

**DETECTOR: REVIEWER-ONLY** (a permissive-corpus fixture — unknown properties,
functions, at-rules, units — parsing clean in all four dialects would gate the
common case, and is the same harness invariant 4 needs). Demand: for any new
rejection in a grammar, which ledger row licenses it, or which production the
input fails to match. **STATUS: REVIEWER-ONLY.**

## 8. Justification is the spec, the ledger, or coherence — never the reference implementation

**RULE:** "less.js does X", "dart-sass does X", "the differential goes green" are
observations, not justifications. A semantic decision cites the CSS spec, a
SETTLED ledger row, or a coherence argument against the rest of the language.
Ledger **E1**/**E2**/**E5** already say this; this invariant is the obligation
to _demonstrate_ it, which is what was missing.

**A green differential is the trap.** The corpus is an imperfect encoding of the
intended design (**E1**), and it encodes 4.x behavior wherever v5 diverges
deliberately. So a fixture flipping `DIFF → MATCH` is _ambiguous_: it is either
a fix or the erasure of an intended divergence. It must be read against the
recorded expectation, never taken as a pass on its own.

**INCIDENT:** S1 and **S2**. S2 is why this invariant is not hypothetical:
`23b78263e` re-anchored `+:`/`+_:` merge to first-occurrence, justified as
"Port the ast/ engine's +/+\_ merge fold to less.js 4.x `_mergeRules` semantics",
with the evidence "Differential oracle: merge/merge.less DIFF -> MATCH
(byte-identical to alpha)" and the explicit line "Supersedes the earlier v5
last-occurrence intent". It also edited the design docs to agree. It was caught
and reverted **only because ledger row M1 already existed** and contradicted it
in writing. S1 had no such row, and shipped.

**DETECTOR: GATE-READY, and this is the one to build first.** A diff that
changes emitted CSS for a construct must either cite a SETTLED ledger row ID in
its commit message or add an OPEN row to `DESIGN-DECISIONS.md`. That is a
mechanical CI check — the ledger is a file in the repo and row IDs are greppable
— and it is the check that catches S1 (which cites no row, and for which
§3 "Value semantics" holds no applicable row) and S2 (which cites none and
contradicts M1). Second demand, for any diff touching the corpus status: every
fixture whose status changed, with its recorded expectation. **STATUS: GATE-READY.**

---

## Incident catalogue (reviewer must always catch)

These are real. Every review states, with evidence, whether its diff
reintroduces each applicable shape.

| #   | Incident                                                                   | Invariant  | Shape to catch                                                                                                                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | **`emitValueInterp` precision split** (`3031131ce`) — **FIXED**, see below | 1, 2, 3, 8 | A behavior conditioned on which code path reached the serializer; justified from the reference implementation's context threading; no ledger row.                                                                                                                                                                       |
| S2  | **Merge anchor flipped to less.js 4.x** (`23b78263e`, reverted)            | 8          | A settled v5 divergence overwritten because porting the 4.x behavior turned a corpus fixture green. Caught only because M1 existed in writing.                                                                                                                                                                          |
| S3  | **Parser-side selector-argument joins**                                    | 2, 4, 6    | The grammar joining a `SelectorList` into text. `css-parser` `grammar.ts:365` joins with `','` (6 uses); `jess-parser` `grammar.ts:376` joins with `', '` (2 uses); core's `pseudoCanonical` (`nodes.ts:598`) joins with `', '` and its own JSDoc says "grammar NEVER computes this". Same valid CSS, two byte outputs. |
| S4  | **SCSS text-valued pseudo arguments**                                      | 4, 6       | SCSS keeps pseudo arguments as raw text, so `:not( .b )` and `:is( .b, .c )` retain authored inner whitespace where the other three normalize. A valid-CSS divergence that is a direct consequence of not holding structure.                                                                                            |
| S5  | **`compoundHasAmpersand` byte-scan**                                       | 6          | Deciding a _structural_ fact (is there a parent reference?) by substring-scanning canonical text, where the scan cannot distinguish a token from the same character inside a string.                                                                                                                                    |
| S6  | **Two precisions for one quantity**                                        | 3          | `fadein.ts:30` (`1e12`) vs `color-helper.ts:46` (`round(…, 8)`) for alpha, in two implementations of one function family that C6 requires be merged. The merge will have to pick one, and nothing records which.                                                                                                        |
| S7  | **The pin that vanished** (`2bd16eb89`)                                    | governance | A semantic rule surviving only as a JSDoc comment because its tests — and the differential harness its commit cited as evidence — were deleted by an unrelated refactor. A rule whose only pin is a comment is undefended.                                                                                              |

When a semantic incident is fixed, add a row and, where possible, a detector.
The catalogue stays grounded in lived incidents, not style preference.

### S1 — closed

`emitValueInterp` is deleted. A computed number now emits identical bytes in every
position, decided by one policy module,
[`packages/core/src/ast/format-number.ts`](../../packages/core/src/ast/format-number.ts),
under ledger row **V4** (cross-referenced from the formatting section as **F6**).
Each of the five stages in the incident write-up above is answered:

1. **The justification.** V4 is argued from CSS Values 4 §5, CSSOM §6.7.2, and a
   measured corpus cost, not from less.js's context threading.
2. **The rule is stated over the construct** (invariant 1): "a computed number emits
   the shortest decimal within `1e-10` relative." No splice site appears in it.
3. **It is pinned** (invariant 2, and S7's lesson): `format-number.test.ts` and
   `packages/jess/test/less/number-precision.test.ts` assert the _equality_ of the
   two positions, plus the property-name position — the inverse of the six tests
   that pinned the divergence and were deleted.
4. **The two undocumented riders are recorded, not silently fixed.** `evalBytesInterp`
   still calls `evalValue` rather than `evalValueSlot`, and still never calls
   `validateValueGroupUnits`. Both are now named in its JSDoc; the second is a real
   correctness hole (a unit error fatal in a declaration value is accepted in an
   interpolation) and is **open work**, deliberately not absorbed into the precision
   change.
5. **The user-facing docs were rewritten**, not left describing the removed behavior:
   `docs-content/docs/less/advanced/number-precision.md` and
   `docs-content/docs/jess/06-Advanced/10-number-precision.md`. Neither says "mirrors
   less.js" any more.

**Invariant 3's baseline moves with it.** The `grep -rn "round(" packages/core/src/ast/*.ts`
count drops from **7 literal-`8` sites to 5**: `serialize-value.ts:25` and
`literal-tag.ts` (whose 8-dp denoise is deleted outright) no longer appear.
Separately, the _decimal_ branch of
`color.ts`'s `alphaText` — which emitted a raw unrounded double, a second
unintentional bypass, safe only because `fns` happened to pre-round it — reads the
policy module too; its `%` branch is one of the survivors, so that site is fixed
without changing the count. The five survivors are all in `color.ts`
(`:122,141,153,154,155`: `%` alpha, `%` channels, hue, s, l) and are the remaining
debt for the GATE-READY lint. The 4 bare integer roundings (`color.ts:97` ×3, `:105`)
are channel quantization, a different axis per §3's own reading.

**The legacy `tree/` serializer was a second policy, and is now the same one.**
`packages/core/src/index.ts` re-exports `tree/`, so both engines are public surface
via the less-compat `less.tree` bridge. Before this change both emitted at 8 dp and
agreed; the `ast/` change alone would have made `2px / 3s` print `0.6666666667px`
through one and `0.66666667px` through the other. Every legacy DIMENSION emit now
reads the policy module too — `tree/dimension.ts:319` (`serializeSyntax`),
`tree/negative.ts:50,121`, `tree/range.ts:59` — which is what closes invariant 3 for
numbers rather than merely relocating it. Two legacy tests pinned the old floor and
were updated to the policy's values (`call.test.ts` `rotate(-0.0000000001deg)`,
`dimension.test.ts` `1.0174532925rad`). Note this de-duplication is distinct from the
`round.ts` one, which unified only the rounding KERNEL and left the policy split.

**Still outstanding for invariant 3: COLOR.** `tree/color.ts:261,279,607,616,618,621,623`
mirrors `ast/color.ts`'s five survivors. Colors are the harder half §3 already calls
out, and are untouched here.

**Invariant 2's detector is still BUILDABLE and still does not exist.** The tests
added here cover one construct (a computed dimension) in three positions, not the
five-construct × six-position fixture the invariant specifies. The allowlist it
calls for would today hold exactly one entry: un-operated literals spell themselves
per **V1**, which is a property of the value and travels with it.

---

## Where enforcement would attach

Stated so this document does not become the thing it warns about — a rule with
no pin. Nothing here is wired up today; this is the map, in leverage order.

1. **Ledger-citation check (invariant 8)** — the highest leverage and the
   cheapest. Catches S1 and S2, the two lived incidents.
2. **Precision-policy lint (invariant 3)** — clone
   `verify:parser-runtime-boundary` with a zero-debt ledger.
3. **Positional-equivalence fixture (invariant 2)** — ~1 fixture, 1 test file.
4. **Cross-dialect conformance corpus (invariants 4 and 7)** — one harness
   serves both; it is already scoped as W12.
5. **Extend `verify:parser-runtime-boundary` to `packages/core/src/ast`
   (invariant 6)** — seeded with the ~62 sites as debt, and un-`ignore`
   `serialize*.ts` for this rule.

`.github/workflows/pr-quality-gate.yml` is where these run. Note it **reports
only** and is deliberately not a required check, so a gate added there is an
evidence aid for the reviewer, not a wall — which is the more reason the
reviewer obligations above must hold on their own.

`verify:surface-parity` is the mechanism that makes this document mandatory
reading across tools: adding it to `CANONICAL_DOCS` in
`scripts/verify-surface-parity.mjs` forces `AGENTS.md`, `CLAUDE.md`, and
`.cursor/rules/*` to all cite it, checked in CI.

---

## How to use this doc

- **Deciding what Jess emits:** state the rule over the construct (1), find or
  add the ledger row (8), then check 2–7.
- **Reviewing a diff or design:** use the `semantics-reviewer`; it must report
  evidence per applicable invariant and catalogue row, never only "Approved",
  never "tests pass", and never "matches less.js".
- **Extending enforcement:** add the invariant here first with its STATUS and
  its evidence demand, then its gate, then wire it into the PR workflow.
- **A behavior with no ledger row is not a decided behavior.** It is a bug that
  has not been noticed yet.
