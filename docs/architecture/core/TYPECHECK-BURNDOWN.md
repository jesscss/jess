# Typecheck Burn-Down

Tracks removal of `--noCheck` from every package's `compile` script.

- **DONE-CRITERION:** every package's build typechecks clean **without
  `--noCheck`** — i.e. `tsc -p tsconfig.build.json --emitDeclarationOnly`
  reports **0 errors**. At that point the flag is dropped from that package's
  `compile` script.
- Do **not** "fix" by suppressing. `as any` / `: any` / `@ts-ignore` /
  `@ts-nocheck` are banned by the project's ABSOLUTE rules, and a type widened
  until the error disappears is the same thing wearing a different hat. If an
  error can only be silenced rather than fixed, leave it and record it here.
- A fix must not change runtime behavior. If one does, that is a real bug the
  types had been describing incorrectly — report it separately and loudly.

## Why this matters

`--noCheck` makes `tsc` emit declarations without typechecking, so **a type
error in a grammar fails nothing**. The cost is not hypothetical: parseman 0.44
removed `RunResult.triviaMap`, a non-optional field. `tsc` catches that
instantly — toggling only the dependency produced exactly one new error:

```
src/index.ts(92,47): error TS2339: Property 'triviaMap' does not exist on type 'RunResult'.
```

With `--noCheck` it never surfaced. It appeared a day later as
`Cannot read properties of undefined (reading 'labels')` and took six of nine
gates red (css 273→62, less 505→291, scss 310→114, jess 267→59, all-less
109/110 → 20/110). **A type error in a grammar is a runtime bug that has not
happened yet.**

## Status

Measured on the full workspace built in dependency order (`pnpm run
build:release`) so cross-package imports resolve to real `.d.ts` — otherwise
`TS2307 Cannot find module` floods the count with false positives. Compiler is
the workspace-pinned `typescript@7.0.1-rc` that `compile` invokes.

**23 of 25 packages are clean and have had the flag removed.**

| Package | Errors | `--noCheck` |
|---|---:|---|
| `@jesscss/scss-parser` | 342 | still set |
| `@jesscss/jess-parser` | 403 | still set |
| *all other 23 packages* | **0** | **removed** |

Cleared in this burn-down: the eight packages already at zero
(`awaitable-pipe`, `compiler-preset`, `styles-config`, `core`,
`jess-plugin-js`, `parser-shared`, `rollup-plugin-jess`, `style-resolver`),
then `diagnostics-core`, `language-service`, `lint`, `css-parser` (31→0) and
`less-parser` (756→0).

The earlier inventory in this file's history is superseded: it predated the
`packages/syntax/**` reorg and listed `@jesscss/core` at 136 errors. Core is now
**0**. Re-measure rather than trusting any count written here.

## The dominant root cause — ONE mistake, ~1500 errors

Nearly every parser error is a single overload-resolution failure repeated per
call site. parseman's named-node overload is:

```ts
node<N, const Type extends string, const Tags extends readonly string[] = …>(
  type: Type, combinator: Combinator<unknown>, build?: BuildNode<N>, opts?: NodeOptions<Tags>
): NodeCombinator<N, Type, Tags[number]>
```

`N` and `Type` are both non-defaulted. TypeScript has no partial type-argument
inference, so writing `node<ValueNode>('MathAtom', …)` — one explicit argument
for a two-argument list — makes that overload **inapplicable**. Resolution falls
back to the *unnamed* `node<N>(combinator, build?, opts?)` form, and then:

- the node-name string lands in the combinator slot → **TS2345**
  (`Argument of type 'string' is not assignable to parameter of type 'Combinator<unknown>'`)
- the reducer's parameters go untyped → **TS7006** (one per parameter)
- a 4-argument call exceeds the fallback's arity → **TS2554**
  (`Expected 1-3 arguments, but got 4`)

Minimal repro (verified):

```ts
node<Fact>('Name', regex(/a/), children => …)         // TS2345 + TS7006
node<Fact, 'Name'>('Name', regex(/a/), children => …) // clean
node<Fact>(regex(/a/), children => …)                 // clean (unnamed overload)
```

**Fix: drop the redundant type argument** so both parameters infer —
`node('Name', combinator, reducer)`. That is already the dominant idiom in the
grammars, so this makes the files smaller and more uniform, not less typed.

This is safe to do mechanically. The parseman macro compiler never reads type
arguments (`grep -c typeArguments` over `parseman/dist/plugin/index.js` → `0`;
it only *strips* TS wrapper nodes), and the runtime `node()` is a single
function that dispatches on `typeof arg0 === 'string'`. Verified empirically by
running the real macro compiler over the before/after grammar and diffing the
lowered output: after normalizing content-hash identifier prefixes, **zero bytes
differ in any generated regex table, first-set table, or compiled parse
function**.

### The second-order finding — this is the part that matters

The explicit type argument was also pinning literal types. Removing it exposes a
**genuine, previously invisible class of defect**: reducers that hand-build a
node or fact object widen their discriminant field —

- `return { type: 'Plugin', … }` infers `type: string`, not `'Plugin'`
- `{ keyKind: 'index', … }` infers `keyKind: string`
- `{ g: 'not', inner }` infers `g: string`

so the rule **no longer satisfies the declared rules interface** (`LessRules`,
`ScssRules`, `JessRules`). The fix is to annotate the reducer's return type,
which is what the type argument was trying to express in the first place:

```ts
(children): InterpolationAccessorFact => { … }
```

This is exactly the check `--noCheck` was suppressing: **a reducer's shape must
match what the AST constructor expects.** In `less-parser` this surfaced 8
distinct rules whose declared and actual types had silently diverged.

Recommended order for the remaining parsers: strip the type arguments first,
then fix the interface mismatches the strip reveals, one rule at a time — `tsc`
reports only one incompatible property per pass, so expect to iterate.

## Remaining work

`scss-parser` (342) and `jess-parser` (403) — same root cause, same shape:

| Package | TS7006 | TS2345 | other |
|---|---:|---:|---|
| `scss-parser` | 180 | 162 | — |
| `jess-parser` | 226 | 176 | 1× TS2339 |

Both also have a rules-interface divergence already visible in the error text,
each of which is a real bug rather than a typing nit:

- **scss** — `ModuleDirective` produces `Combinator<[string, ModuleImport | StyleImport]>`
  but `ScssRules` declares `Combinator<ModuleImport | StyleImport>`: a
  `sequence(...)` is escaping unreduced, so the tuple, not the node, is the
  rule's value.
- **jess** — `IdentifierOrFunction` produces
  `Combinator<[string, FunctionCall | Keyword | Url]>` against a declared
  `Combinator<ValueNode>`, with the same tuple-not-reduced shape.

## Landing

Drop `--noCheck` from a package's `compile` script the moment its count reaches
zero; land per package rather than holding one big change. Grammar edits get the
`grammar-reviewer` and the perf gate — for a type-only change the cheapest
decisive evidence is the macro-lowered-output diff described above, which is
stronger than a benchmark run.

Do not close the burn-down until every package is at 0 with the flag removed.
