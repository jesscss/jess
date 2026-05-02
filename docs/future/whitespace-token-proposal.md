# Proposal: Eliminate `pre`/`post` — Side-Channel Trivia Map

## Constraint

Whitespace and comments must **not** become children in the AST. They stay outside the node tree. The AST remains clean typed structures — no interleaved formatting nodes polluting child arrays.

## Problem

Every parsed `Node` carries `pre` and `post` properties:

```ts
pre: Array<Comment | Node | string> | 1 | 0 | undefined
post: Array<Comment | Node | string> | 1 | 0 | undefined
```

This creates three categories of cost:

1. **Parser boilerplate**: 258 `$.wrap()` calls across 16 files set these during parsing
2. **Evaluation tax**: 74 `.pre`/`.post` assignment sites propagate whitespace through clones, inherits, variable substitutions, operations, etc.
3. **Serialization branching**: `processPrePost()` runs a 4-way type branch for every node, plus the `captureWithMeta` / boundary-intent system in Sequence

## Proposed Design

### Core idea

The parser already builds offset-keyed maps of skipped tokens (`preSkippedTokenMap`, `postSkippedTokenMap`). Today, `$.wrap()` consumes these maps eagerly during parsing and stamps the results onto nodes as `pre`/`post`. Instead: **pass the maps through as-is** and let the serializer consume them lazily, keyed by each node's `location` offsets.

### What the parser returns today

```ts
interface IParseResult<T extends Node = Node> {
  lexerResult: ILexingResult;
  errors: IRecognitionException[];
  tree: T;
  warnings?: Array<{ message: string; token?: IToken; deprecation?: string }>;
}
```

### What the parser returns after

```ts
interface IParseResult<T extends Node = Node> {
  lexerResult: ILexingResult;
  errors: IRecognitionException[];
  tree: T;
  trivia: TriviaMap;
  warnings?: Array<{ message: string; token?: IToken; deprecation?: string }>;
}
```

The `TriviaMap` is the whitespace/comment data, keyed by offset, that the serializer looks up at render time.

### TriviaMap structure

```ts
interface TriviaMap {
  /** Skipped tokens that appear before the token starting at `offset` */
  before: Map<number, IToken[]>;
  /** Skipped tokens that appear after the token ending at `offset` */
  after: Map<number, IToken[]>;
}
```

These are literally the `preSkippedTokenMap` and `postSkippedTokenMap` that `set input` already builds. They just stop being consumed during parsing and instead flow through to serialization.

### Serialization changes

`toString()` currently does:

```ts
processPrePost('pre', ...)   // 4-way branch
toTrimmedString(...)
processPrePost('post', ...)  // 4-way branch
```

New `toString()`:

```ts
toString(options?: PrintOptions): string {
  if (!this.hasFlag(F_VISIBLE) && !this.fullRender) return '';
  const w = options.writer!;
  const mark = w.mark();
  const trivia = options.trivia;

  // Emit leading trivia (WS/comments before this node's start offset)
  if (trivia) {
    emitTrivia(w, trivia.before, this.location[0], options);
  }

  this.toTrimmedString(options);

  // Emit trailing trivia (WS/comments after this node's end offset)
  if (trivia) {
    emitTrivia(w, trivia.after, this.location[3], options);
  }

  return w.getSince(mark);
}
```

The `emitTrivia` helper is a single function (~15 lines) that replaces the entire `processPrePost` method:

```ts
function emitTrivia(
  w: OutputWriter,
  map: Map<number, IToken[]>,
  offset: number | undefined,
  options: PrintOptions
): void {
  if (offset === undefined) return;
  const tokens = map.get(offset);
  if (!tokens) return;
  for (const tok of tokens) {
    if (tok.tokenType.name === 'WS') {
      w.add(tok.image);
    } else {
      // Comment token — serialize directly or create transient Comment if needed
      if (!options.suppressComments) {
        w.add(tok.image);
      }
    }
  }
}
```

No 4-way branch. No `1` vs `0` vs `Array` vs `undefined` encoding. Just: look up tokens by offset, emit them.

### What happens to API-created nodes?

API-created nodes have no location offsets → `this.location[0]` is `undefined` → `emitTrivia` returns immediately → default formatting kicks in (same as `pre: undefined` today).

This preserves the current three-state distinction:
- **No location** (API-created): use default formatting
- **Location but no trivia at that offset**: no whitespace (same as `pre: 0`)
- **Location with trivia**: emit the whitespace/comments (same as `pre: Array | 1`)

### What happens during evaluation?

**Nothing.** This is the big win.

The trivia map is keyed by source offsets. Source offsets don't change during evaluation — they're baked into `node.location` at parse time. When a node is cloned, inherited, or substituted, it carries its location, and the trivia map still has the right entries.

All of these become unnecessary:
- `inherit()` copying pre/post
- `clone()` inheriting pre/post
- `Reference.evalNode`: `out.pre = this.pre; out.post = this.post;`
- `Operation.evalNode`: `out.pre = left.pre; out.post = right.post;`
- `Call.adoptCallWhitespace`
- `Call._normalizeFallbackArgSpacing`
- `Ampersand` clearing `selector.pre = undefined`
- `extend-core.ts` / `selector-utils.ts` clearing pre/post on generated `:is()` wrappers

For **generated nodes** (`:is()` wrappers, evaluated operations, etc.) that have no source location: they simply have no trivia — which is correct, since they shouldn't carry source whitespace anyway.

For **substitution nodes** (Reference → evaluated value): the evaluated value keeps its own source location and gets its own trivia. The Reference's surrounding trivia is addressed by the Reference's offsets, which the parent node's serialization handles. If the parent iterates `childKeys` and calls `child.toString()`, the child emits its own trivia — the parent emits what's between children.

### Formatting ownership: who emits what?

One subtlety: the current system has clear ownership — each node's `pre` is "mine to emit." With a shared map keyed by offset, we need to ensure each trivia entry is emitted exactly once.

**Rule**: A node emits trivia at its own `location[0]` (start) and `location[3]` (end). The trivia between two sibling nodes is emitted as the `after` of the first sibling's end offset OR the `before` of the second sibling's start offset — but not both. Since `preSkippedTokenMap` and `postSkippedTokenMap` point to the **same underlying array** for adjacent tokens (the parser sets both maps to the same `pendingSkipped` reference), we can use a consumed-set during serialization (much simpler than during parsing, since there's no backtracking):

```ts
// In PrintOptions or OutputWriter:
emittedTrivia: WeakSet<IToken[]>;
```

The first `emitTrivia` call that encounters a token array marks it consumed. Subsequent lookups for the same array skip it.

### Declaration value newlines

Jess should preserve authored multiline declaration values. If source trivia places
a declaration value across lines, the serializer keeps that line structure and
normalizes only the minimum continuation indentation needed for readable CSS.

This is intentionally simpler than historical Less fixture behavior. In the Less
test-data corpus, most multiline declaration values are preserved when the
continuation line is indented, while some unindented continuations are collapsed
in expected CSS. Jess should not encode that inconsistency as a semantic rule.

The stable contract is:

- Authored declaration value line breaks remain line breaks.
- Continuation lines receive at least the serializer's normal continuation indent.
- Generated or evaluated values without source-backed multiline trivia serialize
  through the normal node printer.
- A fixture that expects `background-position: 45 -23` from source
  `background-position: 45\n-23` is a Less compatibility artifact, not the Jess
  serializer contract.

### PrintOptions changes

```ts
interface PrintOptions {
  // ... existing fields ...
  trivia?: TriviaMap;
  emittedTrivia?: Set<IToken[]>;
}
```

The `trivia` field is set once at the top-level `render()` / `toString()` call and flows through to all children via the options object.

## What Gets Eliminated

### Deleted entirely

| Item | Location | Count |
|------|----------|-------|
| `$.wrap()` calls | 16 parser files | **258 calls** |
| `wrap()` method | `cssRecursiveParser.ts:568-590` | 1 |
| `getPrePost()` method | `cssRecursiveParser.ts:481-512` | 1 |
| `processPrePost()` method | `node-base.ts:1587-1624` | 1 |
| `pre` / `post` properties | `node-base.ts:242-243` | 2 props on **every node** |
| `usedSkippedTokens` / `usedSkippedTokensLog` | `cssRecursiveParser.ts` | 1 Set + 1 Array |
| `stripPrePost()` method | `node-base.ts:1312-1325` | 1 |
| `getRulesWithComments()` pre/post extraction | `cssRecursiveParser.ts:523-545` | 1 |
| `adoptCallWhitespace` | `call.ts:311-314` | 1 |
| `_normalizeFallbackArgSpacing` | `call.ts:177-189` | 1 |
| `signalBoundaryIntent` | `print.ts` Writer method | 1 |
| `captureWithMeta` boundary intent logic | `print.ts` + `sequence.ts` | 2 |
| `.pre` / `.post` assignments in eval | 17 tree files | **74 sites** |

### Simplified

| Item | What changes |
|------|-------------|
| `inherit()` | Remove pre/post copy — ~4 lines deleted |
| `clone()` | Remove pre/post from inherit path |
| `toString()` | Replace 3-step sandwich with offset-based trivia lookup |
| `Sequence.toTrimmedString()` | Remove `captureWithMeta` + boundary intent negotiation — spacing comes from trivia between child offsets |
| `Ruleset` selector rendering | No `processPrePost('pre')` capture |
| `Rules.toString()` | No `processPrePost('pre')` call |
| `serialize-helper.ts` | No `processPrePost` captures for pre/post |

### Kept (repurposed)

| Item | What changes |
|------|-------------|
| `preSkippedTokenMap` | Stays in parser, returned as `trivia.before` |
| `postSkippedTokenMap` | Stays in parser, returned as `trivia.after` |
| `set input` token filtering | Stays — Chevrotain still needs clean token stream. Maps still built the same way. Only difference: they're returned, not consumed |

## What Changes in Each Package

### `packages/core` (tree nodes)

1. **Delete `pre` / `post` properties** from Node base class
2. **Delete `processPrePost()`** from `node-base.ts`
3. **Delete `stripPrePost()`** from `node-base.ts`
4. **Add `trivia?: TriviaMap`** to `PrintOptions`
5. **Add `emittedTrivia?: Set<IToken[]>`** to `PrintOptions`
6. **Rewrite `toString()`** — trivia lookup by `this.location[0]` / `this.location[3]`
7. **Add `emitTrivia()` helper** — ~15 lines, single function
8. **Simplify `inherit()`** — remove pre/post copying
9. **Remove `.pre`/`.post` assignments** in `reference.ts` (2), `call.ts` (5), `operation.ts` (6), `ampersand.ts` (2), `sequence.ts` (4), `extend-core.ts` (4), `selector-utils.ts` (2), `mixin-instance-primitives.ts` (1)
10. **Simplify `Sequence.toTrimmedString()`** — remove captureWithMeta / boundary intent system

### `packages/css-parser`

1. **Delete `wrap()` method**
2. **Delete `getPrePost()` method**
3. **Delete `usedSkippedTokens` / `usedSkippedTokensLog`**
4. **Keep `set input` mostly as-is** — still builds `preSkippedTokenMap` / `postSkippedTokenMap`
5. **Return trivia maps** in parse result
6. **Remove all 258 `$.wrap()` calls** across productions — these just go away, nothing replaces them
7. **Simplify `getRulesWithComments`** — comments from the trivia map are handled during serialization, not extracted from pre/post arrays

### `packages/less-parser`, `packages/scss-parser`, `packages/jess-parser`

Same: remove `$.wrap()` calls. No replacement needed — the trivia maps flow through automatically.

### `packages/fns`

- `extract.ts` spacing normalization — no longer needed; trivia from source offset handles it

### `packages/jess-plugin-less-compat`

- `sequence.ts` pre/post copying during node conversion — deleted

### `packages/core` types (`IParseResult`)

- Add `trivia: TriviaMap` field

### Test files

- 18 test files referencing `.pre`/`.post` — update assertions
- `print.test.ts` (31 `processPrePost` refs) — rewrite to test `emitTrivia`

## Design Decisions

### Where do comments live? DX analysis

Three options: comments in the trivia map (alongside whitespace), comments as child-array siblings (interleaved with real nodes), or a hybrid.

#### Option A: Comments in the trivia map (recommended)

Comments live in the offset-keyed map alongside whitespace. They never appear in child arrays. Serialization emits them via `emitTrivia()` at the correct source offset.

**Pros (DX):**
- **Index-based access is always correct.** `selector.value[0]` is a `SimpleSelector`, never a `Comment`. No defensive filtering needed. This is the single biggest DX win — every piece of code that reads child arrays works without surprises.
- **Typed arrays stay clean.** `Selector[]`, `Declaration[]`, etc. — no union with `Comment`. No `(Selector | Comment)[]` type pollution. TypeScript autocomplete and narrowing work naturally.
- **New algorithms don't need comment awareness.** Extend, selector matching, mixin lookup — none of these need to filter comments. Today's `getRulesWithComments` extraction from `pre`/`post` is replaced by a trivia-map scan, but algorithms that don't care about comments don't interact with comments at all.
- **Debugging / inspection is clean.** When you log a node or examine it in a debugger, you see its actual structure — not interleaved comments breaking the visual pattern.
- **Uniform model.** One system for all trivia (whitespace + comments). No "whitespace is there, comments are here" split to explain.
- **Comment suppression is trivial.** `options.suppressComments` in `emitTrivia()` — one flag, one place. No need to walk child arrays removing comments.

**Cons (DX):**
- **Comments are invisible in the AST.** If a developer inspects the tree (debugger, AST explorer, test assertions), comments don't appear anywhere on nodes. To find a comment, you must know the offset and look it up in the trivia map. This makes comment-related debugging harder.
- **No structural relationship.** A comment between two declarations in a ruleset has no parent/child relationship in the AST. It's just "trivia at offset N." If a tool or plugin wants to reason about "the comment above this declaration," it must do offset math rather than tree traversal.
- **Rule-level comment rendering needs new logic.** Today, `getRulesWithComments` extracts comments from `pre`/`post` into the `rules[]` array so they render as standalone rules. With a trivia map, the serializer must scan for comment tokens in the offset range between rules and emit them. This is doable but is a new code path that doesn't exist today.
- **Comment-aware transformations are indirect.** If an API consumer wants to "move a comment" or "attach a comment to a node," there's no obvious API — they'd need to manipulate the trivia map by offset, which is lower-level than setting `node.pre`.
- **Loss of comment attribution.** Today, `pre`/`post` clearly says "this comment belongs to this node." With offset-keyed trivia, a comment between node A's end and node B's start is ambiguous — it could be A's trailing trivia or B's leading trivia. The consumed-set prevents double-emit, but the *semantic* ownership is lost.

#### Option B: Comments as child-array siblings

Comments are interleaved in child arrays (e.g. `rules` contains `[Declaration, Comment, Declaration]`). Whitespace stays in the trivia map.

**Pros (DX):**
- **Comments are visible in the tree.** Debugging, AST exploration, and test assertions show comments in their structural position. Easy to see "there's a comment between these two declarations."
- **Structural relationships are explicit.** A comment's parent is the node whose child array contains it. Tree traversal finds comments naturally.
- **Comment manipulation is intuitive.** To move or remove a comment, splice the array. To add one, push it. Standard array operations.
- **Rule-level comments work automatically.** Comments in `rules[]` serialize in order — no special offset-range scanning needed.
- **Familiar model.** Matches how most AST tooling works (Babel, ESTree, PostCSS all put comments in the tree).

**Cons (DX):**
- **Index-based access breaks.** `rules[0]` might be a `Comment`, not a `Declaration`. Every indexed access needs filtering or a wrapper like `.items()` / `.nonFormatting()`. This is a pervasive tax on all code that touches child arrays.
- **Type pollution.** `Selector[]` becomes `(Selector | Comment)[]`. Every `for` loop, every `.map()`, every destructuring needs a type guard. This cascades through the entire codebase.
- **Algorithms must filter.** Selector matching, extend, mixin lookup — all must skip comments. One missed filter = subtle bug. Today these algorithms don't encounter comments at all (they're in `pre`/`post`, not child arrays).
- **Split model.** Whitespace is in the trivia map, comments are in child arrays. Two different systems for two kinds of trivia. More concepts to learn, more code paths to maintain.
- **Inspection is noisier.** Logging a ruleset's `rules` shows comments interspersed. For a ruleset with many comments (e.g. a config file), the actual declarations are hard to spot.

#### Option C: Hybrid — comments available in both

Comments live primarily in the trivia map (like Option A), but a utility method like `node.getComments('before' | 'after')` provides structured access by scanning the trivia map for the node's offsets.

**Pros:** Clean arrays (Option A's main win) + structured comment access when needed. No type pollution.

**Cons:** Two ways to "find" comments — trivia map or utility method. The utility method is sugar over offset math, so it's not free to maintain. And it still doesn't give you parent/child relationships.

#### Verdict

**Option A (trivia map) wins on DX for the common case.** The vast majority of code that touches the AST reads child arrays, and keeping those arrays clean is the highest-leverage DX improvement. The downsides (comment invisibility, indirect manipulation) affect a narrower set of use cases — primarily tooling/plugin authors who want to inspect or transform comments.

Option C (hybrid with utility methods) is a good enhancement to add later if comment access becomes a pain point, but it's not needed for the initial implementation.

### How does Sequence spacing work without pre/post?

Currently, `Sequence.toTrimmedString()` uses `captureWithMeta` to probe each child's pre/post boundary intents and decides whether to insert a space. With the trivia map, the whitespace between sequence items is stored at the offsets between them. The serializer emits it naturally:

```
child[0].toString() → emits child[0] body + trailing trivia at child[0].endOffset
child[1].toString() → emits leading trivia at child[1].startOffset + child[1] body
```

If there's a space between two sequence items in the source, it's in the trivia map at the boundary offset. If there isn't, there's no entry. The `captureWithMeta` / boundary-intent system becomes unnecessary.

For **API-created sequences** (no locations), the Sequence falls back to default spacing (insert a space between items unless told otherwise) — same behavior as `pre: undefined` today.

### How do generated/synthetic nodes get spacing?

Nodes created during evaluation (`:is()` wrappers, operation results, etc.) have no source location → no formatting lookup → default formatting. This is the correct behavior — these nodes should use clean default formatting, not inherit source whitespace.

Currently, code explicitly clears `pre`/`post` on generated nodes (e.g. `wrapper.pre = undefined` in `extend-core.ts`). That code is simply deleted — the absence of a location achieves the same result.

### How does comment suppression in extend work?

`stripPrePost()` replaces comments with nil nodes during extend's `copy()`. With the trivia map, extend doesn't touch trivia at all — it copies nodes (which carry their locations). During serialization of the extended selector, `emitTrivia` checks `options.suppressComments` and skips comment tokens. Alternatively, extend can explicitly filter the trivia map for the copied range.

### What about nodes whose whitespace should transfer to another node?

Today, `Reference.evalNode` does `out.pre = this.pre; out.post = this.post;` — the variable's surrounding whitespace transfers to the resolved value.

With the trivia map, this works naturally if the parent is what serializes the trivia. When a parent iterates its `childKeys` and calls `child.toString()`, the child is a Reference at parse time and an evaluated value at render time. But the parent's child array position hasn't changed — the trivia at that position in the source is keyed to the Reference's offsets. The evaluated value may have different offsets.

**This is the one subtle case.** Two approaches:

**Option A: Render-time offset override.** The evaluation step can tag the output node with the source node's offsets:
```ts
// In Reference.evalNode:
out._triviaOffsets = [this.location[0], this.location[3]];
```
And `toString()` checks `_triviaOffsets` before falling back to `this.location`.

**Option B: Trivia follows the EvalState.** Since serialization already resolves patched fields through EvalState/context, the trivia lookup can use the **source node's** location when an eval-patched value is being rendered. The source node is already tracked as `sourceNode`.

**Recommendation: Option A.** It's explicit, doesn't couple trivia to EvalState, and the override is a single lightweight property. Only nodes that actually need whitespace transfer (Reference results, Operation results, Call results) set it.

### Compression mode

With trivia lookup, compression is handled by a single check in `emitTrivia`:

```ts
if (options.compress) return; // Skip all formatting
```

One line replaces all the compression branching currently scattered through `processPrePost` and individual serializers.

### What about the `getRulesWithComments` extraction?

Currently, `getRulesWithComments()` in `cssRecursiveParser.ts` extracts Comment nodes from `pre`/`post` arrays and promotes them to top-level rules. With the trivia map, comments are still in the trivia entries at the relevant offsets. `getRulesWithComments` can be replaced by a simpler function that scans the trivia map for comment tokens in a given offset range and creates Comment nodes from them when needed for rule-level rendering.

## Performance

### Memory

**Current**: 2 property slots per node (`pre`, `post`). Arrays allocated for multi-token formatting.

**Proposed**: 0 property slots per node. The trivia maps exist once per parse (they're already allocated today in `set input`). The only new cost is `emittedTrivia` Set during serialization.

**Net**: **Less memory.** Every node saves two property slots. The maps are a wash (already exist). The consumed-set is transient (serialization only).

### Serialization speed

**Current**: `processPrePost()` runs per node — 4-way type branch, array iteration, captures.

**Proposed**: `emitTrivia()` runs per node — single Map.get + optional array iteration. No type branching. No captures.

**Net**: **Faster.** Map.get is O(1). No union-type branching. The `captureWithMeta` system in Sequence (which does speculative serialization and rollback) is eliminated entirely.

### Parsing speed

**Current**: `$.wrap()` does Map.get + Set.has + array mapping + Comment node creation for every wrapped node.

**Proposed**: Those 258 `$.wrap()` calls are deleted. The maps are still built in `set input` (same cost), but `getPrePost()` — which converts IToken[] to (Comment | string)[] and does the single-space optimization — is never called during parsing.

**Net**: **Faster parsing.** Comment node creation and array mapping are deferred to serialization (or skipped entirely if never serialized). Parse-time work is reduced.

### Evaluation speed

**Current**: `inherit()` copies pre/post. Various eval paths assign pre/post.

**Proposed**: None of that happens.

**Net**: **Faster evaluation.** 74 assignment sites eliminated.

## Migration Path

### Phase 1: Add trivia map to parse result and serialization

- Add `TriviaMap` type and `trivia` field to `IParseResult`
- Add `trivia` / `emittedTrivia` to `PrintOptions`
- Have parser return its existing maps as `trivia`
- Add `emitTrivia()` helper
- Wire `toString()` to call `emitTrivia` **in addition to** existing `processPrePost` (both systems active)
- Verify output is identical with both paths

### Phase 2: Remove `$.wrap()` from parsers

- Delete all 258 `$.wrap()` calls across productions
- Delete `wrap()`, `getPrePost()`, `usedSkippedTokens`, `usedSkippedTokensLog`
- At this point, `pre`/`post` are never set on parsed nodes — only API-created nodes may still use them
- Verify output is identical

### Phase 3: Remove pre/post from evaluation

- Delete all 74 `.pre`/`.post` assignment sites
- Add `_triviaOffsets` for the ~3 cases that need whitespace transfer (Reference, Operation, Call)
- Delete `adoptCallWhitespace`, `_normalizeFallbackArgSpacing`
- Simplify `inherit()`, `clone()`
- Verify output is identical

### Phase 4: Delete pre/post

- Remove `pre`/`post` properties from Node base class
- Delete `processPrePost()`, `stripPrePost()`
- Delete `signalBoundaryIntent()`, `captureWithMeta()` boundary-intent system
- Simplify `Sequence.toTrimmedString()` (remove capture/intent logic)
- Update tests

## Risks

1. **Formatting ownership / double-emit**: The consumed-set prevents double-emission, but edge cases around adjacent nodes sharing an offset boundary need testing.
2. **Whitespace transfer in eval**: The `_triviaOffsets` approach (Option A) needs careful testing for Reference, Operation, and Call — these are the cases where source whitespace must follow the result.
3. **Comment extraction for rule-level rendering**: `getRulesWithComments` needs a new implementation scanning the trivia map by offset range rather than extracting from pre/post arrays.
4. **Source maps**: Formatting tokens carry their own offsets — source map accuracy should be maintained, but needs verification.
5. **Large changeset**: 258 `$.wrap` deletions + 74 `.pre`/`.post` deletions + test rewrites. Phased migration reduces risk.

## Summary

| Metric | Current | Proposed |
|--------|---------|----------|
| Properties per node | 2 (pre, post) | 0 |
| Parser boilerplate | 258 `$.wrap()` calls | 0 (maps returned as-is) |
| Eval propagation sites | 74 `.pre`/`.post` assignments | ~3 `_triviaOffsets` tags |
| Serialization branching | 4-way per node | Map.get per node |
| New infra | — | `TriviaMap` type, `emitTrivia()` (~15 lines), `emittedTrivia` Set, `_triviaOffsets` (3 nodes) |
| Deleted code | — | `wrap`, `getPrePost`, `processPrePost`, `stripPrePost`, boundary-intent system, 258+74 call sites |
| Memory | 2 slots/node + arrays | 0 slots/node + existing maps (wash) |
| Parse speed | 258 wrap calls + Comment creation | 0 (deferred to serialization) |
| Eval speed | 74 propagation sites | 0 |
