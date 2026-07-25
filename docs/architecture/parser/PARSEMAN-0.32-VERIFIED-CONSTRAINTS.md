# Parseman 0.32.0 — verified constraints on the four grammars

Measured 2026-07-24 on `dev` @ `eaa5a11aa`, against the pinned `parseman@0.32.0`.
Everything here was reproduced in this repo, not read off a changelog. It exists
because two of these facts are load-bearing for correctness and neither was
written down anywhere.

Scope: the four grammar packages (`css-parser`, `less-parser`, `scss-parser`,
`jess-parser`) plus `internal-css-recognition`. When the parseman pin moves, every
claim below must be re-verified — most are version-specific by construction.

---

## 1. A macro-FALLBACK build is not AST-equivalent to a macro-COMPILED build

**`scripts/check-macro-buildable.mjs` guards correctness, not only speed.**

When `compose()` cannot statically resolve its argument, parseman warns
*"isn't a build-resolvable grammar; falling back to runtime"* and the grammar is
assembled by the interpreter instead of the compiled artifact. That build **emits a
different tree** for the same input.

Reproduced in `less-parser`:

1. Convert some keyword `regex()` terminals to `word()` and hoist the trailing
   boundary to a module-level `const identBoundary = '-_0-9A-Za-z'`, read from
   inside the `rules()` factory.
2. Build. `check-macro-buildable` reports `✗ @jesscss/less-parser: NOT fully
   macro-buildable — compose(): argument 1 isn't a build-resolvable grammar;
   falling back to runtime` (and it cascades into `scss-parser`, which composes on
   Less).
3. Hash the CST over the corpus: the aggregate **moves**.
4. Change nothing except inlining the boundary string literally at each call site.
   `check-macro-buildable` returns to `✓ 0 interpreter fallbacks`, and the CST
   aggregate returns **byte-for-byte** to its previous value.

The only delta between steps 3 and 4 is the const, whose sole effect is forcing the
fallback. So the fallback path itself is what moved the tree.

**Consequences.**

- A red `check-macro-buildable` invalidates any AST/CST differential taken on that
  build. Re-run the gate before trusting a corpus hash.
- "Tests are green" does not clear a fallback: a suite can pass on the interpreted
  tree while the shipped compiled tree differs (or vice-versa).
- This is why the grammar-dedup macro constraint (parameterless combinator consts
  and plain reducers only — no factories, no `[...spread]`, no hoisted regex
  sources) is a correctness rule and not a style preference.

**Corollary — hoisted plain-string consts are also forbidden.** Not just regex
sources. A `const` holding a `word()`/`keywords()` boundary class is enough to
degrade the artifact. Literal duplication at each call site is the correct answer;
`less-parser/src/grammar.ts` carries that reasoning inline where the boundary is
spelled.

---

## 2. `analyzeGating()` cannot analyze any of the four grammars at 0.32.0

The static first-char gating diagnostic is **unavailable in this repo at the pinned
version**, by three independent mechanisms. Any planning document quoting a finding
count from it is quoting a different parseman.

| route | result |
| --- | --- |
| macro build (`tsdown`/rolldown) | emits **nothing** — the analysis never runs for a macro-compiled rule map |
| `analyzeGating()` on the composed CST rule map | throws for **129 of 129** rules |
| `analyzeGating()` on the AST grammar | unreachable — `composeLeaf()` throws before a rule map exists |

### 2.1 Repro — `analyzeGating()` on a `compose()`d artifact

```ts
import { analyzeGating, choice, literal, regex, sequence, not } from 'parseman'
import { lessGrammar } from '@jesscss/less-parser/grammar'

// CONTROL — a hand-built graph. Works: 1 choice, 1 ungated, 1 anti-pattern.
analyzeGating(choice(sequence(not(regex(/when(?![-\w])/)), literal('a')),
                     literal('b'), regex(/./)))

// SUBJECT — every rule of the composed Less CST.
for (const rule of Object.values(lessGrammar)) {
  analyzeGating(rule)   // TypeError: Cannot read properties of undefined (reading 'tag')
}                       // ...for all 129 rules.
```

Thrown from `parseman/src/analysis/gating.ts:313`, in `visit`, on a node with no
descriptor. `lessGrammar` is `compose([cssGrammar, rules(…)])` where `cssGrammar`
is the **imported pre-compiled artifact**; the fused graph carries compiled pieces
the 0.32.0 analyzer's walker does not understand. The control proves the harness is
correct — it is the compiled-compose input that breaks it.

To load a grammar interpreted (stripping the `with { type: 'macro' }` attribute via
an ESM loader hook) does not help either:

- the **AST** grammar throws `composeLeaf(): requires Parseman macro lowering;
  runtime composition is forbidden` (`linker.ts:565`);
- the **CST** grammar fails the node-hook macro transform with `IR direct node
  builder for Operation must be macro-static and self-contained: unsupported
  callback shape`.

### 2.2 Why this matters beyond gating

Any new parseman analysis that walks a rule map the same way — a duplication or
overlap diagnostic, for instance — will inherit this defect and silently report
nothing (or crash) on exactly the four grammars that are supposed to be parseman's
reference implementation. Filed upstream.

### 2.3 What to do instead, today

Static reading, with the corpus differential as the acceptance gate. Do **not**
treat a clean or empty diagnostic as evidence a grammar is clean.

---

## 3. Export surface actually available at 0.32.0

Verified by enumerating the module's exports, not from the changelog.

**Present:** `attempt balanced choice compose composeLeaf expect field gate guard
keywords label leaf literal makeWord many noTrivia node not oneOrMore optional
parse parseDoc parser ref regex rules run scanTo sepBy sequence token transform
trivia withCtx word analyzeGating formatGatingWarnings` — and `rules({ scanSkip })`,
which **is** available at 0.32.0.

**Absent — plan around them, they are 0.34.0:**

| missing | consequence |
| --- | --- |
| `peek` | `not(not(X))` cannot be converted. 5 sites in the Less AST grammar stay as-is |
| `oneOrMoreSep` | the non-empty separated-list conversions are blocked |
| `analyzeGatingRules` | no rule-map-level diagnostic (§2 covers the entry-level one) |
| `word(str, { caseInsensitive })` | `word()` takes `(str, boundary?)` only. A case-insensitive single keyword must be `keywords([str], { caseInsensitive: true, boundary })` |
| `sepBy(…, { min, max, trailing })` | `sepBy` takes `(combinator, separator)` only |

`word()` and `keywords()` are macro-buildable and AST-neutral in place of an
equivalent boundary regex — verified over 707 files across both Less surfaces, with
`check-macro-buildable` clean. See §1 for the boundary-const caveat.

### 3.1 Correction to `docs/design/PARSEMAN-0.34-GRAMMAR-IDIOM-PLAN.md`

That document is written against 0.34.0 and is wrong in two places if read against
the pinned version:

- §4.0 *"Two module-level boundary `const`s are permitted (parameterless)."*
  **False at 0.32.0** — see §1's corollary; one such const degrades the artifact
  and moves the tree.
- Its per-parser tables sequence `peek()` conversions first. **Not executable at
  0.32.0** — `peek` does not exist (§3).
- Its gating baselines (css 62, less 52, scss 48, jess 36) are **not reproducible**
  at 0.32.0 (§2). They are 0.34.0 numbers.

---

## 4. Corpus differential — the acceptance gate that does work

With the diagnostic unavailable, the differential is the gate. For `less-parser`:

- 707 files: `@less/test-data` (`tests-unit`, `tests-config`, `tests-error`,
  `data`), `bootstrap-less-port/less`, `packages/jess/test`, and the `less-parser` /
  `css-parser` test trees.
- Parsed through **both** shipping surfaces — `parse()` (AST v2, the shipping path)
  and `parseLessCst()` — against the built `lib/`, which is what ships.
- Hash a key-sorted, cycle-safe JSON projection per file; **hash parse failures
  too**, so error behaviour is part of the differential; aggregate per surface.

A conversion that moves either aggregate is a failed conversion. This is the
mechanism that rejected the hoisted boundary const in §1.
