# Jess AST v2 — Canonical Structure Blueprint

> **Historical proposal — superseded as an execution plan.** This document
> records an earlier host/bridge-era design. Do not implement its `parse-host`,
> parser build-host, injected construction seam, or “pre-cutover” staging
> claims. The approved public architecture is dialect-owned Parseman grammar
> reductions calling canonical AST constructors directly through each dialect's
> `parse()` operation, producing `Stylesheet`; Context retains plugin dispatch.

Status: PROPOSED (author agent a5f7844) → under adversarial vet → owner ratification of the open decisions → then executed as the Tier-6 atomic reorg (after content demolition). Full author output archived in the session task log.

The engine is a **projection serializer over a pure-data AST**: the parser build-host constructs immutable nodes; free functions walk them once and emit CSS bytes, forcing value evaluation lazily through an injected seam. Nothing in shipping `src/` imports it yet (pre-cutover, gated only by the byte-identity harness) — so the reorg can move freely.

## Target `ast/` tree

```
ast/
  node.ts            Base Node, Kind enum, Combinator + renderCombinator
  index.ts           the ONE public barrel
  value/             VALUE DOMAIN (runtime values), layered L0→L5, acyclic:
    data.ts units.ts color-names.ts round.ts            [L0 pure leaves]
    color.ts serialize.ts                               [L1]
    factory.ts                                          [L2] make*/accessors
    operate.ts  compare.ts  materialize.ts              [L3] operate ↔ compare SIBLINGS (share units.ts)
    seam.ts dispatch.ts fns/                            [L4] evaluator interface + native fn registry
    evaluator.ts                                        [L5] buildEvaluator()
  expr/              VALUE-AST (compute description) — resolves the Dimension/Color domain-vs-AST name collision by PATH
    node.ts eval.ts build.ts
  selector/          node.ts  canonical.ts (free fns, moved off nodes)  compose.ts  build.ts
  rule/              node.ts  merge.ts (+/+_ fold)  build.ts
  at-rule/           node.ts  build.ts
  mixin/             node.ts  dispatch.ts (selection)  guard.ts  build.ts
  extend/            node.ts  engine.ts   (← split ir/plan/solve/nested is an open decision)
  engine/            scope.ts (Frame/EvalCtx/Emit types + lookups)  emit.ts (the shared recursive walker)
  parse-host/        host.ts (ParseHost/runParseHost)  context.ts  registry.ts  import.ts
  __tests__/         byte-identity/census/differential suites
  __oracle__/        QUARANTINED test-only: bridge.ts, value-adapter, oracle* — deleted when native fn coverage lands
```
Deleted outright: `poc-tree2-host.ts`, `tree2-harness`, all `[R2]/[R4]/[guards]` tags, all "mirrors the bridge"/"ported byte-for-byte" markers.

## Key structural decisions
- **operate/compare symmetry:** `nativeOperate`→`operate`, `nativeGuardCmp`→`compare`, `nativeGuardCall`→`typeCheck`; both siblings at L3 sharing `units.ts`. "guard" belongs ONLY to the mixin condition tree (`mixin/guard.ts`), which *calls* compare/typeCheck through the seam.
- **Nodes are pure data:** move `Compound/Complex.canonical()`/`hasInterp`/`hasAmpersand` off the classes into `selector/canonical.ts` free fns; memo fields go (recompute or external WeakMap, MEASURED).
- **Names:** reuse tree domain names (`Dimension`/`Color`/`Quoted`/…), disambiguate value-domain vs value-AST by path (`value/` vs `expr/`), not by `*Val` renames. `Color.format`→`ColorFormat` enum; `Color.node`→`sourceText`.
- **The honest concession — `engine/emit.ts`:** the flat/nested statement-emit walker + at-rule emit + mixin/detached splice are ONE mutually-recursive algorithm and cannot per-family-co-locate without a harmful indirection registry. So `at-rule/`/`mixin/` own node+build (+ mixin's pure selection/guard), but their *emit* lives in the engine spine.

## Migration (byte-identical, per-family commits, Tier-6 atomic, after content demolition)
Mechanical class/ctor moves out of `nodes.ts`; extract shared context types (`Frame`/`EvalCtx`/`Emit`) FIRST into `engine/scope.ts`; then the non-recursive family free-fns (`expr/eval`, `selector/compose`, `rule/merge`); the recursive clique stays in `engine/emit.ts`. Two flagged behavior-preserving refactors get their own gated commit: (a) canonical-off-nodes, (b) compose/canonical unify.

## Per-file review bar (applied by the deep review, by file type)
- node.ts: pure data, no methods/memo, every field earns emit-or-eval.
- free-fn logic: zero byte re-derivation (P0), stated cost as N grows (P5), one impl per concept (P4), symmetric where the domain is.
- build.ts: consume structured children + trivia (never re-tokenize src), shared leaf helpers, total actions.
- fns/: one-liner over a shared kernel, self-describing, tree-shakeable, no private unit table.

## RATIFIED DECISIONS (owner, 2026-07-16)
1. **Co-location scope → HYBRID** (owner revised after the vet; owner "generally likes things co-located"). A family OWNS its logic, but in SEPARATE FILES within its own directory so tree-shaking still holds (importing `selector/node.ts` never pulls `selector/compose.ts`) — co-location AND tree-shakeability, which were never actually in tension.
   - **Families co-locate everything that CAN decouple:** `selector/{node,build,compose,canonical}.ts`, `expr/{node,build,eval}.ts`, `rule/{node,build,merge}.ts`, `mixin/{node,build,dispatch,guard}.ts` (its non-recursive selection + guard eval), `extend/{node,build,engine}.ts` (the self-contained fixpoint), `at-rule/{node,build}.ts`.
   - **`engine/` owns ONLY the irreducible cross-family core:** `engine/scope.ts` (Frame/lookups) + `engine/emit.ts` (the ONE mutually-recursive statement-emit spine — flat/nested walk + the at-rule/mixin body-SPLICE that recurses into it and genuinely cannot decompose per-family). This is the `emit.ts` the vet flagged for measure-and-unify.
   - **The one asymmetry (accepted):** `at-rule/` owns node+build only because at-rule EMIT is inherently a recursive arm of the spine → it lives in `engine/emit.ts`. `mixin/` co-locates its selection/guard but its body-splice is also in `engine/emit.ts`. Mitigate with the MANDATORY `{@link ../engine/emit}` breadcrumb in `at-rule/node.ts` + `mixin/node.ts` so "where does `@media`/mixin-splice emit?" is one click.
   - **`value/` STAYS its own coherent value-algebra domain** (data + operate/compare/serialize/factory/materialize/tag/seam/dispatch/evaluator/fns), consumed by the families + engine.

## RESOLVED (post adversarial-vet, 2026-07-16)
2. **`value/` + `expr/` paths → APPROVED.** Vet confirms: resolves the `Dimension`(node) vs `Dimension`(value) collision by path, 15-file L0→L5 layering is a strength not over-split.
3. **`extend`: DO NOT 4-way split → KEEP COHESIVE (REVERSED from my rec).** Vet: `plan/solve/nested` are one interdependent fixpoint over shared IR; a 4-way split scatters one algorithm and forces an `ir.ts` substrate anyway. At most split the pure selector-IR+serialize (extend.ts:42-230) into `engine/extend-ir.ts`, keep `plan+solve+nested` as `engine/extend.ts`. Cohesion beats file-size vanity here.
4. **`composeStats` → a stats HOOK on the real walk, NOT a shadow walker relocated to tests.** Vet: it re-derives the whole eval+emit walk (even re-implements mixin dispatch); moving it hides the maintenance hazard. Fix the design, don't relocate it.
5. **`__oracle__/` deletion → tracked gate** tied to native-fn coverage (task #10). Approved.
6. **`N`/`Kind` duality → KEEP, but QUARANTINE the legacy-`N` map + `isNode` into a separate `compat-tag.ts`** (deletable post-migration). Keep `node.ts` pristine (currently 67 lines) — don't bake legacy bitmask values into the clean-room base.
7. **Provenance → GATED, not always-on.** Mirror the existing `serialize()` `trackPositions` gate (off by default); a per-node `setSourceSpan` WeakMap write taxes the exact hot path the perf project defends (history: fieldSpans/valueSpans were already flag-gated for this reason).
8. **`value/factory.ts` frozen seam → APPROVED.**

## REQUIRED AMENDMENTS before/during execution (from the vet — each is a museum-bar gap)
- **Emit spine is ~1100 lines, not ~600** (after the extractions). The flat vs nested walkers (`walkBody`/`emitNestedBody`, `flatten`/`emitNestedRule`, `emitLeaf`/`emitNestedLeaf`, `expandCall`/`expandNestedCall`, `expandDetachedCall`/`expandNestedDetachedCall`, at-rule emit pair) are ~400 lines of DUPLICATED paired functions differing on two axes only (selector compose-to-string vs own-strings; indent/depth). Do NOT frame unification as impossible — the `e.collapse` boolean is already checked once; thread it (or a small policy value) through ONE monomorphic walker (no virtual dispatch, no indirection registry). MEASURE unify-vs-keep and RECORD the decision; a 1100-line file with 400 lines of copy-paste does not meet the bar.
- **De-god `parse-host/context.ts`** (270 lines) → split `contract.ts` / `trivia.ts` / `source.ts` / `markers.ts`. Critically: EVICT the cross-family `:extend` protocol state (`ExtendMarker`/`ExtendTargetMarker`/the `SELECTOR_EXTENDS` module WeakMap) — it's the exact cross-family coupling the split exists to remove, hidden in a shared file.
- **List `parse-host/actions/` (16 build-family modules) in the target tree** and MAP them: each family's `build.ts` = its former `actions/<family>.ts`; the `engine/` eval module for a family MIRRORS the parse action name. The parse side already IS the per-family decomposition — name emit to match it.
- **Name the dual selector-compose as knowingly-retained:** `extend`'s branch-IR compose (`composeOne`/`composeLevel`/`substituteAmp`, structured, needs `:is()` rewrite) vs `engine/emit`'s string-form compose (fast). Two impls of "compose child under parent" — justified by different needs, but DECLARE it, don't claim a unification that isn't delivered.
- **`literal-tag.ts` gets a home:** it's a cross-cutting parse-classification seam (`LiteralTag`/`materializeLiteral`/`tagForWord`) → `value/` L0/L1 (e.g. `value/tag.ts`).
- **Resolve the DUPLICATE `value-eval.ts` name:** top-level (runtime value seam) → `value/seam.ts`; `parse-host/value-eval.ts` (parse-time value path, 307 lines) → a distinct parse-host name. Same collision the blueprint congratulates itself for solving — one dir over.
- **`expr/` breadcrumb + naming:** it holds literals/`Interp`/`DetachedRuleset`/`MapAccessor`, not just expressions; and each family `node.ts` (esp. `at-rule/`, `mixin/`, which own no emit under UNIFORM) MUST carry the `{@link ../engine/...}` breadcrumb so "where does `@media` emit?" is one click.

## Co-location note (vet dissent, owner call stands)
The vet argued for HYBRID over the owner's UNIFORM pick (asymmetry is "principled" — mixin already owns non-recursive selection/guard, only the recursive splice is central). Its ONE real concern with either option — discoverability (`at-rule/`/`mixin/` dirs having no emit) — is precisely what the owner's `{@link}` requirement solves. UNIFORM stands (owner decision); the breadcrumb links are now mandatory, not optional.

## §6 Stable public-seam layer (amendment, from the downstream-consumer audit)
The internal decomposition sits behind a stable seam so only `fns` + less-compat-inward + parser-construction move in lockstep; everyone else migrates lazily.
- **`node.ts` carries BOTH tags:** internal dense `Kind` (serializer switch) AND the PUBLIC `N` bitmask + `isNode(x, mask)` + `node.type`/`nodeTag` — reuse the legacy `N` values verbatim so less-compat's WeakMap-keying and language-service's `isNode(x, N.*)` compile unchanged. `type` is DERIVED from immutable `kind` (no second stored field → stays pure data).
- **`provenance.ts` (new top-level peer):** `sourceSpanOf`/`setSourceSpan` WeakMap seam — currently ABSENT from ast/ (positions were dropped), so it's a gap to RESTORE, written by the parse-host during build. Measure the per-node WeakMap-write cost; possibly gate on an attached diagnostics/sourcemap consumer.
- **`value/factory.ts` is a FROZEN construction/accessor seam:** `fns`, less-compat-inward (`fromLessNode` + `.number`/`.unit`/`.rgb` reads), and parser value-construction retarget ONLY onto `make*` + `numOf`/`textOf`/`colorHsl`/… — a direct raw-field read outside `value/` is a review failure. This is the decoupling lever.
- **Methods stay OFF nodes:** consumers needing `.eval`/`.valueOf`/`.serialize` (less-compat outward wrapper, plugin bridge, CLI visitor) get a thin method-shell delegating to the free fns (`evalValue`/`emitValue`/`serialize`) at THEIR boundary — never methods back on the node.
- **Plugin + render/context/diagnostics entry** (`AbstractPlugin`/`Plugin`/`PluginVisitor`/`TreeContext`, `serialize(root,opts)`) is public API above the decomposition; families serve it, don't replace it.

## OPEN DECISIONS (amendment additions)
6. **`N`/`Kind` duality** — nodes carry dense `Kind` internally + expose legacy `N`/`isNode`/`.type` public seam (reuse legacy N values) vs collapse to one tag. (Author + audit recommend duality.)
7. **Provenance timing** — restore `sourceSpanOf` always-on vs gated on an attached diagnostics/sourcemap consumer (measure).
8. **`value/factory.ts` frozen seam** — ratify make*/accessor as the ONLY surface `fns`+less-compat-inward+parser retarget onto; direct raw-field reads outside `value/` = review failure.

## Design constraint (from the downstream-consumer audit)
Preserve the stable public seams so most consumers migrate lazily, not in lockstep: `isNode`+`N` type tags (nodes keep a stable structural tag), `sourceSpanOf`/provenance, the plugin contract (`AbstractPlugin`/`TreeContext`), the render/diagnostics API. Only `fns`, `less-compat`-inward, and parser node-construction move with the node shape.
