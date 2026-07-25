# STRINGS-OVER-NODES — how a bare string keeps span + trivia without a node

Status: **canonical design.** This is the reference every node/parser/selector agent
follows when carrying a simple token (a selector, combinator, ident, name, keyword,
property) as a **plain string** in a container's value array instead of allocating a
node (`Any`/`BasicSelector`/`Combinator`/`Keyword`). Base: `origin/work/cutover-p1`
(`587d56140`). All mechanisms cited below are ALREADY LIVE in the base — this doc
canonicalizes them so the reduction stops getting reverted.

## The problem (why this doc exists)

The compiler reduces object churn by carrying simple tokens as bare `string`s. A node
like `Any`/`BasicSelector`/`Combinator` is allocated ONLY where a token has genuine
eval/structural behavior. This reduction has been **repeatedly reverted** by agents.
The owner's diagnosis of *why*: an agent sees that a node carries a **source span** and
**captured trivia** (the whitespace/comments around it), can't see how a bare string
keeps those, and "fixes" it by wrapping the string back into a node. That revert is the
anti-pattern this doc kills.

The answer, in one sentence: **a bare string needs no span and no per-token object —
its source POSITION (only when needed) comes from a per-slot span keyed by its
container + slot index, and the trivia around it comes from an OFFSET-KEYED trivia map
built from the CST, retrieved at serialize time.** Neither is a node field; neither
allocates per token.

---

## 0. Two concerns, deliberately separated

An agent conflates these two; they have DIFFERENT answers. Keep them apart.

| Concern | Granularity | Where it lives | Does a bare string carry it? |
|--------|-------------|----------------|------------------------------|
| **Source-map span** | COARSE — rules/decls/at-rules only | inline `_spanStart/_spanEnd` on the few coarse nodes | **No.** Strings below rule granularity carry no span. |
| **Trivia** (ws/comments between tokens) | fine — every gap | OFFSET-keyed `TriviaMap` on the tree context (built from CST) | **No object.** Retrieved by offset at serialize time. |

The recurring revert treats both as "a field on a node." Neither is.

---

## 1. Source-map spans are COARSE — strings below rule granularity carry NONE

### 1.1 What the source map actually anchors to (evidence)

The source-map generator (`tree/util/print.ts` `OutputWriter.add(text, origin)` →
`markSource` → `sourceSegmentFor`, and `tree/util/sourcemap.ts`) emits a mapping segment
**only when the `origin` passed to `add` resolves to a source offset**:

```ts
// print.ts sourceSegmentFor()
const offset = origin ? spanStartOf(origin) : undefined;
if (typeof offset !== 'number') { return undefined; }   // ← no span ⇒ no segment
```

`spanStartOf(origin)` reads the node's inline `_spanStart`, which is present ONLY when
`setSourceSpan` stamped it (flag `F_HAS_SPAN`). The source-map tests
(`tree/util/__tests__/sourcemap.test.ts`) prove the granularity: every test stamps the
span on the **declaration / rule node** —

```ts
const root = rules([ decl({ name: 'color', value: any('red') }) ], …, treeContext);
setSourceSpan(firstRule, { start: 0, end: 11 });   // the DECLARATION, not `red`
```

— and asserts the segment lands at the declaration's line/col. The `value` node
(`any('red')`) carries **no span** and produces **no segment**, and the test does not
expect one. Nested rules stamp the span on the inner decl (`setSourceSpan(rs[0], …)`),
never on selectors, combinators, or value leaves.

### 1.2 Consequence for the string reduction

Source maps only need to point a generated line/col back to the **rule/declaration/at-rule**
it came from — NOT to each selector, ident, combinator, or keyword. Those leaf tokens
are below source-map granularity. Therefore:

- **A bare-string selector / combinator / ident / keyword / property needs NO span for
  source maps.** It emits with no origin (`writer.add(item)` — see
  `selector-list.ts:34`, `emitSelectorListItem`), contributes no segment, and the map
  is correct.
- eval-created value nodes are already source-free (`F_HAS_SPAN` clear) for the same
  reason; the string form is strictly leaner (no object at all) and behaves identically
  for source maps.

Spans live only on the **handful of coarse anchor nodes** (Ruleset / Declaration /
AtRule / at-rule-statement). Those stay nodes for independent reasons (they have
structure and eval behavior); their span is one inline field pair, not per-token churn.

### 1.3 KEY FINDING — the per-slot-SPAN revert was based on a false premise

History carries a revert (`a0d337234` doc-note; the earlier drop reverted, then
re-enabled by `311cf9232`) that RE-ADDED per-slot value/field spans on the theory that
bare-string members needed to carry source position. Under §1.1 that premise is **false
for source maps**: per-token position is below source-map granularity, so per-slot
spans were NEVER needed *for source-mapping*. The correct fix for the source-map concern
is **"carry no per-token span at all,"** not "find a clever place to store a per-token
span."

Per-slot spans (`valueSpansOf`/`fieldSpanAt`) do survive in the base, but for a
**different and narrower** reason — see §2.3. They are NOT a source-map mechanism and
must not be justified as one. Do not re-nodify a string to give it a source-map span:
the map does not want one.

---

## 2. Trivia — the real remaining need, solved with ZERO per-token allocation

Whitespace and comments *between* string tokens must round-trip (`.a/*c*/.b`,
`#comments /* boo */, .comments`, `a: yes /* comment */`). This is the concern that
actually bites — and it is solved without a node or a per-token object.

### 2.1 Trivia is OFFSET-keyed, built from the CST — not node-keyed

Trivia lives in a `TriviaMap` on the tree context (`node.sourceRoot._treeContext.opts.trivia`),
built once at parse time. Its shape (`types/index.ts`, `tree/util/trivia.ts`):

- `TriviaMap.lookup(offset, 'before'|'after') → Trivia | undefined` — two `Map<number, …>`
  indexes keyed by **source offset**, NOT by node identity.
- A `Trivia` run is `{ start, end, hasComment, src }` — a source RANGE. Its text is
  sliced from `src` **on demand at print time** (`printableTriviaText`). No per-token
  object is materialized; the same run object is shared by its `before`(end) and
  `after`(start) keys and deduped by identity via `options.emittedTrivia`.

This mirrors the parseman CST exactly. In parseman (`parser-thing/src/cst/trivia-index.ts`),
`buildTriviaIndex` walks nodes carrying `triviaLog` (flat `[start, end, insertIdx]`) +
`rawChildren` and registers each captured run under **`rawChildren[insertIdx].span.start`
(before) and `rawChildren[insertIdx-1].span.end` (after)** — i.e. keyed to the source
OFFSETS of the surrounding structural items, never to a token node. The result is
`{ before: Map<number,…>, after: Map<number,…> }`, the same offset-keyed shape jess's
`TriviaMap` consumes. **Trivia between two tokens is captured relative to source
positions; a token needs only its offset — not a node — to retrieve the trivia around
it.**

### 2.2 Retrieval path for a bare string at serialize time

To place a comment adjacent to a bare-string member, the serializer needs the string's
`start`/`end` OFFSET (to key the lookup). Two sources supply it with no per-token
storage:

1. **In-span comment sweep (preferred for adjacent leaf strings).** The container node
   keeps its own coarse `[spanStart, spanEnd]`; `commentRunsWithinSpan(trivia, start, end)`
   binary-searches the comment-bearing runs falling inside that range and returns them in
   source order. The writer emits one per gap as it walks the string members. This needs
   **no per-member offset at all** — only the container's span. Live in
   `CompoundSelector.writeSyntax` (`selector-compound.ts:158-174`, `emitCompoundPart`):
   string parts (`.a`, `.b`) emit directly, and a comment between them
   (`.a/*c*/.b`) round-trips via `commentRunsWithinSpan` keyed by the compound's own span.

2. **Per-slot span (only where members are separated by a delimiter carrying trivia on
   both sides).** For a comma-separated selector list (`#comments /* boo */, /* of */
   .comments`) or a declaration value with a trailing comment (`a: yes /* comment */`),
   the writer needs the member's end (to look `after`) and the next member's start (to
   look `before`) precisely. A bare-string member has no node to read `spanEndOf` from,
   so the container carries a **per-slot span array** and the string recovers its offset
   from it:

   ```ts
   // selector-list.ts emitSelectorListItems()
   const prevEnd = typeof prevItem !== 'string'
     ? spanEndOf(prevItem)              // node member: read its own span
     : spans?.[i - 1]?.end;             // BARE STRING: recover end from per-slot span
   emitCommentTriviaAfterOffset(trivia, prevEnd, printOptions);   // "#comments /* boo */,"
   …
   const nextStart = typeof item !== 'string'
     ? spanStartOf(item)
     : spans?.[i]?.start;               // BARE STRING: recover start from per-slot span
   emitTriviaTokens(consumeTrivia(trivia, nextStart, 'before', …), …);  // ", /* of */ .comments"
   ```

   Declaration value: `_valueFieldSpanStart()` (`declaration.ts:641`) reads
   `fieldSpanAt(this, childKeys.indexOf('value'))` — the bare-string value's offset keyed
   by **(this declaration node, the `value` slot index)**.

`emitCommentTriviaAfterOffset` (`trivia.ts:262`) exists precisely "for members that carry
no node identity (a bare-string declaration value / selector-list member) whose end
offset comes from a per-slot span." That is this mechanism, already named in the code.

### 2.3 Per-slot spans: what they ARE (and are NOT)

`setValueSpans`/`setFieldSpans` (`tree/util/provenance.ts`) store per-slot spans as a
FLAT PACKED SMI array `[start0,end0,start1,end1,…]` in a module-level
`WeakMap<node, number[]>`, gated by `F_HAS_VALUESPANS`/`F_HAS_FIELDSPANS`:

- **Sparse.** Set ONLY on source-parsed multi-member selector lists / value arrays.
  Zero eval nodes carry them. A non-carrying node pays **one bitwise-and** to skip the
  lookup (`(node.flags & F_HAS_VALUESPANS) === 0`).
- **One array per CONTAINER, not one object per token.** A 5-member selector list holds
  ONE `number[]` of length 10 — not 5 span objects, not 5 wrapper nodes. This is the
  whole point: it does not trade node churn for object churn (see §3).
- **NOT a source-map mechanism** (§1.3). They exist solely to give a delimiter-separated
  bare-string member the precise offset needed to key a `before`/`after` trivia lookup
  (the §2.2 case 2). When the container's in-span sweep (§2.2 case 1) suffices, per-slot
  spans are not needed at all.

Whether per-slot spans are needed for a given container is a **serialize-correctness**
question (does a delimiter sit between members with trivia that must attach to a
specific side?), not a source-map question.

---

## 3. Perf + churn analysis (why it's neutral, no new per-token allocation)

The mechanism must not trade node allocation for a different allocation. It does not:

- **Strings that need neither span nor delimiter-precise trivia** (the vast majority:
  every selector/ident/combinator/keyword below rule granularity) allocate **nothing** —
  no node, no span object, no trivia object. This is a strict reduction vs. `new Any(...)`.
- **Trivia runs** are RANGES (`{start,end,src}`) sliced on demand and shared/deduped by
  identity; the count of run objects equals the number of whitespace/comment runs in the
  SOURCE, independent of how many tokens are strings vs nodes. Converting a token from a
  node to a string changes the trivia object count by ZERO.
- **Per-slot spans** are ONE flat SMI array per source-parsed container, in a WeakMap off
  the Node shape — not per token, not per member. A container that has them replaces N
  member-node span fields with one packed array; a container that carried string members
  all along adds one array only if it hits the §2.2-case-2 shape. No `{start,end}` object
  is allocated per slot (`valueSpanAt`/`fieldSpanAt` read the flat array directly;
  `valueSpansOf` rebuilds objects lazily only for the few array-shaped callers).
- **Hot path cost for source-free strings/nodes**: a single `(flags & F_HAS_*) === 0`
  bitwise-and to skip every side-table lookup. Node base shape is unchanged (still only
  `_spanStart/_spanEnd` inline), so eval's millions of source-free nodes do not
  deoptimize.

Net: moving a token from `new Any(text)` to a bare `string` **removes** an allocation and
adds nothing on the common path. Spans/trivia for the rare delimiter case are
per-container, not per-token.

---

## 4. The rule — WHEN a node is still required vs. when a string suffices

Allocate a node ONLY when the token has **genuine eval or structural behavior**:

**String suffices (do NOT allocate a node):**
- A static selector / combinator / ident / name / keyword / property with no
  interpolation and no math — e.g. `.a`, `>`, `color`, `red`, `solid`. It is inert at
  eval (passes through unchanged — see `CompoundSelector.evaluateComponents`,
  `SelectorList.evaluateSelectors`: `if (typeof item === 'string') { pass through }`).
- The constant `'!important'` flag (no eval behavior; `Declaration.important` is already
  typed `… | string`; serialization already branches on `typeof important === 'string'`).

**Node still required (keep it):**
- **Interpolation** — `@{v}` / `${…}`: `Interpolated` (has a role + eval identity).
- **Math / coercion identity** — a value that participates in `Operation`, `List`,
  `Reference`, or flows into node-only machinery as a computed value: `Any`/`Dimension`/
  `Color`. (The `Any`/`Keyword` classes stay as the lazy-coercion target for bare value
  strings and the eval-output value node — answer to the `any.ts` AUDIT comment: "yes,
  still needed, but only as eval-output / lazy-coerce, not as a wrapper for static parse
  tokens.")
- **Structural nodes** — Ruleset / Declaration / AtRule and the coarse anchors: they have
  structure, eval, and hold the coarse source-map span.

Lazy coercion already bridges the two: `DeclarationValue.value` is
`Node | string | DeclarationValueSegment[]`, coerced to `Keyword`/`Dimension`/`Color`
**only when a real node is needed** (`util/evaluate-node-array.ts` `coerceStringTerminal`,
`declaration.ts` `valueNode()`). The string stays a string until eval genuinely needs a
node.

---

## 5. DO NOT wrap a string in a node to get spans/trivia — do this instead

> **If you are about to wrap a bare string back into a node because "it needs a span /
> it needs to carry its comment," STOP. The string does not need either as a field.**

- **"It needs a source-map span."** → It does not. Source maps are COARSE (§1): they
  anchor to the rule/declaration/at-rule, not to leaf tokens. A leaf string emits with no
  origin and contributes no segment; that is correct. The span lives on the coarse
  ancestor node, which already exists. (Re-nodifying to add a per-token span repeats the
  `a0d337234` mistake — §1.3.)

- **"A comment between two string members disappears."** → Use the container's
  **in-span comment sweep**: `commentRunsWithinSpan(trivia, spanStartOf(container),
  spanEndOf(container))` and emit one run per gap (pattern:
  `CompoundSelector.writeSyntax` / `emitCompoundPart`). No per-member offset needed.

- **"A comment must attach to a SPECIFIC side of a delimiter (`, ` / trailing value
  comment)."** → Give the CONTAINER a per-slot span array (`setValueSpans` /
  `setFieldSpans`) and recover the member's offset from it, then key the offset-based
  trivia emit (`emitCommentTriviaAfterOffset` / `consumeTrivia(…, nextStart, 'before')`).
  Pattern: `emitSelectorListItems` / `Declaration._valueFieldSpanStart`. This is ONE
  packed array on the container — not a node, not a per-token object.

- **"The parser has a span for this token, so I'll keep the node to hold it."** → Stamp
  the span where it is actually consumed: on the coarse node (for source maps) or as one
  slot of the container's per-slot span array (for delimiter-precise trivia). Do not
  resurrect a token node to be a span envelope.

---

## 6. Acid test — would this have prevented the known reverts?

Two reduction reverts are on record. The mechanism above handles both, with the live
code + a repro test as proof.

### 6.1 Selector-header-trivia revert (`c7d7ae38b` reverts `959bd3e6e`) — PREVENTED

The reverted fix (`959bd3e6e` "preserve less selector header trivia") tried to keep
comments in `#comments /* boo */, .comments` and `.selector /* .with */, .lots, /* of */
.comments` by **slicing raw source text** (`source.slice(selector.location[0], …)`) and
comparing whitespace-normalized "comparables" — a brittle heuristic reading the
now-deleted 6-tuple `location`. It was reverted.

The CURRENT mechanism solves the SAME fixtures properly, for bare-string members, with
no text-slice heuristic:

- `emitSelectorListItems` (`selector-list.ts:395-419`): `prevEnd = spans?.[i-1]?.end` for
  a bare string → `emitCommentTriviaAfterOffset(trivia, prevEnd, …)` places
  `/* boo */` after `#comments`; `nextStart = spans?.[i]?.start` →
  `consumeTrivia(trivia, nextStart, 'before')` places `/* of */` before `.comments`.
- Repro (`tree/__tests__/perslot-spans.test.ts`, "emits a comment between BARE-STRING
  selector-list members"): `SelectorList.create(['#comments', '.comments'])` (bare
  strings, no nodes) + `setValueSpans(list, [{0,9},{21,30}])` + offset-keyed trivia →
  `/* boo */` round-trips before the comma. **No node, no source-slice.**

Because trivia is offset-keyed from the CST and the member offset comes from the
container's per-slot span, the fix does not depend on member node identity — so the
reduction to bare strings would NOT have broken it, and there is nothing to re-nodify.

### 6.2 Per-slot-SPAN revert (`a0d337234`) — shown UNNECESSARY *for source maps*, correct mechanism identified

The per-slot-span drop was reverted on the premise that bare-string members needed to
carry source position. Under §1 that premise is false **for source maps** (per-token
position is below source-map granularity — §1.3). The mechanism the revert should have
reached is the narrow one now live (`311cf9232`): per-slot spans are a **serialize-time
trivia-offset source** for the delimiter case (§2.2 case 2), stored as ONE packed SMI
array per container in a WeakMap — not a per-token span, not a node field, not a
source-map anchor. So: the string reduction was correct; the "re-nodify to carry a span"
reflex was wrong; and the legitimate residual need (delimiter-precise trivia offsets) is
met by a per-container array, not per-token objects.

Repro for the bare-string declaration value (`a: yes /* comment */`):
`decl({ name:'a', value:'yes' })` (value is a bare STRING) + `setFieldSpans(node,
[undefined, {3,6}, undefined])` + offset-keyed trivia → trailing `/* comment */`
round-trips via the `value` field span. **No `Any` wrapping the value.**

---

## 7. Concrete representation (the canonical examples)

### 7.1 Selector list `#comments /* boo */, .comments`

```ts
SelectorList.value = ['#comments', '.comments']         // bare strings, no nodes
// coarse span on the list node (for the ruleset header):
setSourceSpan(list, { start: 0, end: 30 })
// per-slot member offsets on the CONTAINER (one packed array, WeakMap):
setValueSpans(list, [{ start: 0, end: 9 }, { start: 21, end: 30 }])
// trivia OFFSET-keyed on the tree context (built from CST, shared runs):
trivia.after.get(9)  // → { start:9, end:20, hasComment:true, src }  (" /* boo */,")
```
Serialize: `emitSelectorListItems` emits `#comments`, then (prevEnd=9)
`emitCommentTriviaAfterOffset(trivia, 9)` → `/* boo */`, then `,\n`, then `.comments`.

### 7.2 Complex selector `.a > .b`

```ts
ComplexSelector.value = ['.a', '>', '.b']   // simple selectors AND combinator are strings
```
No spans needed: adjacency is fixed, whitespace around a string combinator is normalized
(`selector-complex.ts` `isStringCombinator` → `w.add(' > ')`). Comments between compound
parts round-trip via the compound's in-span sweep (§2.2 case 1). No node for `.a`, `>`,
or `.b`.

### 7.3 Declaration `a: yes /* comment */`

```ts
Declaration.value.value = 'yes'   // bare string, NOT any('yes')
setSourceSpan(decl, { start: 0, end: 20 })          // coarse (source map anchors here)
setFieldSpans(decl, [undefined, { start: 3, end: 6 }, undefined])  // value slot = idx 1
trivia.after.get(6)  // → " /* comment */"
```
Serialize: emits `a: yes`, then `_valueFieldSpanStart()`/value fieldSpan end (6) keys the
trailing comment. Source map: one segment at the declaration's offset 0 — the `yes` value
contributes none.

---

## 8. GAPS surfaced for the owner

No gap blocks the string reduction under the current side-table + CST model. Two items
are adjacent (documented so an agent does not mistake them for a blocker):

1. **Cross-grammar `//` in composed value rules** (from `parseman-trivia-audit.md` §2):
   jess's `//` line comments are not skipped inside CSS-composed `value`/`valueList`
   rules because `compose()` bakes the base grammar's CSS trivia. This is a parseman
   compiler concern (Option A/B in that audit), independent of strings-over-nodes — it
   affects how trivia is CAPTURED, not how a bare string retrieves it. Not a gap for this
   design.

2. **Per-slot spans require the parser to STAMP them** on source-parsed multi-member
   containers where a delimiter carries side-specific trivia (§2.2 case 2). This is
   producer-side wiring (parser sets `setValueSpans`/`setFieldSpans`), gated on the
   deferred producer flip. The core CONSUMER path is already string-ready (this doc). Not
   a gap in the mechanism; a sequencing note for the producer pass.
