# ast/ Family Co-location + Parse-Host Collapse — Executable Reorg Plan

Status: EXECUTABLE PLAN (read-only investigation, no code touched). Anchored to `origin/dev` @ `741fa9c0` — POST the value-domain decomposition / extend-module split / G5 StyleImport land. Two coupled reshapes:

1. **KEYSTONE (owner-decided):** `parse-host/` COLLAPSES out of core. Node CONSTRUCTION moves to the parser layer. Core exports a LEAF `@jesscss/core/ast` subpath (node type defs + factories, zero engine/value dependency); the parser imports it and builds core's ast v2 nodes directly as the grammar reduces. The `FunctionalParseHost` callback indirection — vestigial once ast v2 is the sole build target — dies.
2. **Family co-location** of everything that STAYS in core (engine / value / expr-eval / selector-compose / rule-merge / mixin / extend / serialize), plus duplicate-name resolutions and the `engine/emit` spine, per `AST-V2-STRUCTURE-BLUEPRINT.md` (HYBRID, owner-ratified 2026-07-16).

The keystone is the master-level move; §1–§7 (co-location) apply to the residual, core-resident tree.

---

## §0 KEYSTONE — parse-host collapse: node construction belongs with the parser

### 0.1 The tangle, with import evidence

Core is meant to be a LEAF. Verified on `origin/dev`:
- `git grep "from 'parseman'|@jesscss/css-parser|@jesscss/less-parser"` over `packages/core/src` **excluding `ast/parse-host/`** → **EMPTY**. Core imports NOTHING from any parser package or parseman *except inside `parse-host/`*.
- `dispatch-host.ts:17` → `import { run } from 'parseman'` — a RUNTIME edge (the parse driver), not just a type. Leaves core on `parse-host/` deletion.
- `dispatch-host.ts:18` → `import type { FunctionalParseHost } from '@jesscss/css-parser/jess'`. The ONLY core→css-parser edge (type-only, but the package dep is real).
- `import.ts:31` → `import { parseLessFn } from '@jesscss/less-parser'`. The ONLY core→less-parser edge (RUNTIME — re-parses imported files).
- **Core declares NO parser/parseman dep in its own `package.json`** (nothing parser-related in `deps`/`devDeps`) — the three edges above resolve only because pnpm workspace-hoists the sibling packages. So they are undeclared, cycle-forming edges: exactly the debt to remove.
- Meanwhile `css-parser`, `less-parser`, `jess-parser`, `scss-parser` all declare `"@jesscss/core": "workspace:*"` (deps). So the package graph is **parser → core** everywhere, EXCEPT the `parse-host/` back-edges that make it **core ↔ parser** — a genuine cycle, and `parse-host/` sits in the middle of it, not breaking one.

### 0.2 The `FunctionalParseHost` callback is vestigial

`FunctionalParseHost` (defined in `css-parser/src/functional-driver.ts:30`) is the seam that let ONE grammar drive TWO node targets during the cutover. Implementors on `origin/dev`:
- `css-parser/src/functional-parser.ts:15` `class BuilderHost extends CssParser` — builds **legacy `tree/`** nodes (reuses `CssParser.buildNode`).
- `less-parser/src/functional-parser.ts:20` `class BuilderHost extends LessGrammar` — legacy `tree/` (imports `nil`/`Rules`/`TreeContext` from core's legacy tree).
- `jess-parser/src/functional-parser.ts:17` `class BuilderHost extends JessGrammar` — legacy `tree/`.
- `core/src/ast/parse-host/dispatch-host.ts:33` `class ParseBuildHost implements FunctionalParseHost` — the ast v2 target (`build()` → `ACTION_LIST` map → `actions/*.ts`).

So a SECOND (legacy) host family still exists — three of them, in the parser packages, building legacy `tree/`. The callback earns its keep ONLY while two targets coexist. **Retiring the legacy hosts** (post-cutover, when legacy `tree/` dies) removes the second target; with ast v2 sole, the grammar's `node(type,…)` can construct ast v2 DIRECTLY in the parser package — no injected host, no `build(type,…)` dynamic dispatch. The indirection collapses.

Crucially, the parser packages ALREADY demonstrate "parser constructs core's nodes directly": `less-parser`'s legacy `BuilderHost` imports node ctors (`nil`, `Rules`) from `@jesscss/core` and builds them inline. The relocation just retargets that established pattern from legacy `tree/` onto ast v2's factories.

### 0.3 The leaf export surface — `@jesscss/core/ast`

Mirror the existing `@jesscss/core/value` subpath EXACTLY (`fns` already consumes `/value` as a narrow leaf).

**`packages/core/package.json` `exports`** — add:
```jsonc
"./ast": {
  "types":   "./lib/ast.d.ts",
  "source":  "./src/ast.ts",
  "import":  "./lib/ast.js",
  "require": "./lib/ast.cjs"
}
```
**`packages/core/tsdown.config.ts`** — add the entry (code-splitting already ON, so the shared node-data chunk is one runtime instance, no byte-dup across `index`/`value`/`ast`):
```ts
entry: { index: './src/index.ts', value: './src/value.ts', ast: './src/ast.ts' }
```
**`packages/core/src/ast.ts`** (NEW leaf barrel, distinct from the internal `src/ast/index.ts` full surface — a file named `ast.ts` beside the `ast/` dir is legal TS; the subpath resolves to `lib/ast.js`). It re-exports ONLY the node layer:
```ts
// The LEAF construction surface: node type defs + factories, ZERO engine/value runtime.
export * from './ast/node.js';        // Node union, isNode, Combinator, renderCombinator
export * from './ast/nodes.js';       // every node interface + factory (word/dim/rule/…)
export * from './ast/at-rule.js';     // AtRuleBlock/Statement + ctors
// POST family co-location, this becomes:
//   export * from './ast/expr/node.js'; ./selector/node.js; ./rule/node.js;
//   ./mixin/node.js; ./at-rule/node.js; ./extend/node.js;
//   (+ the factory consts that travel with each)
```

### 0.4 Cycle-cleanliness — proven leaf

The crux is that the node layer imports NOTHING heavy at RUNTIME. Verified imports of the three node files on `origin/dev`:
- `node.ts` — `import type` from `./nodes.js` + `./at-rule.js` ONLY. (Exports `renderCombinator` runtime; no inbound heavy dep.)
- `nodes.ts` — runtime: `{ Combinator, renderCombinator }` from `./node.js` (sibling leaf) ONLY. Everything else is `import type`: `GuardNode` (guard.js), `CallArg` (mixin-dispatch.js), `LiteralTag`/`LitFields` (literal-tag.js), `AtRuleBlock`/`AtRuleStatement` (at-rule.js). **All erased at build.**
- `at-rule.ts` — `import type` from `./nodes.js` ONLY.

So `@jesscss/core/ast`'s runtime closure is exactly `{ node.ts, nodes.ts, at-rule.ts }` (+ their post-co-location family `node.ts` splits) — the engine (`serialize`/`emit`/`scope`), value-algebra (`value/*`), `expr/eval`, `selector/compose`, `mixin/dispatch`, `extend/*` are reached ONLY through `import type` edges and never enter the bundle. The parser importing `/ast` pulls the node-data layer and nothing else.

**Module-eval graph after relocation:**
- `parser/*/functional-parser.ts` → `@jesscss/core/ast` (leaf; **no back-edge** — `core/ast/*` never imports any parser).
- The `parseman` `run` edge (`dispatch-host.ts:17`) and the `parseLessFn` edge (`import.ts:31`) both LEAVE core with `parse-host/`; the parser packages already declare `parseman` + own the driver, so the edges land where the deps already exist.
- Core's high-level "parse a string → ast root" concern (today `parse-host/dispatch-host::parseToAst` + `import.ts`) MOVES to the parser side (§0.5), so **core stops importing the parser entirely.** The `git grep` above already proves the ONLY core→parser edges live in `parse-host/`; deleting `parse-host/` reduces core→parser to ZERO.
- Result: the package graph becomes strictly **parser → core** (acyclic at the PACKAGE level, not merely "acyclic modules despite a package cycle"). This is stronger than the owner's minimum bar — the edge dissolves rather than being tolerated.
- **The relocated byte-identity harness (§0.5) runs parser-side and drives a parser entry, so it must DECLARE its parser dep there** (`less-parser`/`css-parser` devDep on the sibling under test, or a neutral test package). It must NOT be added back to core's `package.json` — that would re-introduce the exact declared core→parser dep this keystone removes.

If, during migration, any transitional core module still needs the parser (e.g. import resolution not yet relocated), keep that module OUT of the `/ast` leaf and OUT of the engine — isolate it so the leaf stays import-clean and no eager circular eval forms. But the end state has no such module.

### 0.5 Where the builders + plumbing land

The legacy grammar inheritance already draws the CSS/Less line: `LessGrammar extends CssParser` (`less-parser/src/builders.ts`), and each package's legacy `buildNode` owns exactly its node types. **Relocate each ast v2 family builder to whichever parser package already owns that node type's legacy `buildNode` case** — mirror, don't reinvent.

| Current core module | Node types it builds | Lands in |
|---|---|---|
| `actions/ruleset.ts` | Rule/Declaration/Root | **css-parser** (CSS-general) |
| `actions/selector.ts` + `actions/selector-interp.ts` | Simple/Compound/Complex/SelectorList | **css-parser** (selector-interp is `@{}`-in-selector → the Less-interp arm rides in **less-parser**, splitting the module — see note) |
| `actions/value-leaf.ts` | Word/Dimension literals | **css-parser** |
| `actions/value-expr.ts` | Sequence/Operation/Paren/FunctionCall | **css-parser** base; Less operations arm → **less-parser** |
| `actions/custom-props.ts` | custom-property Declaration | **css-parser** |
| `actions/comments.ts` | Comment | **css-parser** |
| `actions/at-rules.ts` + `actions/charset.ts` | AtRuleBlock/AtRuleStatement/@charset | **css-parser** |
| `actions/interp.ts` | Interp (`@{…}`) | **less-parser** (Less-only) |
| `actions/variables.ts` | VarRef/VarIndirect/VarDeclaration | **less-parser** (Less-only) |
| `actions/mixins-def.ts` + `actions/mixin-call.ts` | MixinDef/MixinCall/Param/PathSeg | **less-parser** |
| `actions/extend.ts` | ExtendInstruction (+ `:extend` markers) | **less-parser** |
| `parse-host/import.ts` (@import resolve, re-parses) | StyleImport resolution | **less-parser** (already imports `parseLessFn`; pure re-parse+splice concern) |

Split-module note: a handful of actions (`selector-interp`, `value-expr`) carry both a CSS-base arm and a Less arm. The css-parser builder owns the base; the less-parser builder (which `extends` it) overrides/augments the Less arm — exactly as legacy `buildNode` inheritance already does. Determine each split at the `buildNode`-case granularity when executing; the legacy split is the oracle.

**Plumbing disposition (bucket (c) — DISSOLVES, the plan was already right; see §0.7):**
- `parse-host/dispatch-host.ts` (`ParseBuildHost` + `parseToAst`, `ACTION_LIST` dispatch, the `run` driver) → **DISSOLVES.** The `build(type,…)` map becomes the parser class's v2 `buildNode` switch (each parser already HAS a `buildNode`; add/replace with the ast v2 cases). `parseToAst` becomes the parser package's public v2 parse entry (e.g. `parseLessToAst`), sibling to the existing legacy `parseLessFn`.
- `parse-host/actions/index.ts` (`ACTION_LIST` registry) → dissolves into the parser's `buildNode` dispatch.
- `host-context.ts` contract types (`BuildContext`/`BuildArgs`/`BuildFn`/`Placeholder`/`isPlaceholder`/`isStatement`/`RawArg`/`isRawArgList`) → dissolve into the parser's build infrastructure.

**The three HARD relocations** (`import.ts` subsystem, the `:extend` marker protocol, and trivia/`declParts`/`sliceSpan` boundary-crossing) are NOT "trim on arrival" — each is specified in §0.8. **The interpolation-bearing families do NOT relocate until Tier-B grammar-structuring lands — see §0.9.**

### 0.7 Per-regex kill-list with bucket verdicts

The build actions carry byte-scanning regexes that re-derive structure the parser SHOULD hand over. A blind lift-and-shift would relocate the smells. Each site is bucketed: **(a) DIES via grammar structuring** (must NOT relocate — blocked on Tier-B, §0.9), **(b) RELOCATES-AND-CLEANS** (de-smell on arrival, don't just port), **(c) DISSOLVES** (plumbing, §0.5).

**Bucket (a) — DIES via grammar structuring (HARD-blocked on Tier-B #6; do NOT relocate the regex):**

| Site | What it does today | Grammar change that kills it |
|---|---|---|
| `at-rules.ts:42` `AT_KEYWORD` + `:59 atRuleHead` slice | Regex-extracts the at-keyword and byte-slices the prelude out of one opaque `scanTo` leaf. There is a literal `TODO(tier-b)` at `:44`. | Structure the `AtRuleBlock` prelude in `grammar.ts` as a leaf-split node like `InterpolatedSelector` already is for selectors — emit `{name}` + prelude children. Construction reads structured children; the keyword regex + brace-slice delete. |
| `at-rules.ts:73–110` `interpFromString`/`parsePreludeValue` `@{}`/`@name`/`@@name` re-tokenizer | Re-tokenizes prelude bytes into `Interp`/`VarRef`/`VarIndirect`. **`scanTo` even STOPS at `@{`, so `@media @{q}` / `@keyframes @{name}` MISPARSE today** — this SHIPS a bug. | Same Tier-B prelude structuring: the grammar emits the interpolation replacements (as it does for `InterpolatedSelector`), construction consumes them. The re-tokenizer AND the misparse die together. |
| `custom-props.ts:52–64` `interpFromString` + `:79–91` `declName`/`declBody` | `@{}` re-tokenizer for the property NAME (`--@{k}` arrives as an opaque run `--@`,`{`,`k`,`}`) + trailing-`;` strip + first-`:` split. `TODO(tier-b)` at `:80`. | Structure the custom-property declaration (name-template + value) like a selector: grammar emits the `@{}` replacements in the name and the bounded value; construction reads them. Kills the name re-tokenizer and the byte split. |
| `import.ts:466` `specifierRaw` `raw.includes('@{') / '@@'` | Detects an interpolated import specifier by substring scan to decide deferral. | Structure the import specifier the same way — the parser already emits an `Interpolated{source,replacements}` for interpolated paths (import.ts:132 CONSUMES it via `%%`-split, which is the RIGHT shape); extend that so the `@{}`/`@@` DETECTION reads "is this an `Interpolated` node?" not a substring test. |
| `host-context.ts:176–181` `declParts` byte-split on `:`/`;` | Splits `name: value` by first `:` and trailing `;`. | Structure the declaration so the grammar delivers name + value as separate bounded children (it already bounds the decl span; split at the grammar, not in the host). This is the same asymmetry: `InterpolatedSelector` is structured, declarations are not. |

The unifying diagnosis (the keystone P0): **selectors are already leaf-split/structured; at-rule preludes, custom-prop names, decl bodies, and import specifiers are NOT — so those families re-tokenize. Tier-B closes exactly that asymmetry.** Relocating any bucket-(a) regex before Tier-B would carry the `@media @{q}` misparse across the package boundary.

**Bucket (b) — RELOCATES-AND-CLEANS (move to the parser, de-smell on arrival — do NOT port verbatim):**

| Site | Concern | Clean-on-arrival |
|---|---|---|
| `comments.ts:58` + `:139–150` gap-scan | Scans byte gaps between children to recover standalone comments. | The parser already logs trivia (`captureTriviaForNode`/`commentOnlyTriviaForNode`); consume the structured trivia log the parser owns, not a re-scan. |
| `charset.ts:84` slice | Slices the `@charset` prelude bytes. | Fold into the structured at-rule head (rides the same Tier-B structuring as a follow-on, or reads the bounded prelude child). |
| `extend.ts:43,70` `ALL_FLAG` | Reads the `!all` flag off bytes. | Consume the parser's `optional(flag)` structured child (the grammar already captures it — `flag=0` → `partial`). |
| `import.ts:472` `unwrapUrl` / `:296` `.css` test / `:483` `flagsFromOptions` / `:450` keyword | url() unwrap, `.css` extension test, `(option,…)` split, specifier keyword reads. | These are RESOLUTION-domain classifications (CSS-passthrough vs Less-inline), not node construction; they move with the import subsystem (§0.8a) and stay as resolution logic, cleaned to read structured option/specifier children where the grammar provides them. |
| `value-leaf.ts:86`, `variables.ts:43,70,88`, `mixin-call.ts:76`, `mixins-def.ts:59–119`, `value-expr.ts:131` | span-reads + sigil (`@`/`$`/`~`) strips on already-bounded children. | These read spans the grammar ALREADY bounded (not re-tokenizing free text) — lower-risk. Relocate reading the bounded child; drop any strip the grammar can label. Audit each against "is the grammar already handing me this boundary?" on arrival. |

**Bucket (c) — DISSOLVES (plumbing, §0.5):** `dispatch-host` `ParseBuildHost`/`parseToAst`/`run`, `actions/index.ts` `ACTION_LIST` registry, `host-context` `BuildContext`/`BuildArgs`/`BuildFn`/`Placeholder`/`isPlaceholder`/`isStatement`. No structure re-derivation — pure host wiring that folds into the parser's build path.

### 0.8 The three hard relocations (specified, not hand-waved)

**(a) `import.ts` (631) — a whole resolution SUBSYSTEM, not a node builder.** It is post-parse `@import` resolution: `createImportState()`/`ImportState` (per-parse `seen: Set`, `stack`, `varScopeCache: Map`, `entry`), `collectFileVars`/`importScopeVars` (reads files via `fs`, RE-PARSES them through `parseLessFn`), `interpTemplateOf`/`fillInterpTemplate` (fills an `Interpolated{source,replacements}` path template by splitting `source` on `%%` at `:132` — this is the KEYSTONE-COMPLIANT consumer: it reads the parser's structure, not a re-tokenize), `isCssPassthrough`/`resolveLessPath`, `resolveImportStatements`/`resolveDirectImports`/`spliceImport` (the splice that replaces a `StyleImport` head with the imported file's statements).
  - **Disposition:** move to **less-parser** as a `resolve-imports` module (it already depends on `parseLessFn` + `fs`; it re-invokes the parser, which is a parser-package concern). It imports node types/ctors (`StyleImport`, `rawInline`, `styleImport`) from `@jesscss/core/ast` (leaf) — clean, no back-edge.
  - **Per-parse import STATE** (`ImportState`) travels with it and is threaded through the parser's v2 entry, NOT held in core.
  - **The `%%`-splice (`:132`) is preserved as-is** — it already consumes the parser's `Interpolated` template. Do not "clean" it into a regex; it is the target shape.
  - **Interpolated-path DEFERRAL** (`@import "@{theme}.less"` unresolvable at parse time → left in place) stays intact: `specifierRaw` (§0.7 bucket-a) reads "is this an `Interpolated` node?" post-Tier-B instead of substring-scanning.
  - Byte-identity gate: the import fixture corpus (`__tests__/fixtures/import/*`, `import-*-byte-identity.test.ts`) moves with it and must stay byte-identical against the bridge oracle.

**(b) The `:extend` marker protocol — cross-family parse-time mutable state, must move ATOMICALLY.** `host-context.ts:242–285`: `ExtendMarker`/`extendMarker`/`isExtendMarker` + `ExtendTargetMarker`/`extendTargetMarker`/`isExtendTargetMarker` + `attachSelectorExtends`/`takeSelectorExtends` + the per-parse `ctx.selectorExtends` WeakMap. The protocol spans TWO builders: the **selector** builder (css-parser) recognizes `:extend()` and calls `attachSelectorExtends`; the **ruleset**/**extend** builder DRAINS the side table (`takeSelectorExtends`) onto the enclosing `Rule`. Today it lives in the shared `host-context` precisely so both families see it without a cross-family import — after relocation that shared home is gone.
  - **Disposition:** the markers + `selectorExtends` WeakMap live in **less-parser** (extend is Less-only), on the per-parse build context the parser threads. The **selector** builder is in css-parser; less-parser `extends` it (grammar inheritance), so less-parser's build context is where `attachSelectorExtends`/`takeSelectorExtends` are defined and the CSS selector builder's `:extend` recognition is an OVERRIDE in the less layer (CSS has no `:extend`, so the base css-parser selector builder never calls it — no coupling leaks into css-parser).
  - **Atomicity:** the selector-builder relocation (css-parser) and the extend-builder + marker relocation (less-parser) must land in ONE commit — the WeakMap producer (selector) and consumer (ruleset drain) cannot straddle two commits, or a mid-migration parse loses extend instructions. This is a single atomic cross-package step (Phase A3), never split.
  - The `Rule.extendInstructions` field the R1 serialize-time engine reads is unchanged (core-side); only the PARSE-time attach/drain moves.

**(c) trivia-decode + `declParts`/`sliceSpan` crossing the package boundary — the byte-identity risk.** `sliceSpan` (`ctx.src.slice`), `declParts` (decl byte-split), `selectorText` (raw selector recovery), `rulesetBodyWindow`, and the trivia log decode (`hasWhitespaceTriviaBefore`/`blockCommentTrivia`/`TRIVIA_STRIDE`/`TRIVIA_*`) encode EXACT span/trivia semantics that the byte-identity output depends on.
  - **Disposition:** these are parse-time span/trivia readers; they belong with the parser (which owns `ctx.src` and the parseman trivia log). But **do NOT assert "the legacy path already has equivalents" and drop them** — the legacy `buildNode` builds a DIFFERENT tree and may slice differently. Spec: port the span/trivia semantics VERBATIM into the parser's v2 build path first (same offsets, same trim rules, same `%%`/`;`/`:` handling), gate byte-identical, and only THEN reconcile against any legacy equivalent as a separate measured cleanup. `declParts`/`selectorText`'s byte-splits are bucket-(a) candidates (structure at the grammar) but that is Tier-B work — until then they port verbatim, not "trimmed."
  - Byte-identity gate: the span/trivia move is the highest-risk step; run the FULL census + nested-census + whole-doc driver after it, not just the family suite.

### 0.9 Tier-B (#6) is a HARD PREREQUISITE phase for the interpolation-bearing families

Sequencing law: **grammar emits structure → construction reads structured children → regex deleted. Never relocate a regex.** The interpolation-bearing families — `at-rules` (prelude), `custom-props` (name), and the import `@{}` specifier — CANNOT relocate cleanly until Tier-B grammar-structuring lands (the bucket-(a) kills in §0.7). Relocating them first would carry the `@media @{q}`/`@keyframes @{name}` misparse and the re-tokenizers across the package boundary — the opposite of the keystone.

Therefore **Phase A0 = Tier-B grammar-structuring** is a hard gate BEFORE those families move:
- A0 structures, in `grammar.ts` (css + less), the at-rule prelude, the custom-property name/value, and the import specifier as leaf-split/interpolation-bearing nodes — mirroring the existing `InterpolatedSelector`.
- Gate: the misparse fixtures (`@media @{q}`, `@keyframes @{name}`, `--@{k}: …`, `@import "@{theme}.less"`) now PARSE into structured children; the bucket-(a) regexes become dead code (still present, but unreached) — proven by the existing byte-identity corpus staying green with the regexes stubbed to `throw`.
- Only after A0 do `at-rules`/`custom-props`/import-`@{}` relocate (Phase A2/A3), reading structured children with NO regex. Bucket-(b)/(c) families and the non-interpolated builders may relocate WITHOUT waiting on A0.

### 0.10 HARD INVARIANT (owner) — no regex OUTSIDE Parseman's `regex()` combinator; builders are LEAN by design

The rule is NOT "zero runtime `RegExp`" — parseman by design does not lower some pattern shapes, so a `regex()` combinator may legitimately execute a real `RegExp` at runtime, and that is FINE because it lives inside `regex()`. `regex()` is the ONE sanctioned home for pattern-matching. The gate is: **no ad-hoc `.test()` / `.exec()` / `.match()` / `new RegExp` / `/…/`-literal in builder / action / host code.** All pattern-matching flows through the grammar's `regex()` combinators (or pure structural rules). Exceptions only if there is genuinely no other way — owner can't think of one; treat as essentially never.

Evidence (owner-reported): ~126 raw `RegExp` sites across the parsers today — **~95 in less-parser** (almost all in `builders.ts`, the LEGACY `BuilderHost`: byte-re-derivation one layer over — this reshape independently measured 63 raw-regex sites in `less-parser/src/builders.ts` alone), 19 scss, 9 css, 3 jess. These raw builder regexes are the violation (regex OUTSIDE `regex()`); the grammars' ~76 (less) / ~47 (css) `regex()` combinators are CORRECT even where they run a RegExp at runtime.

**Builders are LEAN by design.** A relocated `<family>/build` (parser-side) is THIN node-assembly from the grammar's already-structured children — no logic, no byte-scanning, no ad-hoc regex. **The yardstick for every relocated builder: if the builder is doing real work (tokenizing, splitting, classifying by pattern), the grammar UNDER-STRUCTURED — push the work into the grammar** as a `regex()` combinator or a structural rule so the builder stays a pure assembler. This is exactly why the bucket-(a) families (§0.7) block on Tier-B (§0.9): their builders can only go lean once the grammar hands over structure.

Folded into this plan:
1. **Relocated construction + Tier-B structuring express matching in the grammar, not the builder.** When a family relocates (§0.5) and when Tier-B structures the interp/prelude/custom-prop/decl shapes (§0.9), any pattern is a grammar `regex()` combinator or structural rule — the relocated builder does thin assembly only. Per family:
   - **at-rules (prelude), custom-props (name/value), import specifier** — Tier-B leaf-split/interpolation nodes are grammar rules + `regex()` combinators; the bucket-(a) re-tokenizers (§0.7) do NOT reappear as `.exec` loops in the builder.
   - **comments** — consume the parser's structured trivia log, no builder gap-scan.
   - **extend `!all`, charset, url()/`.css`/options (import resolution)** — bucket-(b): any pattern genuinely still needed becomes a grammar `regex()` combinator (point 4), never a ported builder `.test/.exec`.
   - **value-leaf / variables / mixin-call / mixins-def / value-expr** — read grammar-bounded children; any residual sigil/shape match is a `regex()` combinator in the grammar, not a builder strip.
2. **`less-parser/src/builders.ts` is a MAINTAINED leaning target, not "someone else's dying problem" (§0.11).** Some of its regex mass is legacy-tree construction that dies with the two-target seam (A4), but the CORE of it is the SAME disease as the parse-host smells and survives the cutover: the grammar matches coarsely (emits a value/prelude/selector-head as a string/span) and the builder RE-PARSES that string with regex. That is in-scope for the lean-builder gate, cured by the same grammar-owns-structure work — see §0.11. Its regexes are EXCLUDED from the per-phase gate only until the corresponding grammar-structuring lands for each shape; the exclusion is a sequencing convenience, not a verdict that `builders.ts` is out of scope.
3. **Acceptance gate — "no regex outside `regex()` on the maintained path":** grep the maintained builder/action/host/resolution files (NOT the grammar's `regex()` calls) for raw regex use:
   ```
   git grep -nE "\.(test|exec|match)\(|new RegExp|= */[^/ ]|: */[^/ ]" -- \
     <maintained v2 builder/host/resolve files> \
     ':!**/grammar*.ts' ':!**/__tests__/**' ':!packages/less-parser/src/builders.ts'
   ```
   MUST return empty. The exclusion of `grammar*.ts` is deliberate — `regex()` combinators live there and are SANCTIONED; the gate targets builder/action/host code. EXCLUDE the dying legacy `builders.ts` until A4 deletes it. Enforced PER PHASE — a phase that relocates a family and leaves a raw builder regex fails the gate. (Tune the file list to the actual v2 modules as they land; the principle is "builder/host/resolve code, minus the grammar.")
4. **Bucket-(b) "genuinely needed" patterns become grammar `regex()` combinators** — never ported as builder `.test/.exec`. If a classification (import `.css`-extension, `url()` unwrap) truly needs a pattern, it is a `regex()` combinator in the grammar/resolution layer (which MAY run a RegExp — that's sanctioned), consumed by a lean builder.

### 0.11 `builders.ts` — the fat-builder poster child (scope/target note, not a rewrite spec)

`packages/less-parser/src/builders.ts` (**3,281 lines, 70 raw-regex sites**) is the maintained less-parser builder and the single worst instance of the disease this plan targets. It is NOT a separate problem from the parse-host smells — it is the same one, one package over: **the macro-compiled grammar matches COARSELY (emits a value / prelude / selector-head as a string or span), and the builder RE-PARSES that string with regex to recover structure the grammar should have emitted.** The cure is identical to Tier-B and to the relocated-builder rule: push the fine structure INTO the grammar (as `regex()` combinators / structural rules) so the builder collapses to thin assembly.

This means **Tier-B (grammar-owns-structure) generalizes beyond `@{}` interpolation** — the grammar under-structures many shapes, not just interpolation. The builder-leaning of `builders.ts` is a PHASE of that same effort: coupled to the matching grammar change, byte-identity gated, subject to the §0.10 gate (no regex outside `regex()` in the builder). Scope it as such; do NOT treat it as post-hoc cleanup.

Highest-value grammar-structuring targets (the worst offenders — named to anchor the effort, NOT a line-by-line plan):

| Offender | Site(s) | Builder re-parse today | Grammar should emit |
|---|---|---|---|
| **Dimension re-split** | `943`, `2653` — `/^(\d+)([a-zA-Z]+|%)?$/.exec(authoredValue)` | splits a value string into number + unit | `Dimension{ value, unit }` as structured children |
| **Selector re-split** | `407` — `headText.match(/[#.][^#.>+~\s]*/g)` | re-splits a selector head into path segments | structured selector segments (the selector grammar already CAN — the asymmetry §0.7 names) |
| **@import prelude re-parse** | `2367` `/['"]([^'"]+)['"]/`, `2357/2427/2943` `/\bas\s+…/` | re-parses prelude for path / alias / options | typed prelude leaves (path node, `as`-alias, option list) |
| **Value-token re-classify** | `2525` `singleVarRe`, `2533` `escapedStrRe`, `2564` `varAccRe` | re-classifies a value token as var / escaped-string / var-access | typed value nodes (`VarRef` / escaped `Quoted` / `VarIndirect`/`MapAccessor`) from the grammar |

Each collapses its builder branch to a switch over structured children once the grammar emits the finer node — the same before/after as every §0.7 bucket-(a) kill. Proportionality: this note RECORDS `builders.ts` as in-scope for the parser-regex-free + lean-builder gate and names the four highest-value targets; the per-site sequencing rides the generalized Tier-B phase, gated per shape, not enumerated here.

### 0.6 What STAYS in core

Everything that OPERATES on the tree, plus the now-exported node defs:
- **Node defs + factories** — exported via the `/ast` leaf; internally co-located per §1 (`selector/node.ts`, `expr/node.ts`, …).
- **`engine/`** — `scope.ts` (Frame/lookups) + `emit.ts` (the serialize spine).
- **`value/`** — the whole value-algebra domain.
- **`expr/eval.ts`, `selector/{compose,canonical}.ts`, `rule/merge.ts`, `mixin/{dispatch,guard}.ts`, `extend/*` engine, `serialize`** — the family free-fns.

Only node CONSTRUCTION (the `parse-host/` folder in full) leaves. The family co-location in §1–§7 governs the residue.

---

## 1. File-by-file move map (core-resident tree)

### 1a. Flat engine files (`ast/*.ts`)

| Current | Lines | Target | Notes |
|---|---|---|---|
| `ast/node.ts` | 105 | `ast/node.ts` (unchanged) | Base `Node` union, `isNode`, `AST_NODE_TYPES`, `Combinator`, `renderCombinator`. Re-exported by the `/ast` leaf. §6 legacy-`N`/`Kind` duality lands here (tracked, not a move). |
| `ast/index.ts` | 60 | `ast/index.ts` (unchanged path) | The FULL internal surface (engine incl.). Distinct from the new `src/ast.ts` LEAF (node-only). Re-export target paths rewritten in-step; exported names stable. |
| `ast/nodes.ts` | 603 | **SPLIT across families** — see 1b. | Big split source. |
| `ast/at-rule.ts` | 52 | `ast/at-rule/node.ts` | + `{@link ../engine/emit}` breadcrumb. |
| `ast/serialize.ts` | 1899 | **SPLIT** → `engine/{scope,emit}.ts` + `expr/eval.ts` + `selector/compose.ts` + `rule/merge.ts` — see 1c. | The mega spine. |
| `ast/serialize-value.ts` | 40 | `ast/value/serialize.ts` | L1. |
| `ast/color.ts` | 138 | `ast/value/color.ts` | `serializeColor`, `HEX`/`RGB`/`HSL` (L1). |
| `ast/color-names.ts` | 33 | `ast/value/color-names.ts` | L0. |
| `ast/round.ts` | 17 | `ast/value/round.ts` | L0. |
| `ast/value-eval.ts` | 186 | `ast/value/seam.ts` | Runtime value seam (`ValueObj` union, `emitValue`/`isLiteral`/`literal`/`EvalModes`/`ValueEvaluator`). Resolves the duplicate `value-eval.ts` name. Optional later intra-`value/` split: pure data → `value/data.ts` (L0), evaluator iface → `value/seam.ts` (L4). |
| `ast/value-factory.ts` | 105 | `ast/value/factory.ts` | `make*`/accessor FROZEN seam (§6). |
| `ast/value-dispatch.ts` | 76 | `ast/value/dispatch.ts` | `createFnRegistry`/`FnRegistry` (L4). |
| `ast/value-operate.ts` | 165 | `ast/value/operate.ts` | L3. |
| `ast/value-guards.ts` | 76 | `ast/value/compare.ts` | Already exports `compare`/`typeCheck` (the `nativeGuardCmp→compare` symmetry is DONE). Rename → `compare.ts`, L3 sibling of `operate.ts`. |
| `ast/value-units.ts` | 47 | `ast/value/units.ts` | L0. |
| `ast/literal-tag.ts` | 201 | `ast/value/tag.ts` | Cross-cutting parse-classification seam → `value/` L0/L1. NOTE: `LiteralTag`/`LitFields` are `import type`-referenced by `nodes.ts::word()` — after co-location, `expr/node.ts` keeps that `import type` edge; it does NOT pull `value/tag.ts` into the `/ast` leaf runtime. |
| `ast/evaluator.ts` | 59 | `ast/value/evaluator.ts` | `buildEvaluator()` (L5). |
| `ast/functions/types.ts` | 72 | `ast/value/fns/types.ts` | `Fn`/`FnSpec`/… — the `value/fns/` registry home. |
| `ast/guard.ts` | 103 | `ast/mixin/guard.ts` | `evalGuard`/`GuardNode` — mixin condition tree (calls `value/compare` via the seam). |
| `ast/mixin-dispatch.ts` | 200 | `ast/mixin/dispatch.ts` | `bindArgs`/`selectDefinitions` — pure (non-recursive) selection. |
| `ast/extend.ts` | 15 | `ast/extend/index.ts` | The 15-line barrel. |
| `ast/extend/{ir,compose,match,plan,solve,emit}.ts` | — | unchanged (in-family) | Keep the 6 sub-modules — §1e. |

### 1b. `nodes.ts` (603) split by node family

Each interface travels WITH its factory const(s); all cross-references are `import type` (no runtime cycle — keep them `import type`).

| Node interface(s) + ctors | Target |
|---|---|
| `Word`+`word`, `Dimension`+`dim`, `SpacedValue`+`spaced`, `Sequence`+`sequence`/`concat`, `Operation`+`operation`, `FunctionCall`+`funcCall`, `Paren`+`paren`, `Interp`+`interp`/`InterpPart`, `VarRef`+`varRef`, `VarIndirect`+`varIndirect`, `DetachedRuleset`+`detachedRuleset`, `MapAccessor`+`mapAccessor`, `DetachedCall`+`detachedCall`, `ValueNode` union | `ast/expr/node.ts` (value-AST; holds `Interp`/`DetachedRuleset`/`MapAccessor` → carries `{@link ../engine/emit}`) |
| `Simple`+`simple`/`simpleInterp`, `Compound`+`compoundOf`/`compound`, `ComplexSegment`, `Complex`+`complex`/`sel`, `SelectorList`+`selist` | `ast/selector/node.ts` |
| `compoundCanonical`/`compoundHasInterp`/`compoundHasAmpersand`/`complexCanonical`/`complexHasInterp`/`complexHasAmpersand` (already free consts) | `ast/selector/canonical.ts` — pure move (already off the nodes). |
| `Declaration`+`decl`, `VarDeclaration`+`varDecl`, `Rule`+`rule`, `Param`, `Root`+`root`, `Statement` union | `ast/rule/node.ts` |
| `Comment`+`comment`, `RawInline`+`rawInline` | `ast/rule/node.ts` (Statement members). Flagged judgment call. |
| `StyleImport`+`styleImport` | `ast/at-rule/node.ts` (`@import` result, G5). |
| `MixinDef`+`mixinDef`, `MixinCall`+`mixinCall`, `PathSeg` | `ast/mixin/node.ts` (+ `{@link ../engine/emit}`) |
| `ExtendInstruction` | `ast/extend/node.ts` |

### 1c. `serialize.ts` (1899) split

| Symbols | Target |
|---|---|
| `Frame`/`EvalCtx`/`Emit` ifaces; `collectMixins`/`collectVars`/`collectRulesets`/`frameRulesets`/`asStacks`/`lookupMixinCandidates`/`lookupVar`/`resolveVarRef`/`withExcluded`/`makeResolver`/`makeTypedResolver`/`unresolvedRef`/`mergeVars` | `ast/engine/scope.ts` — extract FIRST (shared substrate). |
| `force`/`forceLiteral`/`evalTyped`/`evalValue`/`evalInterp`/`evalMapAccessor`/`evalCall`/`evalToDeclMap`/`resolveBaseDeclMap`/`joinBytes`/`evalBytes`/`evalBytesSync`/`stripOuterQuotes`/`DeclEntry` | `ast/expr/eval.ts` (mirrors `expr/build.ts` name) |
| `resolveSimpleText`/`resolveCompound`/`resolveComplex`/`composeOne`/`compose`/`ownStrings`/`rootStrings`/`parentToken` | `ast/selector/compose.ts` (string-form compose; declared dual vs `extend/compose.ts` branch-IR compose) |
| `groupHasMerge`/`mergeFold`/`emitMergedLine` | `ast/rule/merge.ts` (`mergeFold` takes an `emitOne` callback → no static dep back on `engine/emit`) |
| `serialize()` entry + `Position`/`SerializeOptions`/`SerializeResult`/`SerializeReturn`/`INDENT`/`mapMaybe`/`combineAll`; `Leaf`/`putValue`/`put`/`declName`/`reindentContinuations`/`valueEndsImportant`; `flatten`/`walkBody`/`flushBlock`/`emitLeaf`; `isCharset`/`emitHoistedCharset`/`emitAtRule*`/`emitRawInline`/`emitStyleImport`/`BUBBLEABLE_ATRULES`/`isBubbleable`/`emitBubbleBody`; `emitNested*`/`emitHoisted`; `dispatch`/`expandCall`/`expandDetachedCall`/`descendNamespacePath`/`captureArgDefFrames`/`publishMixins`/`detachedCallFrame`/`substituteDetachedVarArgs`/`expandNestedCall`/`expandNestedDetachedCall` | `ast/engine/emit.ts` — the ONE mutually-recursive statement-emit spine. `serialize()` public entry; `ast/index.ts` re-exports unchanged. |
| `composeStats`/`ComposeStats` | Stays in `engine/emit.ts` but per RESOLVED #4 must become a stats HOOK on the real walk — DESIGN FIX, not relocated to tests, follow-up (do NOT relocate during the mechanical move). |

`mixin/dispatch.ts` owns SELECTION; the `dispatch()`/`expand*` SPLICE stays in `engine/emit.ts` and CALLS `mixin/dispatch.selectDefinitions` — the accepted asymmetry, breadcrumb-mitigated.

### 1d. Build actions — RELOCATED, not co-located

Per §0.5 the `parse-host/actions/*.ts` do NOT become `<family>/build.ts` in core — they LEAVE for the parser packages. Core has no `build.ts` files; the family dirs are `node` + operate/emit free-fns only. This is the whole point of the keystone: construction is not a core concern.

### 1e. `extend/` reconciliation

`extend/` is already `ir/compose/match/plan/solve/emit` (6 cohesive modules). Blueprint RESOLVED #3 = keep cohesive, do NOT 4-way split. KEEP the 6 as-is (they're landed + gated). Add only `extend/node.ts` (`ExtendInstruction` from `nodes.ts`) + `extend/index.ts` (from the 15-line barrel). The `:extend` build/markers do NOT come here — they relocate to less-parser (§0.5).

---

## 2. Duplicate-name resolutions

| Collision | Resolution |
|---|---|
| `ast/value-eval.ts` (runtime seam) vs `parse-host/value-eval.ts` (blueprint-cited) | The parse-time file no longer exists on `origin/dev` (it's `actions/{value-expr,value-leaf}.ts`, now RELOCATING to the parser). Runtime seam → `value/seam.ts`. Collision fully dissolved. |
| `ast/extend.ts` vs `ast/extend/` vs `actions/extend.ts` | `ast/extend.ts` → `extend/index.ts`; `actions/extend.ts` → **less-parser** (relocated); sub-modules keep names. |
| `ast/at-rule.ts` vs `actions/at-rules.ts` | `at-rule/node.ts` (core) vs relocated builder (**css-parser**). |
| `ast/serialize.ts` vs `serialize-value.ts` vs `color.ts::serializeColor` | spine → `engine/emit.ts`; value serialize → `value/serialize.ts`; `serializeColor` inside `value/color.ts`. |
| `ast/mixin-dispatch.ts` (selection) vs `serialize.ts::dispatch()` (splice) | selection → `mixin/dispatch.ts`; splice → `engine/emit.ts`. |
| `ast/guard.ts` (mixin cond) vs `value-guards.ts` (compare) | `mixin/guard.ts` vs `value/compare.ts`. "guard" = mixin family only. |
| `actions/<family>.ts` vs `ast/<family>.ts` | Dissolved by relocation — builders leave core; no in-core name pair remains. |

---

## 3. `parse-host` disposition

Superseded by §0 — parse-host does not get renamed-in-core; it COLLAPSES. `dispatch-host`/`ACTION_LIST`/`host-context` plumbing dissolves into the parser packages' existing build infrastructure; `import.ts` → less-parser; `actions/*` → css-parser / less-parser per §0.5; `__tests__` harness → parser-side. Core ends with NO `parse-host/` directory and ZERO parser dependency.

---

## 4. `engine/` spine

`engine/scope.ts` (Frame/lookups) + `engine/emit.ts` (flat/nested walk + at-rule emit + mixin/detached splice + `serialize()` entry). Per-family free-fns (`selector/compose`, `rule/merge`, `expr/eval`, `mixin/{dispatch,guard}`, `extend/*`) STAY per-family and are CALLED by the spine (never call back, except `mergeFold`'s injected `emitOne`).

Breadcrumbs (MANDATORY): `at-rule/node.ts`, `mixin/node.ts`, `expr/node.ts` each carry `{@link ../engine/emit}`.

REQUIRED AMENDMENT (own gated commit, AFTER the mechanical split): `engine/emit.ts` is ~1100 lines with ~400 lines of PAIRED flat-vs-nested duplication differing on two axes (selector compose-to-string vs own-strings; indent/depth). The `e.collapse` boolean is already checked once — thread it through ONE monomorphic walker (no virtual dispatch, no registry); MEASURE unify-vs-keep byte-identical and RECORD the decision.

---

## 5. Import-rewrite strategy

**External surface after keystone:**
- The parser packages import `@jesscss/core/ast` (leaf). They STOP importing legacy `tree/` for the v2 path (legacy host retires on its own cutover track).
- `packages/core/src/value.ts` — still the only non-`ast` core importer of the value files; rewrite its 9 deep paths to `value/*` in the `value/` step.
- `ast/index.ts` (full surface) + the new `src/ast.ts` (leaf) — rewrite re-export target paths in-step; exported names stable, so no downstream churn.

**Batch order (each = one commit, byte-identity gated):**

*Phase A — keystone (cross-package):*
- **A0. Tier-B grammar-structuring (HARD PREREQUISITE for the interpolation-bearing families — §0.9; generalizes per §0.11).** Structure, in `grammar.ts` (css + less) as grammar rules + `regex()` combinators (§0.10 — pattern-matching lives in the grammar's `regex()`, never in a builder), the at-rule prelude, the custom-property name/value, and the import specifier as leaf-split/interpolation nodes mirroring `InterpolatedSelector`. Gate: the misparse fixtures (`@media @{q}`, `@keyframes @{name}`, `--@{k}: …`, `@import "@{theme}.less"`) parse into structured children; the bucket-(a) regexes are unreached (prove by stubbing them to `throw` with the byte-identity corpus staying green). **The same grammar-structuring effort extends to the `builders.ts` fat-builder offenders (§0.11: dimension re-split, selector re-split, prelude re-parse, value-token re-classify) — each a follow-on grammar change + builder collapse, byte-identity gated per shape.** Non-interpolated families (A2/A3 below) do NOT wait on A0.
- A1. Add `@jesscss/core/ast` leaf subpath + `src/ast.ts` + tsdown entry (re-exports today's `node`/`nodes`/`at-rule`). No behavior change; parsers not yet retargeted. Gate: build + existing suites green.
- A2. Stand up the parser-side v2 build path: add the ast v2 `buildNode` cases (or a v2 `BuilderHost`) in **css-parser** consuming `@jesscss/core/ast`; add the parser's public v2 entry (`parseCssToAst`). Move the CSS-base construction in — reading structured children, expressing any needed pattern as a `regex()` combinator (§0.10). The interpolation-bearing families (`at-rules`, `custom-props`) move only AFTER A0. Gate: the byte-identity/census harness (now driving the parser entry) byte-identical + the §0.10 no-regex-outside-`regex()` grep empty over the v2 builder/host files.
- A3. Extend the parser v2 path in **less-parser** (mixins/variables/value-ops; import-`@{}` after A0). **The `:extend` marker protocol relocation is ATOMIC (§0.8b): the css-parser selector builder's `:extend` recognition + the less-parser markers/`selectorExtends` WeakMap/drain land in ONE commit.** The `import.ts` resolution subsystem relocates here per §0.8a (state threaded through the parser entry, `%%`-splice preserved). Gate: byte-identical (incl. the moved import fixture corpus) + §0.10 no-regex-outside-`regex()` grep empty over the v2 builder/host/resolve files.
- A4. Delete `core/ast/parse-host/` entirely (dispatch-host, host-context, actions, import) AND — as the same cutover event — retire the legacy `BuilderHost`/`FunctionalParseHost` two-target seam, deleting the legacy-TREE construction in `builders.ts`. Re-verify `git grep "parseman|css-parser|less-parser"` over `packages/core/src` → EMPTY. Gate: full corpus byte-identical via the relocated harness; package graph acyclic (`parser → core` only). NOTE: A4 removes only the legacy-tree portion; the MAINTAINED `builders.ts` coarse-grammar/re-parse regexes (§0.11) survive the cutover and are retired by the generalized Tier-B grammar-structuring (A0-family), gated per shape — the §0.10 gate lifts its `builders.ts` exclusion shape-by-shape as each grammar change lands, reaching empty when the last offender collapses.

*Phase B — in-core family co-location (steps 1–10 of the residual):*
1. `engine/scope.ts` (extract Frame/lookups first).
2. `value/` (move all value-* / color / round / literal-tag / evaluator / serialize-value / functions; rewrite `value.ts` + `ast/index.ts` + `src/ast.ts`).
3. `expr/` (nodes value-AST slice + serialize eval slice).
4. `selector/` (nodes selector slice + canonical + compose slice).
5. `rule/` (nodes statement slice + merge slice).
6. `mixin/` (nodes mixin slice + mixin-dispatch + guard).
7. `at-rule/` (at-rule node + StyleImport).
8. `extend/` (ExtendInstruction node + barrel → index).
9. `engine/emit.ts` (residual serialize spine; delete emptied serialize.ts/nodes.ts).
10. (No build-host rename step — it's gone in Phase A.)

**Temporary barrels:** none for downstream (`/ast` leaf, `.` root, `/value` stay stable). The transient exception is `serialize.ts` draining across B1–B9 (re-imports its extracted pieces until B9 deletes it) — a shrinking file, not a barrel.

**Byte-identity gating:** the harness (bridge/census/nested-census/atrule/extend/guard/import/value byte-identity + the whole-doc driver) compares parse→serialize output byte-for-byte vs the bridge oracle across the corpus. Run after EVERY step. Phase A steps run it against the RELOCATED parser entry; Phase B against the core engine. Any non-identical byte = botched step, fix before proceeding.

---

## 6. `provenance.ts`

Blueprint wants the dropped source-span seam RESTORED as `ast/provenance.ts` (`sourceSpanOf`/`setSourceSpan` WeakMap), GATED (RESOLVED #7) mirroring the `trackPositions` gate. After the keystone, the WRITER is the PARSER (it holds the spans) — it calls `setSourceSpan` (imported from `@jesscss/core/ast`, where `provenance.ts` sits as a leaf peer) under a diagnostics/sourcemap gate. FOLLOW-UP (new code + measurement, not a move): add `ast/provenance.ts`, export via the leaf, wire the parser to write under the gate, measure the per-node WeakMap-write cost, decide always-on vs consumer-gated. Sequence after Phase B, alongside the `engine/emit` unify measurement.

---

## 7. Execution shape

**ONE coordinated quiet-tree window, staged: Phase A (keystone, cross-package) THEN Phase B (in-core co-location).**

- **Phase A is the master move and goes FIRST** — it's cross-package, cycle-breaking, and touches the parser packages + core's `parse-host/`. Doing it before B means B operates on a smaller, parser-free core tree.
- **Staged, not atomic:** a 35-file + cross-package mega-commit is unreviewable/un-bisectable. Each step is independently byte-identity-gated → a regression has a 1-family/1-package blast radius.
- **Not parallel family agents:** the shared drains (`nodes.ts`/`serialize.ts`/`ast/index.ts`/`src/ast.ts` + each parser's `buildNode`) are touched in nearly every step; serialize on ONE branch, one executor (or strictly serialized worktrees). Parallel agents would stomp the shared files.
- **Quiet tree:** corpus-wide + cross-package → land with no other in-flight `ast/` or parser-builder work.

**Sequence vs the in-flight mixin-recursion feature:** the keystone relocates the mixin BUILDERS (`mixins-def`/`mixin-call`) and the co-location moves `mixin/dispatch`+`engine/emit`'s splice — the exact surface a mixin-recursion feature edits. **Land the mixin-recursion feature FIRST (or explicitly quiesce it), THEN run this reorg.** Running concurrently guarantees collisions on `mixin-*` + `engine/emit`. If the feature is mid-flight, gate the reorg behind its merge; do not interleave.

**Per-step gate (uniform):** (1) `git mv` / slice / relocate; (2) rewrite imports in-step (intra-family, `ast/index.ts`, `src/ast.ts`, `value.ts`, parser `buildNode`); (3) `pnpm -r build` (parsers → core; vitest runs against `lib/`); (4) byte-identity + census suites → MUST be byte-identical; (5) **Phase-A steps additionally: the §0.10 no-regex-outside-`regex()` grep MUST be empty over the maintained v2 builder/host/resolve files (grammar `regex()` calls sanctioned; dying legacy `builders.ts` excluded until A4 deletes it)**; (6) commit (noreply identity). Green-only advance.

**Acceptance criteria (whole reorg):** (a) full corpus byte-identical; (b) package graph strictly `parser → core`, `git grep "parseman|css-parser|less-parser"` over `packages/core/src` empty; (c) §0.10 no-regex-outside-`regex()` grep empty over ALL maintained builder/host/resolve files — all pattern-matching in grammar `regex()` combinators (legacy `builders.ts` deleted); (d) the relocated harness declares its parser dep parser-side, never re-added to core.

**Atomicity constraints (never split across commits):** the `:extend` marker producer+consumer (§0.8b, A3); the import subsystem + its fixture corpus (§0.8a, A3); the span/trivia semantics move (§0.8c) lands with the FULL census run, not just a family suite.

**Two post-reorg gated commits (behavior-shaping, measured):** (a) `engine/emit.ts` monomorphic-walker unify; (b) `provenance.ts` restore. Plus the RESOLVED #4 `composeStats`-as-hook design fix. Explicitly NOT part of the mechanical move.

---

## Final target (post-reorg)

**core** (`@jesscss/core`) — no `parse-host/`, no parser dependency:
```
core/src/
  ast.ts                 ← NEW leaf barrel (@jesscss/core/ast): node defs + factories only
  ast/
    node.ts  index.ts  provenance.ts(follow-up)
    value/    seam.ts factory.ts operate.ts compare.ts units.ts round.ts
              color.ts color-names.ts serialize.ts tag.ts dispatch.ts evaluator.ts fns/types.ts
    expr/     node.ts eval.ts
    selector/ node.ts canonical.ts compose.ts
    rule/     node.ts merge.ts
    mixin/    node.ts dispatch.ts guard.ts          {@link ../engine/emit}
    at-rule/  node.ts                               {@link ../engine/emit}
    extend/   node.ts index.ts ir.ts compose.ts match.ts plan.ts solve.ts emit.ts
    engine/   scope.ts emit.ts
    __tests__/  engine-level (serialize/eval on hand-built roots)
```
**parsers** (`css-parser` / `less-parser` / `jess-parser`) — own node CONSTRUCTION, import `@jesscss/core/ast`:
```
css-parser/src/   builders.ts (v2 buildNode: ruleset/selector/value/comments/custom-props/at-rules/charset) + parseCssToAst
less-parser/src/  builders.ts (extends: mixins/extend/variables/interp) + import-resolve + :extend markers + parseLessToAst
  (+ the relocated parse→root byte-identity/census/differential harness)
```
Package graph: **parser → core** (acyclic). The `FunctionalParseHost` callback retires with legacy `tree/`.
