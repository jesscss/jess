# Value-Materialization Memoization — DESIGN (design-first; no engine code this pass)

Owner requirement: value-leaf materialization must be "**extremely lightweight and
not repeatedly calculated**" — a lightweight leaf becomes a full value node **at
most once** and is never re-derived. Owner's proposal: split a leaf into a
LIGHTWEIGHT form (type/tag + raw bytes) and a COMPLETE-node form; on first
operation, **mutate the leaf in place** (where it lives in the canonical tree) into
the complete form, so a leaf inside a mixin body read across many call sites
materializes a single time.

This doc reconciles that with the landed `VALUE-NODE-MODEL-DESIGN.md` /
`spine-is-projection-not-mutation` invariant ("neither lazy nor eager memoizes —
projection-not-mutation forbids storing the value object back on the shared node"),
verifies the context-free vs context-dependent split the owner proposed, designs the
cheapest possible discriminator + cache representation, and gives a MEASURED
cost/benefit. It feeds an adversarial review before any engine change.

Base: `origin/dev` (~`0e73429e2`). Grounded in the live code
(`ast/serialize.ts`, `ast/literal-tag.ts`, `ast/value-eval.ts`) as of that commit.

---

## 0. TL;DR — verdict up front

**Do NOT implement an in-place (or side-table) materialization cache. It is a net
loss.** The owner's own governing constraint — total-cost accounting
(`feedback-total-cost-and-lazy-computation`) — rejects it:

- Materialization is **0.66 % of render (0.32 ms of 48.3 ms)** total, already
  measured (`VALUE-NODE-MODEL-DESIGN.md §2.2`). That 0.32 ms is the **entire** upper
  bound on any memoization win — and the achievable slice of it (re-materializations
  only, minus cold misses) is a fraction of that: **sub-0.15 ms, < 0.3 % of render.**
- The **inert 58–98 % of leaves are already zero-cost** — they return a bare
  `node.src` string and NEVER materialize (`evalValue`, `serialize.ts:851-856`). A
  cache does nothing for them; the lazy-when-inert design already delivers the "at
  most once — in fact zero" goal for the common case.
- Every cache shape costs more than it saves: an **in-place swap** breaks the lane
  invariant AND the verbatim-`src` guarantee; a **per-node cache field** adds weight
  to every plain-data literal node (violates `lazy-materialization-zero-cost-visitor-seam`);
  a **WeakMap side-table** taxes all 3 657 operated touches (cold + hot) with a
  get/set of the same order as building the small object it caches.

The owner's *instinct* — "materialize at most once" — is **already satisfied** by
the landed LAZY split for the case that dominates (inert leaves: zero times). The
residual (re-materializing an *operated* leaf on mixin/loop re-expansion) is real but
below the noise floor, and the cheapest correct cache for it is at best a wash.

The context-free/context-dependent split the owner proposed **is correct and holds
cleanly** (§2) — memoizing literals in place would not produce *wrong* results. The
barrier is purely cost/benefit, not correctness. Detail below so the review can
confirm rather than re-derive.

---

## 1. The two lanes as they exist today (grounding)

Post-`Word`-elimination, a parsed value leaf is a plain-data node carrying its
honest `type` + verbatim `src` + cheap pre-split scalar fields (never a derived
value object at rest). Two fold entry points read it:

| Lane | Fn (serialize.ts) | What a LITERAL leaf does | Allocation |
|---|---|---|---|
| **Inert** | `evalValue` (:845) | `return literal(node.src)` — a **bare string**, rep "B" | zero |
| **Operated** | `evalTyped` → `materializeNode` (:793) | build a value-domain `Value` object from the node's own fields | one small object |

`materializeNode(node, e)` (:793) — **takes no `frame`**:

```
Keyword   → { type:'Keyword', text: node.src, bytes: node.src }
Color     → colorFromSrc(node.src)                       // # ⇒ parseHex; else namedColor
Dimension → dimensionFromFields(node.number, node.unit, node.src)
Quoted    → quotedFromFields(node.value, node.quote, node.escaped, node.src)
Any       → materializeAny(node.src)                     // the ONLY byte sniff (regex)
```

**Key structural fact:** a leaf's *position is fixed by the parse tree*. A literal in
a bare value position (`a: 1.0px`) is **always inert** — it is never wrapped in an
`Operation`, so `evalTyped`/`materializeNode` never sees it. A literal in an operand
position (`a: 1.0px + 0`) is **always operated** — it is structurally inside the
`Operation`, so it is never inert. A given leaf node is **either always-inert or
always-operated**, never both. (This matters twice below: it is why an in-place swap
cannot corrupt a verbatim emit at a *different* site, and it is also why the cache
population is exactly "the always-operated leaves, re-expanded".)

---

## 2. The context-free / context-dependent split — VERIFIED

The crux the task poses: projection-not-mutation forbids caching a value object on a
shared node **because a node shared across mixin call sites can resolve differently
per context.** Resolve which materializations are context-free (safe to memoize) vs
context-dependent (must project per context).

**Finding: the split is exactly the leaf boundary, and it is clean.**

### 2.1 Context-FREE — every parsed literal leaf (Keyword/Color/Dimension/Quoted/Any)

`materializeNode` reads **only the node's own immutable fields** (`src`, `number`,
`unit`, `value`, `quote`, `escaped`) — verified: its signature is `(node, e)`, no
`frame`, and none of `colorFromSrc` / `dimensionFromFields` / `quotedFromFields` /
`materializeAny` touch scope. Therefore:

> A given literal leaf materializes to the **byte-identical `Value` object** at every
> call site, in every scope, forever.

This is the ~98 %-inert / ~58 %-of-touches common case and it includes `Any`: `Any`
is *opaque* (its type is unknown) but its materialization is still a **pure function
of its own `src`** — the sniff reads no scope. So `Any` is context-free too.

Owner's mixin example — "a literal in a mixin body read/operated across many call
sites" — is exactly this: the literal is context-free, so caching it once would be
*correct*. The split the owner proposed is right.

### 2.2 Context-DEPENDENT — everything that reads `frame`

`VarRef`, `PropRef`, `Interp`, `MapAccessor`, `VarIndirect`, and any `Operation` /
`FunctionCall` / `SpacedValue` / `Sequence` that *contains* one. These resolve
against scope and produce different bytes per call site (`@x` is `1px` here, `2px`
there). These must project per context — **never** cache on the shared node. Already
handled: they flow through `evalValue`/`evalTyped` with `frame` and are never stored
back.

### 2.3 The two "does the split leak?" checks the task asked for

- **Context-dependent *literals*?** None. A parsed literal leaf's materialization
  reads only its own fields → always context-free. There is no such thing as a
  scope-sensitive literal leaf. (A `VarRef` that *resolves to* a literal is not a
  literal node — it is a context-dependent node whose *target* is context-free; the
  cache, living on the literal, is still consistent across the different VarRefs that
  reach it.)
- **Context-free *non-literals*?** Yes — a constant-folded `Operation` of two
  literals (`(2px + 3px) → 5px`) is context-free. **But it is out of scope and not
  worth chasing**: proving an `Operation` subtree pure requires a *recursive* purity
  walk (any nested `VarRef`/`Interp` makes it context-dependent), which is far more
  machinery than the leaf case and buys even less (constant sub-expressions are rare
  and already cheap). The leaf boundary is the clean, complete line for this design.

**Verdict on the split: CONFIRMED and CLEAN — context-free ≡ "is a value-literal
leaf" (`isLiteralNode`); context-dependent ≡ everything else.** The discriminator is
therefore free: it is the node `type`, already the switch key.

---

## 3. Why in-place mutation is the wrong cache shape (even though it's *correct*)

The split says caching a literal is *correct*. Three concrete reasons the owner's
specific "mutate the leaf in place into the complete node" is nonetheless the wrong
representation:

1. **It breaks the lane invariant.** `VALUE-NODE-MODEL-DESIGN §1.1`: AST literal
   nodes carry **`src`**, value-domain objects carry **`bytes`**; `isNode` is
   membership-based and the serializer's `isLiteral`/lane checks rely on
   "`'bytes' in v` ⇒ value object, `'src' in v` ⇒ AST node." Swapping a
   `Dimension{src,number,unit}` node for a value-domain `Dimension{bytes,number,unit}`
   in the tree slot would make every structural walker that later visits that slot
   misclassify it. The whole point of the shipped node model is that these two never
   occupy the same lane.
2. **It endangers the verbatim guarantee.** The value object carries **canonical**
   `bytes` (`1px`), the node carries **verbatim** `src` (`1.0px`). §1's
   always-inert-or-always-operated fact means a *given* node can't be both, so an
   in-place swap of an always-operated node wouldn't corrupt a sibling emit **today**
   — but it removes the structural safety margin for zero benefit, and any future
   path that reads `src` off a now-swapped node silently gets canonical bytes. Fragile.
3. **It is mutation of the "stable tree."** `spine-is-projection-not-mutation`: the
   spine is a projecting serializer over a stable tree; folds are emit-time
   projection, not tree edits. Writing a materialized object back into the canonical
   tree is precisely the mutation the architecture spent its budget removing.

A **per-node cache field** (`node.__mat?`) sidesteps (1)/(2) but violates
`lazy-materialization-zero-cost-visitor-seam`'s hard rule — *no weight on the
plain-data nodes* — and pays an init/branch on every node.

A **WeakMap side-table** (`materializedValue(node)`, the memo's zero-node-weight
pattern) is the only shape that respects every invariant. It is evaluated in §4 and
still loses on total cost.

---

## 4. Cost/benefit — the WeakMap cache (the only invariant-safe shape), MEASURED bounds

Using the landed measurement (`VALUE-NODE-MODEL-DESIGN §2.2`, real `benchmark.less`
through `renderAstFile`, warm, 25-median, Node v22):

| Quantity | Value |
|---|---|
| Full render median | 48.3 ms |
| Inert literal touches (never materialize) | 5 068 |
| `materialize` calls (operated/compared/typed-param) | 3 657 |
| — of which `Any` regex sniffs | 819 |
| — of which cheap typed field-reads | 2 838 |
| **Total time inside materialize** | **0.32 ms (0.66 %)** |
| Per-materialize cost | ~0.087 µs |

**Benefit ceiling.** A cache saves time only on *re-materializations of the same
node* (cold misses are never saved). The absolute ceiling is the whole 0.32 ms
(if literally every materialize after the first were a hit) — already noise. The
realistic slice is smaller because:

- The 2 838 typed reads build a 3-scalar object literal — replacing that with a
  `WeakMap.get` + hit-branch is **at best a wash**, quite possibly slower (V8 inline
  object construction vs a hashed lookup + the cold-path `.set`).
- Only the **819 `Any` sniffs** (regex) are individually expensive enough that a hit
  would clearly beat a rebuild. Even if half were re-sniffs, that is ~400 saves ×
  (sniff − lookup) ≈ **well under 0.1 ms.**

Net realistic win: **sub-0.15 ms, < 0.3 % of render — and negative once the WeakMap
tax on the 3 657 cold+hot touches is subtracted.**

**Cost.**
- A `WeakMap` allocated on first operated touch; a `.get` on **every** operated touch
  (3 657) incl. cold; a `.set` on every cold miss. GC now tracks 1 entry per distinct
  operated leaf (~thousands of live entries for the render's lifetime) that the bare
  design never allocates.
- Complexity: a second way to read a materialized value; a seam authors must route
  through; a new failure surface (stale entry if a node's fields were ever mutated —
  they aren't today, but it is now a load-bearing assumption).

Per `feedback-total-cost-and-lazy-computation`: "a pre-classification that adds
[cost] to make a [faster phase] — of course we should reject." A cache that adds a
per-touch lookup + per-node GC entry to shave a sub-0.3 % phase is that reject.

---

## 5. Recommendation & (contingent) implementation sketch

**Recommend: do nothing. Keep the landed LAZY-when-inert design.** It already meets
"materialize at most once" for the dominant case (inert leaves: **zero** times) and
leaves the residual (operated re-expansion) as a 0.66 % noise band no cache profitably
compresses. This aligns the owner's stated goal ("lightweight, not repeatedly
calculated") with the owner's stated method (total-cost accounting) — the two point
the same way here.

**Retire the owner's in-place-mutation proposal specifically**, on the split finding:
the mutation is *correct* (literals are context-free) but architecturally hostile
(breaks the lane invariant + verbatim margin + stable-tree rule) for a sub-0.3 % win.

**IF a future real-fixture profile ever shows a hot re-sniff** (not today — predict
before building, `feedback-predict-perf-before-building`), the single defensible
micro-target is **only the `Any` regex sniff**, the one individually-expensive
materializer, via the invariant-safe WeakMap accessor — *scoped to `Any`, gated on a
measured hot re-sniff*, never the blanket literal cache:

```ts
// CONTINGENT — build only if a profile shows repeated Any re-sniffs dominating.
const anyCache = new WeakMap<Any, Value>();   // zero node weight; Any-only
function materializeAnyMemo(node: Any): Value {
  let v = anyCache.get(node);
  if (v === undefined) anyCache.set(node, (v = materializeAny(node.src)));
  return v;
}
```

Typed leaves (`Keyword`/`Color`/`Dimension`/`Quoted`) stay uncached — their build is
a scalar-field object literal cheaper than a map lookup. No in-place swap, no node
weight, no stable-tree mutation. This is a contingency to record, **not** work to
schedule.

---

## 6. Answers to the task's explicit questions

- **Mechanism:** lazy-when-inert (shipped). Inert leaf → bare `src` string, never
  materialized. Operated leaf → `Value` built from immutable node fields, no
  `frame`. No cache.
- **Context-free vs dependent split:** CONFIRMED CLEAN. Context-free ≡ value-literal
  leaf (incl. `Any`) — pure function of own fields. Context-dependent ≡ anything
  reading `frame`. No context-dependent literals; the only context-free non-literals
  (constant-folded `Operation`s) are out of scope. Discriminator is free: the node
  `type` (the existing switch key).
- **In-place memoization vs projection-not-mutation:** memoizing literals is
  *correct* (context-free), but the *in-place* shape violates the lane invariant, the
  verbatim-`src` margin, and the stable-tree rule; a per-node field violates
  no-node-weight; only a WeakMap is invariant-safe.
- **Predicted cost/benefit:** benefit ≤ 0.32 ms (0.66 %), realistic < 0.15 ms
  (< 0.3 %) and net-negative after the per-touch lookup tax + GC entries; cost is real
  (weight/allocation/complexity). **Not worth it.**
- **Worth implementing?** **No.** Keep lazy-when-inert. Record an `Any`-only WeakMap
  as a contingency to revisit *only* if a future profile shows a hot re-sniff.
