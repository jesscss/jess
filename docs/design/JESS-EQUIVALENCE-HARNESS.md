# Cross-dialect equivalence harness — design and feasibility

## The assertion

If `.jess` is genuinely a successor to Less and Sass, then converting a stylesheet
to `.jess` and compiling it must produce the same CSS as compiling the original
directly:

```
.less → .css   ==   .less → .jess → .css
.scss → .css   ==   .scss → .jess → .css
```

**Both arms run through jess's own engine.** Less.js and dart-sass do not enter
into it; jess is its own reference. Arm A is jess parsing `.less` directly. Arm B
is jess converting `.less` to `.jess` **source text**, re-parsing that text, and
evaluating it.

Because both arms use the same engine, the same serializer and the same options,
the gate is **byte-identity**, not semantic equivalence. Semantic comparison
exists for cross-*engine* work (comparing jess against Less.js) and is the wrong
instrument here — a byte diff is both stronger and simpler.

A divergence therefore has exactly two possible causes, and both are precisely
actionable:

1. the converter lost information, or
2. the `.jess` dialect cannot express something the source dialect can.

The serialize-and-re-parse step is the point of the design, not an implementation
detail. An in-memory AST-to-AST transform would skip the boundary where
information actually gets lost. Round-tripping through real `.jess` source proves
three things at once: the converter emits **valid `.jess` source** rather than
merely a valid AST; the `.jess` parser can **read back** what the emitter writes;
and **evaluation** of the re-parsed tree agrees.

## Feasibility verdict: not buildable today

Two capabilities are required. **Neither exists.**

### 1. No `.less`/`.scss` → `.jess` converter

- `packages/jess/bin/cli.mjs` is the entire CLI (45 lines, `parseArgs` with only
  `--out` and `--help`). There is no subcommand dispatch. Its only action is
  `compiler.render()` → write CSS. It is the only `bin` field across all 28
  workspace packages.
- `packages/jess/src/index.ts` exports only `ConfigOptions` and `Compiler`
  (`compile`, `render`, `renderString`, `renderToResult`, `safeCompile`,
  `safeRender`, `createContext`, `dispose`) — all CSS-producing.
- `docs/design/DIALECT-TO-JESS-COMPILED-CONVERSION.md` describes the conversion,
  but its own status line reads "This is **queued design work**." Its proposed
  `ConversionFacts` / `targetDialect` / conversion-planner vocabulary has zero
  implementation hits repo-wide.
- `packages/jess-plugin-less-compat` is a runtime API shim, not a converter —
  `plugin.ts:20` states that a node-conversion bridge is intentionally
  unsupported.

### 2. No `.jess` source emitter — this is the deeper gap

- `packages/core/src/ast/serialize.ts` has exactly one export:
  `serialize(root: Stylesheet, options?: SerializeOptions)`. It emits **CSS**.
  `SerializeOptions` has no dialect or target field.
- No `toSource` / `toJess` / `unparse` / `deparse` anywhere in the repo. The old
  `toModule` emitter survives only as commented-out dead code in eight tree files.
- The closest thing to a source printer is the language-service formatter
  (`packages/language-service/src/engine.ts:639`), and it is a character-by-character
  re-indenter over **raw text** that never touches the AST — which is itself
  evidence that the AST → source path does not exist.
- All 24 `.jess` files in the repo are hand-written fixtures. No code writes a
  `.jess` file.

**Per the standing instruction, no converter was built.** Building one is a
substantially larger project than a test harness, and it should be scoped
deliberately. What was built instead is the blocking-construct inventory (below),
which is the part that is measurable today and is the actual roadmap.

## Documentation bug — `jess convert` is advertised as shipping

`packages/docs-content/docs/shared/04-guides/03-migrating-to-jess.mdx:32` states
verbatim:

> `jess convert` is available today and is best used as a first-pass migration assistant.

Line 38 documents `jess convert "./src/less/**/*.less" "./src/styles"`. The
frontmatter description and the "coming from Sass" guide both repeat the claim.
No such subcommand exists; the CLI would treat `convert` as an input filename and
fail with a file-not-found error. This is user-facing and worth fixing
independently of the harness.

The same file is, however, the closest thing to a **converter specification** in
the repo — its mapping tables define the intended target spellings, and they are
now pinned as executable rows in the inventory test.

## The vacuity trap, and why the architecture forecloses it

A round-trip harness can pass while proving nothing. If the emitter serialized the
**evaluated** tree, variables would already be resolved and mixins expanded — arm
B would emit flattened CSS wearing `.jess` syntax, round-trip byte-identically by
construction, and test nothing.

**This is architecturally impossible here, which is a genuinely good result.**
`serialize()` takes the **parsed** `Stylesheet` and evaluates *during* emit — one
fused pass. The settled owner ruling in
`docs/architecture/core/UNIFIED-EVAL-EMIT-DESIGN.md` is explicit: "One
pass, no double-eval. Eval ONCE; serialize/emit as you go," and the node
intermediate "survives only TRANSIENTLY and LOCALLY at each emit position, never
as a persistent output tree."

There is therefore **no evaluated tree to walk**. The only persistent tree is the
parsed one, which retains the abstractions — a parsed Less tree carries
`VariableDeclaration`, `VariableReference`, `MixinDef`, `MixinCall` nodes. An
emitter has no choice but to walk that, so `@color: red` must emit as
`$color: red` and mixins must stay mixins.

The cost of the same property is the real engineering estimate: because eval and
emit are **fused**, a `.jess` emitter is a sibling in *shape* only. The existing
walk's core behaviour is "resolve, then write"; the emitter needs "preserve, then
write" at every value, mixin, guard and control-flow site. It is a parallel
emission target over a shared traversal, not a flag on the existing one.

## Harness design (to build once the emitter exists)

Follow the ratchet convention already established by
`packages/jess/test/scss/bootstrap-corpus.test.ts`.

**Per corpus file:**

1. **Arm A** — `Compiler.safeRender(file.less)` → `cssA`.
2. **Convert** — walk the parsed tree, emit canonical `.jess` source text, write it.
3. **Arm B** — `Compiler.safeRender(file.jess)` → `cssB`.
4. **Gate** — `expect(cssB).toBe(cssA)`.

**Render mode.** `.jess` defaults to nested output (`collapseNesting:false`) while
the Less route is flat. Both arms must be configured **identically and
explicitly** — never left to per-dialect defaults. Run the matrix in **both**
modes: a divergence appearing in only one mode is a real finding, and a flat-only
comparison would miss exactly the class of bug that surfaces when nesting
structure is mishandled.

**Corpora** (all present and wired; invent no fixtures):

| Arm | Corpus | Role |
| --- | --- | --- |
| Less | `all-less` test-data | primary — Less compat is a real goal |
| Less | `bootstrap-less-port@2.5.1` | real-world breadth |
| Sass | `packages/jess/benchmark/gen-workload.*` + targeted Sass+ fixtures | **primary** |
| Sass | `bootstrap@5.3.8` scss | secondary, inventory source only |

Bootstrap's SCSS is deliberately demoted on the Sass arm. Only 29/92 of its files
parse today, and much of the shortfall is Sass surface that Sass+ never intended
to support — running it as the primary fixture would report a wall of failures
that are deliberate non-support, which is how a diagnostic gets ignored.

**Ratchet, not gate.** Record a per-file outcome with a floor that fails only on
regression. Unconverted constructs are recorded, never thrown.

**Scope split.** The two arms carry different obligations, and conflating them
would make the output noise:

- **Less arm** — Less compatibility is a real goal. A construct that cannot
  round-trip **is a gap**.
- **Sass arm** — the SCSS surface is Sass+, a deliberate subset. Three outcomes,
  not two: `gap` (intended surface that fails), `by-design` (Sass+ does not
  intend to support it — recorded, not a failure), and `undecided` (intent is not
  written down anywhere — for the owner, not for us to assume either way).

## The blocking-construct inventory

Landed as `packages/jess/test/jess/conversion-construct-support.test.ts` — a
runnable ratchet, not prose, so it cannot rot. Each row is the smallest snippet
isolating one construct, recorded against the real `.jess` parser.

The harness's precondition is that `.jess` can express the source construct at
all, so this is measurable **now**, before any converter exists — and it is the
concrete roadmap for the successor claim.

**63 constructs: 49 supported, 12 gaps, 2 undecided.**

### CSS-level gaps — unambiguous bugs

These parse in css/less/scss and fail **only** in `.jess`:

| Construct | Detail |
| --- | --- |
| `calc()` with an operator | `calc(1px)` parses; `calc(100% - 10px)` and `calc(1px + 2px)` do not. The failure is an operator inside `calc` — essentially all real-world use. |
| `unicode-range` | Fails in every form (`U+26`, `U+0-7F`, `U+4??`). Blocks any `@font-face`-bearing stylesheet. |

### Less-arm gaps — Less compat is a real goal, so these are real

| Construct | Working alternative |
| --- | --- |
| Guard calling a function — `when (iscolor($x))` | none; comparison guards `when (($x = 1) and ($x > 0))` do work |
| Rest/variadic parameters — `.m($a...)` | none; `...$a` and bare `...` also fail |
| Literal-value pattern matching — `.m(dark)` | only `.m($x: dark)`, which is a default, not a dispatch key |
| Anonymous-mixin **call** — `$ > $d()` | none; the *declaration* `$d: { … };` parses, stranding the value |
| `!important` on a mixin call | none |
| `&:extend()` in a rule body | selector placement `.b:extend(.a)` only |
| `@import (optional)` / `(css)` | `(reference)` has a dedicated `@-reference`; the others have no option syntax |

### Sass+-arm gaps

| Construct | Detail |
| --- | --- |
| `$while` | Named in-repo as an intended Sass+ lowering target for `@while` — one of the two constructs cited as proving the eval model — but no parser accepts it, `.jess` or scss. |
| `@-compose … with { }` | The migration guide documents `with { }` as *the* mapping for Sass `@use … with`, but the `@-compose` production (`grammar.ts:1406`) accepts only `<quoted> [as <name>] [;]` — there is no `with` clause in the grammar. |

### Undecided — owner call, not an assumption

| Construct | The question |
| --- | --- |
| `@media $[m]` | The value form `$(m)` works. Whether the accessor form `$[…]` is also valid in an at-rule prelude is unrecorded — and the interpolation model ("`$[…]` is the accessor everywhere, `$(…)` is value-only") points the opposite way. |
| `$a: 1px !important;` | Less accepts it and carries the flag through substitution. Whether Jess intends to keep that behaviour is unrecorded. |

## What it would take to close the gap

Roughly in dependency order:

1. **Fix the two CSS-level bugs** (`calc()` with operators, `unicode-range`).
   These are parser fixes, independent of everything else, and they block any
   real-world stylesheet regardless of conversion.
2. **Resolve the two undecided rows** — owner decisions, cheap, unblock inventory
   classification.
3. **Close the documented-but-missing surface** — `@-compose … with`, `$while`.
   These are promises the docs already make.
4. **Close the Less-arm gaps** — the seven rows above. This is the bulk of the
   language work and is what "successor to Less" actually costs.
5. **Build the `.jess` emitter** — a parallel emission target over the shared
   parsed-tree traversal, preserving abstractions rather than resolving them.
   This is the large piece, and the fused eval/emit architecture means it is a
   sibling traversal rather than a flag.
6. **Wire the harness** — mechanical once 5 exists.
7. **Fix the migration guide** — either implement `jess convert` or stop claiming
   it ships. Worth doing immediately and independently.

Note that the emitter is **product surface, not just test infrastructure**: the
same component is exactly what a `.less` → `.jess` migration tool needs, which the
successor positioning implies users will want, and which the docs already promise.
