# Mixin scoping (caller-read leak) + member-lookup memoization — research & design

Status: **DRAFT for review** (research complete; design proposed; not implemented).
Scope: two intertwined changes to the live `ast/` evaluator (`packages/core/src/ast/serialize.ts`):
- **A (semantics):** close the caller→body *variable read* leak for v5 (a mixin body should not read a free variable from its call site).
- **B (perf):** memoize member-lookup `DeclMap` construction so `BASE[member]` accessed N times does not rebuild/re-dispatch N times.

They are related: B's *mixin-call* case only becomes cleanly safe once A removes the caller-frame dependency, but B's *pure* cases (detached ruleset / collection / `@use` module) are safe regardless of A.

---

## 1. Motivation

Measured on the live engine (instrumented counters, 236f11674):

- `@p: .mk-map(); .a { a: @p[one]; … f: @p[two]; }` — 6 member reads → **12** `declMapFromMixinCall` dispatches (2× per access). Each dispatch re-runs `expandCall(.mk-map)` — **true re-evaluation** of the mixin body per access.
- `@m: { … }; .a { a: @m[one]; … }` — 5 reads → **10** `evalToDeclMap` rebuilds (2× per access) — re-indexing the body per access.

So repeated member lookups are O(accesses) × O(body), not O(1) amortized. This is the same repeated-re-derivation cost that ledger X12 (the extend rework) eliminated — recomputing what one pass already produced.

Separately, the scoping question surfaced while designing the memo: a member lookup's result today can depend on the *call site's* variables (the leak), which both muddies the language rule and complicates any memo key.

---

## 2. Research findings (evidence)

### 2.1 Current scoping model — lexical closure FIRST, caller-scope FALLBACK

Empirically (live engine):

| Case | Result | Meaning |
|---|---|---|
| `@x:DEF` (def) + `@x:CALLER` (call site), body reads `@x` | `DEF` | definition closure **wins** |
| no def `@x`; call site `@x:5`; body reads `@x` | `5` | falls back to **caller** when closure misses |
| nested `.outer→.inner`, `@x` only at outermost call site | `A_SCOPE` | fallback is **transitive** |
| param `@x:PARAM` + caller `@x:CALLER` | `PARAM` | params shadow both |
| caller `@x` defined *after* the read | `LATE` | scoped reads are lazy/last-wins (R2) |

Mechanism — `expandCall` builds the body frame (`serialize.ts:12403-12413`):
```
parent   = homes.get(def) ?? frame     // the DEFINITION frame (closure)
fallback = frame                        // the CALLER chain (the leak)   [only when not namespaced and homeFrame!==frame]
```
Variable lookup walks `parent` (closure) to root, THEN `fallback` (caller): `lookupScopedBinding` (`serialize.ts:2251-2294`), `lookupLiveCell` (`2180-2198`), dispatched by `resolveVarRef` (`2351-2354`). So a free `@x`/`$x` in a body resolves in the closure first and, on a miss, in the caller.

### 2.2 The leak is unballoted, and unconditional in the live engine

- **No ledger row governs the caller→body READ.** R2 (order-independent/last-wins), R9 (mixin var-unlock = the *reverse* body→caller leak, low-priority), R13 (`::=`, control blocks are scopes), R15 (`@content` args resolve in caller frame — OPEN) exist, but none states that a mixin body may read a caller-local variable. Closing it is therefore a **new OPEN decision**, not a change to a SETTLED row.
- The `leakyScope`/`fallbackFrame` config knobs live only in the **dead `tree/` engine** (ledger E3); the live `ast/` path has **no flag** — the leak is the unconditional `fallback: frame` at `serialize.ts:12412`.

### 2.3 `fallback` is dual-purpose (critical constraint)

`fallback: frame` is not only the variable leak. Its comment (`serialize.ts:12397-12399`) and the recursion machinery show it also:
- keeps the **dynamic expansion stack** reachable for the ruleset-mixin **parent-exclusion** recursion terminator (R8, `parentExcludes`), and
- lets the body see **caller-published mixins/rulesets** (`publishOrderedMixins`/`publishExplicitRulesets`).

⇒ Closing the *variable* leak must **separate variable resolution from `fallback`** — keep `fallback` for mixin/expansion-stack traversal, stop consulting it for variable reads — not delete `fallback`.

### 2.4 Two binding stores + a third leak store

- **Live (`$name`)**: `frame.cells` (newest-first), `lookupLiveCell`; order-dependent, never falls back to scoped.
- **Scoped (`@name`/`$^name`)**: `declIndex` + per-activation `reassign` overlay, `lookupScopedBinding`; lazy/last-wins.
- **Leaked (R9)**: `frame.leaked`, consulted ONLY as the last fallback of a *scoped* read. This is the body→caller unlock, orthogonal to the caller→body read we are closing.

Both live and scoped reads traverse `parent` then `fallback`, so both currently leak from the caller.

### 2.5 DeclMap build cost + side-effect surface

No memoization on any builder (all in `serialize.ts`): `evalToDeclMap` (4571), `collectionToDeclMap` (4609), `declMapFromMixinCall` (4725), `resolveBaseDeclMap` (4643). Sole external entry: `resolveReferenceResult` (`5024`), run per member access during real render.

- `evalToDeclMap` / `collectionToDeclMap` / the `Any`/`Keyword`/`resolveForRuleset` arms are **pure map construction** over statements — no dispatch, no frame mutation. Member *values* are stored unevaluated (`{name, value, frame}`) and evaluated lazily by the caller. **Safe to memoize.**
- `declMapFromMixinCall` runs `expandCall` in a `scratchEmit` (output discarded) BUT passes the **real caller frame**, and `expandCall` mutates it **non-idempotently**: `leakBodyVars` (`12888-12894`) pushes leaked vars each call; `publishOrderedMixins`/`publishExplicitRulesets` append published mixins/rulesets. **Memoizing the dispatch is observationally unsafe** (changes accumulation counts) unless those mutations are excluded or proven idempotent, and its key would have to include the caller frame.

### 2.6 Blast radius of closing the caller-read leak

Narrow. In `less.js/packages/test-data` (315 `.less`), only **2** fixtures depend on a body reading a caller-local var: `scope/scope.less:63-79` (`sub-scope-only:'inside'`) and `detached-rulesets/detached-rulesets.less:6-25` (`four: magic-frame`). Everything else uses params, definition-scope closure, or globals. In jess: ~3 legacy `tree/__tests__/mixin.test.ts` scenarios. These are Less-4.x-expected outputs; v5 divergence here is consistent with the `.css`-fixtures-are-v5 policy.

---

## 3. Design A — close the caller→body variable read (v5 semantics)

**Proposal.** A mixin/ruleset body resolves a free variable ONLY in its lexical closure (definition chain) plus its params. If unresolved there, it is undefined (error/verbatim per existing unresolved-var policy) — it does **not** read the call site's variables.

**Scope — ALL body sites, off by default, config-gated (R16, owner-ruled 2026-09-08).** `fallback: callerFrame` is set at **five** construct sites: `expandCall` mixin body (`serialize.ts:12412`), ruleset-mixin apply (`12636`), value-lambda / `result:` activation (`4888`), detached ruleset (`13096`), and partial-application frames (`13777`, `13801`). R16 governs **all of them**: a body resolves a free variable in its definition scope + params only, never the ambient caller — the same **hermetic-context** rule `@compose` already took for imports (no ambient parent-context reads; dependencies are explicit). The owner ruled this is *more* consistent for detached rulesets than mixins (an ambient read makes even less sense there), not a feature to preserve. It is **OFF BY DEFAULT** with a **config flag** to re-enable the legacy ambient read for Less-compat. R15 (`@content` arg binding in the caller frame) is a different path and is untouched.

**Mechanism (separating variable resolution from `fallback`).** At the mixin-call body site, variable lookups (`lookupScopedBinding`, `lookupLiveCell`) must **not** traverse `fallback`; keep `fallback` for the R8/publishing roles (§2.3). Concretely: tag the caller `fallback` at the mixin site so variable lookups skip it while `parentExcludes` (R8, `serialize.ts:2166`) and caller-published-mixin traversal keep it — or give the mixin body frame a "closure-only" variable-read mode. **`parentExcludes` MUST keep traversing the caller fallback** (it reaches the dynamic expansion stack) — this is the single largest implementation hazard the review flags. The R9 **body→caller** unlock (`leaked`) is unchanged — this closes only the READ direction.

**Interactions preserved (review-confirmed consistent):** R2 (parent-chain order/last-wins — untouched), R8 (parent-exclusion — shares the `fallback` field, must keep traversing it), R13 (control blocks are `parent` scopes — orthogonal), R15 (`@content` args are bound as param cells, a different path from the `fallback` read — untouched).

**Landed (config-gated, default-hermetic).** Config: `leakyScope` renamed `allowLeakyScope` (deprecated `leakyScope` alias retained, resolved in `resolveOptions`); new `allowCallerScope` (`@default false`); both join the `strict` bundle. Both surface on `ResolvedOptions`/`ContextOptions` (`context.ts`) and the `LessOptions`/`InputOptions` config types; the Less plugin default is `allowCallerScope: false` (v5 hermetic). Mechanism as designed: the five body sites tag their caller frame `callerFallback: true` alongside `fallback`; `allowCallerScope` resolves once onto the eval ctx (`e.allowCallerScope`, `serialize.ts` root + `scratchEmit`); the six variable-read functions (`lookup{Scoped,Live,Leaked}Binding` + their `hasExcluded*` twins) gate the `fallback` capture with `(e === undefined || e.allowCallerScope || f.callerFallback !== true)`, so an `e`-less path/chain walk, `parentExcludes`, mixin-candidate/`findPathInScope` lookups, and `leaked` publishing all keep traversing `fallback` unchanged.

**The close is universal — EVERY read form, not just the plain value read.** The member-access base, chain-follow, and `$property` accessor formerly reached the caller through `e`-less `lookupVar`/`lookupVarIn` probes and `resolvePropRef`'s own `fallback` walk. Fixed by threading `e` (engaging the same gate) into ONLY the body-free-reference resolution sites — `resolveBaseDeclMap` (`@p: .mk(); @p[k]`), `resolveValueBlock` / `resolveForRuleset` (`@p[k]` on a caller-only value block), and `resolveBindingNode` via `evalIntrospection` (`isdefined`/`isruleset`) — and gating `resolvePropRef`/`hasExcludedPropRef` directly (`$prop`). The e-less shape/candidate/arg probes (`dropEmptyVariadicArgs`, `substituteClosureVarArgs`) keep reading the caller, because a mixin ARGUMENT resolves in the caller frame (R15). (`resolveToMixinCall` also holds an e-less probe but is dead code — no callers repo-wide — so its read is unreachable; left untouched.) A committed rule-pin, `packages/core/src/ast/__tests__/caller-scope-hermetic.test.ts`, asserts the invariant directly for the plain `@var`, `@p[k]`, and `$prop` forms so a future re-widening of `fallback` fails a test.

**Migration differential** (tests that relied on the caller-read, left for the owner to re-baseline or set `allowCallerScope: true`): `packages/jess` Less fixtures `tests-unit/scope/scope.less` and `tests-unit/detached-rulesets/detached-rulesets.less` (the two the corpus survey predicted), plus the core unit tests `detached-ruleset-direct-acceptance.test.ts > "splices a direct detached ruleset through its definition scope and caller fallback"` and `value-access-direct-acceptance.test.ts > "resolves a mixin property read after the caller timeline has spliced later declarations"` (the `$prop` caller-read). Not the lookup-memo cut-2 (`@p: .mk()` single-eval), which remains a follow-up — now unblocked, since a `@p[member]` can no longer read the call site.

**Ledger — SETTLED as R16 (owner ruled 2026-09-08), LANDED.** A v5 **body** (mixin-call body, detached ruleset, or value-lambda) is a lexical closure — a free variable resolves in its definition scope + params only, never the ambient call site — at ALL body sites and for ALL read forms (`@var`/`$var`, member-access `@p[k]`, and the `$property` accessor). Config-gated by **`allowCallerScope`** (`@default false` = hermetic; `true` = legacy Less caller-read), in the `strict` bundle; the deprecated `leakyScope` (leak-OUT direction, R9) is renamed `allowLeakyScope` and is orthogonal/unchanged. The R9 body→caller unlock is unchanged. See `DESIGN-DECISIONS.md` R16.

**Blast radius — MUST be a corpus differential, not inspection (review).** The "2 fixtures" figure (`scope/scope.less:63-79` — a mixin; `detached-rulesets/detached-rulesets.less:6-25` — a detached ruleset, hence OUT of R16's mixin-only scope) is `UNVERIFIED` until a real differential is run: v5 with the mixin caller-read closed, against all 315 `tests-unit`/`tests-config` `.less` **plus `tests-error/eval`** (caller-read cases that currently pass may start erroring) **plus the jess corpus**, with a **negative control**. Report the actual diff set before the owner rules on R16.

**Fixtures & tests.** Record the intended v5 expectation for the affected fixtures on the less.js fork `alpha` BEFORE editing them (per S2 — do not read a green differential as validation). Add a test asserting the **rule** ("a mixin free var is NOT read from the call site → error/verbatim"), not just the new bytes, so a future re-widening of `fallback` fails (S7).

**Doc-comment fix (independent of A).** `Frame.fallback`'s comment (`serialize.ts:610-614`) says detached rulesets are "caller-first, definition-fallback" — the code is **definition-first / caller-fallback**, same as mixins (`13091`/`13096`). Correct the comment regardless.

---

## 4. Design B — memoize member-lookup DeclMaps (perf)

**Mechanism.** A plain `Map` on the resolving **frame** (render-scoped, disposed with the frame — **no WeakMap**; a node-keyed WeakMap would pin DeclMaps for the AST's whole cross-render lifetime, a leak, so the frame-owned Map is both leaner and the correct lifetime), keyed by the base value node identity: `frame.declMapMemo?: Map<node, DeclMap>`. The field is declared on `Frame` but assigned lazily (`??=`) **only on a frame that actually performs a lookup**, so non-lookup frames keep their current shape and allocate nothing.

**Per-arm gating (required — perf review).** The memo is applied **only inside the three pure arms** of `resolveBaseDeclMap` — `Collection` (`4655`), `Any`/`Keyword` (`4673`), `resolveForRuleset` (`4696`) — NOT at the top of the function and NEVER on the `Reference` (`4651`), `MixinCall` (`4665`), or `Lookup`→mixin-call (`4711`) arms: those consult `e.excluded` (alias-cycle state, `4961`) and/or run `expandCall` (`4753`), so a node-keyed cache would replay a state-dependent result. The pure arms' only frame write is the timeline recording (`recordMapPropertyTimeline`/`recordCollectionPropertyTimeline`), which is write-once-guarded and would no-op on 2nd..Nth calls anyway — so skipping it on a memo hit is safe.

**Computed-key edge (required — perf review).** An interpolated map key (`@{name}:`) evaluates via `evalBytesSync(name, frame, e)`, which could read `e.excluded`. Skip the memo-store when a build performed computed-key eval with non-empty `e.excluded` (static-string keys — the common case — are unaffected), or document it as a `ponytail:` ceiling.

**Negative control (required — perf review).** Land behind a memo-disabled control run that reproduces the §1 counts (12 dispatches / 10 rebuilds); with the memo on, one build + N O(1) hits. A bare "counts dropped" is not a pass.

**Why frame-keyed is correct.** After Design A, a body's members depend only on (node, definition scope, args), all fixed for a given binding; the resolving frame identity distinguishes distinct bindings/scopes. Even *before* A, keying on the resolving frame captures the caller scope (different call sites are different frames), and reassignment within a scope is already stable across accesses (measured `1,1`).

**Safe scope now:** the pure builders — detached ruleset (`resolveForRuleset` arm), collection (`collectionToDeclMap`), and the `@use` module / `Any`/`Keyword` arms. **This covers the D18 module-access path**, which is the immediate consumer.

**Deferred:** memoizing `declMapFromMixinCall` (the `@p: .mk()` dispatch) — the side-effect hazard (§2.5). Options for a follow-up: (i) run the dispatch once and cache both the DeclMap and a replay of its `leaked`/publish mutations, or (ii) make those mutations idempotent, or (iii) after Design A, evaluate a bound mixin-call value ONCE at binding (matching "a `@var` is one value") rather than lazily per access. Not in the first cut.

**Value-eval memo (optional, later):** repeated reads of the *same* member re-evaluate that member's value. The dominant win is the index/dispatch; per-member value memo is a smaller, separable follow-up.

---

## 5. Cases matrix (target behavior)

| Case | Today | After A+B |
|---|---|---|
| closed body member read | rebuild/re-index per access | one build, memoized |
| def-scope free var | closure (correct) | unchanged; memoized |
| caller-local free var read | reads caller (leak) | **undefined/error (A)**; memoized |
| param free var | param wins | unchanged |
| reassignment mid-scope | stable (`1,1`) | unchanged; memoized |
| `@p: .mk()` dispatch ×N | N dispatches | pure cases memoized; mixin-call dispatch **deferred** |
| R9 body→caller unlock | low-priority leak | unchanged |
| `@content` args (R15) | caller-frame arg binding | unchanged |

---

## 6. Risks

1. Closing the caller read is a Less-compat divergence (narrow: 2 fixtures) and needs an owner-settled ledger row (R16).
2. `fallback` is load-bearing beyond variables — the fix must not sever recursion termination or caller-published-mixin visibility.
3. `declMapFromMixinCall` memo is side-effect-unsafe as-is — deferred, not in the first cut.
4. Detached-ruleset vs mixin precedence differ; confirm intended v5 behavior before generalizing A.
5. R15 shares the caller-frame path; verify A leaves `@content` arg binding intact.

---

## 7. Plan

1. **Review this doc** — semantics-reviewer (Design A + R16) and perf-architecture-reviewer (Design B: shapes, alloc, no-WeakMap, memo correctness).
2. R16 is SETTLED (owner 2026-09-08) and the close is LANDED across all body sites + read forms behind `allowCallerScope` (default hermetic). The corpus differential is the migration set: exactly four caller-read-reliant items (`scope.less`, `detached-rulesets.less`, and the core `detached-ruleset-direct-acceptance` / `value-access-direct-acceptance` tests) take `allowCallerScope: true`; the rule itself is pinned by `caller-scope-hermetic.test.ts`.
3. Implement B's pure-builder memo (frame-local `Map`) — safe today, unblocks D18.
4. Implement A (closure-only variable resolution) once R16 is settled; update the 2 fixtures + legacy tests.
5. Re-measure (12→~1 dispatch/index) + full core & jess suites; re-review the implementation (both reviewers).
6. D18 (SCSS module access) builds on B (module = param-less anonymous mixin bound to `$ns`, member reads through the memoized pure path).
