# Parseman Grammar Benchmark Ledger

This is the durable log for grammar-parser timing evidence gathered while Jess
moves across Parseman versions and adopts newer grammar shapes such as
`dispatch(...)`.

Use this ledger for small, repeatable rows. It is not a release benchmark and it
is not a substitute for correctness gates. A row is usable only when the parser
was rebuilt from the measured commit and the macro/compose gates prove the
shipping tree did not fall back to the interpreter.

Append raw run records to
`docs/architecture/parser/parseman-jess-parse-benchmarks.jsonl`. The JSONL file
is the canonical progressive data store; the Markdown table below is only the
human summary.

## Required Proof

Record these facts with every row:

- Parseman version and resolved workspace package version.
- Jess commit and branch/worktree.
- Grammar package and benchmark command.
- Corpus/surface, file count, KB, and median milliseconds.
- `check:macro` result and `verify:compose-integrity` result.
- Any case filter, warmup count, timed count, and machine-local caveat.

If either macro gate is red, the row may be recorded only as diagnostic data and
must say that it is not performance evidence.

For the Jess parser harness, `loadErrors` in the emitted JSON must be empty.
Non-empty `loadErrors` means the public AST or CST module failed before parsing;
that surface is omitted from timing and the row is diagnostic only.

## Jess Parser Harness

The Jess parser benchmark lives at
`packages/syntax/jess/jess-parser/test/parse-bench.mjs`.

Command:

```sh
pnpm --filter @jesscss/jess-parser build
node packages/syntax/jess/jess-parser/test/parse-bench.mjs <label> [warmup=8] [timed=25]
```

Optional case filter:

```sh
BENCH_CASES=jess-parser-data node packages/syntax/jess/jess-parser/test/parse-bench.mjs <label> 8 25
```

## Progressive Recording

Preferred command:

```sh
pnpm run bench:jess:parse:record -- --label <label> --warmup 8 --timed 25 --note "<short note>"
```

The recorder appends one JSON line containing:

- pinned and resolved Parseman versions;
- Jess branch, commit, and dirty-worktree flag;
- Node/OS/CPU context;
- build, `check:macro`, and `verify:compose-integrity` statuses;
- benchmark samples from AST and CST surfaces;
- `usableEvidence`, which is `true` only when the build, both macro gates, the
  benchmark command, and `loadErrors` are clean.

Rows with `usableEvidence: false` are still worth keeping as diagnostic
chronology. Do not cite them as speed evidence.

## Rows

| Date | Parseman | Jess commit | Branch/worktree | Command | Corpus/surface | Files/KB | Median ms | Macro/compose proof | Notes |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- | --- |
| 2026-07-26 | 0.39.0 | `52db1e072256` | `dev` dirty | `pnpm run bench:jess:parse:record -- --label parseman-0.39.0-current-diagnostic --warmup 2 --timed 3` | Jess AST+CST load probe | n/a | n/a | red/red | Diagnostic row only. Jess AST and CST public modules failed to load with `compose: a composeLeaf() result is terminal and cannot be composed again`; no parse timing was recorded. |
| pending | pending | pending | pending | `node packages/syntax/jess/jess-parser/test/parse-bench.mjs <label> 8 25` | `jess-grammar/ast+cst` | pending | pending | pending | First usable row waits for the Jess parser build plus `check:macro` and `verify:compose-integrity` to be green on the measured state. |
