# Owner requirements — verbatim, immutable to agents

**This file is owner-owned. An agent may not edit it.**

Every standing owner requirement is recorded here **verbatim**, with a stable ID
and the source it was pulled from. Paraphrase is not permitted: a requirement is
quoted exactly or it is not in this file.

`pnpm check:guardrails` recomputes this file's content hash and fails on any
mismatch. Updating the recorded hash is the owner's act, not an agent's. If a
requirement conflicts with a tool constraint, a technical limit, or an
implementation difficulty, **STOP AND ESCALATE** — record the constraint, the
evidence, the options and a recommendation, and let the owner decide. Do not
edit this file to make the conflict go away.

The rule that governs this file is stated in
[`architecture/parser/GRAMMAR-REVIEW-STANDARD.md`](./architecture/parser/GRAMMAR-REVIEW-STANDARD.md)
("An agent may not redefine, narrow, or close an owner requirement") and in
[`../.cursor/rules/00-global.mdc`](../.cursor/rules/00-global.mdc).

---

## OR-1 — the four hard rules of grammar composition

Source: `docs/architecture/parser/GRAMMAR-REVIEW-STANDARD.md` §"The four hard
rules" (landed `ee67bcf1c`), transcribed there as owner-verbatim; ledger row
`docs/architecture/core/DESIGN-DECISIONS.md` **P22**, owner ruling 2026-08-09.

> The hard rules that no agent is allowed to violate:
>
> 1. CSS grammar defines all regular CSS
> 2. Each downstream grammar MUST extend CSS grammar (import and compose)
> 3. Each downstream grammar may ONLY define specific overrides. (It may not
>    define ANY shape that exists in css-grammar already and could have been
>    used.)
> 4. Each downstream grammar MAY NOT create a new rule just because it's
>    changing PARSING for that rule. e.g. a Quoted in CSS is still a Quoted in
>    every other language, even though it adds interpolation.

## OR-2 — build from scratch, never copy/paste

Source: `docs/design/GRAMMAR-REBUILD-SPEC.md` §0.1, quoted there as an owner
requirement and used as the acceptance definition.

> build each grammar from scratch with an enforcement rule of never
> copy/pasting

## OR-3 — start with CSS; the others link to it

Source: `docs/design/GRAMMAR-REBUILD-SPEC.md` §0.1.

> it should start with CSS, and then the others should have an agent-readable
> link to those

## OR-4 — acceptance definition for the four grammars

Source: `docs/design/GRAMMAR-REBUILD-SPEC.md` §0.1.

> all 4 grammars shiny and new and don't look anything like the old ones and
> have 1 grammar file each … and all parsing tests passing for each, and the
> language service tests passing

## OR-5 — no carried-over shapes or names

Source: `docs/design/GRAMMAR-REBUILD-SPEC.md` §0.1.

> Don't keep the same parseman combinator shapes, don't keep the same node names
> (each syntax shouldn't have bespoke naming schemes IMO?)

## OR-6 — the rebuild method

Source: relayed to this session by the coordinating agent as an owner
requirement. **UNVERIFIED against a committed in-tree source** — no file in
`docs/`, `.cursor/`, `CLAUDE.md`, or `AGENTS.md` at `ee67bcf1c` contains this
string. Recorded verbatim as relayed; the owner should confirm or strike it.

> start over for each grammar. Extend CSS, then only copy in the delta, one rule
> at a time.

---

## What this file does NOT do

It does not resolve conflicts. Where a requirement above collides with a real
constraint, the constraint is documented at the work site with its evidence, the
collision is named as **UNRESOLVED**, and it waits for the owner. The live
example is OR-1 rule 2 versus parseman's `direct-builder-static` allow-set —
see `docs/design/GRAMMAR-REBUILD-SPEC.md` §0.5.
