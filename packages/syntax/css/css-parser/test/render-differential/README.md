# CSS render differential

Does a change to the CSS grammar move the **emitted CSS bytes**?

That is the whole question. Not "does the CST look different", not "do the tests
still pass" — does the stylesheet jess writes out change, over a corpus that
actually contains the construct under change.

## Why it exists

`docs/design/RESOLVED-SEMANTICS-AND-NAMING.md` §12.1 wants the `calc()`
precedence ladder (`CalcValue` / `CalcProduct` / `CalcSum`) to stop contributing
CST node names — `Atom`, `Product` and `Sum` are how precedence is written in a
PEG, not things an author writes. It is blocked on one sentence:

> Collapsing is not free: it moves the CST for every calc input … and the css
> differential to gate it does not exist yet.

This is that differential.

The parsers' existing `test/oracle-byte-identity.mjs` (Less, SCSS) cannot answer
it. Those digest **parse output**, so they move whenever a node name moves —
which is precisely the thing a ladder collapse is supposed to do. A gate that
fires on the intended change is not a gate.

## Running it

```sh
# the ratchet, against src, no rebuild — this is what CI runs
cd packages/syntax/css/css-parser && pnpm test render-differential

# the same measurement against the BUILT artifact
pnpm --filter @jesscss/css-parser build
node packages/syntax/css/css-parser/test/render-differential.mjs

# deliberate rebaseline
node packages/syntax/css/css-parser/test/render-differential.mjs --write
```

### Seeing what moved

The baseline stores a 16-hex fingerprint per file, not the output — 750 kB of
Bootstrap CSS per side is not something to commit. When you need the bytes, take
a snapshot on each side:

```sh
JESS_CSS_DIFF_SNAPSHOT=/tmp/before pnpm test render-differential
# …make the grammar change…
JESS_CSS_DIFF_SNAPSHOT=/tmp/after  pnpm test render-differential
diff -ru /tmp/before /tmp/after
```

The `.mjs` entry does the same against `lib`, and prints the unified diffs
itself:

```sh
node .../render-differential.mjs --snapshot /tmp/after --against /tmp/before
```

## What is in the corpus

| bucket | n | what |
| --- | --- | --- |
| `fixture` | 13 | hand-built, one file per axis of the ladder |
| `repo` | 102 | every in-tree `.css` input and expected output |
| `bootstrap` | 4 | Bootstrap 5.3.8's shipped stylesheets |

Breadth alone does **not** make a differential sensitive, and this repo has the
receipt: at `bb0b243f9`, removing `IdentBlock` from CSS's `Value` broke 7 of 10
bridge fixtures while leaving **both** Less byte-identity aggregates unmoved,
because neither aggregate contained the construct. A 400-file real-world corpus
contains a few dozen `calc()` sites, nearly all of them the same two shapes.

So the fixtures carry the depth: precedence, left-associative folding, paren
nesting to five levels, nested `calc()`, the whole css-values-4 §10 function
family, the `CalcSequence` space-run rung with authored separators, unit mixing,
one line per `CalcValue` arm, at-rule preludes, custom properties, sign and
whitespace spellings, real-world shapes, and one file of §10.1 violations that
must keep being **rejected**. 128 of the corpus's 300 `calc(` sites are here.

## Three outcomes, three hash spaces

Following `identity-oracle/report.mjs`'s rule that a parse and a throw must never
share a hash space:

- `ok` — `OK:` + emitted CSS.
- `reject` — `ERR:parse:` + normalized error. A fact **about the grammar**, so it
  belongs in the digest: turning a rejection into a silent accept moves the
  contract as surely as changing a byte. 56 corpus entries are deliberate
  rejects (the `errors/` fixture directory, plus `calc-rejects.css`).
- `emitError` — `ERR:emit:` + normalized error. Parsed but would not serialize.
  In the digest, on its own counter, because reporting a tool failure as a
  grammar rejection is how a gate lies.

## Proof that it is sensitive

Three deliberate mutations of the ladder, measured against baseline aggregate
`34e352ae8254…`:

| mutation | aggregate | effect |
| --- | --- | --- |
| `CalcValue` loses its `g.Percentage` arm | `0f4c909af53a…` | **10 entries moved**, `ok` 63 → 55, emitted 606465 → 201064 bytes, incl. `bootstrap.css` |
| `CalcParen` stops building a paren node | `c304cf7b62f8…` | **6 entries moved** with *no* change in accept/reject; `bootstrap.css` 279480 → 279472 bytes |
| `foldOperation` folds right-associatively | `34e352ae8254…` | **unmoved** |

The first proves verdict-level sensitivity; the second proves *byte*-level
sensitivity, which is the one that matters — a differential that can only see
files flipping to a parse error is a parse gate wearing a render gate's name.

The third is not a failure of the instrument, it is a finding about the
pipeline: at CSS base an unoperated `calc()` is emitted in authored token order,
so the shape of the `Operation` tree is not observable in the output. An
emitted-byte differential can gate what jess *writes*; it cannot gate tree shape,
and it does not claim to.

## What it says about §12.1, as of `4955b414c`

Applying the proposed change — `{ collapse: true }` on `CalcValue`, `CalcProduct`
and `CalcSum`, replacing `CalcValue`'s `{ project: 0 }` — leaves the aggregate at
`34e352ae8254…`: **all 119 entries byte-identical, all 502 css-parser tests
green**. On this corpus the collapse is byte-safe.

Two caveats the instrument also surfaces, and neither is in the doc:

1. `collapse` elides a node only when it captured **exactly one** child, so the
   folding rungs survive whenever they actually fold. Measured on
   `a { width: calc(1px + 2px * 3) }`: `CalcProduct, CalcSum, CalcValue` before,
   `CalcProduct, CalcSum` after. `CalcValue` goes; the ladder does not. Less,
   which the doc records as leaking none, in fact still reports `MathProduct,
   MathSum` for the same input.
2. It is byte-safe *for css*. `jess-parser` carries a byte-for-byte port of the
   same family and is not measured here.

## What it does not cover

- **Only the `css` grammar.** `.less`, `.scss` and `.jess` carry their own ported
  ladders and are not measured here. `jess-parser` has a byte-for-byte port of
  this family (`CalcValue`/`CalcParen`/`CalcProduct`/`CalcSum`/`CalcSequence`);
  a change here needs the same measurement there.
- **Parse + serialize, not eval.** There is no `.css` parser plugin, so CSS never
  enters `Compiler`. This is the whole emitted-byte surface CSS has.
- **The `wpt-accept.json` / csstree corpus** (`test/css-corpus/`) is not included:
  those are parse-*verdict* vectors, many of them deliberate rejects, and they
  are already gated by `test/css-corpus/corpus.test.ts`.
