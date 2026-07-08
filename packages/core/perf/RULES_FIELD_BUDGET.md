# RULES / RULESET — class-unique field budget audit (≤5 hard budget)

READ-ONLY audit for the owner's HARD BUDGET rule (CORE-CLEANUP.md § "⛔ HARD BUDGET
— ≤5 CLASS-UNIQUE FIELDS PER NODE TYPE"). Enumerates every stored instance field
`Rules` declares and every field `Ruleset` adds, separates class-unique from
inherited, classifies each, and gives the ordered slice plan to ≤5.

Grounded in `origin/dev` (`e9f018a5a`). Line numbers are from
`packages/core/src/tree/{rules,ruleset,node-base}.ts` at that commit. Getters/setters
live on the prototype and cost NO instance slot — only **stored fields** count.

---

## Executive summary

- **`Rules` class-unique stored fields: 7.** (`rules`, `varsByName`, `_lookup`,
  `rulesFlags`, `lookupVersion`, `_scopeFrame`, `pendingExtends`.) The `rulesFlags`
  pack (c40fea6, 11 booleans → 1 int) and the `_lookup` lazy sub-struct (~12 cold
  lookup fields → 1 slot) already landed — the raw own-key count is down 42→32, and
  the *class-unique stored-field* count is already **7, not the "dozens"** the SLIM
  audit describes (that audit predates both slims). So the flagship violator is
  **7, needs to shed 2** to hit ≤5.
- **`Ruleset` class-unique stored fields: 5.** (`selector`, `guard`,
  `selectorBeforeExtend`, `_selectorCacheOwner`, `_valueOf`.) `rules` is re-typed,
  not re-declared. **Ruleset is exactly AT budget (5) today** — but two of its
  five are cold/derivable, so it has slack if anything new lands.

- **Classification tally (Rules, 7 class-unique):**
  - irreducible: **3** (`rules`, `_scopeFrame`, `_lookup`)
  - already-packed: **1** (`rulesFlags` — one int holding 12 bits)
  - **DEAD — drop now: 1** (`pendingExtends` — zero read/write sites in the entire
    monorepo; the ONLY occurrence is its own initializer. Independent of C4.)
  - fold-into-existing-struct: **2** (`lookupVersion` → into `_lookup`;
    `varsByName` → into `_lookup`)
- **Classification tally (Ruleset, 5 class-unique):**
  - irreducible: **3** (`selector`, `guard`, `selectorBeforeExtend`)
  - derivable-cache: **1** (`_valueOf` — pure memo of `valueOf()`)
  - cold/lazy already: **1** (`_selectorCacheOwner` — `declare`, lazy)

- **Achievable floor:** **`Rules` CAN reach ≤5 cheaply and independently.**
  `pendingExtends` is DEAD (drop it: 7→6, zero risk). Then fold EITHER
  `lookupVersion` OR `varsByName` into the already-existing `_lookup` sub-struct to
  hit 5; fold both to reach 4. All three moves have ZERO dependency on the
  flag-walk / rules.ts deep-rework. **The irreducible core is 4** (`rules`,
  `_scopeFrame`, `rulesFlags`, `_lookup`) — under 5. There is NO irreducible-over-5
  problem for Rules, and NO C4 gating on the path to budget.
- **`Ruleset` is at 5** and needs no action to be compliant, but `_valueOf`
  (derivable) folds it to 4 with slack if desired.

---

## 1. Field enumeration — class-unique vs inherited

### Inherited base `Node` fields (count against `Node`, NOT Rules) — node-base.ts
Per-instance STORED fields on the base class (getters excluded):
`_spanStart` (444), `_spanEnd` (445), `_sourceRoot` (447), `_treeContext` (452),
`_options` (454), `flags` (478), `_requiredSemi` (554, `declare` + ctor-set),
`sourceNode` (570, `declare` + ctor-set), `index` (578), `parent` (618).
`type`/`shortType`/`nodeType` are prototype props (`declare`, set by `defineType`)
— no instance slot. `frozen`/`hoistToRoot`/`generated`/`registrationPrepared`/
`visible`/`requiredSemi` are all **getters backed by `flags` bits** — no slot.

These are `Rules`'s inheritance; they do NOT spend Rules's budget.

### `Rules` class-unique stored fields — rules.ts (class body 1030–6988)

| # | field | line | stored kind |
|---|-------|------|-------------|
| 1 | `rules: Node[]` | 1033 | eager array (the child list) |
| 2 | `varsByName: Map<…> \| undefined` | 1036 | lazy map (`??=`) |
| 3 | `_lookup: RulesLookupState \| undefined` | 1042 | lazy sub-struct (holds ~12 cold fields) |
| 4 | `rulesFlags = 0` | 1086 | eager int (packs 12 bits) |
| 5 | `lookupVersion = 0` | 1196 | eager int |
| 6 | `_scopeFrame: ScopeFrame \| undefined` | 1239 | lazy ref |
| 7 | `pendingExtends = new Set(...)` | 4353 | eager Set |

**Current class-unique count for `Rules` = 7.**

All the `has*ChildSurface` / `_bodyEvaluated` / `_hasExtends` /
`_hasReferenceImports` / `_registrationPrepared` / `_placementRepointed` names are
**getter/setter pairs over `rulesFlags` bits** (R_* constants, rules.ts:975–986) —
they are NOT stored fields. Likewise `functionsByName`, `callableLookupCache`,
`directChildRuleEntries`, `directDeclarationChildEntries`,
`directDeclarationsByName`, `directDeclarationLookupCache`,
`declarationLookupVersion(sByName)`, `functionLookupVersion(sByName)`,
`callableLookupVersion`, `_closureScope` are all **getter/setter pairs delegating
into `_lookup`** — one slot (`_lookup`), not twelve.

### `Ruleset` class-unique stored fields — ruleset.ts (class body 106–2102)

| # | field | line | stored kind |
|---|-------|------|-------------|
| 1 | `selector: SelectorLike \| Nil \| undefined` | 110 | eager ref (ctor-set) |
| 2 | `guard` | 112 | eager ref (ctor-set, usually `undefined`) |
| 3 | `selectorBeforeExtend` | 113 | eager ref (ctor-set, usually `undefined`) |
| 4 | `_selectorCacheOwner?` | 115 | `declare` lazy (attached only on derived prep wrappers) |
| 5 | `_valueOf: string \| undefined` | 680 | lazy memo cache |

`declare readonly rules` (111) is a **re-type of the inherited `Rules.rules`** — no
new slot. `hoistToRoot` reads go through the base `Node` getter (F_HOIST_* bits) —
the old eval-time `Ruleset.hoistToRoot =` write was removed by C1 (2e21baae1), and
`Ruleset.frames` was removed by C0 (844046cbd) — neither is a field anymore.

**Current class-unique count for `Ruleset` = 5** (exactly at budget).

---

## 2. Field classification + evidence

### Rules

**1. `rules` (1033) — IRREDUCIBLE.**
The child-node array; the `childKeys=['rules']` payload of a declaration list. Read
on every walk (eval, render, lookup, coalesce). Cannot be packed/derived/lazied —
it IS the node's content. Spends 1 of 5.

**2. `varsByName` (1036) — FOLD INTO `_lookup`.**
Per-scope `Map<name, VarDeclaration binding entries>`, the static var-lookup index.
Writers: `resetDerivedState` clears it (1445), lazy `??= new Map()` (1567, 5132,
5513). Readers: scope-frame build (`scope-frame.ts:324/330` builds
`declarationBucketsByName` from it), variable lookup (rules.ts:1503/1630/2330/5195/
5232). It is already `undefined`-default and reset alongside the `_lookup`-backed
state in `resetDerivedState`. It is **the same category** as everything already in
`RulesLookupState` (a lazily-built lookup index). **Move it into `RulesLookupState`
as one more field**, expose via the same getter/setter delegate pattern the other
12 use. Net: one fewer eager slot. **Independent** of the flag-walk work.

**3. `_lookup` (1042) — IRREDUCIBLE (and it's the *good* pattern).**
The lazily-allocated `RulesLookupState` holding ~12 cold callable/decl/function
lookup fields. This is exactly the owner-blessed "lazy sub-struct" collapse: a
leaf declaration-only Ruleset (the ~12k majority) carries ONE `undefined` slot,
never allocating the struct. Keep. Spends 1 of 5. (This is the *destination* for
folds #2 and #5.)

**4. `rulesFlags` (1086) — ALREADY-PACKED (keep).**
One Rules-private int holding 12 bits: 7 `has*ChildSurface` + `_bodyEvaluated`
(R_BODY_EVALUATED) + `_hasExtends` + `_hasReferenceImports` +
`_registrationPrepared` + `_placementRepointed`. Landed c40fea6. Deliberately a
Rules-only int (not base `flags`) so leaf-node flag reads don't widen. Spends 1 of
5. Headroom: 12/31 bits used, room for `varsByName`-present / other future bits.

**5. `lookupVersion` (1196) — FOLD INTO `_lookup`.**
Cache-invalidation counter. Writers: bumped on mutation (rules.ts:4873,
reference.ts:244), reset in `resetDerivedState` (1450). Readers: reference
resolution reads the current version (reference.ts:465). Distinct from the
`_lookup`-nested `declarationLookupVersion`/`callableLookupVersion`/
`functionLookupVersion` (which are ALREADY inside `RulesLookupState`) — this one
stayed eager on the base shape. It is the SAME kind of counter, reset in the same
method. **Move it into `RulesLookupState`** (default 0; getter returns
`_lookup?.lookupVersion ?? 0`). ⚠️ Mild caution: it is read on the reference
resolution path — verify a `_lookup?.x ?? 0` getter read is not a measurable
regression (the other 3 version counters already pay this indirection, so the
precedent says it's fine, but A/B the reference-heavy `dynamic-bench`). **Independent**
of the flag-walk work.

**6. `_scopeFrame` (1239) — IRREDUCIBLE.**
The scope-chain frame; the single most-referenced Rules field (91 sites),
central to all variable/callable resolution. Lazily built but load-bearing on the
hot path. Cannot derive (it caches the resolved lexical chain). Spends 1 of 5.

**7. `pendingExtends` (4353) — DEAD; DROP NOW (7→6, independent, zero risk).**
`Set<[find, extendWith, partial]>` declared with an eager `new Set()` initializer.
**A monorepo-wide grep (`packages/**/*.ts`) finds EXACTLY ONE occurrence: the field
initializer itself (rules.ts:4353). Zero reads, zero writes anywhere.** Name-based
extend registration flows through `_hasExtends` (a `rulesFlags` bit) →
`processExtends` → `extend-roots.ts`, NOT this Set — it is a vestige of an earlier
extend design. This is a plain dead-field deletion, **NOT gated on C4** and NOT
touching any live machinery. It also allocates a `Set` on every one of the ~12k
Rulesets for nothing — a real per-instance alloc win beyond the slot.

Note: `_registrationPrepared` and `_hasExtends` (the fields the prompt flags as
C4-entangled) are already **bits inside `rulesFlags`**, not separate slots — so the
C4 entanglement is about *deleting* them, not about budget. They don't cost a slot
today regardless. C4 does NOT gate the path to ≤5.

### Ruleset

**1. `selector` (110) — IRREDUCIBLE.** The ruleset's selector (string / node /
list). Read everywhere (registration, composition, render, `valueOf`). Core content.

**2. `guard` (112) — IRREDUCIBLE-ish (subtype candidate, low payoff).**
The `when(...)` guard, usually `undefined` for plain rulesets. Read by callable
machinery (mixin.ts, reference.ts, util/callable-candidate.ts, callable-entry.ts,
callable-special-case.ts). Could move to a `GuardedRuleset` subtype (kind×field
matrix: only guarded rulesets/mixins use it), but SLIM_NODES_AUDIT already ruled
this "low payoff vs the Rules-flag win; defer" — and Ruleset is at budget without
it. Keep unless a future field forces a split.

**3. `selectorBeforeExtend` (113) — IRREDUCIBLE-ish (subtype candidate, low payoff).**
Pre-extend selector snapshot, usually `undefined`. Read ONLY in clone/derive-part
plumbing (ruleset.ts:255/266/292/1781) — never outside selector/extend structure.
Same subtype candidacy + same "low payoff, at budget" verdict as `guard`. Keep.

**4. `_selectorCacheOwner` (115) — COLD/LAZY (keep).**
`declare` optional; attached only on derived registration-prep wrappers
(written ruleset.ts:1785, read 722). No eager slot on plain rulesets. Fine.

**5. `_valueOf` (680) — DERIVABLE MEMO CACHE (fold to 4 if desired).**
Pure memoization of `valueOf()` (the selector string, for equality comparison):
`if (this._valueOf !== undefined) return this._valueOf` then computes and caches
(684–705); invalidated to `undefined` on selector change (716, 728–735). Strictly
derivable from `selector`. Could be dropped (recompute each `valueOf()`) OR moved
into a lazy Ruleset sub-struct — but it's a HOT equality cache; dropping it
re-walks the selector on every comparison. Since Ruleset is already AT budget (5),
**no action required**; if a 6th field ever lands, drop/relocate this first (it's
the cheapest concession — recompute or lazy-struct).

---

## 3. Ordered slice plan to ≤5

Each slice gated: build core, stable failure set unchanged, output byte-identical
(collapse-bench + dynamic-bench + all-less), A/B the render median. Do NOT touch
`rules.ts` / `ruleset.ts` / `declaration.ts` / `tree/extend/*` while the live
deep-rework / extend agents hold them — **serialize behind them** (these slices ALL
write `rules.ts`, so they must land after or interleave with the live rules.ts work,
coordinated per the FLAG-WALK pull-before-spawn protocol).

**Slice R0 — delete dead `pendingExtends` (7→6). Cheapest, zero-risk, lands FIRST.**
Remove the field declaration (rules.ts:4353). Nothing reads or writes it (verified
monorepo-wide). No accessor, no reset, no clone handling to touch. Gate: build +
byte-identical (guaranteed — no behavior). This alone is a dead-code + per-instance
`Set`-alloc win. **Fully independent** of flag-walk and the live rules.ts rework
(it's a one-line deletion far from the deep-rework hot region).

**Slice R1 — `lookupVersion` → `RulesLookupState` (6→5). Hits budget.**
Add `lookupVersion = 0` to `RulesLookupState`; convert the base field to a
getter/setter delegating into `_lookup` (mirror the existing
`declarationLookupVersion` accessor exactly). Update the 4 sites (rules.ts:1450
reset, 4873 bump; reference.ts:244 bump, 465 read). Riskiest bit: it's on the
reference resolution path — A/B `dynamic-bench` to confirm the `_lookup?.x ?? 0`
read is neutral (precedent: 3 sibling counters already do this). **Independent of
flag-walk.** ← **after R1, `Rules` is at 5 = compliant.**

**Slice R2 (optional, → 4) — `varsByName` → `RulesLookupState` (5→4).**
Add `varsByName` to `RulesLookupState`; getter/setter delegate. Update the ~8 core
sites (rules.ts:1445/1503/1518/1567/1630/2330/5132/5195/5232/5513); scope-frame.ts
takes `Rules.varsByName` as a param — no signature change, just the source
expression. Purely mechanical; buys headroom below budget. **Independent of
flag-walk.** Not required for compliance (R0+R1 already reach 5).

**Ruleset:** no slice needed (at 5). Optional **Slice RS1** — fold `_valueOf` into a
lazy Ruleset sub-struct or drop it (5→4) — only if a future Ruleset field would push
over budget. Lowest priority.

**Riskiest slice:** R1 (`lookupVersion`), solely because it sits on the reference
hot path — mitigated by A/B and the 3-sibling precedent. R0 is zero-risk (dead
code); R2 carries no hot-read risk (varsByName reads already tolerate `undefined`).

---

## 4. Realism verdict

**≤5 is achievable for `Rules` WITHOUT touching the eval/registration/lookup
machinery semantics.** R0 deletes a dead field (zero behavior). R1/R2 are pure
field-relocation into an *already-existing* lazy sub-struct that these very fields
already conceptually belong to (they reset together in `resetDerivedState`). No
behavior change, no flag-walk dependency, no C4 gate.

There is **NO irreducible-over-5 core.** The genuine irreducible set is **4**:
`rules` (content), `_scopeFrame` (scope chain), `rulesFlags` (packed bits), `_lookup`
(the lazy cold-lookup struct — destination for the folds). Everything else is dead
(`pendingExtends`) or a straggler that belongs in `_lookup` (`lookupVersion`,
`varsByName`). The steady-state floor is **4**.

Cross-reference to the flag-walk endgame: the prompt's concern that
`_registrationPrepared` / `_hasExtends` / lookup versions are "entangled with
registration / propagateFlagsFrom" is real for *deletion of the semantics*, but
**not for the budget** — those two are already bits inside `rulesFlags` (zero
marginal slots), so C4 does NOT gate reaching ≤5. The one field the prompt guessed
was C4-entangled (`pendingExtends`) turned out to simply be dead.

Bottom line for the owner: **`Rules` is at 7, not "dozens" — the landed `rulesFlags`
+ `_lookup` slims already did the heavy lifting.** One dead-field deletion (R0) + one
mechanical fold (R1), both flag-walk-independent, take it 7 → 5. A second optional
fold (R2) reaches 4. **`Ruleset` is already at 5** (compliant); `_valueOf` folds it
to 4 if ever needed. No owner arbitration required — there is no irreducible >5.
