# Proposal: Eliminate `pre`/`post` Properties — Return Whitespace Tokens in the AST

## Problem

Every parsed `Node` carries two properties — `pre` and `post` — that store whitespace and comments surrounding the node. These are:

- Set during parsing via `$.wrap()` calls (258 call sites across 16 parser files)
- Read during serialization via `processPrePost()` (38 usages across 5 core files)
- Copied/mutated during evaluation (74 `.pre =` / `.post =` assignments across 17 tree files)

The current encoding is a union type:
```ts
pre: Array<Comment | Node | string> | 1 | 0 | undefined
post: Array<Comment | Node | string> | 1 | 0 | undefined
```

This creates complexity:
1. **Every node** allocates two extra property slots even when they're `0` or `undefined`
2. **`$.wrap()` calls** are boilerplate scattered through every parser production
3. **Evaluation** must carefully propagate/clear `pre`/`post` on clones, inherit, reference substitution, operation results, etc.
4. **Serialization** does a 4-way branch (`undefined` / `0` / `1` / `Array`) in `processPrePost()` for every node

## Proposed Design

### Core idea

Instead of attaching whitespace **to** nodes, keep whitespace/comment tokens **as siblings in the AST's child arrays**. During serialization, the existing `childKeys` iteration already walks these arrays — it just needs to handle interleaved whitespace tokens.

### New `WS` leaf node

```ts
class WS extends Node {
  static override childKeys = null as null;
  // value is the raw whitespace string (e.g. ' ', '\n  ', '\n')

  toTrimmedString() {
    return this.value; // or compressed equivalent
  }
}
```

- `N.WS` bitmask entry, `isNode(n, N.WS)` check
- Leaf node, no children, trivially serializable
- Comments already exist as `Comment` nodes — they become siblings too

### Parser changes

Instead of:
```ts
// Current: parse node, then attach surrounding whitespace
sequences.push($.wrap(selector, 'both'));
```

The parser would:
```ts
// New: whitespace tokens are already interleaved in the child array
sequences.push(...$.collectWithWS(selector));
// or simply: the production returns [WS?, node, WS?] segments
```

More concretely, the `getPrePost` / `wrap` machinery is replaced by the parser **not filtering out** skipped tokens at the child-array level. The `set input` method already identifies whitespace runs between real tokens. Instead of building `preSkippedTokenMap` / `postSkippedTokenMap`, we emit `WS` and `Comment` nodes directly into the child arrays during production rule execution.

### Serialization changes

`toString()` currently does:
```ts
pre + toTrimmedString() + post
```

With the new design, `toString()` just calls `toTrimmedString()`, and the base `toTrimmedString()` already iterates `childKeys` arrays — it encounters `WS`/`Comment` nodes naturally and serializes them inline. No special pre/post processing needed.

The `processPrePost()` method and all its branching logic is deleted.

### Evaluation changes

Node transforms that currently must propagate `pre`/`post`:
- `inherit()` — no longer copies pre/post
- `clone()` — deep clone already handles child arrays; WS nodes clone naturally
- `Reference.evalNode` — no longer needs `out.pre = this.pre; out.post = this.post;`
- `Operation.evalNode` — no longer needs to adopt left.pre / right.post
- `Call.adoptCallWhitespace` — deleted entirely
- `Ampersand` selector clearing — no longer needs `selector.pre = undefined`
- `extend-core.ts` / `selector-utils.ts` — no longer clear pre/post on generated `:is()` wrappers

## What Gets Eliminated

### Deleted entirely

| Item | Location | Count |
|------|----------|-------|
| `$.wrap()` calls | 16 parser files | 258 calls |
| `wrap()` method | `cssRecursiveParser.ts:568-590` | 1 |
| `getPrePost()` method | `cssRecursiveParser.ts:481-512` | 1 |
| `processPrePost()` method | `node-base.ts:1587-1624` | 1 |
| `pre`/`post` properties | `node-base.ts:242-243` | 2 props on every node |
| `preSkippedTokenMap` / `postSkippedTokenMap` | `cssRecursiveParser.ts` | 2 Maps |
| `usedSkippedTokens` / `usedSkippedTokensLog` | `cssRecursiveParser.ts` | 1 Set + 1 Array |
| `stripPrePost()` method | `node-base.ts:1312-1325` | 1 |
| `getRulesWithComments()` pre/post extraction | `cssRecursiveParser.ts:523-545` | 1 |
| `adoptCallWhitespace` | `call.ts:311-314` | 1 |
| `_normalizeFallbackArgSpacing` | `call.ts:177-189` | 1 |
| `signalBoundaryIntent` | `print.ts` Writer method | 1 |
| `captureWithMeta` boundary intent logic | `print.ts` / `sequence.ts` | 2 |

### Simplified

| Item | What changes |
|------|-------------|
| `inherit()` | Remove pre/post copy logic |
| `clone()` | WS nodes clone as normal children — no special handling |
| `toString()` | Becomes just `toTrimmedString()` with visibility check |
| `Sequence.toTrimmedString()` | No longer needs `captureWithMeta` + boundary intent negotiation — WS nodes between items encode spacing directly |
| `List.toTrimmedString()` | May still need separator logic, but WS between items is explicit |
| `Operation.toTrimmedString()` | WS between operands is in the child array |
| `Paren.toTrimmedString()` | WS after `(` and before `)` is in child array |
| `Ruleset` selector rendering | No `processPrePost('pre')` call needed |
| `Rules.toString()` | No `processPrePost('pre')` call needed |
| `serialize-helper.ts` | No `processPrePost('pre'/'post')` captures needed |

## What Changes in Each Package

### `packages/core` (tree nodes)

1. **Add `WS` node class** — leaf, `childKeys = null`, trivial serialization
2. **Remove `pre`/`post` from `Node` base class** — delete properties, remove from `inherit()`, `clone()`, `copy()`
3. **Delete `processPrePost()`** from `node-base.ts`
4. **Delete `stripPrePost()`** from `node-base.ts`
5. **Simplify `toString()`** — remove pre/post sandwich
6. **Update `Sequence.toTrimmedString()`** — WS nodes in value array handle spacing; the `captureWithMeta` + boundary intent system may be fully removable
7. **Update child arrays** — types widen from e.g. `Selector[]` to `(Selector | WS | Comment)[]` (but see "Typed children" below)
8. **Remove `.pre`/`.post` assignments** in `reference.ts`, `call.ts`, `operation.ts`, `ampersand.ts`, `extend-core.ts`, `selector-utils.ts`, `mixin-instance-primitives.ts`

### `packages/css-parser`

1. **Remove `wrap()` method** from `cssRecursiveParser.ts`
2. **Remove `getPrePost()` method**
3. **Simplify `set input`** — still filter skipped tokens from parse stream (Chevrotain needs clean tokens), but instead of building offset maps, store indexed WS/Comment nodes that productions can retrieve
4. **Remove `preSkippedTokenMap`, `postSkippedTokenMap`, `usedSkippedTokens`, `usedSkippedTokensLog`**
5. **Update all 258 `$.wrap()` call sites** across productions — replace with direct insertion of WS nodes into child arrays
6. **Simplify `getRulesWithComments`** — comments are already in child arrays

### `packages/less-parser`, `packages/scss-parser`, `packages/jess-parser`

Same pattern as css-parser — remove `$.wrap()` calls, insert WS nodes during production execution.

### `packages/fns`

- `extract.ts` spacing normalization (`node.pre = index === 0 ? 0 : 1`) — instead, insert/remove WS nodes in the sequence

### `packages/jess-plugin-less-compat`

- `sequence.ts` pre/post copying during node conversion — instead, ensure WS nodes convert properly

### Test files

- 18 files in `packages/core/src/tree/__tests__/` reference `.pre`/`.post` — update to use WS siblings
- Tests in `packages/core/src/tree/util/__tests__/print.test.ts` (31 `processPrePost` refs) — rewrite

## Design Decisions

### How do productions insert WS?

**Option A: Explicit `$.ws()` helper** — productions call `$.ws()` to get the WS node for the current position, then push it into the array. Pros: explicit, easy to understand. Cons: still a lot of call sites.

**Option B: Auto-interleave in array builders** — a helper like `$.seq(a, b, c)` automatically inserts WS nodes between items based on the skipped token positions. Pros: fewer call sites, less boilerplate. Cons: magic.

**Option C: Post-parse interleave** — after a production returns a node, a pass inserts WS nodes into child arrays based on the token offset maps. Pros: zero production changes. Cons: harder to reason about, may not handle all cases.

**Recommendation: Option A** with a thin `$.ws()` helper. It's the most transparent and debuggable. The `$.wrap()` call sites are already there — we're replacing `$.wrap(node, 'both')` with `$.ws(); push(node); $.ws()` (or a combined helper). Net call-site count is similar but each call is simpler.

### Typed children vs. interleaved arrays

If `Selector.value` is `(SimpleSelector | WS | Comment)[]`, all code that iterates selectors must filter. Two approaches:

**Option A: Widen array types everywhere.** Every consumer filters with `isNode(n, N.WS)`.

**Option B: Keep typed arrays clean; store WS in a parallel `trivia` array.** Each node has a `trivia: (WS | Comment)[]` that maps position-by-position to its childKeys arrays. Serialization interleaves them.

**Option C: Use a generic `NodeList` wrapper** that encapsulates both real children and their interspersed trivia, exposing typed iteration (`.items()`) and raw iteration (`.all()`).

**Recommendation: Option B or C.** Widening types everywhere (Option A) would be a massive type-level disruption. Option B is simpler to implement; Option C is cleaner long-term. Either way, the parallel trivia is only created for parsed nodes — API-created nodes have no trivia and use default formatting.

### What about the `undefined` vs `0` vs `1` distinction?

Currently:
- `undefined` = API-created, use default formatting
- `0` = parsed, explicitly no whitespace
- `1` = parsed, single space

With trivia arrays:
- **API-created nodes** have no trivia array (or empty) → use default formatting (same as `undefined`)
- **Parsed nodes with no WS** have an empty trivia slot → explicit no-space (same as `0`)
- **Parsed nodes with WS** have a `WS(' ')` node → explicit space (same as `1`)

The three-state distinction is preserved naturally.

### Comment handling in extend

`stripPrePost()` currently replaces comments with nil nodes to prevent duplication during selector extending. With trivia arrays, the same effect is achieved by filtering comments out of the trivia during extend's `copy()` operation.

### Compression mode

Currently, compression is handled by processPrePost (returning empty strings) and by individual node serializers. With WS nodes, compression can be handled by:
- WS nodes checking a `compress` flag in PrintOptions and returning `''`
- Or a pre-serialization pass that removes WS nodes

## Performance Considerations

### Memory

**Current**: 2 properties per node (`pre`, `post`). For `0` or `1` values, these are just numbers. For arrays, each is a heap allocation.

**Proposed**: WS leaf nodes are small (value string + location), but there are many of them (roughly 1 per token gap). The trivia array adds per-node overhead.

**Net**: Likely **similar or slightly more memory** for parsed trees (more small objects), but **less memory** for API-created trees (no pre/post slots). The real win is in reduced complexity, not memory.

### Serialization speed

**Current**: `processPrePost()` runs for every node — 4-way type check branch.

**Proposed**: WS nodes serialize via the normal `toTrimmedString()` path — just return the string. No type-check branching. The base `toTrimmedString()` already iterates arrays.

**Net**: Likely **faster** — eliminates the per-node 4-way branch and the `capture`/`captureWithMeta` overhead in Sequence.

### Parsing speed

**Current**: `$.wrap()` does map lookups and creates arrays.

**Proposed**: Direct WS node creation during production execution.

**Net**: **Similar** — the work of mapping offsets to WS content still happens, just in a different form.

## Migration Path

### Phase 1: Add WS node, parallel trivia system

- Create `WS` node class
- Add optional `trivia` storage to Node base (or NodeList wrapper)
- Keep `pre`/`post` working — both systems coexist
- Update `toString()` to prefer trivia when present, fall back to pre/post

### Phase 2: Update parsers to emit trivia

- Modify `set input` to prepare WS nodes
- Add `$.ws()` helper or equivalent
- Update productions one file at a time (start with css-parser, then less/scss/jess)
- Remove `$.wrap()` calls as trivia insertion replaces them

### Phase 3: Update evaluation to not propagate pre/post

- Remove pre/post copying from `inherit()`, `clone()`
- Remove pre/post assignments in `reference.ts`, `call.ts`, `operation.ts`, etc.
- Trivia on cloned nodes comes from deep clone of child arrays

### Phase 4: Delete pre/post

- Remove `pre`/`post` properties from Node base class
- Delete `processPrePost()`, `stripPrePost()`, `signalBoundaryIntent()`
- Delete `wrap()`, `getPrePost()`, token maps from parser
- Update all tests

## Risks

1. **Selector matching** — code that pattern-matches on selector child arrays must skip WS/Comment nodes. Need to audit `selector-match-core.ts`, `extend-walk.ts`, etc.
2. **Extend algorithm** — copies/splices selector arrays. Must handle trivia correctly during extend application.
3. **Source maps** — WS nodes carry location info, which feeds into source map generation. Need to verify source maps remain accurate.
4. **Less.js compatibility** — the less-parser and less-compat plugin handle whitespace in Less-specific ways. Need careful testing.
5. **Large changeset** — touching 258 `$.wrap` sites + 74 `.pre`/`.post` assignments + test rewrites is substantial. Phased migration reduces risk.

## Summary

| Metric | Current | Proposed |
|--------|---------|----------|
| Properties per node | 2 (pre, post) | 0 |
| Parser boilerplate | 258 `$.wrap()` calls | ~258 `$.ws()` or auto-interleave |
| Eval propagation sites | 74 `.pre`/`.post` assignments | 0 |
| Serialization branching | 4-way per node | Uniform (normal child iteration) |
| Code deleted | — | ~300 lines (wrap, getPrePost, processPrePost, stripPrePost, token maps) |
| Code added | — | ~50 lines (WS node, trivia helper) |
