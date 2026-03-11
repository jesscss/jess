# Plan: Hand-Written Parser to Replace Chevrotain

## Executive Summary

Replace the Chevrotain dependency in Jess with a hand-written recursive-descent
parser runtime that preserves the existing production structure almost verbatim,
so that conversion is near-mechanical (especially for an LLM). The new runtime
must support error recovery, syntactic content assist, and live language-service
integration for a VSCode extension replacing the built-in CSS/Less/SCSS language
services.

---

## 1. Why Replace Chevrotain?

| Concern | Detail |
|---|---|
| **Dependency weight** | Chevrotain + chevrotain-allstar are ~150KB min. The LL(*) strategy alone is a separate package. |
| **Startup cost** | `performSelfAnalysis()` runs a RECORDING_PHASE over every rule, then precomputes FIRST/FOLLOW sets and lookahead functions. For 180+ rules across 4 parsers, this is non-trivial. |
| **Black-box recovery** | Chevrotain's single-token insert/delete + re-sync is generic. A hand-written parser can have grammar-aware recovery (e.g., "skip to next `;` or `}`"). |
| **Content assist control** | `computeContentAssist` walks the GAST. A hand-written equivalent can integrate semantic information (variable names, property values, mixin signatures) directly. |
| **Extensibility** | The parser inheritance chain (CSS → Less/SCSS/Jess) relies on Chevrotain's `OVERRIDE_RULE` and numbered suffixes (`OR2`, `MANY3`). A hand-written approach can use plain method override. |

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  Public API                      │
│  parse(text, rule?) → IParseResult               │
│  suggest(text, offset, rule?) → Suggestion[]     │
│  validate(text) → Diagnostic[]                   │
└────────────┬───────────────┬────────────────────┘
             │               │
    ┌────────▼──────┐  ┌─────▼──────────────┐
    │  Lexer        │  │  Parser Runtime     │
    │  (keep or     │  │  (new, hand-written)│
    │   replace)    │  │                     │
    └────────┬──────┘  └─────┬──────────────┘
             │               │
             ▼               ▼
     Token stream      AST Nodes (existing @jesscss/core)
```

### 2.1 Lexer Strategy

**Recommendation: Keep Chevrotain's lexer initially, replace later.**

The lexer is a separate concern. Chevrotain's multi-mode lexer (Default,
SingleQuoteString, DoubleQuoteString, Url) is well-optimized with
character-code-indexed pattern dispatch. The parser runtime is where the real
wins are.

Phase 2 can replace the lexer with a hand-written scanner if:
- Startup cost of `new Lexer()` is measurable
- We want to eliminate the Chevrotain dependency entirely
- We want incremental/streaming tokenization for the language service

### 2.2 Parser Runtime: Mini-DSL Approach

The key insight: **keep the DSL method names** (`CONSUME`, `SUBRULE`, `OR`,
`MANY`, `OPTION`, `AT_LEAST_ONE`, `MANY_SEP`, `AT_LEAST_ONE_SEP`) but
implement them as thin methods on a base class with no self-analysis phase.

This means the 12,000+ lines of production code across 4 parsers need
**minimal changes** — primarily removing `RECORDING_PHASE` guards and numbered
suffixes.

#### Current Chevrotain Pattern

```typescript
// Chevrotain: requires numbered variants, RECORDING_PHASE guards
$.RULE('selectorList', () => {
  let RECORDING_PHASE = $.RECORDING_PHASE;
  let selectors: Node[] = [];
  $.AT_LEAST_ONE_SEP({
    SEP: T.Comma,
    DEF: () => {
      let sel = $.SUBRULE($.complexSelector, { ARGS: [ctx] });
      if (!RECORDING_PHASE) {
        selectors.push(sel);
      }
    }
  });
  if (!RECORDING_PHASE) {
    return new SelectorList(selectors, ...);
  }
});
```

#### New Hand-Written Pattern

```typescript
// Hand-written: plain methods, no recording phase, no numbered variants
selectorList(ctx: Context): SelectorList {
  const selectors: Node[] = [];
  this.atLeastOneSep(T.Comma, () => {
    selectors.push(this.subrule(this.complexSelector, ctx));
  });
  return new SelectorList(selectors, ...);
}
```

Changes required per rule:
1. Remove `$.RULE('name', ...)` wrapper → plain method
2. Remove `RECORDING_PHASE` guards → always execute actions
3. Remove numbered suffixes (`OR2`, `MANY3`) → just `or()`, `many()`
4. Change `$.SUBRULE($.rule, { ARGS: [ctx] })` → `this.subrule(this.rule, ctx)`
5. Change `$.CONSUME(T.Foo)` → `this.consume(T.Foo)`

These are **purely mechanical transformations** — ideal for LLM conversion.

---

## 3. The Parser Runtime (Core Implementation)

### 3.1 Base Class: `RecursiveDescentParser`

```typescript
abstract class RecursiveDescentParser {
  // Token stream
  protected tokens: IToken[];
  protected pos: number;

  // State for error recovery
  protected errors: IRecognitionException[];
  protected recoveryEnabled: boolean;

  // State for content assist
  protected contentAssistEnabled: boolean;
  protected contentAssistOffset: number;
  protected contentAssistResults: ContentAssistSuggestion[];

  // Rule tracking (for error messages and content assist)
  protected ruleStack: string[];

  // --- DSL Methods (match Chevrotain names for easy migration) ---

  /** Match and consume a token of the given type */
  consume(tokenType: TokenType): IToken;

  /** Call a sub-rule */
  subrule<T>(rule: (ctx: any) => T, ctx?: any): T;

  /** Try alternatives in order, guided by lookahead */
  or<T>(alternatives: OrAlternative<T>[]): T;

  /** Zero or more repetitions */
  many(def: () => void): void;

  /** One or more repetitions */
  atLeastOne(def: () => void): void;

  /** Optional */
  option<T>(def: () => T): T | undefined;

  /** Zero or more with separator */
  manySep(sep: TokenType, def: () => void): void;

  /** One or more with separator */
  atLeastOneSep(sep: TokenType, def: () => void): void;

  // --- Lookahead ---

  /** Peek at token at offset from current position */
  la(offset: number): IToken;

  /** Check if next token matches type */
  check(tokenType: TokenType): boolean;

  /** Check if token at offset matches type */
  checkAt(offset: number, tokenType: TokenType): boolean;
}
```

### 3.2 Lookahead Strategy

**Current**: Chevrotain precomputes lookahead functions during self-analysis,
using FIRST sets. The LL(*) strategy (chevrotain-allstar) dynamically extends
lookahead when LL(k) is ambiguous.

**Proposed**: Each `or()` call receives alternatives with `GATE` or `ALT`
functions that include inline lookahead checks. For most CSS grammar
alternatives, a single token check suffices.

```typescript
// Most alternatives need only LA(1)
this.or([
  { GATE: () => this.check(T.Hash),    ALT: () => this.idSelector(ctx) },
  { GATE: () => this.check(T.Dot),     ALT: () => this.classSelector(ctx) },
  { GATE: () => this.check(T.Colon),   ALT: () => this.pseudoSelector(ctx) },
  { GATE: () => this.check(T.LSquare), ALT: () => this.attrSelector(ctx) },
]);
```

For the few ambiguous cases currently requiring LL(*), there are three
strategies, in order of preference:

#### Strategy A: Parse Now, Structure Later (preferred)

The Less parser already uses this pattern for mixin arguments. The problem:
mixin args can be separated by commas OR semicolons, and you don't know which
until you see the first `;`. Backtracking would mean re-parsing everything.

Instead, `mixinArgList` optimistically parses comma-separated arguments. When
it encounters a `;`, it **retroactively restructures** the already-parsed
comma nodes into the first semicolon-separated argument:

```typescript
// Simplified from less-parser/src/productions.ts mixinArgList
mixinArgList(ctx: Context): List {
  let node = this.subrule(this.mixinArg, ctx);
  let commaNodes: Node[] = [node];
  let semiNodes: Node[] = [];
  let isSemiList = false;

  this.many(() => {
    this.or([
      {
        GATE: () => !isSemiList,
        ALT: () => {
          this.consume(T.Comma);
          commaNodes.push(this.subrule(this.mixinArg, ctx));
        }
      },
      {
        ALT: () => {
          isSemiList = true;
          this.consume(T.Semi);
          // Retroactively restructure: comma nodes become
          // a single List inside the first semi-arg
          if (commaNodes.length > 1) {
            semiNodes.push(new List(commaNodes, ...));
          } else {
            semiNodes.push(commaNodes[0]);
          }
          commaNodes = [];
          // Continue parsing with commas now allowed inside semi-args
          semiNodes.push(this.subrule(this.mixinArg, ctx));
        }
      }
    ]);
  });

  let nodes = isSemiList ? semiNodes : commaNodes;
  return new List(nodes, { sep: isSemiList ? ';' : ',' }, ...);
}
```

This is **zero-cost disambiguation** — no backtracking, no speculation, no
wasted work. The parser just reinterprets what it already has. This pattern
applies anywhere the structure is ambiguous but the tokens themselves aren't.

#### Strategy B: Speculative Backtrack (rare)

For cases where you genuinely can't know which production to enter (e.g.,
property vs selector ambiguity in CSS):

```typescript
this.or([
  { GATE: () => this.backtrack(this.declaration), ALT: () => this.declaration(ctx) },
  { ALT: () => this.qualifiedRule(ctx) },
]);
```

The `backtrack()` method saves position, tries the rule, restores position, and
returns success/failure. This is what less.js does (`parserInput.save()` /
`restore()`).

#### Strategy C: Inline Lookahead (most common)

Most alternatives only need LA(1) or LA(2) checks. These are already present
in the Chevrotain grammar as `GATE` functions and transfer directly.

**In practice**: Strategy C covers ~95% of alternatives, Strategy A covers
most of the remainder (mixin args, ambiguous comma/semi lists), and Strategy B
is needed for only 2-3 genuinely ambiguous CSS productions.

### 3.3 Error Recovery

Three tiers, from cheapest to most expensive:

#### Tier 1: Single-Token Recovery (automatic)

```typescript
consume(expected: TokenType): IToken {
  const tok = this.la(1);
  if (tokenMatches(tok, expected)) {
    this.pos++;
    return tok;
  }

  if (this.recoveryEnabled) {
    // Try single-token deletion: skip current, check if next matches
    if (tokenMatches(this.la(2), expected)) {
      this.reportError(MismatchedTokenException(tok, expected));
      this.pos++; // skip bad token
      return this.consume(expected); // consume the good one
    }
    // Try single-token insertion: pretend the token exists
    if (this.inFollowSet(expected)) {
      this.reportError(MismatchedTokenException(tok, expected));
      return createVirtualToken(expected, tok);
    }
  }
  throw new MismatchedTokenException(tok, expected);
}
```

#### Tier 2: Grammar-Aware Re-sync (CSS-specific)

Instead of Chevrotain's generic follow-set re-sync, we use **CSS-aware
synchronization points**:

```typescript
/** Skip tokens until we find a recovery point */
resyncTo(...syncTokens: TokenType[]): void {
  let depth = 0;
  while (this.pos < this.tokens.length) {
    const tok = this.la(1);
    if (tok.tokenType === T.LCurly) depth++;
    else if (tok.tokenType === T.RCurly) {
      if (depth === 0) break; // found block end
      depth--;
    }
    else if (depth === 0 && syncTokens.some(t => tokenMatches(tok, t))) {
      break; // found sync point at current depth
    }
    this.pos++;
  }
}
```

Recovery points per context:
- **In a declaration**: sync to `;` or `}`
- **In a selector list**: sync to `{` or `,`
- **In a value**: sync to `;` or `!important`
- **In an at-rule prelude**: sync to `{` or `;`
- **Top level**: sync to next rule start (ident, `.`, `#`, `@`, etc.)

This is actually **better** than Chevrotain's generic recovery because it
understands CSS structure. VSCode's built-in CSS language service uses exactly
this approach.

#### Tier 3: Rule-Level Recovery (for live editing)

For language service scenarios where a user is mid-keystroke:

```typescript
safeParse(rule: () => Node, fallback: () => Node): Node {
  const savedPos = this.pos;
  const savedErrors = this.errors.length;
  try {
    return rule();
  } catch (e) {
    this.pos = savedPos;
    this.errors.length = savedErrors;
    return fallback(); // e.g., parse as raw text / Anonymous node
  }
}
```

### 3.4 Content Assist

This is the most architecturally significant feature. Chevrotain's
`computeContentAssist` walks the Grammar AST (GAST) — but we won't have a GAST
since rules are plain methods.

**Approach: Assist-Mode Parsing**

Run the parser in a special mode where it parses up to the cursor offset, then
collects what tokens would be valid next.

```typescript
suggest(tokens: IToken[], offset: number, startRule: string): Suggestion[] {
  this.contentAssistEnabled = true;
  this.contentAssistOffset = offset;
  this.contentAssistResults = [];
  this.tokens = tokens;
  this.pos = 0;

  try {
    (this as any)[startRule]();
  } catch (e) {
    if (e instanceof ContentAssistComplete) {
      // Normal termination — we've collected suggestions
    }
  }

  return this.contentAssistResults;
}
```

The DSL methods, in assist mode, detect when parsing reaches the cursor:

```typescript
consume(expected: TokenType): IToken {
  if (this.contentAssistEnabled) {
    const tok = this.la(1);
    if (tok.startOffset >= this.contentAssistOffset) {
      // We've reached the cursor — this token type is a valid suggestion
      this.contentAssistResults.push({
        tokenType: expected,
        ruleStack: [...this.ruleStack],
      });
      throw new ContentAssistComplete();
    }
  }
  // ... normal consume logic
}

or(alts: OrAlternative[]): any {
  if (this.contentAssistEnabled && this.la(1).startOffset >= this.contentAssistOffset) {
    // At cursor: ALL alternatives are suggestions
    for (const alt of alts) {
      // Collect first tokens of each alternative
      this.collectFirstTokens(alt);
    }
    throw new ContentAssistComplete();
  }
  // ... normal or logic
}
```

**Advantages over Chevrotain's approach**:
- No GAST construction needed
- Semantic context available (we know variable names, property names in scope)
- Can combine syntactic + semantic suggestions in one pass
- Works naturally with the language service's `getCompletions()` engine

**The key insight**: The parser already knows how to parse up to a point. In
assist mode, we just parse normally until we hit the cursor, then ask "what
would I try to match next?" The rule stack gives us context; the DSL methods
give us the token types.

---

## 4. WASM: Explored and Rejected

WASM was investigated as a potential performance path. **Verdict: Stay in JS/TS.**

**Why not**: This workload is string-heavy (token matching, slicing), allocation-
heavy (thousands of AST nodes per file), and interop-heavy (results flow directly
into the JS language service and VSCode API). Every WASM↔JS boundary crossing
requires copying or marshaling, which negates any compute advantage. The fast
native CSS tools (Lightning CSS, SWC, esbuild) achieve their speed via **native
N-API bindings**, not WASM — and N-API isn't available in VSCode's extension host.

**AssemblyScript** (TS subset → WASM) was the most appealing candidate due to
syntax familiarity, but lacks closures, union types, and dynamic dispatch — all
of which the parser inheritance chain relies on heavily.

**Custom JS function integration** (Jess's `@function` declarations) would
require constant WASM→JS callbacks with argument marshaling, creating a
performance anti-pattern.

**Where WASM could help in the future**: CPU-bound post-parse transforms on flat
buffers (e.g., autoprefixer-like operations), where the WASM↔JS boundary is
crossed once, not per-node. This is orthogonal to the parser itself.

The real performance wins come from algorithmic improvements: eliminating the
self-analysis phase, grammar-aware recovery, and incremental parsing.

---

## 5. Language Service Integration

### 5.1 Current State

The monorepo already has:
- `packages/language-service/` — LSP server with completions, hover, definitions,
  references, symbols, folding, formatting, semantic tokens, color info
- `packages/vscode/` — VSCode extension shell
- `packages/language-service-tests/` — Test infrastructure

The engine (`engine.ts`) creates parsers with `recoveryEnabled: true` and
reuses instances. It already calls `parser.suggest()` for content assist.

### 5.2 What the Hand-Written Parser Enables

#### Incremental Parsing

Chevrotain re-parses from scratch on every edit. A hand-written parser can:

```typescript
class IncrementalParser extends CssParser {
  private cachedTree: Node | null = null;
  private cachedTokens: IToken[] | null = null;

  parseIncremental(
    tokens: IToken[],
    editRange: { start: number; end: number; newLength: number }
  ): Node {
    if (this.cachedTree && this.cachedTokens) {
      // Find the smallest rule that contains the edit range
      // Re-parse only that subtree
      // Splice the result back into the cached tree
    }
    // Fall back to full reparse
    return this.parse(tokens);
  }
}
```

This is a **major win** for the language service — re-parsing a single
declaration instead of a 5000-line file on every keystroke.

#### Fault-Tolerant Partial Trees

With grammar-aware recovery, the parser can always produce a tree, even for
broken input. Every node can carry an `errors` array:

```typescript
interface ParsedNode extends Node {
  parseErrors?: Diagnostic[];
  partial?: boolean; // true if recovery was used
}
```

The language service gets a tree even for `div { color: }` (partial declaration
with missing value) — which is exactly what's needed for completions.

#### Unified Suggest + Parse

Instead of a separate `computeContentAssist` path, the parser can collect
suggestions during a normal recovery parse. The language service just calls
`parse()` with an assist-mode flag and gets both the tree AND the suggestions.

### 5.3 VSCode Extension Architecture

```
┌─ VSCode Extension Host ──────────────────────┐
│                                               │
│  ┌─ Language Client ────────────────────────┐ │
│  │  Activates for: css, less, scss, jess    │ │
│  │  Sends document changes via LSP          │ │
│  └──────────┬───────────────────────────────┘ │
│             │ LSP (JSON-RPC)                  │
│  ┌──────────▼───────────────────────────────┐ │
│  │  Language Server (packages/language-svc)  │ │
│  │                                           │ │
│  │  Engine                                   │ │
│  │  ├─ CssParser  (recovery + assist mode)   │ │
│  │  ├─ LessParser (extends CssParser)        │ │
│  │  ├─ ScssParser (extends CssParser)        │ │
│  │  ├─ JessParser (extends CssParser)        │ │
│  │  ├─ Document cache + incremental parse    │ │
│  │  └─ Semantic analysis (vars, mixins, etc) │ │
│  └───────────────────────────────────────────┘ │
└───────────────────────────────────────────────┘
```

The hand-written parser makes this architecture **simpler** because:
- No Chevrotain initialization overhead per parser instance
- Content assist is built into the parser, not a separate code path
- Recovery produces usable partial trees by default
- Incremental parsing is architecturally possible

---

## 6. Conversion Strategy

### 6.1 What We're Converting

| Package | Rules | Lines | Complexity |
|---|---|---|---|
| `css-parser/productions.ts` | 87 | 3,922 | High (base grammar) |
| `less-parser/productions.ts` | 64 | 4,027 | Medium (overrides + new rules) |
| `scss-parser/productions.ts` | ~50 | 3,095 | Medium (overrides + new rules) |
| `parser/productions/*.ts` | ~30 | 1,254 | Low (extensions) |
| **Total** | **~231** | **~12,298** | |

Plus:
- `cssTokens.ts` (lexer definitions) — keep initially
- `lessTokens.ts`, `scssTokens.ts`, `jessTokens.ts` — keep initially
- `cssActionsParser.ts` (base class) — **replace** with new runtime
- `advancedActionsParser.ts` (error recovery) — **replace** with new runtime

### 6.2 Mechanical Transformations (LLM-Suitable)

Each production rule needs these changes:

| Before (Chevrotain) | After (Hand-Written) | Mechanical? |
|---|---|---|
| `$.RULE('name', () => { ... })` | `name(ctx: Context): Node { ... }` | Yes |
| `$.CONSUME(T.Foo)` | `this.consume(T.Foo)` | Yes |
| `$.CONSUME2(T.Foo)` | `this.consume(T.Foo)` | Yes (drop number) |
| `$.SUBRULE($.foo, { ARGS: [ctx] })` | `this.subrule(this.foo, ctx)` | Yes |
| `$.SUBRULE2($.foo, { ARGS: [ctx] })` | `this.subrule(this.foo, ctx)` | Yes (drop number) |
| `$.OR([{ ALT: () => ... }])` | `this.or([{ ALT: () => ... }])` | Yes |
| `$.OR2([...])` | `this.or([...])` | Yes (drop number) |
| `$.MANY(() => { ... })` | `this.many(() => { ... })` | Yes |
| `$.OPTION(() => { ... })` | `this.option(() => { ... })` | Yes |
| `$.AT_LEAST_ONE_SEP({SEP: T.X, DEF: () => ...})` | `this.atLeastOneSep(T.X, () => ...)` | Yes |
| `if (!RECORDING_PHASE) { ... }` | *(remove guard, keep body)* | Yes |
| `let RECORDING_PHASE = $.RECORDING_PHASE` | *(remove entirely)* | Yes |
| `$.getLocationInfo(tok)` | `this.getLocationInfo(tok)` | Yes |
| `GATE: () => this.LA(1)...` | `GATE: () => this.la(1)...` | Yes |

**Estimated conversion effort per rule**: ~2-5 minutes for an LLM with clear
instructions. For 231 rules, this is a few hours of LLM time — essentially
mechanical.

### 6.3 Non-Mechanical Changes (Need Human Review)

| Change | Why | Count |
|---|---|---|
| `OVERRIDE_RULE` in Less/SCSS | Need to become actual method overrides | ~40 |
| Complex `OR` with implicit lookahead | May need explicit `GATE` functions | ~15 |
| `hasWS()` / whitespace GATE patterns | Need careful position checking | ~10 |
| LL(*) ambiguities | Need backtrack wrappers | ~3 |
| Error recovery insertion points | CSS-specific sync points | ~20 |

### 6.4 Phased Rollout

#### Phase 1: Parser Runtime (Weeks 1-2)

- [x] Implement `RecursiveDescentParser` base class
  - `packages/parser-runtime/src/parser.ts` — DSL methods, lookahead, location tracking
  - `packages/parser-runtime/src/types.ts` — TokenType, IToken, LocationInfo, error types
  - `packages/parser-runtime/src/index.ts` — public exports
- [x] Implement basic `consume()` with single-token recovery
- [x] Unit tests (27 passing) — `packages/parser-runtime/src/__tests__/parser.test.ts`
- [ ] Test against Chevrotain's token output (same lexer, different parser)

#### Phase 2: CSS Parser Conversion (Weeks 2-4)

- [ ] Mechanically convert all 87 CSS production rules
- [ ] Implement grammar-aware error recovery (Tier 2)
- [ ] Implement `backtrack()` for the 2-3 ambiguous productions
- [ ] Run all existing CSS parser tests (should be green with no test changes)
- [ ] Benchmark: parse time, memory, startup

#### Phase 3: Less/SCSS/Jess Parser Conversion (Weeks 4-6)

- [ ] Convert Less parser (64 rules, mostly overrides)
- [ ] Convert SCSS parser (~50 rules)
- [ ] Convert Jess parser extensions (~30 rules)
- [ ] Run all parser test suites
- [ ] Run full Jess integration tests (CSS output comparison)

#### Phase 4: Content Assist (Weeks 6-7)

- [ ] Implement assist-mode parsing in runtime
- [ ] Wire to language service `getCompletions()`
- [ ] Test against existing content assist tests
- [ ] Add semantic suggestions (property values, variables, mixins)

#### Phase 5: Language Service Enhancement (Weeks 7-9)

- [ ] Implement incremental parsing prototype
- [ ] Add fault-tolerant partial tree generation
- [ ] Benchmark language service responsiveness (keystroke-to-diagnostic)
- [ ] Replace VSCode built-in CSS/Less/SCSS language features

#### Phase 6: Lexer Replacement (Optional, Weeks 9-10)

- [ ] Hand-written scanner with same multi-mode semantics
- [ ] Incremental tokenization (re-lex only changed regions)
- [ ] Eliminate Chevrotain dependency entirely

---

## 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Subtle parsing differences after conversion | Medium | High | Extensive test suite (already exists), diff CSS output |
| Content assist quality regression | Medium | Medium | A/B test against Chevrotain's `computeContentAssist` |
| Error recovery not as good for edge cases | Low | Medium | CSS-specific recovery is actually *better* for common cases |
| Performance regression | Low | Low | Eliminating self-analysis should be faster, not slower |
| LLM makes systematic conversion errors | Medium | Low | Batch convert, diff-review, run tests per batch |
| Incremental parsing too complex | Medium | Medium | Keep full reparse as fallback; incrementalize later |

---

## 8. Reference Architecture Comparison

### 8.1 Less.js (Original Hand-Written Parser)

**Key patterns we should learn from:**

- **`parserInput.save()` / `restore()`**: Speculative parsing with backtrack.
  Our `backtrack()` method serves the same purpose.
- **Chunked input**: Less.js chunks the input string for performance. We get
  this for free since we're working with a pre-lexed token array.
- **`$re()` and `$char()`**: Direct character/regex matching without
  tokenization. We don't need this (we have tokens), but it's a reminder that
  a tokenless approach is viable for simple grammars.
- **No error recovery**: Less.js simply throws on parse errors. This is the
  main thing we're *improving* over less.js.
- **~1700 lines**: The entire less.js parser is surprisingly compact because
  it doesn't have recovery or content assist infrastructure.

### 8.2 Chevrotain Internals (What We're Replacing)

**What we keep**:
- DSL method names (API compatibility for easy conversion)
- Token type system (IToken, tokenMatcher)
- The concept of embedded actions (create AST during parse)

**What we drop**:
- RECORDING_PHASE / GAST construction
- `performSelfAnalysis()` / lookahead precomputation
- Numbered DSL variants (CONSUME2, OR3, MANY4)
- Generic follow-set-based error recovery
- Mixin/trait architecture (use normal class inheritance)

**What we replace**:
- Precomputed lookahead → inline lookahead checks + backtrack for ambiguity
- GAST-based content assist → assist-mode parsing
- Generic re-sync → CSS-aware sync points

### 8.3 Jess Node Tree (What We Produce)

The parser must produce the existing node types from `@jesscss/core`:
- 58 concrete node types with bitmask-based type system (`N` enum)
- Location info as `[startOffset, startLine, startCol, endOffset, endLine, endCol]`
- `pre`/`post` whitespace/comment tokens
- State flags (`F_VISIBLE`, `F_AMPERSAND`, etc.)

**No changes needed to the node tree.** The parser runtime produces the same
nodes the same way — the only change is *how* we get there (hand-written
methods instead of Chevrotain DSL).

---

## 9. Success Criteria

1. **All existing tests pass** with zero changes to test files
2. **CSS output is bit-identical** for the full Less.js test suite
3. **Startup time** reduced by >50% (no self-analysis phase)
4. **Parse time** within 10% of Chevrotain (should be faster, not slower)
5. **Zero Chevrotain dependency** (eventually, after Phase 6)
6. **Content assist** works for CSS, Less, SCSS, and Jess
7. **Language service** provides completions, diagnostics, hover, go-to-definition
   for all four languages
8. **Incremental parsing** handles single-keystroke edits in <10ms for typical files

---

## 10. Open Questions

1. **Should we keep Chevrotain's token type system (`createToken`, `tokenMatcher`,
   `CATEGORIES`)?** It works well and is decoupled from the parser. Alternatively,
   a simpler token type could reduce complexity.

2. **How much of the language service is syntax-driven vs. semantic?** Property
   value completions come from CSS data (MDN), not from parsing. Variable/mixin
   completions need scope analysis. The parser enables both, but the semantic
   layer is separate work.

3. **Should content assist use the "parse in assist mode" approach, or build a
   lightweight grammar descriptor?** The parse approach is simpler and needs no
   additional data structure, but may be slower for deeply nested grammars.

4. **Do we want to support the web extension host (vscode.dev)?** If yes, the
   parser must work in a browser context. Pure JS/TS guarantees this. This is
   another argument against WASM (which adds loading complexity in browsers).

5. **Incremental parsing granularity**: Re-parse per-rule (declaration, ruleset)
   or per-region (changed line range)? Per-rule is simpler and maps to tree nodes
   naturally.
