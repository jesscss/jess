# Design decisions — implementation notes

Implementation state for rows of the owner decision ledger,
[`DESIGN-DECISIONS.md`](DESIGN-DECISIONS.md): what landed where, which tests
pin it, what is still pending, and agent observations. One `## <row id>`
section per row, newest note last, each dated.

This file exists so the owner's rows stay the owner's words. Owner-ruled rows
are hash-locked (`owner-rulings.lock.json`, checked by
`pnpm check:guardrails`), so a note appended to one fails the gate. Write the
note here instead.

A note records state and evidence. It never restates, narrows or amends the
ruling, and Less 4.x / lessc output is not a reason for anything written here.
When the code disagrees with a ruling, record the disagreement here and
escalate it to the owner.

Existing notes inside owner rows have not been moved yet.

<!-- Format:

## P2

- 2026-10-09 (`<commit>`): <what landed, where, which test pins it>.

-->
