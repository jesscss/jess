# Grammar — Record Map (sub-map)

> The grammar area's authoritative-source index, linked from
> [docs/RECORD-MAP.md](../../RECORD-MAP.md). The four dialect grammars live in
> `packages/syntax/{css,less,scss,jess}/*-parser/src/grammar.ts`; css is the base,
> the three dialects extend it. Before proposing a grammar plan, read the doc that
> owns your topic below — most "is this already decided?" answers are already
> written down here.

## Which doc owns which question

- **"How do dialects compose on css / delete their restated skeleton?" (Stage A–D, the dedup)** →
  [design/COMPOSE-MIGRATION-SPEC.md](../../design/COMPOSE-MIGRATION-SPEC.md). This is the **method of record**. It already contains: §4 the classification method (structural-inherit vs genuine-override vs addition vs interpolation-at-leaves, verified against code), §5 the staged/gated plan, §8 the scss selector pilot result (compose mechanism **PROVEN**, 0 fallbacks) **and the SETTLED owner decision P28 — converge dialect CST names/shapes to css**, §9 the enumerated CST-name convergence worklist (main selector tower already DONE). If you are about to ask "should we do a Stage-C design pass?" the answer is in §8/§9 — it's done.

- **"What's the overall rebuild status / plan / what gates what?"** →
  [design/GRAMMAR-REBUILD-SPEC.md](../../design/GRAMMAR-REBUILD-SPEC.md) **§0**. STALENESS WARNING: §0.2's parseman version and the §0.5/§5.x "compose is blocked / proceed as terminal leaves" framing are **superseded** — the compose blocker was lifted (parseman 0.49.0; repo now on a later floor) and COMPOSE-MIGRATION-SPEC is the live method. Trust §0's structure, re-verify every version/number against `pnpm-lock.yaml` and the code.

- **"Is this grammar edit acceptable?" (the bar every `const` is held to)** →
  [GRAMMAR-REVIEW-STANDARD.md](GRAMMAR-REVIEW-STANDARD.md) — the numbered checklist + four hard rules (supersets import+compose css; a copy is a violation; extend css one rule at a time; valid CSS valid in all dialects one-way). The `grammar-reviewer` agent gates on it and must output evidence PER CONST.

- **"What's the sequencing / who's doing what right now?"** →
  [state/GRAMMAR-DEDUP-LOG.md](../../state/GRAMMAR-DEDUP-LOG.md) — the live worklog and standing backlog. Accreted; treat older lanes as history and verify against current code (parseman + the fold have moved since much of it was written).

- **"How big is each grammar / what's the measured delta?"** →
  [state/GRAMMAR-SIZE-FACTS.md](../../state/GRAMMAR-SIZE-FACTS.md). Re-measure with `wc -l`; do not quote.

- **"Which parseman combinator do I use here?"** →
  [PARSEMAN-COMBINATOR-CHEAT-SHEET.md](PARSEMAN-COMBINATOR-CHEAT-SHEET.md) (`dispatch` vs `choice`, `when`, `routed`, `balanced`/`scanTo` caveats).

- **"What sequence do grammar units run in / orchestration?"** →
  [GRAMMAR-SEQUENCE-ORCHESTRATION.md](GRAMMAR-SEQUENCE-ORCHESTRATION.md).

## Ledger rows this map routes to

`OWNER-LEDGER:` the authority for each row below is its entry in
[architecture/core/DESIGN-DECISIONS.md](../core/DESIGN-DECISIONS.md) — read that
row. This map only routes to it, so a plan checks the ledger before re-deriving:

- **P28** — converge dialect CST names/shapes to css; a mere different spelling of the same shape is converged, a genuine difference stays an override.
- **P29** — a root-level leading combinator (`> .a {}` at the stylesheet top) is rejected (no parent to relate to); nested `> .a` is accepted in all four dialects.
- **P30** — a top-level `&` is accepted, representing `:scope` (CSS Nesting L1 §4); it emits `&` verbatim (or collapses per `collapseNesting`), with no `:scope` rewrite.
- **Naming law (Rule 4 / GRAMMAR-REVIEW-STANDARD)** — no dialect prefix on a rule NAME; the emitted grammarType STRING is the CST contract (a rename ripples into the ungated language-service + diagnostics-core — converge those in the same change). A JS const NAME is not a grammarType violation on its own (e.g. `LiteralQuoted` is a producer const that emits `'Quoted'`).
