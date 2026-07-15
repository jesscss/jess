# Jess AST from scratch: speed-first design

Status: design evidence and POC queue, 2026-07-14.

This is a design record for the Q-40 performance program. It is not permission
to rewrite the tree or to trade away Less semantics. Every production change
must first prove a real shape on `benchmark.less` or a representative fixture,
preserve Jess byte output, and pass the core, spine, all-less, and aggressive
cutting gates.

## What the current evidence says

The current Jess tree is not slow because one universal node class is
intrinsically wrong. The expensive shape is the accumulation of work across
parse, placement evaluation, fallback preparation, lookup/traversal, and
serialization. The current canonical measurements are recorded in
`CORE-CLEANUP.md` under Q-40:

- Jess is roughly 239 ms parse-plus-render and 203 ms render-only on the
  canonical `benchmark.less` run, versus roughly 31 ms for Less render.
- Parseman recognizer-only is about 12.6 ms, so AST construction is not the
  whole parser gap. The recognizer itself still pays generated frame/context
  work and is not a compile-time stripped `voidOf` parser.
- The evaluator has already demonstrated a serious category error: a recursive
  merge-presence discovery pass scanned 69,901 child items to find 15
  feature-bearing surfaces. The fix is to carry the fact at the producer, not
  to add a better search.
- The common tree is mostly static declarations and values, but Less's
  dynamic islands are real: variable rebinding, source-order lookup, mixins,
  detached rulesets, interpolation, imports, guards, plugins, and extend.

The design target is therefore: make the common path structurally cheap and
make every dynamic escape explicit. Do not make the common path pay for the
dynamic language merely because the language supports it somewhere.

## Shape cardinality is not a compatibility contract

The experimental representation must not preserve a one-to-one mapping with
today's `Node` subclasses. A single static declaration run may be one packed
record; one legacy node may split into a static source leaf plus a dynamic
escape; several inert value nodes may fuse into a tagged value sequence; and a
placement may be represented by a frame/handle rather than a copied subtree.
These are semantic shapes, not public AST promises.

Correctness is maintained by explicit ownership rather than by preserving
class identity:

- source text, authored spans, and debug identity handles remain available;
- source-order and scope-sensitive behavior belongs to placement frames;
- dynamic features escape to a defined legacy/runtime operation;
- a debug projection can reconstruct an inspectable view without allocating
  debug objects on the hot path;
- every shape conversion is compared against the existing AST for output,
  source-map/caller-buffer behavior, and feature-route parity.

The greenfield implementation therefore measures different cardinalities and
different dispatch strategies directly. It must not be judged by whether it
looks like a smaller version of the current tree.

## Acceptance oracle

The end-to-end acceptance criterion for the experimental representation is
byte-identical CSS output against the existing AST, not preservation of legacy
field layouts, class identity, node counts, or object shapes. Those shape tests
remain useful diagnostics for the current production implementation and must
not be weakened or deleted, but they do not constrain a separate fast-AST
experiment. The experiment may fuse, split, or replace shapes freely if its
rendered CSS remains exact; source-map and caller-owned buffer contracts are
also compared when the workload exercises them. Unsupported semantics must
route through an explicit legacy escape that produces exact output, or remain
an honestly recorded gap.

## Recommended target shape

Use a three-layer representation:

1. **Canonical source tree.** Lean, stable containers own source order,
   authored spans, and only semantic facts needed by all placements. Static
   leaves are source text plus a compact semantic tag, not eagerly allocated
   `Dimension`, `Color`, `Keyword`, or `Bool` objects.
2. **Placement frames.** A placement owns live bindings, source-order cells,
   and sparse overlays only when evaluation changes the source result. An
   import or mixin reuses the canonical body; it does not clone or re-evaluate
   independent static subtrees just because it has a new placement.
3. **A direct evaluator/emitter.** A pure static region runs as a tight
   tagged-value loop and writes directly to the output buffer. A dynamic node
   has an explicit escape operation into the existing object/runtime path.
   There is no generic “preview everything, then discover what happened” pass.

The important boundary is semantic, not syntactic: a value becomes a full
runtime object when arithmetic, comparison, a guard, a reference result, a
plugin, an interpolation, or another operation actually needs object
behavior. Debugging can retain source text and tags without making those
representations the runtime AST contract.

## Candidate AST shapes

These are alternatives considered, not ten rewrites to schedule. The first
five are the most credible; the rest are useful as design checks.

| ID | Shape | Likely benefit | Main risk |
| --- | --- | --- | --- |
| A1 | Full object AST, aggressively slimmed | Lowest migration risk | Still pays per-leaf objects and call ladders |
| A2 | Semantic AST plus packed sidecars | Separates hot facts from cold metadata | Side-table indirection and ownership complexity |
| A3 | Canonical source DAG plus placement frames | Reuses imports/mixins and isolates live state | Dependency/escape analysis must be correct |
| A4 | Container/leaf split with tagged scalar leaves | Keeps structure while removing inert wrappers | Materialization boundary must preserve exact semantics |
| A5 | Fixed-shape tagged records | Predictable V8 shapes and compact fields | Record access can become index-heavy or opaque |
| A6 | Lean class per semantic kind | Good V8 locality and readable debugging | More classes and dispatch paths |
| A7 | Parentless zipper/tree plus explicit traversal stack | Removes parent maintenance and recursive walks | Trivia and mutation APIs need redesign |
| A8 | Region/rope tree for source and output | Cheap reuse and contiguous serialization | Hard interaction with evaluated replacement values |
| A9 | Two-tier statement/value AST | Optimizes values without destabilizing statement semantics | Boundary between tiers can proliferate |
| A10 | Normalized semantic IR | Excellent direct evaluation potential | Highest semantic conversion and compatibility risk |

## Ten ways to reduce trivia bulk

Trivia is a separate design axis. Do not force Parseman to know that CSS has
comments, and do not make CSS/Less retain every whitespace boundary merely
because a generic grammar can report it.

1. Store only comment intervals; infer ordinary spaces from source spans and
   the serializer's separator rules.
2. Store one packed document trivia tape with `(start, length, kind)` records.
3. Store per-container gap ranges, not one record per parser trivia capture.
4. Store a comment-only sidecar and replay untouched source gaps when legal.
5. Store a bitset of “gap may contain comment” ranges, scanning exact text only
   when a serializer needs the gap.
6. Store sparse field/value spans only for fields whose output can move.
7. Store source slices and use render-time scanning for cold unknown rules.
8. Intern repeated whitespace forms (`" "`, newline, indentation) and retain
   only references for the uncommon forms.
9. Use a token arena for comments and line-break metadata, with indexes owned
   by the source root rather than each node.
10. Make trivia policy an explicit parser capability: a grammar requests the
    distinctions it needs, while Parseman still exposes a generic lossless
    mode for grammars that require it.

The likely first POC is (1) plus (6), because it tests whether the current
CSS/Less serializer actually needs the 66k captured trivia slots or only the
roughly 8.9k comment runs and a smaller set of movable spans. The POC must
include no-trivia, single-space, comment-heavy, multiline, unknown-rule, and
source-map-on cases.

## Ten alternatives to a conventional object AST

1. Array-of-structs arena with integer child indexes.
2. Struct-of-arrays for tags, spans, child ranges, and payload indexes.
3. Relocatable packed records with string/number pools.
4. Stack bytecode for pure expression/value regions.
5. Register bytecode with explicit dynamic escape instructions.
6. Compile-time generated dispatch blocks for static grammar regions.
7. Selector and extend decision DAGs keyed by canonical source identities.
8. Source tape plus semantic islands: raw source for inert regions, nodes only
   at semantic boundaries.
9. Piece-table output IR that can reuse unchanged imported/mixin fragments.
10. Native/Wasm packed IR for a proven pure subset, behind an explicit
    boundary rather than as a whole-language replacement.

The recommended order is (8) and (5) as JavaScript POCs, then (2)/(3) only if
the object implementation still dominates after the semantic cuts. Wasm or
native code is not a substitute for removing unnecessary work.

## Ten mixed AST/runtime designs

1. Tagged leaves + sparse comment trivia + live-frame direct emitter.
2. Lean classes + source tape + shared canonical import/mixin bodies.
3. Packed records for static regions + object dynamic islands.
4. Semantic AST + columnar value payloads + pure operation bytecode.
5. Register value IR + statement AST + source-tape fallback.
6. Region tree + semantic islands + explicit source-order cells.
7. Selector decision graph + ordinary declaration containers.
8. Canonical DAG + piece-table output fragments + placement overlays.
9. Semantic IR + object escape points for references/calls/plugins.
10. Feature-specialized emitters selected by a closed-world capability mask,
    with the general evaluator retained for unsupported features.

The first candidate to test is (1). The most promising follow-up is (10),
because the canonical benchmark can select a direct emitter only when its
feature mask proves that path safe. Candidate (3) is the fallback if V8 object
allocation remains the dominant measured cost after the first two POCs.

## What this rules out

- A universal prototype-chain scope engine. Prototype inheritance is useful
  for a bounded static lookup experiment, but it cannot represent Less's live
  writes and call-site visibility. It must not become the semantic scope model.
- A generic AST index that rediscovers facts already explicit on a node. Carry
  those facts at construction/evaluation time, as the merge-presence cut now
  does.
- Turning every whitespace capture into an object or node. That increases
  allocation and GC without improving the output contract.
- Replacing every node with a string. Arithmetic, comparison, guards,
  interpolation, references, calls, and plugins need typed behavior; the
  correct target is a lightweight representation with explicit materialization.
- A parser-only rewrite as the sole route to the <40 ms target. Parser work is
  necessary, but render/eval is currently the larger gap.

## Perf-gated POC sequence

### POC 1: tagged value leaves

Use source text plus a compact tag for dimensions/numbers, colors, booleans,
and keywords. Keep the original text exactly; do not normalize `1.0` to `1`
or write calculated values back into source storage. Materialize only on
arithmetic, comparison, guard, reference result, interpolation, plugin, or
other typed escape.

Required counters and gates:

- inert values created, materialized values, and materializations by reason;
- decimals, units, colors, booleans, multi-token values, interpolation,
  arithmetic, guards, variable reads, mixins, and imports;
- byte-identical output and no materialization for inert values;
- parse/render A/B on the canonical benchmark and a value-heavy fixture;
- allocation/GC evidence, not just one timing number.

### POC 2: pure-value register island

Compile only a closed subset of literal/list/operation values to a tiny
register representation. Reference, interpolation, call, guard, plugin, and
async operations emit explicit escape instructions to the normal evaluator.
The POC must prove that it does not silently evaluate a dynamic node as static.

### POC 3: feature-specialized direct emitter

Select a direct emitter only for a proven capability mask. It may share
canonical source bodies and emit unchanged static import/mixin regions directly;
placement-specific overlays remain in frames. Every fallback must be counted
and its semantic reason named.

### POC 4: trivia representation

Run no-trivia, one-space, comment-heavy, multiline, unknown-rule, and
source-map-on workloads through the current and comment-only/sparse variants.
Count trivia lookups, comment scans, writer marks, joins, chunks, and flattened
parts. Keep a variant only if it reduces total work or retained memory with
byte-identical output.

### POC 5: recognizer boundary

Build a genuinely stripped Parseman recognizer artifact, not a runtime flag in
the same capture-capable parser. Compare generated code shape and CPU profile
against the current recognizer and Less's cursor/regex fast paths. Keep the
Parseman change grammar-general; CSS/Less-specific late materialization belongs
in the grammar/host boundary.

## Decision

The design to pursue is **a canonical light semantic tree with tagged static
leaves, sparse trivia, placement-local live frames, and explicit dynamic
islands**, tested first through the five POCs above. This preserves the value of
a complete AST for debugging, tooling, and minification while stopping inert
values, imports, mixin bodies, whitespace captures, and no-feature evaluator
surfaces from paying dynamic costs they do not use.
