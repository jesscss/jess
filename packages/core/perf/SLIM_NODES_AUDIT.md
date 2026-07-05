# SLIM NODES — node-shape audit + ranked slimming plan

Read-only audit of `packages/core/src/tree/*.ts` node shapes for the "SLIM NODES"
standing rule (lean shapes for good V8 hidden classes; prefer type-specialization
+ shared util fns over fat nodes; rare data on a subtype, never a WeakMap
side-table; performance is the driver).

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

### `Rules` (rules.ts:893) — ~27 eager own fields; the fat base

Booleans (all eager `= false`, own slot on all 12000 Rulesets):
- `hasDirectChildRuleSurface` (905)
- `hasDeclarationChildSurface` (906)
- `hasVarDeclarationChildSurface` (907)
- `hasReferenceImportChildSurface` (908)
- `hasExactCallableChildSurface` (909)
- `hasExactMixinChildSurface` (910)
- `hasExactRulesetChildSurface` (911)
- `_bodyEvaluated` (934)
- `_hasExtends` (948)
- `_hasReferenceImports` (954)
- `_registrationPrepared` (956)

Integer versions (eager `= 0`):
- `lookupVersion` (919), `declarationLookupVersion` (920),
  `callableLookupVersion` (922), `functionLookupVersion` (923)

Lazy Maps / refs (undefined until used — already OK, low-frequency):
- `functionsByName`, `varsByName`, `callableLookupCache`,
  `directChildRuleEntries`, `directDeclarationChildEntries`,
  `directDeclarationsByName`, `directDeclarationLookupCache`,
  `declarationLookupVersionsByName`, `functionLookupVersionsByName`,
  `_scopeFrame`, `_closureScope`
- child slot: `rules` (896)

### `Selector` (selector.ts:71) — value + 3, one pure-waste
`value` (74, real), `isSelector = true` (82 — **eager own boolean, always true**,
redundant with `instanceof Selector` / nodeType bitmask), `_valueOf` (84, lazy
string cache — OK), `keySetLibrary` (86, lazy — OK). ~12000 selectors carry the
dead `isSelector` slot.

## Field classification (fattest × hottest)

Buckets: (a) boolean→flag-bit, (b) rare/optional→subtype, (c) derivable→compute,
(d) dead, (e) genuinely needed on common shape.

### Rules / Ruleset
- 11 booleans (rules.ts:905-911, 934, 948, 954, 956): **(a) flag-bit.** All are
  binary state. They are *Rules-specific*, so pack into a NEW `rulesFlags` integer
  on `Rules` (NOT the base `flags`, which every leaf node shares — adding
  Rules-only bits there would widen a field read by non-Rules nodes; keep base
  `flags` for cross-cutting concerns). 11 bits → one int, saving ~10 slots × 12000.
- 4 lookupVersion ints (919-923): **(e) needed**, but candidates to fold into
  fewer counters — several always reset together in `resetDerivedState`
  (1048-1051). Could collapse `lookupVersion`/`declarationLookupVersion`/
  `callableLookupVersion`/`functionLookupVersion` into a small struct only
  allocated when lookups actually run (most leaf-heavy Rulesets never do multi-kind
  lookup). Lower confidence — verify against lookup hot path first.
- lazy Maps/refs: **(e) needed**, already `undefined`-default (good). No action.
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

1. **`Rules` boolean pack → `rulesFlags` int** (12000 instances × 11 bools).
   Biggest win. Add `rulesFlags = 0`, convert the 11 `has*`/`_hasExtends`/
   `_hasReferenceImports`/`_bodyEvaluated`/`_registrationPrepared` reads/writes to
   bit ops, update `resetDerivedState` (rules.ts:1039-1053) to one `rulesFlags = 0`.
   DX: internal getters/setters can preserve the property names (like the base
   already does for `generated`/`hoistToRoot`), so external call sites are
   unchanged — DX-neutral.

2. **Drop `Selector.isSelector`** (12000 instances × 1 dead bool).
   Replace with `instanceof Selector` / nodeType bit at the handful of call sites.
   DX: minor — swap `.isSelector` checks for `instanceof`. Very high confidence.

3. **`Node.frozen` → base `flags` bit** (~39k instances × 1 bool).
   One bit; getter/setter keeps the name. DX-neutral.

4. **PseudoSelector `omitWrapperForSingleSelectorList` → flag-bit; move
   `generatedPseudoPlacementOverride` to a subtype/lazy** (3000 instances).
   Lower priority; the override is already `| undefined`.

5. **(lower confidence) collapse Rules lookupVersion counters** (12000 × 4 ints).
   Only if the lookup hot path tolerates a lazily-allocated version struct; must
   measure — do NOT downgrade the lookup fast path for a slot count.

### Notes on the rule's constraints
- Every proposed change keeps rare data on a **subtype or a flag bit** — no
  WeakMap side-tables introduced. (Provenance already demonstrates the
  side-table-free flag-gated pattern; we extend it.)
- The base `flags` mask has 14/31 bits used (node-base.ts:239-276) — headroom for
  #3. Rules-specific bits go in a separate `rulesFlags` to avoid widening the
  shared base read (#1).
- Verify each stage byte-identical CSS on collapse-bench + the loop `@each` input,
  and A/B the render median (SLIM is perf-driven, so regressions block).
