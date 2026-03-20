# Investigation: Chevrotain Fork + First-Token-Only Gate Removal

**Paths assumed:** Jess at `~/git/oss/jess`, Chevrotain fork at `~/git/oss/chevrotain`.

## 1. Replacing Chevrotain with matthew-dean/chevrotain#rd-engine-replacement

### Current usage

Jess uses Chevrotain for **Lexer and token utilities only** — not Chevrotain's parser engine:

| Package | Chevrotain usage |
|---------|------------------|
| css-parser | `Lexer`, `createToken` (via util), `IToken` |
| less-parser | `Lexer`, `createToken`, `chevrotain-allstar` (peer, not imported) |
| scss-parser | `Lexer` |
| jess-parser | `Lexer`, `tokenMatcher`, `IToken`, `TokenVocabulary`, `TokenType` |
| core | `ILexingResult`, `IRecognitionException`, `IToken` |
| jess-plugin | `chevrotain` (peer) |

**Parser engine:** Jess uses `@jesscss/parser` (RecursiveDescentParser), not Chevrotain's CstParser. The rd-engine-replacement changes affect Chevrotain's parser; Jess gets no direct benefit from that. The fork does include Lexer improvements (Stage 0: token shapes, MATCH_SET bitset, etc.) that would apply.

### Fork details

- **Repo:** https://github.com/matthew-dean/chevrotain
- **Branch:** `rd-engine-replacement`
- **Package:** `packages/chevrotain` (monorepo)
- **Version:** 12.0.0 (vs current 11.1.0)
- **Node:** `>=22.0.0` (vs current)
- **Type:** ESM (`"type": "module"`)

### Git install limitation

Installing directly from `github:matthew-dean/chevrotain#rd-engine-replacement` fails because the fork's root `prepare` script runs `yarn install` / `bun install` with `packageManager: "bun@1.3.10"`, which pnpm does not support when fetching git-hosted packages.

**Solution:** Build the fork locally and use a `link:` override.

---

### Implementation plan: local build + link override

**Paths assumed:**
- Jess: `~/git/oss/jess`
- Chevrotain fork: `~/git/oss/chevrotain`

**Step 1 — Clone and build the fork**

```bash
cd ~/git/oss
git clone https://github.com/matthew-dean/chevrotain.git
cd chevrotain
git checkout rd-engine-replacement
bun install
bun run build
```

(If you don't have bun, check the repo for `npm run build` or `pnpm build`.)

**Step 2 — Add pnpm override in Jess**

In `package.json` (Jess root), add a `pnpm.overrides` entry:

```json
"pnpm": {
  "patchedDependencies": { ... },
  "overrides": {
    "chevrotain": "link:../chevrotain/packages/chevrotain",
    "@chevrotain/types": "link:../chevrotain/packages/types"
  }
}
```

The link targets are relative to Jess root (`../chevrotain/...`). Both packages must be built before use.

**Step 3 — Install in Jess**

```bash
cd ~/git/oss/jess
pnpm install
```

**Step 4 — Verify**

```bash
pnpm --filter @jesscss/css-parser build
pnpm --filter @jesscss/less-parser build
pnpm run verify:baseline
```

**Reverting to npm chevrotain:** Remove the `chevrotain` entry from `pnpm.overrides` and run `pnpm install`.

### chevrotain-allstar

- `css-parser` and `less-parser` list `chevrotain-allstar` but **never import it**.
- Comments still refer to "chevrotain-allstar needs to pick a path first" — likely legacy from an older parser design.
- **Recommendation:** Remove `chevrotain-allstar` from both packages if the fork works without it.

### Compatibility

- **Node 22+:** Fork requires Node ≥22; Jess may need to bump its Node requirement.
- **ESM:** Fork is ESM-only; Jess already uses ESM.
- **API:** Fork keeps the public API; Lexer and token APIs should remain compatible.

---

## 2. First-token-check-only gates

### Definition

A gate is **first-token-check-only** if it only inspects `LA(1)` (or `LA(1).tokenType`) and no other state (no `LA(2)`, no `ctx`, no `$.hasWS()`, etc.). With an engine that does LA(1) fast-dispatch, these gates are redundant.

### Catalog

#### First-token-only (candidates for removal)

| File | Line | Gate | Notes |
|------|------|------|-------|
| guards.ts | 815 | `tokenTypeInSet($.LA(1).tokenType, $.CALL_ARGUMENT_BLOCK_START)` | Pure LA(1) |
| guards.ts | 765 | `!tokenTypeInSet(firstToken.tokenType, $.MIXIN_ARG_TERMINATOR)` | Uses `firstToken` = LA(1), but also `!isDeclaration`, `!atStart` — **not** first-token only |
| selectors.ts | 805–808 | `type === $.T.AnonMixinStart \|\| type === $.T.LCurly` | Pure LA(1) |
| selectors.ts | 816–818 | `type !== $.T.AnonMixinStart && type !== $.T.LCurly` | Pure LA(1) |
| selectors.ts | 833 | `$.LA(1).tokenType === $.T.LParen` | Pure LA(1) |
| selectors.ts | 551 | `$.LA(1).tokenType === $.T.InterpolatedIdent` | Pure LA(1) |
| selectors.ts | 496–498 | `$.LA(1).tokenType !== $.T.All` and `!== $.T.InterpolatedIdent` | Mixed with `ctx.inExtend` |
| values.ts (scss) | 61 | `$.LA(1).tokenType === $.T.InterpolationStart` | Pure LA(1) |
| values.ts (scss) | 56 | `$.LA(1).tokenType === $.T.LParen && looksLikeMapLiteral(...)` | LA(1) + further lookahead |
| values.ts (scss) | 92 | `$.LA(1).tokenType === $.T.Ident` | Pure LA(1) |
| values.ts (scss) | 98 | `$.LA(1).tokenType === $.T.HashName` | Pure LA(1) |
| values.ts (scss) | 114–115 | `$.LA(1).tokenType === $.T.Ident \|\| $.LA(1).tokenType === $.T.PlainIdent` | Pure LA(1) |
| atRules.ts (scss) | 275 | `$.LA(1).tokenType === $.T.Ident` | Pure LA(1) |

#### Not first-token-only (keep)

| File | Gate | Reason |
|------|------|--------|
| guards.ts | 92 | `!!ctx.inValueList` — context |
| guards.ts | 116 | `ctx.allowComma && $.isType($.T.Comma)` — context + LA(1) |
| guards.ts | 174–175 | tokenType from LA(1) but used in complex logic |
| guards.ts | 369 | `$.noSep.bind(this)` — whitespace/position |
| guards.ts | 480–481 | `next = $.LA(1).tokenType` — used in switch, not a simple pass/fail |
| guards.ts | 629 | `moreArgs` — runtime state |
| guards.ts | 633 | `!isSemiList` — runtime state |
| guards.ts | 683 | `!$.isType($.T.RParen)` — LA(1) but negation of current token |
| guards.ts | 735, 771, 777, 786 | Use `atStart`, `isDeclaration`, `LA(2)` — not first-token only |
| guards.ts | 819, 823 | `!ctx.allowComma`, `!!ctx.allowComma` — context |
| selectors.ts | 357 | `!$.hasWS() && !(ctx.inExtend && $.isType($.T.All))` — hasWS, ctx |
| selectors.ts | 387, 391 | `ctx.inExtend`, `isQualifiedRule && !ctx.inExtend` — context |
| selectors.ts | 910 | `$.noSep.bind(this)` — whitespace |
| selectors.ts | 936, 947, 975, 982 | `$.looseMode`, `!$.looseMode` — parser mode |

### Constraint: do not modify @jesscss/parser

Gate removal is done **only in the parsers** (less-parser, scss-parser, css-parser). Do not add LA(1) fast-dispatch or any other changes to `@jesscss/parser`. The parser's existing speculative backtracking handles ungated alts.

### Removal strategy

1. **Remove pure first-token-only gates** one at a time from the parsers.
2. **Run tests** after each removal (`pnpm --filter @jesscss/less-parser test -- --run` or scss-parser equivalent).
3. **If regression:** reorder alternatives so the speculative path picks the right alt first, or revert that specific removal.
4. **Order of removal:**
   - `less-parser/guards.ts` line 815 (CALL_ARGUMENT_BLOCK_START) — **done**
   - `less-parser/selectors.ts` lines 805–808, 816–818, 833, 551 — **done**
   - `scss-parser/values.ts` lines 61, 92, 98, 114–115 — **done**
   - `scss-parser/atRules.ts` line 275 — **done**
5. **Re-evaluate** gates that combine LA(1) with other checks (e.g. 496–498, 56) — they may need to stay.

---

## Summary

| Task | Status | Notes |
|------|--------|-------|
| 1a. Point chevrotain to fork | Done | pnpm overrides in place |
| 1b. Remove chevrotain-allstar | Done | Removed from css-parser, less-parser |
| 2a. Remove first-token-only gates | Done | compression.less fails in clean checkout (pre-existing) |
