# Development Plan

## Current Status

### Recently Completed
- ✅ Fixed extend processing logic in `rules.ts` - corrected the order of parameters in `tryExtendSelector` call
- ✅ Created comprehensive `rules-extend.test.ts` with tests for:
  - Basic extend within same file
  - Multiple extends
  - Partial extend (all flag)
  - Complex selectors (compound, pseudo-classes)
- ✅ Fixed cloning/registration issue in `import-style.ts` - now clones before evaluation so registries are populated correctly
- ✅ Fixed `_hasStaticName` for Ruleset nodes to check selector static status after preEval
- ✅ Fixed `context.treeRoot` restoration to preserve it when `saved.treeRoot` is undefined

### In Progress
- 🔄 Debugging `import-style-extend.test.ts` - "import type can be extended from sibling import" test failing
  - Issue: Extend is being added when `context.treeRoot` is `false`, so it's not added to `pendingExtends`
  - Attempted fix: Modified `Extend.evalNode` to find containing Rules via parent chain
  - Status: Need to verify if `rulesParent` property works correctly for extend nodes

### Next Steps
1. Fix the sibling import extend test - ensure extends are added to the correct `treeRoot` even when `context.treeRoot` is not set
2. Verify all `import-style-extend.test.ts` tests pass
3. Remove debug logging from production code
4. Review and clean up any temporary workarounds

### Known Issues
- Extend nodes need to find their containing Rules when `context.treeRoot` is not available
- The extend processing needs to search through imported Rules' registries correctly

