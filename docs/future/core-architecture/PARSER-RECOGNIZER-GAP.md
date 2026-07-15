# Parseman versus Less parser gap

Status: attribution complete; the first generic implementation proof now exists
in Parseman as an unpublished local commit, with Jess adoption still pending a
published dependency and fresh Jess parser A/B, 2026-07-15.

This is a parser-generation investigation, separate from CSS/Less trivia policy
and separate from Jess AST-shape experiments. The goal is to identify the work
Parseman must perform for recognition in general, then leave Less-specific
late-value decisions to the Less grammar and host.

## Current measurements

The established same-fixture phase profile is:

| Phase | Median |
| --- | ---: |
| Parseman recognizer-only | 12.784 ms |
| Parseman structural capture | 28.873 ms |
| Parseman CSS-CST host construction | 37.558 ms |
| Less 4.6.3 native AST parse | 4.417 ms |

The run used the 106,797-byte Less fixture, Node v24.11.1 on the M4 Pro,
12 warmups, and 45 samples. A later equal-contract run measured Parseman
recognizer-only at 12.58 ms and Less parsing at 6.01 ms; it is useful for
direction, but the phase profile above remains the detailed attribution
baseline until the fixture/node-count discrepancy is reconciled.

These numbers do not mean that Jess AST construction alone costs 8 ms. The
recognizer is already 2.89x the Less parse in the detailed run, before CST or
host construction.

## What the current Parseman recognizer actually does

The current outputless pass is the same generated structural parser with a
runtime output mode. It is not a separately compiled `voidOf` parser.

At entry, `runOnce` still creates parse-result/profile state and runs the
recognizer through the normal generated context. The outputless path avoids
some retained collector data, but the generated rule bodies still perform the
structural protocol:

1. save and install collector/trivia state;
2. enter the fallible parser body and rollback machinery;
3. restore collector/trivia state;
4. execute profile/output branches whose result is discarded;
5. cross named-rule function boundaries with shared parser state.

For the Less grammar, a declaration also enters the generated value ladder:

```text
valueList -> valueSequence -> topSum -> topProduct -> operand -> value
```

`valueSequence` and `valueList` still allocate aggregate arrays across named
rule boundaries even when their values are not needed for recognition. Regex
terminals also execute ordinary `RegExp.exec` paths.

## What Less 4.x does differently

Less 4.6.3 uses one mutable cursor plus a compact save/restore/forget stack.
That cursor is part of the advantage because parse position and rollback stay
in a small scalar state, but it is not the entire explanation. Less also:

- has no CST/structural collector frame protocol;
- tries declaration before ruleset in ordinary body dispatch;
- parses many ordinary values through `anonymousValue()` without entering its
  full value grammar;
- allocates native AST objects only after a path succeeds.

On `benchmark.less`, 2,024 of 2,902 declarations (69.7%) take Less's raw
anonymous-value route. Jess's current deferred route is narrower and therefore
enters more of the value grammar. This is a Less-grammar/input-shape difference,
not a generic Parseman trivia decision.

## Decisive experiment — true recognizer POC

The analysis-only Parseman follow-up first recorded the generic implementation
ranking in `/Users/matthew/git/oss/parser-thing/notes/PERF_IDEAS.md` at
isolated documentation commit `916c52b`. A follow-up then implemented the
highest-upside generic proof in Parseman branch
`feature/true-recognizer-20260715`, local commit `c84d777`. The commit is not
published because SSH credentials were unavailable from that checkout; it is
not yet a Jess dependency change.

`compile(..., { mode: 'recognizer' })` now emits a separate acceptance/end/
failure-cursor contract at code-generation time. It removes output-only work
from generated code:

- collector setup/install/restore;
- CST child/raw/trivia collection;
- host/node construction;
- output-only profile and parent-push branches;
- dead output temporaries and state cloning.

The POC retains lookahead, guards, context operations, rollback/failure
semantics, consumed offsets, and diagnostics. Its acceptance evidence includes
semantic parity tests, generated-code inspection, focused contract/perf tests,
and equal-contract timing against the current recognizer. A neutral or
regressing result remains a valid rejection; no CSS/Less-specific behavior
belongs in this Parseman change.

The result separates two hypotheses:

- the 25% Less-grammar drop proves that generated output/capture protocol is a
  material recognizer penalty;
- the remaining gap means grammar shape, dispatch, regex, and value-recognition
  work still matter, so the POC is not by itself a Less-4.x parity result.

## POC result and interpretation

The equal-contract proof improved JSON-like 16,946-byte parsing from
`0.180875` to `0.095291 ms` (−47.32%, p95 `0.236375` to `0.119792 ms`) and
the real 106,802-byte Less grammar from `7.38425` to `5.534 ms` (−25.06%,
p95 `8.0435` to `5.96925 ms`), with zero GC events. Focused contract tests
were `39/39`, perf tests `5/5`, and typecheck/build/lint passed. The Parseman
full suite still has one pre-existing source-shape failure at
`test/unit/build-arity.test.ts:116` (`1,735` passed, `1` failed); it is not
evidence against the recognizer behavior.

The artifact retains lookahead, guards, context operations, rollback/failure
semantics, consumed offsets, and diagnostics. It is generic Parseman behavior,
not CSS/Less trivia logic. Do not claim Jess speed movement until the published
dependency is rebuilt and Jess's own parser/render contract is A/B tested.

## Follow-up order

1. Publish or otherwise make the Parseman recognizer artifact consumable, then
   rebuild the Jess parser chain and rerun equal-contract recognizer/capture/
   host measurements on the same fixture/runtime.
2. The generic zero-copy structural-builder POC is complete as local Parseman
   commit `950e8b4`. It passes `62` focused tests and improves the generic
   structural benchmark `10.97→4.35 ms` with identical output, but transient
   heap regresses `1.95→7.17 MB`. Keep it as an evidence artifact; do not call
   it a Jess win until a `compileLinkable`/fused-host integration is built and
   measured, and do not hide the memory regression.
3. Measure declaration-versus-ruleset candidate attempts; current Jess body
   order tests `Ruleset` before `Declaration` for overlapping inputs.
4. Expand Less-specific late materialization only with semantic predicates for
   variables, interpolation, comments, math, custom properties, filters, and
   source maps.
5. Revisit generic capture/raw-child representations only if fresh evidence
   shows the stripped recognizer leaves capture protocol as the dominant cost.

Do not infer from this investigation that every value should become a string,
that Parseman should understand CSS comments, or that the existing Jess AST
must preserve its current node cardinality. Those are separate, measured
representation decisions.
