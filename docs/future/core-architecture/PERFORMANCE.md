# Performance — committed model and roadmap

**Committed direction (decided, not an experiment).** Object-reduction — reuse the
stable parsed nodes and resolve live bindings at emit time ("the spine") — is the
render architecture. The project is NOT pivoting back to clone-everything (the eval
two-walk). The goal is a model that is **both high-performance and accurate**, and the
path to it is known and measured. This document states that path.

The spine is already the SOLE top-level render path (see `CUTOVER-STATUS.md` → D-EVAL
FLIP). What remains is a **lean-ification arc**, not an open question about whether
object-reduction can win. Correctness was reached fold-by-fold; the residual per-node
interpreter cruft that each fold accreted is now being removed for speed.

## Why the model is sound

The earlier "the spine is slower, and that might be inherent" framing is **superseded**.
Live-binding is not V8-hostile: emit-time scope frames are monomorphic `Map` lookups
that memoize, and type dispatch during emit is paid at least as much by clone (clone
dispatches on node type too, then also allocates). Nothing about resolving bindings at
emit time forces a slower path than materializing an output tree first.

### The A / B / C decomposition

Total render time splits into three parts:

- **A — value evaluation.** Resolving variable references, operations, functions,
  mixins to their computed values. This work is **identical and shared** on both
  models — clone and reduction each pay it once.
- **B — output-tree allocation.** Materializing a second tree of output nodes.
  **Clone always pays B; reduction's B is zero** — the spine serializes the stable
  parsed nodes directly and never stages an output tree.
- **C — emit overhead.** Walking and serializing to the output string.

Because A is shared and B is strictly positive for clone and zero for reduction,
**reduction's performance floor is below clone's** — clone can never shed B, and that
is exactly the cost reduction structurally eliminates.

## Where we are, measured

- **Structure-heavy code: the spine already wins.** Mixin-heavy workloads ~24% faster,
  extend-heavy ~17% faster (representative of the many per-fold A/B numbers recorded in
  `CUTOVER-STATUS.md`, e.g. mixin-surface at-rule-through-hoist ~48%, transitive
  extend-chaining ~2.2×). These are wins the spine banks today precisely because it
  never allocates B.
- **Value-heavy files: a removable hot spot, precisely identified.** The spine's only
  current deficit is on value-heavy files, and its cause is now isolated and measured —
  it is NOT the object-reduction model. The root-enter eligibility gates each perform an
  independent full deep tree-walk, and wastefully descend into declaration value
  subtrees, for roughly 6–8 scans per render. This is accreted per-node interpreter
  cruft: each fold bolted its own eligibility check into the shared emit path.
- **The bypass is measured to flip it.** A controlled bypass of those redundant
  gate-walks moves the spine from ~15% behind eval to parity/slight-win on value-heavy
  files (~477ms vs eval's ~495ms). Combined with the structure wins above, the spine is
  faster than eval **across the board** once the gate work lands.

Honest status: the structure wins are already measured and banked; the value-heavy flip
is **measured via the controlled bypass and in progress** as a shipped fix; the
compiled-emit floor (step 4 below) is a later increment, not something claimed today.

## Roadmap

1. **Fix the root-enter gate walks.** Replace the per-fold independent deep walks with a
   single structural-only, coalesced scan, backed by parse-time flags and memoized so
   eligibility is decided without re-walking (and without descending into declaration
   value subtrees). In progress; the controlled bypass above measured this flips
   value-heavy files to parity/win.
2. **Close the remaining coverage folds.** Recursion-with-container (distinct-per-level
   container surface — the recursion path already has a working emit-time driver),
   compound-`&&`, and direct merge-plus-mixin. All analyzed as fixable,
   conservatively-gated, already-built folds — coverage completion, not fundamental
   redesign.
3. **Optimize the shared value evaluator (A).** The biggest real-file lever, because A
   is shared by every render path — every improvement helps both structure- and
   value-heavy code.
4. **Compiled per-shape emit.** Ahead-of-time branch pruning and specialized emitters —
   specialize once per stable node-shape and select the render-mode variant without
   mutating shared prototypes per render — the way Parseman macro-compiles the parser and
   Chevrotain specializes. This reaches the theoretical floor below clone. A later
   increment.

## Guardrails

- **Never downgrade to a slower solution on reasoning alone** — measure a cheap A/B
  first. Benchmarks justify "faster"; tests and inspection justify "less machinery."
- **Object-reduction is not re-litigated.** A shape that is hard to fold is a reason to
  sequence it, never a reason to fall back to clone-everything. See `CUTOVER-CHECKLIST.md`
  (HARD RULE #6) and `FOCII.md`.
- Benchmark protocol and profile history live in `CORE-CLEANUP.md`.
