# Jess README Positioning & Sell Brief

> Draft for owner review. This is the single agreed positioning to apply
> consistently across the root README and every package README before the
> per-package rewrite fans out. Everything here is grounded in the current
> `origin/dev` code and docs; nothing is aspirational unless explicitly labelled
> **Roadmap**. Redline freely — the fan-out agents will follow whatever this
> settles on.

---

## 1. The pitch

**Tagline:** _Less.js v5 — the Less CSS preprocessor, rebuilt from the ground up._

**Value proposition (2–3 sentences):**
Jess is the next major version of Less: the same variables-mixins-nesting
language millions of stylesheets already use, re-implemented on a brand-new
compiler engine designed for speed, correctness, and extensibility. Unlike a
patch on the 15-year-old Less.js codebase, Jess evaluates and emits a stylesheet
in a single pass over one canonical tree, ships a modular parser/plugin
architecture, and comes with a `lessc` drop-in CLI. It is in early alpha today,
focused squarely on Less v5 compatibility — a native `.jess` language and a
"Sass+" dialect are on the roadmap, not yet in the box.

**Honest differentiators.** Only claim these — they're real:

- **vs Less 4.x**
  - A ground-up rewrite, not an incremental fork: modern TypeScript, a
    spec-aligned CSS base parser, a plugin-based language layer, and a
    single-evaluate-and-emit engine.
  - Less **v5** output semantics: nesting is **preserved by default** (4.x
    flattening is opt-in via `--collapse-nesting`).
  - `lessc` drop-in for the 4.x command surface (flags, stdin/stdout, exit codes).
  - Architected for extensibility — parsers, language engines (`plugin-less`,
    `plugin-scss`), and resolvers are separable, publishable packages.
- **vs Sass-style tooling**
  - Keeps the CSS mental model; Less reads like CSS, so adoption is cheap.
  - A real compatibility story with the existing Less ecosystem
    (`plugin-less-compat` runs Less 4.x plugins/visitors against the Jess AST).

**Claims to NOT make** (the old READMEs made several of these — do not carry them
forward):

- ❌ "Faster than Sass and Less." Jess is currently ~5.4× **slower** than Less 4.x
  on `benchmark.less`. Parity is the goal, not a shipped fact. Frame performance
  as _intent + trajectory_ (8.3 s → ~213 ms, ~39× better than mid-2026), never as
  a win over 4.x.
- ❌ "A replacement for Less, Sass, CSS Modules, and CSS-in-JS." Today it renders
  Less. The rest is roadmap or out of scope.
- ❌ Showing `$`-prefixed `.jess` / Sass+ syntax as if it works. The `.jess` parser
  is deliberately unfinished; that syntax does not run.
- ❌ "Star this repo!", "the new hotness", Gitter links, `yarn install`. Drop the
  hype and the stale mechanics (the repo is pnpm-only).

---

## 2. Voice & tone

A short style guide so every README reads like one project:

- **Developer-direct.** Lead with what the package _is_ and what it _does_. No
  marketing throat-clearing, no exclamation-point hype.
- **Confident but honest about alpha.** State capabilities plainly in the present
  tense; state gaps just as plainly. "Alpha, expect gaps, report bugs" is a
  feature of the voice, not an apology. Every README should make the alpha status
  unmissable.
- **No overclaiming.** If a feature is partial, say "partial." If it's planned,
  put it under a clearly-labelled **Roadmap** heading. Never present roadmap
  syntax in a code block without a "not yet" label.
- **Present-tense for what works; labelled future-tense for what doesn't.** The
  working surface is Less v5. `.jess`, Sass+, and SCSS are roadmap/experimental —
  always labelled as such.
- **Show, don't gush.** Prefer a small, real, copy-pasteable example over
  adjectives. Examples must actually run on the current alpha (i.e. Less input).
- **Consistent vocabulary.** "Jess is Less.js v5." "The engine" = `@jesscss/core`.
  "The compiler" = the `Compiler` in the `jess` package. "Less v5 output
  semantics" = nesting preserved by default. Reuse these phrasings verbatim.
- **Accurate mechanics.** pnpm (not yarn/npm) for repo dev; `npm install <pkg>`
  for consumers; Node 16+. Link issues to
  `https://github.com/jesscss/jess/issues`. License is MIT.

---

## 3. Per-package one-liners

One crisp hook per publishable package, grounded in its actual role/exports. Use
these as the opening line of each package README so the fan-out stays consistent.

| Package | One-liner |
| --- | --- |
| `jess` | The Less.js v5 command line and API — the `jess` and `lessc` CLIs plus a `Compiler` that renders `.less` to CSS. |
| `@jesscss/core` | The Jess compiler engine: the AST, evaluator, and single-pass serializer that turn a parsed stylesheet into CSS. |
| `@jesscss/css-parser` | A spec-aligned CSS parser — the shared base grammar the Less and SCSS parsers are built on. |
| `@jesscss/less-parser` | The Less grammar, layered on the CSS base parser, producing the Jess AST. |
| `@jesscss/scss-parser` | An SCSS grammar for Jess (experimental — SCSS is not the focus of the Less alpha). |
| `@jesscss/fns` | The built-in Less/Sass style-function library — color, math, string, and list helpers, split per-file for tree-shaking. |
| `@jesscss/style-resolver` | Stylesheet import resolution across css/less/scss/jess: Less include paths, SCSS load paths, and extension/index lookup. |
| `styles-config` | A shared configuration schema and loader for styling tools (Jess, Less, Sass, Tailwind, …). |
| `@jesscss/awaitable-pipe` | A tiny, strongly-typed pipe that stays synchronous until a step returns a Promise — with one optional error handler. |
| `@jesscss/plugin-less` | The Less language engine for Jess: the Less parser wired in with Less v5 rendering defaults. |
| `@jesscss/plugin-scss` | The SCSS language engine for Jess (experimental/roadmap). |
| `@jesscss/plugin-node-modules` | Import resolver that loads npm packages from `node_modules`. |
| `@jesscss/plugin-js` | Import bridge for JavaScript/TypeScript modules (with Deno runtime checks). |
| `@jesscss/plugin-less-compat` | A Less.js 4.x compatibility layer that lets existing Less plugins and visitors run against the Jess AST. |
| `@jesscss/patch-css` | A tiny runtime helper that attaches cached stylesheets from `localStorage` in the document head. |

**Notes for the fan-out agents:**

- `styles-config` is published **unscoped** (name is `styles-config`, not
  `@jesscss/config`); its directory is `packages/config`.
- The plugin package **directories** are prefixed `jess-plugin-*` but the
  **published names** are `@jesscss/plugin-*` — use the published name in prose.
- `scss-parser` / `plugin-scss` and the `.jess`/Sass+ story must each carry an
  explicit "experimental / roadmap / not the alpha focus" caveat in their README.
- `rollup-plugin-jess`, `jess-loader`, `patch-css` and the various tooling
  packages are early/utility surfaces — verify build + exports before writing
  anything beyond the one-liner; don't imply a finished integration that isn't.
- Every package README should carry the same alpha banner and link to the root
  README + issues, so a reader landing on npm gets the honest status regardless of
  which package they found.
