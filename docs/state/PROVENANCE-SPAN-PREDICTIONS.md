# Provenance span container — predictions stated BEFORE measurement

Branch `provenance-span-investigation`, base `dc563e4f949482578c73fd86b6cd76458f385ad9`,
parseman 0.43.0. Written before any counter was run, so the data cannot have
shaped these numbers.

## Q1 — real growth or denominator inflation?

Prediction: **denominator inflation, and absolute writes went DOWN.**
`PERF_IDEAS.md` already records the two elisions removing 2,969 dimension
writes and 3,050 of 3,056 ruleset writes on this exact fixture. Both landed
before the 6.17% profile. A family cannot grow 3x in absolute cost while two
commits delete ~6,000 of its writes. Expect HEAD write counts strictly below
pre-batch, and expect the 43.7% process deletion to explain the share move
(2.0% -> ~3.6% free, remainder from the 30-vs-100 render and commit differences
plus a larger *read* population now that P0 stopped discarding diagnostics).

## Q4 — container options, predicted magnitude

Baseline family cost: 301/4,880 self samples = 6.17%, plus an unquantified
share of the 10.78% GC frame attributable to the ephemeron population.

1. **WeakMap (today)** — baseline. Per-access hash + `EphemeronHashTable`.
   Entries are individually GC-tracked; ephemeron marking is a fixed-point
   iteration V8 has documented as degrading toward quadratic.
2. **Context/document-owned `Map`** — predict **10-25% of family cost removed**.
   Kills the ephemeron population and its GC contribution, and frees wholesale
   with the document. Still hashes per access, so the 2.97%/1.64% set/get self
   samples largely remain. Fixes lifetime, not access cost. Predicted family
   6.17% -> ~5.0%, plus a GC-share improvement.
3. **Parser-owned dense `Int32Array` at stride 2, indexed by a parser-assigned
   node index** — predict the **largest win, 60-80% of family cost removed**;
   family 6.17% -> ~1.5-2.5%. Removes the hash, the per-entry `{start, end}`
   object, and the entire ephemeron population in one move. This is the same
   shape Parseman PR #97 used to take root trivia from ~4.5% to 0.06%, and the
   same shape `10de5e418` used for columnar warning facts in core. The residual
   cost is the node-index lookup itself, which is the part that decides whether
   this beats option 2 — an `Int32Array` read is near-free, but *getting the
   index from a node* must not reintroduce a map.
4. **Inline field on the node** — predict fastest raw access but I expect to
   **recommend against it**. Two int fields initialized in every factory keep
   one hidden class only if *every* factory writes them unconditionally; the
   moment a factory elides them the shape splits and V8 goes polymorphic at
   every AST consumer. The elision wins already landed (dimension, ruleset)
   depend on *not* writing, which is in direct tension with monomorphism.

Predicted ranking: **3 > 2 > 4 > 1**, with option 3's margin over option 2
contingent on the node-index question above.

## Q3 — write/read ratio

Prediction: **a large write-never-read population exists, but smaller than the
"most spans are never read" hypothesis suggests.** `serialize.ts` is the
dominant reader and it is the *renderer*, not a diagnostic path — spans drive
trivia placement and statement boundaries on every render. Expect reads to be
concentrated in a few structural node kinds (rule, declaration, at-rule) and
expect value-level kinds (dimension, keyword, color, operation operands) to be
the write-heavy/read-light population.
