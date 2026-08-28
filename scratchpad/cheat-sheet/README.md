# Cheat-sheet probes

These are the regression test for
`docs/architecture/parser/PARSEMAN-COMBINATOR-CHEAT-SHEET.md`. Every arity,
nullability, and commit claim in that document is measured here rather than read
off a docstring — the docstrings have been wrong.

Run all of them after any `parseman` floor bump, and update the sheet in the
same change:

```sh
node scratchpad/cheat-sheet/run-all.mjs
```

| Probe | Measures |
| --- | --- |
| `coverage.mjs` | Export-coverage gate. **Exits non-zero** if any runtime export is undocumented, or if the sheet names an export that does not exist. |
| `check-045.mjs` | Which names exist on the pinned floor vs upstream only. |
| `probe-arity.mjs` | What each combinator contributes to a reducer's `children`. |
| `probe-empty-commit.mjs` | Zero-width success; failure-after-consuming; `run()` on garbage. |
| `probe-zero-arity.mjs` | Zero-contribution combinators, and `children` arity vs raw `parse()` value arity. |
| `probe-balanced-expect.mjs` | `balanced()` recovery vs acceptance; `expect()` zero-width success; lookahead-regex nullability. |
| `probe-dispatch-cut.mjs` | `dispatch()` commitment and whether `attempt()` neutralises it; `run().unconsumedFrom`. |
| `probe-structural.mjs` | `rules`/`ref`/`compose`/`composeLeaf`/`compile` authoring hard-fails and dispatch matcher shapes. |
| `harness.mjs` | Shared measurement helpers. Not a probe. |

Two things to keep in mind when extending these:

- **The error channel only exists under `parse(combinator, input, { recover: true })`.**
  A probe built on `parser({...}).parse(input)` sees `errors: 0` and will
  conclude "accepted" for input that was in fact recovered.
- **Consumption is not acceptance.** Anything whose close is wrapped in
  `expect()` succeeds on malformed input and reports through `errors`.
