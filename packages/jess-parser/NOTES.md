# Jess Parser — build notes

Living doc for the `.jess` parser build (functional Parséman grammar,
`jessGrammar = compose([cssGrammar, <Jess delta>])`). Tracks settled syntax
decisions, **deferred work**, and known quirks so nothing lives only in an
agent's head. Syntax comes from two sources: how core AST nodes stringify, and
the canonical docs (`packages/docs-content/docs/jess/**` — `02-Language/**` is
authoritative; `packages/docs/docs/**` is a stale mirror).

Corpus: `test/corpus/NN-*.test.ts` — each case parses `.jess` and asserts the
serialized AST (`serializeTypes`). Run: `npx vitest --run test/corpus --root packages/jess-parser`.

---

## Deferred — must be done before the parser is "complete"

### Eval / semantics (not parseable-in-isolation; needs the evaluator)
- **`.foo` member ambiguity warning.** `$theme.foo` (type `declaration`) can
  resolve to a `Declaration` *or* a `VarDeclaration`. When a collection declares
  BOTH `$foo` and `foo`, eval must emit an **ambiguity warning**. The parser
  builds the `declaration` reference; the conflict detection + warning is an
  evaluator responsibility. Reachable disambiguated forms already parse:
  `$theme[foo]` (variable) vs `$theme['foo']` (property).
- **Dynamic-lookup namespace resolution.** `$theme[$foo]` (dynamic → variable)
  vs `$theme["$[foo]"]` (dynamic → property) both parse as `index`-type
  references; eval decides which namespace by the key node (a `Reference` key →
  variable space; an interpolated `Quoted` key → property space).

### Syntax contradictions — need USER adjudication before building
- **`$*[…]` selector-capture sigil (core AST ↔ docs conflict).** The docs specify
  the Jess form `$*[.notice]` (`08-interpolation.mdx` §4, used to feed `$extend`).
  But core's `SelectorCapture.writeSyntax` (`packages/core/src/tree/selector-capture.ts`)
  emits `*[…]` **without** the `$` — the Less form. So a parser that builds a
  `SelectorCapture` for `$*[.notice]` would round-trip to `*[.notice]`, losing the
  sigil. Resolution options (user picks): (a) change core `SelectorCapture.writeSyntax`
  to emit `$*[…]` (like Reference/Extend already carry their `$`); (b) wrap capture
  in a Jess-specific node; (c) accept `*[…]` as the canonical serialized form and
  update the doc. BLOCKS: `$*[…]` capture + `$extend $captured` end-to-end + the
  `$theme["$[foo]"]` dynamic-property key that rides on capture. `$extend .sel;`
  (direct selector target, no capture) is unblocked — Extend already serializes
  `$extend …;` with the `$`.

### Parser features still to build
- Interpolation `$[key]` (ident interp) — DONE. `$*[…]` (selector capture) is
  BLOCKED on the contradiction above; it also unlocks the `$theme["$[foo]"]`
  dynamic-property key.
- Collections / lists / maps (`$x: { … }`, comma lists).
- Control flow `$if` / `$else` / `$for` / `$while`.
- Mixins (defs, `$ >` calls, guards, anonymous) and functions (`@() > …`).
- `$extend` (statement, `-> target`, namespacing — NOT `:extend()`). Core Extend
  already serializes `$extend [sel ->] [ns|]target [!exact];` — buildable now for a
  DIRECT selector target (`$extend .box;`). `$extend $captured;` waits on `$*[…]`.
- **`$apply` / `$|` — doc surface differs from the task-list.** `05-mixins.mdx`
  documents two apply forms: `$|.rounded;` (single, `$|` sigil, `()` optional) and
  `$apply .rounded, .shadow;` (multiple, comma list, `apply` keyword). The task-list
  called it "sugar for `$ > *[sel]`, supports `ns|sel`" — reconcile which serialized
  AST these lower to (a mixin-ruleset Call? an Extend? a `*`-apply Reference?) before
  building; likely needs user input on the target node type.
- At-rules `@-compose` / `@-use` / `@-from` / `@-export` / `@-import`
  (`04-atrules.mdx`). Note `@-use` (Sass-module namespace form) and `@-from`
  (ESM `import (x as y)` / `import * as ns`) are DISTINCT script-import forms, not
  pure sugar for each other (task-list said "sugar for each other"). `@-compose`
  has modifiers `(reference)` / `(protected)` / `(export)` and `set`/`with` blocks.
  Map to core StyleImport / JsImport nodes.
- Update canonical docs (`docs-content/docs/jess/**`) to the settled syntax.

---

## Settled syntax decisions

- **Base:** compose over `cssGrammar` (cleanest shapes), not Less/SCSS. Author
  only the Jess delta + `//` comments. Selectors stay clean unless interpolated.
- **Variables:** `$name: value;` (name has no `$`); assign ops `:` `+:` `?:`.
  Live binding `$!foo` (renders `$!foo`; Reference `readMode: 'snapshot'`).
- **Accessor model** (`$theme.$key` is INVALID — removed from `reference.ts`):
  | Syntax | `type` | Semantics |
  | --- | --- | --- |
  | `$foo` | `variable` | variable read |
  | `$theme.foo` | `declaration` | ambiguous member (Declaration OR VarDeclaration; warns) |
  | `$theme[foo]` | `variable` | the variable `$foo` on theme |
  | `$theme['foo']` | `property` | literal property (Declaration) |
  | `$theme[0]` | `index` | numerical index |
  | `$theme[$foo]` | `index` | dynamic (value of `$foo` is the key) |

  `index` is reserved for dynamic/numerical lookups. Variable/property/index all
  render `[key]` on a target; `declaration` renders `.key`. The key node's form
  (bare / quoted / num / `$var`) makes them visually distinct.
- **Expressions `$( … )`:** one Expression node wrapping an arithmetic/comparison
  tree. Binary operators REQUIRE surrounding whitespace (`1 + 2`, `5 % 2`); glued
  `$(1+2)` / `$(5%2)` are NOT operations (that's Less — convert-Less spaces them
  out). `50%` glued = percent Dimension; `5 % 2` spaced = modulo. Bare ident
  inside `$()` = keyword literal; `$x` = reference.

## Core change made by this build
- `reference.ts` `writeSyntax` `case 'variable'`: a variable lookup WITH a target
  now renders `[key]` (was `.$key`, which is not a valid Jess form). Verified
  safe: no test relied on `.$key`; core reference 210/210 pass; the 5 less-parser
  failures are pre-existing on `dev` (confirmed by reverting this change).

## Macro-buildability (parseman)
- parseman is the LOCAL `~/git/oss/parser-thing` **0.15.0**, linked via root
  `pnpm.overrides` + a root devDep (npm's 0.14.0 is NOT used). `pnpm install` to
  apply; rebuild its dist (`cd ~/git/oss/parser-thing && pnpm build`) after editing.
- **Build guard**: `pnpm check:macro` (`scripts/check-macro-buildable.mjs`, wired
  into `ci`) builds all four parsers in dep order and FAILS if any emits an
  interpreter fallback (`_rp[N].parse` in the built bundle) or a compose/rules
  parseman warning. All four currently: 0 fallbacks.
- **"lower" vs `RegExp.exec`**: a regex *lowers* when it compiles to a tight
  `charCodeAt` scan; otherwise it falls back to `RegExp.exec` (still compiled — an
  accepted path, NOT a failure). parseman now warns (default on) on every
  un-lowered regex, showing the pattern; suppress with the plugin option
  `warnUnloweredRegex: false`. (~700 across the parsers — mostly lookahead /
  lookbehind / `i`-flag / escape-heavy patterns that can't scan.) The real
  regression signal is the interpreter fallback, which the guard covers.
- NEVER put a literal U+FFFF char in a grammar regex — write the `-￿`
  escape (Edit can't match the literal char; use perl/python to fix).

## Known quirks (serialized AST is correct; toString cosmetic)
- Space-separated value lists (`1px solid red`) round-trip via toString as
  `1pxsolidred` — inherited css-parser behavior; the serialized AST is clean.
- `$(1 > 2)` round-trips as `$((1 > 2))` — `Condition.toString` adds its own
  parens; serialized AST is correct.
