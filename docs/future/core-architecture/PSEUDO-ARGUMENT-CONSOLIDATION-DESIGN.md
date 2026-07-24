# Functional-pseudo / An+B argument grammar consolidation (design, pre-implementation)

Status: DESIGN — REVISED after the §5.0 spike FAILED (2026-07-23). The original primary mechanism
(a shared recognition artifact referencing consumer `g.` names, resolved at `composeLeaf` fuse) is
**not expressible** in parseman 0.30.0: a standalone `rules()` artifact drops to interpreter the
moment it references ANY name outside its own map (even a sibling recognition rule), and
`composeLeaf` then hard-errors. See §5.0-RESULT and §9. The viable in-scope mechanism is shared
`g`-free combinator CONSTS + shared plain reducer HELPERS, with each dialect's inline block
assembling them into an identical shape. Owner decisions §7 RESOLVED. NOT yet implemented. Byte-gated. Owner-flagged: "no downstream parser of CSS should be
re-inventing the wheel here; valid CSS should be valid code in all dialects." Follow-up to
`P0-PSEUDO-STRUCTURING-DESIGN.md`.

Load-bearing owner correction (2026-07-23): a pseudo argument NEVER "collapses to text" in the
parser — "we should always parse structure, even for unknowns." There is no scan-to-`)`
raw-text arm; core `pseudoCanonical` owns every join from structure. This design is written to
that rule (see §3c, §7).

Scope: the functional-pseudo / `<An+B>` pseudo-argument grammar duplicated across the four
AST-v2 parsers (`packages/{css,less,scss,jess}-parser/src/ast/grammar.ts`). The shared
`@jesscss/internal-css-recognition` module today shares only the LEXICAL leaves
(`CssAstSyntaxNth`, `CssAstSyntaxMalformedPseudoNumericArgument`), not the grammar composition,
so the four copies drift and produce one-off "valid CSS parses in dialect A but not B" bugs.

---

## 1. Why this is worth doing (the bug class)

The recent hand-fix `2fe9a2484` (`fix/nth-anb-whitespace`, on dev) closed TWO such bugs by
editing all four grammars separately:

1. CSS threw on bare-`n` positive An+B (`:nth-child(n+3)`, `n + 3`, `n - 3`): the selector arm
   greedily ate the lone `n` as a type selector and no typed-positive-An+B arm existed (only the
   `-n…` negative case was recognized). Blocked Bootstrap (`:nth-last-child(n + 3)`).
2. Jess threw on whitespace immediately inside ANY functional pseudo's parens
   (`:nth-child( 2n+1 )`, `:not( .b )`, `:is( .b )`) — its selector context is `noTrivia` and
   nothing consumed the surrounding paren trivia.

Both are **recognition** divergences: what the grammar accepts differs per dialect for input that
is identical valid CSS. Every arm below is a place the four copies can (and did) drift.

### Duplication inventory (verified, file:line on origin/dev)

Recognition of the nth pseudo NAME is copied with divergent boundaries:
- CSS `nthPseudoNameWithArgument = /nth-(?:last-)?(?:child|of-type)(?=\()/i`
  ([css grammar.ts:504](../../../packages/css-parser/src/ast/grammar.ts))
- SCSS `directScssNthPseudoNameWithArgument` — byte-identical
  ([scss grammar.ts:2535](../../../packages/scss-parser/src/ast/grammar.ts))
- Less `directStaticNthPseudoName = /nth-(?:last-)?(?:child|of-type)(?![-_a-zA-Z0-9-￿])/i`
  — a DIFFERENT boundary (`(?!…)` not `(?=\()`), plus split child/type variants
  ([less grammar.ts:1477-1479](../../../packages/less-parser/src/ast/grammar.ts))
- Jess inlines its own `directJessStaticNthOfHead` regex
  ([jess grammar.ts:1408](../../../packages/jess-parser/src/ast/grammar.ts))

~15 distinct pseudo-argument productions across the four files, each re-deciding An+B, surrounding
whitespace, `of <selector>`, malformed rejection, and structured-vs-opaque handling:

| dialect | productions | arg model | interp hatch | notes |
| --- | --- | --- | --- | --- |
| CSS | `CssAstLeadingDashPseudoArgument`, `CssAstLeadingDashRawPseudoArgument`, `CssAstTypedNthPseudoArgument`, `CssAstPseudoArgument`, `CssAstGenericPseudoArgument`, `CssAstPseudo` ([650-703](../../../packages/css-parser/src/ast/grammar.ts)) | structured `SelectorList` | none | reference; colon left-factored |
| Less | `DirectLessStaticNthArgument`, `DirectLessStaticNthChildPseudo`, `DirectLessStaticNthTypePseudo`, `DirectLessInterpolatedNthPseudo`, `DirectLessStaticNonSelectorPseudoArgument`, `DirectLessStaticPseudoArgument`, `DirectLessStaticPseudo` ([3704-3788, 3874+](../../../packages/less-parser/src/ast/grammar.ts)) | structured `SelectorList` | `@{…}` (`DirectLessVariableInterpolation`) | most fragmented; extend-pseudo special-case; `nth-of-type` correctly rejects `of` |
| SCSS | `DirectScssPseudoArgument`, `DirectScssStaticPseudoArgument`, `DirectScssStaticSelectorPseudoArgument` (+ Group/Square/Item/Tail), `DirectScssPseudo` (4-arm) ([2484-2593](../../../packages/scss-parser/src/ast/grammar.ts)) | **TEXT (raw chunks)** except structured arm | `#{…}` (excluded from chunks) | outlier: args are text, not `SelectorList` |
| Jess | `directJessStaticNthPseudoArgument`, `DirectJessStaticPseudoArgument`, `DirectJessPseudo` ([1332-1439](../../../packages/jess-parser/src/ast/grammar.ts)) | structured `SelectorList` | `$(…)` / `$[…]` | no raw arm (deliberate — would hide `$` interp) |

### Residual divergences still present after `2fe9a2484` (fold into this work)

- **`,` vs `, ` in the collapse-to-text path — a symptom of a path that should not exist.** CSS
  `selectorArgumentText` joins multi-branch with `,`
  ([css grammar.ts:361](../../../packages/css-parser/src/ast/grammar.ts)); Jess
  `staticSelectorText` joins with `, ` ([jess grammar.ts:339](../../../packages/jess-parser/src/ast/grammar.ts)).
  Surfaces today for selector-arg pseudos that are NOT in the structured whitelist
  (`::slotted(.a, .b)`, `:global`/`:local`) and `:nth-child(2n of .a, .b)`, which currently
  collapse to text. Per the owner correction, the parser should NEVER collapse these to a
  canonicalized string — they should retain structure like `:is()` does, and core
  `pseudoCanonical` owns the join. → both helpers are **DELETED**, not unified (§3c).
- **SCSS preserves surrounding whitespace for SELECTOR-valued pseudos.** `:not( .b )` →
  `:not( .b )` (others emit `:not(.b)`); `:is( .b, .c )` → `:is( .b,.c )`. Parses (valid CSS is
  valid) but the serialization diverges — same root cause (per-dialect arg grammar, and SCSS's
  text-not-structure arg model).
- **`of <selector>` applicability — RESOLVED: restrict to child variants (CSS-aligned).** CSS's
  `of`-accepting arm keys on `nth-(?:last-)?(?:child|of-type)`, so CSS accepts the **spec-invalid**
  `:nth-of-type(2n of .a)` ([css grammar.ts:504](../../../packages/css-parser/src/ast/grammar.ts)).
  Less CORRECTLY restricts `of` to the child variants (`DirectLessStaticNthTypePseudo` uses bare
  `CssAstSyntaxNth`, [less grammar.ts:3722-3726](../../../packages/less-parser/src/ast/grammar.ts)).
  Selectors-4 §6.6.2 restricts `of S` to `:nth-child()`/`:nth-last-child()`. The shared grammar
  splits the nth name into child (accepts `of S`) vs of-type (bare An+B) — Less's shape, applied to
  all four. CSS/SCSS/Jess tighten to reject `:nth-of-type(2n of .a)` (it is not valid CSS).

---

## 2. The hard constraint that shapes the design (parseman macro-fusion, verified)

All four AST grammars are built with `composeLeaf([cssAstSyntax, opaqueAtRuleRecognition,
rules<T>({trivia}, g => {…})])`. Verified against parseman source (linker `fusedBody`, codegen
`compileLinkable`, macro plugin `compileComposeLeafCall`):

- **Cross-artifact `g.X` name resolution is deferred to fuse time.** An undefined `g.Name` in a
  `rules()` callback compiles to a body-less `_r_<Name>` call; the linker's winner-map resolves it
  across all fused artifacts. A genuinely missing name throws only at fuse
  (`compose: rule "K" references missing rule "D"`). So a STANDALONE exported artifact CAN
  reference names its consumer supplies — this is the intended "external ref" mechanism.
- **`composeLeaf` forbids an imported SEMANTIC artifact.** Its macro lowering requires: (1) the
  final (semantic/leaf) argument is an INLINE `rules()` call or a same-file identifier — an
  imported const cannot be the leaf; (2) every NON-final argument proves recognition-only
  (`hasDirectBuilders === false && isRecognitionOnly === true`) or it hard-errors
  `composeLeaf() must macro-fuse; runtime composition is forbidden`. A shared artifact that both
  references consumer `g.` names AND carries its own `node()` reducers is therefore **NOT
  expressible through `composeLeaf`**. (Only the general `compose`/`linkable` path allows imported
  semantic artifacts with external refs — but migrating all four grammars off `composeLeaf` is
  invasive and the macro-compiled tests assert `not.toMatch(/composeLeaf/)`; rejected, see §8.)
- **Recognition-only + external refs is UNEXERCISED in this repo.** The three existing shared
  artifacts (`cssAstSyntax`, `lessAstSyntax`, `opaqueAtRuleRecognition`) are `_g =>` self-contained
  leaf maps with ZERO external refs. No standalone artifact today references a consumer-supplied
  name. The mechanism supports it; the specific path does not yet run. → **de-risk with a spike
  before the full migration (§5).**
- **Macro-dedup rule (from memory / prior waves):** dedup only via shared parameterless combinator
  CONSTS or by-name `g.` references. FORBIDDEN (all force interpreter fallback / `composeLeaf`
  hard-error): combinator FACTORIES (`f() => choice(...)`), `[...spread]` in call args,
  `many(choice)` bound to a const, `{skip: identArray}`, hoisted regex-source consts.

**Conclusion the design is forced into:** share the RECOGNITION STRUCTURE (which is exactly where
the bugs live), keep REDUCTION local (thin), and collapse the reducer-side divergence via shared
CORE helpers — not a shared semantic grammar artifact.

---

## 3. Design (LOCKED mechanism — shared `g`-free consts + core reducer helpers)

Both spikes (§5.0, §5.1) rule out a shared external-ref grammar artifact. The viable, sanctioned
mechanism (the Wave-1 dedup path) has two shareable pieces; the assembled STRUCTURE stays in each
dialect's inline block but is disciplined to the shared pieces so it cannot drift.

### 3a. Shared `g`-free recognition ARTIFACT (dialect-invariant, no external refs)

IMPLEMENTATION NOTE (Landing 1a): a bare cross-MODULE `export const = regex(...)` used directly as a
combinator argument does NOT compile — parseman resolves a free combinator-argument identifier only
via the local module's top-level scope; cross-module values resolve only via the `composedPieces`
marker a compiled `rules()` artifact carries. So the shared leaves ship as a `rules()` RECOGNITION
ARTIFACT (the `cssAstSyntax` pattern), consumed at a `composeLeaf` position and referenced through
`g.`. (Bare consts work SAME-MODULE only — that's what Wave-1 did within one parser file.)

```ts
// packages/internal-css-recognition/src/pseudo-consts.ts, export subpath ./pseudo-consts
import { regex, rules } from 'parseman' with { type: 'macro' };
// `of S` valid ONLY for nth-child/nth-last-child (Selectors-4 §6.6.2); of-type takes bare An+B (§7.1).
export const cssAstPseudoSyntax = rules(_g => ({
  CssAstSyntaxNthChildName:    regex(/nth-(?:last-)?child(?=\()/i),
  CssAstSyntaxNthTypeName:     regex(/nth-(?:last-)?of-type(?=\()/i),
  CssAstSyntaxOfKeyword:       regex(/of(?![-\w])/i),
  CssAstSyntaxPseudoCloseAhead: regex(/(?=[ \t\n\r\f]*\))/),   // tolerate surrounding paren ws
}));
// (the An+B leaf `CssAstSyntaxNth` + `CssAstSyntaxMalformedPseudoNumericArgument` already in cssAstSyntax)
```

Each parser adds `cssAstPseudoSyntax` as a non-final `composeLeaf` arg (isolated per-landing — only
the migrated parser opts in) and references `g.CssAstSyntaxNthChildName` etc. This ALONE kills the
recognition-divergence bug class: ONE canonical nth-name boundary (replacing css `(?=\()` vs less
`(?![-_a-zA-Z0-9…])` vs jess's inlined regex), ONE `of` spelling, ONE surrounding-ws close-ahead.
What the artifact CANNOT hold is anything referencing the dialect's `g.selector`/`g.interp` (that was
the spike failure) — those assemblies stay in the dialect's inline block (§3b).

### 3b. Per-dialect assembly (identical shape over shared pieces)

Each parser's EXISTING final inline `composeLeaf` block imports the shared consts and assembles the
SAME structure, referencing its own selector/interp/value productions directly (these are local
`g.` names, which resolve fine in the inline block). The shape is copied per dialect but every
dialect writes it identically over the shared consts + a shared reducer helper, so drift is
structural-only and reviewable:

```ts
// inside each grammar's rules(g => { ... }) block:
const nthChildArg = parser({ trivia: ws }, sequence(
  g.CssAstSyntaxNth, optional(sequence(ofKeyword, g.<DialectSelector>)), closeAhead));   // of S
const nthTypeArg  = parser({ trivia: ws }, sequence(g.CssAstSyntaxNth, closeAhead));      // no of
const functionalArg = choice(
  g.<DialectInterp>,                                   // @{…}/#{…}/$(…)/$[…]; omit arm for CSS
  parser({ trivia: interstitial }, g.<DialectSelector>),
  g.<DialectValue>);                                   // structure-preserving <any-value>, no text
const CssAstPseudo = node('CssAstPseudo', choice(
  sequence(pseudoColon, choice(nthChildNameWithArg, nthTypeNameWithArg), literal('('), choice(nthChildArg, nthTypeArg), literal(')')),
  sequence(pseudoColon, g.CssAstSyntaxKeyword, optional(sequence(literal('('), functionalArg, literal(')'))))),
  children => reducePseudo(children, crossablePseudos));   // shared core helper, §3c
```

- The ONLY per-dialect variation is `<DialectSelector>` / `<DialectInterp>` / `<DialectValue>` and
  the trivia const — the legitimate axis. CSS omits the interp arm entirely (no `@{…}`/`#{…}`/`$`).
- Everything else (arm order, `of` gate, name boundary, close-ahead, reducer) is shared bytes.
- **No text-collapsing raw arm** — the functional fallback is the dialect's structure-preserving
  `<any-value>` production (owner correction §7.2).

### 3c. Shared reducer + constants in core (kills the reduction-side divergence)

Per the owner correction, the parser retains structure for EVERY pseudo argument; core
`pseudoCanonical` (`nodes.ts`, `branches.join(', ')`) owns all joins. Concretely:

- **DELETE** css `selectorArgumentText` ([css:359](../../../packages/css-parser/src/ast/grammar.ts))
  and jess `staticSelectorText` ([jess:338](../../../packages/jess-parser/src/ast/grammar.ts)) —
  they exist only to canonicalize a pseudo arg to a string, which the parser must not do. The
  `,` vs `, ` divergence disappears with them (there is no parser-side join to decide).
- **Selector-valued args ALWAYS keep their `SelectorList`** (a `PseudoSelector` node with
  `args`), regardless of the pseudo name. The `STRUCTURED_PSEUDOS` set is no longer a
  "structure vs text" gate — it dissolves. What survives is the narrower CORE concern of which
  pseudos are `crossable` by the extend engine (`:is`/`:matches` per `EXTEND-*` docs); move that
  set to ONE core export (`crossablePseudos`), consumed at extend/serialize time, not at parse.
- `<any-value>` args that are NOT selectors (`:dir(rtl)`, `:lang(en, fr)`, unknown functional
  pseudos) reduce to a structure-preserving value node (comma/space token structure + trivia),
  NOT a flattened string — consistent with `no-structural-node-flattened-to-any`.
- A shared `reducePseudo(children)` helper builds `pseudoSelector(head, args)` from the retained
  structure; dialect reducers become one-liners over it. It never stringifies an arg.

**Representation note (SCSS) — the largest lift.** SCSS today produces argument TEXT (raw chunk
grammar), not a structured `SelectorList`, on its nth and selector-arg arms
([scss:2510-2532](../../../packages/scss-parser/src/ast/grammar.ts)). "Always structure" means
SCSS must move onto `g.DirectScssSelector` (structured) for selector args and a structured value
node for `<any-value>` — its biggest change and the highest byte-identity risk, sequenced LAST
(§5). This is also where the residual `:not( .b )` surrounding-whitespace bug is fixed for free:
once the arg is a structured `SelectorList`, core serialization emits `:not(.b)` like the others.

---

## 4. What stays dialect-specific (legitimately)

- The `DialectPseudoSelector` production itself (each dialect's recursive static selector grammar,
  with its own trivia policy and simple-selector leaves).
- The interpolation escape hatch bound to `DialectPseudoInterpArgument` (`@{…}`/`#{…}`/`$(…)`/`$[…]`).
- Less's `:extend(...)` pseudo special-casing and `DirectLessInterpolatedNthPseudo` (`@{n}` as a
  whole An+B arg) — Less-only; injected via the interp external ref, not forced into the shared
  shape.
- The dialect's structure-preserving `<any-value>` production bound to `DialectPseudoValueArgument`
  (each dialect already has value/general-enclosed grammar with its own trivia + interp rules).

---

## 5. Migration order (each step byte-gated + macro-compiled test green)

0. **Spike (de-risk the unexercised path).** Add a trivial recognition-only artifact with ONE rule
   referencing ONE external name, wire it as a non-final `composeLeaf` arg in the CSS parser only,
   bind the name in the inline block. Confirm: (a) `css-parser/test/macro-compiled.test.ts` stays
   green (`typeof G.Stylesheet === 'function'`, no `_def`/`parse`, no `composeLeaf(`/
   `internal-css-recognition` string in the compiled output); (b) the CSS suite is byte-identical.
   If this fails, the recognition-only-with-external-refs path has an unexercised codegen gap and
   the whole approach needs rework BEFORE any grammar is touched. **Gate the entire effort on this.**

   **§5.0-RESULT (2026-07-23): FAILED — as-designed mechanism is dead.** Build-spike in an isolated
   worktree (parseman 0.30.0, css-parser). A standalone exported `rules()` artifact that references
   `g.CssAstSelector` dropped to the interpreter ("rule map couldn't be inlined"); the built lib
   carried no `composedPieces` literal, so `composeLeaf` threw
   `composeLeaf() must macro-fuse; runtime composition is forbidden` at build. Isolation experiment:
   a self-contained rule map inlines fine; referencing EVEN a sibling recognition rule
   (`g.CssAstSyntaxNth`) also fails — so the blocker is ANY cross-map reference, not the consumer
   name specifically. Cross-refs resolve ONLY inside the FINAL inline `composeLeaf` block, never in a
   pre-compiled imported artifact. → design revised to the shared-consts mechanism below.
1. **CSS** (reference, already structured): introduce `cssAstPseudoRecognition`, move CSS onto it;
   split the nth name (child/of-type, §7.1); delete `selectorArgumentText`. Byte-identity vs current
   CSS suite + core. NOTE: dropping `:nth-of-type(2n of .a)` acceptance is an intended tightening —
   confirm no alpha fixture depends on it.
2. **Jess** and **Less** (already structured `SelectorList`): bind their selector + interp externals,
   adopt the shared shape; delete `staticSelectorText`; retain structure for previously-opaque
   selector-arg pseudos. Byte-identity + jess ratchet.
3. **SCSS** (LAST — text→structured representation change): move selector args onto
   `g.DirectScssSelector` (structured) and `<any-value>` onto a structured value node; the residual
   `:not( .b )` surrounding-whitespace bug is fixed for free once args are structured. Validate
   against the full SCSS byte-identity corpus. Highest risk; isolated so a red here never blocks the
   other three.
4. **Cleanup:** delete the ~15 now-dead per-dialect productions and the two `*SelectorText` helpers;
   move the `crossablePseudos` set to core; confirm the duplication inventory in §1 is at ZERO.

### §5.1 — SECOND spike (compose/linkable) ALSO FAILED → mechanism locked to shared consts

Before adopting the shared-consts mechanism I tested whether the owner-suggested `compose`/`linkable`
path could instead host a fully-shared SEMANTIC pseudo grammar (external-ref, with reducers). Build
spike (CSS, parseman 0.30.0): **FAILED.** `compose` does not fuse a reducer-bearing external-ref
export — the plugin attaches fusable "carried pieces" ONLY to pure-recognition (reducer-free)
exports, so `compose([...])` fell back to a runtime call (retained the import) and the interpreter
crashed (`g.CssAstSelector` undefined in the isolated map → `TypeError reading 'firstSet'`). The
plugin has NO `linkable` code path at all. **Conclusion:** a shared artifact that both carries a
reducer and references a consumer rule is not build-resolvable on EITHER `composeLeaf` or `compose`
in 0.30.0. Full-DRY would require a parseman PLUGIN feature (emit carried pieces for
reducer-bearing/`linkable` exports) — a separate, out-of-scope decision. → **Mechanism is locked to
§3's shared-consts + core-reducer-helpers form** (the sanctioned Wave-1 dedup path), which needs no
parseman change and still eliminates the recognition-divergence bug class.

Each landing: all four parser suites + core + jess ratchet green and byte-identical; each parser's
`*macro-compiled*.test.ts` green (proves fusion, not interpreter fallback).

---

## 6. Adversarial review — invariants checked

- **Macro-fusion (composeLeaf):** shared artifact is recognition-only (no builders) → passes the
  non-final-arg gate; final semantic block stays inline/same-file → passes the leaf gate. ✅ (pending
  the §5.0 spike, since the recognition-only+external-ref combo is unexercised).
- **Macro-dedup:** parameterization is by-name `g.` external refs + shared parameterless consts, NOT
  combinator factories / spreads / `{skip: idents}`. ✅
- **Parser owns structure, core owns joins (P0 + owner correction):** ALL pseudo args keep
  structure; the shared artifact adds no join and has no scan-to-text arm; the two `*SelectorText`
  helpers are deleted, so the `,`/`, ` decision no longer exists in any grammar — core
  `pseudoCanonical` is the sole join site. ✅
- **Rob-Peter-pay-Paul:** does sharing recognition regress any dialect's INTENTIONAL divergence?
  Audited: Less `nth-of-type` rejects `of` (spec-correct) — the shared grammar ADOPTS Less's
  child/of-type split (§7.1), so this is preserved, not regressed; CSS/SCSS/Jess tighten to match
  valid CSS. Less `:extend`/`@{n}` interp stays via the interp external-ref binding, not lost. ✅
- **No new hidden classes / shape stability:** reducers still emit the same `SimpleSelector` /
  `PseudoSelector` node shapes; no widening. ✅

---

## 7. Owner decisions — RESOLVED (2026-07-23)

1. **`of <selector>` applicability → RESTRICT to `:nth-child`/`:nth-last-child` (CSS-aligned).**
   Owner: "it's not a 'dynamic' feature, it has to be CSS-aligned." `of S` on `:nth-of-type` is not
   valid CSS (Selectors-4 §6.6.2), so all four dialects reject it. The shared grammar splits the nth
   name (child accepts `of S`; of-type takes bare An+B) — Less's existing shape, now universal.
   CSS/SCSS/Jess tighten to match. Gate on the alpha corpus staying green.
2. **Never "collapse to text" → the parser ALWAYS retains structure, even for unknowns.** Owner:
   "it should never 'collapse to text' … we should always parse structure, even for unknowns." So
   the `,` vs `, ` question is void — there is no parser-side join. The two `*SelectorText` helpers
   are DELETED; core `pseudoCanonical` owns every join from structure (§3c). Selector-valued args
   always retain their `SelectorList`; non-selector `<any-value>` args retain token/trivia structure,
   never a flattened string. `STRUCTURED_PSEUDOS`-as-a-parser-gate dissolves; only the core
   `crossablePseudos` (extend) set survives.

---

## 8. Rejected alternatives

- **Shared SEMANTIC artifact (with reducers) via `composeLeaf`.** Not expressible — `composeLeaf`
  hard-errors on a non-final arg that carries builders, and forbids an imported const as the leaf
  (§2, verified in parseman source).
- **Migrate all four grammars to the general `compose`/`linkable` path** (which DOES allow imported
  semantic artifacts with external refs). Rejected: invasive rewrite of the composition mechanism for
  four parsers, and the `*macro-compiled*.test.ts` suite asserts `not.toMatch(/composeLeaf/)` — this
  would rewrite the tests' own premise. Disproportionate to the goal.
- **Shared parameterless combinator consts only** (no external-ref artifact). Would share the leaves
  but NOT the arm ORDERING / structure where the bugs actually live (each dialect still assembles the
  arms). Weaker; keep external-ref parameterization so the STRUCTURE is shared once.
