# Investigation: Chevrotain Ambiguity Handling for Speculative Backtracking Fork

## Context

The Chevrotain fork at `/git/oss/chevrotain` (branch `rd-engine-replacement`) replaces LL(k) lookahead with speculative backtracking. This means:

1. **Ambiguous alternatives are handled at runtime** — the engine tries each alt speculatively and commits to the first that succeeds.
2. **The old LL(k) ambiguity validation is no longer relevant** — it detects cases where k-token lookahead can't distinguish alternatives, but speculative backtracking doesn't use lookahead.
3. **However**, `performSelfAnalysis()` still runs validation and **throws on ambiguity detection**, which crashes the parser constructor.

## Current Behavior (Problem)

When `performSelfAnalysis()` runs, it:
1. Records the grammar (RECORDING_PHASE) — walks all RULE bodies with mock tokens
2. Validates the grammar — checks for ambiguities using the recorded GAST
3. **Throws** if ambiguities are detected (e.g., `<Not, LParen, Ident> may appear as a prefix path in all these alternatives`)

This crash is a **hard error** — the parser fails to construct at all.

## Current Workaround

Setting `skipValidations: true` in the parser config. This skips all grammar validation including useful checks (left recursion detection, etc.).

## What Needs to Be Decided

1. **Should ambiguity detection be a warning instead of an error?** The fork's speculative engine handles ambiguities correctly at runtime. Ambiguity detection could still be useful as a diagnostic (for perf — ambiguous alts require speculation), but shouldn't prevent construction.

2. **Should we add a new validation mode?** E.g., `validationMode: 'warn' | 'error' | 'skip'` that allows ambiguity warnings while keeping other validations (left recursion, etc.) as errors.

3. **Should we keep validation useful?** The LL(k) ambiguity check is semantically wrong for the speculative engine — it reports "ambiguities" that the engine resolves fine. But left recursion detection IS still relevant (speculative backtracking with left recursion = infinite loop). So separating these validations would be valuable.

## Where to Look

- **Validation logic**: `packages/chevrotain/src/parse/parser/parser.ts` — `performSelfAnalysis()` flow
- **Ambiguity checks**: Search for `AMBIGUOUS_ALTERNATIVES` in `packages/chevrotain/src/parse/grammar/checks.ts`
- **Error throwing**: `packages/chevrotain/src/parse/parser/parser.ts` line ~244 (where validation errors become thrown exceptions)
- **Stage 5 lazy init**: The fork already makes GAST population lazy (`ensureGastProductionsCachePopulated` in the input setter). Validation could be made lazy too, or split into "critical" (left recursion) and "informational" (ambiguity).

## Recommended Approach

1. In the fork, change ambiguity validation from a thrown error to a console warning (or a stored warning array accessible via `parser.ambiguityWarnings`)
2. Keep left recursion detection as a hard error (it causes infinite loops)
3. Consider adding `IParserConfig.ambiguityHandling: 'error' | 'warn' | 'ignore'` defaulting to `'warn'`
4. This lets us remove `skipValidations: true` from the css-parser while still constructing successfully
