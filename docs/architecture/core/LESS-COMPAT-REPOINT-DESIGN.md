# less-compat Re-point — severing the bridge from legacy `tree/` (SPEC, no code this pass)

DESIGN/SCOUT spec. Base: `origin/dev`. Read-only investigation.

Scope: decide and specify how `@jesscss/plugin-less-compat` (the "bridge") stops
depending on the legacy `tree/` node model + the legacy `tree/` eval visitor hook, so the
fusion endgame can delete the legacy `tree/` engine (and, with it, the last reasons
`BuilderHost` survives) without a bridge rewrite sitting on the critical path.

This doc **fills the named OPEN item** that two specs point at without owning:
- `BUILDERHOST-RETIREMENT-DESIGN.md` §6.4 ("Bridge re-point ownership") + step **R4**
  ("re-point the less-compat bridge to `ast/` nodes").
- `GRAMMAR-AST-FUSION-DESIGN.md` (the fusion gate — **not yet written**; this doc is a
  precondition input to it). Until it exists, `BUILDERHOST-RETIREMENT-DESIGN.md` is the
  authoritative downstream owner and this doc slots in at its R4.

**Headline (owner-decision framing):** the bridge is a genuine fork, but the
investigation changes the stakes. Two premises this task inherited from
`BUILDERHOST-RETIREMENT-DESIGN.md` are **stale against `origin/dev` today** and the
recommendation follows from correcting them:

1. The bridge does **NOT** consume `parseLessFn(...).tree`, and imports neither
   `parseLessFn` nor `BuilderHost` (§1.2). It couples to the legacy `tree/` **node
   classes** and the legacy `tree/` **eval visitor hook** — not to the parser. So the
   bridge does **not** independently gate `BuilderHost` file-deletion.
2. For `.less` — the entire point of a *Less*-compat bridge — the production render path
   is **already** the `ast/` engine (`jess/src/index.ts` `isLessRoot` →
   `renderLessRootViaAst`, all four render entries), and that path has **no plugin /
   visitor / custom-function hook at all**. So the bridge's 4.x-plugin-compat contract
   for `.less` is **already dark** post-cutover, independent of any decision here (§1.3).

Given both, the recommendation is **Quarantine now / repoint later as a scoped
feature-completeness task** — see §3.

---

## 1. What the bridge actually is, and its real couplings

### 1.1 What it provides (the 4.x compat surface)

`@jesscss/plugin-less-compat` (39 files) is a **runtime** Less.js-4.x compatibility layer.
It provides three externally-observable surfaces, all consumed by external 4.x Less
plugins/consumers (`memory:less-v5-functions-tree-compat`):

| Surface | Mechanism | Source |
|---|---|---|
| **4.x custom-function registry** (`less.functions.functionRegistry.add/addMultiple`) | `opts.functions` + `@plugin`-registered fns are wrapped and bound onto a tree's root scope via `setFunctionBinding`; args are `eval()`'d then converted to `less.tree.*` shapes via `toLessNode` before the 4.x fn runs (`plugin.ts` `addRootFunctionToJessRegistry` / `registerRootFunctions`). | `plugin.ts`, `less-runtime.ts` |
| **4.x visitor / plugin API** (`addVisitor`/`addPreProcessor`/`addPostProcessor`, `install()`) | a `beforeEvalVisitor` that, per node, converts Jess→`less.tree.*` (`toLessNode`), runs the Less visitor chain, converts back (`fromLessNode`) (`plugin.ts` `get visitor`). Post-processors run on final CSS. | `plugin.ts`, `less-compat-structures.ts` |
| **4.x `tree.*` node constructors** (`less.tree.Dimension`, `.Color`, `.Quoted`, …) | `LessTreeConstructors` / `createLessMock`, surfaced onto the mock function-registry so plugin `install()` code that reaches for `tree.*` finds ctors. | `less-compat-structures.ts` |
| **deprecated `@plugin` directive** | early `atRule` visitor loads the JS module, registers its fns/visitors into the nearest `Rules` scope, marks the directive invisible. | `plugin.ts`, `plugin-directive.ts` |

The node ↔ node mapping is the `transform/` layer: `type-map.ts` (Jess PascalCase ↔
less.js type names), `to-less.ts` / `from-less.ts` (conversion), `less-adapter.ts`
(lazy field-projecting adapter class wrapping a Jess node), plus 27 per-type
transformers in `nodes/*.ts`.

The **byte-identity differential gate** that once fenced this package was **released as
non-sacred** by the owner for parser-cleanup work
(`memory:bridge-byte-identity-non-sacred-for-parser-cleanup`;
`GRAMMAR-RELOCATION-DESIGN.md` §0, 2026-07-18). So the bridge going red *in between* is
explicitly permitted; it is not a gate on the deletion work.

### 1.2 What it couples to — NOT the parser

Verified on `origin/dev` (`grep -rn 'parseLessFn\|BuilderHost\|less-parser' packages/jess-plugin-less-compat/src`): **zero hits.** The bridge source imports the parser
nowhere. Its couplings are:

- **Legacy `tree/` node *classes*** from `@jesscss/core` root (which re-exports
  `./tree/index.js`): `transform/from-less.ts` imports
  `{ Any, Collection, Color, ColorFormat, Declaration, Dimension, Node, Quoted, Rules }`;
  `to-less.ts` / `adapter.ts` / `less-adapter.ts` import `{ Node, Rules }`. The whole
  transform layer is built on the **class-instance** model:
  - `jessNode instanceof Node` guards (`to-less.ts:65`, `from-less.ts`, `plugin.ts:115`)
    — ast/ nodes are **plain data** (`{type:'Dimension', number, unit, src}`), never
    `instanceof Node`, so every guard silently fails against ast/;
  - `arg.eval(this)` on node instances (`plugin.ts` custom-fn arg evaluation via
    `hasEvalMethod`) — ast/ nodes have **no `.eval` method**; evaluation is via the
    injected `ValueEvaluator` / free functions;
  - the `LessAdapterBase` adapter wraps a class instance and lazily projects
    `.value`/field getters — a shape that assumes the legacy value-domain fields.
- **The legacy `tree/` eval *visitor hook*.** The bridge only executes through
  `beforeEvalVisitor` / `beforeEvalVisitorForTree` + `setContext`/`setCurrentFilePath`,
  which the pipeline calls exclusively from `applyBeforeEvalVisitors`
  (`jess/src/index.ts:1089`), on the legacy `tree.eval` path (`renderTree`). Root-fn
  binding uses `root.setFunctionBinding`, a `tree/` `Rules` method.

**Consequence:** the bridge is a tail dependency on the **survival of the legacy `tree/`
engine** (its node classes + its visitor hook), not on `BuilderHost` or `parseLessFn`.
The task's inherited framing ("(b) the less-compat bridge … consumes `parseLessFn(...).tree`",
mirrored in `BUILDERHOST-RETIREMENT-DESIGN.md` §1.1 / §4) is **inaccurate for the bridge
source** and should be corrected there: the bridge is not a `parseLessFn`/`BuilderHost`
consumer. (Its *tests* are — see §3.2.)

### 1.3 For `.less`, the bridge is already off the production path

`jess/src/index.ts` routes by root dialect (`isLessRoot`, `:1336`): **`.less` roots
render through `renderLessRootViaAst` → `@jesscss/plugin-less` `renderLessViaAst` →
`@jesscss/core/ast-render` `renderAstDoc`** at all four render entries (`:1525`, `:1619`,
`:1672`, `:1824`). Only `.scss`/`.jess` roots stay on legacy `renderTree`.

The `ast/` render path takes **no plugins/visitors/functions**: `AstRenderOptions`
(`render-doc.ts:51`) exposes only `grammar`, `trivia`, `filePath`, `evaluator`,
`guardSource`, `parseFileVars`, `resolveModule`, `searchDirs`, `collapseNesting`. Its
`evaluator` is built once from `makeBuiltinRegistry()` (`plugin-less/src/ast-render.ts:44`)
— **no seam to inject `opts.functions`** (4.x custom fns) and no visitor chain.

So post-cutover, for `.less`:
- 4.x **custom functions** registered via less-compat are **dark** (no injection seam).
- 4.x **visitors/plugins** are **dark** (no hook; `applyBeforeEvalVisitors` never runs).
- The bridge's transform layer never executes.

This is **not a regression this doc introduces** — it is the current state of `origin/dev`
after the `.less` engine cutover. It corrects `BUILDERHOST-RETIREMENT-DESIGN.md` §4's
premise ("legacy tree/ eval still serves production render; ast/ render is test-only",
citing `memory:eval-load-bearing-post-flip`): that memory is **stale for `.less`** — the
`.less` production path is `ast/`. It remains true for `.scss`/`.jess`.

> **`memory:eval-load-bearing-post-flip` is stale for `.less`** and should be narrowed to
> "legacy `tree/` eval serves `.scss`/`.jess` production render; `.less` renders via
> `ast/`." Flagged per `memory:tuned-decisions-update-docs` — owner to confirm before the
> memory is edited.

---

## 2. The two options

### Option A — Repoint the bridge onto `ast/`

Keep the 4.x compat contract alive on the new engine. This is **two independent pieces of
work**, not the "read `ast/` field names instead of legacy value-domain fields" one-liner
that `BUILDERHOST-RETIREMENT-DESIGN.md` §1.1/§4 implies:

- **A1 — an injection seam on the `ast/` render path (core + plugin-less).** Add to
  `AstRenderOptions` / `renderAstDoc` a hook for (i) a value-node visitor pass and (ii)
  custom-function registration into the evaluator's registry, then thread `opts.functions`
  / `opts.visitors` / `opts.plugins` from `jess/src/index.ts renderLessRootViaAst`
  through `plugin-less`'s `renderLessViaAst`. Without this, no bridge rewrite can run on
  `.less` — the surface simply has nowhere to attach. This is the larger, load-bearing
  half and it touches the `ast/` whole-doc pipeline's public contract (currently
  deliberately parser/fns-free — see `ast-render.ts` header).
- **A2 — rewrite the transform layer onto the plain-data model.** Replace
  `instanceof Node` guards with `type`-tag guards; replace `arg.eval(this)` with a call
  through the injected `ValueEvaluator`; re-express `less-adapter.ts` field projection
  over `{type, number, unit, src, …}` plain-data shapes; map ast/ value fields
  (`number`/`unit`/`src`, `Quoted` `{src, value, quote, escaped}`, `Color` `src`) to the
  less.js `tree.*` value domain (`.value`/`.unit`/`.rgb`/…). The 27 `nodes/*.ts`
  transformers and both `to-less.ts`/`from-less.ts` directions are rewritten. This is the
  "field re-point" the retirement doc describes — but it is downstream of A1 and larger
  than a field rename because the *object model* (class+methods → data+free-fns) changes.

Cost: substantial (both halves), and A1 re-opens a contract the cutover deliberately kept
narrow. Benefit: the 4.x plugin/visitor/custom-fn contract is honored on the production
`.less` engine.

### Option B — Quarantine / defer

Because the bridge is **already dark for `.less` production** (§1.3) and its byte-identity
gate is released (§1.1), nothing on the live `.less` path breaks if the bridge is not
repointed now. Concretely:

- **Do not block any deletion on the bridge.** The legacy `tree/` engine keeps serving
  `.scss`/`.jess`, so the `tree/` node classes the bridge imports remain exported and the
  package keeps compiling and its tests keep passing **as-is** against the `tree/` model.
  No stubbing of the *package* is even required for `BuilderHost` deletion, because the
  bridge does not import `BuilderHost`/`parseLessFn` (§1.2).
- **Formalize the existing `.less` gap** with a grep-able tracker (below) rather than
  pretending the contract is live.
- **Schedule the `ast/` repoint (Option A, A1+A2) as its own feature-completeness task**,
  sequenced when/if the owner decides the 4.x plugin/visitor/custom-fn surface should be
  revived on `ast/`.

What actually breaks under B: **nothing on the `.less` production path** (already dark),
and **nothing that gates `BuilderHost`/`tree/` deletion** (no dependency). The only live
consumers of the bridge remaining are its **own integration tests**, which drive the
legacy `less-parser` `Parser` (BuilderHost → `tree/` nodes) into the transform layer
directly (§3.2) — these keep passing while `tree/` survives, and are retired with the
legacy engine.

### Recommendation

**Option B (quarantine/defer), with the `ast/` repoint scheduled as a separate task.**
Rationale:

1. **It removes the bridge from the critical path entirely** — which is the actual goal.
   The bridge never gated `BuilderHost`; deferring makes that explicit and lets
   `BUILDERHOST-RETIREMENT-DESIGN.md` R4 stop waiting on a "bridge re-point green"
   sub-gate that was mis-scoped.
2. **Deferring regresses no *currently-working* contract.** The 4.x plugin/visitor/custom-fn
   surface for `.less` is already unwired on the production `ast/` path (§1.3). Option A's
   A1 seam is what would *restore* it; that is new feature work, not cleanup, and
   shouldn't hold the cutover hostage (`memory:no-permanent-eval-fallback` cuts the other
   way here — the *engine* cutover is done for `.less`; the compat surface is a separable
   feature).
3. **A "repoint now" would be built against a moving target.** The `ast/` value-node
   model and the (nonexistent) `ast/` visitor/fn seam are still settling; rewriting 27
   transformers + adapters onto them now risks a second rewrite. Repointing *after* the
   seam design lands is cheaper.

The **owner call** this doc surfaces is genuinely a fork and belongs to the owner because
it is a **product/contract** decision, not a mechanical one:

> **Does v5 keep the Less.js-4.x plugin / visitor / custom-function compat surface alive
> for `.less` at all — and if so, when is it repointed onto `ast/` (Option A), versus
> letting it lapse in favor of the v5 `@use` / `@compose` module system
> (`memory:namespace-access-use-compose-model`) and documenting 4.x plugins as
> unsupported on the `ast/` engine?**

If "keep it": Option A, scheduled post-seam. If "let it lapse": Option B is terminal and
the package is deleted with the legacy `tree/` engine. Either way, **B is what happens
between now and that decision** — nothing blocks on it.

---

## 3. Deletion sequence this unblocks

### 3.1 `BuilderHost` deletion — the bridge is NOT a gate

Corrected consumer map for `BuilderHost` / `parseLessFn` on `origin/dev` (supersedes
`BUILDERHOST-RETIREMENT-DESIGN.md` §1.1 for the bridge row):

| Consumer | Real coupling | Gates `BuilderHost` deletion? |
|---|---|---|
| **scss-parser** extends `LessGrammar` | grammar reuse | **YES** — the P1 SCSS rebase (in flight) must land first. |
| **`ast/` import sub-parse** `parseFileVars: parseLessFn` (`import.ts:250`, `collectFileVars`) | secondary parse of imported files to read literal `@var` scope for interpolated import paths; reads `parsed.tree.rules` | **YES** — this is `BUILDERHOST-RETIREMENT-DESIGN.md` **R0**: re-point `import.ts` off `parseLessFn` onto the `ast/` dispatch-host. This is on the **live `.less` `ast/` front-end**, so it is the one that matters. |
| **`LessParser` class** (`functional-parser.ts`) | public parse entry building `tree/` nodes | consumed by parser tests + any external `.parse()` caller; retired with the legacy producer. |
| **Parser unit tests** | `parseLessFn` shape | freely updated (`memory:no-sacred-test-expectations`). |
| **less-compat bridge (source)** | — **none** (§1.2) — | **NO.** Does not import `BuilderHost`/`parseLessFn`. |

So the precise `BuilderHost`-deletion sequence (unchanged from
`BUILDERHOST-RETIREMENT-DESIGN.md` R0–R4 **except** that the bridge is removed from the
gate set):

1. **scss-parser P1–P3** (separate track): SCSS grammar stops extending `LessGrammar`.
2. **R0**: re-point `ast/` import sub-parse (`collectFileVars`) off `parseLessFn` onto the
   dispatch-host — the last *live* `BuilderHost` edge on the `.less` `ast/` path.
3. **R1–R3**: grammar query-prelude split (S6+S5), custom-prop-name split (S-A4), and
   `Quoted` structuring string-interp (S-Q3.3) — the grammar-relocation work that makes
   the dispatch-host the sole producer.
4. **Delete `parseLessFn` legacy consumers → delete `builders.ts` + the `BuilderHost`
   subclass + `LessParser` wholesale.** With the bridge removed from the gate set, this
   requires only: scss-parser off `LessGrammar` (1), R0 done (2), and parser tests
   updated. **The bridge does not block this.**
5. **Then the fusion** (`GRAMMAR-AST-FUSION-DESIGN.md`) proceeds: fold the grammar's build
   actions into the `ast/` dispatch-host as the single producer.

### 3.2 Legacy `tree/` engine deletion — where the bridge DOES sit

The bridge's real gate is the **deletion of the legacy `tree/` eval engine**, which
happens only after `.scss`/`.jess` also cut over to `ast/` (out of scope here). At that
point both the bridge's node model (`tree/` classes) and its invocation hook
(`applyBeforeEvalVisitors`) vanish. Handling at that milestone is exactly the §2 fork:

- **Option A taken** → the bridge has already been repointed onto `ast/` (A1 seam + A2
  transform rewrite) and survives on the new engine.
- **Option B terminal** → the package is deleted alongside the legacy `tree/` engine.

**Bridge test coupling (the one concrete thing to track under B):** the integration tests
(`test/integration/*.test.ts`) construct `tree/` nodes via `new Parser()` from
`@jesscss/less-parser/jess` (BuilderHost) and feed them through `toLessNode`/`fromLessNode`.
These are (c) "parser tests" in the retirement doc's sense and are retired with the
legacy producer; they are **not** a reason to keep `BuilderHost` for the bridge.

### 3.3 Tracker (Option B bookkeeping)

Add a single grep-able marker so the deferred gap is documented 1:1
(`memory:feedback-deferred-cruft-must-be-documented`), e.g. in
`plugin-less/src/ast-render.ts` near the evaluator/options construction:

```
// TODO(less-compat-repoint): the ast/ .less render path exposes no visitor/custom-fn
// seam, so @jesscss/plugin-less-compat (4.x plugin/visitor/custom-fn compat) is dark for
// .less production. Repoint (add AstRenderOptions injection seam + rewrite transform onto
// ast/ plain-data model) OR let the surface lapse for @use/@compose — owner decision.
// See docs/future/core-architecture/LESS-COMPAT-REPOINT-DESIGN.md §2.
```

---

## 4. OPEN(owner) items

1. **The fork (§2 recommendation box).** Keep the Less.js-4.x plugin/visitor/custom-fn
   compat surface alive for `.less` on `ast/` (Option A, scheduled) vs let it lapse for
   `@use`/`@compose` (Option B terminal). This is a product/contract call. **Everything
   below is independent of it; B is the interim state regardless.**
2. **Narrow `memory:eval-load-bearing-post-flip`** to `.scss`/`.jess` only — `.less` is
   `ast/`-production today (§1.3). Owner to confirm before the memory + any doc citing it
   (incl. `BUILDERHOST-RETIREMENT-DESIGN.md` §4) are edited.
3. **Correct `BUILDERHOST-RETIREMENT-DESIGN.md` §1.1/§4/§6.4** to drop the bridge from the
   `BuilderHost`/`parseLessFn` consumer + gate set (§3.1): the bridge does not import
   either. R4's "bridge re-point green" sub-gate is mis-scoped and should be removed —
   `BuilderHost` deletion gates only on scss-parser-off-`LessGrammar` + R0 + parser tests.
4. **If Option A:** the A1 injection seam is a change to the `ast/` whole-doc pipeline's
   deliberately-narrow public contract (`AstRenderOptions`). Confirm that adding
   visitor/custom-fn hooks there is acceptable, or whether the seam should live entirely
   on the `plugin-less` consumer side (preferred, mirroring how the evaluator/grammar
   binding already lives there).
