# CSS byte-identity oracle

Does a valid CSS file survive `parse` → `serialize` with **every byte intact**,
trivia included?

CSS is the superset base the other three dialects are copies of, so a byte the
CSS parser drops, invents, or reorders is a defect in all four. This is the
instrument `docs/architecture/parser/GRAMMAR-REVIEW-STANDARD.md` item 15 asks
for and §4 recorded as missing for `css-parser`.

## Running it

```sh
cd packages/syntax/css/css-parser && pnpm oracle:byte-identity
# or, as part of the package suite
cd packages/syntax/css/css-parser && pnpm test
```

## Why it is not the render differential

`test/render-differential/` answers a different question — *did the emitted
bytes move since the committed baseline?* That is **relative**. It needs a
before-state, it cannot say whether either state was correct, and a rebaseline
makes any output correct by construction.

This oracle is **absolute**. The input IS the expected output. There is no state
in which a wrong answer is green and there is no `--write`.

They are complements, and the real-world corpus builder
(`render-differential/corpus.mjs`) is **shared, not forked** — two builders over
the same stylesheets would drift, and that one already throws on a missing root,
an unresolvable Bootstrap, or an empty bucket.

## `collapseNesting: false`

`serialize`'s default (`true`, the 4.x behaviour) flattens authored blocks into
composed selector strings. That is a deliberate semantic transform, so
byte-identity under it is not a meaningful question. `false` — the Less v5
default — preserves authored blocks, and is also what makes the oracle sensitive
to the defect class it exists for: a nested rule swallowed into a `Declaration`
is only visible as missing bytes while nesting is still emitted as nesting.

## Two channels

| channel | n | what |
| --- | --- | --- |
| `authored` | 19 | hand-written CSS already in the form `serialize` emits, one file per construct axis. The strongest form: an author's file round-trips byte for byte. |
| `emitted` | 63 | every real stylesheet in the render-differential corpus (Bootstrap 5.3.8 ×4, in-tree CSS, calc fixtures) run through the parser once; its **output** becomes the corpus entry, and the same unmodified question is asked of that. |

The `emitted` channel exists because real-world CSS is not written in jess's
canonical form, so it cannot be the input side of a literal test — and
normalizing it until it could would be bending the oracle until it passes.
Running it through once and asserting the result is a **fixed point** needs no
baseline and no normalization, and carries the breadth the authored half cannot.
56 of the 119 real files are deliberate rejects (`errors/`, `calc-rejects.css`)
and are excluded from `emitted` rather than counted as round-trip failures.

The authored set is **named** (`AUTHORED_FILES` in `corpus.ts`), not globbed. A
count cannot tell "a file was added" from "a file silently dropped out". The
loader throws if a named file is missing, and throws again if the directory
holds a `.css` the list does not name.

## The negative controls

A green run from an oracle that visited zero files looks exactly like a green
run from one that visited all of them. Four controls are **asserted in the
suite**, on every invocation:

0. the corpus is non-empty and every named file was visited;
1. a surface that **drops a nested rule** — the ident-start defect's signature,
   where a `Declaration` swallows the block after it — is caught, on
   `nesting-qualified-rule.css`, as `divergent` with a byte offset;
2. a surface that changes **one byte of trivia** is caught, so the oracle is
   shown byte-sensitive and not merely structure-sensitive;
3. a surface that reproduces the input exactly is **not** reported as failing —
   without this, controls 1 and 2 would also pass on an instrument that scores
   everything as broken.

Controls 1 and 2 mutate the **surface**, never the grammar. A control that
edited a production would be a grammar change wearing a test's name.

## Open findings

Four authored files do not round-trip today — three `open`, one `settled`. They
are recorded one per file in
`../byte-identity.divergences.json` with the construct and the reason, and the
ratchet compares the failing set to that record **by name** — a file that starts
diverging fails, and so does a file that stops, which forces the record to be
deleted rather than left to rot.

That file is a **record, not an allowlist**. Nothing in it has been ruled
correct:

- `at-rule-namespace-url.css` — `@namespace url(…)` is a parse error, though a
  `<url>` prelude is valid per css-namespaces-3 §2.
- `selector-attribute-case-flag.css` — `[a^="y" i]` emits as `[a^="y"i]`. The
  string and the flag stay two tokens, so this is a byte difference and not a
  change of meaning. Its **unquoted** sibling was neither: `[a=y i]` emitted as
  `[a=yi]`, one fused ident matching a disjoint set of elements. That is fixed,
  and `selector-attribute-unquoted-flag.css` pins it.
- `value-slash-separator.css` — `12px/1.5` emits as `12px / 1.5`; a collision
  between two settled v5 rules rather than a suspected defect.

`empty-blocks.css` is recorded separately as **settled**: empty-block elision is
deliberate and cited, so the fixture stays to catch the day it silently stops.

## What it does not cover

- **Only the `css` grammar.** `.less`, `.scss` and `.jess` carry their own ported
  productions and are not measured here.
- **Not tree shape.** Two different trees that emit the same bytes are
  indistinguishable to this oracle, exactly as they are to the render
  differential. That is the render differential's own recorded limitation and it
  applies here unchanged.
- **Not formatting-preserving round-trip.** `serialize` is a normalizing
  pretty-printer, and the CST retains whitespace as spans rather than as data, so
  no verbatim serialization surface exists in this package. Byte-identity is
  therefore asked of CSS already in canonical form. Blank lines between rules,
  for one, are not reproduced.
