# `.jess` parent selector (`&`) — design

Design only. No `&` implementation lands with this document.

`&` is currently a **parse error** in the `.jess` direct-AST route. The exclusion is
asserted by `packages/jess-parser/test/ast-grammar.test.ts` ("keeps selector forms
without a faithful direct template reduction out of the route"), which says
parent-selector templates "stay out until they have a dedicated semantic reduction
rather than being treated as static text". It blocks the `nested.jess` fixture and
the `&` half of `docs/jess/03-Features/02-nesting.md`.

The conclusion of this document: **for the plain forms there is nothing to design.**
Less already answered the question, core already owns the semantics, and the `.jess`
delta is a terminal plus two choice arms. The genuinely-undesigned part is the
parenthesized `&()` / `&(nil)` template family, which is unimplemented in *every*
dialect and is scoped separately below.

## 1. What "dedicated semantic reduction" meant

The phrase is not `.jess`-specific. It was written for the whole direct-AST cutover
(`6734da512`, which introduced both the `.jess` exclusion test and the Less
ampersand terminal) and it is defined by what Less did four commits later.

`d18c4bfe3` ("feat(less-parser): structure parent selectors") recorded the intent in
`HANDOFF.md` verbatim:

> - Architecture surface: a parser-local recognition terminal feeds canonical
>   `Simple.text` construction. Core's existing compound ampersand composition
>   consumes that text. No CST reuse, host, bridge, Context/plugin work, scanner,
>   or reparse is added.
> - Separation/duplication: the terminal is semantically equivalent to the
>   production `ampToken`. Parenthesized/interpolated ampersands remain rejected
>   until grammar reductions can carry their typed semantics.
> - Verdict: accepted cold direct construction; typed dynamic ampersand forms are
>   explicitly deferred rather than recovered as text.

And the grammar comment it landed (`packages/less-parser/src/ast/grammar.ts:1406`):

> Semantically identical to the production Less `ampToken` terminal. A static
> ampersand is already the canonical AST representation: `SimpleSelector.text`
> retains `&` and core's selector path identifies parent references from that text.
> The parenthesized and interpolation forms stay outside this direct static slice
> until their typed semantic payloads are constructed by grammar reductions.

So the rejected alternative was never "`SimpleSelector.text === '&'`". It was:

- routing `&` through a **generic raw/opaque selector-text fallback**, i.e. letting a
  catch-all "unrecognized selector bytes" arm swallow it, so the parser would not
  know a parent reference was present; and
- claiming the **parenthesized / interpolated** forms (`&()`, `&(nil)`, `&@{x}`)
  under that same text arm, where their payload has nowhere typed to live.

`SimpleSelector.text = '&'` produced by a **dedicated terminal** *is* the dedicated
semantic reduction. The `.jess` exclusion is therefore stale for the plain forms: it
was written before Less demonstrated the reduction, and was never revisited.

## 2. The AST shape `.jess` should produce

Core recognizes a parent reference **purely from resolved token text**, with no node
type, flag, or dialect hook. `packages/core/src/ast/nodes.ts:518`:

```ts
export const compoundHasAmpersand = (c: CompoundSelector): boolean => {
  for (const sim of c.simples) {
    if (sim.type === 'PseudoSelector') {
      if (pseudoCanonical(sim).includes('&')) { return true; }
      continue;
    }
    if (sim.text?.includes('&') === true) { return true; }
    if (sim.interp !== null) {
      for (const part of sim.interp.parts) {
        if ('lit' in part && part.lit.includes('&')) { return true; }
      }
    }
  }
  …
```

and `packages/core/src/ast/serialize.ts:3781` (`resolveTokenAmp`) resolves on
`resolveSimpleText(sim)` then `text.includes('&')`.

So the required `.jess` output is exactly the Less output:

| authored | AST |
| --- | --- |
| `&` | `SimpleSelector { text: '&', interp: null }` |
| `&-primary`, `&__el`, `&1` | `SimpleSelector { text: '&-primary', interp: null }` |
| `[foo]&` | compound `[ SimpleSelector{text:'[foo]'}, SimpleSelector{text:'&'} ]` |
| `& + &` | complex with `&` head compound and a `+` tail compound |
| `:not(&)` | `PseudoSelector { name: ':not', args: SelectorList([… text:'&' …]) }` |
| `&$[name]` | `SimpleSelector { text: null, interp: Interpolation([{lit:'&'}, {ref}]) }` |

The last row is the `.jess` spelling of Less's `DirectLessInterpolatedParentSuffix`
(`grammar.ts:4308`), which fuses `&` + interpolation into ONE
`interpolatedSimpleSelector`, not two compound members. `compoundHasAmpersand`'s
`part.lit.includes('&')` branch already exists precisely to serve it.

### Grammar delta

`packages/jess-parser/src/ast/grammar.ts` today builds simple selectors from the
shared CSS terminal only:

```ts
const DirectJessSimple = node<SimpleSelector>(
  'DirectJessSimple', g.CssAstSyntaxSimple,
  children => simpleSelector(requireToken(children[0]).value)
);
```

The delta mirrors Less one-for-one:

1. A parser-local terminal, `const jessAmpersand = regex(/&[-_a-zA-Z0-9\u0080-\uffff]*/)`
   — identical to `staticAmpersand` in `less-parser`. It covers bare `&` and every
   glued BEM/suffix form in one token, so nothing has to re-scan or re-join.
2. Add it as an arm to `DirectJessCompound` **and** `DirectJessStaticCompound`
   (a `&` inside `:not(…)` reaches the static family), leading with the concrete
   `&` first char so first-set gating is preserved.
3. A `DirectJessInterpolatedParentSuffix` for `&$[name]…`, ordered before the plain
   terminal, reducing to `interpolatedSimpleSelector`.
4. Root-level `&` (`& { … }` at document level, which the fixture uses) needs the
   document statement route to admit a rule whose selector head is `&`. Less's
   direct route already permits it; verify rather than assume.

No core change. No new node type. No new `Rule` field.

## 3. Should `.jess` `&` differ from Less `&`?

**No — and it cannot, by construction.** Both dialects hand core the same
`SimpleSelector.text`, and every semantic decision lives in one place:

- `ampSub` (`serialize.ts:3766`) — a bare LEADING `&` over multiple parents wraps
  once in `:is(a, b)`; a single parent substitutes bare.
- `resolveTokenAmp` (`:3781`) — position-aware: a list-accepting pseudo
  (`:is`/`:where`/`:not`/`:has`/`:matches`) whose args contain `&` recurses so `&`
  becomes the **bare parent list** inside the pseudo (`:not(&)` over `.a, .b` →
  `:not(.a, .b)`, not the De-Morgan-wrong `:not(.a), :not(.b)`); every other `&` —
  fused append (`&__el`) or merged-after-a-name (`[foo]&`, `.fruit-&`) — is a name
  concatenation and **distributes** per parent.
- `resolveCompoundAmp` / `resolveComplexAmp` / `resolveSelectorListAmp` (`:3799`,
  `:3821`, `:3852`), `composeOne` / `composeHeader` (`:3862`, `:3897`).

Observed today through the Less route with `output.collapseNesting: true`:

```
.a, .b { & + & { … } }   →  :is(.a, .b) + :is(.a, .b)
.a, .b { &.c   { … } }   →  :is(.a, .b).c
.a, .b { & .c  { … } }   →  :is(.a, .b) .c
.a, .b { .c &  { … } }   →  .c :is(.a, .b)
.a     { :not(&) { … } } →  :not(.a)
.a, .b { &     { … } }   →  .a,\n.b
.button{ &-primary{…} }  →  .button-primary
```

That is CSS-Nesting-spec behaviour, which is the owner's standing rule: selector
reference `&` MUST be spec-faithful; the glued `&__el` / `&--mod` BEM concat is the
intentional exception, and it is the `parents.map(p => text.split('&').join(p))`
distribution branch. Adding a `.jess`-only rule here would be a divergence bug, not
a feature.

The one thing `.jess` inherits for free and should be tested explicitly: with the
`.jess` default `collapseNesting: false`, `&` is **preserved verbatim** in nested
output and only resolves when a boundary collapses. That is already how the Less
route behaves and needs no new code — only fixtures.

## 4. `&()` / `&(nil)` — a separate, larger feature

These are *not* incidental. `docs/jess/03-Features/02-nesting.md` defines three
explicit parent forms:

- `&` — render the parent normally
- `&()` — render the parent, but **hoist this selector to root**
- `&(nil)` — **do not render the parent at all**
- `&(X)` is a template slot: `&-primary` ≡ `&(-primary)`
- the Less spelling of the null parent is `&('')`, not `&(nil)`

They appear in the excluded `.jess` test only as the *rejection* set, and they are
**rejected by `less-parser` too** — `.button { &() .icon { … } }`, `&(-primary)`,
`&(nil).utility` and `&('')` all fail `less-parser`'s public `parse()` today. So
there is no dialect where they work, and no shipped semantics to match.

Why they are a real design problem and not a grammar arm:

- `&()` is an **output-placement** instruction, not a selector-text instruction. It
  says "compile this rule's selector fully and emit it at root" — meaningful only
  because `.jess` output is nested by default. Nothing in `Rule` carries that today;
  it would need a typed field on `Rule` (or a dedicated selector node), and core's
  emit path would have to honour it. `SimpleSelector.text` cannot express it,
  because text is exactly what core substitutes into.
- `&(nil)` suppresses the parent for a branch. `resolveTokenAmp` has no
  "drop the parent" outcome; it maps a token to one-or-more resolved strings.
- `&(X)` is pure sugar for `&X` once the other two exist.

Recommended scoping: land plain `&` first (§2), and treat the template family as its
own design with its own owner ruling — specifically whether `&()`/`&(nil)` become
typed fields on `Rule` or a `ParentSelector` value node, and whether Less gains
`&('')` at the same time. Until then the docs banner should be **narrowed**, not
deleted, to say the templates are the unimplemented part.

## 5. Effort, risk, byte-identity

**Effort — plain `&` (§2): small.** One terminal, two compound arms, one
interpolated-suffix production, plus root-level admission. Directly modelled on
`less-parser` lines 1411 / 4308 / 4419. Tests: replace the exclusion assertion with
acceptance, restore `packages/jess/test/files/nested.jess` from `17403a0a0~1`
(its `&` set is `&:hover`, `[foo]&`, `& + &`, root `&`, `&, &` — all plain forms),
and add collapsed-output assertions mirroring the table in §3.

**Effort — templates (§4): large and blocked on an owner ruling.** Do not bundle.

**Risk: low.**

- No core edit, so no risk to the Less corpus.
- The `&` terminal has a concrete first char, so it does not widen any other arm's
  first-set. The only ordering care needed is the interpolated-suffix arm before the
  plain terminal (same order Less uses).
- The one real widening is intended: `&` stops being a parse error in `.jess`.

**Byte-identity: yes, trivially.** No existing `.jess` corpus contains `&` — it is a
parse error today, and the fixture that used it was rewritten in `17403a0a0` to
remove it. Every currently-passing `.jess` byte stays byte-identical; the diff is
previously-failing → passing. The Less/SCSS/CSS corpora are untouched.

**Docs to update when it lands:** the `:::caution` banner at the top of
`docs/jess/03-Features/02-nesting.md` narrows from "`&` is not in the `.jess` parser
yet" to "the `&()` / `&(nil)` templates are not implemented in any dialect yet".
