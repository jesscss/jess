# Jess Type System — Design Proposal

Status: **DESIGN — not scheduled. Sequence implementation after Less v5 parity.**
This doc has been through one round of adversarial review (DX + edge-case);
outcomes are folded in and tracked in [§16](#16-adversarial-review-outcomes).

This is a focused design proposal for a **value/unit type system** in Jess. It
records a coherent recommended design; rejected alternatives, deferred pieces,
and unresolved forks are marked inline. It is the "constraint face" of a larger
idea — a second "transform face" (registered property handlers / compat-lowering)
shares the same underlying primitive and is sketched in
[§13](#13-follow-on-the-transform-face) but is **out of scope for this doc**.

### Owner decisions locked in review
- **Notation stays `<spacing>`** (angle brackets, beside `<length>`). CSS-native
  wins; the DX "reads like JSX/generics" concern is noted as an open risk
  ([§16](#16-adversarial-review-outcomes)), not adopted.
- **Scale forms: BOTH** a stepped range (`0..96px step 4px`) *and* an explicit
  enum (`a | b | c`). Detailed interaction deferred.
- **Strictness-vs-severity model is OPEN** — needs worked examples before
  deciding whether to keep two knobs or collapse to one. See [§6](#6-strictness-vs-severity--open).

---

## 1. What this is for

The job is the durable half of what Tailwind sells: **a constrained design
scale — "one spacing scale, not 47 paddings" — consistency by construction.**
In an LLM-authored world the *ergonomic* half of Tailwind (no-naming, utilities
in markup) erodes; the *constraint* half does not, and it is fundamentally a
**type problem**. A type system that constrains which units/values are legal in
which slots is Jess's native answer to that job — expressed as a **refinement of
CSS's own value grammar**, not a parallel universe bolted onto it.

Non-goals: replacing CSS's grammar, typing arbitrary dynamic values the compiler
cannot see, or shipping before Less v5 parity.

---

## 2. One system, every binding site, `any` by default

There is **one** type system, applied at every place a value is bound:

- property value slots — `padding: <spacing>`
- custom properties — `--gutter: <length>`
- mixin / function parameters — `mixin($a: <number>, $b: <number>)`
- variable declarations — `$gutter: <length> = 16px`

**Gradual, like TypeScript.** Everything is `any` until annotated.
Un-annotated mixins, existing `.less`/`.scss`, and untyped values compile
unchanged forever — the compat guarantee is satisfied by construction, not by an
escape hatch. Typing is opt-in per binding site.

```
mixin($a, $b) { … }                       // params: any, any — nothing breaks
mixin($a: <number>, $b: <number>) { … }   // opt-in → mixin("one","two") is a TypeError
```

> **Argument order is name-first, colon-type, everywhere** — `$a: <number>`,
> matching `$gutter: <length>`. (Review fix: the earlier `<number> $a`
> type-first form contradicted the variable form; dropped.)

Caveat surfaced in review: this is **grounded in but not delivered by**
`defineFunction`. Its `validateValue`/`isValidType` do an `instanceof`/`typeof`
check (`Dimension`, `Quoted`) — they carry no notion of `<length>` vs
`<spacing>`, value membership, or CSS grammar. See the honest ledger in
[§16](#16-adversarial-review-outcomes).

---

## 3. Notation — the CSS Value Definition Syntax, verbatim

Constraints are authored in **the same notation the CSS spec uses to define
properties** (the Values & Units "value definition syntax"; the subset MDN's
"Formal syntax" and `@property`'s `syntax` descriptor already use):

- type references: `<length>`, `<color>`, `<integer>`, and **user types**
  `<spacing>` sitting beside them (owner-locked — user types keep angle brackets)
- combinators/multipliers: `A B`, `A && B`, `A || B`, `A | B`, `[ … ]`, `?`,
  `*`, `+`, `{m,n}`, `#`

User types are **first-class and inferred as subtypes**: a type whose every
member satisfies `<length>` *is* a `<length>` subtype, so it slots in wherever a
`<length>` is required (but not vice-versa — see [§7](#7-assignability--variance)).

Design goal, quotable: **author constraints in the same notation CSS uses to
define properties.**

---

## 4. The two at-rules & the scale forms

Declaration of vocabulary and its application are **separate**, because a named
type is referenced in many places (a property slot *and* a mixin param):

```less
@-types {
  spacing: 0..96px step 4px;             // stepped RANGE form (preferred where regular)
  radius:  0 | 2px | 4px | 8px | 9999px; // ENUM form (irregular / ramps)
}

@-constrain {
  padding: <spacing>;          // refine a known property (see §5)
  gap:     <spacing>;
  --my-gap: <spacing>{1,2};    // full grammar for a custom property (see §5)
  z-index: 0 | 10 | 20 | 30;   // inline anonymous enum — never reused
}
```

- **Both scale forms are supported** (owner-locked): a **stepped range**
  (`0..96px step 4px`) — builds on the existing `Range` node, computes
  nearest-value hints, survives arithmetic reasoning, no hand-typed list — and an
  **explicit enum** (`a | b | c`) for genuinely irregular scales. Detailed
  interaction (mixing them, ranges of non-length units) is deferred.
- `@-types` declares reusable named types; `@-constrain` applies them; inline
  anonymous types allowed for one-offs.
- **Dash-prefixed** compiler at-rules (same family as `@-use`/`@-compose`); a
  stray `@-types` is unambiguously Jess, so **the in-stylesheet surface is safe
  in `.less` today**, not gated on the unshipped `.jess` dialect.
- Naming (`@-constrain` vs `@-refine` vs `@-slots`) not yet locked; **lock before
  any code** — it is the most-typed identifier in the system.

---

## 5. Refine, don't restate — substitution + intersection

CSS already knows `padding` is 1–4 length-percentages. A **bare type reference is
a substitution** of the named subtype into the property's native grammar,
inheriting arity and sibling alternatives:

- `padding: 1rem 2rem` ✅ (arity `{1,4}` inherited)
- `padding: 21px` ❌ (not `<spacing>`)
- `padding: 50%` ✅ (percentage alternative preserved)
- `padding: inherit` ✅ (**CSS-wide keyword carve-out — always admitted**)

**Composition is intersection — you tighten, never accidentally widen.** This
applies **both** to substitution-vs-native grammar **and** to constraint-vs-
constraint across scopes: a nested/redeclared `@-constrain` **intersects** the
outer one (can only tighten). Loosening requires an explicit exemption (`!off`).
*(Review fix: §10's precedence must be intersection, not override — override
would let an inner scope widen, contradicting "never widen".)*

Two forms:

| You write | Meaning | Composition |
|---|---|---|
| `padding: <spacing>` | refine the length token | **intersect** (alternates + arity inherited) |
| `padding: <spacing>{1,4}` | full grammar | **replace** native |
| `--my-gap: <spacing>#` | define a custom prop's grammar | **free** (no native ceiling) |

**The invalid-CSS ceiling.** For a *known* property the native grammar is the
ceiling: carve any subset, but anything that would permit output CSS rejects is a
**compile error** (`padding: <spacing>#` → "padding does not accept
comma-separated values; the `#` multiplier would emit invalid CSS"). This is the
existing **"Sass+ rejects invalid CSS"** invariant. "Widening" is only meaningful
— and only allowed — for constructs CSS has no grammar for (**custom properties,
made-up shorthands**), where you are *defining*, not widening.

**Review corrections to this section (must be honored by the implementation):**
1. **Fused tokens.** `mdn-data` gives `padding` the syntax
   `<length-percentage [0,∞]>{1,4}` — length and percentage are **one fused
   token**, not two branches. Substitution must **decompose** `<length-percentage>`
   into `<length> | <percentage>` itself and refine the length side; there is no
   pre-split "length branch" to target. Every box-metric property hits this.
2. **Shorthand → longhand fan-out.** A constraint on `padding` must auto-apply to
   `padding-top`/`padding-inline-start`/`padding-block`/… (fan-out table from
   `mdn-data`). Otherwise the longhands are a trivial escape from the scale and
   "one spacing scale" leaks. The reverse (longhand→shorthand) does **not** fan
   out.
3. **CSS-wide keywords.** `inherit`/`initial`/`unset`/`revert`/`revert-layer` are
   legal on every property but absent from per-property grammars — admit them
   unconditionally at the check entry point, before substitution.
4. **Numeric/unit normalization + unitless `0`.** Membership must fold unit case
   (`1PX`≡`1px`) and numeric spelling (`16.0px`≡`16px`), and auto-admit bare `0`
   to any length-family slot (`margin: 0` must pass).

**Foundation dependency:** a property→grammar table — `known-css-properties`
(dep of `less-parser`, names) + `mdn-data` (grammars). Same table later powers
language-service autocomplete.

---

## 6. Strictness vs Severity — OPEN

Two concerns were provisionally split:
- **Strictness** (semantic — *what counts as a violation*, e.g. does an
  unverifiable value violate; does bare `16` satisfy `16px`) — on the **type**;
  coercion consumes existing `equalityMode`.
- **Severity** (reporting — *how loud*: warn/error/off) — on the **constraint**,
  as a bang-suffix mirroring `!important`.

**UNRESOLVED (owner needs worked examples).** Review found the split may
collapse: because strictness can promote a "can't-verify" case to *error*, it
also changes volume — so the two knobs are hard to tell apart at the moment a
user wants to escalate. Candidate simplification: **one loudness axis** (severity
per site + CLI) **plus a single `require: verified` boolean** per type (does a
can't-verify value count as a violation at all — yes/no, not a volume). Decision
deferred until we write out concrete before/after examples of both models.

Bang-vocabulary note: collapse the escape family to `!off` + `!warn`/`!error`;
drop `!exempt`/`!unchecked` synonyms. Specify that Jess bangs follow CSS
`!important` in the suffix chain and are stripped before emit (parser must
disambiguate in the `.less` surface).

---

## 7. Assignability & variance

Indirection is **assignability at the use site, not inheritance** — TypeScript.
`padding: var(--gutter)` is legal iff `--gutter`'s declared type is assignable to
padding's constraint:

- `--gutter: <spacing>` into `<spacing>` slot → ✅ (same type or subtype)
- `--gutter: <length>` into `<spacing>` slot → ❌ flagged (supertype not
  assignable to subtype — `const s: Spacing = someLength` errors in TS too)
- `--gutter` untyped → see [§9](#9-check-points--verdicts)

A *typed* `var()` is checkable **statically, without resolving anything** —
type-at-declaration, assignability-at-use. This is the answer to "but `var()` is
dynamic": types track what stays knowable when values don't.

---

## 8. The three-tier severity ladder

Defaults by **binding kind**, via one test: *would this value be valid CSS on its
own?*

| Tier | What | Default | Demotable? |
|---|---|---|---|
| 1 | **Invalid CSS** | error | **No** — base-dialect floor |
| 2 | **Declared-contract violation** (bad param, typed var, custom-prop type) | error | yes |
| 3 | **Design-system refinement** (valid CSS, off your scale) | warn | yes |

- Contract sites (params, typed vars, custom-prop declarations) → **error**.
- Property-slot refinements → **warn** (still valid CSS; rolled out gradually).

CLI overrides globally: `--strict` promotes tier 3→2; `--constrain=warn` demotes
tier 2; `--constrain=off` skips entirely (zero cost via the engage gate).

> **Review flag (DX, needs owner call): defaults may be backwards for adoption.**
> §10 auto-injects contracts as ambient + tier-2 errors, which on a large
> codebase lights up hundreds of diagnostics on day one — the anti-pattern
> Flow/mypy/Sorbet learned to avoid. Recommended: **injection off / observe-first
> by default**, user climbs the ladder. Not yet adopted — see [§16](#16-adversarial-review-outcomes).

---

## 9. Check-points & verdicts

| Value form | Verifiable? | Check | When |
|---|---|---|---|
| literal (`21px`) | yes | scale membership | parse |
| Jess var (`@gutter`, `$x`) | yes — compiler resolves | resolved-value membership | eval (post-op) |
| computed, reduces to a value (`calc(1rem*2)`=`2rem`) | yes (needs a folder) | resolved-value membership | eval (post-op) |
| computed, unreduced `calc()`/`clamp()`/mixed-unit | **no** | **can't-verify → warn** | eval |
| `var(--typed)` | yes — static | assignability (§7) | compile |
| `var(--untyped)` | **no** | **can't-verify → warn** | compile |
| `var(--x, 21px)` fallback | the **fallback literal** is checked | recurse into fallback | parse |

Notes (with review corrections):

- **The end-to-end guarantee is conditional, not absolute.** Under
  `unitMode: loose`, `@gutter + 1px` materializes as an **unreduced `calc()`**
  (v5 preserves un-operated calc verbatim), which is **not** a scale member and
  **not** proven-wrong → it lands in **can't-verify (warn)**, not a hard failure.
  So arithmetic escape is *caught as a warning*, not *prevented*, when math
  doesn't reduce. (Review fix: the earlier absolute claim "a scale value can't
  silently leave the scale via math" was wrong for loose math.)
- **`calc()` has three buckets** (Open-Q refined): constant-foldable **on-scale**
  → pass; constant-foldable **off-scale** → tier 2/3; **non-foldable** →
  can't-verify. A v1 may legitimately treat *all* calc as can't-verify — but must
  say so, since v5 doesn't evaluate un-operated calc and the checker never sees a
  reduced value without a dedicated folder.
- **Two can't-verify families** (not just untyped `var()`): undeclared `var()`
  **and** unreduced `calc()`. Both warn, both double as the **coverage signal**
  (where the design system is unenforced). Strictness can promote or demote them.
- **`any` on a typed param must NOT throw.** Today `validateValue` hard-throws on
  a mismatch; an `any`/unresolvable value routed through a typed mixin param would
  crash, contradicting both gradual-`any` and can't-verify-warn. It must route to
  can't-verify like the property-slot path. (Review blocker #7.)
- CSS-`var()` vs Jess-var: only an *undeclared CSS* `var()` is unverifiable; a
  Jess variable is compile-time and flows to the real value check.

---

## 10. Where it lives (layered homes)

| Layer | Home | Owns | Propagation |
|---|---|---|---|
| **Environment** | `styles.config.ts` (`styles-config`) | modes, `strict` preset, browserslist target, plugins, per-glob overrides, a **pointer** to the types module | glob-scoped merge (`getOptions`) |
| **Design system** | base module(s) — `tokens` (values) + `types` (contracts) | `@-types`, `@-constrain`, `@property` regs, typed tokens | **contracts ambient (auto-injected); tokens explicit `@-compose` (provenance)** — *but see the observe-first review flag in §8* |
| **Local** | the file | inline `@-constrain`, `!warn`/`!error`/`!off` | narrowest wins; **intersects** (never widens) up the chain |

- **`@property { syntax }` is the keystone bridge**: real CSS the compiler emits,
  a bidirectional type source, tooling-visible. Duplication to resolve
  (review): for a custom prop, `@-constrain { --gap: <spacing> }` should **emit**
  the `@property` *and* add compile-only membership on top — one authoring site,
  two outputs — because `@property syntax` cannot express enums/value-membership.
- **Default starting point = config.** `unitMode: 'strict'` ships today on
  `.less`; one `language.jess.types` pointer graduates to typed tokens.
- **Config-home tooling gap is a requirement, not an open question** (review):
  types declared only in `styles.config.ts` are invisible to `@use`/hover until
  the pointer loads. The language-service must **eagerly resolve the pointer at
  project load** or newcomers get no autocomplete on first file open.

Precedence (later wins, **all levels intersect**): `compile.*` →
`language.jess.*` (injected types) → `input[]` glob → `output[]` glob → in-file
`@-config` → in-file redeclare → block/line exemption.

---

## 11. Performance discipline

- **Zero-cost when unused.** An `engage`-style single static scan
  (`engageExtendLayer`/`engageImportLayer` pattern) answers "any typed bindings /
  constraints in this file?" — if no, the per-declaration path is never installed.
- **O(1) reject** via a property-name bitset (extend-engine fast-reject pattern).
- **Literals cheapest** (test a node already built; no eval-floor growth);
  post-op checks ride the already-materialized value (no extra walk).
- **No fat on the hot node** — a value's type tag is a **lazy interned
  side-table** keyed by node, never a required field on `Dimension`.

---

## 12. Migration & adoption

Gradual ladder; low rungs work on `.less` today: **observe** (report only) →
**warn** → **enforce-new** (error scoped to `src/features/**` via config glob) →
**enforce-all** (residual `!off`, CI caps exemption count / ratchet).

**`jess infer-types`**: walk the parsed AST, histogram dimensions by unit,
cluster deltas to a step, histogram colors, emit a candidate `@-types`/token
module + a report of outliers ("you use 4/8/12/16/24/32 → `spacing = 0..32px step
4px`; 4 values don't fit"). Automates the discipline Tailwind's scale required by
hand; the LLM-era migration story.

---

## 13. Follow-on: the transform face

Out of scope here. The same **name-keyed registry consulted inline during the
single emit walk** that powers constraints can power *transforms*:
`defineProperty(name, handler)` keyed at the `emitLeaf` / `case 'Declaration'`
choke point — the third table alongside `defineFunction` and
`ast/value-dispatch.ts`'s `FnRegistry`. Uses: shorthand expansion, and
**compat-lowering** (autoprefix, `oklch()` fallbacks, future-CSS) driven by one
`browserslist`/`compat:` switch. Honest boundary: self-only value handlers are
cheap (`emitLeaf`); sibling-aware/structural (shorthand cascade, `@supports`
wrapping) need a gated per-rule hook; cross-cutting (dedup, layer sorting) route
to an opt-in visitor. Deserves its own doc.

---

## 14. Grounding (existing machinery to reuse)

- `packages/core/src/tree/range.ts` — `Range` node (`start`/`end`/`step`,
  inclusive/exclusive); `evalNode` is a **parse-only no-op** today. Add
  `contains(value)` (~15 lines) → the stepped-range wedge.
- `packages/core/src/define-function.ts` — typed params, overloads. **But**
  `isValidType` is `instanceof`/`typeof` only (no value membership, no CSS
  grammar) — see ledger in §16.
- `packages/core/src/ast/serialize.ts` — `emitLeaf` / `case 'Declaration'`: the
  single choke point for post-op checks and (later) transform dispatch.
- `packages/config/src/types.ts` — `unitMode`/`equalityMode`/`functionMode`/
  `strict` + per-glob `input[]`/`output[]`: the type system **consumes** these.
- `known-css-properties` (dep of `less-parser`) + `mdn-data` — property→grammar.
- `packages/docs-content/docs/jess/02-Language/09-values-and-types.mdx` —
  existing experimental notation (list-arity, `10px..20px` ranges).

---

## 15. Open questions

1. **Strictness vs severity model** — keep two knobs or collapse to severity +
   `require: verified`? **Needs worked before/after examples** (owner). (§6)
2. **Adoption defaults** — observe-first / injection-off vs ambient-on? (§8 flag)
3. **`calc()` folding depth** — v1 "all calc = can't-verify", or a real
   constant-folder for the on-scale case? (§9)
4. **`var()` propagation depth** — chains (`--a: var(--b)`), partially-typed
   graphs. (Cycles are fine — type-to-type, not value.)
5. **Coercion policy detail** — how `equalityMode` maps to satisfies-relations
   (does `16` satisfy `16px`? `<length>` satisfy `<length-percentage>`?).
6. **Multiple supertypes** — `<spacing>` is a subtype of `<length>`,
   `<length-percentage>`, `<dimension>`… which token does substitution target?
   (tie-break: most-specific matching token.)
7. **At-rule naming** — `@-constrain` vs `@-refine` vs `@-slots`; lock before code.
8. **Export fidelity** (deferred) — token/type → W3C JSON / `.d.ts` / Tailwind
   theme is lossy; mark the module canonical.

---

## 16. Adversarial review outcomes

Two adversarial passes (DX + cross-type-system; edge-case + soundness). Status:

**Folded in (corrections applied above):**
- CSS-wide keyword carve-out (§5.3); fused-token decomposition for
  `<length-percentage>` (§5.1); shorthand→longhand fan-out (§5.2); numeric/unit
  normalization + unitless `0` (§5.4); `var()` fallback-literal check,
  unreduced-`calc()` as a second can't-verify family, softened end-to-end claim,
  `any`-param-must-not-throw (§9); cross-scope composition = intersection (§5,
  §10); config-home LS eager-resolve as a requirement (§10); argument order
  name-first everywhere (§2); bang-vocabulary collapse (§6).

**Owner-decided in review:**
- Notation stays `<spacing>` (DX "JSX/generics collision" concern noted, not
  adopted). Scale forms: both range + enum. Strictness/severity: deferred pending
  examples.

**Open / recommended, needs owner call:**
- Adoption defaults → observe-first/injection-off (strong DX recommendation; §8).
- `jess explain` (effective computed grammar + full resolution trace) — both
  reviewers called it a **launch requirement**, not polish: the substitution
  model and the 7-level precedence chain are only navigable with it. Add to scope.
- Copy `@ts-expect-error` **self-expiring** semantics for `!off` (warn when the
  suppressed violation no longer applies) so dead exemptions can't accumulate.

**Honest "exists vs net-new" ledger** (review caught the grounding was oversold):
- *Exists:* `Range` node (needs `contains`), `defineFunction` param plumbing +
  overload resolution, config modes + glob overrides, `known-css-properties`
  names, the `emitLeaf` dispatch site.
- *Net-new (~80%):* value-membership engine, the property→grammar (`mdn-data`)
  integration + fused-token decomposition + shorthand fan-out, node→author-type
  name map (so errors say `<number>`, not `Dimension`), effective-grammar
  computation, the `jess explain` tracer, and the calc constant-folder (if
  pursued).

**Cross-type-system lessons to honor:** TS gradual-`any` is *local* — property
constraints are property-global, so market this as scale-enforcement, not
TS-gradual, for slots; Flow/mypy/Sorbet → per-file opt-in header, default
nothing-enforced; mypy `--strict` → make it a ladder of named flags, not one
boolean; F#/units-of-measure → the stepped range (now adopted) beats a raw enum
for arithmetic + nearest-value hints; Vanilla-Extract/Panda → the genuine
differentiator is **enforcement at the literal in native syntax with no import**,
but they beat us on autocomplete unless the LS offers "insert nearest scale
value".
