# Node-slim follow-ons to STRINGS-OVER-NODES — two SEPARATE questions

Status: **design notes.** Both extend the STRINGS-OVER-NODES reduction *upward* from
leaf tokens to typed literals / structural containers. They share one principle but sit
at OPPOSITE ends of a risk spectrum, so they are tracked separately and must NOT be
folded into one spike or one benchmark.

The shared principle: a token that is **inert until computed** does not need a node while
it is inert — carry it as a string (+ a cheap type signal so materialization needs no
re-parse), and build the real node only on the slots that actually get operated
on/matched. STRINGS-OVER-NODES already does this for static leaf selectors/idents/
keywords. These two notes push it to the next layer.

The spectrum that separates them:

| | Question 1 — value literals | Question 2 — selector containers |
|---|---|---|
| Node role | **inert & serialized** (~90% never operated) | inert & serialized MOST of the time, but **computed & matched** in the hot workload |
| Hot path | value-heavy libs (arithmetic) | extend / `:extend` / specificity — i.e. `benchmark.less` |
| Risk profile | clean win (shed cost lands on the ~10% operated) | **memory win could mask a match-path regression** |
| Decide on | resident memory + value-heavy render | the **extend-match** benchmark, NOT the memory/serialize number |

---

## Question 1 — value-literal type tag (LIVE, decided shape; sequence after flip + re-profile)

> **Buildable spec:** `VALUE-LITERAL-TAG-SPEC.md` (tag enum, Declaration shape, seam
> inventory, producer changes, byte-identity + test plan, Dimension→Color migration).

STRINGS-OVER-NODES §4 explicitly carves Dimension/Color OUT of the string reduction, so
the parser still eagerly builds ~4502 Dimension + ~3000 Color literal nodes (~0.8 MB
resident) even for literals that are never operated on. This closes that carve-out.

**Shape (decided):** carry the literal as its verbatim string + a **parse-time type tag**
(a small int saying which node to materialize — so no string re-sniff). The tag is a
parse constant, fully populated, never written back → no cache-back, no reuse-as-leaf
aliasing, projection-not-mutation intact.

**Encoding = hybrid (decided), NOT always-two-arrays, NOT per-token tagged objects:**
- **N = 1 (dominant — `color: red`, `margin: 0`):** bare `string` value + a **scalar**
  tag field. Zero array overhead, still sheds the node.
- **N ≥ 2:** **two parallel packed arrays** — `value: string[]` + `types: number[]`.
  Keeping tags in their OWN array makes `types` a **PACKED_SMI** array (V8's fastest
  kind, branchless tag reads). Interleaving (`[s,t,s,t]`) demotes it to a generic mixed
  array; nesting (`[[s,t],…]`) reintroduces one heap object per token — both rejected.
- **Map rejected:** positional collapse (`padding: 1px 1px 1px 1px`).

**The one thing the spike still settles empirically:** for N ≥ 2, two-parallel-packed
vs. interleaved-flat — two array headers vs. one, weighed against shedding ≥1 heavy
literal. Everything else above is settled.

**Byte-identity:** clean per kind. Un-operated literal serializes its verbatim string →
identical by construction. Canonicalization (Dimension round/unit, Color hex-case/`rgb()`)
only runs on the operated path, which builds a real node under ANY shape.

**Sequencing (decided):** after the D-EVAL flip AND the mandated post-flip re-profile
(benchmark won't surface value-node cost — it's extend-dominated; confirm Dimension/Color
construction+`inherit` is hot on a *value-heavy* lib first). Migrate **Dimension first**
(highest count, cleanest materialize), **then Color**. Idents/keywords already ride as
strings and just gain a tag, unifying the seam.

**Doc to amend when this lands:** STRINGS-OVER-NODES §4 "Node still required for
Dimension/Color" → "…required only for the *operated* slot; a literal rides as
`(string, tag)`."

**Seams (all already exist; each gets cheaper with a tag — no re-sniff):**
`valueNode()` (declaration.ts:775), `coerceStringTerminal` (util/evaluate-node-array.ts),
`toAssignmentInputNode()` (declaration.ts:749), `Operation` operands, `Any.compare`
(any.ts:112 — the numeric regex sniff a tag replaces), mixin-arg binding.

---

## Question 2 — selector containers as nested arrays (PARKED; risky; measure the MATCH path)

The idea: replace the `SelectorList` / `ComplexSelector` **container nodes** with bare
nested arrays, where **depth encodes type** — outer = list, next = complex, next =
compound — and within a level `typeof el === 'string'` (combinator `'>'`) vs
`Array.isArray(el)` (compound) distinguishes members for free. No explicit tag array
needed (unlike values), because selector types are **stratified by depth**, not peers at
one depth.

```
selector: [ [ ['.a','.b','.c'], '>', ['.c','.d'] ] ]
//          list  compound        comb  compound
```

**Why it's not crazy:** it's the correct generalization, and it's PARTLY already shipped —
STRINGS-OVER-NODES §7.2 already carries a static complex selector as `['.a','>','.b']`
and collapses a static compound to a **single string** `.a.b.c` (leaner than the
sub-array `['.a','.b','.c']` for the common case — keep that). The genuinely-unshed thing
is the **List / Complex container node wrapper**.

**Why it's PARKED, not adopted:**
1. **Match-path risk (the load-bearing reason).** Unlike values, selectors are heavily
   *computed* in the exact workload we care about — extend/`:extend`/specificity, which
   dominates `benchmark.less`. A typed `CompoundSelector` gives V8 a stable hidden class
   + real methods to match against; a `(string | nested-array)` union forces
   `typeof`/`Array.isArray` re-dispatch at every level of every match. Shedding the
   containers could **win memory/serialize and lose the match path** — opposite risk
   profile from values, landing on the benchmark that matters most.
2. **Depth-as-type breaks on recursion.** `:is(.a,.b)` / `:not(.x > .y)` put a nested
   selector list *inside* a compound; depth stops predicting type and the leaf string
   `:is(` has to carry the signal again.
3. **Blast radius.** The extend pipeline (plan/solve/emit) is the most fragile core
   subsystem; rewriting it to walk untyped nested arrays is high-risk on shaky ground.

**If it is ever taken up:** gate the decision on the **extend-match** benchmark
specifically, NOT on the resident-memory or serialize number. Do it as its own spike,
after Question 1 has landed and been measured — do not assume the value result transfers.
