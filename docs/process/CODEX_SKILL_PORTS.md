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

Claimed as ported but **not actually present** in `~/.codex/skills` (verified
2026-07-30 — the seven above do exist there; this one does not):

- `jess-perf-architecture` (source: `.cursor/skills/perf-architecture/`; the
  numbered V8-architecture invariants + regression catalogue from
  `docs/perf/V8-ARCHITECTURE.md` — read the invariant list from that file
  rather than restating a count here, since the list grows)

Recommendation (see `docs/architecture/llm-quality-enforcement-design.md`): keep each
skill's authored source in-repo under `.cursor/skills/` and treat
`~/.codex/skills` as a generated copy synced from it, so every skill is
versioned and parity-checkable instead of hand-edited out of tree.

Not ported as separate Jess skills because Codex already has stronger generic
skills for the same role:

- `.cursor/skills/systematic-debugging`
- `.cursor/skills/verification-before-completion`
- `.cursor/skills/subagent-review`

Keep future durable guidance in one of:

- `AGENTS.md` for cross-tool repo rules;
- a Codex skill when Codex should auto-trigger it by task shape;
- a Cursor rule/skill only when the behavior is Cursor-specific;
- `docs/architecture/core/HANDOFF.md` for the active architecture queue.
