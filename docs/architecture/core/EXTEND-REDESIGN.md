# ast/ extend redesign — lazy fast-reject over a shared IR

Owner task #29. Goal: make `ast/extend` correct AND fast, and PROVE both. The
measured problem (PERF_IDEAS.md, SHA 74830109a): the extend engine is ~71.5% of
serialize self-time (~13 ms ≈ 25% of the whole ast/ render) for only 26
`:extend()` instructions, because `computeExtends` does full per-subject work for
EVERY rule even though a target-atom prefilter already proves ~92% of rules are
untouched.

This note specifies the redesign: the reject predicate, why it is COMPLETE (no
false negatives), the candidate prune, the shared IR that unifies single- and
multi-extend application, and the expected complexity. It gates on whole-render
time + memory + GC, not the extend phase in isolation.

## 0. The consumption contract (what the serializer actually needs)

`serialize()` calls `computeExtends(root)` once (serialize.ts:938) and stores the
result on `Emit.extends` (null when the document has NO `:extend()` — the
existing zero-cost gate). Per rule the serializer reads three maps, each keyed by
`Rule`, and **falls back to its own native rendering when a rule is absent**:

| map           | read site                    | fallback when absent                  |
|---------------|------------------------------|---------------------------------------|
| `flatByRule`  | serialize.ts:1026-1027       | `rawComposed` (native compose)        |
| `hoistHeader` | serialize.ts:1026            | `flatByRule` / `rawComposed`          |
| `nestedPlan`  | serialize.ts:1768, 1837,1864 | `ownStrings(rule.selector)` (native)  |

Key consequence: **a rule only needs a map entry when extend changes its output.**
The current code populates `nestedPlan` for *every* subject and computes `raw`+
`flat` for *every* subject purely to discover the ~8% that changed. That is the
waste.

## 1. Reject predicate (the fast-reject) — `pathHasTargetAtom`

`targetAtoms` (already built by `collectPlan`) is the graft-recursive union of the
individual simple atoms of every instruction target, across all branches of every
multi-target `:extend(.a, .b)` and every `:is()` graft (`collectBranchAtoms`).

A subject `s` is a **may-match** subject iff any level on its ancestor path
(own-local ∪ ancestors) contains an atom in `targetAtoms`:

```
mayMatch(s) = ownLocalHasTargetAtom(s) || mayMatch(s.parent)   // inherited boolean
```

computed as an inherited boolean top-down — **O(own-local atoms) per subject, no
composePath, no seed allocation.** `ownLocalHasTargetAtom` scans the rule's own
selector-list IR (`branchSharesAtom` over `targetAtoms`), recursing into `:is()`
grafts exactly like the matcher.

### Why it is COMPLETE (no false negatives)

The engine can only change a subject's output by matching an instruction target
against the subject's **fully-composed seed** (`composePath(s.path)`) — whole-
branch (exact/all), `all` sub-part, or a transitive chain step (which still
requires a *first* match of the seed against some target). Every such event
requires the composed seed to share at least one atom with `targetAtoms`.

Claim: `atoms(composePath(s.path)) ⊆ ⋃_{level ∈ s.path} atoms(level)`.
Composition (`compose.ts`) only ever (a) concatenates a child branch after a
parent branch (descendant — atom union), (b) wraps a level in `:is(...)` (grafts
the same atoms, which `collectBranchAtoms`/`branchSharesAtom` walk), or (c)
substitutes a `&` token with the parent selector — which introduces only atoms
already present on the parent level. Composition never invents an atom that is
absent from every level of the path. Therefore the literal per-level atom union
is a **superset** of the composed seed's atoms, and

```
!mayMatch(s)  ⟹  atoms(seed) ∩ targetAtoms = ∅  ⟹  s cannot match or chain.
```

So a rejected subject provably produces its authored/raw form. The over-
approximation direction (literal `&` counted as an atom rather than substituted)
is conservative: it can only *admit* extra subjects, never reject a real one.

This is the same fast-reject the original core (`tree/util/extend-roots.ts
::targetCanPossiblyMatch`) implements with `BitSet` key-sets; here the reject test
is a set-membership scan over `targetAtoms` (interned strings). The BitSet library
buys nothing at this atom count and adds per-selector bitset allocation, which the
lazy string-set path avoids — see §5.

## 2. The candidate set C (the prune) — provably a superset of "affected"

A rule receives a non-default map entry in the current code iff at least one of:

- `flatByRule` set: its composed seed changed → **mayMatch(s)**.
- non-default nested header: an all-extender hits its own-local → own-local shares
  a target atom → **mayMatch(s)**.
- `splits`: an exact extender matches its composed complex → **mayMatch(s)**.
- `flatten = true`: trigger B (`s` carries its own `:extend()`), trigger P (parent
  aliased by an all-extender — the child's composed seed then contains the parent
  atom → **mayMatch(s)**), trigger X (`s`'s solve gained a hoisted sibling → `s`
  changed → **mayMatch(s)**), or an ancestor flattened (cascade).
- `collapseTransparent`: `s` is the decl-less parent of a single pure-`&`
  self-compound child (`.e { && {…} }`) — a structural shape.

Define the **seeds**:

```
seed(s) = mayMatch(s) || hasOwnExtend(s) || collapseParentShape(s) || collapseChildShape(s)
```

and close DOWNWARD (a flattened rule cascades flatten to all descendants):

```
C = { s : seed(s) || (∃ ancestor a of s : seed(a)) }
```

Because "∃ ancestor a with seed(a)" pulls in the *entire* chain from that seed
ancestor down to `s`, every node whose flatten depends on its parent's flatten has
that parent on the same chain in `C`, processed earlier in document order. A node
outside `C` has no seed on its path, so `ownFlatten = false` and no flattened
ancestor — its flatten is provably false, and its map entry is the default.

Everything not in `C` gets the cheap default: `nestedPlan = { flatten:false,
header: ownLocal.map(branchText), splits:[], collapseTransparent:false }`, no
`flatByRule`, no `hoistHeader`. This is byte-identical to what the current code
computes for an untouched rule (`runFixpoint(ownLocal, [])` = ownLocal; top-level
rules never read `nestedPlan`), but costs **no composePath and no listKey**.

`|C|` is bounded by the extend-touched region: O(#extends + #may-match subjects +
their flatten subtrees), not O(#rules).

## 3. Lazy + memoized composePath

`composePath(s.path)` (full ancestor fold + Branch-IR allocation) is the expensive
primitive. It is now computed only through a memoized accessor:

```
rawOf(s)  = cache.raw.get(s)  ?? cache.raw.set(s, composePath(s.path))
flatOf(s) = { list, changed } from solveComposed(rawOf(s), s, plan)
```

Only subjects in `C` reach `flatOf`; `rawOf` is additionally pulled lazily for the
*parent* of a candidate when a flatten trigger reads `rawBySubject.get(s.parent)`
(bounded: parents of candidates). A non-candidate that is never referenced is
never composed. Zero-extends ⟹ `computeExtends` returns null after an allocation-
free pre-scan ⟹ no subject/atom/compose work at all.

## 4. Shared IR: single-extend and multi-extend are ONE pass, materialized once

Both application modes already run over the same `Branch` IR (`ir.ts`) via
`applyInstruction` (`match.ts`):

- **single-extend** = one `applyInstruction(list, target, extenders, …)` call.
- **multi-extend** = `runFixpoint` threading the SAME `Branch[]` through the
  reaching instruction set until a full pass changes nothing.

The IR is carried through every intermediate step; **no intermediate selector is
serialized to text and re-parsed.** The only materialization to strings is the
FINAL `branch.map(branchText)` the emit layer hands the serializer.

The redundant materialization the redesign removes: `runFixpoint` previously called
`listKey(list)` (full serialize) EVERY round on both the current and candidate
lists purely to answer "did this round change anything?", and `computeExtends`
serialized each subject's branch list TWICE more (`listKey(flat) !== listKey(raw)`)
to set `flatByRule`. But `applyInstruction` already returns `null` exactly when
nothing changed (an append only counts when the key is new; a partial rewrite only
returns non-null when `branchText` differs). So change detection is free: the
fixpoint consumes the non-null signal, and `solveComposed` returns a `changed`
flag. Net: the per-round and per-subject `listKey` serializations are deleted —
materialization happens once, at the end.

Explicitly NOT a trie: an extend-index trie was prototyped before and proved
slower. The IR here is the flat `Branch` model; the win is lazy candidacy + single
final materialization, not a precomputed index.

## 5. Expected complexity and the perf gate

| phase                | before                          | after                                   |
|----------------------|---------------------------------|-----------------------------------------|
| zero-extend doc      | walk + subject IR per rule      | one allocation-free pre-scan, return null|
| per untouched rule   | 2×composePath + 2×listKey + flatten machinery | O(own-local atoms) bool + 1×`ownLocal.map(branchText)` |
| per candidate (~8%)  | same                            | 1×composePath (memoized) + fixpoint, 0 per-round listKey |

The proof is measured on the WHOLE render (parse+build+serialize) median + memory +
GC via same-worktree git-toggle, not the extend phase alone: a prune that shifted
cost elsewhere or churned GC would be rejected. Byte-identity is gated by the
differential harness (optimization ON == the full-scan reference OFF) across the
whole extend fixture corpus + benchmark.less + adversarial fixtures (interpolated
selectors, `:extend(... all)`, compound/combinator/media-bubbled/self-referential
targets), plus the no-false-negative argument in §1.
