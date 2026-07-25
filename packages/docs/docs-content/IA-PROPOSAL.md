# Docs Information Architecture — Proposal

**Status:** proposal for owner review. Nothing here is built yet — this document
does not change any page, sidebar, or config. It proposes the *ideal* greenfield
IA for the shared, multi-audience docs pool described in
[`AUDIENCES.md`](./AUDIENCES.md), and a phased plan to get there.

**Delivery model this IA must fit** (from `AUDIENCES.md`): one authored content
pool → `audiences: [jess|less|sass]` frontmatter → materialized per-facing trees
→ rendered as facings (jesscss.dev = `jess`, lesscss.org = `less`, plus a
`sass` audience tag), with `<AudienceGate include={[...]}>` for per-audience
blocks inside a shared page. A doc appears on a facing **iff** its `audiences`
includes that facing; `<AudienceGate>` defaults to the build-time `siteAudience`
so shared prose reads as "what *this reader's* tool does."

---

## 0. The one decision that drives everything

The three audiences share **concepts** but diverge on **surface syntax**:

| Concept | Less | Sass (SCSS) | Jess |
| --- | --- | --- | --- |
| Variable | `@color: #06c;` | `$color: #06c;` | `$color: #06c;` |
| Reference | `@color` | `$color` (live/current) | `$color` (live/current) / `$$color` (scoped/final) |
| Mixin def / call | `.box() {}` / `.box();` | `@mixin box {}` / `@include box;` | `box() {}` / `$ > box();` |
| Module import | `@import "x";` | `@use "x";` | `@-compose "./x";` |
| Interpolation | `@{v}` / `~"…"` | `#{…}` | `$(…)` / `$[…]` |
| Extend | `&:extend(.a);` | `@extend .a;` | `&:extend(.a);` / `$extend` |

This table **is** the central editorial problem. It means:

- The **idea** of a variable/mixin/module/loop is one canonical thing worth
  writing once.
- The **spelling** of it is three things that must not bleed across facings (a
  Less reader must never see `@-compose`; a Sass reader must never see `@import`
  framed as "the module system").

So the IA rule is: **shared concept pages, audience-gated syntax.** The judgment
call is *how much* of a page can flip before it stops being one coherent page and
should split into per-audience pages — addressed concretely in §5.

A second structural fact from the inventory: the current Jess tree has **two
overlapping layers** — `docs/jess/02-Language/**` (`.mdx`, deep, current,
authoritative) and `docs/jess/03-Features/**` (`.md`, thin, and historically the
place stale syntax survived — the pre-2021 `@mixin`/`@include`/`@let`/
`@import … from` spellings lived here until they were swept
out). **`02-Language` is canonical; `03-Features` is
harvested for its unique material (nesting, the "CSS-in-CSS"/"JS-in-CSS" framing)
and otherwise retired.** This is baked into the merge map (§4).

---

## 1. Reader journeys

### 1a. Less reader (`less`) — lesscss.org

**Who:** an existing Less user, or a team on Less 4.x deciding whether/how to move
to 5.x. Knows CSS and Less syntax cold (`@var`, `.mixin()`, `@import`, guards).
Arrives via a search result, an old bookmark, or the "should we upgrade?" question.

**Arrives needing:** (1) reference for a specific feature or function they're using
right now; (2) the honest 4.x→5.x migration story (what breaks, what's new, is the
engine swap safe); (3) build/CLI/API/browser usage.

**Does NOT want:** the `.jess` native language, `@-compose`, Sass compatibility.
Those must be invisible on their facing.

**Ideal path:** Overview (Less framing) → *either* jump to a feature/function page
via search, *or* Getting Started → Build & Tooling. The upgrade cohort branches to
**Guides → Migrating Less 4.x → 5.x** early and treats it as the spine of their
visit. Less 5.x new-capability content (real CSS nesting, source-order evaluation,
safer JS model) lives *in the migration guide and the relevant concept pages*, not
in a separate "new in 5.x" silo.

### 1b. Sass reader (`sass`)

**Who:** a Sass/SCSS user evaluating Jess ("Sass+"), or migrating an SCSS codebase.
Knows `$var`, `@mixin/@include`, `@use/@forward`, maps, placeholders. Skeptical and
comparison-driven — "does my code work, and what will bite me?"

**Arrives needing:** (1) a compatibility verdict — what parses, what's mapped, what
is intentionally unsupported, where Jess is *stricter* than Sass; (2) a mechanical
SCSS→Jess migration path; (3) reassurance the differences are principled ("fixes
Sass"), not gaps.

**Does NOT want:** Less-specific syntax, or a from-zero "what is a variable"
tutorial.

**Ideal path:** a Sass-framed Overview → **Guides → Coming from Sass** hub, which
threads the compatibility trio (SCSS compatibility → Unsupported Sass+ features →
Stricter than Sass) and the SCSS→Jess side of the migration guide → then out into
the Language reference (now reading it with Jess syntax) once convinced.

**Where does `sass` render?** Recommendation: **`sass`-tagged content renders on
the jess facing today** (jesscss.dev is the evaluation home for Sass migrants),
and the tag future-proofs a dedicated `sass` onboarding facing later. **Never
render `sass`-only content on lesscss.org.** Practically, Sass-relevant pages are
tagged `[jess, sass]` (or `[sass]` for the pure-compat pages), so they appear
wherever a Sass reader is being served without leaking to Less.

### 1c. Jess reader (`jess`) — jesscss.dev

**Who:** greenfield adopter choosing Jess for a new project, or someone who has
committed to migrating fully. Wants the whole language and the build story.

**Arrives needing:** (1) the full `.jess` language — expressions `$(…)`,
collections, live binding, the `@-compose`/`@-use`/`@-from` module system,
control flow, functions; (2) install/config/editor setup; (3) the "why Jess over
CSS-in-JS / Sass / Tailwind" pitch.

**Ideal path:** Overview (Jess framing, the value pitch) → Getting Started
(install → config → editor) → Language (read front-to-back as a tutorial) →
Functions → Guides (theming, migrating in) → Build & Tooling as needed. The Jess
facing is the **only** one that shows the full Language depth and the native
at-rule/module reference.

---

## 2. Proposed sitemap / nav

Numeric `NN-` prefixes = sidebar order (existing convention, kept). `A:` = the
page's `audiences`. "**gate:**" flags where the *body* diverges by audience and
roughly where. Slugs are audience-neutral for shared pages so one URL serves all
facings.

```
00-introduction/
  overview                     A:[jess,less,sass]  slug:/   Landing + value pitch.
                               gate: whole intro para per audience (Less "CSS with superpowers" /
                               Sass "Sass, fixed" / Jess "the language + engine"); shared
                               "why a preprocessor / where next" tail.

01-getting-started/
  install                      A:[jess,less,sass]  gate: install cmds per audience
                               (lessc/less@alpha vs jess CLI vs npx jess). Shared "alpha status" note.
  compile-your-first-file      A:[jess,less,sass]  gate: whole example flips syntax; shared framing.
  configuration                A:[jess,less]       gate: Jess styles.config.{ts,js} vs Less options object.
                               (Sass reader is routed to Jess config → tag jess only if too divergent;
                               start as [jess,less], split if it over-gates — see §5.)
  editor-support               A:[jess]            VSCode/Cursor LSP. (Less/Sass have their own; jess-only.)

02-language/                   ← the reference core; concept pages, gated syntax
  overview                     A:[jess,less,sass]  "valid CSS is valid X"; nesting teaser. gate: sigil line.
  variables                    A:[jess,less,sass]  Concept + gated syntax card + basic examples.
                               gate: declaration/reference syntax; assignment operators.
  variables-advanced           A:[jess]            live `$`, scoped/final `$$`, assignment lookup modes, scoping model.
                               (No Less/Sass analog at this depth → jess-only, not a gate.)
  nesting                      A:[jess,less,sass]  &, parent templates &()/&(''), at-rule bubbling,
                               collapseNesting. gate: parent-suffix (&-1) is Less/Jess; :is() collapse notes.
  operations-and-math          A:[jess,less,sass]  arithmetic, units, color math, when math evaluates.
                               gate: Less parens/strictMath vs Sass operators vs Jess $(...).
  expressions                  A:[jess]            $(...) deep dive, ? optionality, references-vs-keywords.
  mixins                       A:[jess,less,sass]  Concept (reusable style block) + gated syntax reference.
                               gate: HEAVY — def/call/params/guards spelled 3 ways. (borderline, see §5)
  functions                    A:[jess,less,sass]  DEFINING functions (vs built-ins in §03).
                               gate: Jess stylesheet-fn (> { result }) vs Less mixins-as-fn vs Sass @function.
  control-flow                 A:[jess,less,sass]  conditionals + iteration by TASK.
                               gate: Jess $if/$for vs Sass @if/@each/@for/@while vs Less guards/recursion.
  modules-and-imports          A:[jess,less,sass]  THE flagship shared page (AUDIENCES.md example).
                               gate: @import vs @use/@forward vs @-compose/@-use/@-from; passthrough @import url().
  at-rules                     A:[jess]            native dash at-rule reference: @-compose/@-export/@-use/@-from.
  extend                       A:[jess,less,sass]  selector reuse concept.
                               gate: Less :extend / Sass @extend + %placeholder / Jess $extend + !all.
  interpolation                A:[jess,less,sass]  concept + gated forms (@{}/~"" vs #{} vs $(…)/$[…]).
  values-and-types             A:[jess,less,sass]  CSS value types shared; Jess adds bool/nil/collection.
                               gate: Jess-native types section.
  lists-maps-collections       A:[jess,less,sass]  concept; gate: Less namespaced-ruleset+[] vs Sass maps vs
                               Jess collections {k:v}/dot-access/0-based indexing.
  comments                     A:[jess,less,sass]  /* */ vs // silent. mostly shared.
  # Less-only feature pages (no meaningful cross-audience concept, or Less-specific mechanics):
  detached-rulesets            A:[less]            (Jess analog = anonymous mixins/$content; cross-link, don't merge)
  merge                        A:[less]            property `+`/`+_` aggregation.
  scope                        A:[less]            Less mixin/definition scoping specifics.
  css-guards                   A:[less]            guards on selectors (if-style).
  # Sass-only compat pages (the "Coming from Sass" source content lives here or under Guides):
  #   -> see Guides/coming-from-sass; the three compat pages are tagged [jess,sass].

03-functions/                  ← BUILT-IN function reference
  overview                     A:[jess,less,sass]  gate: BIG — Jess must `@-from '@jesscss/fns' import(...)`,
                               keys 0-based; Less functions are global, lists 1-based. This preamble is the
                               single most important gate in the whole docs set (call-convention differs).
  color-definition             A:[jess,less,sass]  rgb/rgba/hsl/hsv…
  color-channel                A:[jess,less,sass]  hue/saturation/red/alpha/luma…
  color-operations             A:[jess,less,sass]  lighten/darken/mix/fade/tint/shade…
  color-blending               A:[jess,less,sass]  multiply/screen/overlay…
  math                         A:[jess,less,sass]  ceil/floor/round/sqrt… (Jess arithmetic is `$( … )`, not a fn; gate call form)
  list                         A:[jess,less,sass]  length/extract/range/each (Jess iterates with `$for`; keys are 1-based)
  logical                      A:[jess,less,sass]  if/boolean (Less) vs `$if`/`$else` (Jess, a language form). gate.
  string                       A:[less]            escape/e/%/replace (confirm Jess parity; tag up if present)
  type                         A:[less]            isnumber/iscolor/isstring… (confirm Jess parity)
  misc                         A:[less]            image-size/svg-gradient/unit… (confirm Jess parity)

04-guides/                     ← task-oriented, journey-shaped
  migrating-less-4-to-5        A:[jess,less]       EXISTS (docs/shared). breaking changes; engine swap.
  coming-from-sass             A:[jess,sass]       hub → the compat trio + SCSS→Jess migration.
    scss-compatibility         A:[jess,sass]       how SCSS maps into Jess.
    unsupported-sass-features  A:[jess,sass]       @at-root, @forward show/hide/as — parsed, not evaluated.
    stricter-than-sass         A:[jess,sass]       invalid-CSS Sass tolerates that Jess rejects.
  migrating-to-jess            A:[jess,sass]       manual port; Less→Jess AND Sass→Jess mapping tables.
                               (no `jess convert` exists — converter is unbuilt.)
                               gate: two source columns (Less / Sass) → Jess.
  theming                      A:[jess]            design tokens, @-compose ... with { }, static vs patch output.
  browser-usage                A:[jess,less]       gate: Less update-script model vs Jess dynamic/patch output.

05-build-and-tooling/          ← usage
  cli                          A:[jess,less]       gate: lessc vs jess CLI, flags.
  programmatic-api             A:[jess,less]       gate: less.render(...) vs Jess API.
  options                      A:[jess,less]       gate: compiler options table (math, rewriteUrls, module…).
  sourcemaps                   A:[jess,less]       mostly shared; gate CLI flags.
  bundlers-and-integrations    A:[jess,less]       rollup-plugin-jess, build-tool integrations.
  plugins                      A:[jess,less]       gate: Less @plugin (deprecated/experimental) vs Jess plugins.

06-ecosystem/                  ← reference / directory / meta
  editors-and-guis             A:[less]            (Jess editor story is in 01/editor-support)
  online-compilers             A:[jess,less]       playgrounds.
  frameworks-and-ports         A:[less]            frameworks-using-less, ports.
  about-and-history            A:[jess,less]       gate: Less history vs Jess origin story.
  releases                     A:[jess]            release notes / alpha-publishing (contributor-facing).
  contributing                 A:[jess,less]       developing-less → shared contributor guide.
```

Notes on structure:

- **Six top sections**: Introduction, Getting Started, Language, Functions,
  Guides, Build & Tooling, Ecosystem (the intro is a single landing page, so
  effectively 6 nav groups). This maps cleanly to progressive disclosure:
  *pitch → set up → learn the language → look up functions → do a task → ship → explore the ecosystem.*
- **Language** is concept-ordered as a learnable sequence, not alphabetical.
- **Guides** is where all three journeys' "migration/onboarding" spines live, so
  each audience has an obvious task hub.

---

## 3. Audience-visibility matrix

`●` = renders on this facing. Blank = hidden. (Gated pages render but show only
that audience's blocks.)

| Page | less | sass | jess |
| --- | :--: | :--: | :--: |
| introduction/overview | ● | ● | ● |
| getting-started/install | ● | ● | ● |
| getting-started/compile-your-first-file | ● | ● | ● |
| getting-started/configuration | ● |  | ● |
| getting-started/editor-support |  |  | ● |
| language/overview | ● | ● | ● |
| language/variables | ● | ● | ● |
| language/variables-advanced |  |  | ● |
| language/nesting | ● | ● | ● |
| language/operations-and-math | ● | ● | ● |
| language/expressions |  |  | ● |
| language/mixins | ● | ● | ● |
| language/functions | ● | ● | ● |
| language/control-flow | ● | ● | ● |
| language/modules-and-imports | ● | ● | ● |
| language/at-rules |  |  | ● |
| language/extend | ● | ● | ● |
| language/interpolation | ● | ● | ● |
| language/values-and-types | ● | ● | ● |
| language/lists-maps-collections | ● | ● | ● |
| language/comments | ● | ● | ● |
| language/detached-rulesets | ● |  |  |
| language/merge | ● |  |  |
| language/scope | ● |  |  |
| language/css-guards | ● |  |  |
| functions/overview | ● | ● | ● |
| functions/color-* , math, list, logical | ● | ● | ● |
| functions/string, type, misc | ● |  | ○ |
| guides/migrating-less-4-to-5 | ● |  | ● |
| guides/coming-from-sass |  | ● | ● |
| guides/coming-from-sass/* (compat trio) |  | ● | ● |
| guides/migrating-to-jess |  | ● | ● |
| guides/theming |  |  | ● |
| guides/browser-usage | ● |  | ● |
| build-and-tooling/* (cli, api, options, sourcemaps, bundlers, plugins) | ● |  | ● |
| ecosystem/editors-and-guis | ● |  |  |
| ecosystem/online-compilers | ● |  | ● |
| ecosystem/frameworks-and-ports | ● |  |  |
| ecosystem/about-and-history | ● |  | ● |
| ecosystem/releases |  |  | ● |
| ecosystem/contributing | ● |  | ● |

`○` = tag up to `jess` once Jess parity for string/type/misc functions is
confirmed (see §4 open items).

---

## 4. Merge map (existing files → proposed pages)

Provenance: `origin` frontmatter is set on the merged page (`shared` when it
combines audiences, else the surviving source's origin). "Net-new" = writing that
has no existing source.

### Introduction & Getting Started
| Proposed page | Folds in (existing) | Work |
| --- | --- | --- |
| introduction/overview | `docs/jess/01-getting-started/01-about.mdx`; `docs/less/Home.md`; `docs/less/features-overview.md`; `docs/less/home/getting-started.md` | Merge + gate the intro paragraph; Sass intro is **net-new**. |
| getting-started/install | `docs/jess/01-getting-started/02-install.mdx`; `docs/less/home/download-options.md`; `docs/less/home/cdn-options.md` | Merge + gate install commands. |
| getting-started/compile-your-first-file | `docs/less/home/getting-started.md` (compile part); `docs/less/usage/using-less.md` (quick path) | Mostly **net-new** unified quickstart; gate the example. |
| getting-started/configuration | `docs/jess/01-getting-started/03-config.mdx`; (Less side: `docs/less/usage/less-options.md` intro) | Keep Jess config; gate a short Less-options pointer. |
| getting-started/editor-support | `docs/jess/01-getting-started/04-vscode.mdx` | Move as-is (jess-only). |

### Language
| Proposed page | Folds in (existing) | Work |
| --- | --- | --- |
| language/overview | `docs/jess/02-Language/01-overview.mdx`; `docs/jess/03-Features/01-css.md` (CSS-in-CSS framing) | Merge; gate the sigil line; add Less/Sass "valid CSS is valid X". |
| language/variables | `docs/jess/02-Language/02-variables.mdx` (basics only); `docs/less/features/variables.md`; **retire** `docs/jess/03-Features/04-variables.md` | Merge concept; gate syntax; harvest theming snippet into guides/theming. |
| language/variables-advanced | `docs/jess/02-Language/02-variables.mdx` (live binding/`:=`/readonly/private/scoping) | Split the deep half out; jess-only. |
| language/nesting | `docs/jess/03-Features/02-nesting.md`; `docs/less/features/nested.md`; `docs/less/features/parent-selectors.md` | Merge — **only Features page worth keeping**; gate `&-1`/`:is()` notes. |
| language/operations-and-math | `docs/jess/02-Language/03-expressions.mdx` (math part); `docs/less/features/strictmath.md` | Merge concept; gate. |
| language/expressions | `docs/jess/02-Language/03-expressions.mdx` (full `$(…)`/`?`) | jess-only deep page. |
| language/mixins | `docs/jess/02-Language/05-mixins.mdx`; `docs/less/features/mixins.md` (consolidated hub, absorbs `mixin-guards/mixin-loops/mixins-aliasing/mixins-as-functions/mixins-parametric.md` stubs); **retire** `docs/jess/03-Features/05-mixins.md` | Merge; heavy gate; **net-new** Sass `@mixin/@include` column. |
| language/functions | `docs/jess/02-Language/06-functions.mdx`; `docs/jess/03-Features/07-functions.md` (importing-JS-fns angle); `docs/less/features/mixins-as-functions.md` | Merge "defining functions"; gate. |
| language/control-flow | `docs/jess/02-Language/07-conditionals-iteration.mdx`; `docs/less/features/mixin-guards.md` + `mixin-loops.md` | Merge by task; gate 3 mechanisms; **net-new** Sass `@each/@while`. |
| language/modules-and-imports | `docs/jess/02-Language/04-atrules.mdx` (import parts); `docs/jess/03-Features/06-imports.md`; `docs/less/features/imports.md`; **align with** `docs/shared/less-v5-breaking-changes.mdx` (`@import` deprecation) | Merge; this is the flagship gate; **net-new** Sass `@use/@forward`. |
| language/at-rules | `docs/jess/02-Language/04-atrules.mdx` (full `@-compose`/`@-export`/`@-use`/`@-from`) | jess-only reference. |
| language/extend | `docs/less/features/extend.md`; Jess `$extend` (from `08-interpolation.mdx` refs + core behavior) | Merge; gate; **net-new** Sass `@extend`/`%placeholder` (partly in compat trio — cross-link). |
| language/interpolation | `docs/jess/02-Language/08-interpolation.mdx`; Less `@{}`/`~""` (from `features/variables.md`) | Merge; gate forms. |
| language/values-and-types | `docs/jess/02-Language/09-values-and-types.mdx` | Keep; gate the Jess-native-types section; add short Less/Sass "types you already know". |
| language/lists-maps-collections | `docs/jess/02-Language/10-namespaces-and-maps.mdx`; `docs/less/features/maps.md`; harvest `docs/jess/03-Features/04-variables.md` collections snippet | Merge; gate. |
| language/comments | `docs/less/features/comments.md` | Keep; mostly shared. |
| language/detached-rulesets | `docs/less/features/detached-rulesets.md` | Keep less-only; cross-link Jess anonymous mixins. |
| language/merge | `docs/less/features/merge.md` | Keep less-only. |
| language/scope | `docs/less/features/scope.md` | Keep less-only. |
| language/css-guards | `docs/less/features/css-guards.md` | Keep less-only. |
| **retire** | `docs/jess/03-Features/08-exports.md` (self-admitted placeholder), `03-Features/03-js.md` (fold framing into at-rules/theming), `docs/less/features/overview.md` + `features-overview.md` (redirect stubs) | Delete/redirect after harvest. |

### Functions
| Proposed page | Folds in (existing) | Work |
| --- | --- | --- |
| functions/overview | `docs/jess/04-Functions/01-about.md`; (Less: implicit global availability) | Merge; **the big call-convention gate** (import-required vs global; 0- vs 1-based). |
| functions/color-definition | `docs/jess/04-Functions/02-color-definition.md`; `docs/less/functions/color-definition.md` | Merge; gate availability/import. |
| functions/color-channel | `…/03-color-channel.md`; `docs/less/functions/color-channel.md` | Merge. |
| functions/color-operations | `…/04-color-operations.md`; `docs/less/functions/color-operations.md` | Merge. |
| functions/color-blending | `…/05-color-blending.md`; `docs/less/functions/color-blending.md` | Merge. |
| functions/math | `…/08-math.md`; `docs/less/functions/math-functions.md` | Merge; gate Jess `$( … )` vs global. |
| functions/list | `…/06-list.md`; `docs/less/functions/list-functions.md` | Merge; gate Less `each` vs Jess `$for` (1-based keys). |
| functions/logical | `…/07-logical.md`; `docs/less/functions/logical-functions.md` | Merge; gate Jess `$if`/`$else` vs Less `if/boolean`. |
| functions/string | `docs/less/functions/string-functions.md` | less-only until Jess parity confirmed. |
| functions/type | `docs/less/functions/type-functions.md` | less-only until parity confirmed. |
| functions/misc | `docs/less/functions/misc-functions.md`; `docs/less/functions/examples/examples.md` | less-only until parity confirmed. |

### Guides
| Proposed page | Folds in (existing) | Work |
| --- | --- | --- |
| guides/migrating-less-4-to-5 | `docs/shared/less-v5-breaking-changes.mdx`; `docs/less/usage/migrating-to-v5.md` | Merge the two (they overlap heavily); keep gated `[jess,less]`. |
| guides/coming-from-sass (hub) | — | **net-new** landing that threads the three below. |
| guides/coming-from-sass/scss-compatibility | `docs/jess/02-Language/11-sass-scss.mdx` | Move; retag `[jess,sass]`. |
| guides/coming-from-sass/unsupported-sass-features | `docs/jess/02-Language/12-sass-unsupported.mdx` | Move; retag `[jess,sass]`. |
| guides/coming-from-sass/stricter-than-sass | `docs/jess/02-Language/13-sass-plus-strictness.mdx` | Move; retag `[jess,sass]`. |
| guides/migrating-to-jess | `docs/jess/01-getting-started/06-migrating.mdx` | Move; retag `[jess,sass]` (already has Less+Sass columns). |
| guides/theming | `docs/jess/01-getting-started/05-theming.mdx`; harvest theming from `03-Features/04-variables.md` + `02-Language/02-variables.mdx` | Merge; jess-only. |
| guides/browser-usage | `docs/less/usage/using-less-in-the-browser.md`; `docs/less/usage/browser-support.md`; Jess dynamic/patch notes | Merge; gate. |

### Build & Tooling
| Proposed page | Folds in (existing) | Work |
| --- | --- | --- |
| build-and-tooling/cli | `docs/less/usage/command-line-usage.md` | Keep; gate `jess` CLI (**net-new** Jess column). |
| build-and-tooling/programmatic-api | `docs/less/usage/programmatic-usage.md`; `docs/less/usage/api.md` (stub) | Merge; gate Jess API. |
| build-and-tooling/options | `docs/less/usage/less-options.md`; `docs/less/usage/advanced-reference.md` | Merge; gate. |
| build-and-tooling/sourcemaps | `docs/less/usage/sourcemaps.md` | Keep; gate. |
| build-and-tooling/bundlers-and-integrations | `docs/less/tools/third-party-compilers.md`; Jess `rollup-plugin-jess` (from `03-Features/06-imports.md`) | Merge. |
| build-and-tooling/plugins | `docs/less/usage/plugins.md`; `docs/less/features/plugins.md`; `docs/less/tools/plugins.md` | Merge the 3 Less plugin pages; gate. |

### Ecosystem
| Proposed page | Folds in (existing) | Work |
| --- | --- | --- |
| ecosystem/editors-and-guis | `docs/less/tools/editors-and-plugins.md`; `docs/less/tools/guis-for-less.md` | Merge (less). |
| ecosystem/online-compilers | `docs/less/tools/online-less-compilers.md` | Keep. |
| ecosystem/frameworks-and-ports | `docs/less/tools/frameworks-using-less.md`; `docs/less/tools/ports.md` | Merge (less). |
| ecosystem/about-and-history | `docs/less/about/history.md`; `docs/less/about/learn-more.md`; Jess origin (from `01-about.mdx`) | Merge; gate. |
| ecosystem/releases | `docs/jess/05-Releases/01-alpha-publishing.mdx` | Move (jess/contributor). |
| ecosystem/contributing | `docs/less/usage/developing-less.md` | Keep; gate. |
| **retire** | `docs/less/examples/data-URI.md`, `docs/less/examples/example.md` | Fold worked examples into the relevant concept pages, then retire the `examples/` bucket. |

**Open items for owner** (parity unknowns surfaced by the inventory):
- Do Jess `@jesscss/fns` cover **string/type/misc** functions? If yes, tag those
  `[jess,less,sass]`; if no, keep `[less]` and note the gap on functions/overview.
- Confirm `getting-started/configuration` should serve `sass` (Sass migrants land
  in Jess config) — currently `[jess,less]`.

---

## 5. Handling divergence well (the gating line)

The delivery model gives two tools: **page-level `audiences`** (whole page appears
or not) and **`<AudienceGate>`** (a block within a shared page). The craft is
choosing between *one gated page* and *separate pages*. My rules:

**Use ONE shared, gated page when:**
1. The **concept is identical** and only *tokens* differ (a variable is a variable;
   only the sigil changes). → `variables`, `nesting`, `interpolation`, `comments`,
   `values-and-types`, the whole Functions reference.
2. The page's value **is** the comparison — a migrant learns by seeing "your
   `@use` → our `@-compose`." → `modules-and-imports`, `control-flow`,
   `migrating-to-jess`. Here gating is a *feature*, not a compromise.
3. The shared prose is the **majority** of the page and gated blocks are localized
   (a code sample, one table row, one admonition). Keep the shared narrative
   spine; gate the spellings.

**Split into per-audience (or audience-only) pages when:**
1. One audience needs **substantially more depth** with no counterpart. → Jess
   `expressions` `$(…)`, `at-rules`, `variables-advanced` are jess-only pages, not
   giant gated blocks bolted onto the shared concept page. (Rule: if >~40% of the
   page would be inside a single-audience gate, that content wants its own page.)
2. The feature **exists for only one audience.** → Less `merge`, `scope`,
   `detached-rulesets`, `css-guards`; Sass compat trio. A gated block pretending
   otherwise just wastes the other facings' sidebar slot.
3. Gating would fragment the reading flow into an **unreadable patchwork** — i.e.
   nearly every paragraph flips. This is the real danger and it has a name below.

**The over-gating red flag — `mixins` is the test case.** Mixin *definition*,
*call*, *parameters*, and *guards* are each spelled three ways, so a fully-gated
`mixins` page risks becoming three interleaved pages sharing only headings. The
right shape: a **shared conceptual intro** ("a mixin is a reusable block; here's
the shape in your syntax" — one gated card), then a **shared structure** of
subsections (Parameters, Guards, Composition) where each subsection's *body* is
gated but the *heading and the idea* are shared. If, in authoring, a writer finds
they're writing three fully independent bodies under every heading with no shared
sentence, that page has crossed the line → split `mixins` into
`mixins` (shared concept + comparison table) plus `mixins/reference` per audience.
**Author it shared first; split only when the shared spine proves empty.** Do not
pre-split on suspicion — the comparison is usually worth keeping.

**Framing, not just syntax.** `<AudienceGate>` also carries *stance*: the Sass
reader gets "this is unsupported because Sass painted itself into a corner"; the
Less reader gets "this still works but warns." The default-to-`siteAudience`
behavior means a shared page's opening sentence should almost always be gated so
each reader hears their tool named. Budget one gated intro block per shared page as
a matter of course.

---

## 6. Naming, ordering, and versioning

**Naming**
- **Slugs are audience-neutral and stable** for shared pages: `/language/variables`,
  `/guides/migrating-to-jess`. No tool name in a shared slug (the facing already
  scopes it). Keeps a single canonical URL across facings and prevents
  duplicate-content splits.
- **Frontmatter `title` is neutral** ("Variables", "Modules & imports"); the
  audience-specific naming happens in a gated H1/lede, not the sidebar label.
- **Section dirs** kebab-case with `NN-` order prefixes; human titles via
  `_category_.json`. Concept pages singular-noun (`variable`→`variables` follow
  existing plural where established; be consistent within a section).
- **`origin` frontmatter** (`shared|jess|less|sass`) is retained as provenance so a
  future audit can tell merged pages from single-source ones.
- **`audiences` is the source of truth**; never rely on directory location for
  visibility (a page under `language/` can still be `[less]`-only).

**Ordering** — progressive disclosure end to end: *pitch → set up → learn →
look up → do → ship → explore.* Within Language, order is a learning path
(overview → variables → nesting → operations → mixins → functions → control-flow →
modules → extend → interpolation → values → collections), **not** alphabetical.
Less-only and jess-only pages sit at the *end* of their section so the shared
learning spine reads first on every facing.

**Versioning** — there is **no `versioned_docs` today** (confirmed: none under
`docs-content/`), and I recommend **not introducing Docusaurus versioning now.**
Rationale: Less 5.x is a clean engine cutover, and the current content already
encodes 4.x↔5.x deltas *in place* (`migrating-to-v5.md`, inline "5.x default"
admonitions). A parallel versioned tree would triple the maintenance the whole
one-pool model exists to avoid.
- **Version deltas live in content**: the `guides/migrating-less-4-to-5` page +
  inline `<AudienceGate>`/admonitions ("In 5.x, `collapseNesting` defaults to
  false…"). This is where a Less reader learns what changed.
- **4.x reference**, if it must persist, is a **frozen archived snapshot** linked
  from the migration guide — not a maintained version in the pool.
- **Revisit** only when 5.x is stable *and* a 6.x delta looms; at that point adopt
  Docusaurus versioning for the `less` facing specifically, keyed to Less releases
  (Jess itself can version independently). Don't pay that cost during alpha.

---

## 7. Phased execution plan

Ordered by value. Each phase is a coherent cluster a single writer agent can own.
Land the delivery plumbing (`AUDIENCES.md` §"Migration path" steps 1–3:
materialization script, `.site/` gitignore, `siteAudience`, `<AudienceGate>`
default) **before** Phase 1 so gated pages render correctly.

**Phase 1 — the multi-audience spine (highest value; proves the model).**
The pages that only exist *because* this is a shared pool:
- `introduction/overview` (3-way gated pitch)
- `language/modules-and-imports` (the flagship `@import`/`@use`/`@-compose` gate)
- `guides/migrating-less-4-to-5` (merge `docs/shared/less-v5-breaking-changes.mdx`
  + `docs/less/usage/migrating-to-v5.md`)
- `guides/coming-from-sass` hub + move the compat trio (`11/12/13`), retag
  `[jess,sass]`
- `guides/migrating-to-jess` (move `06-migrating.mdx`)
*Owner-review gate: confirm the `sass`-facing rendering decision (§1b) here, since
Phase 1 is where sass content first appears.*

**Phase 2 — Getting Started + Language core (the daily-driver reference).**
- `getting-started/{install, compile-your-first-file, configuration, editor-support}`
- `language/{overview, variables, variables-advanced, nesting, mixins,
  control-flow}`
Cluster owner harvests `02-Language` as canonical and **retires the stale
`03-Features` variables/mixins/imports/exports/functions pages** after pulling
`02-nesting` and the CSS-in-CSS framing.

**Phase 3 — rest of Language + Functions reference.**
- `language/{operations-and-math, expressions, functions, extend, interpolation,
  values-and-types, lists-maps-collections, comments}` + less-only
  `{detached-rulesets, merge, scope, css-guards}`
- `functions/*` — the whole built-in reference; **start with `functions/overview`**
  (the call-convention gate) because every function page depends on it. Resolve the
  string/type/misc parity open item here.

**Phase 4 — Build & Tooling.**
- `build-and-tooling/{cli, programmatic-api, options, sourcemaps,
  bundlers-and-integrations, plugins}` — merge the Less `usage/**` + `tools/**`
  plugin pages; add **net-new** gated Jess CLI/API columns.

**Phase 5 — Ecosystem + cleanup.**
- `ecosystem/*`; fold `docs/less/examples/**` into concept pages; delete redirect
  stubs (`features/overview.md`, `features-overview.md`, the 5 mixin sub-stubs once
  `language/mixins` absorbs them); final link-audit across facings.

**Suggested writer-agent clusters** (parallelizable after Phase 1):
`A` Onboarding (Getting Started + overview) · `B` Language-core (variables,
nesting, mixins, control-flow) · `C` Language-rest + Collections/Types/Extend ·
`D` Functions reference · `E` Modules/Migration/Sass-compat (the gated spine —
best given to one owner for voice consistency) · `F` Build & Tooling + Ecosystem.
Cluster `E` should land first/alongside Phase 1; the rest fan out.

---

## Appendix — retire / redirect list (for traceability)

- **Stale, delete after harvest:** `docs/jess/03-Features/{04-variables,05-mixins,
  06-imports,07-functions,08-exports}.md` (superseded by `02-Language/**`;
  syntactically outdated).
- **Harvest then retire:** `docs/jess/03-Features/{01-css,02-nesting,03-js}.md`
  (`02-nesting` → `language/nesting`; `01-css`/`03-js` framing → overview/at-rules/
  theming).
- **Redirect stubs, delete:** `docs/less/features/overview.md`,
  `docs/less/features-overview.md`, `docs/less/features/{mixin-guards,mixin-loops,
  mixins-aliasing,mixins-as-functions,mixins-parametric}.md` (already `unlisted`
  pointers into `mixins.md`).
- **Fold then retire bucket:** `docs/less/examples/{data-URI,example}.md`.
- **Merge pairs (two sources → one page):** `docs/shared/less-v5-breaking-changes.mdx`
  + `docs/less/usage/migrating-to-v5.md`; `docs/less/usage/{api,programmatic-usage}.md`;
  `docs/less/usage/{less-options,advanced-reference}.md`;
  `docs/less/{usage/plugins,features/plugins,tools/plugins}.md`.
