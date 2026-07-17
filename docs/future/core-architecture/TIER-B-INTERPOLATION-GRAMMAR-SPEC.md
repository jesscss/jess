# Tier-B — Interpolation / Quoted / Prelude / List in the Grammar (Spec)

> Status: **DESIGN SURVEY (read-only).** No grammar code changed. This spec precedes an
> adversarial review; nothing here is committed engineering until that review passes. It plans
> the grammar work that unblocks the **Tier-0b** deletions tracked in
> `AST-REMAINING-DEBT-KILL-LIST.md` ("task #6 / TODO(tier-b)").
>
> Base: `origin/dev` @ `5de81c554`. Every `file:line` below is against that ref.
>
> Governing constraints: `TREE2-CONSTITUTION.md` **P0** (parser is the SOLE source of
> structure; core NEVER re-derives structure from bytes) and **P6** (byte-identity floor).
> Repo hard rule: **NEVER create `productions.ts`** — upgrade the existing
> `grammar.ts` / `productions/*.ts` in place.

---

## 0. The one architectural fact this spec turns on

The kill-list and the constitution both say "the parser already emits a recursive
`Interpolated{source, replacements}`; tree2 threw it away." That statement is **true of the
retired parser and half-true of the maintained one** — the distinction is the whole spec, so
pin it first:

| Layer | File | Emits interpolation structure? |
|---|---|---|
| **Retired** Chevrotain parser | `packages/less-parser/src/productions/values.ts` (`@ts-nocheck — Retired Chevrotain parser`, header L1-4) | Yes — `processStringInterpolation` (referenced L1250) builds recursive `Interpolated`. **Dead.** Do not cite as live proof. |
| **Maintained functional grammar** | `packages/less-parser/src/grammar.ts` | **Mostly NO.** `@{…}` is a flat regex leaf `lessInterp` (`grammar.ts:85`) in every position **except selectors**, where `InterpolatedSelector` (`grammar.ts:283-288`) splits it into interleaved leaves. |
| **Maintained functional builder** | `packages/less-parser/src/builders.ts` + `utils.ts` | Reconstructs `Interpolated` from a **string** via `INTERPOLATION_REGEX = /([$@])\{([^}]+)\}/g` (`utils.ts:13`, `getInterpolatedOrString` L92). This is the legacy `../tree` build used by the **less-compat bridge**, and it re-tokenizes with a regex just like tree2 does. |
| **tree2 build-host** | `packages/core/src/ast/parse-host/actions/*.ts` | Consumes the parser's leaves where the grammar splits (selectors → `interpFromLeaves`, `interp.ts:47`); **re-tokenizes bytes** where it does not (custom-props, at-preludes → `interpFromString`, 3 copies). |

**Consequence for the plan.** There is exactly ONE position where the grammar already emits
consumable structure (selectors), and the tree2 host already consumes it cleanly
(`selector-interp.ts`). Every Tier-0b interpolation site is a place where the **functional
grammar emits a flat leaf** and *someone* (the bridge builder OR the tree2 host) re-tokenizes
it. The fix is to make `grammar.ts` split interpolation into structured children **in those
positions too**, modelled on the proven `InterpolatedSelector` shape, and then delete the
re-tokenizers on both the tree2 side (Tier-0b) and — as a follow-on — the bridge side.

A second, DIFFERENT class hides in the same kill-list bucket: the **space/comma list** case
(`@l: a b c`) and the **comma-list-in-paren** case are **NOT grammar gaps** — the grammar
already structures them (`valueList`/`valueSequence`/`topSum`, `grammar.ts:500-505`). Their
Tier-0b debt is a **host value-assembly** gap. This spec separates the two so the reviewer
does not fund grammar work for a problem the grammar already solved (§3.4).

---

## 1. Per-construct: TODAY vs TARGET

### 1.1 `@{…}` interpolation in selectors — **already done (reference implementation)**

- **Grammar today:** `InterpolatedSelector` (`grammar.ts:283-288`) is
  `choice(sequence('.'/'#', many(identRun), lessInterp, many(interpPart)), …)` where
  `interpPart = choice(lessInterp, regex(/[-_a-zA-Z0-9]+/))` (`grammar.ts:282`). So `.a-@{n}`
  parses to interleaved leaves `.`, `a-`, `@{n}`. `lessInterp` (`grammar.ts:85`) is the
  isolated `@{name}` token.
- **Host today:** `selector-interp.ts:28-33` filters leaves and calls
  `interpFromLeaves(leaves, false)` (`interp.ts:47-69`), which classifies a leaf as an
  interpolation ref iff its bytes start with `@{` (`interpName`, `interp.ts:35-39`). **No byte
  re-scan.** This is the P0-clean template every other construct should match.
- **Target:** unchanged. This is the shape to copy.

### 1.2 `@{…}` interpolation in custom-property names + values

- **Grammar today (name):** `customPropInterp` (`grammar.ts:72`) is ONE regex matching the
  whole `--foo-@{key}-bar` run; the `@{key}` is *inside* the regex, not a child. Fallback plain
  name is `customProp` (`grammar.ts:66`).
- **Grammar today (value):** `cpValue` (`grammar.ts:488`) is
  `noTrivia(many(choice(cpOuterContent, comment, cpParen, cpSquare, cpCurly, strings)))`. The
  `@{…}` is swallowed inside `cpOuterContent`/`cpInnerContent` (`grammar.ts:482-483`), which are
  opaque text runs — `@` is an ordinary content char, so `@{base}` is not isolated. `CustomDeclaration`
  (`grammar.ts:489-492`) therefore hands the tree2 host an opaque value.
- **Host today:** `custom-props.ts` re-tokenizes BOTH — `declName` (L76-82) and the value path
  (L124) call `interpFromString` (L46-61: `/@\{\s*([^}]+?)\s*\}/g`). The file's own
  `TODO(tier-b)` (L34-39, L73-75) names this a parser gap.
- **Target:** the custom-prop **name** becomes an interleaved leaf run (literal chunks +
  `lessInterp` leaves), exactly like `InterpolatedSelector`; the **value** run isolates `@{…}`
  as a distinct alternative alongside `cpOuterContent`/`cpInnerContent`. Both then flow through
  `interpFromLeaves` (the value context passes `unquote:true`; see §5 for the unquote seam).
  Owner rule preserved (`grammar.ts:470-475`): a custom-prop value resolves ONLY `@{…}`; bare
  `@var` / calls stay literal — so the value split must isolate `@{…}` **only**, never `@name`.

### 1.3 Quoted strings

- **Grammar today:** `Quoted = node(choice(singleStr, doubleStr))` (`css-parser/grammar.ts:573`);
  `singleStr`/`doubleStr` (`grammar.ts:58-59` less, `53-54` css) are flat regexes matching the
  whole `'…'` / `"…"` including any `@{…}` inside. Interpolation inside a string is **not**
  parsed.
- **Host today:** `value-leaf.ts` `quotedLeaf` (L82-88) tags the leaf `LiteralTag.Quoted` and
  carries `LitFields = { value: bytes.slice(1,-1), quote: bytes[0], escaped: false }`. The
  literal-tag P0 (VALUE-LITERAL-TAG-SPEC) **already** removed the `QUOTE_RE` re-scan for *parsed*
  strings: `materializeLiteral` reads `lit.value/quote/escaped` directly (`literal-tag.ts:159-163`).
  The residual `QUOTE_RE`/`isQuotedBytes` path (`literal-tag.ts:117-125,169`) is **synthetic-only**
  (computed/joined strings with no parse origin) and is a **clean REJECT** — keep it.
- **Gaps that remain:**
  1. **Interpolation inside a string** (`"@{a}px"`, the printf-lowering target) is not
     structured — a forced/operated interpolated string still round-trips as opaque bytes, and
     the *bridge* still reconstructs it via `_buildStringInterpolation` (`builders.ts:1367`).
  2. `escaped` is hardcoded `false` (`value-leaf.ts:86`). Today that is *correct* by
     construction — an escaped `~"…"` is a separate `EscapedValue` rule (`grammar.ts:590`), never
     this leaf (see the JSDoc `value-leaf.ts:80-85`) — so this is **not** a byte bug, but it means
     the flag is an assumption, not parser-derived.
- **Target (constitution's owner-stated model):** `Quoted` holds `string | Node[]`. The plain
  form (no interpolation) stays a single leaf (byte-identical, no change). The interpolated form
  becomes a structured child sequence: `"` ( literalChunk | `lessInterp` )* `"`, so the inner
  `@{…}` is a real child the host consumes with `interpFromLeaves` instead of the bridge's
  `_buildStringInterpolation`. **This is the highest-risk change** (§5) and is NOT required for
  any *Less* Tier-0b deletion — it is required for the bridge-side deletion and for `.scss`/`.jess`
  full-expression interpolation. Sequence it last.

### 1.4 At-rule preludes

- **Grammar today:** `atPrelude = optional(scanTo(choice('{', ';'), { skip: [bParen, bSquare,
  bCurly, singleStr, doubleStr] }))` (`grammar.ts:819`). A single opaque leaf. **`bCurly` in the
  skip-set is DEAD:** `scanTo` checks the sentinel `choice('{',';')` FIRST on each position
  (parser-thing `scanTo.ts:73-78`), and `bCurly` opens on `{` — the SAME char — so the sentinel
  always matches before the skip loop runs. The concrete bug is therefore **early termination at
  the first `{`**: `@keyframes @{n} {` cuts the prelude at the `{` of `@{n}`, exactly as the host
  comment (`at-rules.ts:44-50`) states. There is no "balanced-curly swallows the wrong brace"
  hazard — that reading was backwards. Note `@media`/`@container`/`@supports` are UNAFFECTED:
  they route through the structured `QueryAtRuleBlock` (`grammar.ts:872`), not this scan; the
  generic block/statement at-rules (`@keyframes @{n}`, `@page @{x}`, unknown `@foo @{q}`) are the
  ones that misparse today.
- **Host today:** `at-rules.ts` slices the prelude (`atRuleHead`, L58-66) then tokenizes it with
  THREE regexes in `parsePreludeValue` (L95-112): `@@name` (L97), `@{…}` via `interpFromString`
  (L72-87, L99), and `@name` (L100). The `TODO(tier-b)` at L44-50 correctly names the gap
  (`scanTo` "stops AT `@{`") — this spec confirms it.
- **Target:** split the prelude into structured leaves — literal runs, `lessInterp` (`@{…}`),
  `lessVar` (`@name`), and a `@@name` indirect token — so `parsePreludeValue`'s three regexes are
  replaced by a leaf walk that emits `Word` / `VarRef` / `Interp` / `VarIndirect` from the leaf
  kinds. The prelude is a *value*, so this reuses the value-token vocabulary the grammar already
  has (`InterpValue`, `Reference`, `lessVar`), not a new one.

### 1.5 Space / comma value lists — **NOT a grammar gap (host-assembly gap)**

- **Grammar today:** already structured. `valueList` → `valueSequence` → `oneOrMore(topSum)`
  (`grammar.ts:500-505`); a comma-list-in-paren is structured in `parenBody`/`parenExprList`
  (`grammar.ts:620-622`). The operands arrive as real child nodes.
- **Host today:** the loss happens in the **host**, not the parser. `VarDeclaration`
  (`variables.ts` `varDeclaration`) uses `wholeValueNode` (`interp.ts:78-92`), which returns
  `null` for a multi-token value (>1 built child), so `@l: a b c` degrades to a single
  `t2.word("a b c")`. `functions/list-helper.ts` (moving to `packages/fns/src/less/` in the
  fns-move) then re-splits it: `coerceListItems` (L98-108) →
  `topLevelSplit` (L45-72) / `hasTopLevelComma` (L75-90). Similarly `value-expr.ts`
  `betweenBytes` (L103-110) re-slices a comma-list-in-paren body (L152-154).
- **Target:** a **host value-assembly action** that folds the grammar's already-structured
  `valueSequence` / `valueList` children into a real `List` / `SpacedValue` node — no grammar
  change. That deletes `topLevelSplit` / `hasTopLevelComma` / `coerceListItems`' split branch and
  the `betweenBytes` comma fallback. Because there is **no grammar change**, this item is
  independent of §1.2-1.4 and can land on its own timeline; it belongs to the value-assembly /
  fns-move workstream (§4), not the interpolation-grammar workstream. Flagged here only so the
  reviewer does not mis-file it as grammar work.

---

## 2. Target structured nodes (summary)

| Construct | Grammar emits today | Grammar emits TARGET | Host consumes via |
|---|---|---|---|
| Selector interp | interleaved leaves ✅ | (unchanged) | `interpFromLeaves` ✅ |
| Custom-prop name | one `customPropInterp` regex leaf | interleaved leaves (`lessInterp` isolated) | `interpFromLeaves` |
| Custom-prop value | opaque `cpOuterContent` runs | `cpValue` with `lessInterp` as a distinct alt | `interpFromLeaves` (`unquote:true`) |
| Quoted string | one `singleStr`/`doubleStr` regex leaf | `string \| Node[]`: `"` (chunk \| `lessInterp`)\* `"` | `interpFromLeaves` (replaces `_buildStringInterpolation`) |
| At-rule prelude | one opaque `scanTo` leaf | leaf run: literal \| `lessInterp` \| `lessVar` \| `@@name` | leaf walk (replaces `parsePreludeValue`'s 3 regexes) |
| Space/comma list | structured `valueSequence` ✅ | (unchanged — host-assembly) | new value-assembly action |

**Interp payload shape.** Two viable target shapes:

- **(A) Leaf-split** — emit interleaved *leaves* (literal + `lessInterp`); host reuses
  `interpFromLeaves` unchanged. Minimal, DRY, matches selectors exactly. **Sufficient for every
  Less deletion** because Less `@{…}` is name-only (`lessInterp` = `@{ ident }`, `grammar.ts:85`).
- **(B) Structured `Interp` node child** — emit `node('Interp', …)` whose replacements are real
  value sub-nodes. Honors the constitution's owner-stated end model ("interpolation is a real
  child node carrying an EXPRESSION") and is **required** before `.scss`/`.jess` full-expression
  interpolation (`${expr}` / `#{expr}`), which a leaf cannot carry.

**Recommendation:** ship **(A) for the Less Tier-0b cutover now** (it reuses the proven
`interpFromLeaves` consumer and is byte-trivial to gate), and treat **(B) as the follow-on**
that the `.scss`/`.jess` interpolation work must land — NOT a parallel second migration of the
same sites. The leaf token `lessInterp` is the seam: (B) later replaces the `lessInterp` *regex
leaf* with a `node('Interp', sequence('@{', <expression>, '}'))` and upgrades `interpFromLeaves`
to read a node child instead of re-parsing the leaf bytes. Design the (A) host consumer so that
swap is local to `interpName`/`interpFromLeaves`.

---

## 3. Exact grammar changes (functional `rules()` shape)

All changes are edits to `packages/less-parser/src/grammar.ts` inside the existing
`lessGrammar = compose([cssGrammar, rules({ trivia: rw }, (g) => { … })])` body, plus the
`css-parser/src/grammar.ts` `Quoted` for §3.3. Combinators (`sequence`/`choice`/`many`/`regex`/
`node`/`label`) are the ones already imported at the top of each file. No new file; no
`productions.ts`.

### 3.1 Custom-prop NAME split (§1.2)

Replace the single `customPropInterp` regex (`grammar.ts:72`) with an interleaved run modelled
on `InterpolatedSelector`:

```
// was: const customPropInterp = regex(/--(?:…)@\{…\}(?:…)*/);
const cpNameChunk = regex(/(?:-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*|-)/);
const customPropInterp = sequence(
  literal('--'),
  optional(cpNameChunk),
  lessInterp,                    // the isolated @{key} leaf — reuses grammar.ts:85
  many(choice(lessInterp, cpNameChunk)));
```

`CustomDeclaration` (`grammar.ts:489-492`) keeps `choice(customPropInterp, customProp)`; the
interpolated arm now yields leaves, so the host builds the name with `interpFromLeaves` instead
of `declName`/`interpFromString`.

### 3.2 Custom-prop VALUE split (§1.2)

Add `lessInterp` as a distinct alternative in the value content choices so `@{…}` is isolated
rather than absorbed into `cpOuterContent`/`cpInnerContent`. `@` must be removed from the plain
content runs ONLY when it introduces `@{` (owner rule: bare `@name` stays literal):

```
// cpOuterContent / cpInnerContent (grammar.ts:482-483) currently include `@` as content.
// Add lessInterp AHEAD of the content run in cpInner/cpValue (grammar.ts:484,488):
const cpInner  = many(choice(lessInterp, cpInnerContent, comment, cpParen, cpSquare, cpCurly, cpSingleStr, cpDoubleStr));
const cpValue  = noTrivia(many(choice(lessInterp, cpOuterContent, comment, cpParen, cpSquare, cpCurly, cpSingleStr, cpDoubleStr)));
```

Because `cpOuterContent` already matches `@` greedily, `lessInterp` must be tried FIRST (ordered
choice) and the content regexes adjusted so a run stops before `@{` but still consumes a bare
`@` (a lone `@name` is literal). This is the one content-regex boundary tweak that needs a
dedicated byte test (§5, break-mode 3).

### 3.3 Quoted `string | Node[]` (§1.3) — highest risk, sequence last

`Quoted` is shared (`css-parser/grammar.ts:573`); Less inherits it via `compose`. Override it in
`less-parser/grammar.ts` (do NOT change the CSS base — plain CSS has no interpolation) with an
interpolation-aware form, keeping the flat regex as the fast/plain arm:

```
// Less override: try the interpolated form, else the plain single-leaf string.
const dqChunk = regex(/(?:[^"\\@]|\\[\s\S]|@(?!\{))+/);   // string body up to @{ or "
const sqChunk = regex(/(?:[^'\\@]|\\[\s\S]|@(?!\{))+/);
const QuotedInterp = node('Quoted', choice(
  sequence(literal('"'), many(choice(lessInterp, dqChunk)), literal('"')),
  sequence(literal("'"), many(choice(lessInterp, sqChunk)), literal("'"))));
const Quoted = node('Quoted', choice(QuotedInterp, singleStr, doubleStr));
```

Ordering matters: the interpolated arm is tried first; a string with no `@{` falls to the flat
`singleStr`/`doubleStr` leaf (byte-identical to today). The host `quotedLeaf` (`value-leaf.ts`)
gains a branch: leaves present → `interpFromLeaves(…, unquote:true)` wrapped in a `Quoted`;
single leaf → today's `LitFields` path unchanged. Escapes ride in the chunk regex (`\\[\s\S]`),
so `"\@{x}"` (escaped, literal) stays in a chunk and never becomes a ref — see break-mode 1.

### 3.4 At-rule prelude split (§1.4)

Replace the opaque `atPrelude` scan (`grammar.ts:819`) — for the generic `AtRuleBlock` /
`AtRuleStatement` paths only — with a structured token run. The query/import families keep their
own committed preludes:

```
const preludeChunk = regex(/(?:[^@{};()\[\]'"]|@(?!\{|@|[-_a-zA-Z]))+/); // runs up to a token/delim
const preludeTok = choice(lessInterp, nestedRef /* @@name, grammar.ts:138 */, lessVar, preludeChunk,
                          bParen, bSquare, singleStr, doubleStr);
const atPrelude = optional(oneOrMore(preludeTok));
```

The host `parsePreludeValue` (`at-rules.ts:95`) is replaced by a leaf walk mapping each token
kind → `Interp` / `VarIndirect` / `VarRef` / `Word`. This ALSO fixes the **early-termination**
bug (§1.4): today `@keyframes @{n} {` cuts the prelude at the `{` of `@{n}` (dead `bCurly` skip),
whereas a token run consumes `@{n}` as a `lessInterp` leaf and runs on to the real block `{`. That
is a *correction*, not a byte-identity pass — a prelude that previously misparsed now parses — so
it is a **gated golden change** flagged for owner review (suspect-golden rule). `@media` &co are
unaffected (structured `QueryAtRuleBlock`, `grammar.ts:872`); the change is scoped to generic
block/statement at-rules.

### 3.5 List value-assembly (§1.5) — no grammar change

No `grammar.ts` edit. A host action folds `valueSequence`/`valueList` children into `List` /
`SpacedValue`. Deferred to the value-assembly / fns-move workstream; listed for completeness.

---

## 4. Tier-0b deletions unlocked, with byte-identity risk

| Grammar change | Tier-0b code DELETED | Site | Byte-identity risk |
|---|---|---|---|
| §3.1 cp-name split | `declName` interp branch | `custom-props.ts:76-82` | **Low** — leaves cover the same bytes; `interpFromLeaves` already matches `interpFromString`'s part coalescing (see `interp.ts:41-45` JSDoc). |
| §3.2 cp-value split | `interpFromString` (custom-props copy) | `custom-props.ts:46-61` | **Medium** — content-regex boundary at `@{` (break-mode 3); `unquote:true` must be preserved on spliced refs. |
| §3.4 prelude split | `parsePreludeValue` 3 regexes + `interpFromString` (at-rules copy) | `at-rules.ts:72-87,95-112` | **Medium** — `@@name` / `@name` / `@{…}` ordering + the curly mis-bound golden change (§3.4). |
| §3.3 quoted split | `_buildStringInterpolation` (bridge), `QUOTE_RE` *stays* (synthetic) | `builders.ts:1367`; `literal-tag.ts:117-125` **KEEP** | **High** — escapes, empty strings, `@{` inside `\…`, trivia inside string. Break-mode 1. |
| §3.5 list assembly (host) | `topLevelSplit`, `hasTopLevelComma`, `coerceListItems` split branch, `betweenBytes` comma fallback | `list-helper.ts:45-90,98-108`; `value-expr.ts:103-110,152-154` | **Medium** — split-vs-node ordering of comma-looser-than-space (`list-helper.ts:103`) must be reproduced by the assembly action. |
| (already done by literal-tag P0) | `QUOTE_RE` for PARSED strings | `literal-tag.ts` — parsed path reads `LitFields` (L159-163) | n/a — do NOT re-plan; the synthetic `isQuotedBytes` default stays. |

### 4.1 SUSPECT-GOLDEN OWNER DECISION — `lessInterp` is stricter than the oracle regexes

A systematic byte-identity divergence cuts across §3.2 (cp-value) and §3.4 (at-prelude): the
grammar's `lessInterp` token (`grammar.ts:85`, `/@\{-?[_a-zA-Z0-9-￿][…]*\}/` — a bare
name, no interior whitespace, no dot) is **STRICTER** than the oracle re-tokenizers it would
replace. Both `INTERPOLATION_REGEX` (`utils.ts:13`, `/([$@])\{([^}]+)\}/g`) and the host
`interpFromString` (`/@\{\s*([^}]+?)\s*\}/g`) accept `[^}]+` — so `@{ base }` (interior
whitespace) and `@{a.b}` (dot) **match the oracle but NOT `lessInterp`**. Under a leaf-split those
forms fall to the literal content run → they stay verbatim `Word` bytes instead of becoming an
`Interp` → **byte drift** wherever the current opaque run is re-tokenized by the permissive host
regex (cp-VALUE §3.2, at-PRELUDE §3.4).

This is **NOT** true of cp-NAME (§3.1): `customPropInterp` (`grammar.ts:72`) is ALREADY the strict
regex, so there is no permissive oracle to diverge from — its "Low" rating stands.

**✅ OWNER DECISION (2026-07-17): ADOPT STRICT.** `lessInterp` stays `@{name}`-only; `@{ base }`
(interior whitespace) and `@{a.b}` (dot) are NOT interpolation — matches the real Less 4.x
reference lexer. Any golden that leaned on the permissive-but-buggy behavior is a jess-only
artifact and gets corrected (validate against real 4.x per the suspect-golden rule before landing).
Rationale (owner): the permissive regex swallows `a.b` as a single flat variable name `"a.b"` —
that is a *misread*, not module access. If Less v5 `@use` later grows `@{module.member}`
interpolation, it will be a **deliberate structured grammar extension** (member-access nodes, gated
on module context), NOT a loosened flat-string regex — so preserving the permissive form would bake
in exactly the wrong shape. `@{module.member}` stays PARKED until `@use` namespace-access syntax is
decided. Strict now costs nothing there and keeps byte-identity with 4.x.

- ~~**Loosen `lessInterp`** to `@{ [^}]+ }`~~ — REJECTED: ports a bug + a flat-string misread into
  the maintained grammar.

Riskiest gate cases to run both ways before deciding: `@{ x }`, `@{a.b}`, each **inside a string**
(`"@{ x }"`, §3.3) and **inside an at-prelude** (`@keyframes @{ x }`, `@media @{a.b}` via the
generic path). See break-mode 2.

Also retired as a **follow-on** (bridge side, once §3.1-3.4 land and the bridge is deleted per
constitution P1): `utils.ts` `INTERPOLATION_REGEX` / `getInterpolatedOrString` /
`getInterpolatedNode` (`utils.ts:13,32,92`) and the DRY'd `interp.ts` `interpFromString` shared
copy noted in the kill-list Tier 3.3. These are the bridge's re-tokenizers; they die with the
bridge, not with the grammar change, but the grammar change is their precondition.

---

## 5. Sequencing, co-dependence, gating

**Independent vs co-dependent.**

- §3.1 (cp-name) and §3.2 (cp-value) share `custom-props.ts` and the `interpFromLeaves` consumer
  — land together, one PR, gated by `custom-props-host-byte-identity.test.ts`.
- §3.4 (prelude) is independent of custom-props; shares only the `interpFromLeaves`/leaf-walk
  vocabulary. Gated by `at-rules-host-byte-identity.test.ts` + `charset-host-byte-identity.test.ts`.
- §3.3 (quoted) is **independent of all Less Tier-0b deletions** (no Less deletion needs it) and
  is the highest risk — sequence it **last**, after (A)-shape is proven on the lower-risk sites,
  and treat it as the on-ramp to constitution shape (B).
- §3.5 (list assembly) is a **host** change with no grammar dependency — it belongs to the
  value-assembly / fns-move track and can proceed in parallel; it must NOT block on §3.1-3.4.

**Recommended order:** §3.1+§3.2 → §3.4 → (§3.5 in parallel, different workstream) → §3.3.

**Interaction with the in-flight resolver (`RESOLVER-SHAPE-SPEC.md`).** Interpolation refs
become `VarRef` nodes (`t2.varRef(name)`, `interp.ts:61`) that resolve through the scope frame
at serialize time. The resolver rework changes *how* a `VarRef` resolves (per-decl exclusion,
strict-throw vs optional-sentinel per `v5-resolve-failure-is-eval-error-unless-optional`), not
the *shape* of the ref the grammar emits. **No coupling** — the grammar change hands the resolver
the same `VarRef` it gets today; only the number of construction sites that produce it via a
clean leaf (vs a regex) changes. Land order-independent; do not block either on the other.

**Interaction with the fns-move (`FNS-PACKAGE-MIGRATION-SPEC.md`).** The §3.5 list-assembly item
is the one that touches fns: `list-helper.ts` currently lives in `core/src/ast/functions/` and is
slated to move to `@jesscss/fns`. Deleting `topLevelSplit`/`coerceListItems` should be
**coordinated with**, and ideally folded INTO, the fns-move (delete-on-move rather than
delete-then-move) so the split code is not ported to the new package and then removed. The
interpolation-grammar items (§3.1-3.4) do **not** touch fns.

**Gating strategy (both floors, per P6 + the ratchet memory).**

1. **CST byte-snapshot** on the parser side: for each split site, add fixtures to the
   `less-parser` CST tests asserting the new leaf/child structure AND that
   `parsed.tree` serialization is unchanged for the bridge path (the bridge must keep working
   until P1 deletes it). A shared-prefix/backtrack regression check (per
   `parser-shared-prefix-backtrack-class`) since §3.3/§3.4 add ordered `choice` arms with a
   shared leading char (`"`/`@`).
2. **Host byte-identity**: the existing `*-host-byte-identity.test.ts` suites
   (`custom-props`, `at-rules`, `charset`, `value-expr`, `selector-interp`) are the gate — each
   asserts the tree2 host output is byte-identical to the bridge oracle. A split that changes a
   byte fails here.
3. **Golden exceptions** (§3.4 curly mis-bound, and any `@media @{q}` that previously
   misparsed): these are NOT byte-identity passes — they are *corrections*. Isolate them, prove
   against real Less 4.x + the alpha `.css` oracle, and get owner review before landing (suspect-
   golden rule). Do not let a correction ride silently through the byte-identity gate.
4. **Full workspace build** before the fail-count is trusted (`pnpm -r build` incl. plugins/fns —
   partial build inflates fails; memory `all-less needs FULL workspace built`).

---

## 6. Adversarial self-check — the 3 ways this breaks

**Break-mode 1 — Quoted escapes + empty + nested (`§3.3`).** The flat `singleStr`/`doubleStr`
regexes handle `\"`, `\\`, line continuations, and `@{` inside an escape (`"\@{x}"` is a literal
`@{x}`, NOT a ref) in ONE atom. Splitting the string into `chunk | lessInterp` re-implements that
tokenization by hand, and the failure is silent byte drift: an escaped `\@{` that the chunk regex
mis-classifies becomes a spurious ref; an empty string `""` must produce zero children (a `many`
that matches nothing) not a stray empty chunk; a string that is `"@{a}"` end-to-end must not
leave a zero-width literal chunk that serializes differently. Mitigation: the chunk regex encodes
`@(?!\{)` and `\\[\s\S]` (§3.3) so an escaped `@{` stays in the chunk; gate with a fixture matrix
of `""`, `"\@{x}"`, `"@{a}"`, `"a@{b}c"`, `"@{a}@{b}"`, `'…'` twins, and strings with trivia-
looking bytes inside, plus the §4.1 strictness cases *inside a string* (`"@{ x }"`, `"@{a.b}"` —
match the bridge's `_buildStringInterpolation` but not `lessInterp`, so a leaf-split keeps them
literal = drift; route through the §4.1 owner decision). This is why §3.3 is sequenced last and
kept behind the plain-string fast arm.

**Break-mode 2 — At-rule prelude: strict-`lessInterp` divergence + trivia re-join (`§3.4`).** The
current behavior is now VERIFIED (not "unverified"): the opaque `scanTo` terminates at the first
`{` (dead `bCurly`, §1.4), so `@keyframes @{n} {` misparses today and the split *corrects* it
(gated golden, §3.4). Two remaining hazards: (1) **the strict/permissive divergence** (§4.1) —
`@keyframes @{ x }` / `@media @{a.b}` (generic path) match the host regex but not `lessInterp`, so
a leaf-split silently keeps them literal = byte drift; this is the owner decision, not a bug to
fix in passing. (2) **trivia re-join** — `scanTo` swallows internal whitespace into the one leaf,
whereas a token run lets ambient `rw` consume it and log it separately, so `@media  screen`
(double space) could serialize with different internal spacing if the host re-joins tokens
naively. Mitigation: BEFORE writing grammar, add a parser test pinning the exact current prelude
bytes for `@media  screen`, `@page :first`, `@supports (a:b)` (byte-preserving cases) AND the
correction cases `@keyframes @{n}`, `@keyframes @{ x }`, `@media @{a.b}`; write the split to
reproduce the byte-exact join for the former and route the latter through the §4.1 decision.
Over-structuring risk: pure CSS (`@media screen and (min-width:600px)`) must NOT gain
interpolation structure — `preludeChunk` must consume it as one literal run.

**Break-mode 3 — `@{` boundary in permissive content runs (`§3.2` cp-value, over-structuring
generally).** `cpOuterContent`/`cpInnerContent` currently eat `@` as content, and adding
`lessInterp` as a prior alt is only correct if the content regex is *also* narrowed to stop
before `@{` while STILL consuming a bare `@name` literally (owner rule: cp-values resolve only
`@{…}`). Get this wrong in either direction and it breaks byte-identity: too greedy → `@{a}`
absorbed as literal (deletion is a no-op, regex still needed); too eager → a bare `@color`
wrongly split into a ref (owner-rule violation, changes output). The same over-structuring trap
applies to nested interpolation `@{@{x}}`: `lessInterp` (`grammar.ts:85`) matches only a bare
name, so `@{@{x}}` does NOT match `lessInterp` and must fall to the literal content run exactly as
today (Less does not support nested interpolation; the split must not accidentally start
supporting it). Mitigation: fixture the boundary cases `--x: @{a}`, `--x: @color`, `--x: @{a}@{b}`,
`--x: a@{b}c`, `--x: @{@{x}}`, `--x: url(@{a})` and gate against the bridge; keep `lessInterp`
name-only so the nested case is structurally impossible to over-match.

---

## 7. Open questions for the reviewer

1. **(A) vs (B) — RESOLVED (endorsed by adversarial review): ship (A) now.** For Less, (A) and
   (B) are *semantically identical* because `lessInterp` is name-only (`grammar.ts:85`) — there is
   no expression to carry — so (A) is not a compromise, it is the correct Less shape. (B)'s real
   work is general expressions in `#{…}` / `${…}`, which live in the **scss / jess grammars
   (different files)**, so landing (B) there adds ZERO throwaway to the (A) work done here; (A)
   does not have to be un-done. The constitution's "interpolation is a real child node carrying an
   EXPRESSION" model is satisfied by (B) landing in scss/jess, NOT by forcing it into less-parser.
   Two guardrails are **ENFORCED** so the later (A)→(B) widening stays local:
   - **(i) Single swap point.** `interpName` / `interpFromLeaves` (`interp.ts:33-47`) is the SOLE
     place that turns a leaf into a ref. (B) replaces the `lessInterp` regex leaf with a
     `node('Interp', …)` and upgrades ONLY these two functions to read a node child; nothing else
     in the host touches interpolation construction.
   - **(ii) Pre-widen the payload type.** Declare `InterpPart.ref` (`nodes.ts:130`) as a general
     value-node type NOW (not `VarRef`), even though Less only ever puts a `VarRef` there, so the
     later widen to a general expression node needs no serializer/resolver fan-out — the
     serialize/resolve sites already accept the wide type.
2. **§3.4 golden change — ✅ OWNER DECISION (2026-07-17): FIX IT INLINE.** The early-termination
   bug is VERIFIED (dead `bCurly`, §1.4): `@keyframes @{n} {` misparses today. Owner: "if it's
   buggy, fix it — we have to parse things in the correct way." The grammar split ships the
   correction in-scope; do NOT byte-preserve the buggy behavior. The ONE discipline: the corrected
   `@keyframes @{n} {` output is validated against **real Less 4.x** (not jess's own output) before
   landing — suspect-golden check, not a reason to preserve the bug.
3. **Bridge lifetime.** §4's follow-on deletions (`utils.ts` regexes) depend on P1 bridge
   deletion. Confirm the ordering: grammar split → tree2 deletions → bridge deletion → bridge-
   regex deletion, so the byte-identity oracle survives until the tree2 side is proven.
