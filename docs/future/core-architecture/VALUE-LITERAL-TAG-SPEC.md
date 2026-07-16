# IMPLEMENTATION SPEC — Value-literal type tag (NODE-SLIM-FOLLOWONS Question 1)

**Status:** buildable blueprint. Read-only study; no code changed. Sequenced AFTER the
D-EVAL flip + mandated post-flip re-profile (dependency noted, not a gate). Shape is
settled per `NODE-SLIM-FOLLOWONS.md` §Question 1 — this spec executes it, it does not
re-open it.

## 0. What the code does today (grounding)

**Producer builds eager literal nodes.** `cssRecursiveParser.processValueToken`
(`packages/css-parser/src/cssRecursiveParser.ts:590`) is the single hot factory. From one
static value token it allocates:
- `new Dimension({number,unit})` from `T.Dimension` (`:621-625`) — image split into
  number+unit, **verbatim image discarded**.
- `new Num(parseFloat)` from `T.Number` / `MathConstant` (`:646-648`, `:626-644`) —
  `Num extends Dimension` (`number.ts:15`).
- `new Color(tokValue)` (hex) from `T.Color` (`:650-652`).
- `new Color({node,rgb,alpha})` (named) for `transparent`/color-table idents from
  `T.Ident` (`:601-617`).
- `new Any(tokValue,{role:'ident'})` for other idents (`:618`); `Bool` for `true`/`false`
  (less override, `lessRecursiveParser.ts:270-272`).

The less-parser overrides `processValueToken` (`lessRecursiveParser.ts:201`) for
`@`-refs/interp then **falls through to the css base** (`:248`, `:273`) for
Dimension/Num/Color — so the css base is the one seam to change for the token path. Extra
eager sites: `less-parser/productions/values.ts:263` (`new Dimension` for a `Signed`
token) and CST builders `css-parser/builders.ts:_buildDimension` (`:1096`)/`_buildColor`
(`:1104`), `less-parser/builders.ts:_buildNamedColor` (`:478`).

**Declaration value union + deferred discriminator.**
`value: Node | string | DeclarationValueSegment[]` where
`DeclarationValueSegment = Node | string` (`declaration.ts:151`, `:156`). The deferred
(string-lazy) shapes are exactly `typeof value === 'string' || Array.isArray(value)` —
`isDeferredDeclarationValue` (`declaration.ts:321`). A genuine `Node` value
(Call/List/Reference/Operation/Interpolated) is the third shape, untouched by this change.

**How a bare-string value is coerced to a node today (the re-sniff this replaces):**
- `Declaration.valueNode()` (`declaration.ts:775`) — string → `keyword(value)`; segment
  array → comma-`List`/space-`Sequence` with `keyword()` per string member. **No
  numeric/color sniff here** — a bare-string `1px` becomes a `Keyword`, not a Dimension.
- `Declaration.toAssignmentInputNode()` (`declaration.ts:749`) — same.
- `coerceStringTerminal` (`util/evaluate-node-array.ts:19`) — the seam that **does**
  re-sniff: `#`→`new Color`, `NUMERIC_TERMINAL_RE` (`:11`)→`new Dimension`, else `keyword`.
- `Any.compare` (`any.ts:110-123`) + `Dimension.compare` (`dimension.ts:200-208`) — the
  `/^[-+]?(?:\d+\.?\d*|\.\d+)$/` numeric regex sniff, run at every guard/mixin match.

**Byte-identity of the eager nodes today (critical asymmetry):**
- **Color already round-trips verbatim.** `serializeScalarSyntax` returns
  `typeof node === 'string' ? node` (`color.ts:580-584`); channels computed **lazily** on
  the `.rgb`/`_rgb` getter (`:308-378`). Color is *already* "verbatim string +
  lazily-materialized channels wrapped in a node" — this change only sheds the wrapper.
- **Dimension canonicalizes, even un-operated.** `serializeSyntax` =
  `` `${round(number,8)}`.toLowerCase() + unit `` (`dimension.ts:311-315`), on every
  serialize. Verbatim image gone at parse time, so an un-operated `1.0px`/`2PX`/`1e3px`
  **already serializes canonicalized** (`1px`/`2px`/`1000px`).

This asymmetry is the single most important finding: moving Dimension to a verbatim string
**changes** un-operated output from canonicalized → source-verbatim. Color has no such
change.

> **§0 ASYMMETRY — RESOLVED (owner 2026-07-16): VERBATIM FOR BOTH.** Dimension and
> Color are treated identically: an **un-operated** value preserves its
> **source-verbatim** form (`1.0px`→`1.0px`, `2PX`→`2PX`, `1e3px`→`1e3px`); **only a
> computed** value (arithmetic result — it has no source form) is canonicalized via
> the Less number formatter. This is the natural representation-B behavior (value =
> its source bytes; only computed values re-serialize) and INTENTIONALLY diverges
> from the legacy engine, which canonicalizes un-operated dimensions via
> `Dimension.serializeSyntax`. Where a legacy/adapter render or an alpha `.css`
> golden encodes the canonicalized form for a non-canonical source, that is stale
> 4.x behavior — flag for owner review, do not match it.
>
> **tree2 native value path (foundation, this branch) already conforms.** tree2's
> bridge represents un-operated value literals as verbatim `Word` nodes (it does NOT
> create `Kind.Dimension` value nodes for static/operand parsing), so an un-operated
> dimension emits its source bytes; a dimension is only materialized+canonicalized
> when it is an operand of an operation. Confirmed by the `native-value-differential`
> suite (`verbatim-trailing-zero`/`verbatim-upper-unit`/`verbatim-sci` stay verbatim
> on BOTH the native and adapter paths — no divergence, since neither canonicalizes
> an un-operated value — and `(1.0px + 2.0px)`→`3px` shows computed canonicalization).

## 1. Tag enum

| Tag | Const | Source token / builder | Materializes to |
|----:|-------|------------------------|-----------------|
| 0 | `LIT_KEYWORD` | ident/keyword (`solid`,`auto`,`none`) — `Any{role:'ident'}`/`Keyword` | `Keyword` (default + safe fallback) |
| 1 | `LIT_DIMENSION` | `T.Dimension`, `Signed`+unit | `Dimension({number,unit})` |
| 2 | `LIT_NUM` | `T.Number`, `MathConstant` | `Num(number)` |
| 3 | `LIT_COLOR_HEX` | `T.Color` (`#…`) | `new Color(str)` |
| 4 | `LIT_COLOR_NAMED` | color-table ident / `transparent` | `new Color({node:str})` |
| 5 | `LIT_BOOL` | `true`/`false` (less) | `Bool` |
| 6 | `LIT_ANY` | verbatim fallback / role-typed `Any` (urlvalue, charset, verbatim compound fragments) | `Any(str)` — no coercion |

`LIT_KEYWORD = 0` deliberately: an untagged/synthetic string (tag absent → `0`)
materializes to `Keyword`, matching today's `valueNode()`/`toAssignmentInputNode()`
default — zero behavioral change for the ident/keyword path.

**Home:** new leaf module `packages/core/src/tree/util/literal-tag.ts` (consts +
`materializeLiteral`). **Build detail:** the tag crosses the core→parser package
boundary, so use exported int consts or a **non-`const` `enum`** (a cross-package
`const enum` under `isolatedModules` won't inline reliably) — mirrors `ColorFormat`
(`color.ts:18`), a real `enum` because css-parser imports it (`builders.ts:41`).

## 2. Declaration shape change

Tag rides **only** on the two deferred shapes; a genuine `Node` value needs no tag.

**N = 1 (dominant — `color: red`, `margin: 0`):** unchanged `value: string` + one scalar:
```ts
valueTag?: LiteralTag;   // scalar; meaningful iff typeof value === 'string'; absent ⇒ LIT_KEYWORD
```

**N ≥ 2, all-literal (`padding: 1px 1px 1px 1px`, `border: 1px solid red`):**
```ts
value: string[];         // PACKED string array (fits DeclarationValueSegment[])
valueTypes?: number[];   // PACKED_SMI, index-aligned; consulted only when slot i is operated
```
`value` stays the single serialization source (`writeDeclarationFieldValueSyntax`
`declaration.ts:1084-1110` already `w.add`s each string verbatim).

**Mixed array (`1px @gap 2px`, `url(x) format(y)`): unchanged** `(Node|string)[]` — node
members keep identity, string members keep today's `coerceStringTerminal` re-sniff.
Purely-literal decls dominate the 4502+3000 count, so the win concentrates in
N=1 / N≥2-all-literal; extending tags to mixed arrays is a low-value follow-on (§9).

**Read-time discrimination (one branch, no re-sniff), reusing the existing
`typeof`/`Array.isArray` split** in `writeDeclarationFieldValueSyntax`,
`copyValueForDerived` (`:720-733`), `_walkInto`, `valueNode`:
```
typeof value === 'string'  → scalar valueTag                       (N=1)
Array.isArray(value)       → value[i] string ? valueTypes[i] : node (N≥2 / mixed)
value instanceof Node      → node, no tag                          (genuine)
```

**Keep the current compound-string collapse.** Verbatim fragment arrays
(`['calc(', '100%', ' - ', '1px', ')']`, `declaration.ts:1040`) stay as-is (tag
`LIT_ANY`, never materialized). This adds tags to *tokenized* literal arrays; it does not
re-tokenize verbatim compound strings.

**`clone`/`derive`:** `valueTag`/`valueTypes` are parse constants → shared by reference in
`withParts`/`derive`/`copyValueForDerived` (`:826-867`, `:720-733`), never deep-copied,
never written back. `deriveWithParts({value})` that substitutes a fresh value must
substitute/clear the tag alongside — one line in `withParts`.

## 3. Materialization function

```ts
// packages/core/src/tree/util/literal-tag.ts
export function materializeLiteral(str: string, tag: LiteralTag, location?, context?): Node;
```
A `switch (tag)` — no regex: `LIT_DIMENSION`→parse→`new Dimension`; `LIT_NUM`→`new Num`;
`LIT_COLOR_HEX`→`new Color(str)`; `LIT_COLOR_NAMED`→`new Color({node:str})`;
`LIT_BOOL`→`new Bool`; `LIT_KEYWORD`/default→`keyword`; `LIT_ANY`→`any`.

**Placement — it *replaces the sniff*, not the coercion sites:**
- `coerceStringTerminal` (`evaluate-node-array.ts:19`) → thin wrapper:
  `materializeLiteral(str,tag)` when a tag is threaded, else the current regex body renamed
  `sniffStringTerminal(str)` for synthetic/untagged strings. Zero-tag back-compat.
- `valueNode()` (`:775`) / `toAssignmentInputNode()` (`:749`): where they `keyword(value)`
  a scalar, call `materializeLiteral(value, this.valueTag)`; per-segment,
  `materializeLiteral(item, this.valueTypes?.[i])`. **Strict upgrade** — today those paths
  produce `Keyword` even for `1px`, so a tagged `LIT_DIMENSION` now correctly yields a
  Dimension for var-binding/iteration (latent-bug fix; validate vs goldens).

**Projection-not-mutation (must hold):** `materializeLiteral` returns a **fresh** node to
the operated/compared slot; the result is **never stored back** into
`value`/`valueTag`/`valueTypes`. The tag array is a read-only parse constant.
Materialization fires strictly on the ~10% operated/matched slots; the 90% inert slots
serialize their verbatim string and allocate nothing.

## 4. Seam inventory

| Seam | File:line | Change | Effect |
|------|-----------|--------|--------|
| Serialize (inert) | `declaration.ts:1084`, `:1321` | none — already `w.add(string)` | **Cheaper**: no node for the 90% |
| `coerceStringTerminal` | `evaluate-node-array.ts:19` | tag→`materializeLiteral`; regex kept as fallback | Cheaper: drops the sniff |
| `coerceValueNode`/`coerceNodeArray` | `:45,:73` | thread optional parallel `tags?:number[]` | Cheaper on string members |
| `valueNode()` | `declaration.ts:775` | `keyword`→`materializeLiteral(str,tag)` | Correctness upgrade + no re-sniff |
| `toAssignmentInputNode()` | `:749` | same | same |
| `Operation` operands | via `valueNode`/`coerce*` | operand materialized once on operated slot | Sheds inert neighbors |
| `Any.compare` numeric | `any.ts:110-123` | tagged literal materialized *before* compare | Cheaper: fewer `Any`-that-is-a-number compares |
| `Dimension.compare` `Any` branch | `dimension.ts:200-208` | tagged `1px` compares as real Dimension | Cheaper |
| Unit logic | `dimension.ts` operate/compare | operates on materialized Dimension as today | Unaffected |
| Mixin-arg binding | via `valueNode`/`toAssignmentInputNode` | materialize on bind | Cheaper |
| Variable read | `VarDeclaration` via `valueNode()` | materialize on read | Cheaper |
| `valueOf()` | `nodeValueText` `:502-525` | operates on the string directly | Unaffected |
| clone/derive/reuse-as-leaf | `:687-867` | share tag by reference | Unaffected; inert literals never enter `reuseAsLeaf` (`node-base.ts:1287,1295`) |

Tag params are **optional** everywhere, so no signature is forced to change and it lands
incrementally. **No seam gets more expensive.**

## 5. Producer (parser) changes

Producer stops allocating literal nodes for static value tokens; emits **(verbatim
string, tag)**.

**Primary — `cssRecursiveParser.processValueToken` (`:590`):** return `token.image` +
tag: `T.Dimension`→`(image, LIT_DIMENSION)` (**verbatim image round-trips**; today's
payload split discards it — the byte-identity change, §6); `T.Number`/`MathConstant`→
`LIT_NUM`; `T.Color`→`LIT_COLOR_HEX`; color-table/`transparent`→`LIT_COLOR_NAMED`; plain
ident→`LIT_KEYWORD`; fallback→`LIT_ANY`. Mechanically, the value-array assembler
(`_assembleValue`/`_assembleSegment`, `css-parser/builders.ts:907,960`, which already
produces `string`/`string[]`/`List` and stamps field spans at `_buildDeclaration`
`:891-903`) is where string+tag lands in `value`/`valueTypes` (or scalar
`value`+`valueTag`). The less-parser override needs no change — it already delegates to the
css base (`:248,:273`).

**Secondary:** `less-parser/productions/values.ts:263,267` (`Signed`); CST builders
`css-parser/builders.ts:_buildDimension`(`:1096`)/`_buildColor`(`:1104`),
`less-parser/builders.ts:_buildNamedColor`(`:478`); `less-parser/productions/root.ts:1113`
(nth, low priority, migrate with idents).

**Pre-split shortcut (optional, §9):** `T.Dimension.payload` already has `[number,unit]`;
a side channel could skip the re-parse in `materializeLiteral`. Primary spec re-parses the
verbatim string (simpler, still node-free until operated).

## 6. Byte-identity plan

- **Color (hex + named): clean, no output change.** Already serializes verbatim `node`
  string; only the wrapper is shed. Zero-risk.
- **Keyword/Ident/Bool/Any: clean.** Already emitted verbatim; tag is additive.
- **Dimension / Num: the one real change — verbatim vs canonicalized.** Today an
  *un-operated* Dimension serializes canonicalized via `` `${round(number,8)}`.toLowerCase()
  + unit `` — note `.toLowerCase()` applies **only to the number string, NOT the unit**, so
  `2PX`→`2PX` (uppercase units are already preserved; "uppercase units" is NOT a divergence
  class). Real divergence comes only from the *number* being routed through
  `parseFloat`+`round(,8)`: fractional-trailing-zero (`1.0`→`1`), leading-zero-absent
  (`.3`↔`0.3`), scientific notation, `+`-signed, and round-to-8 precision collapse
  (`-0.0000000001`→`0` — **value-changing**, not cosmetic). The string form serializes
  source-verbatim; for the vast majority (`1px`,`0`,`16px`, source == canonical) they
  **coincide → byte-identical**. The **operated** path is unchanged.
- **EMPIRICAL (full all-less sweep, 2026-07-12):** the tested corpus is remarkably clean.
  **Exactly ONE** unambiguous un-operated *declaration-value* divergence:
  `at-rules/at-rules.less:29` `1.0`→golden `1`. **Zero** divergences in the uppercase-unit,
  sci-notation, `+`-signed, `05`, or `5.` classes anywhere. Two harder cases sit in
  **non-declaration-value contexts** — a mixin-arg list member (`.3s`) and a `rotate()` Call
  arg (`-0.0000000001deg`→`0deg`, the lone value-changing one) — and BOTH are **out of scope
  under §2's Declaration-deferred-only restriction** (mixed/Call arrays stay unchanged →
  materialize & canonicalize as today). So if §2's scope holds, the owner-decision surface
  on the tested corpus is the single `1.0`→`1` cosmetic item.

## 7. Migration steps (each independently landable + byte-identical-testable)

1. **Scaffolding:** land enum + `materializeLiteral` + `sniffStringTerminal` fallback. No
   producer change → byte-identical by construction (fallback == old body).
2. **Dimension first** (+ Num, it's a `Dimension`). Producer emits `(image,
   LIT_DIMENSION)`; Declaration gains `valueTag`/`valueTypes`; coercion sites materialize.
   Gate on all-less byte-identity — **expect only the narrow §6 divergences; each is an
   owner adjudication** (verbatim is design intent, but a golden may encode today's
   canonicalization).
3. **Color** — byte-identical, **no expected divergences** (already verbatim). Lowest-risk
   despite being second.
4. **Unify idents/keywords/Bool** under the tag — mostly a no-op for output; makes the
   seam uniform, lets `valueNode`/`coerce*` drop the untagged fallback for the parser path.
5. **Doc amendment (same turn as step 2/3):** `STRINGS-OVER-NODES.md` §4 (`:229-257`):
   "Node still required for Dimension/Color" → "required **only for the operated slot**; a
   literal rides as `(string, tag)`, materialized lazily via `materializeLiteral`." Mark
   the old carve-out superseded.

Each step is its own same-worktree git-toggle A/B (no cross-worktree bench bias).

## 8. Test plan

- **Byte-identical on all-less:** full-workspace build (`pnpm -r build` — partial build =
  bogus counts), run all-less per step, triage step-2 goldens into
  {coincidence-confirmed, verbatim-is-correct, owner-call}.
- **Value-heavy fixture:** literal-dense, arithmetic-light (the re-profile workload —
  `benchmark.less` is extend-dominated and won't surface value-node cost). Assert
  byte-identical **and** capture resident/alloc delta (the win metric).
- **No-materialization ratchet (core assertion):** test-only counter in
  `materializeLiteral`; a purely-inert fixture (`a{color:red;margin:0;padding:1px 2px 3px
  4px}`) → **zero** materialize calls. A guard/math fixture (`.m() when (@a = 1px)`,
  `@x:1px*2`) → materialize fires exactly on operated/compared slots, count matches, and
  the Declaration's `value`/`valueTypes` are `===` the parse-time objects after render
  (no write-back).
- **Operated-path parity:** `1.0px + 1px`, `#FF0000 lighten`, `red + #010101` produce
  today's canonicalized bytes.

## 9. Open items

1. **(Spike — the one open encoding question)** N≥2: two-parallel-packed (primary; keeps
   `valueTypes` PACKED_SMI, branchless) vs. interleaved-flat `[s,t,s,t]` (one header,
   demotes to mixed array). Measure both on the value-heavy fixture.
2. **(Owner — the one real byte-identity divergence, now EMPIRICALLY BOUNDED)** Dimension/Num
   un-operated literals move canonicalized → source-verbatim. Verbatim is design intent
   (matches v5 source-preservation). Full all-less sweep (2026-07-12) found the owner-decision
   surface on the tested corpus is **a single cosmetic case** — `at-rules.less:29` `1.0`→`1`
   — provided §2's Declaration-deferred-only scope holds (which pushes the mixin-arg and
   `rotate()` round-to-8 cases out of scope). Confirm that one golden, and confirm §2's scope
   restriction is honored so the value-changing `round(,8)` collapse never rides the verbatim
   path. (`.css` are v5 goldens; don't anchor to the dying eager-node behavior.)
3. **(Follow-on)** Extend `valueTypes` to mixed `(Node|string)[]` arrays — low value,
   pure-literal decls dominate; defer unless re-profile shows mixed-array sniff hot.
4. **(Build detail)** Confirm the tag enum crosses core→parser without `const enum`
   inlining loss.

**Dependency (noted, not a gate):** after the D-EVAL flip + post-flip re-profile confirms
Dimension/Color construction is hot on a value-heavy lib. Ready to execute the moment that
clears.
