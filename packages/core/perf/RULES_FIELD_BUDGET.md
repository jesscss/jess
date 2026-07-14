# RULES / RULESET — class-unique field budget audit (≤5 hard budget)

READ-ONLY audit for the owner's HARD BUDGET rule (CORE-CLEANUP.md § "⛔ HARD BUDGET
— ≤5 CLASS-UNIQUE FIELDS PER NODE TYPE"). Enumerates every stored instance field
`Rules` declares and every field `Ruleset` adds, separates class-unique from
inherited, classifies each, and gives the ordered slice plan to ≤5.

Grounded in `origin/dev` (`9bfec19be`). Line numbers are from
`packages/core/src/tree/{rules,ruleset,node-base}.ts` at that commit. Getters/setters
live on the prototype and cost NO instance slot — only **stored fields** count.

> **Update (cutover-p1, `work/cutover-p1`):** The R0 (`pendingExtends` delete) and
> R1/R2 (`lookupVersion`/`varsByName` → `_lookup`) folds described below have all
> LANDED — `Rules` reached the irreducible floor of **4** (`rules`, `_lookup`,
> `rulesFlags`, `_scopeFrame`). The cutover-p1 node field-reduction pass then moved
> `_treeContext` off base `Node` onto `Rules` (the ~39k non-Rules nodes resolve
> context via `sourceRoot?._treeContext`, so it belongs on the only sourceRoot-bearing
> class). That makes `Rules` **5** class-unique stored fields — AT budget — while
> dropping a field from every non-Rules node. `_treeContext` is dropped in
> `Rules.toJSON` alongside `_scopeFrame`.

---

## Executive summary

- **`Rules` class-unique stored fields: 5.** (`rules`, `_lookup`, `rulesFlags`,
  `_scopeFrame`, `_treeContext`). The `rulesFlags` pack and `_lookup` lazy
  sub-struct are landed; `varsByName` and `lookupVersion` are accessors backed by
  `_lookup`, and the dead `pendingExtends` field is gone. The raw own-key count
  remains the useful shape metric (42→32 on the tracked Ruleset census); the old
  seven-field enumeration below is historical, not current state.
- **`Ruleset` class-unique stored fields: 5.** (`selector`, `guard`,
  `selectorBeforeExtend`, `_selectorCacheOwner`, `_valueOf`.) `rules` is re-typed,
  not re-declared. **Ruleset is exactly AT budget (5) today** — but two of its
  five are cold/derivable, so it has slack if anything new lands.

- **Classification tally (Rules, 5 class-unique):**
  - irreducible: **4** (`rules`, `_scopeFrame`, `_lookup`, `_treeContext`)
  - already-packed: **1** (`rulesFlags` — one int holding 12 bits)
  - historical cuts already landed: `pendingExtends` deletion plus
    `lookupVersion`/`varsByName` relocation into `_lookup`
- **Classification tally (Ruleset, 5 class-unique):**
  - irreducible: **3** (`selector`, `guard`, `selectorBeforeExtend`)
  - derivable-cache: **1** (`_valueOf` — pure memo of `valueOf()`)
  - cold/lazy already: **1** (`_selectorCacheOwner` — `declare`, lazy)

- **Achievable floor:** **`Rules` is already at the ≤5 budget.** `_scopeFrame` is
  the irreducible, load-bearing scope-chain cache (91 call sites); moving it into
  `_lookup` would add state allocation/indirection and is fenced unless a new
  matched measurement justifies that trade. There is no current R0/R1/R2 code
  slice to replay.
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
| 2 | `_lookup: RulesLookupState \| undefined` | current class body | lazy sub-struct (holds cold lookup fields plus relocated versions/indexes) |
| 3 | `rulesFlags = 0` | current class body | eager int (packs 12 bits) |
| 4 | `_scopeFrame: ScopeFrame \| undefined` | current class body | load-bearing lazy ref; not a safe relocation target |
| 5 | `_treeContext: TreeContext \| undefined` | current class body | Rules-only source-tree context |

**Current class-unique count for `Rules` = 5.**

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

> The detailed rows below retain the original audit reasoning. Their R0/R1/R2
> actions are historical and already landed; the current field count is the
> five-field summary above.

**1. `rules` (1033) — IRREDUCIBLE.**
The child-node array; the `childKeys=['rules']` payload of a declaration list. Read
on every walk (eval, render, lookup, coalesce). Cannot be packed/derived/lazied —
it IS the node's content. Spends 1 of 5.

**2. `varsByName` (historical) — `[LANDED]` folded into `_lookup`.**
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
5. Headroom: 12/31 bits used, reserved for future Rules-local flags only.

**5. `lookupVersion` (historical) — `[LANDED]` folded into `_lookup`.**
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

**7. `pendingExtends` (historical) — `[LANDED]` dead field removed.**
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

> **Historical plan, fully landed on current `dev`.** The R0/R1/R2 rows below
> describe completed cuts and are retained as provenance only; do not replay them
> from old worktrees or assign them as fresh work.

Each slice gated: build core, stable failure set unchanged, output byte-identical
(collapse-bench + dynamic-bench + all-less), A/B the render median. Do NOT touch
`rules.ts` / `ruleset.ts` / `declaration.ts` / `tree/extend/*` while the live
deep-rework / extend agents hold them — **serialize behind them** (these slices ALL
write `rules.ts`, so they must land after or interleave with the live rules.ts work,
coordinated per the FLAG-WALK pull-before-spawn protocol).

**Slice R0 — `[LANDED]` delete dead `pendingExtends` (historical 7→6).**
Remove the field declaration (rules.ts:4353). Nothing reads or writes it (verified
monorepo-wide). No accessor, no reset, no clone handling to touch. Gate: build +
byte-identical (guaranteed — no behavior). This alone is a dead-code + per-instance
`Set`-alloc win. **Fully independent** of flag-walk and the live rules.ts rework
(it's a one-line deletion far from the deep-rework hot region).

**Slice R1 — `[LANDED]` `lookupVersion` → `RulesLookupState` (historical 6→5).**
Add `lookupVersion = 0` to `RulesLookupState`; convert the base field to a
getter/setter delegating into `_lookup` (mirror the existing
`declarationLookupVersion` accessor exactly). Update the 4 sites (rules.ts:1450
reset, 4873 bump; reference.ts:244 bump, 465 read). Riskiest bit: it's on the
reference resolution path — A/B `dynamic-bench` to confirm the `_lookup?.x ?? 0`
read is neutral (precedent: 3 sibling counters already do this). **Independent of
flag-walk.** ← **after R1, `Rules` is at 5 = compliant.**

**Slice R2 — `[LANDED]` `varsByName` → `RulesLookupState` (historical 5→4).**
Add `varsByName` to `RulesLookupState`; getter/setter delegate. Update the ~8 core
sites (rules.ts:1445/1503/1518/1567/1630/2330/5132/5195/5232/5513); scope-frame.ts
takes `Rules.varsByName` as a param — no signature change, just the source
expression. Purely mechanical; buys headroom below budget. **Independent of
flag-walk.** Not required for compliance (R0+R1 already reach 5).

**Ruleset:** no slice needed (at 5). Optional **Slice RS1** — fold `_valueOf` into a
lazy Ruleset sub-struct or drop it (5→4) — only if a future Ruleset field would push
over budget. Lowest priority.

**Historical risk note:** R1 touched the reference hot path and was accepted with
the sibling-counter precedent and compatibility gates. There is no current R0/R1/R2
implementation lane to start.

---

## 4. Realism verdict

**`Rules` is already at the ≤5 budget without touching eval/registration/lookup
semantics.** The current five fields are `rules`, `_lookup`, `rulesFlags`,
`_scopeFrame`, and `_treeContext`; the historical R0/R1/R2 cuts are complete.
`_scopeFrame` is the irreducible, load-bearing scope-chain cache, not a fresh
deletion target.

Cross-reference to the flag-walk endgame: the prompt's concern that
`_registrationPrepared` / `_hasExtends` / lookup versions are "entangled with
registration / propagateFlagsFrom" is real for *deletion of the semantics*, but
**not for the budget** — those two are already bits inside `rulesFlags` (zero
marginal slots), so C4 does NOT gate reaching ≤5. The one field the prompt guessed
was C4-entangled (`pendingExtends`) turned out to simply be dead.

Bottom line for the owner: **`Rules` is at 5, not "dozens" — and the historical
R0/R1/R2 work is already in `dev`.** `Ruleset` is also at 5 (compliant); `_valueOf`
is a future concession only if that changes. No new implementation lane is
justified by the old field-budget checklist alone.
