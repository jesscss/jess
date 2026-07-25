# Queued: `packages/*` naming and cleanup

Status: **QUEUED.** Phase 0 can land any time. Phases 1–3 wait for the grammar
work to quiesce (see "When this runs").

This supersedes the earlier version of this document, which proposed grouping
`packages/*` into `syntax/`, `editor/`, and `docs/` subdirectories. That proposal
is **withdrawn** — see "Withdrawn: the directory grouping". What survives from it
is the blast-radius analysis and the de-hardcoding prerequisite, both reused
below.

## The premise that turned out to be wrong

The complaint that started this was that folder names don't say what packages
are. Most of that complaint dissolves on contact with the data: **folder names
are not npm names**, and the npm names are already fine.

```
packages/jess-plugin-less        →  @jesscss/plugin-less
packages/jess-plugin-less-compat →  @jesscss/plugin-less-compat
packages/vscode                  →  @jesscss/vscode-extension
packages/_shared                 →  @jesscss/shared
packages/docs                    →  jess-docs
packages/config                  →  styles-config
```

Module resolution, the publish allowlist (`scripts/release/alpha-allowlist.json`),
and every import in the repo key off the npm name. The `@jess/*` → `./packages/*/src`
wildcard in `tsconfig.json:19` is the one folder-keyed alias, and it has **zero
uses** anywhere in `packages/` or `scripts/`. So a folder rename changes no
dependency edge and no build behaviour; it only changes path literals in tooling.

Two further premises were wrong outright:

- **`packages/parser` and `packages/parser-runtime` do not exist.** Neither is a
  directory. `packages/parser` survives as a dead `tsconfig.json:27` path entry
  and two `.cursor/rules` files (`packages/parser.mdc`, and
  `domains/parsers.mdc:7,42`) that glob and describe a package that isn't there.
  "Parser runtime" is a *boundary* enforced by
  `scripts/verify-parser-runtime-boundary.mjs`, not a package.
- **"961 lint violations in 279 lines" is not reproducible.** Running the repo's
  own lint invocation (`package.json` `lint`) against
  `packages/internal-css-recognition/src` returns 0 errors, 0 warnings, 0
  suppressed, exit 0, across all three files — verified twice, independently.
  The files are genuinely linted, not ignored. For contrast `less-parser/src`
  has 3 real errors. 279 is the true LOC of `recognition.ts`; the 961 is not a
  number this repo produces. The case for renaming that package has to be made
  on other grounds, and it can be — see below.

## What each package actually is

Read from source, not from names or READMEs. LOC is `src/` only.

### Engine and runtime

| Folder | npm | What it actually is |
| --- | --- | --- |
| `core` | `@jesscss/core` | One package, two engines side by side. `src/tree/` = 64,960 LOC legacy runtime; `src/ast/` = 17,642 LOC AST-v2. Three entry points: `.`, `./value`, `./ast`. Majority-legacy by volume despite AST-v2 being the forward path. |
| `fns` | `@jesscss/fns` | The built-in function library, ~200 files / ~4,200 LOC, split `less/` vs `sass/` vs `shared/` with no merged set. `registry.ts` builds an `FnRegistry` from a dialect index. |
| `awaitable-pipe` | `@jesscss/awaitable-pipe` | Genuinely generic sync/async utility (494 LOC): `pipe`/`safePipe` stay synchronous until a step returns a thenable. `MaybePromise<T>` is imported by 60+ files in `core`. Zero jess deps, and the name is accurate. |
| `style-resolver` | `@jesscss/style-resolver` | Not generic despite zero deps: `@import`/`@use` extraction and Less/SCSS import-path candidate expansion (193 LOC). Achieves dependency-freedom by re-declaring its own local `StylesConfig` shape rather than importing `styles-config` — decoupling by duplication. |
| `config` | **`styles-config`** | The config schema (`StylesConfig`, `LessOptions`, `ScssOptions`, the mode unions) plus the cosmiconfig loader and glob-scoped option merging. 762 LOC. Consumed by `jess` and `jess-plugin-less`. |
| `patch-css` | `@jesscss/patch-css` | 71 LOC of browser-only HMR: injects a `<style>` and mirrors sheets into `localStorage`. **Nothing imports it** — its only reference is the dependency line in `packages/jess/package.json`. Published. |
| `_shared` | `@jesscss/shared` | **Not shared runtime code.** One 124-line file of hardcoded Less-fixture path allowlists (`invalidLess`, `invalidCSSOutput`, `notSameSerialized`). The directory *also* holds the `tsconfig.json` / `eslint.config.mjs` that siblings extend — a second, unrelated job. Declared as a dep by `less-parser`, `css-parser`, and `language-service`, none of which import it; the sole real import is `packages/jess/test/less/all-less.test.ts:5`. |

### Parsers

| Folder | npm | What it actually is |
| --- | --- | --- |
| `internal-css-recognition` | `@jesscss/internal-css-recognition` | 368 LOC of flat parseman `regex()` **terminals**, in three `rules()` maps — `cssAstSyntax` (50 CSS lexical leaves), `lessAstSyntax` (27), `cssAstPseudoSyntax` (6) — plus `opaqueAtRuleRecognition` (6 balanced-capture rules). No AST construction, no reducers, no `g.` cross-references (a reference would drop the artifact to the interpreter). All four grammars `composeLeaf` it. Private, `v0.0.0`, never published. |
| `css-parser` | `@jesscss/css-parser` | Base CSS grammar, `src/ast/grammar.ts` 2,173 lines. |
| `less-parser` | `@jesscss/less-parser` | Less grammar, 4,750 lines. Consumed by `scss-parser`, `language-service`, `plugin-less`, `plugin-less-compat`. |
| `scss-parser` | `@jesscss/scss-parser` | SCSS grammar, 3,298 lines AST + an 844-line legacy CST grammar still present. |
| `jess-parser` | `@jesscss/jess-parser` | `.jess` grammar, 3,703 lines. |

### Plugins

| Folder | npm | What it actually is |
| --- | --- | --- |
| `jess-plugin` | `jess-plugin` | **Dead.** 14 LOC: a `PluginOptions` type, an identity `definePlugin`, and a default export. Not a base class — the real base is `AbstractPlugin` in `core`. Zero importers, no tsconfig path, still declares a `chevrotain` dep after `f899373fe` retired Chevrotain, still on `tsc -b` while every sibling moved to `tsdown`. Its description ("The stylesheet engine for Jess") is wrong. |
| `jess-plugin-css` | `@jesscss/plugin-css` | 30 LOC: wraps `css-parser` into an AST-v2 `Stylesheet`. |
| `jess-plugin-jess` | `@jesscss/plugin-jess` | 29 LOC, same shape over `jess-parser`. |
| `jess-plugin-scss` | `@jesscss/plugin-scss` | 66 LOC over `scss-parser` + `style-resolver`. |
| `jess-plugin-less` | `@jesscss/plugin-less` | The substantial one, 609 LOC. |
| `jess-plugin-less-compat` | `@jesscss/plugin-less-compat` | 54 LOC of source and **8 design/analysis markdown files** — docs outweigh code ~10:1. Now only injects native AST-v2 `Fn` values; Less 4 visitors and `@plugin` execution are explicitly unsupported. |
| `jess-plugin-js` | `@jesscss/plugin-js` | Not a small plugin: 2,250 LOC of sandboxed JS/TS execution over a **Deno subprocess worker** with a value-encoding bridge and permission flags. Resolved by `jess` at runtime, not statically. |
| `jess-plugin-node-modules` | `@jesscss/plugin-node-modules` | 226 LOC: the `import()` hook over `createRequire`, anchored at an optional `basePath`. |

### App, editor, docs

| Folder | npm | What it actually is |
| --- | --- | --- |
| `jess` | `jess` | The compiler façade + CLI host, 2,013 LOC src and ~11,700 LOC across ~75 test files (the Less/SCSS conformance corpus lives here). Top of the dependency graph. |
| `rollup-plugin-jess` | `rollup-plugin-jess` | 60 LOC Rollup integration. Not in the alpha publish allowlist. |
| `language-service` | `@jesscss/language-service` | The LSP engine + server, ~6,300 LOC, dual ESM/CJS build. Depends on all four parsers. |
| `vscode` | `@jesscss/vscode-extension` | The **live** VS Code client: 4 languages, 4 TextMate grammars, semantic tokens, e2e harness. |
| `extension` | `@jesscss/extension` | **Dead predecessor** of `vscode`. 42 LOC, no grammars, no `jess` language, no tests; points at `language-service/lib/server.js` (ESM — would fail to fork, which is exactly the bug `vscode` documents when it points at `server.cjs`). Last touched 2026-03-06. Zero importers. |
| `language-service-tests` | — | **Not a package.** One 7-line `README.md` stating an intent. No `package.json`, so the workspace glob skips it. |
| `docs-content` | `@jesscss/docs-content` | The canonical markdown corpus (140 doc files) plus its build tooling; emits `.site/jess` and `.site/less`. Its own README: edit here only. |
| `docs` | `jess-docs` | A Docusaurus **renderer** of `docs-content`'s jess facing. No docs of its own; still ships 3 stock Docusaurus template blog posts dated 2019. |
| `docs-less` | `@jesscss/docs-less` | A second Docusaurus renderer, Less-branded, plus a generated-and-committed `versioned_docs/version-4.x/` snapshot. Not vendored third-party — the 4.x content arrives through `docs-content/scripts/import-less-docs.mjs`. |

Root `docs/` and `packages/docs-content` do not overlap: root `docs/` is
dev-facing only and nothing in it is read by any Docusaurus config.

## `internal-css-recognition`

This is the one with a live consequence, so it gets its own section — but the
consequence is not the one assumed, and the rename is the smaller half of the fix.

**The name is wrong in two specific ways.** `internal-` carries no information
that `"private": true` doesn't already carry. And "recognition" oversells what
is there: the package shares *lexical leaves*, not productions. A reader who
takes the name at face value concludes the shared CSS surface already exists and
that composing from it is the default. `docs/architecture/core/PSEUDO-ARGUMENT-CONSOLIDATION-DESIGN.md:21-24`
records the gap in the owner's own words — it "shares only the LEXICAL leaves …
not the grammar composition, so the four copies drift and produce one-off 'valid
CSS parses in dialect A but not B' bugs."

**Duplication is real and measured.** Local `regex()` counts: css-parser 36,
less-parser 109, scss-parser 83, jess-parser 83. Byte-identical re-declarations
of leaves the package already exports include `blockComment` (four local copies),
the SCSS line comment (four), `hexColor` (two), `number`, `url(`, and the simple
selector (two, already **divergent** — less drops the `\d+%` alternative).
Keyframe `from|to` and the keyframe percent are copied 3–4× each in three
different spellings and were never shared at all. At-keyword recognizers for
`@layer`, `@supports`, `@scope`, and the generic at-rule name are duplicated
with *different exclusion lists* per dialect.

**But some duplication is forced, and a rename won't touch it.** The comment at
`packages/css-parser/src/ast/grammar.ts:587-592` documents why: a cross-composition
`g.` reference leaves a choice-arm's first-set unresolved, so a leading
recognizer must be a local copy to first-char-gate the arm. That is a parseman
constraint, not sloppiness. Any "compose, don't copy" rule has to carve this out
or it will be ignored.

**The discovery failure is structural, not just lexical.** The package is
absent from `guildhall.yaml` (which registers 26 of 29 package folders — this is
one of the four it misses). It has no `.cursor/rules/packages/*.mdc` file, while
21 other packages do. `.cursor/rules/domains/parsers.mdc` — the rule that fires
when an agent edits a grammar — does not mention it, still lists a nonexistent
`packages/parser` as "Jess CST parser/orchestrator" at `:42`, and still describes
the stack as Chevrotain-based. An agent editing `less-parser/src/ast/grammar.ts`
today is told nothing about a shared surface by any mechanism. **Renaming the
package will not fix that**, and fixing that is worth more than the rename.

**Proposal.** Rename the folder and npm name to `shared-css-grammar` /
`@jesscss/shared-css-grammar`. "shared" states the relationship the name
currently omits — that all four dialects fuse it. "css" states the base
language. "grammar" is chosen over the more accurate-today "terminals" or
"leaves" deliberately: the pseudo-argument consolidation design intends to move
*composed productions* in, and a name pinned to the current contents would be
wrong the day that lands.

Do it **with** these three, which cost less and matter more:

1. Add `internal-css-recognition` to `guildhall.yaml`.
2. Add it to `.cursor/rules/domains/parsers.mdc`'s globs and package list, and
   drop the dead `packages/parser` entries from `:7` and `:42` in the same edit.
3. Extend `scripts/verify-compose-integrity.mjs` to flag a local `regex()` in a
   dialect grammar that is byte-identical to an exported leaf, with an explicit
   inventory-style exemption for the first-set gating case above — the same
   shrinking-ledger pattern `verify-parser-runtime-boundary.mjs` already uses.
   This is what actually enforces the rule; the name only makes it memorable.

If the rename is judged not worth the import churn, do 1–3 anyway. They carry
the whole benefit.

## The other renames

**`styles-config` → `@jesscss/config`** (folder `config` unchanged). This is the
only npm name that actively misleads a *consumer*. It is a bare, unscoped,
generic name in the public registry that reads as a neutral cross-tool config
package — its own description name-checks Jess, Less, Sass, and Tailwind — while
it depends on `@jesscss/core` and encodes jess's mode unions. It is also the one
package whose folder name and npm name share no substring, so
`pnpm --filter` and a grep for `styles-config` find different things.

**`_shared` → split.** The underscore is the least of it: the package is two
unrelated things. Move the 124-line fixture allowlist to
`packages/jess/test/less/` where its only importer lives, and let the directory
be what the other four packages actually consume it as — the shared tsconfig and
eslint base. If it ends up holding only config bases, `packages/_shared` is a
fine name for that and needs no rename at all. Drop the three declared-but-unused
`@jesscss/shared` deps in `less-parser`, `css-parser`, and `language-service`
while you're there.

## Deletions, which beat every rename here

Three of the confusing names describe things that should not exist. Deleting
costs less than renaming and removes the confusion permanently.

- **`packages/jess-plugin`** — dead (see inventory). Delete. This single deletion
  resolves the "is the bare one a base class?" question the whole exercise
  opened with.
- **`packages/extension`** — dead predecessor of `packages/vscode`. Delete, and
  fix `docs/architecture/language-service.md`, which still documents it as the
  client.
- **`packages/language-service-tests`** — a 7-line README that is not a package,
  yet is named in `CLAUDE.md` and `.cursor/rules/domains/language_tooling.mdc`
  as though it were. Delete the directory or drop the references; do not leave
  both.

Alongside those, four dead references worth removing in the same pass:

- `tsconfig.json:27` — `@jesscss/parser` → `./packages/parser/src/index.ts`,
  a path that does not exist.
- `tsconfig.json:19` — the `@jess/*` wildcard, zero uses repo-wide.
- `.cursor/rules/packages/parser.mdc` — an entire rule file for a nonexistent
  package.
- `.cursor/rules/domains/parsers.mdc:7,42` — as above.

## What NOT to rename

- **Every `@jesscss/plugin-*`, `@jesscss/*-parser`, `@jesscss/core`, `@jesscss/fns`,
  `jess`.** These are accurate and all 19 are published. A rename is a breaking
  change for alpha consumers and buys nothing.
- **`packages/jess-plugin-*` folders.** The `jess-` prefix is redundant against
  the `@jesscss/plugin-*` npm names, but the folders are import-invisible and
  renaming them churns ~40 path literals across `scripts/`, `.cursor/rules/`,
  `guildhall.yaml`, and `CLAUDE.md` for zero functional gain.
- **`awaitable-pipe`, `patch-css`, `style-resolver`.** Accurate names.
  `patch-css` has a different problem — zero importers while being a published
  hard dep of `jess` — which is a dependency question, not a naming one.
- **`docs` / `docs-content` / `docs-less`.** Three packages, but they are a
  corpus and two renderers, and the names say so once you know that. Put that
  one sentence in a README rather than renaming anything.
- **`vscode`.** Folder `vscode`, npm `@jesscss/vscode-extension`. Fine once
  `extension` is deleted.

## Withdrawn: the directory grouping

The previous version of this document proposed `packages/syntax/{css,less,scss,jess}/`,
`packages/editor/`, and `packages/docs/`. Withdrawn, for reasons that were
already visible in its own text and are stronger now that the cost is measured:

- It is **purely cosmetic by its own admission** — module resolution is by npm
  name, so it changes no dependency edge. It does not address the
  parser-vs-plugin layering question that prompted it.
- The cost is not cosmetic. ~450 `packages/<name>` path literals live in
  `scripts/`, `.cursor/rules/` (~150 across 32 rule files), `guildhall.yaml`
  (26 entries), `vitest.config.ts`, `tsconfig.json`, and `CLAUDE.md`'s 33 glob
  comments.
- Nesting **breaks glob patterns that assume one level**:
  `eslint.config.mjs:274,324` (`packages/*/src/ast/**`), the `packages/*` entry
  in `pnpm-workspace.yaml`, and the vitest project glob. These would need
  rewriting, and a missed one fails open — the ast/ lint rules would silently
  stop applying to the moved parsers.
- The syntax groups are not self-contained (`css-parser` feeds both
  `less-parser` and `scss-parser`; `scss-parser` depends on `less-parser`;
  `language-service` consumes all four), so the directory tree would not
  actually depict the dependency structure.

If the goal is legible layers, the original doc's own alternative is the right
one: a `dependency-cruiser` layering rule or an `ARCHITECTURE.md` graph, at zero
churn.

The **de-hardcoding prerequisite from that proposal survives and is still worth
doing on its own merits** — resolve package roots via `pnpm ls -r --json` /
`require.resolve` in `scripts/*.mjs` and `vitest.config.ts` instead of literal
`packages/<pkg>` strings. It makes the tooling robust and makes any future move
cheap, independent of whether a move ever happens.

## Migration cost and order

### What is mechanical

For a **private, unpublished** package (`internal-css-recognition`): the folder
name, the `name` field, the workspace dep lines, and the import specifiers.
12 source import sites across the four grammars. Plus the build-order lists in
`scripts/verify-compose-integrity.mjs:36` and `scripts/check-macro-buildable.mjs:39`,
the leak assertion in `scripts/release/verify-alpha-packed-consumer.mjs:117`,
four `macro-compiled` tests that assert the old string is **absent** from
compiled output (`packages/{css,less,scss}-parser/test/…`, `jess-parser/test/…`),
and six docs references. `pnpm-lock.yaml` regenerates. All grep-and-replace.

### What is not

- **The four `macro-compiled` tests assert on the package name string.** They
  will pass vacuously against the old name after a rename. Update the literal in
  the same commit or the macro-fusion guarantee silently stops being tested.
- **`guildhall.yaml`** is a hand-maintained folder-path registry and is already
  wrong (missing four packages). Renaming without fixing it deepens the drift.
- **Published renames need a release boundary.** `styles-config` is published at
  `2.0.0-alpha.7` and is in `scripts/release/alpha-allowlist.json`. A rename is
  a breaking change even in alpha. The path: publish `@jesscss/config` at the
  same version, keep `styles-config` publishing for one alpha cycle as a package
  whose entry re-exports `@jesscss/config`, mark it deprecated on npm
  (`npm deprecate`), then drop it from the allowlist. Everything else proposed
  here is private or a deletion, so this is the only package that needs it.
- **`CLAUDE.md`** lists every package path twice (rule globs and prose). It must
  be updated in the same commit as any folder rename, or the auto-select rules
  stop firing for the renamed package — which is exactly the failure mode
  `internal-css-recognition` is already in.

### When this runs

**Phase 0 — now, no coordination needed.** The deletions and dead-reference
removals. `jess-plugin`, `extension`, `language-service-tests`, the two dead
`tsconfig.json` paths, `.cursor/rules/packages/parser.mdc`, the
`packages/parser` entries in `domains/parsers.mdc`. None of these touch a
grammar file, a published package, or anything an in-flight branch is editing.
This is most of the legibility win, at near-zero collision risk.

**Phase 0.5 — now, alongside Phase 0.** The three `internal-css-recognition`
enforcement items (guildhall entry, parsers.mdc, the compose-integrity check).
The verifier extension touches `scripts/` only; it will surface duplicated
leaves in grammars that are currently being edited, so land it with the
inventory pre-populated rather than as a hard gate, then ratchet.

**Phase 1 — after the grammar work quiesces.** The `internal-css-recognition`
rename. It rewrites an import line in all four
`packages/*/src/ast/grammar.ts` files, which is precisely where the active
work is. Landing it mid-flight guarantees a conflict in every open grammar
branch, in a file where a bad merge resolution is a semantics bug. Gate it on
`git branch -r` showing no open grammar branches, then land it as a single
atomic commit.

**Phase 2 — at a release boundary.** `styles-config` → `@jesscss/config`, with
the deprecation cycle above.

**Phase 3 — any time, independent.** The `_shared` split, and the de-hardcoding
of `packages/<pkg>` literals in `scripts/` and `vitest.config.ts`.

## Honest read

The full restructure is not worth doing. The grouping half is withdrawn as pure
churn against ~450 path literals and several one-level globs that fail open. The
npm names — the ones consumers actually see — are already good, and 19 of them
are published, so churning them costs real compatibility for aesthetics.

What is worth doing is smaller and mostly isn't renaming:

1. **Delete three dead packages** (`jess-plugin`, `extension`,
   `language-service-tests`) and four dead references. This resolves more of the
   original confusion than any rename would, and costs nothing.
2. **Fix `internal-css-recognition`'s discovery surface** — guildhall,
   parsers.mdc, and a compose-integrity check. This is the only item with a
   measured bug class behind it.
3. **Rename `internal-css-recognition`** to `@jesscss/shared-css-grammar`. Worth
   it because the package is private and unpublished, so the rename is nearly
   free, and because the current name misdescribes the contents rather than
   merely underdescribing them. Optional relative to item 2.
4. **Rename `styles-config` to `@jesscss/config`.** The one published name that
   misleads a consumer. Needs a deprecation cycle; do it at a release boundary
   or not at all.

Everything else stays. "Rename two, delete three, fix the rules file" is the
honest scope.
