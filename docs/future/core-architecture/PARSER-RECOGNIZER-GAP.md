# Parseman versus Less parser gap

Status: attribution complete; compile-time-stripped recognizer experiment in progress, 2026-07-14.

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

## Decisive experiment

The active Parseman worker is building a generic compile-time outputless
artifact. It must preserve recognition-affecting behavior while removing
output-only work from generated code:

- collector setup/install/restore;
- CST child/raw/trivia collection;
- host/node construction;
- output-only profile and parent-push branches;
- dead output temporaries and state cloning.

It must retain lookahead, guards, context operations, rollback/failure
semantics, consumed offsets, and diagnostics. Acceptance requires semantic
parity tests, generated-code inspection, and 20 warmups plus 45 timed samples
against the current recognizer on the same fixture/runtime. A neutral or
regressing result is a valid rejection; no CSS/Less-specific behavior belongs
in this Parseman change.

The result will separate two hypotheses:

- a large drop means the current runtime structural protocol is the dominant
  recognizer penalty;
- a result near 12–13 ms means the remaining gap is primarily grammar shape,
  dispatch, regex, or value-recognition work.

## Follow-up order

1. Finish the stripped recognizer and reconcile its exact counters.
2. Measure declaration-versus-ruleset candidate attempts; current Jess body
   order tests `Ruleset` before `Declaration` for overlapping inputs.
3. Expand Less-specific late materialization only with semantic predicates for
   variables, interpolation, comments, math, custom properties, filters, and
   source maps.
4. Revisit generic capture/raw-child representations only if the stripped
   recognizer proves structural output protocol is not the dominant cost.

Do not infer from this investigation that every value should become a string,
that Parseman should understand CSS comments, or that the existing Jess AST
must preserve its current node cardinality. Those are separate, measured
representation decisions.
