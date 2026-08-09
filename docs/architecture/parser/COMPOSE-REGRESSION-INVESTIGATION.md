# Why the four grammars cannot `compose()` today — and what makes them able to

**Investigation only.** No grammar was changed. Base: `fb272dfc1`
(`investigate/compose-regression`, branched from `origin/dev`).

**Answer in one line:** composition was **traded away for host mode**, and the
cost was never recorded. `compose()` is not broken and parseman did not regress
— the grammars that used `compose()` were the **CST** grammars, and
`59f695d4a` deleted them. The blocker is real but it is **two analyzer gaps in
parseman, both of which this lane closed and measured**, plus one mechanical
jess-side refactor.

---

## 0. The three candidates, separated by evidence

| candidate | verdict | evidence |
|---|---|---|
| **(a) host-mode builders are unserializable to IR** | **CONFIRMED — this is the cause** | §1, §2, §3 |
| **(b) a parseman regression since the pre-fold version** | **RULED OUT** | §4 |
| **(c) something else (package boundary, etc.)** | **RULED OUT** | §3 |

---

## 1. Archaeology: what actually changed at `59f695d4a`

`59f695d4af30a7117ca78a6dbf2cb247ace8d54f`, 2026-07-27,
"refactor(parser): fold dialect grammars to host mode". **No commit body, and no
perf numbers recorded** — the trade this document names was never written down.

At `59f695d4a^` = **`afd6f44799ba0284a69d0f98c048a8f94a3ba521`** there were
EIGHT grammar files, and they used **different composition primitives**:

| file | kind | primitive |
|---|---|---|
| `*/src/grammar.ts` (four) | **CST** — `node('Label', sequence(…))`, essentially no build callbacks | **`compose()`** |
| `*/src/ast/grammar.ts` (four) | **host mode** — imports `decl`, `dimension`, `funcCall`, `any`, `withSourceSpan`… from `@jesscss/core/ast` | **`composeLeaf()`** |

Quoted, `scss-parser/src/grammar.ts` at `afd6f4479`:

```ts
import { lessGrammar } from '@jesscss/less-parser/grammar';
export const scssGrammar = compose([lessGrammar, cssAstSyntax, rules({ trivia: rw }, (g: any) => { … })]);
```

and its host-mode twin, `scss-parser/src/ast/grammar.ts:1033` at the same sha:

```ts
export const scssAstGrammar: Record<keyof ScssAstRules, FusedRule> =
  composeLeaf([cssAstSyntax, opaqueAtRuleRecognition, cssAstPseudoSyntax, rules<ScssAstRules>(…)]);
```

Reducer-callback density in the pre-fold CST files: **1–2 arrow functions per
file** across 43–78 `node(` sites. They were labelled trees, not builders.

**The host-mode grammars NEVER used `compose()` — not before the fold either.**
The fold deleted the CST twins, and the `compose()` call sites went with them.
This is not a regression; it is a deletion nobody costed.

## 2. The pre-fold `compose()` genuinely fused (decisive historical measurement)

Measured in a `git archive` extraction of `afd6f4479` (no worktree, no
destructive git op). `pnpm install --frozen-lockfile` **fails** at that sha —
the committed lockfile is stale against the committed package.jsons
(`b8901812f` pinned parsers to exact `0.39.1` without regenerating). Installed
with `--no-frozen-lockfile`; parsers resolved **parseman 0.39.1**, root
resolved **0.41.0**. Both were probed and agree.

The gate at that sha was **`check:macro`** (`scripts/check-macro-buildable.mjs`
— scans every emitted ESM module for the `_rp[N].parse(` interpreter marker;
any occurrence fails), plus **`verify:compose-integrity`**. Verbatim:

```
✓ @jesscss/parser-shared: fully compiled — 0 interpreter fallbacks
✓ @jesscss/css-parser:    fully compiled — 0 interpreter fallbacks
✓ @jesscss/less-parser:   fully compiled — 0 interpreter fallbacks
✓ @jesscss/scss-parser:   fully compiled — 0 interpreter fallbacks
✓ @jesscss/jess-parser:   fully compiled — 0 interpreter fallbacks
All parsers are fully macro-buildable.

Compose-integrity OK (no grammar degraded to the interpreter).
```

All eight grammar files report **FUSED** under `transformMacro` at both 0.39.1
and 0.41.0. Direct artifact evidence for the composing case: scss's
`lib/grammar2.js` is 4,464,071 bytes of inlined compiled JS with **1,982
`charCodeAt` sites and 0 `_rp[` interpreter markers**, and it contains
**inlined Less-only productions** (`"MixinCall"`, `EscapedValue` ×13). The
composition really happened.

> **Instrument caveat, and it is load-bearing.** Run before the workspace is
> built, the same probe reports the same files as INTERPRETER FALLBACK / THREW,
> because `transformMacro` resolves the composed-over grammar out of the
> dependency's built `lib/`. **A context-free probe run is not a measurement.**
> This lane hit the identical artifact in its own first pass (§3).

The `TODO(parseman-compose-depth)` comment at
`less-parser/src/grammar.ts:711` (historical path) does **not** contradict
this. It says a *prospective* edit would push `lessGrammar` into non-final
position and degrade — a conditional about an unapplied change, dated to
parseman **0.32.0**, three pins behind what was installed. Measurement confirms
the comment as written and refutes the stronger reading.

## 3. What blocks `compose()` today — isolated on one axis

`scripts/probe/parseman-compose-feasibility.mjs` reproduces exactly as recorded
once the worktree is installed and built (`pnpm install && pnpm run
build:release`, parseman **0.46.0** from the lockfile):

| grammar | as committed | swapped to `compose()` |
|---|---|---|
| css | FUSED | THREW — `UrlUnquoted`: `any`, `tokenText` |
| less | FUSED | THREW — `UnsupportedMixinName`: `unsupported BlockStatement` |
| scss | FUSED | THREW — `QueryNonOnlyKeyword`: `requireKeyword` |
| jess | FUSED | THREW — `DeclarationReference`: `withSourceSpan`, `declarationReference` |

A purpose-built minimal chain (`scratchpad/hostmode.mjs`) mirrors the shape the
owner's rule requires — `base = compose([recognition, rules(<with builders>)])`,
`dialect = compose([base, rules(<delta>)])` — and varies **one axis**:

| case | parseman 0.46.0 |
|---|---|
| BASE, reducer self-contained (CST-like) | **FUSED** |
| BASE, reducer calls an IMPORTED builder (host mode) | THREW — `unsupported binding(s): decl` |
| BASE, reducer BLOCK-BODIED but fully self-contained | THREW — `unsupported BlockStatement` |
| DIALECT on a self-contained base | **FUSED** |
| **DIALECT on a host-mode base — the owner target** | FALLBACK |

So: **`compose()` composes builder-carrying grammars across packages perfectly
well.** What it cannot do is serialize a reducer that (i) reads a free name, or
(ii) has a block body. Both are properties of **host mode**, not of
composition, not of the package boundary (the inline-in-one-module case fails
identically), and not of CSS.

## 4. Not a parseman regression

| where | version | grammars-swapped-to-`compose()` |
|---|---|---|
| pinned, from `pnpm-lock.yaml` | **0.46.0** | THREW, identical messages |
| local `~/git/oss/parseman`, `4ffce49c7` "Release 0.48.0" (package.json says `0.47.0`) | **0.47.0** | THREW, identical messages |

Byte-identical behaviour. Candidate (b) is dead.

> **Contamination found, worth fixing.** The shared checkout
> `/Users/matthew/git/oss/jess/node_modules/parseman` is a **symlink to
> `/private/tmp/parseman-048-token-stream-expansion`** (another lane's dev tree,
> `9f756e7`). The whole workspace there is running against an unpinned parseman.
> Any measurement taken in the shared checkout without checking this is suspect.

---

## 5. THE PROTOTYPE — route (a) built and measured

Built against a **clone** of `~/git/oss/parseman` at `4ffce49c7` in scratch.
The owner's repo was never written to: `git status` clean, HEAD `4ffce49c7`,
branch `main`, verified after.

Two changes, both **analyzer gaps, not serialization limits**:

**(A) Carry a direct builder's free names as import provenance.**
`src/plugin/direct-builder-static.ts` splits its result into `structural`
(unrescuable) and `free` (a plain lexical read). `src/plugin/evaluator.ts` asks
a new `BuilderImportResolver` where each free name came from in the **authoring**
module; `src/plugin/index.ts` supplies it from the `importBindings` map it
already builds. Resolved names ride the IR as
`_def.buildImports = [{local, source, imported}]`
(`src/compiler/ir-serialize.ts`), and the **downstream** `compose()` site
prepends the matching `import { … } from '…'` so the inlined builder source has
something to bind to. Names that were module-private stay refusals — which is
the honest answer, and is what parseman's own emit-time free-identifier net
(`src/plugin/index.ts:2220`) exists to catch.

**(B) Walk statements, not just expressions.** A block body is carried as source
text and inlined verbatim downstream, exactly as an expression body is — it was
never a serialization limit. The walker simply only knew expressions. Adding
`VariableDeclaration` / `Return` / `Expression` / `If` / nested `Block` closes it.

### Measured result — the owner's target shape now fuses

| case | 0.46.0 / 0.47.0 | **patched** |
|---|---|---|
| BASE, self-contained | FUSED | FUSED |
| BASE, imported builder (host mode) | THREW | **FUSED** |
| BASE, block-bodied | THREW | **FUSED** |
| DIALECT on self-contained base | FUSED | FUSED |
| **DIALECT on host-mode base — the owner target** | FALLBACK | **FUSED** |

### Residual blast radius on the REAL grammars

Counted with `_nd`'s throw converted to a collector so the whole graph is
walked. "productions refused" is distinct `node()` types `compose()` still
rejects.

| grammar | refused (before / after) | structural-only after (A) | structural-only after (A)+(B) | distinct free names before → after |
|---|---|---|---|---|
| css | 113 → 113 | 39 | **3** | 44 → 39 |
| less | 208 → 208 | 97 | **18** | 69 → 100 |
| scss | 153 → 152 | 70 | **14** | 62 → 57 |
| jess | 168 → 167 | 97 | **26** | 60 → 68 |

Read that carefully — the free-name counts **go up** for less and jess, and
that is the point: (B) unblocks block-bodied reducers, so their interiors become
visible to the analyzer for the first time and contribute names that were
previously hidden behind a single `unsupported BlockStatement`. The number that
matters is the structural column: **39/97/70/97 → 3/18/14/26**, and what is
left is only `ForOfStatement`, `ForStatement`, `ThrowStatement`, and
`unsupported callback shape` — four more cases in the same walker.

**The entire remaining residual is one category: module-scope helper functions
declared inside the grammar files** — `tokenText`, `requireKeyword`,
`withBlockBody`, `isSimpleToken`, `sourceText`, `selectorTermFromTokens`, and
~50 siblings per grammar. They are not imports, so provenance cannot rescue
them. This is the last mile and it is a **jess-side** job.

### Regression check

parseman's own suite against the patch: **3982 passed, 3 failed**. All three
failures are tests asserting the exact refusals the patch lifts
(`test/unit/plugincov-direct-builder-static.test.ts` ×2 —
`refuses a callback with a block body`, `refuses a nested arrow with a block
body`; `test/unit/compose-direct-builder-ir.test.ts` — `rejects a real imported
builder capture when compose re-lowers the macro artifact`). No collateral
damage. Those three tests **encode the constraint being removed** and would be
rewritten, not deleted, as part of the real change.

---

## 6. Routes, ranked

### Route 1 — parseman (A)+(B), then hoist the grammar-local reducer helpers into an importable module. **RECOMMENDED.**

The only route measured end-to-end. (A)+(B) are prototyped, built, and shown to
fuse the owner's exact target shape; the jess side is then mechanical — move the
per-grammar reducer helpers out of `grammar.ts` into (say)
`@jesscss/parser-shared/reducers` and import them, at which point the existing
provenance mechanism already covers them (proven by the `HM-BASE-imported`
case). No CST layer, no second pass, host mode kept.

- **Cost:** parseman — extend the statement walker with four more node kinds,
  plus the provenance plumbing across four files (all located, all small); one
  release. jess — a large but mechanical helper-hoist per grammar, no semantic
  change, guarded by the byte-identity oracles (css's landed at `8c5852238`).
- **Sacrifices:** grammar-local helpers stop being module-private. That is a
  real loss of encapsulation and should be an owner call, but it is also the
  thing that makes the helpers shareable — which is the same duplication P22
  exists to end.
- **Risk:** parseman is a separate lane's responsibility. Hand it §5 and the
  scratch clone; do not land it from a grammar brief.

### Route 2 — parseman (A)+(B) plus transitive carriage of module-scope declarations.

Same as Route 1, but parseman also serializes the *source* of a referenced
module-private const/function and emits it downstream, transitively. Removes the
jess refactor entirely.

- **Cost:** materially more parseman work — transitive closure over the helper
  graph, name-collision handling in the emitted module, and a decision about
  what happens when a helper closes over something else.
- **Sacrifices:** nothing in jess. Buys generality parseman may not want.
- **Why not first:** unmeasured. Everything above Route 2 has a number.

### Route 3 — restore CST grammars, reduce to AST in a later pass.

Provably works (§2 — this is exactly what shipped at `afd6f4479`).

- **Cost:** unknown, and **that is the finding**. `59f695d4a` carries no commit
  body and no recorded perf numbers, so what host mode bought was never
  written down. Nobody can price this route without re-measuring the fold.
- **Sacrifices:** reintroduces the second tree and the second pass the fold
  removed — against
  `docs/perf/V8-ARCHITECTURE.md` and the standing "parser owns structure, core
  never re-derives" keystone.
- **Verdict:** do not take without first re-measuring what host mode is worth.
  If it is worth little, this is the cheapest route by a wide margin.

### Route 4 — hybrid: `compose()` for recognition + shared productions, `composeLeaf()` for the dialect leaf.

Effectively what the tree does today, and it does **not** satisfy the owner's
rule: a `composeLeaf` artifact exports no carried IR
(`compileComposeLeafCall` returns `replacement` only, no `exportedReplacement`,
no `carried`), so nothing downstream can extend it. It is terminal by
construction. Listed only so it is not re-proposed.

---

## 7. Not verified / open

- The patch was measured through `transformMacro` only. **The emitted artifacts
  were never executed** — no parse, no byte-identity oracle, no `check:macro` on
  a patched full build. "Fuses" is not "correct".
- Whether the injected import specifier resolves correctly when the authoring
  and consuming packages disagree on how a dependency is named. The prototype
  copies the specifier verbatim.
- The 2026-08-08 blast-radius numbers in P22 (`4f10f919e`) were not re-run at
  `fb272dfc1`; §5's before-column is this lane's own fresh measurement and
  differs slightly (scss 153→152, jess 168→167), consistent with ordinary
  grammar drift.
- Whether hoisting the reducer helpers collides with GRAMMAR-REVIEW-STANDARD's
  dedup law (parameterless combinator consts and plain reducers only; no
  factories, no hoisted regex). The helpers are reducers, so it reads as
  compatible, but a `grammar-reviewer` pass should confirm before anyone moves
  one.
- `/Users/matthew/git/oss/jess/node_modules/parseman` is symlinked to
  `/private/tmp/parseman-048-token-stream-expansion`. Unrelated to this
  investigation, but it silently unpins parseman for the whole shared checkout.

## 8. Reproduction

Scratch, not committed —
`/private/tmp/claude-501/-Users-matthew-git-oss-jess/d9f09625-11b2-4acf-ac2f-c3c892f062df/scratchpad/`:
`parseman-work/` (the patched clone), `hostmode.mjs` (the one-axis isolation),
`blast.mjs` (residual counter), `grammars.mjs` (real-grammar swap),
`probe.mjs` (the committed probe with `PM_PLUGIN`/`PM_ROOT` overrides).

The worktree must be installed and built (`pnpm install && pnpm run
build:release`) before any of them, or every result is the artifact described in §2.
