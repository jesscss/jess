# @jesscss/plugin-scss

**The SCSS language engine for Jess — the experimental base that seeds
"Sass+".**

This plugin layers an SCSS grammar (`@jesscss/scss-parser`) onto the Jess
compiler, the same way [`@jesscss/plugin-less`](../../less/jess-plugin-less) provides the
Less engine. It parses `.scss` into the Jess AST for the engine to evaluate and
emit.

## Roadmap status — experimental, not the alpha focus

Jess's language is an **ordered progression: Now Less.js → Next "Sass+" →
Final `.jess`.** Only Less.js is shipping today.

`plugin-scss` sits at the **"Next"** milestone. It is the experimental base for
**Sass+** — the intended Sass successor, a dialect that fixes and extends
Sass-style ergonomics — but Sass+ itself is **not shipped**, and SCSS support is
**not a goal of the current Less-focused alpha.** Expect gaps and breaking
changes. If you need production Sass today, use Sass.

What exists now is the SCSS parser plus this plugin wiring; the Sass+ dialect,
semantics, and defaults are still being designed. Treat anything here as a
preview, not a promise.

## Status

**Alpha / experimental.** Part of [Jess](https://github.com/jesscss/jess). The
programmatic plugin/compiler API is **not yet stabilized** — the `jess` CLI is
the documented public surface for the alpha, and it targets Less today.

- Project overview & positioning: <https://github.com/jesscss/jess#readme>
- Docs: <https://jesscss.github.io/> (currently pre-alpha content)
- Issues: <https://github.com/jesscss/jess/issues>
- License: MIT
