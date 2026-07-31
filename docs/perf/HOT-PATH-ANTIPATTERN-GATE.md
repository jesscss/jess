# Hot-path antipattern gate

**Status: built, seeded, NOT enabled.** Nothing runs this automatically.
Turning it on is the owner's call; the checklist is at the bottom.

## What problem this closes

A CPU profile plus a code read found a cluster of defects in
`packages/core/src/ast/serialize.ts` that **every existing gate passes**. They
emit byte-identical output and leave every test green while being quadratic or
allocating per call:

- a comment-trivia helper that re-iterates the whole source-ordered comment-run
  array **from index 0 on every call**, once per emitted statement, `continue`-ing
  past a monotonically growing prefix — O(statements x runs);
- a helper that re-scans source text with `indexOf('/*')` and allocates a fresh
  `string[]` of slices per call, invoked *speculatively inside conditions* purely
  to test `.length > 0`, then again to emit;
- four module-global `WeakMap`s in `provenance.ts` keyed by AST node, storing a
  `{start, end}` object per entry — an object allocation plus V8 ephemeron
  marking, for two integers.

The unifying property is the whole point: **correctness gates and byte-identity
gates compare OUTPUT, and every defect in this class is output-neutral.** Green
tests are not evidence of absence here. This is the same reasoning that already
makes "tests pass" an invalid grammar-review result in
`docs/architecture/parser/GRAMMAR-REVIEW-STANDARD.md`; core hot paths had no
equivalent.

These are also **countable, not timing, defects** — which matters, because a
count has no noise floor. The repo's timing harness is currently under repair
and cannot resolve small effects (eleven identical processes on the CSS gate
corpus spanned -11.8% to +26.4%). A rescan either happens or it does not.

## What was built

| Piece | Path |
|---|---|
| Five ESLint rules | `scripts/eslint-rules/hot-path-rules.mjs` |
| Rule unit tests (fires-on-bad **and** silent-on-good) | `scripts/eslint-rules/__tests__/hot-path-rules.test.mjs` |
| Standalone lint pass (all rules `warn`) | `eslint.hotpath.config.mjs` |
| Named-set comparison | `scripts/verify-hot-path-antipatterns.mjs` |
| The named set | `scripts/hot-path-antipattern-inventory.json` |

```
pnpm audit:hot-path          # report every finding, never fails
pnpm verify:hot-path         # compare against the named set; exit 1 on a NEW site
pnpm verify:hot-path:clean   # also fail on a stale entry
pnpm test:hot-path-rules     # the rules' own unit tests
```

### The rules

| Rule | Pattern | Disposition |
|---|---|---|
| `no-speculative-allocation-predicate` | allocate an array/string/object only to test emptiness or membership | decidable |
| `no-node-keyed-side-map` | module-global `WeakMap`/`WeakSet` used as a per-node side table | decidable |
| `no-source-text-rescan` | `indexOf`/`slice`/`split`/regex over raw source text in core | decidable *given naming* |
| `no-rescan-in-loop` | whole-collection scan over a loop-invariant receiver, inside a loop | heuristic, advisory |
| `no-loop-invariant-accessor` | zero-arg accessor re-invoked each iteration with a loop-invariant receiver | heuristic, advisory |
| `no-json-stringify-on-tree` | `JSON.stringify` applied to an AST/CST value | heuristic, advisory |

`no-json-stringify-on-tree` names three independent disqualifiers, any one of
them fatal on its own: **cycles** throw `TypeError: Converting circular
structure to JSON` on whatever input happens to carry a parent pointer;
**stack depth** overflows, because it recurses with no guard; and
**materialization** builds the entire tree as one string before anything can
consume it — which is how the Less byte-identity oracle reached 8 GB and
returned no verdict at all.

The rationale is deliberately *not* that AST nodes are exotic. They are ordinary
well-shaped objects: the ~75 node types realize only 16 monomorphic shapes in
practice, and inline fields beat a `WeakMap` side table 40× on reads. The
problem is that they are large, deep, and referential — which is exactly why a
faster stringify library is not the fix. It still builds the string.

The fix is to **remove the string, not replace the stringifier**:

| Shape | Replacement |
|---|---|
| hashing / digest | stream a canonical traversal into `createHash('sha256')` via `hash.update(chunk)` — `scripts/digest-json-stream.mjs` does this and is byte-identical to the `JSON.stringify` it replaced |
| comparison / equality | walk and compare, or compare digests; never build two strings to `===` them |
| debug / diagnostics | `util.inspect(value, { depth, maxArrayLength })`, bounded explicitly, never on a hot path |
| deterministic committed output | `safe-stable-stringify` (stable key order *and* cycle safety) — **not currently a workspace dependency** |
| known-shape hot serialization | `fast-json-stringify` (schema-compiled) — **not currently a workspace dependency** |
| cycles that must round-trip | `flatted` preserves them losslessly; `json-stringify-safe` only replaces them |

None of those four libraries is in this workspace today, transitively or
otherwise. Each is a real new dependency, so prefer the zero-dependency answers
above until a site genuinely needs one.

### Why a named set and not a count

The repo's standing rule is that a baseline names its members. A bare number
cannot distinguish "nothing changed" from "you fixed one and introduced
another" — which would restore the exact blind spot this check exists to close,
since neither half of that trade is visible to any output-comparing gate.

Entries are **content-addressed**: `file + rule + sha1(normalized snippet) +
ordinal`. Inserting a line above a site does not invalidate its entry; editing
the site's own text does, which is correct — a rewritten site deserves a fresh
look. `--write-inventory` is **deletion-only** (matching
`verify-parser-runtime-boundary.mjs`); `--seed` is the explicit reviewed
override.

The seeded set is **117 sites**. Sites in `serialize.ts` and `provenance.ts`
carry an `owner` field marking in-flight rewrites, so a reader does not mistake
a listed site for an accepted one. That field is descriptive only and changes
no comparison outcome.

## What this does NOT catch

Stated plainly, because a gate that overstates its coverage is worse than none.

1. **The motivating incident's own shape, in its own location.** The rules are
   **intraprocedural**. `emitBlockCommentTriviaBetween` has its outer loop in the
   *caller* and its rescan-from-zero in the *callee* — two different functions.
   No single-file AST rule can see that. `no-rescan-in-loop` catches the shape
   only when both halves live in one function body. What the gate *does* catch in
   that file is the speculative `blockCommentsIn(...).length > 0` conditions, the
   `indexOf('/*')` source rescans, and the two module-global `WeakMap`s — three of
   the four reported defects, but by their local shape, not by their call graph.
   **Cross-function rescan-per-call remains a reviewer obligation.**

2. **Whether a flagged scan is actually wrong.** A loop-invariant receiver does
   not prove the scan is unnecessary; a two-element constant array scanned in a
   loop is harmless. The rule reports; it does not adjudicate. This is why the
   two loop rules are advisory.

3. **Allocating project helpers, unless named.** There is no syntactic way to
   know that `blockCommentsIn()` returns a fresh array. Guessing from a naming
   heuristic would fire on honest code, so the list is explicit and reviewed in
   `eslint.hotpath.config.mjs` (`allocatingCallees`).

4. **Source text passed under an unrecognized name.** `no-source-text-rescan` is
   name-based and is exactly as good as the repo's naming.

5. **`packages/core/src/tree/**`.** Deliberately out of scope: ~67k lines of
   legacy slated for deletion in the AST-v2 cutover. Pinning hundreds of sites
   in dying code buys nothing and would have to be maintained as that code is
   removed. Findings there belong in an audit, not this gate.

6. **Purity.** `no-loop-invariant-accessor` cannot prove a zero-arg accessor is
   side-effect-free. It excludes an explicit denylist of stateful zero-arg calls
   (`next`, `pop`, `shift`, `Date.now`, …) and declines on any call that takes
   arguments — so a loop-invariant call *with* arguments
   (`lessTriviaEntryCount(triviaLog)` in a `for` condition) is missed.

7. **Complexity class as such.** Nothing here measures anything. An O(n²)
   algorithm written without any of these six syntactic shapes passes cleanly.
   Invariant 4 remains a reviewer obligation backed by scaling budgets.

8. **A tree bound to a generic name.** `no-json-stringify-on-tree` fires only on
   positive tree evidence — an argument whose final name is a tree name
   (`node`, `ast`, `cst`, `stylesheet`, `rules`, `selector`, …) or one that came
   straight out of a `parse*`/`build*` call. `JSON.stringify(value)`,
   `(data)`, `(result)`, `(payload)` are all silent by design, even though such
   a binding may well hold a tree. That is a deliberate trade: a rule that fires
   on `JSON.stringify(options)` is disabled within a week and then protects
   nothing, which is the exact failure `c3db7e53e` was landed to end.

9. **Everything outside the hot-path scope — including `scripts/**`.** This is
   the sharpest limitation of `no-json-stringify-on-tree` and it should not be
   glossed: the pass is scoped to `packages/core/src/ast/**` and the four parser
   `src/` trees, so it does **not** lint `scripts/**`, where the oracle OOM
   actually happened. The rule prevents the class from entering the hot path; it
   does not police the tooling. Extending the scope is an owner decision with a
   real inventory cost, and is listed in the enablement checklist below.

## Enablement checklist

Do these in order. Do not skip step 2 — a gate that is red on an untouched
checkout is not a gate; it teaches people to reach for `--no-verify` on the
gates that matter.

1. **Let the two in-flight rewrites land** (`serialize.ts` comment/trivia
   replay, `provenance.ts` side maps). They own 90 of the 117 seeded sites.
2. **Re-seed and confirm green on a clean tree:**
   `pnpm verify:hot-path --write-inventory` (deletion-only; it will refuse if
   anything new appeared), then `pnpm verify:hot-path` — must print
   `0 new` and exit 0 with no local modifications.
3. **Bake the two advisory rules for false positives.** `pnpm audit:hot-path`
   on real PR diffs for a sprint; the same <5% false-positive bar the
   `scripts/eslint-rules/index.mjs` rules carry. If `no-rescan-in-loop` or
   `no-loop-invariant-accessor` exceeds it, keep them report-only and gate on
   the three decidable rules alone.
4. **Wire it.** Add `pnpm verify:hot-path` to `scripts/verify-pr.mjs` (not to
   `pnpm lint` — that pass must stay fast and non-heuristic).
5. **Add the catalogue row.** `docs/perf/V8-ARCHITECTURE.md` "Regression-fixture
   catalogue" gets an R8 row naming this incident, with this file as its
   detector, per that doc's own "extending enforcement" instruction.
6. **Decide the scope of `no-json-stringify-on-tree`.** It seeds **zero** sites:
   the only `JSON.stringify` anywhere in the hot-path scope is
   `packages/syntax/less/less-parser/src/grammar.ts:1527`, which quotes a
   `value: string` parameter into a `TypeError` message and correctly does not
   fire. So this rule is already green and costs nothing to gate on — it is pure
   forward protection.

   The open question is whether to widen it. The site that motivated the rule
   lives in `scripts/**`, which this pass does not lint at all. Widening to
   `scripts/**` means accepting a fresh inventory there; widening to
   `packages/core/src/tree/**` conflicts with item 5 above. Both are the owner's
   call, and neither blocks gating the rule at its current scope.

7. **Decide on the strong-globals knob.** `no-node-keyed-side-map` has an
   `includeStrongGlobals` option (off) that also flags module-global `Map`/`Set`
   used for per-node bookkeeping — those leak for the process lifetime rather
   than merely costing ephemeron marking. Turning it on is a separate,
   larger inventory.

## Provenance

Seeded at `dc563e4f949482578c73fd86b6cd76458f385ad9` (`origin/dev`), parseman
0.43.0. Verified green on an unmodified checkout, and verified to fire: a probe
file introducing a module-global `WeakMap`, a loop-invariant `filter().length > 0`,
a loop-invariant `indexOf`, and a `src.indexOf('/*')` produced six new-site errors
and a non-zero exit; removing it returned the check to `0 new`.
