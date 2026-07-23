# V8 Architecture Invariants — the perf-architecture checklist

Canonical. Loaded by the `perf-architecture` skill (proactive), the `perf-architecture-reviewer`
(judgment), and referenced by the deterministic CI gates (teeth). Every item is a **reviewer question
you must answer with evidence, not a verdict**, and — where possible — a **mechanical detector**.

Each entry: **RULE** · *why (V8 mechanism)* · **INCIDENT** (the real failure that motivates it) ·
**DETECTOR** (the mechanical gate, or "reviewer-only").

---

## 1. Monomorphic node shapes (the single biggest cost)
**RULE:** every AST node of a given `type` is built with the SAME field set, in the SAME order, through
ONE factory. Never conditionally add/omit a field, never `delete`, never spread `{...node}` to reshape.
*Why:* V8 assigns a hidden class per object shape; a second shape for the same `type` makes property
access megamorphic → `KeyedStoreIC`/`UncheckedCast` misses. This was ~50% of C++ time — the largest single
cost in the whole pipeline.
**INCIDENT:** polymorphic AST node shapes across the parsers/eval.
**DETECTOR (deterministic, top priority):** a construction-time harness records each `type`'s field-key
signature and **fails on a second signature per type**. Plus a lint: ban `delete node.*`, conditional
field assignment on nodes, and `{...node}` reshape; require construction through the frozen factory.

## 2. Never re-derive structure you already have
**RULE:** never serialize a structured node to a string and then parse/regex/scan it back into structure.
Read the structured data off the node.
*Why:* the parser already produced the structure; re-deriving it is pure waste + allocation churn, and it
couples eval to serialization format.
**INCIDENT:** `serialize.ts` serialized a compound selector to text then regex-tokenized it back into
atoms, un-memoized, per mixin match (biggest single self-time item).
**DETECTOR:** interprocedural taint lint — source = any `serialize`/`*Canonical` return; sink = any
string scan (`.match`/`.includes`/`.indexOf`/`.split`/`RegExp.test`/char iteration); followed across
helper boundaries (same-function matching is defeated by one extract-to-helper).

## 3. Never full-tree-walk in a hot path
**RULE:** don't walk the whole tree per render/eval to discover something the parser already knows. Use a
parse-time flag or an O(1) bitset fast-reject.
*Why:* a per-render O(n) walk over the whole document to answer a boolean is linear waste on every render.
**INCIDENT:** `documentHasExtend` walked the entire tree every render to detect `:extend()` presence.
**DETECTOR:** operation-counter budget — the "does X exist" walk must run **zero** times on a fixture
that has no X. (Static "no recursion in render" lints can't be both precise and low-false-positive —
recursion is what eval/serialize legitimately do; use the counter.)

## 4. Complexity class is an invariant — even in a clean-room rewrite
**RULE:** a rewrite ("you don't need to copy it 1:1") preserves the subsystem's DESIGN PRINCIPLES and
COMPLEXITY CLASS, not necessarily its code. Consult the tuned implementation + its design doc first.
Clean-room ≠ constraint-free.
*Why:* the algorithm's complexity is the whole point; new code that regresses O(n) → O(n·m) is a disaster
byte-identity can't see.
**INCIDENT:** extend matching was rewritten with `.includes()` O(n·m) substring compares + recomputed
selector string-keys, abandoning the tuned `EXTEND_RULES.md` design (fast-reject / O(1) bitset /
structural-not-substring) after being told "don't copy 1:1."
**DETECTOR:** scaling budget — count the subsystem's core operation at N and 2N inputs; **fail on
super-linear growth** (~4× ⇒ quadratic). Plus a CI gate: touching a tuned subsystem (extend/, grammar/)
requires a `design/NNN.md` citing its invariants doc. (Judgment part is reviewer-only, but the cost is
caught by the budget.)

## 5. Allocation discipline in hot paths
**RULE:** no `[...spread]` / `Array(n).fill()` / `{...clone}` / fresh `Set`/`Map` per iteration in hot
reducers or the eval spine. Single-value fast-paths BEFORE filter/map. Reuse buffers.
*Why:* allocation + GC churn shows up as C++ (`CloneObjectIC`, `SymmetricDifference`, boilerplate) and GC
time, not as your JS.
**INCIDENT:** `[...authoredSeparators, ...]` and `foldExpression([{…}, ...children.slice(1)])` in hot
reducers; clones/Sets in the extend transitive-closure fixpoint.
**DETECTOR:** deterministic allocation-count budget per fixture (counts are identical across runs → zero
flakiness).

## 6. Dispatch once; don't re-scan a shared prefix
**RULE:** read a leading token/`@keyword` ONCE, then switch. Don't list N alternatives that each re-scan
the shared prefix; don't copy-paste a large `choice` across contexts.
*Why:* per-arm re-scan is O(arms) work on the common path. (Note: parseman's `emitFirstMatch` already
first-char-gates disjoint arms — verify whether the re-scan is real before chasing it; the Less `@`-cluster
turned out already-gated.)
**INCIDENT:** a 20-arm statement `choice` copy-pasted 7×; overfit split nodes (`AtRuleBlock`/`Statement`).
**DETECTOR:** lint — `choice(...)` arm-count > N + duplicated large choice literal (regression pin, not the
backbone); node-schema registry to catch overfit node types as a class.

## 7. Grammar codegen integrity (from a live incident)
**RULE:** every rule a grammar references must exist in its composed set; verify from a CLEAN build.
*Why:* an incremental build can keep a stale generated lib whose grammar still resolves a rule that a
fresh rebuild would find missing → the parser silently degrades to the interpreter.
**INCIDENT:** the `DetachedRuleset→AnonymousMixin` rename left `Call`/`functionCallArgs` referencing a
missing `AnonymousMixin` rule; it passed on a stale scss lib and hard-failed on a clean rebuild.
**DETECTOR (deterministic):** gates run from a clean build (delete `lib/`, serial topo rebuild); a
compose-integrity check **fails on any `compose()` "missing rule" / "falling back to runtime"** output.

---

## How the reviewer uses this
Output must be **evidence per item**, not "Approved": e.g. "1: shape base=3 PR=3. 2: no serialize→scan
taint. 4: extend op-count N=100→2N growth 2.0× (linear), cites EXTEND_RULES.md. 5: alloc base=N PR=N."
A review that cannot cite the deterministic-proxy numbers is auto-rejected. The reviewer's claims are
cross-checked against the CI budgets; a contradiction fails CI. The reviewer has its own regression suite:
each incident above is a fixture it must still catch.
