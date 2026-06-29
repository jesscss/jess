# Live Binding Architecture (jess core evaluation)

> Canonical specification for how mixin body calls, style imports, control-flow
> bodies, and nil-selector output are evaluated/placed. This is the single
> source of truth. If code disagrees with this document, the code is wrong.
> If this document is wrong, fix the document *first*, then the code.
>
> Status: **Invariants locked by owner (2026-06-29). §3 primitive shape pending
> the DRY-audit collapse list.**

## 1. Core principle

The evaluated tree is **one shared canonical source tree**. A mixin body call, a
style import, a `$if/$for/$while` body, or a nil-selector ruleset body is a
**thin replacement**: a lightweight surface mapped over the *shared* canonical
nodes via a per-placement scope frame. It is **never a copy of the sub-tree**.

Per-call / per-placement runtime state (parameter values, variable bindings,
visibility, configured options, output position) lives in the **ScopeFrame**
(`BindingCell`s), in side-maps keyed by the surface, and in the surface's own
copied `options` — **never in copied or mutated canonical nodes**.

## 2. Hard invariants

These are non-negotiable. A change that violates one is wrong by definition.

1. **AST nodes are immutable templates.** During eval/placement, never mutate a
   canonical node's `value`, its children array contents, or its `parent`.
2. **No deep clones. Ever.** No `clone(deep)`, no recursive `cloneFn`, no
   `*WithReusableLeaves`, no per-subsystem copy helper. (The only way to
   reintroduce sub-tree copying is a rigorous proof it beats every alternative
   on *both* memory pressure and speed. Absent that proof: rejected.)
3. **Shallow surfaces SHARE child nodes.** A surface's `rules` array references
   the canonical children directly. The surface does **not** `adopt` them
   (adopt = reparent = mutation). Children keep their canonical `parent`.
4. **Scope resolution over a surface uses `sourceNode`**, not the children's
   `.parent`. A surface sets `sourceNode = canonical`; lookups walk the frame
   chain and `sourceRulesOf`/`getRootSourceRules` to reach canonical state.
5. **Only mutated bits are copied.** A surface copies `options` (placement-local
   visibility/config get mutated). It does **not** copy the children array
   "just in case" — there is nothing to protect against, because (1) forbids
   mutating it.
6. **`setDefined` / live assignment writes the `BindingCell`, never the node.**
   (See `feedback-setdefined-cell-not-node`.)
7. **The raw constructor does NOT parent; the factory does.** `.parent` is
   still the scope chain. The bug is the *constructor* auto-overwriting a
   child's parent. Split it:
   - `new Foo(value, …)` — raw: stores fields, parents nothing. Used by
     surfaces/placements that SHARE canonical children (invariant 3), so a
     shared child's canonical parent is never overwritten.
   - `foo(value, …)` (the lowercase factory, and the parser-facing build API) —
     parents its **direct** Node children (one level; each child was already
     built by its own factory, so no sub-tree re-crawl). Used to build the
     canonical tree.

   This makes invariant (3) hold by construction and removes `frozen`'s
   adopt-gate job. `frozen` has two other jobs to retire separately before it
   can be deleted: the inherit parent-gate (`inherit`, dies with point 2 work)
   and the re-eval gate (`needsReeval = frozen && !F_STATIC`, dies when
   node-retained eval results / the `evaluated` flag are removed). So `frozen`
   is the LAST domino, not the first.
8. **A copy is a rare, proven exception.** Small structural copies (e.g. a
   selector copy to make extend easier) are permitted ONLY with strong evidence
   that a shallow surface / frame mapping is not workable, or that the copy is
   *fewer objects* than standing up a binding frame. The burden of proof is on
   the copy. `clone()` survives only for these narrow, proven cases — never as
   placement/eval isolation.

## 3. The one thin-surface primitive ⟦OPEN: exact name/signature⟧

All thin replacements go through a single factory, conceptually:

```
createThinSurface(canonical: Rules, opts?: {
  liveSlots?: Map<string, BindingCell>,   // params, @arguments, loop counters
  optionsOverride?: Partial<RulesOptions>, // placement-local visibility/config
  closureFrame?: ScopeFrame,               // lexical closure for detached rulesets
}): Rules
```

Behavior:
- New `Rules` (or node) with `options = { ...canonical.options, ...override }`.
- `output.sourceNode = canonical.sourceNode ?? canonical`.
- Push **each** `canonical.rules[i]` WITHOUT adopting (shared; parent stays
  canonical).
- Attach a `ScopeFrame` seeded with `liveSlots` (live cells) over the shared
  children's declaration cells; `parent` = the appropriate lexical frame.

This **subsumes**, and these should collapse into it (see DRY_AUDIT.md):
- `createShallowCallableRulesSurface` + `createOwned/UnlockedCallableRulesSurface`
- `createDerivedIterationRulesSurface` / `createIterationEvalSurface`
- ruleset `createNilSelectorDirectOutputRules`
- the import placement surface (`deriveRulesSurface` + the deleted copy path)
- the per-class `clone()` overrides used for placement

`clone()` itself is **shallow-only** (shared children, copied options, no
adopt) and exists only for genuine "new node, same shape" needs — not placement.

## 4. Scope frames & closures

**Fix the parent WALK, never clone around it.** A shared canonical child keeps
its static (canonical) `parent`. When it is *placed* in a surface (style import,
mixin body, loop) and evaluated, it must resolve free variables up the DYNAMIC
placement chain — where it is being evaluated — not its canonical parent. The
correct fix is to re-point the child's scope-frame *lexical parent* to the
enclosing placement surface at eval time (`Rules._evalPreparedRules`), NOT to
reparent the node and NOT to deep-clone the sub-tree.

Implemented so far: an `import`-type inline placement sets
`options.inlinePlacement` and takes the import SITE as its lexical parent
(`sourceNode` still points at the canonical imported tree). A direct child of an
`inlinePlacement` surface re-points its frame parent to that surface, so it
resolves up the import-site chain. Derived surfaces (mixin output, etc.) keep
their own wired (lexical-definition) frame parent and are left untouched. The
same walk fix should generalize to the other placements (one frame model, §6.2)
instead of any per-subsystem reparent/copy.


- Each surface owns a `ScopeFrame`: live param slots (`BindingCell`, `live:true`)
  + declaration cells over the shared children, `parent` = enclosing frame.
- A read resolves the current `BindingCell` for a name (walking frames) and
  evaluates `cell.value` lazily. Reads never deep-read a node's `.value` for
  "current value" — that is the cell's job.
- A **detached ruleset** (a `Rules` passed as an arg / `@content`) is a lexical
  closure: it captures the **definition** surface's frame (the scope where the
  argument is written), and resolves its free variables there when later called.
  ⟦OPEN: the single chokepoint for this capture — arg-binding time vs
  resolution time — must be specified; today it is fragmented across the
  reference resolver (cached-handle / binding / declaration paths).⟧

## 5. Forbidden patterns (reject in review)

- `clone(deep)`, recursive `cloneFn`, `*WithReusableLeaves`, deep
  `cloneForPlacement`.
- A per-subsystem bespoke copy helper (`copyImportPlacementNode`-style).
- `adopt`-ing shared canonical children for a placement (reparenting).
- Storing per-placement state on a shared node (use the frame / side-map).
- Two parallel "create a surface" or "resolve a variable" code paths where one
  parametrized primitive would do.

## 6. Owner decisions (locked 2026-06-29)

1. **Copies are a rare, proven exception** — see invariant (8). Small selector
   copies for extend are the canonical example, but each must out-prove the
   shallow/frame alternative on object count.
2. **One frame model for all placements.** Mixin output, style imports, and
   `$for`/`$while` bodies use the **same** frame model — no per-subsystem
   placement layer. (`mixinOutputSlot` / source-backed slots fold into it.)
3. **`sourceNode` is purely the lookup hook**, present so resolution works once
   constructor auto-reparenting is removed (invariant 7). It is the surface's
   only link back to canonical; nothing more. `_passedRulesWrapper` /
   `Mixin.sourceNode` collapse into exactly this.
4. **Closure capture chokepoint**: implementer's discretion — pick the single
   point that makes sense (the resolver must not keep N divergent paths).

## 7. References

- `feedback-setdefined-cell-not-node` — cells, not nodes.
- `parseman-wrapper-is-scope-identity` — wrapper = scope identity.
- `DRY_AUDIT.md` — enumerated parallel machinery to collapse onto §3.
- `AGENTS.md` §"Performance Direction" — one canonical source tree, lazy
  per-placement state, no cloning as eval isolation.
