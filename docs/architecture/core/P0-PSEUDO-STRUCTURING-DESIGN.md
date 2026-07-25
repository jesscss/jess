# P0: Structured pseudo-selectors in the AST-v2 model (validated blueprint)

Status: DESIGN validated by forensic pass + adversarial review. Ready to implement, byte-gated.
Prerequisite for the extend `:is()` port (`EXTEND-PORT-DESIGN.md`). Parser/AST + serializer only —
NO extend-engine change (that is P1).

## ARCHITECTURAL CORRECTION (2026-07-23, owner-stated, non-negotiable)
The PARSER's job is STRUCTURED PIECES + captured TRIVIA. The parser NEVER joins, NEVER canonicalizes,
NEVER decides `,` vs `, `, NEVER calls a `*SelectorText` canonical-join helper on pseudo args, and NEVER
populates a serializer-owned `_canon` memo during parse. SERIALIZATION (in core) owns ALL whitespace/trivia
rules, and those rules ALREADY EXIST unchanged:
- `:is()`/pseudo args serialize on ONE line with normalized WS — inline `:is(a, b)` — via the core-owned
  `pseudoCanonical` (`nodes.ts`) and `serialize.ts` (`branches.join(', ')`).
- Top-level selector lists serialize one-per-line with normalized indent (`header.join(',\n' + idt)`).

Therefore a STRUCTURED `PseudoSelector` (has `args: SelectorList`) has **`text: null`** — the structure
lives in `args`, and the inline join is computed by `pseudoCanonical(p) = p.name + '(' +
p.args.selectors.map(complexCanonical).join(', ') + ')'` (the ONE core serialization site). `complexCanonical`
is core-owned serialization, so its join belongs in core, never in a grammar. The superseded amendment-1
"`text` from the EXISTING grammar join" is REPLACED by this: the grammar emits `pseudoSelector(name, args)`
with no text and no `selectorArgumentText` call on the structured arg; `text` is retained ONLY for the
degrade-to-opaque `args: null` case. The rest of this doc is preserved for history; where it says "emit
`text`" for a structured pseudo, read "emit `pseudoCanonical(args)`".

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
  readonly text: string | null;   // FIELD 1 — NULL for the structured case (structure is in `args`);
                                   //   non-null ONLY for degrade-to-opaque (`args: null`). Same offset
                                   //   as SimpleSelector.text.
  readonly interp: Interpolation | null;  // FIELD 2 — same offset as SimpleSelector.interp
  readonly name: string;          // verbatim, e.g. ':is' / ':IS' (case preserved)
  readonly args: SelectorList | null;      // recursive; null = degrade-to-opaque (SCSS best-effort)
  readonly crossable: boolean;    // true iff name.toLowerCase() ∈ {:is,:matches}
}
type SimpleToken = SimpleSelector | PseudoSelector;   // CompoundSelector.simples: SimpleToken[]
```
`text`/`interp` are the FIRST TWO fields at the SAME offsets as `SimpleSelector` so the degree-2 IC over
`sim.text`/`sim.interp` in `compoundCanonical` reads a shared-prefix offset (cheap; ≤4-way, not megamorphic).

## Serialization: emit `pseudoCanonical(args)` — the core join, one output spelling
A structured `PseudoSelector` has `text: null`, so `compoundCanonical` (`nodes.ts`), `compoundHasAmpersand`,
and `serialize.ts`'s `resolveSimpleText` route it through `pseudoCanonical`/`simpleTokenText` — the SINGLE
core serialization site that joins the parsed `args` inline as `:is(a, b)` (`, ` separator, one line, via
core-owned `complexCanonical`). There is exactly ONE output spelling: **spaced** (see R2 below). The grammar
computes NO join and populates NO `_canon` at parse — so parse-time node shapes stay monomorphic (the
shape-stability harness stays green). SCSS best-effort (`args:null`) still falls back to the retained
verbatim `text` in the opaque branch.

## The 6 REQUIRED amendments (from adversarial review — all must land before/with code)
1. **SUPERSEDED by the ARCHITECTURAL CORRECTION above.** (Was: "`text` from the EXISTING grammar join.")
   The structured case now stores NO joined `text` (`text: null`); the join is core-owned
   (`pseudoCanonical`). The grammar emits `pseudoSelector(name, args)` and never calls a join helper on the
   structured arg. The SCSS-verbatim / comma-spelling concern this amendment guarded against is moot: core
   emits ONE spaced spelling from `args`, and SCSS best-effort falls back to opaque `text` only when `args`
   is null.
2. **`PseudoSelector` carries `text` + `interp` (fields 1-2, shared offsets)**; the 3 canonical helpers +
   serialize read them. **DECIDE + document** whether pseudo-arg interpolation (`:is(@{x})`/`#{$x}`)
   resolves per-frame or stays opaque — must match TODAY exactly (today `:is(@{x})` likely rides an
   opaque/raw path; confirm and preserve — do NOT let structured `args` freeze a currently-resolving interp).
3. **`branchFromComplex` keeps pseudos OPAQUE `{t:'text', text: pseudo.text}` for ALL of P0** — this is the
   entire extend byte-safety of P0 (structured nodes present, but flattened to text, so extend is inert).
   Then P1 builds SPACED grafts. (CORRECTED: the "carry verbatim no-space text" half of this amendment is
   DROPPED — output is always spaced per R2/owner; the graft re-serializes spaced regardless. No verbatim
   carry-through needed.)
4. **SCSS `args` is BEST-EFFORT / optional** — `args:null` (sealed-opaque) whenever the permissive chunk
   content is not a clean `SelectorList` (the chunk path accepts `:is(.a,,,.b)`, `:is(> ~ +)` that a real
   parse rejects → making the parse authoritative is a hard regression). `text` stays the verbatim chunk join.
5. **Classification gates on the NAME WHITELIST, explicitly NOT on colon count.** `::slotted()` DOES take
   selector args but stays opaque because it's not in the whitelist. Never key crossable/sealed on `:` vs `::`
   (`pseudoColon = /::?/` is shared). Fix the "pseudo-elements never take selector args" rationale.
6. **Add an authored-`:is`-through-extend byte fixture NOW** (`.x:is(.a,.b){}` + `.z:extend(.x){}`),
   red-flagged for P1 — the current extend corpus only asserts engine-SYNTHESIZED spaced `:is` and is BLIND
   to authored no-space carry-through (R2).

## R2 resolved (CORRECTED — owner + `.css` oracle): CSS OUTPUT is ALWAYS SPACED. One spelling.
The earlier "no-space to match the reference" was a MISREAD: the no-space `:is(.a,.b)` / `:where(.a,.b)`
forms are `.valueOf()` — the NORMALIZED string for equality/matching comparisons, **never rendered CSS**.
Actual CSS output uses standard formatting — **always `, ` (space after comma)**: confirmed by the `.css`
oracle (`:is(.bar, .ext3, .ext4)`, `:is(h1, h2, h3)`, `:is(.foo, .ext1 .ext2, .ext3, .ext4)`) and the
css-parser `nesting.css` round-trip (`:is(h1, h2, h3)` spaced). So there is exactly ONE output spelling:
**spaced**. The synthesized-graft serializer (`ir.ts:78`, `emit.ts:149` — `join(', ')`) is ALREADY correct;
authored `:is()` must render spaced via the same path. Internal MATCHING uses the normalized (no-space)
valueOf form; do NOT conflate it with output.

**Amendment 3 is therefore SIMPLIFIED** — the "carry verbatim no-space text so unmodified grafts
re-serialize verbatim" mechanism is UNNECESSARY (it preserved a valueOf artifact that never reaches output).
The IR graft re-serializes SPACED whether or not extend modified it. What P0 must still keep is
constraint 3's FIRST half — `branchFromComplex` keeps pseudos opaque for all of P0 (byte-safe inert), then
P1 builds spaced grafts. Byte-identity gates against the **render-based (spaced) extend corpus + `.css`
oracle**, NOT the `.valueOf()` no-space assertions.

**One empirical check owed at the CSS grammar phase (P0.2/P1):** does CURRENT ast-v2 render an authored
`.x:is(.a, .b){}` spaced (⟹ port is byte-identical) or leak the parser's no-space `selectorArgumentText`
canonical to output (⟹ a current bug the port CORRECTS to spaced, gated on the `.css` oracle per
intended-design, not on byte-identity to the wrong output)? Verify with a real render, don't assume.

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
