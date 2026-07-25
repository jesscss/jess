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
