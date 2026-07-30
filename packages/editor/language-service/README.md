# `@jesscss/language-service`

Jess-first language service engine + thin LSP server wrapper.

The engine uses Microsoft's CSS/Less/SCSS language service as a coverage
reference for the kinds of messages stylesheet authors expect: CSS metadata
hovers and completions, validity diagnostics, browser compatibility advice,
document navigation, links, folding, color information, and selector help. Jess
should cover those categories while presenting richer TypeScript-style
completion and hover details where the shared Jess diagnostics and CST facts can
do better.

## Tracking

See `../../../docs/architecture/lint-roadmap.md` for the shared diagnostics plan.
