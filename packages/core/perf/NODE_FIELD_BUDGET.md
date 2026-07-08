# NODE FIELD BUDGET — codebase-wide class-unique field audit (≤5 hard budget)

Companion to `RULES_FIELD_BUDGET.md` (which covers `Rules`/`Ruleset` only). This
enumerates the CLASS-UNIQUE stored instance-field count of EVERY node class under
`packages/core/src/tree/`, per the owner's HARD BUDGET rule (CORE-CLEANUP.md
§ "⛔ HARD BUDGET — ≤5 CLASS-UNIQUE FIELDS PER NODE TYPE").

Grounded in `origin/dev` (`e27725987`). "Class-unique" = fields the class declares
BEYOND what its parent already carries. A field the parent FIRST declared counts
against the parent, even when a subclass re-declares (re-types) it. Only **stored
instance slots** count: `get`/`set` accessors live on the prototype (0 slots),
`static` members are per-class (0 instance slots), `declare`-only prototype
patches (e.g. `Node.nil`) are 0 slots, and a `declare` field with a conditional
ctor assignment adds a slot ONLY on instances that get assigned.

---

## Executive summary

**Every node class in the audited scope is AT or UNDER the ≤5 budget.** The only
classes over 5 are:

- **base `Node` (10)** — the irreducible per-instance foundation every node needs.
- **`Rules` (7)** and **`Ruleset` (6)** — OWNED BY THE Rules-slim AGENT, out of this
  agent's scope (see `RULES_FIELD_BUDGET.md` for their slice plan to ≤5/≤4).

No class in this agent's scope required a slim, and none needed an owner judgment
call. The prior SLIM landings (reference disjoint-field split, PseudoSelector
`pseudoFlags` pack, `rulesFlags`/`_lookup`) already put the historically-fat
non-Rules nodes under budget.

**Budget-compliance status (this agent's scope, 60 classes excluding Rules/Ruleset):
60/60 ≤5.** Codebase-wide including the two out-of-scope Rules-family classes:
`Rules` 7 and `Ruleset` 6 remain over (owned elsewhere); base `Node` is 10 (see
"base Node" note below).

---

## Full class-unique field table (before == after; no changes landed)

Bases are listed first; subclass counts exclude everything the base already declares.

### Intermediate / base classes

| class | extends | class-unique count | fields |
|---|---|---|---|
| **`Node`** | (root) | **10** | `_spanStart`, `_spanEnd`, `_sourceRoot`, `_treeContext`, `_options`, `flags`, `_requiredSemi`, `sourceNode`, `index`, `parent` |
| `Any` | `Node` | 2 | `value`, `role` |
| `Selector` (abstract) | `Node` | 3 | `value`, `_valueOf`, `keySetLibrary` |
| `SimpleSelector` (abstract) | `Selector` | 0 | — |
| `Declaration` | `Node` | 3 | `value` (declare re-type is content), `name`, `important` |
| `Dimension` | `Node` | 2 | `number`, `unit` |
| `Sequence` | `Node` | 2 | `value`, `preserveWhitespace` |
| `Rules` ⚠ OUT OF SCOPE | `Node` | **7** | see `RULES_FIELD_BUDGET.md` |

`type`/`shortType`/`nodeType`/`nil` on `Node` are prototype (`declare`) — 0 slots.
`Node` base value is NOT stored on the base; each node class owns its own `value`.

### Leaf / concrete classes

| class | extends | class-unique | fields |
|---|---|---|---|
| `AtRuleStatement` | `Node` | 2 | `name`, `prelude` |
| `Apply` | `Node` | 1 | `selectors` |
| `Ampersand` | `SimpleSelector` | 1 | `appendValue` |
| `Anonymous` | `Any` | 0 | — |
| `Keyword` | `Any` | 0 | — |
| `Bool` | `Node` | 1 | `value` |
| `Call` | `Node` | 4 | `name`, `args`, `contentNode`, `_evaluatedCallOutput` (`_requiredSemi` override ≠ unique) |
| `Block` | `Node` | 1 | `value` |
| `AtRule` | `Rules` | 3 | `_valueOf`, `name`, `prelude` (`rules` re-type ≠ unique) |
| `Combinator` | `Selector` | 0 | (`value` is Selector's) |
| `Comment` | `Node` | 2 | `value`, `lineComment` |
| `Color` | `Node` | 4 | `node`, `_rgbChannels`, `_hslChannels`, `_alphaValue` |
| `CustomDeclaration` | `Declaration` | 0 | — |
| `Collection` | `Rules` | 0 | — |
| `VarDeclaration` | `Declaration` | 0 | — |
| `If` | `Rules` | 2 | `condition`, `else` (`rules` re-type ≠ unique) |
| `For` | `Rules` | 2 | `pattern`, `iterable` |
| `While` | `Rules` | 1 | `condition` |
| `Condition` | `Node` | 4 | `left`, `operator`, `right`, `negate` |
| `Expression` | `Node` | 1 | `value` |
| `Func` | `Node` | 3 | `name`, `params`, `body` |
| `DefaultGuard` | `Node` | 0 | (`value` via Node<string>) |
| `JsImport` | `Node` | 2 | `path`, `imports` |
| `Extend` | `Node` | 4 | `selector`, `target`, `namespace`, `flag` |
| `Interpolated` | `Node` | 3 | `source`, `replacements`, `role` |
| `JsArray` | `Node` | 1 | `value` |
| `ExtendList` | `Node` | 1 | `value` |
| `Log` | `Node` | 2 | `level`, `message` |
| `List` | `Node` | 3 | `value`, `sep`, `_valueOf` |
| `JsObject` | `Node` | 1 | `value` |
| `StyleImport` | `Node` | 3 | `path`, `with`, `withNode` |
| `Nil` | `Node` | 1 | `value` |
| `Negative` | `Node` | 1 | `value` |
| `JsFunction` | `Node` | 2 | `fn`, `name` |
| `Num` | `Dimension` | 0 | — |
| `Mixin` | `Rules` | 4 | `name`, `params`, `guard`, `_keySet` (`rules` re-type ≠ unique) |
| `Operation` | `Node` | 3 | `left`, `operator`, `right` |
| `Quoted` | `Node` | 3 | `value`, `quote`, `escaped` |
| `QueryCondition` | `Sequence` | 0 | — |
| `Range` | `Node` | 3 | `start`, `end`, `step` |
| `Rest` | `Node` | 1 | `value` |
| `Paren` | `Node` | 1 | `value` |
| `AttributeSelector` | `SimpleSelector` | 0 | (value/parts via Selector) |
| `Reference` | `Node` | 4 | `_rulesLookupHandle`, `key`, `target` (declare/disjoint), `rawKey` (declare/disjoint) |
| `SelectorCapture` | `Node` | 1 | `selector` |
| `BasicSelector` | `SimpleSelector` | 1 | `value` |
| `SelectorList` | `Selector` | 0 | (`value` is Selector's) |
| `InterpolatedSelector` | `SimpleSelector` | 0 | (`value` is Selector's) |
| `ComplexSelector` | `Selector` | 0 | (`value` is Selector's) |
| `RelativeSelector` | `ComplexSelector` | 0 | — |
| `PseudoSelector` | `SimpleSelector` | 3 | `name`, `arg`, `pseudoFlags` (already packs 2 rare fields) |
| `Stylesheet` | `Rules` | 0 | — |
| `Url` | `Node` | 1 | `value` |
| `Ruleset` ⚠ OUT OF SCOPE | `Rules` | **6** | see `RULES_FIELD_BUDGET.md` |

Notes on the higher-count concrete classes (all ≤ budget, but the ones with slack
worth noting):

- **`Call` (4):** `name`/`args`/`contentNode` are irreducible content; `_evaluatedCallOutput`
  is a one-bit memo that could fold to a class-local flags int if a 6th field ever
  lands. `_requiredSemi = true` is an OVERRIDE of the inherited base field, not a new
  slot — does not count against Call.
- **`Color` (4):** `node` (source form) + three lazy channel caches (`_rgb`/`_hsl`/`_alpha`
  Channels), each `undefined` by default. The three caches are derivable-memo; if a 6th
  field landed, collapse them into one lazy `_channels` sub-struct.
- **`Condition` (4):** `left`/`operator`/`right`/`negate` — all irreducible content of a
  condition expression. `negate` is the only boolean; would pack into a flags int if
  forced, but there's no pressure at 4.
- **`Extend` (4):** `selector`/`target`/`namespace`/`flag` — irreducible extend content.
- **`Reference` (4):** already the owner-blessed disjoint-field slim — `target`/`rawKey`
  are `declare` (no slot on the common variable/function reference; assigned only on
  index/property/mixin-ruleset references).
- **`Mixin` (4):** `name`/`params`/`guard` content + `_keySet` (lazy signature cache).
  `rules` is a re-type of `Rules.rules` (no new slot).
- **`PseudoSelector` (3):** already slimmed — `omitWrapperForSingleSelectorList` +
  `generatedPseudoPlacementOverride` were packed into the single lazy `pseudoFlags` int
  (SLIM target #4, landed).

## Note on base `Node` (10)

The budget rule says it applies to `Node` too. `Node`'s 10 fields are the irreducible
per-instance foundation shared by all ~39k nodes: source spans (`_spanStart`/`_spanEnd`,
2 inline SMIs — the owner-decided provenance representation), tree wiring (`parent`,
`index`, `sourceNode`, `_sourceRoot`), context (`_treeContext`, `_options`), the packed
`flags` int (already absorbs `frozen`/`hoistToRoot`/`generated`/`registrationPrepared`/
`visible`/`requiredSemi` as bits — see SLIM #3), and `_requiredSemi`. These are not
collapsible without a base-shape redesign (e.g. moving `_options`/`_treeContext` behind a
lazy context sub-struct, or dropping `sourceNode`), which is a cross-cutting architectural
change touching every node and every walk — explicitly out of a field-budget slim pass and
NOT forced here. Flagged for owner: base `Node` is the one genuine over-budget class in
scope, but its overflow is foundational, not accreted.

---

## Gates (no code changed — before == after)

- Core suite: 3095 passed / 0 failed / 15 skipped (baseline, `origin/dev` `e27725987`).
- `all-less` byte-identical: 90/93 (3 pre-existing dev failures, unrelated).
- No slims landed → no byte-diff risk introduced by this audit.
