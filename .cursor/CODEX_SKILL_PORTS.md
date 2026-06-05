# Codex Skill Ports

Some Cursor-local skills and scattered guidance have Codex equivalents under
`/Users/matthew/.codex/skills`.

Ported because they contain valid Jess-specific behavior:

- `jess-api-surface-safety`
- `jess-fixture-driven-dev`
- `jess-performance-sanity`
- `jess-extend-hotspot`
- `jess-parser-ast-contract`
- `jess-function-library-testing`
- `jess-aggressive-cutting-review`

Not ported as separate Jess skills because Codex already has stronger generic
skills for the same role:

- `.cursor/skills/systematic-debugging`
- `.cursor/skills/verification-before-completion`
- `.cursor/skills/subagent-review`

Keep future durable guidance in one of:

- `AGENTS.md` for cross-tool repo rules;
- a Codex skill when Codex should auto-trigger it by task shape;
- a Cursor rule/skill only when the behavior is Cursor-specific;
- `docs/future/core-architecture/HANDOFF.md` for the active architecture queue.
