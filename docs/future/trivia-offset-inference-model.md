# Trivia & spans: the positioned tree is the index

Branch: `feature/parseman`. Status: **consolidated design — preferred direction** (from a
design discussion, 2026-07-03). Related: [`whitespace-token-proposal.md`](whitespace-token-proposal.md)
(token-side capture). This note is the storage / reconstruction / indexing side, and
supersedes the earlier flyweight and per-gap-record sketches.

## Thesis

Most trivia carries no information that isn't already implied by the source offsets of the
tokens around it. A gap between token A (ending at 100) and token B (starting at 103) *is*
three characters of trivia — known without storing anything. So:

1. **Store only what offsets can't reconstruct** (comments, line breaks, mixed-indent).
2. **Reconstruct everything else by subtraction** (widths, indents, alignment, blank lines).
3. **Don't build a separate trivia index at all** — the positioned tree, whose slots already
   carry spans, *is* the ordered spatial index. Trivia is just the gaps between slots, and the
   only explicit entries are the sparse non-inferable ones hung off each slot.

The current `Map<offset, {start,end,src,hasComment}>` (one object + one map entry + an eager
`hasComment` scan + a print-time slice, paid even for a single `0x20`) is the wrong default:
the common gap is *one space, no comment*, and all four costs are for something inferable.

## 1. What to store — the non-inferable residue

- **Comments** — position + text. Not inferable. Sparse. "Whitespace in a gap" is then just
  *gap minus comment spans*.
- **Line-break offsets** — the atoms. Every spatial quantity below derives from these plus slot
  spans; the count gives blank-line structure for free.
- **Non-canonical indent runs** — *only* mixed tab/space (or tabs when column-accurate alignment
  is promised). Char-delta ≠ column-delta once a tab is in the indent, so the literal indent run
  must be stored for that line. Rare → sparse side-record, same shape as a comment. A
  space-based formatter drops this entry entirely.

Everything else evaporates from the store.

## 2. How to reconstruct — spatial quantities are subtraction

For a gap `[prevEnd, nextStart)`, given both slots carry spans:

- **Width** = `nextStart − prevEnd`. Never stored.
- **Composition (space vs tab)** — irrelevant under a space-normalizing printer. Not stored
  (except the mixed-indent case above).
- **Indent of a wrapped/next line** = `nextStart − lineStart`, where `lineStart` is the offset
  after the final line break in the gap. Store the *break position*, never the indent chars.
- **Hanging / relative alignment** = `(nextStart − lineStart) − (firstTokenStart − blockLineStart)`.
  All operands offset-derived; apply the delta on the *new* normalized base and intentional
  alignment survives normalization.
- **Blank lines** = count of breaks in the gap.

## 3. Precondition — every slot carries its offset (`fieldSpans`), string names included

The whole model is a chain of subtractions over slot offsets; a slot with no offset is a hole
in the chain. Bare-string leaves (an at-rule/declaration **name**, now `string | Interpolated`)
can't hold their own offset, so their span lives on the **parent**, indexed by child slot:
`fieldSpans[slot] = [start, end]` (E6 direct-field spans; `childKeys` order — AtRule
`['name','prelude','rules']`, Declaration name at slot 0).

This is also the real fix for the dropped name-boundary trivia bug: it fails only because
`emitCommentTriviaBetweenNodes(name, prelude)` reads `name.spanEnd` and a string has none. The
answer is **not** a synthetic `spanStart + name.length` (works only because names happen to
lead) — it's `fieldSpans`, *because* `fieldSpans` is what makes the gap-from-delta inference
hold uniformly for string and node children alike. The bug and the storage model want the same
structure.

## 4. Data structure & positional queries — the winner

A hash `Map<offset, Trivia>` can only answer *exact-key* lookups (it works today only because
callers pass a known `node.spanEnd`). Ask "trivia before an arbitrary offset X" and it's stuck —
no "nearest key ≤ X." Positional queries need an **ordered** structure. Two levels:

**(a) One monotonic boundary stream.** Model the store as a single sorted sequence of events —
`slotStart`, `slotEnd`, `comment`, `lineBreak`. Parsing emits left-to-right, so it comes out
**sorted for free** (no sort step). Then:

- **"trivia before X"** = binary-search X, walk left to the previous slot boundary; width =
  `X − prevEnd`, and any `comment`/`lineBreak` events in that interval come with it. O(log n).
- **"span of slot i"** = the same array. One index answers span *and* trivia — the combined
  SpanMap+TriviaMap.

Because gaps are disjoint and ordered, a flat sorted array suffices — no interval tree. And the
current **double-indexing collapses**: today the same physical gap is keyed twice (the left
token's `after` *and* the right token's `before` point at one shared run). In the interval model
there is one gap between two boundaries — indexed once.

**(b) The tree already is that stream.** You don't have to materialize a global array. The
positioned tree is a sorted spatial index: children are in source order, each carrying
`fieldSpans`. So "trivia before X" = descend to the node whose span contains/precedes X, then the
gap before that slot is `X − prevSiblingEnd`, with the non-inferable records (comments, line
breaks, and any mixed tab/space indent runs) hanging off the slot as sparse side-data. **No
`TriviaMap`, no `SpanMap`** — the tree answers both; the only explicit storage is those sparse
per-slot records.

**Relative offsets make it edit-stable.** Store slot spans relative to the parent; a query is
tree descent (accumulate the base) + local binary search within a node's few children —
Lezer-`TreeCursor` shaped, O(log n) descent + O(log k) local. An edit localizes to one container
instead of shifting a global absolute array. Same combined index, rebased per node. Expose an
**absolute view on query** (the descent accumulates it) so a one-shot printer pays nothing extra
while an incremental language service gets edit-stable storage — two manifestations, one source
of truth.

## What this collapses in `trivia.ts`

- `Map<offset, {start,end,src,hasComment}>` (×2, before/after) → sparse per-slot records
  (comments, line breaks, mixed-indent runs); plain-whitespace gaps inferred, not stored.
- Eager `hasComment` scan per run → gone (comments are their own records; whitespace gaps are
  never scanned).
- `emitCommentTriviaBetween*` / `emitCommentTriviaAfterNode` → resolve against slot spans + the
  break list; string names stop being a special case.
- Before/after duality → single-interval lookups.

## Open questions / measure first

- **Sizing**: fraction of captured runs that are pure-whitespace-no-comment? Expected >90% —
  decides priority (worth it on the language-service/formatter path; the hot compile path already
  skips capture by default).
- **Capture tier**: today's `skip | full`; add a middle `comments + line-structure` tier for
  normalizing consumers, keeping `full` only for faithful byte-round-trip mode.
- **Where the sparse records live**: per-node side-arrays vs a per-container list; interaction
  with incremental reparse and with `fieldSpans`/`valueSpans` already on the node.
- **Relative rebasing granularity**: per-parent-slot vs per-container.
- **Tab policy**: declare the formatter space-based (drop the mixed-indent record) or support
  column-accurate mixed indent (keep it).
