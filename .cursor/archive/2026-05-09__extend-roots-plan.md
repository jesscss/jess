# Extend Roots Registry Plan

## Current Understanding

### Current System
- `context.allRoots: Rules[]` - array of all Rules nodes (one per imported stylesheet)
- Each Rules node has `pendingExtends: Set<[target, selectorWithExtend, partial]>`
- Extends are registered to `treeRoot` (the Rules node containing them)
- Processing happens at outermost level, looping through allRoots

### Problems with Current Approach
1. No scoping - all roots can extend all other roots
2. No protection boundaries - protected imports aren't respected
3. No at-rule boundaries - extends from at-rules can extend outside
4. No @layer name matching - layers with same name don't share roots
5. No parent-child relationship tracking

## Proposed System: Extend Roots Registry

### Core Concept
An **Extend Root** represents a scope where extends can search for target rulesets. We'll use Rules node object identity (no wrapper class needed). Metadata will be stored in maps keyed by Rules nodes, similar to how `rulesetFrames` tracks the current ruleset context.

### Decisions Made

#### 1. Extend Root Identity
**Decision**: Use Rules node object identity (like current `allRoots`)
- No wrapper class needed
- Simpler implementation
- Metadata stored in maps keyed by Rules nodes

#### 2. Root Creation Points
**Decision**: Create roots at node creation/evaluation time, track like ruleset frames

**Roots will be created for**:
1. **Main stylesheet** - When evaluating the root Rules (context.root)
2. **StyleImport (compose type, non-protected)** - When evaluating a StyleImport that returns Rules
3. **StyleImport (compose type, protected)** - Creates a root but marks it as protected boundary
4. **AtRule (nestable)** - When entering @media, @supports, @container, @scope
5. **AtRule (@layer)** - Special case with name matching

**Question**: For `@import` type (classic CSS import):
- You mentioned it "clones and effectively has the same scope as its importing parent"
- Should `@import` type NOT create a new root, and instead use the parent's root?
- Or should it create a root but share the parent's accessible roots?

#### 3. Parent-Child Relationships
**Decision**: 
- Children can extend parents ✓
- Siblings can extend each other ✓
- Cannot exit compose boundary (up the tree) ✗
- Cannot exit at-rule (up the tree) ✗
- Based on matching selectors

**Structure**:
```typescript
// Metadata maps (keyed by Rules nodes)
parentRoot: WeakMap<Rules, Rules>  // Rules -> parent Rules
childrenRoots: WeakMap<Rules, Set<Rules>>  // Rules -> Set of child Rules
layerName: WeakMap<Rules, string>  // Rules -> layer name string
isProtected: WeakMap<Rules, boolean>  // Rules -> protected flag
accessibleRoots: WeakMap<Rules, Set<Rules>>  // Rules -> Set of accessible Rules (computed)
```

**Question**: When computing `accessibleRoots` for a root:
- Should it include: self, parent, siblings, descendants, and (for @layer) roots with same layer name?
- Should it exclude: roots behind protected boundaries, roots outside at-rule boundaries (when searching from inside)?

#### 4. @Layer Name Matching
**Decision**: 
- Layer names are static by extend time (prelude is evaluated)
- Case-sensitive (per CSS spec)
- Extract from `atRule.value.prelude` (Sequence of nodes)
- Normalize to string: `"one.two"` for `@layer one.two`
- Handle nested layers: `@layer one { @layer two {} }` = `"one.two"`

**Question**: 
- How should we extract the layer name string from the prelude Sequence?
- Should we evaluate the prelude first, then convert to string?
- For nested layers, should we concatenate parent layer name + child layer name?

#### 5. At-Rule Boundaries
**Decision**: 
- **Extend FROM inside at-rule**: Can only extend within that at-rule's root and its descendants
- **Extend FROM outside at-rule**: Can extend into at-rule's root and nested at-rules
- Extends from outside CAN reach into nested at-rules ✓

**Clarified**:
- When an extend is inside an at-rule, it can extend:
  - Rulesets within the same at-rule root (any ruleset in that Rules node) ✓
  - Rulesets in nested at-rules (children roots) ✓
  - Rulesets in the parent (outside the at-rule)? ✗ (cannot exit at-rule boundary upward)
- When an extend is outside an at-rule, it can extend:
  - Rulesets inside the at-rule root ✓
  - Rulesets in nested at-rules (descendants) ✓

#### 6. Protected Imports
**Decision**: 
- Protected import creates a root with `isProtected: true`
- Extends cannot cross protected boundaries
- Children of protected imports are de facto protected (extend search stops at outer protected boundary)

**Question**: 
- If a protected import has a child import (non-protected), can that child's rulesets be extended from outside the protected boundary?
- Or does the protected boundary block ALL access to descendants?

#### 7. Classic @import Merging
**Decision**: 
- `@import` type (classic CSS) clones and has same scope as importing parent
- `@import` type does NOT create a new extend root
- Uses parent's root (no new root creation)
- Extends registered in an `@import` use the parent's extend root

#### 8. Extend Processing Timing
**Decision**: 
- Register extends in context with "extends context" (the current extend root)
- Process extends at the very end of outer Rules.evalNode (after everything is evaluated)
- Only process when `rules === context.root` (outermost rules)

**Structure**:
```typescript
// In Context
extends: Array<{
  target: Selector,
  selectorWithExtend: Selector,
  partial: boolean,
  extendRoot: Rules  // The root where this extend was registered
}>
```

**Question**: 
- Should we replace `Rules.pendingExtends` with `context.extends`?
- Or keep both and migrate gradually?

#### 9. Registry Structure
**Decision**: WeakMap + Map structure is fine (most performant)

**Proposed structure**:
```typescript
class ExtendRootRegistry {
  // Map Rules -> parent Rules
  private parentRoot = new WeakMap<Rules, Rules>();
  
  // Map Rules -> Set of child Rules
  private childrenRoots = new WeakMap<Rules, Set<Rules>>();
  
  // Map Rules -> layer name string
  private layerName = new WeakMap<Rules, string>();
  
  // Map Rules -> protected flag
  private isProtected = new WeakMap<Rules, boolean>();
  
  // Map layer name -> Set of Rules with that name
  private rootsByLayerName = new Map<string, Set<Rules>>();
  
  // Root of the tree
  root?: Rules;
  
  // Stack for tracking current extend root (like rulesetFrames)
  extendRootStack: Rules[] = [];
  
  // Get current extend root
  getCurrentExtendRoot(): Rules | undefined {
    return this.extendRootStack[this.extendRootStack.length - 1];
  }
  
  // Get accessible roots for a given root
  getAccessibleRoots(root: Rules): Set<Rules>
  
  // Register a new root
  registerRoot(
    rules: Rules, 
    parent?: Rules, 
    options?: { layerName?: string, isProtected?: boolean }
  ): void
  
  // Push/pop for stack management
  pushExtendRoot(rules: Rules): void
  popExtendRoot(): void
}
```

#### 10. Implementation Location
**Decision**: Tied to context, complexity-dependent

**Proposed**: Add to Context as `context.extendRoots: ExtendRootRegistry`
- Accessible everywhere during evaluation
- Similar to how `rulesetFrames` and `frames` work
- Can be in separate file if complexity grows

## Clarifying Questions - Answered

### Q1: @import Type Root Creation
**Answer**: `@import` type does NOT need to create a new extend root
- Use parent's root (no new root creation)
- Lowers object creation overhead
- Makes sense since it "merges" with parent scope

### Q2: Layer Name Extraction
**Answer**: Use `toTrimmedString()` on prelude, then split by period
- Evaluate prelude first (should be static by extend time)
- Call `prelude.toTrimmedString()` to get string like `"one.two"`
- Split by `.` to get layer name segments
- For nested layers: concatenate parent + child names
- **Important**: Anonymous layers (no prelude) do NOT share in extend system

### Q3: Protected Boundary Behavior
**Answer**: Protected boundary blocks ALL access, including to descendants
- Extends cannot reach non-protected children of protected imports
- The protected boundary is a hard stop for extend searches

### Q4: Accessible Roots Computation
**Answer**: Clarified understanding
- An extend can extend ANYTHING within the same extend root (parent/grandparent/grandchild rulesets within that root)
- Also CHILDREN extend roots if they are not protected
- So `accessibleRoots` should include:
  - Self (the current root)
  - Children roots (if not protected)
  - Roots with same layer name (for @layer, if accessible)
- Exclude: roots behind protected boundaries
- Exclude: roots outside at-rule (when searching from inside at-rule)

### Q5: Extend Registration Migration
**Answer**: Replace `Rules.pendingExtends` with `context.extends` immediately
- Remove `pendingExtends` from Rules class
- Use new `context.extends` system exclusively

## Test-Driven Development Approach

### Test Coverage Requirements

Before implementation, create comprehensive tests covering:

1. **Basic extend roots**
   - Main stylesheet root creation
   - Extends within same root

2. **Import type roots**
   - `@import` type uses parent's root (no new root)
   - Extends in `@import` work with parent's root

3. **Compose type roots**
   - `@compose` type creates new root
   - Sibling compose roots can extend each other
   - Child compose roots can extend parent

4. **Protected boundaries**
   - Protected compose blocks all access (including descendants)
   - Extends cannot cross protected boundaries

5. **At-rule boundaries**
   - Extends FROM inside at-rule can only extend within that at-rule and descendants
   - Extends FROM outside at-rule can extend into at-rule
   - Nested at-rules work correctly

6. **@layer name sharing**
   - Layers with same name share extend roots
   - Anonymous layers don't share
   - Nested layers concatenate names

7. **Accessible roots computation**
   - Self is accessible
   - Children (if not protected) are accessible
   - Same-layer-name roots (if accessible) are accessible
   - Protected boundaries block access

### Test File Structure

Create `extend-roots.test.ts` with:
- Small, focused tests
- Clear documentation for each test
- Descriptive test names
- Initial state: all should fail (pre-implementation)

## Proposed Implementation Steps

- [x] **Step 0: Create comprehensive tests** - `extend-roots.test.ts`
  - [x] Run tests to confirm initial state
  - [x] Document each test's purpose
  
  **Test Results (Initial State - After Disabling Old Extend System)**:
  - ✅ 4 tests passing (negative tests - expecting extends NOT to work):
    1. Protected compose blocks all access
    2. Protected compose blocks access to non-protected children
    3. Extends from inside at-rule cannot extend outside
    4. Anonymous layers do not share extend roots
  - ❌ 11 tests failing (positive tests - expecting extends TO work):
    1. Basic extend roots - same root extends
    2. @import type roots (2 tests)
    3. @compose type roots (2 tests)
    4. At-rule boundaries - extends from outside (2 tests)
    5. @layer name sharing (2 tests)
    6. Accessible roots computation (2 tests)
  
  **Status**: Old extend processing code disabled in `rules.ts`. All extend functionality disabled until new system is implemented. This is the correct baseline for TDD.

- [ ] **Step 1: Create ExtendRootRegistry class** - In `tree/util/extend-roots.ts`
   - WeakMaps for metadata
   - Stack management (push/pop)
   - `getAccessibleRoots()` computation
   - `registerRoot()` method
   - [ ] Run tests - should still fail

- [ ] **Step 2: Add to Context** - `context.extendRoots: ExtendRootRegistry`
   - Initialize in Context constructor
   - Add `context.extends: Array<ExtendInfo>` for registered extends
   - [ ] Run tests - should still fail

- [ ] **Step 3: Update Rules.evalNode** - Register main root
   - When `rules === context.root`, register as root extend root
   - Push to stack at start, pop at end
   - [ ] Run tests - basic same-root extends should pass

- [ ] **Step 4: Update StyleImport.evalNode** - Register import roots
   - For `compose` type: create new root, set parent, mark protected if needed
   - For `import` type: do NOT create new root, use parent's root
   - Push/pop around evaluation (only for compose type)
   - [ ] Run tests - import/compose extend tests should pass

- [ ] **Step 5: Update AtRule.evalNode** - Register at-rule roots
   - For nestable at-rules: create new root, set parent
   - For @layer: extract layer name, register with name matching
   - Push/pop around evaluation
   - [ ] Run tests - at-rule extend tests should pass

- [ ] **Step 6: Add layer name extraction helper** - `extractLayerName(atRule: AtRule, parentLayerName?: string): string | undefined`
   - Check if prelude exists (anonymous layers return undefined)
   - Evaluate prelude if needed (should be static by extend time)
   - Call `prelude.toTrimmedString()` to get string
   - If parentLayerName provided, concatenate: `${parentLayerName}.${childName}`
   - Return undefined for anonymous layers (they don't share in extend system)
   - [ ] Run tests - @layer extend tests should pass

- [ ] **Step 7: Update Extend.evalNode** - Register extends to context
   - Get current extend root from `context.extendRoots.getCurrentExtendRoot()`
   - Register to `context.extends` with extend root reference
   - Remove `treeRoot.pendingExtends` usage
   - [ ] Run tests - should still pass

- [ ] **Step 8: Update Rules.evalNode** - Process extends at end
   - Only when `rules === context.root` (outermost)
   - Loop through `context.extends`
   - For each extend, get accessible roots for its extend root
   - Search for target rulesets in accessible roots
   - Apply extends
   - [ ] Run tests - all extend tests should pass

- [ ] **Step 9: Add accessible roots computation** - `getAccessibleRoots(root: Rules): Set<Rules>`
   - Include self (the current root)
   - Include children roots (recursively, if not protected)
   - Include roots with same layer name (for @layer, if accessible)
   - Exclude roots behind protected boundaries (stop traversal at protected roots)
   - Exclude roots outside at-rule boundaries (when searching from inside at-rule)
   - Note: Within the same root, extends can target any ruleset (parent/grandparent/grandchild)
   - [ ] Run tests - protected boundary and at-rule boundary tests should pass

- [ ] **Step 10: Remove old system** - Clean up
   - Remove `Rules.pendingExtends`
   - Remove `context.allRoots` (if no longer needed)
   - [ ] Run all tests - ensure nothing broke

## Implementation Ready

All questions answered. Ready to implement the extend roots registry system.

### Key Implementation Notes:
- `@import` type does NOT create new roots (uses parent's root)
- Anonymous @layer rules (no prelude) do NOT participate in extend sharing
- Protected boundaries block ALL access, including to descendants
- Accessible roots = self + children (if not protected) + same-layer-name roots (if accessible)
- Within a root, extends can target any ruleset in that root's Rules node
- Replace `Rules.pendingExtends` immediately with `context.extends`
