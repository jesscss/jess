# SLIM NODES — DYNAMIC heap census (mixin / ref / extend workload)

Companion to `SLIM_NODES_AUDIT.md`. That audit's census came from the STATIC
collapse-bench tree, which has **zero** Extend / Reference / Mixin / Call
instances — so the per-instance weight of the eval-heavy nodes was untracked.
This file fills that gap: a live-tree census on a mixin + reference + extend
workload, plus the field matrix for the fattest DISJOINT node it surfaced.

## Method / grounding

- **Live-instance census:** `perf/heap/dyn-census.mjs` renders an extend/mixin/ref
  workload (1200 `.block-N` rulesets, each calling a guarded `.mx()` mixin, an
  `&:extend(.theme)`, a `mix()`/`lighten()`/`darken()` Call, plus 400 `:extend(.pill all)`
  selector-extends), holds the LIVE post-eval tree from `Compiler.compile()` in
  scope, `writeHeapSnapshot()`s, then counts snapshot `object` nodes by
  constructor name and sums `self_size`. Run with `node --expose-gc`.
- **Field inventory:** direct read of each class body — own instance fields =
  class-body field decls + constructor `this.X =` assignments (prototype
  getters/setters excluded; they don't occupy the instance shape).

## Live census (dynamic workload, 53,322 tree nodes, 8.01MB)

Ranked by total bytes. **Extend / Reference / Call / Mixin are the dynamic-only
rows absent from the static audit.**

| class          |  count | avg bytes |  total | notes |
|----------------|-------:|----------:|-------:|-------|
| Ruleset        |   8405 |       288 | 2.42MB | fattest × hottest — inherits fat `Rules` base. **FENCED**: `Rules`/`Ruleset` owned by the render-pipeline agent (rules.ts); do NOT slim here. |
| Declaration    |  10009 |       120 | 1.20MB | lean own shape (name/value/important slots). |
| **Reference**  | **7211** |   **128** | **923.0KB** | **dynamic-only, 3rd-fattest total.** Own fields 5→4 after this slice (see Part 2). |
| Dimension      |   6406 |       112 | 717.4KB | lean (number + unit). |
| Color          |   4804 |       128 | 614.9KB | 4 channel-cache slots (see static audit). |
| BasicSelector  |   4802 |       120 | 576.2KB | Selector base + string value. |
| **Call**       | **2402** |   **136** | **326.7KB** | **dynamic-only.** 3 own fields (name/args/contentNode) — all used, lean disjoint shape. |
| Rules          |   1209 |       247 | 298.0KB | scope containers (mixin bodies + `.inner`). |
| List           |   2403 |       120 | 288.4KB | value list. |
| **Extend**     | **1600** |   **128** | **204.8KB** | **dynamic-only.** 4 own fields (selector/target/namespace/flag) — all used, lean disjoint shape. |
| Nil            |   1602 |       104 | 166.6KB | sentinel. |
| Operation      |   1203 |       120 | 144.4KB | binary op. |
| Paren          |   1204 |       104 | 125.2KB | grouping. |
| VarDeclaration |      5 |       240 |  1.2KB  | (`@base`/`@c1`/`@c2` + mixin params). |
| **Mixin**      |    **1** |   **408** | **408B** | **dynamic-only, fattest PER-INSTANCE** (extends fat `Rules`), but only 1× live — total weight negligible. Not a slim target on frequency. |
| Condition      |      1 |       240 | 240B   | mixin guard. |
| (tail)         |    ~25 |     24–120 | <1KB   | SelectorList, ComplexSelector, Function, Any, Interpolated, Sequence, Number, Selector, SimpleSelector, Node. |

### How heavy ARE Extend / Reference / Mixin / Call vs Rules on a dynamic workload?

- **Reference is the dynamic heavyweight**: 7211 live × 128B = **923KB**, the
  3rd-fattest class overall behind only Ruleset and Declaration, and by far the
  fattest node that is NOT part of the fenced `Rules`/`Ruleset` family. This is
  the node to slim on dynamic workloads.
- **Call** (2402×, 327KB) and **Extend** (1600×, 205KB) are meaningful but
  already-lean disjoint shapes: their field matrices show every own field used
  by the single kind, so there is no naive-split fat to reclaim (per the SLIM
  rule's dispatch-vs-shape test).
- **Mixin** is fattest per-instance (408B, inherits the fat `Rules` base) but
  materializes only **once** per unique mixin definition — total heap weight is
  negligible. Frequency, not per-instance size, governs the slim payoff, so
  Mixin is not a target.
- **Rules/Ruleset** remain #1 but are FENCED (render-pipeline agent owns
  `rules.ts`). The static audit's `rulesFlags` int already collapsed 11 Rules
  booleans → 1 slot; further Rules slimming belongs to that agent, not here.

## Part 2 — slim target: `Reference.role` (derivable field → dropped)

`Reference` (reference.ts:3637) own instance fields BEFORE: **5** —
`_rulesLookupHandle`, `target`, `key`, `rawKey`, `role`.

Per-kind field matrix (single kind — `Reference` is not split):

| field                | stores                          | used? | verdict |
|----------------------|---------------------------------|-------|---------|
| `target`             | parent Reference/Call           | yes   | keep    |
| `key`                | normalized lookup path          | yes   | keep    |
| `rawKey`             | original un-flattened lookup    | yes (render + structural reuse) | keep |
| `_rulesLookupHandle` | lazy rules-lookup cache         | yes (mutated on hot path) | keep |
| `role`               | copy of `options.role` (`AnyRole`) | **derivable** | **DROP — read `this.options.role`** |

`role` was a pure copy of the constructor's `options.role`, stored eagerly on
every one of the 7211 live References. It is read at exactly **4 in-file sites**
(all `new Any(..., { role: referenceNode.role })` in the fallback/declaration
finalizers) and **nowhere else in the monorepo** (`Reference.role` has no
external reader and no setter). Since `_options` is retained intact on the `Node`
base, `this.options.role` yields the identical value — a textbook *derive, don't
store*.

Own instance fields AFTER: **4** (`_rulesLookupHandle`, `target`, `key`, `rawKey`).

**Measured effect** (dyn-census, before → after): Reference avg **136B → 128B**
(one 8-byte SMI/pointer slot removed × 7211 = ~57KB); Reference total
**980.7KB → 923.0KB**; whole dynamic tree **8.07MB → 8.01MB**.

**Gate:** core suite **2762 passed / 0 failed** (15 skip, 2 todo); CSS
**byte-identical** across collapse + dynamic + extend fixtures (46,313 lines,
`diff -q` clean). No `as any`, no side-table.

## Fat targets LEFT for a later slice (pipeline collision)

- **`Ruleset` / `Rules`** — #1 fattest×hottest (8405× × 288B = 2.42MB), but
  `rules.ts` is owned by the concurrent render-pipeline rewrite. The remaining
  Rules levers (e.g. lazy `lookupVersion` counters, static-audit item 5) must be
  done by that agent to avoid a diff collision.
