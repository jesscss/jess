# Production-level `compose()` across the four grammars — feasibility

**Verdict: BLOCKED on parseman 0.46.0** — not scheduled, not deferred by choice.
Ledger row **P22**, updated to match. Not because the design is wrong — it is
right, and it is still the resolution this debt needs — but because the vehicle
does not exist in the installed parseman. `compose()` cannot compile a rule map containing a
`node()` whose build callback references anything outside its own parameters,
and every production in all four grammars does. The blocker is upstream, it is
precisely located, and it is small. Re-run
`node scripts/probe/parseman-compose-feasibility.mjs` after any parseman bump.

Measured at `4f10f919e`, parseman **0.46.0** (`package.json:42`, `^0.46.0`, and
the installed tree resolves to exactly 0.46.0).

---

## 1. What the installed parseman actually supports

Read from the **installed** package, not documentation:
`node_modules/parseman/dist/compiler/linker.d.ts` and
`dist/plugin/index.js`.

`compose(items, opts?)`, `composeLeaf(items)`, `pick(grammar, names)`,
`fuseInterpreted`, `recoverComposedRules` all exist and are exported.
`compose()`'s doc example is literally the case we want ("Jess taking parts of
Less and parts of Sass"). Override order is later-piece-wins, and an override
reroutes the base piece's own internal calls — which is exactly the semantics a
dialect override needs.

So the API is real. The limit is in how the macro plugin *lowers* it.

### The asymmetry that decides everything

`composeLeaf()` and `compose()` treat their pieces differently, and the
difference is the whole finding.

| | pre-final pieces | final piece |
|---|---|---|
| `composeLeaf()` | re-lowered from carried **IR**; must prove `hasDirectBuilders === false` **and** `isRecognitionOnly === true` (`plugin/index.js:14040`) | compiled with `compileLinkable` (`plugin/index.js:14025`) — a full static compile that keeps free bindings as real imports |
| `compose()` | re-lowered from carried **IR** | **also** re-lowered from carried IR — `compileComposeCall` sends *every* element through `materializeCarried` (`plugin/index.js:13973`) |

`localCarried` (`plugin/index.js:13854`) serializes a rule map to IR
unconditionally, including one written inline in the calling module. IR carries
a direct builder as **source text**:

```
"Thing": _nd("Thing", sequence(_s0, literal(":"), _s0), "(c) => ({ k: c[0], v: c[2] })")
```

and `_nd` (`plugin/index.js:10791`) throws when the callback is not
self-contained:

```
IR direct node builder for <Type> must be macro-static and self-contained;
unsupported binding(s): <names>
```

`composeLeaf()` never hits this because its recognition-only precondition
guarantees the pre-final pieces have no builders at all, and its own local piece
skips IR entirely. That is why `composeLeaf` is used in all four grammars and
`compose` is used nowhere: **`compose` was never usable here**, not merely
unexplored.

---

## 2. Evidence

`scripts/probe/parseman-compose-feasibility.mjs` is the instrument. It is
control-paired on purpose: a probe that reports a wall for every case is
indistinguishable from a probe that is simply broken, and this one *was* broken
once — resolving `parseman/plugin` through `require.resolve` picks the CJS entry,
which has no `transformMacro` export and scored all six cases THREW. CONTROL-1
is what caught it.

Recorded at 0.46.0:

| case | outcome | what it varies |
|---|---|---|
| CONTROL-1 | **FUSED** | `compose()` over a same-package imported factory, reducer self-contained |
| TREAT-1 | INTERPRETER FALLBACK | same, factory in **another package** — what less/scss/jess would need |
| TREAT-2 | INTERPRETER FALLBACK | same-package imported factory, reducer calls an **imported** builder |
| TREAT-3 | **THREW** | both pieces **inline in one module**, reducer calls an imported builder |

TREAT-3 is the important one. It has no package boundary, no cross-module
import of a factory, nothing exotic — and it still fails. **The package boundary
is not the blocker.** Merging the four parser packages into one would not help.

On the real grammars, the committed file versus the identical file with
`composeLeaf(` swapped for `compose(` and nothing else changed:

| grammar | as committed | swapped to `compose()` |
|---|---|---|
| `css-parser/src/grammar.ts` | FUSED, 0 warnings | THREW — `UrlUnquoted`: `any`, `tokenText` |
| `less-parser/src/grammar.ts` | FUSED, 0 warnings | THREW — `UnsupportedMixinName`: `unsupported BlockStatement` |
| `scss-parser/src/grammar.ts` | FUSED, 0 warnings | THREW — `QueryNonOnlyKeyword`: `requireKeyword` |
| `jess-parser/src/grammar.ts` | FUSED, 0 warnings | THREW — `DeclarationReference`: `withSourceSpan`, `declarationReference` |

`any` and `withSourceSpan` are `@jesscss/core/ast` factories. `tokenText`,
`requireKeyword` and `declarationReference` are module-scope helpers. Both
categories are pervasive and neither is incidental.

### Blast radius

With the `_nd` throw converted to a collector (a patched copy of the plugin, so
the whole graph is walked instead of stopping at the first failure), the count of
**distinct productions `compose()` would reject**:

| grammar | productions rejected | distinct free bindings needed |
|---|---|---|
| css | 113 | 44 |
| less | 208 | 69 |
| scss | 153 | 62 |
| jess | 168 | 60 |

The most-needed bindings are the canonical AST constructors and the local
helpers wrapping them — `tokenText`, `any`, `withSourceSpan`, `withBlockBody`,
`atRuleBlock`, `keyword`, `block`, `funcCall`, `requireToken`,
`requireValueNode`. This is not a tail of awkward productions to hand-fix; it is
the grammar.

There is also a **second, structural** blocker in the same census, distinct from
binding resolution: `unsupported BlockStatement` (the most frequent finding in
three of four grammars) and `unsupported callback shape`. A reducer with a
statement body is not IR-serializable **at all**, regardless of what it
references. An upstream fix that only carried the free bindings would still
leave these.

---

## 3. What the upstream fix would be

**Parseman is a separate lane's responsibility. Do not attempt this from a
grammar brief.** Stated here so the requirement is unambiguous, not as work to
pick up.

Two changes to parseman, both in the IR path:

1. **Carry the reducer's free bindings as an import manifest.** The plugin
   already computes the exact list — it is the `staticError` array `_nd` throws
   with — and it already knows the defining module. Carrying `{ name, source }`
   and having `emitFusedSource` re-emit those imports in the consuming module
   would close the binding half.
2. **Support block-bodied reducers in IR**, or let a `compose()` piece opt into
   the `compileLinkable` path that `composeLeaf`'s final piece already uses.
   (2) alone would close both halves and is the smaller change: the code path
   exists and is exercised on every build.

Until one of those lands, there is no spelling of production-level `compose()`
that survives `check:macro`.

---

## 4. The plan, for when it unblocks

Recorded now so the classification work is not redone. **Do not start this
before the probe reports CONTROL/TREAT-3 both FUSED.**

Shape: `css-parser` exports its production factory; each dialect becomes
`compose([cssPieces, rules(dialectFactory)])`, overriding by rule NAME only
where it genuinely differs. Because `compose()` reroutes the base's own internal
calls, overriding `Value` automatically re-points every CSS production that
references `Value` — which is the property that makes "valid CSS is valid in all
dialects" hold by construction instead of by four suites agreeing.

Classifying what "genuinely differs" — the settled distinction is **operand vs
head**:

- **Stays in the CSS base, no override.** A dialect variable sigil admitted as
  an OPERAND inside a ported CSS production. `@x` / `$x` appearing where CSS
  allows a value is an addition to a value slot, not a different production. The
  base declares the slot; the dialect widens it.
- **Cannot live in the CSS base — dialect-only rule.** A production whose HEAD
  is a sigil or a non-CSS token: keyword arguments, `==` / `!=`, `@mixin`,
  `@each`, guards, `&`-concatenation. These are new entry points, not widenings,
  and they belong in the dialect piece with no CSS counterpart.
- **Override by name.** A rule the base already declares whose accepted language
  the dialect genuinely narrows or widens — `Value`, `Declaration`,
  `SelectorTerm`. This is the set that must stay small and be justified rule by
  rule; every entry is a place the dialects can silently diverge again.

The prize is concrete. SCSS forked the ident-start declaration decision and
produced a wrong node — `div:hover, span { … }` yielding a `Declaration` named
`div` that swallowed the nested rule — undetected for as long as it existed,
because the four suites were separately satisfied. Under a shared base that fork
is not expressible without an explicit named override.

### Cost estimate

Gated on the upstream fix, and assuming it lands as described:

- **Upstream parseman work:** the larger of the two items, and not ours to
  schedule.
- **css-parser:** small. Export the factory; no production changes.
- **Per dialect:** the real cost is not mechanical. It is deciding, for each of
  the ~150-200 productions currently restated, whether it is byte-equivalent to
  the CSS one (delete it), an operand widening (delete it, widen the base slot),
  or a genuine override (keep, justify). That is a per-`const` judgement over
  four files of 4,090-6,344 lines, and it is exactly the grammar-review pass the
  standard already prescribes — so it should be run as one, with evidence per
  const, not as a bulk edit.
- **Risk concentrated in one place:** the AST must not move. Less has a
  byte-identity oracle; **css-parser does not**, and the Less oracle does not
  cover it (Less composes `cssSyntax` from `parser-shared`, not from
  `css-parser/src/grammar.ts`, and carries its own `Value`). A css-parser
  byte-identity harness with a proven negative control is a **prerequisite**,
  not a follow-up.

---

## 5. Ledger

Filed against **P22** in `docs/architecture/core/DESIGN-DECISIONS.md` (line 230),
which is the row for exactly this subject: one call argument defined three times,
once per superset, with production-level `compose()` named as the resolution.
That row read "SCHEDULED, not blocked"; this run proves it is **BLOCKED on
parseman 0.46.0**, and the row has been updated to say so.

Not P5. P5 ("SCSS should compose on the CSS base, NOT on Less — via a
dialect-neutral `preprocessorBase`") is a claim about which base a dialect
composes ON, and it should not carry a parseman-capability finding.

A note on method, since it cost a wrong claim in the first draft of this
document: the `P` rows in that ledger are **not in numeric order** — the tail
runs P18, P19, P21, P10, P20, P22 — so a scan for a sorted sequence stops at P21
and concludes P22 is absent. Never infer a ledger row is missing from ordering.
`grep -c "^| P22" docs/architecture/core/DESIGN-DECISIONS.md`.
