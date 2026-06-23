# Parséman Migration — Goals & Scope Review

## What This Branch Is

`feature/parseman` branches from `feature/scanner-first-parser-docs`, which was exploratory work on a "scanner-first" lazy parsing strategy. It contains:

1. **`packages/css-parser`** — production Chevrotain-based CSS parser (78 token types, ~4,000 lines of grammar, Chevrotain `EmbeddedActionsParser`)
2. **`packages/less-parser`** — Less extension of css-parser (~5,400 lines, overrides + extends CSS grammar)
3. **`packages/parser`** — prototype hand-written recursive descent runtime + scanner helpers; was exploring a scanner-first approach but is not the path forward
4. **`packages/parser-runtime`** — companion to `@jesscss/parser`
5. **Node improvements in `packages/core`** — direct field storage on AST nodes, removed `NO_VALUE` sentinel, lazy line/column mapping

---

## What the Experimental Branch Was Trying to Do

The `@jesscss/parser` package explored a "scanner-first" model:

```
1. Cheap boundary scan — find blocks, statements, declarations without tokenizing
2. Create real core AST nodes immediately, but with string fields (name: 'color', value: 'rgb(...)') 
3. Defer field parsing — only tokenize/parse a field if evaluation/extend-matching actually needs it
4. Lazy line/column — store byte offsets only; compute lines on demand
```

**Motivation**: CSS parsing is often over-eager. IDEs, formatters, and even the evaluator can often work from boundaries + string values. Full Chevrotain tokenization is expensive and produces large error objects during speculation.

**Current state of that experiment**: The first prototype (parallel `StructuralDocument` tree, `RawIslandNode` wrappers) was deleted as of recent commits. What remains is the scanner helper functions and source text utilities.

---

## Goals Under Consideration

### G1: Replace Chevrotain in `css-parser` with Parséman ✅ HIGH PRIORITY
- Mechanical translation: Chevrotain `EmbeddedActionsParser` rules → Parséman combinators
- Maintain identical AST output (same `@jesscss/core` nodes)
- All existing css-parser tests must pass
- Use Parséman macro build (bundler plugin) for production performance

### G2: Replace Chevrotain in `less-parser` with Parséman ✅ HIGH PRIORITY
- Same as G1, after G1 is complete
- Less parser extends CSS parser — the Parséman version should do the same

### G3: Keep the Node improvements from this branch ✅ HIGH PRIORITY
- Direct field storage on AST nodes (vs getter/setter patching)
- Removed `NO_VALUE` sentinel
- `fieldSpans?: number[]` for compact offset storage
- These are independent of the parser strategy and look solid

### G4: Use scanner helpers as a structural pre-pass ⏳ PHASE 2
- The `@jesscss/parser` scanner helpers (cheap boundary detection) could become a fast structural first pass
- Parséman would handle detailed parsing within already-located spans
- **Decision**: Do this only if Parséman-based full parsing benchmarks poorly. Treat it as a targeted optimization, not a prerequisite.

### G5: Targeted string preservation for high-frequency, low-utility nodes ⚠️ IN SCOPE — SELECTIVE
- **Not** a universal lazy-hydration system. The goal is to cut object allocation on paths that don't need it.
- **Root problem**: Jess creates too many intermediate objects → slower than Less.js at evaluation. A declaration value that is never calculated or passed to a function has near-zero value as a CST node tree.
- **Approach**: On a case-by-case basis during G1/G2, identify nodes where preserving as a string is correct:
  - **Declaration values** — if no math, no function calls, no interpolation, the value can stay `string` on the node rather than a typed child list
  - **Selectors** — if not being extended against or structurally compared, the selector text can stay `string`
  - **At-rule preludes** — media queries, layer names, etc. often only need the raw string until they're evaluated
- **Mechanism**: Parséman `transform()` callbacks decide — call into a value parser and return a node, or just return the matched string if the grammar recognizes a "simple" case
- **NOT doing**: Universal `get value() { parse on demand }` infrastructure; per-field deferred parse tables; changes to all visitors
- **Tracking**: When we encounter a high-frequency rule during G1/G2, annotate it with a `// PERF: consider string` comment and collect them. Make the call before landing G1.

### G6: Lazy line/column mapping ✅ LOW EFFORT, KEEP
- `SourceText` + `LineMap` from `@jesscss/parser` — compute line/col lazily via binary search
- This is already implemented and used in the scanner proof; just keep it

### G7: Remove `@jesscss/parser` hand-written parser base ✅ IMPLICIT
- `RecursiveDescentParser` in `@jesscss/parser` was a prototype for a parsing approach that Parséman supersedes — Parséman is better designed, tested, and has macro support
- The `@jesscss/parser` package should be removed after G1/G2, not treated as a foundation for anything

---

## Proposed Scope for This Branch

**In:**
- G1: css-parser → Parséman (all tests passing)
- G2: less-parser → Parséman (all tests passing)
- G3: Node improvements (already on branch, keep)
- G5 (selective): During G1/G2, identify high-frequency nodes that are cheaper as strings; annotate and decide before landing
- G6: Lazy line/col (already on branch, keep)

**Out (phase 2 or later):**
- G4: Scanner-first structural pre-pass (revisit if G1/G2 parse speed is unsatisfying)
- G5 (universal): Per-field deferred parse tables, lazy hydration infrastructure, visitor changes

**Remove from branch:**
- `@jesscss/parser` `RecursiveDescentParser` base class — replaced by Parséman
- `@jesscss/parser-runtime` — replaced by Parséman
- The Chevrotain dependency in css-parser and less-parser (after tests green)
- Scanner helper functions in `@jesscss/parser`: **keep** as standalone utilities (findBalancedBlockEnd, scanCheapSelectorListComponents, etc.) — potentially useful for G4 later and cost nothing to retain

---

## Implementation Sequence

### Phase 0 — Prerequisites (before writing any grammar)

**P0a: Audit core node naming**
- Read `packages/core/src/tree/` to catalog the actual node type names used in Jess (not assumed names like `FunctionNode`/`NumberNode`)
- Identify which nodes are produced by css-parser and less-parser today — these are the output types the Parséman grammar must produce

**P0b: Decide Parséman API approach and resolve NodeLike** ✅ RESOLVED

**Decision: class-based `Parser<JessNode>` API.** Grammar inheritance (`LessParser extends CssParser`) and incremental re-parsing (`ParseDoc.edit()`) both require the class-based API. Functional combinators have neither.

**Both APIs are in development — we adapt both sides to meet cleanly.** Neither Parséman's interface nor Jess's node shape is sacred. What follows is the agreed-upon contract between them.

---

### NodeLike gap analysis

Parséman's incremental engine requires nodes to satisfy:

```ts
type NodeLike = {
  readonly _tag: 'node'
  readonly type: string
  readonly span: Span     // { start: number; end: number }
  readonly state: unknown // renamed from 'savedContext' — parse context snapshot per node
  readonly children: ReadonlyArray<{ readonly _tag: string }>
}
```

The `rebuild()` method on `Parser<N>` calls `buildNode()` — NOT object spread. So class instances with non-enumerable properties are fine; `rebuild` reconstructs via our `buildNode` override.

---

### Changes required in Parséman (`parser-thing`)

1. **Rename `ctx.user` → `ctx.state`** across `ParseContext`, `NodeLike`, and `buildNode`. The old name was meaningless ("a user's session?"). `state` makes clear it's per-grammar state snapshotted at each node for incremental re-parse resume.
2. **Rename `NodeLike.savedContext` → `NodeLike.state`** to match.

These are pure renames — no semantic change, just naming clarity.

---

### Changes required in Jess core (`packages/core/src/tree/node-base.ts`)

Four additions to the `Node` base class:

**1. `_tag` discriminant**
```ts
readonly _tag = 'node' as const
```
Simple addition. Used by Parséman's incremental engine to distinguish nodes from leaves.

**2. `span` getter**
```ts
get span(): Span {
  return { start: this._location?.[0] ?? 0, end: this._location?.[3] ?? 0 }
}
```
Maps the existing `_location` tuple to Parséman's `Span` shape. No new storage needed.

**3. `state` field — requires renaming Jess's existing `state` bitmask**

Jess `Node` already uses `state: number` for bitmask flags. `NodeLike.state: unknown` conflicts. Resolution: rename the bitmask to `flags` — a better name for a set of flags anyway — and free up `state` for the Parséman snapshot.

```ts
flags: number = F_DEFAULT  // was: state — bitmask of F_VISIBLE, F_STATIC, etc.
state: unknown = undefined  // Parséman parse context snapshot, set by buildNode
```

`addFlag()`, `removeFlag()`, `hasFlag()` update to reference `this.flags`. The public rename from `node.state` → `node.flags` is a breaking change to Jess callers but correct — "flags" is a clearer name for a bitmask. Set by `buildNode` at parse time (e.g., `{ mode: 'less' }`); passed back via `rebuild()` during incremental re-parse.

**4. Drop generators — store `children` as a property**

Jess currently has `*children(deep?, reverse?)` as a generator method. Generators conflict with `NodeLike.children` (a readonly array property) and add complexity.

Replace with:
```ts
// stored by buildNode; Parséman's structural child list (nodes + leaves)
private _children: ReadonlyArray<JessNode | CSTLeaf | CSTError> = []

get children(): ReadonlyArray<JessNode | CSTLeaf | CSTError> {
  return this._children
}
```

The old generator walked `childKeys` fields — callers can now just iterate `this.children` directly. Any code still needing deep traversal can do so over the array. The `childKeys` static stays for `buildNode` to know which fields to populate.

---

### How `buildNode` bridges the two

```ts
// In JessParser extends Parser<JessNode>:
protected buildNode(
  type: string,
  span: Span,
  children: ReadonlyArray<JessNode | CSTLeaf | CSTError>,
  state: unknown,
): JessNode {
  const node = new JessNodeRegistry[type]()
  node._location = [span.start, 0, 0, span.end, 0, 0]  // line/col filled lazily
  node.state = state
  node._children = children
  // populate semantic fields from children (declarations, selectors, etc.)
  populateFields(node, type, children)
  return node
}
```

`rebuild(node, newChildren)` already calls `buildNode(node.type, node.span, newChildren, node.state, [])` — so incremental reconstruction goes through our override and produces proper Jess class instances.

**P0c: Install local Parséman**
- Add `parseman` as a workspace dependency in `packages/css-parser/package.json`
- Confirm the macro plugin can run in the Jess build (likely Rollup — check `packages/css-parser/rollup.config.*`)

### Phase 1 — css-parser

4. **Write Parséman CSS parser** in a new file alongside the existing Chevrotain parser (both coexist)
5. **Get all css-parser tests green** against the Parséman implementation
6. **Switch css-parser to Parséman only** — remove Chevrotain dependency

### Phase 2 — less-parser

7. **Write Parséman Less parser** extending the CSS parser combinators
8. **Get all less-parser tests green**
9. **Remove Chevrotain** from less-parser

### Phase 3 — Cleanup

10. **Remove `@jesscss/parser` `RecursiveDescentParser` base class** — replaced by Parséman
11. **Remove `@jesscss/parser-runtime`** if nothing else depends on it
12. **Retain** scanner helper functions from `@jesscss/parser` (findBalancedBlockEnd, etc.) as standalone utilities

---

## Key Files

| File | Purpose |
|---|---|
| `packages/css-parser/src/cssTokens.ts` | 78 token types — reference for Parséman regex/literal definitions |
| `packages/css-parser/src/productions/` | Grammar rules to translate (~4,000 lines) |
| `packages/less-parser/src/productions/` | Less grammar extensions (~5,400 lines) |
| `packages/core/src/tree/` | AST node types — output shape we must preserve |
| `packages/parser/src/source-scanner.ts` | Scanner helpers (boundary finding) — potentially reusable |
| `packages/parser/src/selector-scanner.ts` | Cheap selector scanning — potentially reusable |
