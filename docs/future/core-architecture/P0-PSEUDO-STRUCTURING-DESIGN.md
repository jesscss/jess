# P0: Structured pseudo-selectors in the AST-v2 model (validated blueprint)

Status: DESIGN validated by forensic pass + adversarial review. Ready to implement, byte-gated.
Prerequisite for the extend `:is()` port (`EXTEND-PORT-DESIGN.md`). Parser/AST + serializer only —
NO extend-engine change (that is P1).

## Verdict (from review)
Node model is sound and byte-safe. The two load-bearing choices are correct: (1) a **distinct
`PseudoSelector` node** (widening `SimpleSelector` would give `type:'SimpleSelector'` two hidden classes
— invariant 1 violation the shape-stability harness would catch); (2) **parser owns structure** — the
grammars ALREADY parse a `SelectorList` inside `:is()/:where()/:not()/:has()` and then discard it to text;
P0 *retains* it. Re-parsing the text at extend time would be an invariant-2 violation. **The good news:**
for CSS/Less/Jess, P0 is "stop discarding the `SelectorList` you already built." Only **SCSS** genuinely
adds a parse (today it keeps args as raw regex chunks).

## The node model
```ts
interface PseudoSelector {
  readonly type: 'PseudoSelector';
  readonly text: string;          // FIELD 1 — exact per-dialect canonical, same offset as SimpleSelector.text
  readonly interp: Interpolation | null;  // FIELD 2 — same offset as SimpleSelector.interp
  readonly name: string;          // verbatim, e.g. ':is' / ':IS' (case preserved)
  readonly args: SelectorList | null;      // recursive; null = degrade-to-opaque (SCSS best-effort)
  readonly crossable: boolean;    // true iff name.toLowerCase() ∈ {:is,:matches}
}
type SimpleToken = SimpleSelector | PseudoSelector;   // CompoundSelector.simples: SimpleToken[]
```
`text`/`interp` are the FIRST TWO fields at the SAME offsets as `SimpleSelector` so the degree-2 IC over
`sim.text`/`sim.interp` in `compoundCanonical` reads a shared-prefix offset (cheap; ≤4-way, not megamorphic).

## Serialization: emit `text`, ignore `args` — byte-identical by construction
`compoundCanonical`/`compoundHasInterp`/`compoundHasAmpersand` (`nodes.ts:459-500`) and
`serialize.ts:3389-3437` read `sim.text`/`sim.interp` — which `PseudoSelector` carries at the same offsets.
`text` is the EXACT string the grammar already computes (four distinct authored spellings: CSS/Less
`join(',')` no-space, Jess `join(', ')` space, SCSS verbatim chunk join). Serializer never re-joins off `args`.

## The 6 REQUIRED amendments (from adversarial review — all must land before/with code)
1. **`text` from the EXISTING join, never re-derived from `args`.** Reducer:
   `{type:'PseudoSelector', name, args, crossable, text: head + '(' + existingArgText + ')'}` where
   `existingArgText` is today's `selectorArgumentText`/`staticSelectorText`/chunk result. Re-joining off
   `args` would silently normalize SCSS verbatim + pick one comma-spelling for all → wide regression.
2. **`PseudoSelector` carries `text` + `interp` (fields 1-2, shared offsets)**; the 3 canonical helpers +
   serialize read them. **DECIDE + document** whether pseudo-arg interpolation (`:is(@{x})`/`#{$x}`)
   resolves per-frame or stays opaque — must match TODAY exactly (today `:is(@{x})` likely rides an
   opaque/raw path; confirm and preserve — do NOT let structured `args` freeze a currently-resolving interp).
3. **`branchFromComplex` keeps pseudos OPAQUE `{t:'text', text: pseudo.text}` for ALL of P0** — this is the
   entire extend byte-safety of P0. **AND** pre-provision the extend-IR graft node (`ir.ts:17`
   `{t:'is'}`) to carry an original verbatim `text` field NOW, so P1 can re-serialize an *unmodified* graft
   verbatim (no-space authored `:is` preserved) and only re-serialize *structurally* (spaced) when extend
   actually rewrote the branches. **R2's fix is a P0 data-model obligation.**
4. **SCSS `args` is BEST-EFFORT / optional** — `args:null` (sealed-opaque) whenever the permissive chunk
   content is not a clean `SelectorList` (the chunk path accepts `:is(.a,,,.b)`, `:is(> ~ +)` that a real
   parse rejects → making the parse authoritative is a hard regression). `text` stays the verbatim chunk join.
5. **Classification gates on the NAME WHITELIST, explicitly NOT on colon count.** `::slotted()` DOES take
   selector args but stays opaque because it's not in the whitelist. Never key crossable/sealed on `:` vs `::`
   (`pseudoColon = /::?/` is shared). Fix the "pseudo-elements never take selector args" rationale.
6. **Add an authored-`:is`-through-extend byte fixture NOW** (`.x:is(.a,.b){}` + `.z:extend(.x){}`),
   red-flagged for P1 — the current extend corpus only asserts engine-SYNTHESIZED spaced `:is` and is BLIND
   to authored no-space carry-through (R2).

## R2 resolved (the "which spelling" decision — answer: neither globally)
There is NO single byte-safe spelling: aligning the IR to no-space would break the current ast-v2 extend
corpus (synthesized spaced `:is`, which the alpha `.css` oracle passes); keeping authored `:is()` opaque is
what preserves no-space today. The only byte-safe rule: **unmodified graft ⟹ verbatim original `text`;
modified graft ⟹ structural (spaced, matching the synthesis oracle).** Hence amendment 3.

## Classification
`CROSSABLE = {':is', ':matches'}` (lowercased compare). Sealed: `:where`, `:not`, `:has`, `:global`,
`:local`. OPEN (owner call, low blast radius): `:global`/`:local` are CSS-Modules pseudos in the Less/SCSS
selector-arg name-set — structure them (sealed) or keep opaque text? Default: structure sealed (consistent).

## Phased byte-gated build order (each: 4 parser suites + core selector/extend green, byte-identical)
- **P0.1** — node + `pseudoSelector()` ctor + `SimpleToken` union + `crossable()` map + the `PseudoSelector`
  arms in the 3 canonical helpers + serialize (all reading `text`/`interp`). NOTHING constructs it yet →
  provably byte-identical (dead arm). + a selector-serialize before/after MEASUREMENT (IC degree; the
  shape-stability harness does NOT catch the degree-2 read).
- **P0.2 CSS**, **P0.3 Less**, **P0.4 Jess** — grammar reducers emit `PseudoSelector` (retain the parsed
  `SelectorList`); gate each parser's suite byte-identical.
- **P0.5 SCSS** — net-new recursive selector-arg parse, `args` best-effort/optional (amendment 4), `text`
  from the verbatim chunk join. Highest risk; scss 141 byte-identical, quoted-comma/interior-whitespace cases.
- **P0.6 extend-inert smoke** — `branchFromComplex` maps `PseudoSelector` → `{t:'text', text}` (amendment 3);
  full extend corpus byte-identical WITH structured nodes present but not forked. Proves P0 inert to extend.
- Then **P1** flips `branchFromComplex` to build `{t:'is'/pseudo}` grafts (carrying verbatim `text`).

## Untouched-but-assert (not P0 gaps): `ExtendInstruction.target`/`SelectorCapture` selector text, `:has(> .a)`
relative args, nested `:is(:where(...))` (recursive by construction), `:nth-child(... of S)` (opaque, nth arm).
