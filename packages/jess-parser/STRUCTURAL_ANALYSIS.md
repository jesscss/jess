# Structural Analysis: Jess Parser vs SCSS/Less Parsers

## Key Findings

### 1. Value Production Structure

**SCSS Parser Pattern:**
- `functionCall` first (no GATE - Chevrotain handles ambiguity)
- `DollarVariable` 
- `Ident` (main identifier token)
- `Color` (after Ident)
- Other tokens...

**Less Parser Pattern:**
- `functionCall` first
- `mixinReference` (with GATE)
- `Color` (with GATE excluding mixin references)
- `Ident` (with GATE excluding mixin references)
- Other tokens...

**Jess Parser Issue:**
- `PlainIdent` is Jess's main identifier token (like `Ident` in CSS/SCSS)
- `functionCall` expects `Ident` tokens, but Jess uses `PlainIdent`
- When `functionCall` is called first and encounters `PlainIdent`, it fails internally

**Solution:**
- Need to either:
  1. Override `functionCall` to handle `PlainIdent`, OR
  2. Put `PlainIdent` before `functionCall` so it matches first for non-function identifiers

### 2. Token Category Issues

**SCSS:**
- `PlainIdent` is only used in GATE contexts (module-qualified calls)
- Main value alternatives use `Ident`
- `PlainIdent` and `Ident` are checked separately: `($.LA(1).tokenType === T.Ident || $.LA(1).tokenType === T.PlainIdent)`

**Jess:**
- `PlainIdent` IS the main identifier token
- Need to ensure `PlainIdent` is properly recognized in value position
- May need to add `PlainIdent` to `Ident` or `Value` category, OR handle it explicitly

### 3. MANY Pattern Issue

**Error:** `Cannot read properties of undefined (reading 'call')` in `MANY` call

**Location:** `jessDollarExpression` -> `MANY` for accessors

**Pattern Used:**
```typescript
$.MANY({
  GATE: () => {
    const next = $.LA(1).tokenType;
    return (next === T.DotName || next === T.LParen || next === T.LSquare) && $.noSep();
  },
  DEF: () => {
    node = $.SUBRULE($.jessDollarAccessor, { ARGS: [{ ...ctx, node }] });
  }
});
```

**CSS Parser Pattern:**
```typescript
$.MANY({
  GATE: () => !requiredSemi || (requiredSemi && (
    $.LA(1).tokenType === T.Semi
    || $.LA(0).tokenType === T.Semi
  )),
  DEF: () => {
    // ... code
  }
});
```

**Possible Issue:**
- `$.noSep()` might be returning undefined in some contexts
- Or the GATE logic is too complex and causing Chevrotain issues
- May need to simplify the GATE or check if `noSep` exists

### 4. ProcessValueToken Pattern

**CSS/Less/SCSS:**
- All check `if (!(node instanceof Node))` before calling `processValueToken`
- This converts raw tokens to Nodes
- Jess parser now has this check (FIXED)

### 5. Alternative Ordering

**SCSS Pattern:**
1. Special cases with GATEs (module-qualified calls)
2. `functionCall`
3. `DollarVariable`
4. `Ident`
5. `Color`
6. Other tokens

**Jess Should Follow:**
1. Dollar expressions (with GATE for `$` token)
2. `functionCall` (but needs to handle `PlainIdent` OR come after it)
3. `PlainIdent` (main identifier)
4. `Ident` (fallback)
5. `Color`
6. Other tokens

## Recommended Fixes

1. **Fix functionCall/PlainIdent conflict:**
   - Put `PlainIdent` BEFORE `functionCall` so identifiers match first
   - OR override `functionCall` to accept `PlainIdent` tokens

2. **Fix MANY issue:**
   - Simplify GATE or check if `noSep()` exists
   - May need to check Less parser for similar patterns

3. **Ensure token-to-node conversion:**
   - Already fixed: added `if (!(node instanceof Node))` check

4. **Match SCSS alternative ordering:**
   - Dollar expressions first (with GATE)
   - Then `PlainIdent` (before `functionCall`)
   - Then `functionCall`
   - Then other tokens
