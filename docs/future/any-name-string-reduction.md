# `Any`-node allocation reduction for simple strings — archaeology + restore map

Status: **archaeology complete, awaiting go-ahead for the restore pass.**
Branch: `work/any-name-string` (base `origin/work/cutover-p1` = `587d56140`).

## Goal

The `Any` node (`packages/core/src/tree/any.ts`, formerly Less `Anonymous`) carries a
`string` value + an optional `role`. `any.ts:30` carries the stranded AUDIT comment
*"Do we still need this? Now that we're storing strings?"*. Intent: carry simple
`name`/`ident`/`keyword`/`property` tokens as **plain strings**, allocating `Any`
only where a token genuinely needs eval behavior (interpolation, math coercion,
value-node identity).

## 1. String-narrowing history (what was done, what survived)

The two known-lead commits and the wider narrowing are **all present in the base**
(`git merge-base --is-ancestor` confirms both are in `HEAD` ancestry). **No revert of a
name/ident narrowing was found** — the failure mode described in the brief (an agent
reverting string→node on a red test) did **not** happen for the name fields. The
narrowing landed and stuck.

Timeline (core tree + parsers, oldest→newest):

| SHA | What it narrowed |
|-----|------------------|
| `12befe7d1` feat(core): narrow Mixin and Declaration names to `string \| Interpolated` | `Mixin.name`, `Declaration.name` / `VarDeclaration.name`; registration prep resolves interpolated names to strings without materializing `Any`. Parsers + tests supply bare strings. |
| `390108b1b` feat(core): narrow AtRule/AtRuleStatement/Func names to `string \| Interpolated` | `AtRule.name`, `AtRuleStatement.name`, `Func.name`. All parser packages emit bare strings for static names, `Interpolated` for interpolated ones, dropping throwaway `Any` wrappers. Fixed a string-name at-rule serialization double-space bug. |

Follow-up noted in `390108b1b` (NOT a revert, an accurate regression marker): string-named
at-rule/declaration names drop name-boundary trivia because a bare string has no span;
tracked in `docs/future/trivia-offset-inference-model.md`, related trivia round-trip
tests intentionally left red.

Reverts scanned (`git log --all --grep -E 'revert|Revert'`): the reverts on record are
about `Reference` specialization, per-slot spans, selector-header trivia, and a mixin
fold — **none touch the name/ident string narrowing.** Conclusion: the name-field
lean-ification is intact; there is nothing to "restore" at the field-type level for
`name`.

## 2. Current-state map

### Already strings (done — no `Any` on these positions)

- `Declaration.name` / `VarDeclaration.name`: `string | Interpolated` (`declaration.ts:149`).
- `AtRule.name` / `AtRuleStatement.name`: `string | Interpolated` (`at-rule.ts:70`).
- `Func.name`, `Mixin.name`: `string | Interpolated` via their `Value['name']` (`function.ts:40`, `mixin.ts:84`).
- **Declaration/AtRule VALUES already accept bare strings.** `DeclarationValue.value`
  is `Node | string | DeclarationValueSegment[]` and `AtRulePrelude` is `string | Node`.
  The tree coerces a string → `Keyword`/`Dimension`/`Color` **lazily**, only when a real
  node is needed (`util/evaluate-node-array.ts` `coerceStringTerminal`/`coerceValueNode`,
  `declaration.ts` `valueNode()`/`toAssignmentInputNode()`). Render/serialize handle the
  bare-string form directly. This is the lean pattern already in place.

### Still allocate `Any`/`Keyword` — CORE side

All remaining **core** `new Any`/`new Keyword` sites are **eval-time value producers**,
not simple parser tokens. They carry a *computed/rendered* string that must flow as a
value node. These are load-bearing (the value is consumed by node-only machinery: List/
Operation/Reference/serialize-with-provenance). They are NOT the AUDIT target:

- `call.ts` 627/891/1501/1883/1922/1983 — Call output (`markCallOutput(new Any(rendered,…))`).
- `reference.ts` 2720/2725/2753/3098/3366 — Reference resolution results.
- `interpolated.ts:345` — Interpolated eval result (genuinely needs `Any`: has a role + eval identity).
- `negative.ts:133`, `node.ts:35` (`+`), `cast.ts:60`, `quoted.ts:152`, `paren.ts:351`,
  `control.ts:445`, `callable-param-match.ts:206` — computed value nodes at eval time.
- `import-style.ts:613` — inline-source `Any`.

**Two genuine CORE-side lean-ification candidates** (constant `'!important'`, and the
field already accepts `string`):

1. `call.ts:86-87` `createImportantFlag()` → `new Any<'flag'>('!important', …)`, used at
   `call.ts:1748` `makeImportant` as `deriveWithParts({ important })`.
2. `declaration.ts:222` `{ important: any('!important', { role: 'flag' }) }`.

`Declaration.important` is typed `Any<'flag'> | string | boolean` (`declaration.ts:152`)
and serialization already branches on `typeof important === 'string'` / `instanceof Node`
(`declaration.ts:1226-1230`, `1310-1327`). Both sites emit the **constant** `'!important'`
with no eval behavior, so they can be bare `'!important'` strings. This removes an `Any`
allocation on every `!important` declaration and every `makeImportant` call.

### Still allocate `Any`/`Keyword` — PARSER side (DEFERRED producer flip)

The AUDIT comment's real target. These emit `Any`/`Keyword` for simple static tokens at
parse time; flipping them to bare strings is the **deferred producer pass** (held with the
BasicSelector producer flip until parseman work lands). Recorded here for that pass:

- `css-parser/src/builders.ts`: `472` (`new Any(leafText…)`), `677-678` `_valueKeyword`→
  `Keyword`, `784`, `1037`, `1069`, `1077`, `1173`, `1207` (ident split), `1226` (charset),
  `1230`/`1259` (at-rule prelude), `1274`, `1309`/`1318` (`not`/op keywords), `1339` (ident).
- Analogous sites in `less-parser/src` and `scss-parser/src` productions.

The core consumers are **already string-ready** for value/prelude/name positions (see
"Already strings"), so the deferred producer flip is unblocked on the core side for those
positions — it is gated only on parseman sequencing, not on missing consumer support.

## 3. Restore plan (this pass = CORE-side only)

Per the brief, DEFER the parser-producer flip. This pass does the CORE-side work:

1. **`!important` constant → bare string** (the one real CORE allocation win):
   - `call.ts`: drop `createImportantFlag()`; `makeImportant` uses `important: '!important'`.
   - `declaration.ts:222`: `{ important: '!important' }`.
   - Verify every `important` consumer accepts the string form (typed union already
     includes `string`; serialization already branches). Fix any spot that assumes
     `instanceof Node` / `.valueOf()` on `important`.
2. **Update tests to the string shape** where they assert `important` as an `Any`/node —
   NEVER revert the string form to node creation to satisfy an old node-shaped test.
3. **No field-type name changes needed** — names are already `string | Interpolated`.
4. Everything else (Call/Reference/Interpolated/Negative/cast eval output) stays `Any`:
   these are computed value nodes with genuine eval/value-node identity, justified beyond
   "a method is called on it."

### Genuinely load-bearing `Any` roles (keep)

- `role: 'flag'` on `important` — **NO**, that's the constant candidate above (string it).
- Interpolated eval result (`interpolated.ts`) — keeps `Any` (role + eval identity).
- Call/Reference rendered output — keeps `Any` (value flows into node-only machinery).
- The `Any` class + `Keyword` subclass themselves stay: they are the lazy-coercion target
  for bare value strings (`coerceStringTerminal`) and the eval-output value node. The
  AUDIT comment is answered "yes, still needed — but only as the eval-output/lazy-coerce
  value node, not as a wrapper for static parse tokens."

## Metric

`Any` allocation reduction for the CORE pass = one fewer `Any` per `!important`
declaration + per `makeImportant` invocation. The larger reduction (static parse tokens)
is realized by the deferred producer flip, for which the core consumers are already ready.

## Gate

- `pnpm --filter @jesscss/core build`; `cd packages/core && pnpm test`
  (baseline 3258/0 on this base; `extend-selector` all-less fails on this base — extend-#4a
  not integrated — NOT ours).
- jess `ast-v2-production-ratchet` green. Canonical Stylesheet/context and
  public Compiler-route output remain covered; byte-identical output is checked
  by the Less corpus.
