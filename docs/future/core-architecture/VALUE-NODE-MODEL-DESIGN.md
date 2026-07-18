# Value / Literal Node Model — `Word` Elimination (task #44)

DECIDED design spec. Base: `origin/dev`. Scope: `packages/core/src/ast/` value
literals + their producers (`parse-host/actions/`) and consumers (`serialize.ts`,
`mixin-dispatch.ts`, `custom-props.ts`, `value-*.ts`, `import.ts`). This is the
`VALUE-NODE-MODEL-DESIGN.md` the `GRAMMAR-RELOCATION-DESIGN.md` §0/§6 "PENDING #44"
sites are blocked on. Sequel to `UNIFIED-NODE-MODEL-SPEC.md` (which deferred the
literal reshape) and `VALUE-LITERAL-TAG-SPEC.md` (which this doc RETIRES — the tag
becomes the node `type`).

Goes straight to adversarial review then implementation. Corners left genuinely
open are marked **OPEN(owner)**; everything else is decided.

## 0a. Review corrections — AS SHIPPED (these OVERRIDE the body below)

Adversarial review corrected five points; the implementation (task #44, `ast/`
only) shipped per these, which supersede any conflicting statement in §1–§6:

1. **CORR-1 — builders.ts DECOUPLED (scope).** §3.2 is NOT part of #44.
   `less-parser/src/builders.ts` holds legacy `tree/` node classes, decoupled from
   this `ast/` reshape; they belong to separate bridge-gated BuilderHost-retirement
   work (reorg A4). #44 touches `ast/` ONLY. The `ast/` differential (`renderAstFile`,
   NOT the bridge) is the gate: **MATCH 39 / MATCH_NORM 1 / DIFF 47 / THREW 1**,
   byte-identical before and after.
2. **CORR-2 — barrel collision (`ast/index.ts`).** `export * from './nodes.js'` now
   re-exports the AST literal interfaces `Keyword`/`Color`/`Quoted`, which share
   names with the value-domain re-exports from `./value-eval.js`. Resolution: an
   EXPLICIT re-export wins over a star re-export in ES/TS, so the value-domain types
   are what the public barrel surfaces under those names; the AST literal node
   interfaces stay OFF the public value barrel. Internal `ast/` code that needs an
   AST literal node type imports it DIRECTLY from `./nodes.js` (or narrows a
   `ValueNode`), never via the barrel — never via an ambiguous `t2.Quoted`. The
   lowercase CONSTRUCTORS (`keyword`/`color`/`quoted`/`any`/`dimension`) don't
   collide and remain surfaced. Documented in a comment at the star-export.
3. **CORR-3 — 6 ADDED migration sites** beyond §4's 23: `serialize.ts` map/each
   keys (`word(name)`/`word(n.name)` → `any(name)`, 4 sites) and `mixin-dispatch.ts`
   `@rest`/`@arguments` joined fragments (`word(...)` → `any(...)`, 2 sites). Plus
   `guard.ts` `word(lv)` → `any(lv)`.
4. **CORR-4 — NO ast `Bool` node.** DROP the §1 `Bool` row: there is no AST `Bool`
   node, no `bool()` constructor, and `'Bool'` is NOT in the `ValueNode` union /
   `AST_NODE_TYPES`. `true`/`false` build a `Keyword` leaf; guard-context booleanness
   is recovered downstream via the value-domain `Bool` produced by the materialize
   SNIFF (the guard-truthiness test reads `.bytes === 'true'`, identical for a
   `Keyword` or a value-domain `Bool`). Value-domain `Bool` (an eval RESULT) stays.
5. **CORR-5 — inert lane invariant.** The inert `evalValue` / materialize arms MUST
   return `literal(node.src)` — a BARE STRING — never the node object. An AST literal
   node must not leak into the `Value = ValueObj | string` lane, else a downstream
   `v.type === 'Color'` would misread it as a value-domain object missing its rgb
   fields. Enforced explicitly in the inert arms.

**Node set as shipped:** `Keyword{src}` · `Color{src}` (hex vs named via
`src[0]==='#'`) · `Quoted{src,value,quote,escaped}` · `Dimension{number,unit,src}` ·
`Any{src}` (the only sniffing leaf, only when operated). `RawInline` stays a distinct
`Statement` (its `.text` was left as-is — the optional `src` rename skipped). The
materialize per-type build bodies (`colorFromSrc` / `dimensionFromFields` /
`quotedFromFields`) live in `literal-tag.ts`; `materializeAny` (no-trim) + `sniffLiteral`
(trim) are the sole sniff paths; the `LiteralTag` enum / `LitFields` / packed-tag
contract / `materializeLiteral(str,tag,lit)` signature are DELETED.

## 0. The problem in one sentence

A single `Word` node carries a *value literal of any type* (`10px`, `#fff`, `red`,
`"x"`, `true`, `solid`) plus arbitrary raw bytes (`url(...)`, a computed fragment,
a prelude chunk), announcing its real value type only through a side-car
`tag?: LiteralTag` field. **A `Word` that is "really a Dimension" is dishonest.**
Parse leaves that ARE value literals must carry their value type in the node `type`.

## 1. Decided node set (post-`Word`)

`Word` is **eliminated** (not renamed). Its two distinct roles split into honest
nodes. The value-literal `type` strings **reuse the value-domain names**
(`value-eval.ts`: `Keyword`/`Color`/`Dimension`/`Quoted`/`Bool`) — no parallel
names invented. The raw/arbitrary role uses tree/'s established **`Any`** (=
less.js `Anonymous`; NOT a new `Raw`/`Anonymous`).

Every literal node carries its **verbatim source spelling** in a field named
**`src`** (NOT `bytes` — see §1.1) and a discriminant `type`. Type-specific
pre-parsed fields (promoted from today's `LitFields`) ride alongside so a forced
(operated) literal materializes by reading FIELDS, never re-splitting `src` with a
regex (constitution P0). The `ValueNode` union member `Word` is replaced by:

| `type` | Fields (all `readonly`) | Carries | Inert emit | Forced (operated) → value-domain |
|---|---|---|---|---|
| `Keyword` | `src` | ident bytes (`solid`, `auto`) | `src` | `makeKeyword(src)` |
| `Dimension` | `src`, `number`, `unit` | numeric literal (`10px`, `1.0px`, `50%`, `5`) | `src` | build value `Dimension` from `number`/`unit` (denoise exception §2.3) |
| `Color` | `src` | hex or named (`#fff`, `red`, `transparent`) | `src` | `#`-prefix ⇒ `parseHex`; else `namedColor(src)`; miss ⇒ keyword |
| `Quoted` | `src`, `value`, `quote`, `escaped` | string literal (`"x"`, `'y'`) | `src` | build value `Quoted` from the fields |
| `Bool` | `src` | `true`/`false` (Less) | `src` | `{ value: src === 'true' }` |
| `Any` | `src` | arbitrary/opaque bytes (raw prelude fragment, computed/joined fragment, `url(...)`, list piece, mixin-arg bytes) | `src` | **sniff** (`tagForWord(src)` + build) — the ONLY sniffing node |

Constructors (in `nodes.ts`, replacing `word` / `dim`):

```ts
export const keyword = (src: string): Keyword => ({ type: 'Keyword', src });
export const any     = (src: string): Any     => ({ type: 'Any', src });
export const bool    = (src: string): Bool     => ({ type: 'Bool', src });
export const color   = (src: string): Color    => ({ type: 'Color', src });
export const dimension = (number: number, unit = '', src = `${number}${unit}`): Dimension =>
  ({ type: 'Dimension', number, unit, src });
export const quoted  = (src: string, value: string, quote: string, escaped: boolean): Quoted =>
  ({ type: 'Quoted', src, value, quote, escaped });
```

The `ValueNode` union drops `Word` and gains `Keyword | Color | Quoted | Bool | Any`
(`Dimension` already listed). `RawInline` is UNCHANGED and does NOT collapse into
`Any` — see §1.2.

### 1.1 Why `src`, not `bytes` — the discriminant-collision guard

The value-domain objects (`value-eval.ts`) and these AST literal nodes now **share
`type` strings** (`Dimension`/`Color`/`Quoted`/`Keyword`/`Bool`). `node.ts` already
tolerates this for `Dimension` via the **lane invariant** (a `ValueObj` never enters
the AST-build lane; never form a `Node | ValueObj` union) and documents a structural
escape hatch: value objects carry `bytes`, AST nodes did not.

Adding `Color`/`Quoted`/`Bool`/`Keyword` to `AST_NODE_TYPES` widens that collision.
To KEEP the escape hatch working, AST literal nodes name their verbatim field
**`src`**, so **`'bytes' in v` still uniquely identifies a value-domain object** and
`'src' in v` uniquely identifies an AST literal. `isNode` stays membership-based
(unchanged); the lane invariant remains the primary guard, `src` vs `bytes` the
cheap secondary disambiguator. Update the `AST_NODE_TYPES` doc comment to name all
five shared strings and the `src`/`bytes` split.

**OPEN(owner):** if you'd rather collapse to `bytes` on both sides and rely on the
lane invariant ALONE (dropping the structural escape hatch), that is a one-field
rename from this design. Recommendation: keep `src` — it is honest ("verbatim
source spelling" vs. value-domain "canonical emitted bytes" are genuinely different
concepts: `1.0px` `src` vs `1px`-canonical `bytes`) and costs nothing.

### 1.2 `RawInline` stays — it is NOT `Any`

`RawInline` is a **`Statement`**, not a `ValueNode`: verbatim raw bytes produced by
`@import (inline)`, spliced unparsed at the import site, carrying no value semantics
and never materialized. `Any` is a value-leaf (arbitrary VALUE bytes that may be
forced onto the typed path via sniff). Different unions, different roles. Keep both.
(`RawInline.text` is left as-is; renaming it to `src` for consistency is a trivial
optional follow-up, not required by #44.)

## 2. Materialization — MEASURED eager-vs-lazy verdict: **LAZY**

### 2.1 What "eager vs lazy" means here

The node ALWAYS carries `src` + pre-parsed fields (`number`/`unit`, `value`/`quote`/
`escaped`) eagerly at build — those are the parser's honest classification, cheap
scalars, no derived allocation. The question is only whether the **value-domain
object** (rgb triple + canonical `bytes`, unit multiset, `Quoted` wrapper) is:

- **eager:** built once at parse/build for every literal node, or
- **lazy:** built on first value-access (`materialize`) for the ~operated subset,
  leaving inert literals as bare `src` strings in the eval lane (rep "B",
  `value-eval.ts`).

### 2.2 The measurement (real `benchmark.less` through `ast/`)

Instrumented `materializeLiteral` / `tagForWord` / the inert `evalValue` `Word`
arm; rendered the real `packages/jess/benchmark/benchmark.less` through the
whole-document `ast/` driver (`renderAstFile`), 3-render warmup, then one
counted render + a 25-render median. Node v22, same worktree.

| Metric | Value |
|---|---|
| Full render median | **48.3 ms** (source 106 802 B → CSS 130 964 B) |
| Inert literal touches (emit `src`, never materialized) | **5 068** |
| `materialize` calls (operated / compared / typed-param) | **3 657** |
| `tagForWord` synthetic sniffs (the `Any`-path) | **819** |
| **Total time inside `materializeLiteral`** | **0.32 ms** |
| Materialize share of full render | **0.66 %** |
| Inert fraction of literal touches | **58 %** |

(The "~98 % inert" figure in the `value-eval.ts` comment counts distinct source
literals / a lighter corpus; `benchmark.less` is deliberately arithmetic-dense and
re-expands the SAME literal node many times through mixins/loops, so per-RENDER
touches skew toward materialize. The verdict is robust either way — see §2.4.)

### 2.3 Verdict: LAZY (keep zero-cost-when-inert)

**Lazy wins decisively. Do not build value-domain objects eagerly.** Reasoning
from the numbers, not assertion:

- Lazy materialization is **0.66 % of render (0.32 ms)** — noise. There is no
  render-time prize to win by moving it to build.
- Eager would **not even save that 0.32 ms fully**: (a) the 5 068 inert touches
  STILL emit `src` verbatim (a pre-built value object doesn't shortcut inert emit),
  and (b) re-expansion (mixins/loops) re-reads per render regardless.
- Eager **costs more**: at the measured 0.087 µs/materialize, eagerly building all
  8 725 literal touches ≈ **0.76 ms** (worse than 0.32 ms) AND allocates ~8 725
  typed objects — 58 % of which are never used as objects — destroying the
  bare-`string` inert property (rep "B") that keeps the common path allocation-free
  and GC-quiet. Per `memory:feedback-total-cost-and-lazy-computation`, adding
  build-time cost + allocation to save a sub-1 % phase is a reject.

**The visitor-facing shape may still be lazy even though the node isn't** (owner
steer): the node eagerly holds honest `type` + scalar fields; the *derived value*
is lazy. `materialize` stays the single seam, now **node-driven** (a `switch` on
`node.type` reading node fields) instead of `(bytes, tag, lit)`-driven.

### 2.4 Robustness

If a real-world corpus is 98 % inert (the lighter case), eager is EVEN worse
(more wasted allocations, larger inert majority stranded as objects). If a corpus
is 100 % operated, lazy degrades to eager's work with no penalty (materialize runs
once per touch either way) minus the wasted-allocation risk. Lazy dominates or ties
across the whole spectrum. **No eager prototype is warranted** — the break-even is
underwater at every mix.

## 3. Producer flip — exact construction sites

### 3.1 `ast/` direct host (the real target) — `parse-host/actions/value-leaf.ts`

This is where the honest typed literals are BORN. Current `VALUE_LEAF_ACTIONS`
build `t2.word(bytes, tag, lit)`; each flips to its typed constructor:

| Grammar rule | Current (`value-leaf.ts`) | New node |
|---|---|---|
| `Numeric` (`numericLeaf`, :66/:74) | `word(bytes, Dimension, {number,unit})` | `dimension(number, unit, /*src=*/bytes)` — the grammar's number/unit leaf split feeds `number`/`unit` directly |
| `Color` (:178) | `word(bytes, ColorHex)` | `color(bytes)` |
| `NamedColor` (:181) | `word(bytes, ColorNamed)` | `color(bytes)` (materialize resolves by name; grammar already authoritative it's a color) |
| `Keyword` (:183) | `word(bytes, Keyword)` | `keyword(bytes)` |
| `Quoted` (`quotedLeaf`, :150) | `word(bytes, Quoted, {value,quote,escaped})` | `quoted(bytes, value, quote, escaped)` (interp branch unchanged → `Interp`) |
| `EscapedValue` (`escapedLeaf`, :170/:172) | `word(inner)` / `word(bytes)` | `any(inner)` / `any(bytes)` (escaped, unquoted-output, opaque) |
| `Url` (:188) | `word(bytes)` untagged | `any(bytes)` (verbatim, no coercion) |
| Bool | (today reaches via untagged `word('true')`; grammar has no `Bool` leaf) | **OPEN(owner):** add a `Bool` leaf action, or leave `true`/`false` as `Keyword` and let guard/logic materialize? Less treats bare `true`/`false` as keywords except in guard context. Recommendation: emit `Keyword`; introduce `Bool` node only where the grammar/guard actually knows it's boolean (guard.ts). See §4. |

Every other `t2.word(...)` call in `parse-host/actions/` is UNTAGGED raw bytes →
**`any(...)`** (mechanical rename, same bytes):
`at-rules.ts` (:155,:182,:186,:220,:231,:240,:244,:245),
`control-flow.ts` (:157), `custom-props.ts` (:120,:129,:212,:225,:233,:237,:267,
:288,:310,:351), `guard.ts` (:87), `interp.ts` (:93), `mixin-call.ts` (:44),
`mixins-def.ts` (:119,:167), `value-expr.ts` (:96,:129 `/`-marker,:190,:192,:225),
`variables.ts` (:63,:116,:118,:120). These are the `Any` role by construction.

### 3.2 Legacy bridge producer — `less-parser/src/builders.ts` (the GRAMMAR-RELOCATION "PENDING #44" set)

`GRAMMAR-RELOCATION-DESIGN.md` enumerates the legacy `BuilderHost` sites that
construct value literals and are blocked on this doc's field shape. They flip to
the SAME node set. This is `builders.ts` (less.js bridge), constructing `ast/`
nodes for the bridge path:

| `builders.ts` site(s) | Constructs | New node |
|---|---|---|
| `:943` `_buildDeferredScalarDeclaration` number+unit re-split | number+unit | `dimension(number, unit, src)` |
| `:2653` `_buildAtRulePrelude` number+unit | number+unit | `dimension(...)` |
| `:2615` aspect-ratio `n/d` | ratio | `Dimension`/list per ratio decision (verify vs grammar ratio child) |
| `:1488` division-like detection | math routing | folds into value grammar; no literal node |
| `:2533` `escapedStrRe` (+ `:2535,:2595,:2641`) | `~'…'` escaped | `any(inner)` (unquoted-output) or `quoted(..., escaped:true)` per §3.1 EscapedValue |
| `:2543` `/^(['"])([\s\S]*)\1$/`, `:2605` paren | quoted / paren | `quoted(...)` / `Paren` |
| `:2340`,`:2367`,`:2934` quoted import path | path string | `quoted(...)` (typed path leaf) |
| `new Color` `:486` | color literal | `color(src)` |
| `new Quoted` `:219`,`:457`,`:724`,`:1270`,`:1327`,`:1343` | quoted literal | `quoted(...)` |
| accessor-KEY `new Quoted` `:349`,`:3227` | accessor-key quoted | `quoted(...)` |

The GRAMMAR-RELOCATION doc labels the true footprint **"≥14, a FLOOR not exact"**;
this design is the field shape those sites bind to. Per that doc's §6 sequencing,
the coupled cluster **S5** (grammar value-terminal reshape + `builders.ts`
L1/L2/L3 rewrite + `nodes.ts` literal reshape) lands as **ONE commit** with #44,
gated on the `ast/` differential — do not rewrite these twice.

## 4. Migration map — every `Word`-reference site (23 non-test node-token sites)

Grep basis (non-test): `git grep -E "\bword\(|'Word'|: Word|type === 'Word'"`.
Add two accessors to `nodes.ts` to keep consumers terse:

```ts
// A value literal that emits its src verbatim when inert (all six literal types).
export const isLiteralNode = (n: ValueNode): n is Keyword|Color|Dimension|Quoted|Bool|Any =>
  n.type === 'Keyword' || n.type === 'Color' || n.type === 'Dimension'
  || n.type === 'Quoted' || n.type === 'Bool' || n.type === 'Any';
// A literal whose VALUE TYPE the parser knows (everything except opaque `Any`).
export const isTypedLiteral = (n: ValueNode): boolean => isLiteralNode(n) && n.type !== 'Any';
```

| Site | Current | Migrates to |
|---|---|---|
| `node.ts:52`, `:94` NodeType union + `AST_NODE_TYPES` | `'Word'` | drop `'Word'`; add `'Keyword'`,`'Color'`,`'Quoted'`,`'Bool'`,`'Any'` (`'Dimension'` already present). Update collision doc-comment (§1.1). |
| `nodes.ts:47-52` `Word` interface, `:579` `word()` | `Word`/`word` | delete; add the six literal interfaces + constructors (§1). `dim()` → `dimension()`. |
| `serialize.ts:661-664` `evalTyped` `Word` arm | `forceLiteral(e, node.text, node.tag ?? tagForWord(node.text), node.lit)` | one arm per literal type: `Keyword`→`makeKeyword`; `Dimension`→build from `number`/`unit`; `Color`/`Quoted`/`Bool`→build from fields; `Any`→`forceLiteral(e, node.src, tagForWord(node.src))` (sniff). `forceLiteral`'s signature drops `tag`/`lit`. |
| `serialize.ts:693-694` `evalValue` `Word` inert arm | `return literal(node.text)` | one inert arm returning `literal(node.src)` for each literal type (or a shared `isLiteralNode` fast arm). Delete the separate `:695-696` `Dimension` arm (folded in). |
| `serialize.ts:886`, `:2005` `base.type === 'Word'` (map/each base = a bare selector word) | `base.text` | `base.type === 'Any' \|\| base.type === 'Keyword'` → `base.src` (a namespace/selector base is opaque bytes or an ident). Verify with the ns-accessor / each fixtures. |
| `serialize.ts:1749` leak snapshot `Word && tag !== undefined` | tagged-Word by-ref | `isTypedLiteral(v)` by-ref; else snapshot to `any(bytes)` (`:1754` `word(b)` → `any(b)`). |
| `serialize.ts:2006`,`:2010`,`:2011` each-split `word(...)` | synthetic list pieces | `any(...)`. |
| `serialize.ts:2036`,`:2847` `dim(i+1)` each-index | AST `Dimension` | `dimension(i + 1)`. |
| `serialize.ts:2258` extend `word(combined)` | synthetic | `any(combined)` (+ update the `positions` `type: 'Word'` tag → `'Any'`). |
| `mixin-dispatch.ts:151`,`:166` `Word && tag !== undefined` | tagged-Word by-ref | `isTypedLiteral(v)`. |
| `mixin-dispatch.ts:152`,`:167` `word(resolve...)` | flatten to bytes | `any(resolve...)`. |
| `mixin-dispatch.ts:172` `v.type === 'Word' ? v.text : ''` | arg bytes | `isLiteralNode(v) ? v.src : ''`. |
| `custom-props.ts:128-129` `stripImportantBytes` | `v.type === 'Word'` → `word(strip(text))` | `isLiteralNode(v)` → `any(stripImportant(v.src))`. |
| `custom-props.ts:159` `consumableWholeValue` | `k === 'Word' \|\| …` | `isLiteralNode(node) \|\| k === 'VarRef' \|\| …`. |
| `custom-props.ts:187` `resolvesDifferently` | `!== 'Word' && !== 'Dimension'` | `!isLiteralNode(node)` (all literals emit `src` verbatim — strictly more correct). |
| `custom-props.ts:120`,`:212`,`:225`,`:267`,`:288`,`:310`,`:351` `word(...)` | raw fragments | `any(...)`. |
| `import.ts:568-569` `isWordNode` | `type === 'Word'` | `isLiteralNode` (or narrow to `'Any'`/`'Keyword'` at the call site — check what it guards; it tests a built value node's rawness). |
| `control-flow.ts:207` `inner.type === 'Word' && inner.text === ''` | empty-arg check | `isLiteralNode(inner) && inner.src === ''`. |
| all remaining producer `t2.word(...)` (§3.1 list) | untagged | `t2.any(...)`. |

### 4.1 What gets DELETED

- `Word` interface + `word()` constructor (`nodes.ts`).
- `LiteralTag` enum, `LitFields` type, `LIT_TAG_MASK`/`LIT_ALREADY_MINIMAL`,
  `materializeLiteral(str, tag, lit)` **signature** (becomes node-driven
  `materialize(node)` — the per-type build bodies (`parseHex`, `namedColor`,
  `dimensionFromString`, `quotedFromBytes`) survive, re-homed). `LiteralTag` was
  the core↔parser tag contract; with the parser emitting typed nodes it dissolves.
- `index.ts:59` re-export of `LiteralTag`/`materializeLiteral`. Keep `tagForWord`/
  `sniffLiteral` — the `Any`-sniff path still needs them.
- `dim()` → `dimension()` (rename; the AST `Dimension` node's `value` field → `number`,
  add `src`, aligning with the value-domain field name).

### 4.2 External contract — untouched

The only external contract is the less-compat bridge / fns via `@jesscss/core/value`.
Fns consume **value-domain `ValueObj`** (`materialize` OUTPUT), never AST literal
nodes, so their signatures are unaffected. The differential-oracle bridge test
(`parse-host/__tests__/bridge.ts`) references `LiteralTag`/`'Dimension'`/`'Num'`;
it is a TEST (internal), freely updated to the node set
(`memory:no-sacred-test-expectations`). The `bridge.ts` `'Num'` alias dies with the
tag.

## 5. Naming-honesty check (§ from the task)

- No node exists merely to announce "what it really is." `Dimension` IS a
  Dimension; `Color` IS a Color. The discriminant carries the value type honestly.
- `Any` is NOT a "really-an-X" announcer — it is a genuine semantic ("value type
  unknown / arbitrary opaque bytes", = less.js `Anonymous`). It sniffs on the
  operated path precisely BECAUSE its type is honestly unknown.
- The `tag?: LiteralTag` side-car (the dishonest "this Word is really a Dimension"
  signal) is gone: the type IS the node type.
- `src` (verbatim source spelling) vs value-domain `bytes` (canonical emitted) is
  an honest distinction, not a rename dodge.

## 6. OPEN(owner) items

1. **`Bool` leaf (§3.1).** Emit a `Bool` node at parse, or keep `true`/`false` as
   `Keyword` and only mint `Bool` in guard/logic context where booleanness is known?
   Recommendation: `Keyword` at the value leaf; `Bool` only where the grammar/guard
   knows. (Less: bare `true` in a value position is a keyword.)
2. **`src` vs `bytes` field name (§1.1).** Keep `src` (preserves the `'bytes' in v`
   escape hatch; honest source-vs-canonical distinction) or collapse to `bytes` and
   rely on the lane invariant alone? Recommendation: keep `src`.
3. **`Color` hex-vs-named discriminator (§1).** Materialize distinguishes by
   `src[0] === '#'` (one char, lazy path only). Acceptable, or carry an explicit
   `named` flag to fully honor P0? Recommendation: `#`-prefix check — it reads one
   byte on the cold operated path, not structural re-derivation.
4. **`RawInline.text` → `src` (§1.2).** Rename for field-name consistency, or leave?
   Non-blocking; recommend a trivial follow-up rename, not part of #44.
5. **Sequencing (owner-settled elsewhere, restated).** Per
   `GRAMMAR-RELOCATION-DESIGN.md` §6, the `builders.ts` §3.2 sites land in the SAME
   commit as the `nodes.ts` reshape + grammar value-terminal relocation (cluster
   S5), gated on the `ast/` differential. The `ast/` `value-leaf.ts` producer flip
   (§3.1) + the §4 consumer migration are the core of that commit.
```
