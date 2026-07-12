# Jess README Positioning & Sell Brief

> Draft for owner review. This is the single agreed positioning to apply
> consistently across the root README and every package README before the
> per-package rewrite fans out. Everything here is grounded in the current
> `origin/dev` code and docs; nothing is aspirational unless explicitly labelled
> **Roadmap**. Redline freely — the fan-out agents will follow whatever this
> settles on.

---

## 1. The pitch

**Tagline:** _Jess is the spiritual successor to Less.js, Sass, CSS Modules,
CSS-in-JS, and PostCSS — one engine for what used to take four._

**Value proposition (the convergence story — this is the headline):**
For a decade, styling a serious app meant juggling separate tools:
preprocessing (Less/Sass), scoping (CSS Modules), programmability (CSS-in-JS),
and extensibility (PostCSS). Jess converges all of it into a single modern
engine, built on native CSS (nesting, `@layer`, `@scope`, container queries)
instead of working around it. That five-way convergence is the vision and the
ambition — and it is deliberately **tiered so we stay bold without overclaiming.**

**The honest tiering (mandatory — never blur these two tiers):**

- **Tier 1 — Earned NOW (alpha-credible, lead with these):**
  - **Less.js** — Jess *is* Less v5, literally. `.less` renders today.
  - **Sass** — carried forward via the Jess **"Sass+"** dialect (the committed
    successor to SCSS; in active development, not yet shipped — say so).
- **Tier 2 — The vision / path to 1.0 (roadmap; "being proven through the alpha,"
  NOT claimed as done):**
  - **CSS Modules** ← the **module system** (`@use` / `@compose` / exports,
    `@jesscss/style-resolver`) — scoped, composable styles.
  - **CSS-in-JS** ← **JS execution** in stylesheets (`@use` / `@plugin`,
    `@jesscss/plugin-node-modules`) — dynamism without leaving CSS files.
  - **PostCSS** ← the **plugin architecture** over a real AST (the parseman
    parser toolkit) — transforms and tooling.
  - Owner's words: _"we need stronger evidence/story of the latter three before we
    exit alpha."_ Present them as where Jess is *headed*, each seeded by a real
    capability, always framed as being proven — never as finished.

Every place the convergence appears (root README, package READMEs, site copy)
must show both tiers, or show Tier 1 alone. Do **not** list CSS Modules /
CSS-in-JS / PostCSS as things Jess "does" without the "path to 1.0 / being
proven" frame. Do **not** include **Stylus**.

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
| `@jesscss/css-parser` | A spec-aligned CSS parser (parseman-based) — the shared base grammar the Less and SCSS parsers extend, and the real-AST foundation behind the **PostCSS-style plugin/tooling** vision. |
| `@jesscss/less-parser` | The Less grammar, layered on the CSS base parser, producing the Jess AST. |
| `@jesscss/scss-parser` | An SCSS grammar for Jess (experimental — SCSS is not the focus of the Less alpha). |
| `@jesscss/fns` | The built-in Less/Sass style-function library — color, math, string, and list helpers, split per-file for tree-shaking. |
| `@jesscss/style-resolver` | Stylesheet import resolution across css/less/scss/jess (include paths, load paths, extension/index) — a seed of the **module system** behind the CSS-Modules-style vision. |
| `styles-config` | A shared configuration schema and loader for styling tools (Jess, Less, Sass, Tailwind, …). |
| `@jesscss/awaitable-pipe` | A tiny, strongly-typed pipe that stays synchronous until a step returns a Promise — with one optional error handler. |
| `@jesscss/plugin-less` | The Less language engine for Jess: the Less parser wired in with Less v5 rendering defaults (**Tier 1** — the shipping preprocessor). |
| `@jesscss/plugin-scss` | The SCSS language engine for Jess — the base the **Sass+** dialect builds on (experimental/roadmap). |
| `@jesscss/plugin-node-modules` | Import resolver that loads npm packages from `node_modules` — a seed of the **JS-execution / CSS-in-JS** vision. |
| `@jesscss/plugin-js` | Import bridge for JavaScript/TypeScript modules (with Deno runtime checks) — a seed of the **JS-execution / CSS-in-JS** vision. |
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
