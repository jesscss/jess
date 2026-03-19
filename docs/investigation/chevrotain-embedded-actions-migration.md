# Migration Plan: @jesscss/parser → Chevrotain EmbeddedActionsParser

**Paths assumed:** Jess at `~/git/oss/jess`, Chevrotain fork at `~/git/oss/chevrotain` (branch `rd-engine-replacement`).

---

## 1. Overview

This document outlines a phased migration from Jess's custom `@jesscss/parser` (RecursiveDescentParser) to Chevrotain's `EmbeddedActionsParser` from the fork. The goal is to consolidate on a single parser engine while preserving Jess's AST output, error recovery, and whitespace/trivia handling.

### Parser hierarchy (current)

```
RecursiveDescentParser (@jesscss/parser)
  └─ CssRecursiveParser
       ├─ ScssRecursiveParser
       │    └─ JessRecursiveParser
       └─ LessRecursiveParser
```

- **Less-parser** and **Scss-parser** are siblings (both extend CssRecursiveParser).
- **Jess-parser** extends ScssRecursiveParser (Jess = SCSS + Jess-specific syntax).

---

## 2. @jesscss/parser DSL Usage Map

### 2.1 DSL methods by package

| DSL Method | css-parser | less-parser | scss-parser | jess-parser |
|------------|------------|-------------|-------------|-------------|
| CONSUME | ✓ (89+) | ✓ (102+) | ✓ (240+) | ✓ (33+) |
| OR | ✓ | ✓ | ✓ | ✓ |
| MANY | ✓ | ✓ | ✓ | ✓ |
| OPTION | ✓ | ✓ | ✓ | ✓ |
| AT_LEAST_ONE | ✓ | ✓ | ✓ | ✓ |
| MANY_SEP | — | ✓ (guards.ts) | ✓ (atRules.ts) | — |
| AT_LEAST_ONE_SEP | — | ✓ (selectors.ts) | ✓ (atRules.ts) | — |
| SUBRULE | ✓ | ✓ | ✓ | ✓ |

### 2.2 Key files per package

| Package | Production files |
|---------|-------------------|
| css-parser | `selectors.ts`, `values.ts`, `atRules.ts`, `misc.ts` |
| less-parser | `selectors.ts`, `guards.ts`, `values.ts`, `root.ts` |
| scss-parser | `selectors.ts`, `atRules.ts`, `values.ts`, `conditions.ts` |
| jess-parser | `productions.ts`, `values.ts`, `root.ts`, `mixins.ts`, `controlFlow.ts`, `atRules.ts` |

### 2.3 Internal mechanisms (not DSL, but used by productions)

| Mechanism | Location | Purpose |
|-----------|----------|---------|
| saveState / restoreState | parser.ts | Speculative backtracking in OR, MANY, OPTION |
| LA(1), LA(2), LA(0) | parser.ts | Lookahead |
| speculating, SPEC_FAIL | parser.ts | Zero-cost failure in speculative alts |
| GATE | OrAlternative, ManyOptions | Predicate for alt/loop selection |
| tryConsume | parser.ts | Zero-allocation token check |

---

## 3. Chevrotain EmbeddedActionsParser API (fork)

### 3.1 Constructor and setup

```ts
constructor(tokenVocabulary: TokenVocabulary, config?: IParserConfig)
performSelfAnalysis(): void  // Must be called at end of constructor
```

- **tokenVocabulary**: Object or array of token types.
- **input**: Set via `parser.input = tokens` (IToken[]).
- **performSelfAnalysis()**: In the fork's rd-engine-replacement, this can be a no-op when recording is disabled (Stage 6).

### 3.2 DSL methods (from `recognizer_api.ts`)

| Method | Signature | Notes |
|--------|------------|-------|
| CONSUME | `(tokType, options?)` | Consumes token, throws on mismatch |
| OR | `(alts: IOrAlt<T>[] \| OrMethodOpts<T>)` | GATE + ALT supported |
| OPTION | `(action \| DSLMethodOpts)` | GATE + DEF supported |
| MANY | `(action \| DSLMethodOpts)` | GATE + DEF supported |
| AT_LEAST_ONE | `(action \| DSLMethodOptsWithErr)` | GATE + DEF supported |
| MANY_SEP | `(opts: ManySepMethodOpts)` | SEP + DEF |
| AT_LEAST_ONE_SEP | `(opts: AtLeastOneSepMethodOpts)` | SEP + DEF |
| SUBRULE | `(rule, ...args)` | Calls another rule |
| ACTION | `(impl)` | Wraps semantic actions (no-op when not recording) |

### 3.3 IOrAlt and GATE

```ts
interface IOrAlt<T> {
  GATE?: () => boolean;
  ALT: () => T;
}
```

Chevrotain fork supports GATE on OR, OPTION, MANY, AT_LEAST_ONE. Fast-dispatch cache evaluates GATE at runtime.

### 3.4 MANY_SEP / AT_LEAST_ONE_SEP options

```ts
interface ManySepMethodOpts<OUT> {
  SEP: TokenType;
  DEF: () => void;
}

interface AtLeastOneSepMethodOpts<OUT> {
  SEP: TokenType;
  DEF: () => void;
}
```

Jess uses `{ SEP, DEF }` — compatible.

### 3.5 Fork-specific behavior (rd-engine-replacement)

- **SPEC_FAIL** symbol for speculative backtracking (no Error allocation).
- **IS_SPECULATING** boolean.
- **saveRecogState()** returns 3 integers (pos, errorsLength, ruleStackDepth).
- **LL(1) fast-dispatch** for OR when LA(1) determines the alt.
- **GATE** checked on fast path; context-sensitive gates supported.

---

## 4. Compatibility Layer Needs

### 4.1 hasWS() / noSep()

**Jess usage:**
- `hasWS()`: Returns true if there is whitespace before the next token. Used in GATEs (e.g. `!$.hasWS() && !(ctx.inExtend && $.isType($.T.All))`).
- `noSep(offset?)`: Returns true if there is NO whitespace/comments before the token at `pos + offset`. Used in GATEs (e.g. `$.noSep.bind(this)`).

**Implementation:** Jess uses `hasWSBeforeByPos` and `hasSepBeforeByPos` (Uint8Array) indexed by filtered token position, populated when `input` is set.

**Chevrotain:** No built-in equivalent. The fork uses `tokVector` (filtered tokens) and `lexerState` / position. Skipped tokens are typically not in `tokVector`.

**Shim strategy:**
1. Build parallel `hasWSBeforeByPos` / `hasSepBeforeByPos` when setting `input`, from the original token stream (including skipped).
2. Add `hasWS()` and `noSep(offset?)` as extension methods on a Jess-specific subclass of EmbeddedActionsParser.

### 4.2 preSkippedTokenMap / postSkippedTokenMap

**Jess usage:** Maps token offsets to preceding/following skipped token arrays. Used by `wrap()` to attach `pre`/`post` trivia to AST nodes.

**Chevrotain:** LexerAdapter filters tokens; skipped tokens are not in `tokVector`. Chevrotain does not expose pre/post skipped maps by default.

**Shim strategy:**
1. When setting `input`, if the lexer provides the full stream (including skipped), build `preSkippedTokenMap` and `postSkippedTokenMap` in the same way Jess does.
2. Ensure the Jess lexer output includes skipped tokens, or that we have access to the unfiltered stream before passing to the parser.
3. Add `getPrePost(offset, post?, ctx?)` and `wrap(node, post?, ctx?)` to the compatibility layer.

### 4.3 context (TreeContext)

**Jess usage:** `$.context` holds TreeContext (from @jesscss/core) for AST node construction.

**Chevrotain:** No `context` property. Parser subclasses can add it.

**Shim strategy:** Add `context` as a property on the Jess parser subclass. Set before parsing.

### 4.4 buildTokenTypeSet / tokenMatches

**Jess usage:** `buildTokenTypeSet(tokenTypes)` returns a Uint32Array bitset for O(1) membership. `tokenMatches(token, expected)` uses MATCH_BITS on token types.

**Chevrotain fork:** Uses `MATCH_SET` (Uint32Array) and `tokenStructuredMatcher` / `tokenMatcher`. API may differ.

**Shim strategy:**
1. If Chevrotain's `tokenMatcher` is compatible, use it.
2. Otherwise, keep `tokenMatches` from @jesscss/parser or reimplement using Chevrotain's augmented token types.
3. `buildTokenTypeSet` is Jess-specific for token sets (e.g. `SIMPLE_NAME_START`). Implement as a helper that builds a bitset from Chevrotain-augmented token types.

### 4.5 startRule / endRule

**Jess usage:** `startRule()` pushes a location tuple onto `locationStack`; `endRule()` pops and fills end coords. Used for span calculation of AST nodes.

**Chevrotain:** No equivalent. CstParser uses CST stack; EmbeddedActionsParser does not build CST.

**Shim strategy:** Add `startRule()` and `endRule()` to the compatibility layer. They operate on `locationStack` and `LA(1)`/`LA(0)`.

### 4.6 wrap()

**Jess usage:** `wrap(node, post?, ctx?)` attaches `pre`/`post` trivia from `getPrePost()` to AST nodes. Uses `preSkippedTokenMap`, `postSkippedTokenMap`, and `usedSkippedTokens` for speculative rollback.

**Shim strategy:** Implement `wrap()` in the compatibility layer, using the same logic as CssRecursiveParser. Depends on skipped-token maps and `getPrePost()`.

### 4.7 processValueToken

**Jess usage:** Converts a token to an AST node (Any, Color, Dimension, Num, etc.). Parser-specific.

**Shim strategy:** Keep as a method on CssRecursiveParser (or equivalent). No parser-engine dependency.

---

## 5. Migration Phases

### Phase (a): Compatibility shim / adapter

**Goal:** Create a base class that extends Chevrotain's EmbeddedActionsParser and adds all Jess-specific APIs so productions can run unchanged.

**Tasks:**
1. Create `JessEmbeddedActionsParser` (or similar) extending `EmbeddedActionsParser`.
2. Override `input` setter to build `preSkippedTokenMap`, `postSkippedTokenMap`, `hasWSBeforeByPos`, `hasSepBeforeByPos` from the token stream.
3. Add `hasWS()`, `noSep(offset?)`, `startRule()`, `endRule()`, `getLocationInfo()`, `getLocationFromNodes()`.
4. Add `context` property.
5. Add `wrap()`, `getPrePost()` — requires `usedSkippedTokens` and rollback support in save/restore.
6. Integrate `buildTokenMatchBitsets` / `buildTokenTypeSet` / `tokenMatches` with Chevrotain's token augmentation.
7. Ensure `performSelfAnalysis()` is called (or is a no-op in the fork).
8. Map Chevrotain's `errors` (IRecognitionException[]) to Jess's `ParseError[]` if types differ.
9. Add `tryConsume`-like helper if not present (Chevrotain may use different internal API).

**Deliverable:** A drop-in base class that passes a minimal smoke test (parse a trivial CSS rule).

**Acceptance criteria:**
```bash
pnpm --filter @jesscss/parser test -- --run -t "smoke"
# Expected: Smoke test passes with new base class
```

---

### Phase (b): css-parser first

**Goal:** Migrate CssRecursiveParser from RecursiveDescentParser to the new base (EmbeddedActionsParser + shim).

**Tasks:**
1. Change `CssRecursiveParser extends RecursiveDescentParser` to `extends JessEmbeddedActionsParser`.
2. Pass `tokenVocabulary` (T + EOF) and config to `super()`.
3. Call `performSelfAnalysis()` at end of constructor.
4. Replace any @jesscss/parser-specific imports with Chevrotain equivalents where possible.
5. Ensure `buildTokenMatchBitsets` is called with the correct token set.
6. Verify all productions: CONSUME, OR, MANY, OPTION, AT_LEAST_ONE, SUBRULE.
7. Verify `wrap()`, `startRule()`, `endRule()`, `context` work in productions.
8. Run css-parser tests.

**Files affected:**
- `packages/css-parser/src/cssRecursiveParser.ts`
- `packages/parser/` (if base class lives there) or new `packages/parser-compat/`

**Acceptance criteria:**
```bash
pnpm --filter @jesscss/css-parser test -- --run
pnpm run verify:baseline
# Expected: All tests pass, baseline green
```

---

### Phase (c): less-parser

**Goal:** Migrate LessRecursiveParser. It extends CssRecursiveParser, so it inherits the new base. Main work is ensuring LESS-specific productions work.

**Tasks:**
1. Verify LessRecursiveParser inherits correctly from migrated CssRecursiveParser.
2. Ensure MANY_SEP, AT_LEAST_ONE_SEP work (guards.ts, selectors.ts).
3. Ensure `hasWS()`, `noSep()` work in GATEs (selectors.ts line 357, guards.ts line 369, selectors.ts line 895).
4. Ensure `wrap()`, `startRule()`, `endRule()`, `context` work.
5. Run less-parser tests and baseline.

**Files affected:**
- `packages/less-parser/src/lessRecursiveParser.ts`
- `packages/less-parser/src/productions/*.ts` (no changes if shim is complete)

**Acceptance criteria:**
```bash
pnpm --filter @jesscss/less-parser test -- --run
pnpm run verify:baseline
# Expected: All tests pass, baseline green
```

---

### Phase (d): scss-parser

**Goal:** Migrate ScssRecursiveParser. Extends CssRecursiveParser.

**Tasks:**
1. Verify ScssRecursiveParser inherits correctly.
2. Ensure MANY_SEP, AT_LEAST_ONE_SEP work (atRules.ts).
3. Ensure LA(1), LA(2), GATE, tokenMatches work in atRules.ts (many LA usages).
4. Run scss-parser tests and baseline.

**Files affected:**
- `packages/scss-parser/src/scssRecursiveParser.ts`
- `packages/scss-parser/src/productions/*.ts`

**Acceptance criteria:**
```bash
pnpm --filter @jesscss/scss-parser test -- --run
pnpm run verify:baseline
# Expected: All tests pass, baseline green
```

---

### Phase (e): jess-parser

**Goal:** Migrate JessRecursiveParser. Extends ScssRecursiveParser.

**Tasks:**
1. Verify JessRecursiveParser inherits correctly.
2. Ensure all Jess-specific productions work.
3. Run jess-parser tests and full Jess test suite.
4. Run `verify:baseline`.

**Files affected:**
- `packages/jess-parser/src/jessRecursiveParser.ts`
- `packages/jess/test/less/all-less.test.ts` (baseline)

**Acceptance criteria:**
```bash
pnpm --filter @jesscss/jess-parser test -- --run
pnpm run verify:baseline
# Expected: All tests pass, baseline green
```

---

## 6. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Chevrotain fork API drift | High | Pin to specific fork commit; run fork tests before migration |
| Skipped-token handling differs | High | Build pre/post maps in input setter; validate with wrap() tests |
| performSelfAnalysis required | Medium | Fork may make it optional; call it or stub |
| Error type mismatch | Medium | Map IRecognitionException to ParseError where needed |
| Performance regression | Medium | Benchmark before/after; fork's speculative engine should be comparable |
| Node 22+ requirement (fork) | Low | Document; bump Jess Node if needed |
| GATE semantics differ | Medium | Fork supports GATE; validate with predicate_spec tests |

---

## 7. Acceptance Criteria (Summary)

- **Baseline:** `pnpm run verify:baseline` passes after each phase.
- **No regressions:** All existing parser tests pass.
- **AST shape:** Output AST matches current shape (no structural changes).
- **Error recovery:** Recovery mode still works for language services.
- **Content assist:** If applicable, content-assist paths still work.

---

## 8. Rough Effort

| Phase | Effort | Notes |
|-------|--------|-------|
| (a) Compatibility shim | 3–5 days | Most critical; get skipped-token + hasWS/noSep right |
| (b) css-parser | 1–2 days | Straightforward if shim is complete |
| (c) less-parser | 1–2 days | Inherits; validate MANY_SEP, hasWS, noSep |
| (d) scss-parser | 1–2 days | Inherits; validate LA(2), complex GATEs |
| (e) jess-parser | 0.5–1 day | Inherits; smoke test |
| **Total** | **7–12 days** | Assumes fork is stable and tests pass |

---

## 9. Dependencies

- Chevrotain fork at `rd-engine-replacement` must be built and linked (see `chevrotain-fork-and-gate-removal.md`).
- Jess lexer output must include skipped tokens (or we have access to the full stream) for pre/post map construction.
- `@jesscss/parser` can be deprecated/removed after migration; `@jesscss/core` types (LocationInfo, etc.) remain.

---

## 10. References

- `docs/investigation/chevrotain-fork-and-gate-removal.md` — Fork setup, gate removal
- `~/git/oss/chevrotain/RD_ENGINE_PLAN.md` — Fork architecture
- `packages/parser/src/parser.ts` — Current RecursiveDescentParser
- `packages/css-parser/src/cssRecursiveParser.ts` — CssRecursiveParser, wrap()
- Chevrotain fork: `packages/chevrotain/src/parse/parser/traits/recognizer_api.ts`, `recognizer_engine.ts`
