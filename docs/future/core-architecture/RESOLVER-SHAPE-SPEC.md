# Jess AST v2 — Variable Lookup + Binding Shape (Resolver Spec)

Status: PROPOSED (design agent a248c47, surveyed tree/ScopeFrame, tree2 collapsed-Map, lookup-minimal-model, R3 live-bindings, lookup-perf-audit) → owner-steered → correctness-review R1 (defects A–D) → **owner write-model supplied, revised R2** → re-review. Fixes a CONFIRMED bug: `ast/` mis-resolves regular vars (collapsed Map + MAX_VAR_DEPTH, no exclusion).

**REFERENCE (correctness is derived from these, nothing else):** (a) `ast/parse-host/__tests__/var-exclusion.test.ts` + the intended-design cases in this spec (branch `fix/var-exclusion`); (b) the owner's stated semantics — per-declaration exclusion, lazy eval, order-independent last-wins, write-by-sigil, `$!` = current-at-eval-point, unbound → `ReferenceError`. The existing `tree/scope-frame.ts` / `reference.ts` are **NOT a working reference implementation** — they were never fully correct. Mine them ONLY for MECHANISM IDEAS (the exclusion-set concept, the sync-span release timing); every correctness claim below is justified against a test/semantic requirement, never "legacy does X."

### Intended-design cases (must pass)

| Input | Output | Rule exercised |
|---|---|---|
| `@a:1; @a:@a+1` | `2` | per-decl exclusion falls back to earlier same-name entry |
| `@a:@a+1` (no earlier `@a`) | `ReferenceError` on use | exclusion → no fallback → undefined, not a cycle |
| `@a:@b; @b:@a` | `ReferenceError` | mutual cycle terminates by accumulated exclusion |
| `@a:5; .x{ @a:@a+1 }` | `6` | inner scope falls back to outer entry |
| `.x{ color:@a } @a:red` | `red` | forward reference / order-independence |
| `.m($a){ $a:2; c:$a }` called `.m(1)` | `c:2` | **Defect C — BODY WINS**: body `$a:2` pushes onto the call-frame stack, last-wins over the param entry |
| `$!a := v` where `a` is only a stack var | `ReferenceError` | `$!` consults cells only; a plain var has no cell |
| `.x{ $a:0; $a:=2 c:$a }` | `c:2` | `:=` reassigns the CURRENT-scope binding (incl. current), no shadow, no error |
| `$a:0; .x{ $a:=2 } c:$a` (root read) | `2` | `:=` reassigns the nearest OWNING (outer) scope; no `.x`-local shadow created |
| `$a := 2` with no `$a` bound anywhere | `ReferenceError` | `:=` on an unbound name errors |
| `.x{ $foo:bar; foo:buz }` via `$.foo` / `$namespace.foo` | `ReferenceError` (ambiguous) | member access sees BOTH a var and a same-named property |
| `.x{ $foo:bar }` via `$namespace.foo` | `bar` (variable) | member access, var-only |
| `.x{ foo:buz }` via `$namespace.foo` | `buz` (property) | member access, property-only |
| `.x{ /* neither foo */ }` via `$namespace.foo` | `ReferenceError` | member access, absent |
| `.x{ $foo:bar; foo:buz }` — plain `$foo` read (NOT member access) | `bar` (variable) | plain read never consults `propIndex` → no ambiguity |

## The governing rule — THE SIGIL PICKS THE SYSTEM (owner)

There are two binding systems and **the write sigil alone decides which one a statement touches** — reads and writes never cross-consult.

| Sigil | System | Read | `name: v` (create) | `name := v` (reassign) |
|---|---|---|---|---|
| `@` / `$` | **STACK** (declIndex) | backward-walk the per-name decl stack + exclusion | push a decl onto the **current** scope's stack | **reassign nearest owning scope INCLUDING current** ("drop the `let`"): nearest scope up the chain (starting at the current scope) whose stack has `name` → reassign it last-wins, **DO NOT shadow**. Unbound (no scope binds `name`) → `ReferenceError`. |
| `$!` | **CELLS** | the nearest cell's CURRENT value | create/set a cell in the current scope | **nearest cell INCLUDING current**: nearest `cells` entry for `name` (current scope first) → set it. Unbound → `ReferenceError`. |

- `:=` semantics (owner, "drop the `let`"): reassign the nearest existing binding *including the current scope* — it is NOT strictly-enclosing-only and it NEVER creates a shadow. `.x { $a:0; $a:=2 }` reassigns the current-scope `$a` → **2** (not an error). `$a:0; .x { $a:=2 }` reassigns the OUTER `$a` (nearest owning scope), creating no `.x`-local binding.
- `!global` → **just translates to `:=`** — there is NO separate set-at-root / create-at-root op. It reassigns the nearest existing binding (incl. current); if the user has shadows between the target and root, that is on them. (Removed: the old "targets the outermost frame" semantics.)
- `!default` / `?:` → **create-if-absent** on the sigil's system (no-op if the name already resolves there).

This rule collapses R1's hardest defects: a write mutates only the sigil's own system, so there is **no stack→cell promotion** and **no in-frame collision to arbitrate**.

## The shape — TWO PARALLEL purpose-built indexes per frame

```
Frame {
  parent                            // lexical / call-site chain
  kind: 'scope' | 'transparent'     // R3 control-flow + loop-iteration frames
  declIndex:      DeclIndex | null  // regular @/$ vars + PARAMS — IMMUTABLE per body, shared BY REFERENCE
  cells:          Map<name, BindingCell> | null   // $! live bindings + loop induction — MUTABLE, per-frame
  reassign:       Map<name, VarDeclaration> | null   // := / !global overlay — per-ACTIVATION last-wins, consulted before the shared declIndex; NOT on the shared index
  callables:      Map<name, MixinDef[]> | null
  propIndex:      PropIndex | null   // NON-ROOT only: LAZY per-body property index — built on FIRST member-access, cached; MEMBER-ACCESS ONLY (see below)
  pending:        VarDeclaration[] | null   // interpolated-NAME decls (@{x}:) — dynamic key, see Defect D
  importFallback: Frame | null      // @import child-surface chain  (was `fallbackFrame`)
  closureFrame:   Frame | null      // detached-ruleset DEFINITION closure — DISTINCT from importFallback
}
DeclIndex { byName: Map<name, VarDeclaration[]> }   // per name: source-ordered STACK of decl NODES, last wins
// (perf-review CUT: no DeclEntry wrapper — node.index = position, node.valueNode() = RHS; a stack entry is a bare node,
//  so the never-mutate invariant is trivially true — ALL mutable state lives in `cells`.)
BindingCell { value; readonly; isPrivate; owner: Frame }   // one mutable cell; value written in place
```

- **Regular `@`/`$` var (and PARAMS)** = a per-name **stack** of declaration nodes, read **hoisted-lazy last-wins** (order-independent). `@foo` and `$foo` resolve IDENTICALLY — the sigil is dialect-only, NOT a read-mode switch (snapshot semantics DELETED; there is no point-in-time `$` read). Lookup (allocation-free): **backward `for` walk** over `declIndex.byName.get(name)`, `continue` past any entry whose node is in the active exclusion set (and any failing filter / leak-order gate — see below); first survivor wins; else ascend to `parent`. NO `.filter` (no intermediate array). NO depth cap.
- **`$!` live binding** = the mutable `cells` map ONLY. Read = the nearest cell's CURRENT value at the sequential eval point (owner: "currently bound at the sequential evaluation point" — NOT lazy/last-wins). Write mutates the owner's shared cell in place. This is the ONLY sequential/current read mode; `$` is NOT it.
- **Reads are TWO fully separate lookups, dispatched by sigil** — regular (`@`/`$`) read touches declIndex ONLY; `$!` read touches cells ONLY. No structure is contorted to do both, and neither is consulted on the other's behalf. (Fixes R1 Defect B.)
- **Leak-order gate (the only position gate left):** a mixin-output declaration leaked into the caller frame is source-order gated — a reader textually before the emitting call must not see it. This gate compares the entry's source index against the reader's leak-start and is SKIPPED entirely (single `undefined` check) for any read with no leak in scope — which is every read in a leak-free body. It is unrelated to (and outlives) the deleted snapshot mode.

### PARAMS live in the STACK, not cells (the key consequence)

A mixin/function parameter is bound and read as a plain `$a` / `@a`, so it is resolved through the **STACK** system, never a cell. Placement: a mixin/function call builds a small **per-call param frame** (its own tiny `declIndex` built from the bound args) that is the **parent of the body frame** — i.e. layered *between* the shared body index and the caller-lexical chain. So a body-level decl (in the shared body index, nearer) naturally shadows a same-named param (in the outer param frame, farther) by the ordinary parent walk — no per-call copy of the shared index, no mutation of it. Consequences:

- **Defect A gone:** a param write inside the body (`$a: 2`) is a regular-sigil `create` — it is already a parse-time decl in the shared body index (the body frame), which the read walk hits before the param frame; no promotion from a param-cell to a decl is ever needed.
- **Defect C CONFIRMED → BODY WINS (intended-design case above):** `.m($a) { $a: 2; c: $a }` called `.m(1)` → reading `$a` from the body frame finds the body's `$a: 2` (shared body index) BEFORE ascending to the param frame's `$a: 1` → `c` = **2**. Body-nearer-than-param falls out of the parent walk; last-wins/shadowing is the whole point. A fixed intended-design case, not a validate-then-lock. (A call with NO body `$a` decl walks up to the param frame → the arg value.)
- `cells` now holds ONLY `$!` live bindings and loop-induction counters (below). Everything read through a plain sigil is in the STACK system.

## Loop counters — RESOLVED: per-iteration transparent frame on the STACK (not a cell)

A loop variable `$i` is read as a plain `$i`, so — by the sigil rule — it MUST resolve through the stack, not cells. Reintroducing a cell for it would force the regular read path to consult cells again, resurrecting Defect B. **Decision: each iteration runs the ONE shared body under a fresh `kind:'transparent'` frame whose `declIndex.byName` holds a single-entry stack `{ $i: [<synthetic decl for this iteration's value>] }`.**

- **No unbounded growth:** the per-iteration frame (or just its 1-entry stack) is replaced each pass — the stack length stays 1; we never append N entries to one stack.
- **No per-iteration body copy (R3 invariant 1 held):** the body's shared `DeclIndex` is untouched; only the tiny transparent wrapper is re-seeded. "Mutate in place" is realized by swapping the single synthetic entry, not by a mutable cell.
- **Never-mutate invariant held:** the synthetic decl lives in the disposable per-iteration frame's OWN declIndex, never in the shared body index.
- Body writes to other names (`$total: $total + $i`) follow the normal sigil rules into the enclosing scope (transparent frames are scope-transparent for plain declarations, per R3).

## `:=` / `!global` reassignment mechanism — a per-activation OVERLAY (design, not hand-wave)

`:=` reassigns the nearest owning scope's binding **including the current scope**, without shadowing; `!global` is just `:=` (no separate root op). The design problem: the owning scope may be a **parent** whose `declIndex` is the shared, immutable, parse-time body index — which must NEVER be mutated (every frame entering that body shares it by reference). Reassignment therefore cannot write into `declIndex.byName`.

**Mechanism — a frame-local reassignment overlay:**

```
Frame.reassign?: Map<name, VarDeclaration> | null   // per-ACTIVATION, mutable; NOT on the shared DeclIndex
```

- **Write `name := v` from frame C** (STACK system): walk C upward **inclusive**; the owning frame `F` is the nearest whose `declIndex.byName.has(name)` OR `reassign.has(name)` (a prior `:=` already established one there). None found → `ReferenceError`. Then `(F.reassign ??= new Map()).set(name, syntheticDecl(v))`. The overlay lives on `F`'s **activation object** (a live, mutable, per-call frame on the current eval stack) — mutating it is safe and is observed by every inner read that walks up to `F`, which is exactly the non-shadowing reassignment semantic. `!global` uses the identical procedure. The `$!` (cell) system's `:=` uses the analogous `cells` walk and in-place cell write.
- **Read** (the backward stack walk reaches frame `F` for `name`): treat `F.reassign?.get(name)`, when present, as the **last-wins (newest) entry** — consulted BEFORE the shared parse-time entries at `F`, still subject to exclusion (its own node is excluded while its RHS evaluates, so `$a := $a + 1` reads the prior binding).
- **Invariant held:** the shared parse-time `DeclIndex` is never written; every `:=`/`!global` lands in a per-activation `reassign` overlay on the owning frame. This is the one write mechanism that reaches a parent binding without touching the shared index.

Ordering note (OPEN): because the overlay is the last-wins entry, a hoisted-lazy read sees the reassigned value regardless of read position — consistent with `@`/`$` being hoisted. Both owner-pinned cases place the `:=` textually before the read; whether a read textually BEFORE the `:=` also observes it (full hoist) or not is not pinned (owner fixed reassign-nearest-incl-current + no-shadow + unbound→error, not the overlay's hoist ordering) — flagged below.

## `$!` on a stack-only name → `ReferenceError` (confirmed)

Because `$!` reads/writes consult `cells` ONLY: if `a` is bound only as a plain stack var (a `@a`/`$a` decl or a param) with **no cell**, then `$!a` (read) and `$!a := v` (reassign) both MISS the cell chain → **unbound-live → `ReferenceError`**. You cannot `$!`-read or `$!`-mutate a plain declared variable. A live cell must first be established by a create-form `$!a: v`; `:=` (and `!global`, which now equals `:=`) only ever *reassign* an existing cell — neither auto-creates one. This is intentional (owner: live-assign needs an existing live binding) and keeps the two systems genuinely disjoint.

## Member/namespace ACCESS disambiguation — a SEPARATE resolution, not a plain read

This rule applies ONLY to the accessor forms `$.foo` / `$namespace.foo` (reaching into a named/accessed scope). A **bare `$foo` / `@foo` read is NOT member access** and is entirely unaffected — it hits the variable stack and NEVER consults `propIndex`.

Member access resolves `foo` in the accessed scope against BOTH the variable stacks AND same-named CSS **property** declarations:

- only a variable `$foo` exists → the **variable**.
- only a property `foo:` exists → the **property**.
- **BOTH exist** (`.x { $foo: bar; foo: buz }` reached via `$.foo` / `$namespace.foo`) → **`ReferenceError` (ambiguous)** — the accessor cannot decide.
- neither → **`ReferenceError`**.

**Implementation — the variable STACK stays variables-only** (property declarations are NOT stored in it). Member access needs TWO things from the accessed scope: (a) does a same-named **property** exist (for the both→`ReferenceError` case), and (b) the property's **VALUE** (for the property-only case). The tracking shape is an OPEN owner call; the constraint that decides it: **properties are the BULK of a ruleset's declarations, and member access is comparatively RARE** — so any per-decl bookkeeping paid at ruleset-build time taxes the common (no-member-access) render for a feature almost no render uses.

Options considered:

1. **Lazy on-demand build, cached (RECOMMENDED).** Build the accessed scope's property index only when a member access into that scope FIRST occurs; cache it (keyed on the body node, like `DeclIndex` — see perf) so repeat accesses into the same scope pay once. **Zero cost on the common path**; cost falls only on scopes actually member-accessed. Delivers both (a) and (b) from one structure.
2. **Eager `propNames: Set<string>` + on-demand value scan.** A cheap existence check is always available, but it pays a **per-property Set-insert on EVERY ruleset build** — precisely the bulk-of-declarations common-path tax we must avoid — AND still needs a second on-demand scan for the value (b). Rejected: worst of both (taxes the common path *and* doesn't answer (b)).
3. **Separate cached property stack, built lazily.** Same laziness as (1) but structured as a per-name stack mirroring `DeclIndex` (name → property decl(s), last-wins). This is really (1) with the right internal shape and is what the recommendation adopts.

**RECOMMENDED shape = (1) realized with (3)'s structure — a LAZY `PropIndex`:**

```
PropIndex { byName: Map<name, Declaration[]> }   // property decls, source-ordered, last-wins (same shape as DeclIndex)
```

- **Populated lazily on THREE triggers (owner), never eagerly at ruleset build:**
  1. a **member-access lookup** (`$.foo` / `$namespace.foo`) into the body;
  2. a lookup for a **name that also has a variable decl** in that body (collision is possible → the property side must be known to raise the ambiguity error);
  3. a **generic declaration lookup by name** — a lookup that could resolve to either a variable OR a property (must consult both sides).
  A read that is unambiguously variable-only (a plain `$foo`/`@foo` read of a name with no property counterpart, and not one of the above) never triggers a build.
- Cached BY REFERENCE on the body node (a `WeakMap<Body, PropIndex>`, exactly like `DeclIndex`) so every frame entering that body and every later triggering lookup reuses it — at most one scan per body ever triggered, zero for the rest.
- Member access into the scope: probe the var stack AND `propIndex.byName.get(name)`. Var-hit AND prop-hit → `ReferenceError` (ambiguous). Prop-hit only → the property's last-wins value. Var-hit only → the variable. Neither → `ReferenceError`.
- Plain `$foo`/`@foo` reads NEVER build or consult `propIndex` — they pay nothing and can never raise the ambiguity error (the var simply wins). Root scope has no bare properties → `propIndex` is a non-root-only concern (null at root).

**Perf re-review item:** the perf reviewer must confirm (i) the lazy build fires ONLY on the three triggers — never on an unambiguous variable-only read — so a render with no member access, no var/property name collisions, and no generic by-name declaration lookups builds ZERO `PropIndex` (instrument benchmark.less to establish the actual trigger rate; note that trigger (3), a generic by-name declaration lookup, is broader than member access and may fire on real corpora — quantify it), and (ii) the body-node cache is shared by reference (a scope whose index is triggered K times builds ONE index). Judge the lazy-vs-eager call explicitly against the measured trigger rate; the recommendation is lazy precisely because the common path must stay untaxed.

## Lazy eval + per-declaration EXCLUSION (the correctness crux)

**Variables are LAZY:** a decl node's value is evaluated ON-DEMAND at REFERENCE time, never at declaration. When the resolver begins evaluating a declaration's RHS (triggered by a reference), it adds THAT declaration node to an active exclusion `Set<Node>` (mechanism idea: the exclusion-set concept), held for the SYNC SPAN of the value eval, released on sync-phase completion. Release must be on sync-phase completion and NOT a deferred `.finally`, because the semantic requirement is that two independent overlapping async reads of the same declaration must each resolve — a `.finally` release keeps the declaration blocked across the whole await window and falsely rejects the second read. The set ACCUMULATES DOWN THE DESCENT — each nested value-resolution adds its own declaration — so the backward walk `continue`s past ALL currently-resolving declarations.

- Self-cycle `@a:@a+1` → `@a` excludes itself → falls back to an earlier same-name entry, else undefined.
- **Mutual cycle** `@a:@b; @b:@a` → resolving `@a` excludes `@a`, evaluates `@b`, excludes `@b`, evaluates `@a` — already in the accumulated set → undefined. Terminates at ANY depth.
- `@a:1;@a:@a+1`→2, `@a:5;.x{@a:@a+1}`→6, forward-ref works.

Cycles impossible by construction → `MAX_VAR_DEPTH` deleted. Because eval is LAZY + exclusion-context-dependent, the resolved VALUE cannot be cached (re-evaluates per reference against the active exclusion set) — only the STACK is cacheable.

## Defect D — homes for the surfaces R1 left unplaced

- **Interpolated declaration NAMES** (`@{x}: v`) — a decl whose key isn't known until eval can't be statically keyed into `declIndex.byName`. Home: the frame's **`pending: VarDeclaration[]`** list. A regular lookup that could be affected by a pending dynamic decl resolves the pending names eagerly (or, conservatively, reports `uncovered` and defers — a "bail on pending declarations" gate). Once a pending decl's name resolves to a concrete string it is pushed onto that name's stack like any create.
- **Indirect reads** (`@@name`, `$$name`) — these are READS, not new storage: resolve `name` to a string via the normal stack read, then do a second normal stack read for that string. No new home; two chained regular lookups.
- **Detached-ruleset closure fallback** — a detached ruleset captures its DEFINITION scope; unresolved body names fall back to that closure (caller-first, definition-fallback). R1 wrongly folded this into the import chain. Home: its OWN field **`closureFrame`**, consulted after the `parent` walk and kept DISTINCT from `importFallback` (they have different visibility/ordering and must not share one slot — the R1 conflation was the bug).
- **Configured-import (`with { … }` / compose) vars** — read inside the module as plain `@var`, so by the sigil rule they belong in the **STACK**, NOT in cells (an earlier design placed them as "live slots," which forced a coarse-coverage boolean and blocked the crawl-retire; the sigil rule places them correctly). Home: synthetic decl entries pushed onto the imported module's ROOT-frame `declIndex` at import time (`with{}` value wins by last-wins ordering vs the module's own `!default` defaults — the exact ordering vs `!default` is flagged for the import spec). Indexing them as real covered decls is precisely what lets the `uncovered→crawl` route retire.

## Strict vs optional

Orthogonal flag. strict (default): miss → THROW `ReferenceError` (HARD: `fns/less/isdefined.ts` catches `ReferenceError` — the optional path depends on it). optional (`isdefined`/`!default`/opt-in accessor): miss → sentinel, no throw. `miss` is authoritative (no blind crawl); `uncovered` (unindexed child/import surface) is the only further descent.

## Mixin same-args exclusion — SEPARATE tracker, shared CONCEPT

Keep the mixin `CallMap` (`Map<Call, ArgSignature[]>`, arg-value key) SEPARATE from var exclusion (`Set<Node>`, node-identity key). A node-identity set CAN'T express arg-value dependence (same mixin recurring with DIFFERENT args must be allowed). Unify only in concept: "an active-exclusion stack ⇒ termination by construction, no depth cap anywhere." (Verified: ast/ handles ruleset-name recursion structurally already; the identity fail-safe is optional hardening — NOT same-args.)

## Perf — cheap by construction (fixes audit finding c)

- `DeclIndex` built ONCE per body node (field on the parsed body / `WeakMap<Body, DeclIndex>`), SHARED BY REFERENCE across every frame entering that body — a mixin called K times / loop walked N times builds ZERO new indexes, ZERO body rescans. The current `ast/` `collectVars` rescans + re-allocates a Map per frame entry = O(calls × body) (audit finding c); building the index once per body and sharing it by reference is the requirement that removes that cost, made a first-class invariant here.
- `propIndex` (member-access disambiguation) is built **LAZILY** — only on the first member access into a body — and cached BY REFERENCE on the body node, never per frame, null at root. On a no-member-access render it is NEVER built; plain reads never touch it. See the member-access section for the lazy-vs-eager evaluation (flagged for perf re-review).
- Per-frame allocation = only the small `cells` map (mutable-`$!` scopes) + the per-iteration transparent-frame stack (loops) + `pending` (dynamic-name scopes only). A plain nested rule = no per-frame index.
- Lookup O(depth × bucket), bucket length 1 in the common case → ~O(depth). NO MAX_VAR_DEPTH.
- HARD INVARIANT: shared `DeclIndex` is NEVER mutated — all mutation (leaks, `:=`/`!global` reassignment via the per-activation `reassign` overlay, loop induction, per-call param frames) lands in frame-LOCAL structures (a frame's `reassign` map, a per-call param frame's own tiny index, a transparent frame's 1-entry stack, or `cells`). The shared body index is read-only — any in-place mutation would corrupt every frame sharing it by reference.

### Perf-review verdict (afc7c6, upheld R2)

- BLESS the backward for-walk (near-optimal; common bucket length 1). DO NOT build the resolved-value cache (no workload — the 7× gap is mixin/recursion eval, not var-of-var chains) or index-as-you-go (that IS the O(calls×body) regression). The shared `DeclIndex` is the one real perf bet — keep it.
- CUT `DeclEntry`→bare `VarDeclaration` node. CUT `kind:'transparent'` if derivable from `declIndex===null` — BUT loop-iteration frames now carry a 1-entry declIndex, so `kind` may need to survive to distinguish a transparent (scope-passthrough for plain writes) frame from a real scope; verify vs the write-model consumers before dropping the tag.
- HOLD THE LINE retiring `uncovered`→crawl for member/`@@`/namespace reads → this KILLS legacy's EIGHT coverage booleans (declarationsCovered/callablesCovered/…). Biggest simplification; guard it. Config-import-as-stack-decls (Defect D) is what makes this reachable.
- Exclusion `Set` = O(1) per-decl-eval (not per-read); per-entry flag REJECTED (writing to a shared-by-ref entry corrupts concurrent sharers even in sync code).
- Leak-order gate: SKIP the `index` compare when no leak is in scope (hoisted `@`/`$` reads pay nothing; only leaked-into-caller reads gate). Required invariant — a naive always-compare taxes every read. (Snapshot mode is deleted, so this is the sole position gate.)

## Memo lever = memoize the STACK, not the value (owner)

Cache "name-from-scope-S → its resolved decl-node stack" (the parent-walk result) so a second reference to the same name from the same scope skips the parent-chain search and goes straight to the stack; the backward-walk-with-exclusion still runs per reference over that small stack. EXCLUSION-SAFE (the stack is exclusion-independent) — unlike a resolved-VALUE cache, which depends on the active exclusion context. Size it (MEASURE) but it's the safe memo.

## OPEN (owner sign-off before build)

- Sigil→read-mode map (R3 flags 1/2/7) SETTLED: `@` and `$` both = hoisted-lazy last-wins (snapshot DELETED — `$` is not a point-in-time read); `$!` = current-at-eval-point; `$!name :=` / `$!name` on unbound → `ReferenceError`.
- `with{}` config-var ordering vs module `!default` decls (which wins when both present) — flag for the import spec.
- `$while` unbounded loop termination (no exclusion guarantee) — diagnostic or eval bound (R3 flag 6).
- `:=` overlay hoist ordering: does a read textually BEFORE a `:=` observe the reassigned value (full hoist, matching `@`/`$` last-wins) or not? Owner pinned reassign-nearest-incl-current + no-shadow + unbound→error; the overlay's hoist ordering is not pinned. (The two pinned cases both read after the `:=`.)

## Naming — drop "native" from the value/eval seam (owner)

The word "native" in the fn/eval seam is meaningless and is being removed: `nativeOperate`→`operate` (already done), and `dispatchNative`/`hasNativeFn`/`buildNativeEvaluator`/`NativeFn`/`NativeCtx`/`NATIVE_FN_LIST` → plain `dispatch`/`has`/`buildEvaluator`/`Fn`/`FnCtx`/`FN_LIST`. This spec uses only the de-"native"ed names (it references the value seam only via `operate` and "the value/eval service"). The rename itself is a codebase edit tracked as a separate implementation task, not part of this read-only spec.

## Reviewer attack surface (self-critique, R2)

- Async exclusion-set sync-span release — the correctness driver is "independent overlapping async reads of the same decl must each resolve"; get the release timing from that requirement and verify it with an async-read fixture, not by copying prior behavior.
- With params/loops/config on the STACK, the ONLY cross-system question left is `$!` establishment: confirm every `$!` cell has a create-site before any `:=`/read (else `ReferenceError` — desired, but a reviewer will want a fixture for "`$!` read of a name that only exists on the stack").
- `closureFrame` vs `importFallback` must stay two fields with two visibility rules — grep that no code path treats them as one (the R1 conflation).
- Shared-`DeclIndex`-never-mutated — grep for any write to a shared body index; loop/param/leak/`:=` writes must land on a frame-local structure (`reassign` overlay, param frame, transparent stack, or cell).
- `:=` reassignment overlay — a reviewer will attack (a) that the overlay is read BEFORE the shared entries at the owning frame (last-wins) yet still honors exclusion during its own RHS eval; (b) that `:=` walks INCLUSIVE of the current scope (the R1 "strictly-enclosing" reading is now wrong); (c) that `!global` and `:=` are the SAME op (no create-at-root path survives); (d) the overlay lives on the owning frame's per-activation object, so it is correctly scoped to that activation and gone when the scope exits. Needs fixtures for current-scope reassign, outer reassign-no-shadow, and unbound→error.
- `uncovered`→crawl must stay retired for member/`@@`/namespace reads; config-import-as-stack-decls is the enabling move — verify it byte-identical on the import-style reference.
- Loop `kind:'transparent'` retention vs the `declIndex===null` cut — the 1-entry loop stack breaks that derivation; pin whether `kind` survives.
- Member-access `propIndex` must be built and consulted ONLY on the accessor forms (`$.foo`/`$namespace.foo`), NEVER on a bare `$foo`/`@foo` read — a fixture must prove the plain read of a name that is both a var and a property still returns the var with no error, while the accessor of the same scope raises. The dispatch site (accessor vs plain read) is the load-bearing distinction; a reviewer will check that the two paths are genuinely separate entry points.
