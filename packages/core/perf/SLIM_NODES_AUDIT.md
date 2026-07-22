# SLIM NODES — node-shape audit + ranked slimming plan

Read-only audit of `packages/core/src/tree/*.ts` node shapes for the "SLIM NODES"
standing rule (lean shapes for good V8 hidden classes; prefer type-specialization
+ shared util fns over fat nodes; rare data on a subtype, never a WeakMap
side-table; performance is the driver).

> **Current-state correction (2026-07-13, `dev` `9bfec19be`).** This document is
> historical audit evidence, not the live queue. Do not reopen its ranked items
> without checking [CORE-CLEANUP.md](../../../docs/future/core-architecture/CORE-CLEANUP.md)
> and the current [Rules field budget](./RULES_FIELD_BUDGET.md). In particular,
> `Rules` is currently at five class-unique fields (`rules`, `_lookup`,
> `rulesFlags`, `_scopeFrame`, `_treeContext`); `lookupVersion`, `varsByName`,
> and `pendingExtends` are historical rows already folded or deleted. The
> selector marker and `Node.frozen` eager slot are also historical: selector
> identity is derived and frozen state is packed into `Node.flags`. Per-node
> source spans are inline on `Node`; per-slot value/field spans remain a separate
> parser/trivia design question. The live tracker is the authority for what is
> still unclaimed.

## Current live census (2026-07-13)

The old collapse-bench table below is retained as historical evidence. A fresh
run of `node --expose-gc packages/core/perf/heap/dyn-census.mjs` on the current
bundled `dev` build uses the stable `Node._tag`/`node.type` discriminant rather
than minifiable constructor names. It walked **50,059 live nodes** in the
mixin/reference/extend workload and measured current own enumerable shape width
(not a byte or class-unique-field claim):

| type | count | avg own keys |
|---|---:|---:|
| Declaration | 10,007 | 11.0 |
| Ruleset | 8,405 | 17.3 |
| Reference | 7,211 | 10.0 |
| Dimension | 5,204 | 10.0 |
| Color | 3,604 | 12.0 |
| List | 2,403 | 11.0 |
| Call | 2,402 | 12.0 |
| Num | 2,401 | 10.0 |
| Nil | 1,602 | 9.0 |
| BasicSelector | 1,602 | 11.0 |
| Extend | 1,600 | 12.0 |
| Paren | 1,204 | 9.0 |
| Operation | 1,203 | 11.0 |
| Rules | 1,201 | 13.0 |
| VarDeclaration | 5 | 11.0 |
| SelectorList | 2 | 10.0 |
| Mixin | 1 | 17.0 |
| Interpolated | 1 | 11.0 |
| Condition | 1 | 12.0 |

Use `RULES_FIELD_BUDGET.md` and `NODE_FIELD_BUDGET.md` for class-unique field
counts; this table is a current frequency/shape guide for selecting the next
bounded audit, not permission to split a hot node on key count alone.

## Method / grounding

- **Live-instance census (frequency):** captured a V8 heap snapshot of the LIVE
  node tree right after `compile()` (parse+eval, before free) of the
  `collapse-bench` input (1500 nested `.block-N { color; padding; .inner { margin;
  &:hover { color } .leaf { border } } }`). Counted objects by constructor name.
  Exact per-class instance counts + avg self-size below. (Heap snapshot + scripts
  were throwaway; numbers reproduced here.)
- **Field inventory:** brace-depth field extractor (`perf/_fields.mjs`-style) plus
  direct reads of each hot class body for precision. Counts = class-body field
  declarations + constructor `this.X =` assignments; excludes prototype accessors
  (getters/setters live on the prototype, not the instance shape) and locals.

### Live census (collapse-bench tree, ~39k tree nodes, 7.1MB)

| class            | count | avg bytes | total | notes |
|------------------|------:|----------:|------:|-------|
| Ruleset          | 12000 | 352 | 4.1MB | fattest × hottest — extends fat `Rules` base |
| Declaration      |  7502 | 112 | 0.8MB | lean own shape (3 child slots) |
| Dimension        |  4502 | 104 | 0.46MB | lean (2 scalar fields) |
| CompoundSelector |  4500 | 120 | 0.53MB | Selector base + value |
| Color            |  3000 | 120 | 0.35MB | 4 channel-cache slots |
| Ampersand        |  3000 | 144 | 0.42MB | Selector base + 2 container slots |
| PseudoSelector   |  3000 | 144 | 0.42MB | Selector base + name/arg/override |
| BasicSelector    |  1500 | 120 | 0.18MB | Selector base + string value |

`Rules` itself: only 9 live (the scope containers), but **every Ruleset IS a
`Rules`** — 12000 of them inherit the full `Rules` field set. So slimming `Rules`
is slimming Ruleset, the #1 target.

## Base shapes (inherited by everything)

### `Node` (node-base.ts:401) — ~8 eager own instance fields
`_sourceRoot`, `_treeContext`, `_options`, `flags` (already a bitmask packing
F_VISIBLE/STATIC/GENERATED/REG_PREPARED/HOIST/etc.), `sourceNode` (=this until
cloned), `index`, `frozen`, `parent`. Plus lazy `_requiredSemi`.
Provenance (source spans) already lives in a side-table read via free fns
(`sourceSpanOf`), gated by one `F_HAS_SPAN` bit — already slim, good precedent.
`type`/`shortType`/`nodeType`/`nil`/`_tag` are prototype props (not instance) — good.

**`frozen`** (node-base.ts:562) is a plain boolean on EVERY node → flag-bit candidate.

### `Rules` (rules.ts:1031) — current base shape after the first slim pass

2026-07-08 follow-up: the original `~27 eager own fields` assessment was true
when written, but `Rules` has since been partially slimmed. The current own
instance shape paid by every `Ruleset` is:

| slot | kind | current evidence | verdict |
|------|------|------------------|---------|
| `rules` | structural child array | required child slot (`Rules.childKeys = ['rules']`) | keep |
| `varsByName` | static variable declaration index | eager field declaration; populated by `prepareScopeFrameDeclarationIndex()` before frame construction | suspicious but hot-path sensitive |
| `_lookup` | lazy lookup-state struct pointer | one eager pointer to `RulesLookupState`; reads do not allocate, writes allocate | keep; this is the good cut |
| `rulesFlags` | packed Rules-only booleans | 12 bits now cover child-surface flags, exact callable/mixin/ruleset surfaces, `_bodyEvaluated`, `_hasExtends`, `_hasReferenceImports`, `_registrationPrepared`, `_placementRepointed` | keep; do not split back out |
| `lookupVersion` | eager global lookup invalidation counter | only incremented in `reference.ts` pending var promotion and `rules.ts` invalidation; fallback for non-string/general lookup handles | cut candidate #1 |
| `_scopeFrame` | runtime frame cache | eagerly-shaped pointer; built lazily by `getScopeFrame()` and then read by variable/callable/direct lookup fast paths | cut candidate #2, but benchmark-gated |

The lazy `RulesLookupState` currently holds the cold fields that used to fatten
every `Rules` instance:

- callable/function/direct declaration maps and caches:
  `functionsByName`, `callableLookupCache`, `directChildRuleEntries`,
  `directDeclarationChildEntries`, `directDeclarationsByName`,
  `directDeclarationLookupCache`
- per-name/version state: `declarationLookupVersionsByName`,
  `functionLookupVersionsByName`, `callableLookupVersion`,
  `functionLookupVersion`, `declarationLookupVersion`
- detached ruleset closure state: `_closureScope`

That struct is the right direction: a leaf declaration-only `Ruleset` pays one
`_lookup === undefined` slot instead of all those maps/counters. Do not inline
those fields back onto `Rules` for API neatness.

Remaining `Rules` suspects, ranked:

1. **`lookupVersion`** — still the ugliest leftover. It is an eager integer on
   every `Ruleset`, while the more specific declaration/callable/function
   versions already moved into `_lookup`. Audit whether the fallback
   non-string/general lookup handle actually needs a direct slot. If not, move it
   into the lazy lookup state or fold it into an existing invalidation epoch.
   Gate on reference/mixin lookup tests and the scope/profile benchmark; do not
   replace one eager int with more maps or a side table.
2. **`_scopeFrame`** — one eager pointer on every `Ruleset` for a runtime cache
   many parsed rulesets may never build. This is the next big shape suspect, but
   it sits on the current fast path (`getScopeFrame()`,
   `lookupScopeFrameVariable()`, callable lookup coverage, inline-import fallback
   frames). Any cut needs measured proof that the extra indirection does not slow
   Bootstrap/reference lookup. Prefer a structural split or placement/runtime
   state owned by evaluated surfaces; do not add a `WeakMap`.
3. **`varsByName`** — also an eager pointer on every `Ruleset`, but it is the
   input index for scope-frame construction and variable lookup. Moving it behind
   `_lookup` may save one slot while adding the exact indirection the hottest
   path does not want. Treat as a measured follow-up only after `lookupVersion`
   and `_scopeFrame`.
4. **Ruleset-only optional fields** (`guard`, `selectorBeforeExtend`,
   `_selectorCacheOwner`) are still subtype/lazy-shape candidates, but they are
   not the shared `Rules` base. Do them after the base suspects above.

### `Selector` (selector.ts:71) — value + 3, one pure-waste
`value` (74, real), `isSelector = true` (82 — **eager own boolean, always true**,
redundant with `instanceof Selector` / nodeType bitmask), `_valueOf` (84, lazy
string cache — OK), `keySetLibrary` (86, lazy — OK). ~12000 selectors carry the
dead `isSelector` slot.

## Field classification (fattest × hottest)

Buckets: (a) boolean→flag-bit, (b) rare/optional→subtype, (c) derivable→compute,
(d) dead, (e) genuinely needed on common shape.

### Rules / Ruleset
- `rulesFlags`: **done.** The formerly eager Rules booleans are now packed into
  one Rules-only int. Note that the current bitset has 12 bits, not the original
  11, because `_placementRepointed` was added to the same packed state.
- `_lookup`: **done.** Callable/function/direct-declaration lookup maps, cold
  child-entry arrays, closure scope, and the specific version counters are now
  behind one lazily allocated `RulesLookupState`.
- `lookupVersion`: **(e) needed today, but still suspicious.** It remains an
  eager int on the shared base even though the other version counters moved into
  `_lookup`. It is used as the fallback invalidation version for general lookup
  handles, so any move must prove the reference/mixin hot path stays fast.
- `_scopeFrame`: **(e)/(b) runtime cache.** The value is lazy, but the pointer is
  still paid by every `Ruleset`. High potential, high risk because variable and
  callable lookup now consult scope frames directly.
- `varsByName`: **(e)/(b) variable index.** Also an eager pointer. Candidate only
  if measured; it feeds scope-frame construction and variable lookup.
- Ruleset own (`frames`, `guard`, `selectorBeforeExtend`, `_composedSelector`,
  `_selectorCacheOwner`, ruleset.ts:116-125): `_composedSelector` and
  `_selectorCacheOwner` are `declare`d optional (lazy) — OK. `guard`/
  `selectorBeforeExtend` are usually undefined for plain rulesets → **(b)** could
  move to a `GuardedRuleset` subtype, but low payoff vs. Rules-flag win; defer.

### Selector family
- `isSelector = true` (selector.ts:82): **(d) DEAD / (c) derivable.** Drop it;
  replace call sites with `instanceof Selector` or the `nodeType` bit. ~12000
  slots removed. Highest effort:payoff ratio in the whole audit.
- Ampersand `_storedSelector` / `_selectorContainer` (ampersand.ts:466-467):
  **(b)** only set when the `&` captures a container; a bare `&` (the common case)
  leaves both undefined. Already lazy — OK, but the two-slot width still shapes all
  3000. Acceptable.
- PseudoSelector `arg` / `generatedPseudoPlacementOverride` /
  `omitWrapperForSingleSelectorList` (selector-pseudo.ts:72-74,31):
  `generatedPseudoPlacementOverride` + `omitWrapperForSingleSelectorList` are rare
  → **(b)** subtype or flag-bit (`omitWrapper...` is boolean → (a)).

### Color
- `_rgbChannels` / `_hslChannels` / `_alphaValue` / `node` (color.ts:95-98):
  **(e) needed** but mutually-exclusive-ish (a color is stored as rgb OR hsl). At
  3000 × 120B this is minor; leave.

### Node base
- `frozen` (node-base.ts:562): **(a) flag-bit** — one bit on the existing base
  `flags`; removes a boolean slot from EVERY node (~39k). Clean win.
- `index` (545): **(e) needed** (assigned by Rules for lookup order).

## Ranked slimming targets  (rank = field_count × instance_frequency)

1. **Cut or fold `Rules.lookupVersion`** (12000 instances × 1 eager int).
   Highest-confidence remaining `Rules` cleanup because the specific counters are
   already lazy. Prove whether the fallback general lookup handle still needs a
   direct slot; if it does not, move it behind `_lookup` or fold it into an
   existing epoch. Benchmark reference/mixin lookup before accepting.

2. **Move/split `Rules._scopeFrame` without slowing frame lookup**
   (12000 instances × 1 eager pointer). This is a real shape tax, but the cached
   value is hot after eval. Try only with a profile-backed design such as
   evaluated-surface state or a structural split, not a side table.

3. **Audit `Rules.varsByName` placement** (12000 instances × 1 eager pointer).
   Possible slot win, but likely worse if it adds indirection to variable lookup.
   Treat as a measured follow-up after `lookupVersion`/`_scopeFrame`.

4. **Drop `Selector.isSelector`** (12000 instances × 1 dead bool).
   Replace with `instanceof Selector` / nodeType bit at the handful of call sites.
   DX: minor — swap `.isSelector` checks for `instanceof`. Very high confidence.

5. **`Node.frozen` → base `flags` bit** (~39k instances × 1 bool).
   One bit; getter/setter keeps the name. DX-neutral.

6. **PseudoSelector `omitWrapperForSingleSelectorList` → flag-bit; move
   `generatedPseudoPlacementOverride` to a subtype/lazy** (3000 instances).
   Lower priority; the override is already `| undefined`.

### Notes on the rule's constraints
- Every proposed change keeps rare data on a **subtype or a flag bit** — no
  WeakMap side-tables introduced. (Provenance already demonstrates the
  side-table-free flag-gated pattern; we extend it.)
- The base `flags` mask has 14/31 bits used (node-base.ts:239-276) — headroom for
  #3. Rules-specific bits go in a separate `rulesFlags` to avoid widening the
  shared base read (#1).
- Verify each stage byte-identical CSS on collapse-bench + the loop `@each` input,
  and A/B the render median (SLIM is perf-driven, so regressions block).
