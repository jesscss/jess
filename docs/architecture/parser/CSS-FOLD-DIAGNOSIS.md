# CSS parser AST/CST grammar-fold diagnosis — Stage 3 (the pattern proof)

Recorded 2026-07-25 against `dev` at `be272a577` (i.e. post regroup + parseman
0.37.0 bump + Stage-2.1 byte-identity gate). This document is the §Unit4 step-9
deliverable: *"Diagnose why css-parser's AST grammar is ~2.3× its CST twin.
Report before writing."*

Measured (at `be272a577`):

| grammar | lines | bytes | entry shape |
|---|---|---|---|
| CST (`src/grammar.ts`) | **1,527** | 54,943 | `export const cssGrammar = rules({ trivia, scanSkip }, (g) => ({ ... }))` exported via a trailing `const { Stylesheet, Ruleset, ... } = cssGrammar;` destructure |
| AST (`src/ast/grammar.ts`) | **3,455** | 117,775 | `export const cssAstGrammar = composeLeaf([cssAstSyntax, opaqueAtRuleRecognition, cssAstPseudoSyntax, rules<CssAstLocalRules>(..., (g) => ({ ... }))])` |
| ratio | **2.26×** | 2.14× | — |

Counts match spec §0.2 at `92d38af4f` (3,455 / 1,527); nothing has drifted.

## Where the AST grammar spends its lines (rough breakdown)

Top-down scan of `src/ast/grammar.ts`:

| section | approx lines | content |
|---|---|---|
| header + imports | ~70 | Docstring; `import { ... } from 'parseman' with { type: 'macro' }` (~25 combinators); `import type { Combinator, FieldMap }`; `import { cssAstSyntax } from '@jesscss/parser-shared/recognition'`; `import { opaqueAtRuleRecognition } from '@jesscss/parser-shared/opaque-at-rule'`; `import { cssAstPseudoSyntax } from '@jesscss/parser-shared/pseudo-consts'`; **`import { stylesheet, rule, selist, complexCanonical, compoundSelectorOf, complexSelector, pseudoSelector, simpleSelector, decl, color, dimension, quoted, url, funcCall, call, keyword, list, block, atRuleBlock, atRuleStatement, opaqueAtRuleBlock, operation, generalEnclosed, interpolation, spaced, withValueLayout, ... }` from `@jesscss/core/ast`** (30+ core AST constructors) |
| `CssAstLocalRules` interface — 97 typed rule declarations | ~160 | One `CssAstFoo: Combinator<Type>;` line per rule, hand-typed to the AST shape it builds. **No analogue in the CST grammar** — CST emits structure through `node(parser)` and lets parseman infer the rule key. |
| Type-guard helpers + classification functions | ~610 | 30+ functions such as `isCompound`, `isComplex`, `isNodeType`, `isSelectorList` (lines ~230–840). They pattern-match on the AST node-shape produced by the core constructors below. **No analogue in the CST grammar.** |
| Recognition terminals + helpers | ~120 | `regex` / `literal` consts — `whitespace`, `blockComment`, `interstitialTrivia`, `calcWhitespace`, `calcProductOperator`, `calcSumOperator`, `genericFunctionName`, `declarationAnyCharacter`, `importAtKeyword`, `urlName`, `combinator`, `pseudoColon`, `simpleSelectorToken`, `hexColor`, `numberValue`, `customDoubleQuoted`, etc. **Same kind of terminal list as the CST grammar carries at the top of its file**, but only about the same size — recognition is NOT the bulk. |
| Rule-body block inside `composeLeaf([... rules<CssAstLocalRules>(..., (g) => ...)])` | ~2,610 | The actual rules. With `g.CssAstFoo` typed refs + 82 `node<Type>('Name', ...)` builder invocations + ~100 core-constructor calls (`stylesheet`, `complexCanonical`, `compoundSelectorOf`, `decl`, `color`, `keyword`, `dimension`, `quoted`, `url`, `funcCall`, `call`, `block`, `atRuleBlock`, `atRuleStatement`, `generalEnclosed`, `interpolation`, `pseudoSelector`, `spaced`, `opaqueAtRuleBlock`, `withValueLayout`, ...) all driving the per-rule reducers. |
| final `composeLeaf([... rules<...>(...)])` export | 1 | line 844 (`composeLeaf([...])`) |

## Where the CST grammar spends its lines (for contrast)

Top-down scan of `src/grammar.ts`:

| section | approx lines | content |
|---|---|---|
| header + imports | ~45 | Docstring; `import { node, regex, literal, sequence, choice, many, oneOrMore, optional, not, noTrivia, scanTo, balanced, trivia, rules, expect, field, label } from 'parseman' with { type: 'macro' };` — **only parseman combinators**, no core AST constructors |
| recognition terminals + helpers | ~80 | Trivia (`ws`, `comment`, `rw`); `ident`, `basicSel`, `combinator`, `hexColor`, `numberValue`, etc. — the recognition substrate |
| `export const cssGrammar = rules({ trivia, scanSkip }, (g: any) => ({ ... }))` factory body | ~1,400 | Rule-local `const`s (`const Stylesheet = node(g.stylesheetBody)`, `const SelectorList = node(sequence(...))`, etc.) — **52 `node(parser)`-style invocations**, structural capture delegated to parseman |
| trailing `const { Stylesheet, Ruleset, ... } = cssGrammar;` destructure | ~10 | surface export of the public rule names |

## Classification of the divergence

The §Unit4 instructions ask to separate three classes, and the lines split
cleanly:

| class | line share | CST | AST |
|---|---|---|---|
| (a) `node<Type>('Name', ...)` wrapper noise (typed reducer boilerplate) | **the bulk of the divergence** | none | 82 wrapper invocations + 100+ core-constructor calls + ~610 type-guard helper lines + 97 typed rule declarations (~890 lines net) |
| (b) recognition re-expansion (re-stating what `cssAstSyntax`/`opaqueAtRuleRecognition`/`cssAstPseudoSyntax` already declare in parser-shared) | **minor** | inline (~80 lines of terminals/helpers) | shared via `composeLeaf([cssAstSyntax, opaqueAtRuleRecognition, cssAstPseudoSyntax, ...])` (line 844) — saves the re-expansion but **adds** the type-guard/helper layer above |
| (c) real divergence (notably different recogniser rules or distinct node shapes) | small | none | AST-specific `CalcVar*` family (`CssAstCalcVarCall`, `CssAstCalcVarFallback{Punctuation,Paren,Bracket,Brace,Call,Term,Empty,Item}`, `CssAstCalcParen`) — explicit substructure that the CST grammar absorbs via raw `scanTo`/`balanced` capture |

**The CSS AST grammar is overwhelmingly reducer noise.** Its recognition shares
with the CST grammar (either inline or via `parser-shared`), and its few true
AST-no-shaed rules (the `CalcVar*` family) account for a small subset. The pure
reducer-noise overhead — 97 typed declarations + 30+ type-guard helpers + 82
typed `node<Type>('Name', ...)` wrapper calls + the 30+ core AST constructor
imports + the per-rule body's field-assignment machinery — accounts for most of
the 1,928-line difference between the two files. There is NOT a hidden
"reality-of-CSS-the-AST-must-say-and-the-CST-must-not" delta anywhere near that
size.

## What this means for the Stage 3 collapse (Phase A → Phase B)

The diagnosis confirms the §3 target: **the CSS AST grammar's bulk is NOT
essential * — it is hand-written reducer boilerplate that overlaps with
parseman's structural CST capture. The 0.37.0 `hostMode` mechanism lets one
`rules({ trivia, scanSkip }, factory)` source compile to BOTH the eval-AST (calls
core constructors) and the CST (delegates structural capture to parseman) modes,
selected at *compile* time (`'ast'` default vs `'cst'`).

### Rewrite idiom (per §Unit4 instructions)

Build from the CST grammar's structure as the base, and add **thin plain arrow
reducers** (per GRAMMAR-REVIEW-STANDARD.md item 14 + the handoff's "plain
reducers only, no factories/spread/hoisted regex" directive). The target is
CST-grammar line count + necessary reducer logic — **not** the 3–5× AST-grammar
bulk currently on dev.

### Phase A — rewrite the recognition rules in BOTH the CST grammar and the AST grammar to the lean idiom (still two files during this phase)

Goal: produce the SAME AST node shapes the AST grammar emits today, but through
plain arrow reducers built on the CST grammar's recognition, not through the 82
typed `node<Type>('Name', ...)` wrappers + 100+ core-constructor calls +
~610-line type-guard helper layer.

Pre-condition checklist (part of the Stage 3 commit): the §8.1b rename mapping
must be declared up-front and the residue after applying it must be EMPTY.

### Phase B — collapse the two grammars into one `const cssFactory = (g) => ({...})` exported twice

  ```ts
  export const cssGrammar = rules({ trivia: rw, scanSkip, hostMode: 'ast' default }, cssFactory);
  export const cssCstGrammar = rules({ trivia: rw, scanSkip, hostMode: 'cst' }, cssFactory);
  ```

`hostMode` belongs in `rules()` options (per the handoff "hostMode belongs in
rules() options, not build callbacks; factory written once; only the `rules()`
call differs"). Update `src/cst.ts`/`cst-css.ts` to bind the `'cst'` compilation;
the `parse()` AST entry point unchanged. Driver imports → `parseman/run`.
DELETE the AST grammar file and the dead destructure rows.

### Gate (post-collapse)

- Stage 2.1 byte-identity gate (`pnpm run oracle:less:byte-identity`) PASS
  against the committed 707-file baseline at
  `packages/syntax/less/less-parser/test/oracle-byte-identity.baseline.json`
(Either both aggregates byte-identical — the ideal case if `hostMode: 'ast'`
picks up where the old AST grammar left off, byte-read-for-byte — or, if a
deliberate rename happened, the §8.1b rename-mapping declared up front and the
residue applied to the per-entry fingerprints is EMPTY.)
- `check:macro` 0 interpreter fallbacks (parseman must compile `hostMode` into
  the macro output for BOTH the `'ast'` and `'cst'` exports; the §0.5 single-
  eval-emit invariant holds)
- `verify:compose-integrity` clean
- `verify:types` 12/12
- `lint` 0 errors (the `lint:absolute` "no as any / @ts-ignore / @ts-nocheck"
  rule applies; `const cssFactory` is hand-typed without `as any`)
- The ES grammar rules (`.vscode/*.mjs`, `eslint-rules/grammar-rules.mjs`)
- The CST parity suite (`packages/syntax/css/css-parser/test/*.test.ts`)
- Per-`const` review by the `grammar-reviewer` agent against
  `GRAMMAR-REVIEW-STANDARD.md` (14 items including the naming law)
- Perf measured against the Stage 1 bumped baseline (`parse-bench.mjs`): expect a
  `'ast'`-mode gain (the CST collector code compiled out of the macro output
  for the `'ast'` route); record numbers with SHA, before/after medians, and
  the noise floor read (A1-vs-A2 clean-spread)

## Why the AST grammar got this big — historical note (not a directive)

Pre-`hostMode`, writing a separate AST grammar was *the only* way to ship a
direct-AST parse path that bypassed CST capture. The 82 typed wrappers +
core-constructor calls + the 30+ type-guard helpers were real code, not
deliberate "decoration". With `hostMode` at 0.37.0 those bytes are now
redundant with a single factory — the existing two files can fold into one
without losing information or changing the shipped AST shape.

## Off-limits beyond this turn

Per the §Unit4 pass criteria, this diagnosis is the only deliverable of this
read-only step. **No grammar code is to change in the same commit**, and the
diagnosis must land before any Phase A work is dispatched.

---

## Correction — recorded 2026-07-25 after Phase A landed (commit `801f88286`)

**Three claims in the diagnosis above were wrong, ** as Phase A's mechanical
conversion made falsifiable. Read this BEFORE planning Phase B.

### Claim 1 — "the AST grammar is overwhelmingly reducer noise"

**Partially true, partially false.** Phase A's actually-deletable noise was:

- ✓ **The 97-row `CssAstLocalRules` typed-declaration interface** (102 lines).
  `rules<…>(factory)` does not require a per-rule typed interface on the
  factory's local `g` map when the rule bodies themselves carry typed inference.
  Removed; no gate broke. (Phase A commit `801f88286`.)
- ✓ The 27 redundant `<Type>` generics on `node<Type>('Name', …)` calls. TS
  infers the return type from the `build` arrow's body — dropping the explicit
  generic is byte-identical and shaves one site per rule.

Both deletions netted `−104` lines: AST went from 3,455 → 3,351. The CST→AST
ratio moved 2.26× → 2.10×, **not the ≈ 1× target the §3 plan implied.**

### Claim 2 — "the 82 `node<Type>('Name', …)` wrappers can be dropped"

**False, empirically.** Phase A tried dropping the `'Name'` string first arg
of `node('Name', …)` (hoping the parseman grammar-rule key would carry it).
The css-parser build went RED with a hard macro-plugin error: *"composeLeaf()
must macro-fuse; runtime composition is forbidden."* Under parseman 0.37.0
composeLeaf statically fuses the `rules()` factory map to keyed compiled
output, and the name strings ARE the compile-time key. Dropping them makes the
plugin fall back to runtime composition, which it HARD-ERRORS on. These name
strings are NOT cosmetic — they are the macro-fusion contract.

So the wrappers carry: name string (key) + combinator (recognition) + build
arrow (AST construction). All three are needed; the only deletable part was
the redundant `<Type>` generic, claimed above.

### Claim 3 — "the ~610-line type-guard helper layer is deletable noise"

**False for the bulk, true for a small subset.** The trivial `isNodeType`
wrappers (isSimple/isCompound/isComplex/isSelectorList/isComment/isKeyword/
isInterpolation/isDeclaration/isRule/isAtRuleBlock/isOpaqueAtRuleBlock) *could*
be inlined, but inlining lengthens every call site and is not a net line-count
win. The substantive helpers — `complexSegments`, `valueChildren`,
`foldOperation`, `selectorComplexes`, `chainedQueryComparison`,
`keyframeSelectorList`, etc. — do real AST construction work and are genuinely
required to produce today's byte-identical AST shape. They are NOT deletable.

### What this means for Phase B

The fold is **NOT a "delete the AST grammar's reducer machinery"** operation.
It is a **merge**: one `cssFactory = (g) => ({...})` source is exported twice:

```ts
export const cssGrammar = rules(
  { trivia: rw, scanSkip: [...] },         // hostMode 'ast' is the default
  cssFactory
);
export const cssCstGrammar = rules(
  { trivia: rw, scanSkip: [...], hostMode: 'cst' },
  cssFactory
);
```

The factory's rule bodies MUST carry the AST construction logic via `build`
arrows — these ARE the AST grammar's substantive reducer code, which Phase A
confirmed is load-bearing. What hostMode gives is: in `'ast'` mode the build
arrows run and produce the typed AST; in `'cst'` mode the host's CST builder
replaces them at compile time (no per-node runtime host probe). **The reducer
code does not get thinner by being in one file — it gets SHARED recognition
and one shipping location instead of two clones.** The net benefit of Phase B
for jess's CSS pilot is:

- One recognition body (instead of two parallel ones; CST currently has its
  own inline copy of the terminals/helpers, AST uses parser-shared via
  composeLeaf)
- One shipping location for the rule list (the 52 plain `node(parser)`
  invocations in the CST grammar + the 82 typed `node('Name', …, build)`
  invocations in the AST grammar become ONE set of `node('Name', …, build)`
  invocations where `build` carries the constructor logic and hostMode
  dispatches whether `build` runs ('ast') or is superseded by the host ('cst'))
- The CST grammar's `(g: any)` typing is replaced by a properly typed
  `CssGrammarSelf` interface (done in Phase A; Phase B carries that forward)

So the expected line-count target for the single Phase B factory is MORE like
the current AST grammar's identified non-noise line count — that is, the
~3,351-line post-Phase-A file minus the duplicative recognition (~80 lines now
inline in the CST grammar, plus a few shared helpers) — NOT the
"CST-twin-line-count-plus-thin-reducer" the original diagnosis implied. **Plan
for ~3,200 lines, not ~1,700**, unless further rounds of work find a way to
thin the substantive reducer bodies (which today appear to be load-bearing).

This is exactly the failure class AGENTS.md names "a check that reports
success because it cannot see the failure mode" — the diagnosis read the line
budget as foldable when Phase A's mechanical attempt exposed what was
contractually required and what was load-bearing. The Phase B plan must take
the budget realistically: the fold STILL adds the missing single-factory
property and STILL kills the duplication, but it is NOT a thousand-line
shrinkage.

### Updated Phase B recipe (informed by Phase A)

1. Take the AST grammar's EVERY rule body in src/ast/grammar.ts in its
   current shape — `node('Name', sequence/choice/..., (children, fields,
   span, rawChildren, triviaLog, state) => stylesheet(...)/complexCanonical/
   color(...)/quoted(...)/etc.)` — and lift them into the new single
   `cssFactory = (g) => ({...})` factory. Recognition terms (`regex`,
   `literal`, `choice`, `sequence`, ...) stay side-by-side with the build
   arrows.
2. The CST grammar's standalone `node(parser)` rules (which today use plain
   structural capture) are SUPERSEDED — their recognition paths are the same
   as the AST rules' bodies (modulo type-key/name-key), and hostMode
   `'cst'` takes over the build arrow at compile time.
3. The shared-recognizer pieces (cssAstSyntax via parser-shared, etc.)
   stay as-is — they're not local to either grammar.
4. `src/cst.ts`/`cst-css.ts` re-route `parseCssCst` to `cssCstGrammar`; the
   `parse()` AST entry re-routes to `cssGrammar`. Driver imports → `parseman/run`.
5. DELETE src/ast/grammar.ts (its contents are now in cssFactory, exported
   via `cssGrammar` with `hostMode: 'ast'` default).
6. The composeLeaf shape `composeLeaf([cssAstSyntax, opaqueAtRuleRecognition, cssAstPseudoSyntax, rules<...>(..., factory)])`
   stays — BOTH exports wrap the single cssFactory in the same composeLeaf
   invocation, with `hostMode` distinguishing them.

### Gate (post-collapse, common to Phase B and Phase A — verified green at `801f88286`)

Same gate stack: byte-identity gate (committed baseline; gate must PASS or
declared rename-mapping residue must be EMPTY), check:macro 0 fallbacks,
compose-integrity, verify:types, lint, ES grammar rules, the css-parser
test suite 242/242, and per-const grammar-reviewer pass.

### Note for Stage 4 (Less), Stage 5 (SCSS), Stage 6 (Jess)

Less (4,750 / 1,281 = 3.7×), SCSS (5,116 / 1,379 = 3.7×), Jess (5,587 / 1,210
= 4.6×) all have HIGHER ratios than CSS (2.26×). The same Phase A correction
will likely apply to them: the deletable noise is the typed-rules interface +
the redundant generics; the rule bodies carry real AST construction logic
that is load-bearing and is NOT a foldable bulk. **The single-factory
hostMode export gives them all the "one source, two compilations" shape
without requiring each AST grammar to shrink to CST-twin line count.** Plan
execution per Stage accordingly.
