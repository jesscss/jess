# BasicSelector → string boundary map

Branch `work/basic-selector-string` (base `origin/work/cutover-p1` = `587d56140`).

## TL;DR / headline finding

**The "strings-not-nodes" migration is already the architecture in core and in the
CSS/Less/SCSS base parsers.** `SelectorLike = (Selector | string) | (Selector |
string)[]` — a simple selector is a bare string, an array *is* a selector list,
and core lifts a string to a `BasicSelector` node only at the few points that need
structure (matching / extend / ampersand). `BasicSelector` the class is NOT going
away; it is the on-demand lifted form.

The one place still contrary to the design is the **jess-parser** (`builders.ts`),
which eagerly re-wraps parsed selector strings back into `BasicSelector` nodes in
three builders. One of the three (`Extend`) is a genuine divergence from the
sibling less-parser and from what core expects; the other two feed core nodes that
genuinely *require* `Selector` nodes.

## 1. Where strings vs. `BasicSelector` are produced today

### CSS base builder (`packages/css-parser/src/builders.ts`) — ALREADY STRINGS
- `_makeBasicSelector(value)` → returns the **plain string** (line 673). Explicit
  migration seam; comment at 664-668 says both `SelectorList` and `BasicSelector`
  are "slated for removal … a basic selector becomes a bare string."
- `_makeSelectorList(items)` → returns a **plain array** (line 669).
- `_buildSelectorList` collapses a 1-item list to the bare item (string) (line 683).
- `_buildCompoundSelector` / `_buildComplexSelector` collapse a single part to the
  bare item and only build a real node for genuinely compound/complex selectors.
- SCSS builder (`scss-parser/src/builders.ts:1071,1157`) routes through the same
  seams → strings.

So **CSS and SCSS already emit strings** for simple selectors. Ruleset selectors
arrive at core as `string | array | node`.

### Less builder (`packages/less-parser/src/builders.ts`) — MIXED, string for extend
- Ruleset selectors: same shared seams → strings/arrays.
- **`_buildExtendTarget` (line 939) delivers `Extend.target` as a bare STRING**
  (`typeof targetComp === 'string' ? targetComp : …`), relying on core's
  lift-on-demand. This is the reference behavior.

### jess-parser (`packages/jess-parser/src/builders.ts`) — RE-WRAPS TO NODES (the gap)
Three builders coerce the parsed string back into a `BasicSelector`:
1. `_captureSelectorFrom` (line 755-763) — `SelectorCapture` payload: string →
   `new BasicSelector`, array → `SelectorList.create`.
2. `_buildJessExtend` (line 824-833) — `Extend.target`: `new BasicSelector(text)`.
3. `_buildJessApply` (line 874-876) — `Apply.selectors`: each `new BasicSelector`.

## 2. Where core REQUIRES a node vs. accepts a string

| Consumer | Field type | String OK? | Why |
|---|---|---|---|
| `Ruleset.selector` | `SelectorLike \| Nil` | **YES** | Stored as-delivered (ruleset.ts:109-136); string path trimmed and used directly (e.g. `splitSelectorStringKeys` at rules.ts:3177). Lifts to `BasicSelector` only inside ampersand/compose (ruleset.ts:321,1501,1521,1641). |
| `Extend.target` | `SelectorLike` | **YES** | writeSyntax at extend.ts:128 currently calls `target.writeSyntax` (needs string branch); `runEffect` already lifts via `asExtendSelectorNode` (extend.ts:155). Less-parser already passes a string. |
| `SelectorCapture.selector` | `Selector` (node) | **NO** | Calls `this.selector.writeSyntax/.valueOf/.eval/.resolve` (selector-capture.ts:34-95); `requireSelector` throws on a non-node. **Must stay a node.** |
| `Apply.selectors` | `Selector[]` (nodes) | **NO** | Calls `selector.writeSyntax`, `resolveRulesetBySelector(selector, …)` (apply.ts:43-95). **Must stay nodes.** |

Core's canonical string→node lift points (these stay):
- `asExtendSelectorNode` (`util/extend-roots.ts:181`) — string/array → node for the
  matching engine; used across extend.ts, pipeline.ts, spine-extend.ts, extend-roots.ts.
- `selector-match-core.ts:43`, `extend-walk.ts:207` — lift a string component to
  `BasicSelector` for walk/match.
- `ampersand.ts` (many) and `interpolated.ts` — build `BasicSelector` when composing
  `&` / interpolated output; these are constructing, not transporting.

## 3. What should become a string; what stays a node

**Becomes a string (parser output change, jess-parser only):**
- `Extend.target` for a simple literal target (`$extend .box;`) — deliver the bare
  string like the less-parser does. Requires teaching `Extend.writeSyntax` the
  string branch (one line: `typeof target === 'string' ? w.add(target) :
  target.writeSyntax(options)`), because the jess `$extend` statement round-trips
  through `writeSyntax` (Less `:extend()` does not, which is why less-parser gets
  away with a string today).

**Stays a node (required by the consumer):**
- `SelectorCapture.selector` and `Apply.selectors` — core requires `Selector`
  methods. The jess-parser wrap there is correct. (A string simple target inside
  a capture/apply still lifts via `new BasicSelector`; that is the on-demand lift,
  not a transport regression.)

**Intent:** "parser emits strings, core lifts to nodes on demand." NOT "eliminate
the class." `BasicSelector` remains the lifted structural form.

## 4. Migration plan + risk

### Recommended (conservative, matches design + sibling parser)
1. `Extend.writeSyntax` (extend.ts:125-129): add a bare-string branch for `target`
   (and mirror in the `selector` branch if it can also be a string). Then change
   `_buildJessExtend` to deliver the bare string (drop `new BasicSelector`), the
   same shape less-parser already produces.
2. Update the jess-parser extend corpus (`09-extend.test.ts`) AST expectation from
   `(BasicSelector '.box')` to the bare-string form — these are internal AST-shape
   tests (per memory: parser AST shape is an internal, freely changed), and the
   less-parser corpus already asserts string extend targets.
3. Leave `SelectorCapture`/`Apply` (and their corpora `10`/`11`) as-is — nodes are
   required there.

### NOT recommended without owner sign-off
- Making `SelectorCapture`/`Apply` accept strings — would push a string→node lift
  into every method on those nodes for zero benefit (they always need the node).

### Risk
- **Byte-identical output**: the `Extend` change only affects `$extend`
  re-serialization; must verify `spine-production-ratchet` (56/56) and jess
  `all-less` extend cases stay byte-identical (a string target writes the same
  text a `BasicSelector` does, so expected neutral).
- **dev vs cutover-p1 divergence**: `origin/dev` is NOT an ancestor of HEAD
  (confirmed). The selector/extend code on cutover-p1 is the spine-extend line
  (extend-index.ts / spine-extend.ts / pipeline.ts) that dev does not have. Any
  edit here must be validated ON cutover-p1 only; do not cross-port from dev.
- **Perf**: dropping the eager `BasicSelector` allocation on every `$extend` is a
  small win (one fewer node per extend statement), never a regression. Not a hot
  path, so no A/B needed unless the writeSyntax branch shows up.

### Scope reality
The heavy lifting ("parser emits strings for ruleset selectors") is DONE. The
remaining actionable item is small and localized to the jess-parser Extend builder
+ `Extend.writeSyntax` + one corpus file. This is much narrower than the task
framing implies, because core and the base parsers already implement the
strings-not-nodes model.
