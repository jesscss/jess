# Extend failing tests: ask vs update

Per your instruction: for anything failing that doesn't match our rules, ask you about it, or update the test only when we're **sure** the test expectation is wrong.

---

## 1. Validation (element/ID conflict) — 5 tests

**Failures:**
- extend-duplicate-validation: 3 (a.info+div.foo, div.class+span.other, #first.class+#second.other)
- extend-selector-algorithm "Extension validation": 2 (duplicate element, duplicate ID)

**Expected:** Original selector unchanged + error (e.g. `a.info`, `#main.info`).  
**Received:** Extended selector (e.g. `a:is(.info,div.foo)`).

**Rules:** We must reject invalid extensions (element conflict, ID conflict). EXTEND_RULES and validation logic agree.

**Conclusion:** Test expectations are **correct**. The code path we're taking is not running validation (createValidatedIsWrapperWithErrors / compound validation). **Fix code** so validation runs and tryExtendSelector returns original + error. **No test update.**

---

## 2. Partial match "example 6" — 1 test

**Test:** `.a > .b.c > .d.e`, find `.c.b > .e.d` (partial), extendWith `.f`.  
**Expected:** `.a>.b.c>.d.e,.a>.f` (two selectors: original + prefix+extendWith).  
**Received:** `.a>:is(.b.c>.d.e,.f)` (one selector, full segment wrapped per §3a).

**Rules (§3a):** When match spans a combinator, wrap the **full segment** → `div + :is(.a.c.b > .y.x, .q)`.

So our output is rule-compliant (wrap full segment). The test expects the alternative behavior: "remainder as a new selector in the list" (original and `.a > .f`).

**Decision:** Update test to expect `.a>:is(.b.c>.d.e,.f)` per §3a. **Done.**

---

## 3. ".foo :is() in partial mode" — 1 test (extend-simplified-cases)

**Test:** `.foo .bar`, find `.bar`, extendWith `:is(.ext3, .ext4)` (test-authored :is()).  
**Expected:** `.foo :is(.bar,.ext3,.ext4)`.  
**Received:** `.foo :is(.bar,:is(.ext3,.ext4))`.

We add extendWith as one list item, so we get nested :is(). We only flatten **generated** :is() (§4); this :is() is from the test, not from us, so it isn't generated and isn't flattened.

**Decision:** Preserve nested :is() when extendWith is explicit/authored. Update test to expect `.foo :is(.bar,:is(.ext3,.ext4))`. **Done.**

---

## 4. Snapshot / eval / @media / circular — 4 tests

### 4a. "extends selectors inside nested rulesets (Less extend-selector replace case)"

**Test expectation (correct Less behavior):** Inner block should output `.replace, .rep_ace, .c` (three items). Step 1 expected CSS is from Less `tests-unit/extend-selector/extend-selector.css`.

**Correct fix (no sourceNode):** Do **not** use sourceNode for nested header display. Do **not** flatten the ampersand in the **extend target**; **do** flatten the invisible ampersand in **extendWith** when applying only when it does **not** match the inherited (ruleset frame) ampersand. Removed all sourceNode-based extend logic from extend-roots and getHeaderString. In extend.ts, when a SelectorList item is a ComplexSelector starting with implicit ampersand and the "own" part (after `& `) matches find, treat as full match and append extendWith with the same & prefix.

**Status:** Test still fails (inner block shows `.replace, .c`). Test expectation is **not** changed; code should be fixed to meet it.

**Note (earlier hypothesis):** processExtends runs once per eval, after the full AST for that root is evaluated; we do not serialize until after eval returns. So we cannot be "serializing before processExtends" in a single run. The more likely cause of the failure is **object identity**: the ruleset we find and update in processExtends (the one in the extend-root registry) may not be the same object as the nested ruleset in the tree we serialize. If preEval clones only part of the tree (e.g. root and outer ruleset get replaced by clones, but the inner Rules or nested ruleset is not), then we register and update the clone’s nested ruleset but the serialized tree might still contain the original nested ruleset, which never gets its selector/sourceNode updated.

- extend-eval-integration: "extends selectors inside nested rulesets (Less extend-selector replace case)"
- extend-eval-integration: "extend-chaining.less AST shape" (snapshot)
- extend-eval-integration: ".b:extend(.a) inside @media cannot reach out"
- extend-rules: "should handle circular references: .x -> .y -> .z -> .x"

**Conclusion:** These are integration/snapshot; exact diffs not inspected here. Documented elsewhere as separate issues (selector order, @media scope). **Question for you:** Prefer to (a) update snapshots/expectations to current rule-based output, or (b) treat as bugs and fix code first, then update only if the new output is correct per rules?

---

## Summary

| Category              | Action      | Count |
|-----------------------|------------|-------|
| Validation            | Fix code   | 5     |
| Example 6              | **Updated** (expect .a>:is(.b.c>.d.e,.f)) | 1 |
| .foo :is() partial    | **Updated** (expect .foo :is(.bar,:is(.ext3,.ext4))) | 1 |
| Snapshot/eval/@media  | **Ask**    | 4     |
