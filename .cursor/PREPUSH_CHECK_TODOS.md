# Pre-push Check TODOs

Generated: 2026-04-04T22:00:09.213Z

These checks failed during `--mode=upstream` and were treated as non-blocking.

## TODO Items
1. [ ] `packages/core` - `pnpm --filter ./packages/core typecheck` (exit 2)
2. [ ] `packages/core` - `pnpm exec eslint packages/core/src/tree/util/mixin-instance-primitives.ts` (exit 1)

## Failure Details
### 1) packages/core

- Command: `pnpm --filter ./packages/core typecheck`
- Exit: `2`

```
> @jesscss/core@2.0.0-alpha.5 typecheck /Users/matthew/git/worktrees/jess-dev/packages/core
> tsc -p tsconfig.json --noEmit

src/tree/__tests__/ampersand.test.ts(79,39): error TS2345: Argument of type '{ collapseNesting: boolean; }' is not assignable to parameter of type 'RenderKey | undefined'.
src/tree/__tests__/ampersand.test.ts(95,39): error TS2345: Argument of type '{ collapseNesting: boolean; }' is not assignable to parameter of type 'RenderKey | undefined'.
src/tree/__tests__/ampersand.test.ts(109,39): error TS2345: Argument of type '{ collapseNesting: boolean; }' is not assignable to parameter of type 'RenderKey | undefined'.
src/tree/__tests__/ampersand.test.ts(124,39): error TS2345: Argument of type '{ collapseNesting: boolean; }' is not assignable to parameter of type 'RenderKey | undefined'.
src/tree/__tests__/ampersand.test.ts(137,39): error TS2345: Argument of type '{ collapseNesting: boolean; }' is not assignable to parameter of type 'RenderKey | undefined'.
src/tree/__tests__/ampersand.test.ts(164,39): error TS2345: Argument of type '{ collapseNesting: boolean; }' is not assignable to parameter of type 'RenderKey | undefined'.
src/tree/__tests__/ampersand.test.ts(190,39): error TS2345: Argument of type '{ collapseNesting: boolean; }' is not assignable to parameter of type 'RenderKey | undefined'.
src/tree/__tests__/ampersand.test.ts(205,39): error TS2345: Argument of type '{ collapseNesting: boolean; }' is not assignable to parameter of type 'RenderKey | undefined'.
src/tree/__tests__/ampersand.test.ts(220,39): error TS2345: Argument of type '{ collapseNesting: boolean; }' is not assignable to parameter of type 'RenderKey | undefined'.
src/tree/__tests__/ampersand.test.ts(254,39): error TS2345: Argument of type '{ collapseNesting: boolean; }' is not assignable to parameter of type 'RenderKey | undefined'.
src/tree/__tests__/ampersand.test.ts(286,39): error TS2345: Argument of type '{ collapseNesting: boolean; }' is not assignable to parameter of type 'RenderKey | undefined'.
src/tree/__tests__/ampersand.test.ts(301,40): error TS2345: Argument of type '{ collapseNesting: boolean; }' is not assignable to parameter of type 'RenderKey | undefined'.
src/tree/__tests__/ampersand.test.ts(334,39): error TS2345: Argument of type '{ collapseNesting: boolean; }' is not assignable to parameter of type 'RenderKey | undefined'.
src/tree/__tests__/at-rule.test.ts(2032,9): error TS2322: Type 'Interpolated<AnyRole>' is not assignable to type 'Any<"atkeyword"> | Interpolated<"atkeyword">'.
  Type 'Interpolated<AnyRole>' is not assignable to type 'Interpolated<"atkeyword">'.
    Type 'AnyRole' is not assignable to type '"atkeyword"'.
      Type '"ident"' is not assignable to type '"atkeyword"'.
src/tree/__tests__/call.test.ts(166,23): error TS2532: Object is possibly 'undefined'.
src/tree/__tests__/call.test.ts(290,19): error TS2339: Property 'at' does not exist on type 'Node<NodeValue, NodeOptions, Record<string, unknown>>'.
src/tree/__tests__/call.test.ts(291,42): error TS2345: Argument of type '{ renderKey: number | symbol; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context'.
  Type '{ renderKey: number | symbol; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/__tests__/call.test.ts(315,39): error TS2769: No overload matches this call.
  Overload 1 of 3, '(key: "important", renderKey: RenderKey | undefined): Any<"flag"> | undefined', gave the following error.
    Argument of type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'RenderKey | undefined'.
  Overload 2 of 3, '(key: "important", ctx: Context | undefined): Any<"flag"> | undefined', gave the following error.
    Argument of type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context'.
      Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/__tests__/control.test.ts(477,7): error TS2739: Type 'Expression' is missing the following properties from type 'Sequence': length, getValue, getValueAt, _replaceValueAt, _cloneWithValue
src/tree/__tests__/declaration.test.ts(162,37): error TS2345: Argument of type '{ renderKey: number; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context'.
  Type '{ renderKey: number; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/__tests__/declaration.test.ts(164,30): error TS2769: No overload matches this call.
  Overload 1 of 3, '(key: "value", renderKey: RenderKey | undefined): Node<NodeValue, NodeOptions, Record<string, unknown>>', gave the following error.
    Argument of type '{ renderKey: number; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'RenderKey | undefined'.
  Overload 2 of 3, '(key: "value", ctx: Context | undefined): Node<NodeValue, NodeOptions, Record<string, unknown>>', gave the following error.
    Argument of type '{ renderKey: number; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context'.
      Type '{ renderKey: number; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/__tests__/extend-less-fixtures.test.ts(22,28): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
src/tree/__tests__/extend-rules.test.ts(81,29): error TS2571: Object is of type 'unknown'.
src/tree/__tests__/extend-rules.test.ts(81,53): error TS7006: Parameter 'child' implicitly has an 'any' type.
src/tree/__tests__/extend-rules.test.ts(673,9): error TS2322: Type 'Nil | Selector<any, NodeOptions, Record<string, unknown>>' is not assignable to type 'Selector<any, NodeOptions, Record<string, unknown>>'.
  Type 'Nil' is missing the following properties from type 'Selector<any, NodeOptions, Record<string, unknown>>': getKeySet, isSelector, _valueOf, keySetLibrary, and 9 more.
src/tree/__tests__/extend-rules.test.ts(725,9): error TS2322: Type 'Nil | Selector<any, NodeOptions, Record<string, unknown>>' is not assignable to type 'Selector<any, NodeOptions, Record<string, unknown>>'.
  Type 'Nil' is missing the following properties from type 'Selector<any, NodeOptions, Record<string, unknown>>': getKeySet, isSelector, _valueOf, keySetLibrary, and 9 more.
src/tree/__tests__/import-js.test.ts(9,20): error TS2345: Argument of type 'Expression' is not assignable to parameter of type 'string | Any<AnyRole> | Interpolated<AnyRole> | undefined'.
  Type 'Expression' is not assignable to type 'Any<AnyRole> | Interpolated<AnyRole>'.
    Property 'role' is missing in type 'Expression' but required in type 'Any<AnyRole>'.
src/tree/__tests__/import-js.test.ts(20,33): error TS2345: Argument of type 'Expression' is not assignable to parameter of type 'string | Any<AnyRole> | Interpolated<AnyRole> | undefined'.
  Type 'Expression' is not assignable to type 'Any<AnyRole> | Interpolated<AnyRole>'.
    Property 'role' is missing in type 'Expression' but required in type 'Any<AnyRole>'.
src/tree/__tests__/import-style.test.ts(158,14): error TS18048: 'sourceDecl' is possibly 'undefined'.
src/tree/__tests__/import-style.test.ts(188,24): error TS2345: Argument of type 'Node<NodeValue, NodeOptions, Record<string, unknown>> | undefined' is not assignable to parameter of type 'Node<NodeValue, NodeOptions, Record<string, unknown>>'.
  Type 'undefined' is not assignable to type 'Node<NodeValue, NodeOptions, Record<string, unknown>>'.
src/tree/__tests__/import-style.test.ts(410,14): error TS18048: 'importedRuleset' is possibly 'undefined'.
src/tree/__tests__/import-style.test.ts(517,14): error TS18048: 'varDecl' is possibly 'undefined'.
src/tree/__tests__/import-style.test.ts(542,14): error TS18048: 'varDecl' is possibly 'undefined'.
src/tree/__tests__/import-style.test.ts(614,14): error TS18048: 'downstreamLookup' is possibly 'undefined'.
src/tree/__tests__/import-style.test.ts(1046,14): error TS18048: 'sourceDecl' is possibly 'undefined'.
src/tree/__tests__/import-style.test.ts(1424,14): error TS18048: 'resolvedFromInterpolatedImport' is possibly 'undefined'.
src/tree/__tests__/import-style.test.ts(1449,14): error TS18048: 'resolvedFromUrl' is possibly 'undefined'.
src/tree/__tests__/import-style.test.ts(1762,58): error TS2304: Cannot find name 'VarDeclaration'.
src/tree/__tests__/mixin.test.ts(923,22): error TS2571: Object is of type 'unknown'.
src/tree/__tests__/mixin.test.ts(1001,26): error TS2571: Object is of type 'unknown'.
src/tree/__tests__/mixin.test.ts(1347,32): error TS2339: Property 'keySetLibrary' does not exist on type 'Nil | Selector<any, NodeOptions, Record<string, unknown>>'.
  Property 'keySetLibrary' does not exist on type 'Nil'.
src/tree/__tests__/quoted.test.ts(60,25): error TS2345: Argument of type 'Expression' is not assignable to parameter of type 'string | Any<AnyRole> | Interpolated<AnyRole> | undefined'.
  Type 'Expression' is not assignable to type 'Any<AnyRole> | Interpolated<AnyRole>'.
    Property 'role' is missing in type 'Expression' but required in type 'Any<AnyRole>'.
src/tree/__tests__/rules.test.ts(508,18): error TS18048: 'result' is possibly 'undefined'.
src/tree/__tests__/rules.test.ts(593,18): error TS18048: 'result' is possibly 'undefined'.
src/tree/__tests__/ruleset.test.ts(5,28): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
src/tree/__tests__/ruleset.test.ts(457,48): error TS2345: Argument of type 'Nil | Selector<any, NodeOptions, Record<string, unknown>> | undefined' is not assignable to parameter of type 'Selector<any, NodeOptions, Record<string, unknown>>'.
  Type 'undefined' is not assignable to type 'Selector<any, NodeOptions, Record<string, unknown>>'.
src/tree/__tests__/ruleset.test.ts(462,12): error TS18048: 'ownSelector' is possibly 'undefined'.
src/tree/__tests__/ruleset.test.ts(555,12): error TS18048: 'clonedDecl' is possibly 'undefined'.
src/tree/__tests__/ruleset.test.ts(556,28): error TS2322: Type 'Node<NodeValue, NodeOptions, Record<string, unknown>> | undefined' is not assignable to type 'Node<NodeValue, NodeOptions, Record<string, unknown>>'.
  Type 'undefined' is not assignable to type 'Node<NodeValue, NodeOptions, Record<string, unknown>>'.
src/tree/__tests__/serialize-types.test.ts(154,14): error TS2540: Cannot assign to 'unit' because it is a read-only property.
src/tree/ampersand.ts(395,34): error TS2532: Object is possibly 'undefined'.
src/tree/ampersand.ts(395,34): error TS2571: Object is of type 'unknown'.
src/tree/at-rule.ts(429,54): error TS2554: Expected 0 arguments, but got 1.
src/tree/at-rule.ts(513,13): error TS2740: Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is missing the following properties from type 'Rules': value, _wrapperRegistrySeeded, _wrapperRegistrySeeding, functionRegistry, and 54 more.
src/tree/block.ts(39,14): error TS2540: Cannot assign to 'value' because it is a read-only property.
src/tree/call.ts(104,26): error TS2341: Property '_meta' is private and only accessible within class 'Node<Data, O, ChildData>'.
src/tree/call.ts(150,71): error TS2339: Property 'Interpolated' does not exist on type 'typeof N'.
src/tree/call.ts(217,24): error TS2571: Object is of type 'unknown'.
src/tree/call.ts(217,43): error TS2769: No overload matches this call.
  Overload 1 of 3, '(key: "value", renderKey: RenderKey | undefined): unknown', gave the following error.
    Argument of type 'Context | { renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; } | undefined' is not assignable to parameter of type 'RenderKey | undefined'.
      Type 'Context' is not assignable to type 'RenderKey | undefined'.
  Overload 2 of 3, '(key: "value", ctx: Context | undefined): unknown', gave the following error.
    Argument of type 'Context | { renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; } | undefined' is not assignable to parameter of type 'Context | undefined'.
      Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/call.ts(219,45): error TS2345: Argument of type 'Context | { renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; } | undefined' is not assignable to parameter of type 'Context | undefined'.
  Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/call.ts(221,34): error TS2345: Argument of type 'Context | { renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; } | undefined' is not assignable to parameter of type 'Context | undefined'.
  Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/call.ts(225,43): error TS2345: Argument of type 'Context | { renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; } | undefined' is not assignable to parameter of type 'Context | undefined'.
  Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/call.ts(230,43): error TS2345: Argument of type 'Context | { renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; } | undefined' is not assignable to parameter of type 'Context | undefined'.
  Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/call.ts(333,57): error TS2339: Property 'type' does not exist on type 'string | Node<NodeValue, NodeOptions, Record<string, unknown>>'.
  Property 'type' does not exist on type 'string'.
src/tree/call.ts(348,59): error TS2339: Property 'type' does not exist on type 'string | Node<NodeValue, NodeOptions, Record<string, unknown>>'.
  Property 'type' does not exist on type 'string'.
src/tree/call.ts(440,15): error TS2740: Type '{ renderKey: RenderKey; rulesContext: Rules; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/collection.ts(1,35): error TS2307: Cannot find module 'awaitable-pipe/lib/utils' or its corresponding type declarations.
src/tree/color.ts(74,3): error TS2300: Duplicate identifier 'node'.
src/tree/color.ts(89,7): error TS2300: Duplicate identifier 'node'.
src/tree/color.ts(93,7): error TS2300: Duplicate identifier 'node'.
src/tree/color.ts(149,26): error TS2341: Property '_meta' is private and only accessible within class 'Node<Data, O, ChildData>'.
src/tree/condition.ts(49,26): error TS2341: Property '_meta' is private and only accessible within class 'Node<Data, O, ChildData>'.
src/tree/declaration.ts(127,25): error TS2345: Argument of type 'Context | { renderKey: RenderKey; plugins?: PluginInterface[] | undefined; opts?: ContextOptions | undefined; treeContext?: TreeContext | undefined; ... 32 more ...; composeSetValues?: Map<...> | undefined; } | undefined' is not assignable to parameter of type 'Context | undefined'.
  Type '{ renderKey: RenderKey; plugins?: PluginInterface[] | undefined; opts?: ContextOptions | undefined; treeContext?: TreeContext | undefined; ... 32 more ...; composeSetValues?: Map<...> | undefined; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/declaration.ts(356,13): error TS2322: Type 'JsFunction | Func | Declaration<DeclarationOptions> | Ruleset<RulesetValue>[] | (Ruleset<RulesetValue> | Mixin)[]' is not assignable to type 'Declaration<DeclarationOptions> | undefined'.
  Type 'JsFunction' is missing the following properties from type 'Declaration<DeclarationOptions>': important, _getAssignmentRenderKey, _setFieldOverride, requiresSemi, and 9 more.
src/tree/dimension.ts(76,26): error TS2341: Property '_meta' is private and only accessible within class 'Node<Data, O, ChildData>'.
src/tree/expression.ts(32,26): error TS2341: Property '_meta' is private and only accessible within class 'Node<Data, O, ChildData>'.
src/tree/extend.ts(74,26): error TS2341: Property '_meta' is private and only accessible within class 'Node<Data, O, ChildData>'.
src/tree/extend.ts(342,38): error TS2554: Expected 0 arguments, but got 1.
src/tree/function.ts(135,61): error TS2345: Argument of type 'RenderKey' is not assignable to parameter of type 'symbol'.
  Type 'number' is not assignable to type 'symbol'.
src/tree/function.ts(136,65): error TS2345: Argument of type 'RenderKey' is not assignable to parameter of type 'symbol'.
  Type 'number' is not assignable to type 'symbol'.
src/tree/function.ts(195,11): error TS2540: Cannot assign to 'parent' because it is a read-only property.
src/tree/function.ts(220,48): error TS2345: Argument of type '{ renderKey: symbol; rulesContext: Rules; lookupScope: Rules; plugins: PluginInterface[]; opts: ContextOptions; ... 31 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context'.
  Type '{ renderKey: symbol; rulesContext: Rules; lookupScope: Rules; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 30 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/function.ts(240,42): error TS2345: Argument of type '{ renderKey: symbol; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context'.
  Type '{ renderKey: symbol; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/function.ts(242,15): error TS2540: Cannot assign to 'parent' because it is a read-only property.
src/tree/import-style.ts(204,26): error TS2341: Property '_meta' is private and only accessible within class 'Node<Data, O, ChildData>'.
src/tree/import-style.ts(342,13): error TS2740: Type '{ renderKey: RenderKey; rulesContext: Rules; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/import-style.ts(454,22): error TS2488: Type 'unknown' must have a '[Symbol.iterator]()' method that returns an iterator.
src/tree/import-style.ts(480,22): error TS2322: Type 'Rules | null' is not assignable to type 'Rules'.
  Type 'null' is not assignable to type 'Rules'.
src/tree/import-style.ts(525,26): error TS2322: Type 'Rules' is not assignable to type 'Reference | Collection'.
  Type 'Rules' is not assignable to type 'Collection'.
    Types of property 'type' are incompatible.
      Type '"Rules" | "Collection" | "RawRules"' is not assignable to type '"Collection"'.
        Type '"Rules"' is not assignable to type '"Collection"'.
src/tree/import-style.ts(544,13): error TS2322: Type 'Rules' is not assignable to type 'Reference | Collection'.
  Type 'Rules' is not assignable to type 'Collection'.
    Types of property 'type' are incompatible.
      Type '"Rules" | "Collection" | "RawRules"' is not assignable to type '"Collection"'.
        Type '"Rules"' is not assignable to type '"Collection"'.
src/tree/import-style.ts(551,46): error TS2339: Property 'value' does not exist on type 'never'.
src/tree/import-style.ts(813,44): error TS2345: Argument of type '(p: Quoted | Url) => Promise<Rules>' is not assignable to parameter of type '(value: Any<AnyRole> | Interpolated<AnyRole> | Quoted | Url) => Rules | PromiseLike<Rules>'.
  Types of parameters 'p' and 'value' are incompatible.
    Type 'Any<AnyRole> | Interpolated<AnyRole> | Quoted | Url' is not assignable to type 'Quoted | Url'.
      Type 'Any<AnyRole>' is not assignable to type 'Quoted | Url'.
        Property 'pathValue' is missing in type 'Any<AnyRole>' but required in type 'Url'.
src/tree/import-style.ts(830,79): error TS2488: Type 'unknown' must have a '[Symbol.iterator]()' method that returns an iterator.
src/tree/import-style.ts(854,79): error TS2488: Type 'unknown' must have a '[Symbol.iterator]()' method that returns an iterator.
src/tree/mixin.ts(104,7): error TS2322: Type 'Any<AnyRole> | Interpolated<AnyRole> | undefined' is not assignable to type 'Any<"name"> | Interpolated<"name"> | undefined'.
  Type 'Any<AnyRole>' is not assignable to type 'Any<"name"> | Interpolated<"name"> | undefined'.
    Type 'Any<AnyRole>' is not assignable to type 'Any<"name">'.
      Type 'AnyRole' is not assignable to type '"name"'.
        Type '"ident"' is not assignable to type '"name"'.
src/tree/mixin.ts(127,26): error TS2341: Property '_meta' is private and only accessible within class 'Node<Data, O, ChildData>'.
src/tree/mixin.ts(239,5): error TS2322: Type 'RenderKey | undefined' is not assignable to type 'RenderKey'.
  Type 'undefined' is not assignable to type 'RenderKey'.
src/tree/node-base.ts(333,7): error TS2322: Type 'Object' is not assignable to type 'O & AllNodeOptions'.
  The 'Object' type is assignable to very few other types. Did you mean to use the 'any' type instead?
    Type 'Object' is not assignable to type 'O'.
      'Object' is assignable to the constraint of type 'O', but 'O' could be instantiated with a different subtype of constraint 'NodeOptions'.
        The 'Object' type is assignable to very few other types. Did you mean to use the 'any' type instead?
src/tree/node-base.ts(335,5): error TS2322: Type '(O & AllNodeOptions) | undefined' is not assignable to type 'O & AllNodeOptions'.
  Type 'undefined' is not assignable to type 'O & AllNodeOptions'.
    Type 'undefined' is not assignable to type 'O'.
      'O' could be instantiated with an arbitrary type which could be unrelated to 'undefined'.
src/tree/node-base.ts(589,11): error TS7053: Element implicitly has an 'any' type because expression of type 'string' can't be used to index type 'Node<Data, O, ChildData>'.
  No index signature with a parameter of type 'string' was found on type 'Node<Data, O, ChildData>'.
src/tree/node-base.ts(592,7): error TS7053: Element implicitly has an 'any' type because expression of type 'string' can't be used to index type 'Node<Data, O, ChildData>'.
  No index signature with a parameter of type 'string' was found on type 'Node<Data, O, ChildData>'.
src/tree/node-base.ts(843,23): error TS2322: Type 'any[]' is not assignable to type 'ChildData[K]'.
  'any[]' is assignable to the constraint of type 'ChildData[K]', but 'ChildData[K]' could be instantiated with a different subtype of constraint 'unknown'.
src/tree/node-base.ts(846,15): error TS7053: Element implicitly has an 'any' type because expression of type 'number' can't be used to index type 'unknown'.
  No index signature with a parameter of type 'number' was found on type 'unknown'.
src/tree/node-base.ts(877,11): error TS2322: Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to type 'InstanceType<T>'.
src/tree/node-base.ts(912,36): error TS2345: Argument of type '(n: Node<NodeValue, NodeOptions, Record<string, unknown>>, idx?: number | undefined) => MaybePromise<Node<NodeValue, NodeOptions, Record<...>>>' is not assignable to parameter of type '(n: Node<NodeValue, NodeOptions, Record<string, unknown>>, idx?: number | undefined) => Node<NodeValue, NodeOptions, Record<...>>'.
  Type 'MaybePromise<Node<NodeValue, NodeOptions, Record<string, unknown>>>' is not assignable to type 'Node<NodeValue, NodeOptions, Record<string, unknown>>'.
    Type 'Promise<Node<NodeValue, NodeOptions, Record<string, unknown>>>' is missing the following properties from type 'Node<NodeValue, NodeOptions, Record<string, unknown>>': _location, location, _meta, _metaFlags, and 67 more.
src/tree/node-base.ts(1368,7): error TS2322: Type 'MaybePromise<Node<NodeValue, NodeOptions, Record<string, unknown>>>' is not assignable to type 'Node<NodeValue, NodeOptions, Record<string, unknown>>'.
  Type 'Promise<Node<NodeValue, NodeOptions, Record<string, unknown>>>' is missing the following properties from type 'Node<NodeValue, NodeOptions, Record<string, unknown>>': _location, location, _meta, _metaFlags, and 67 more.
src/tree/node-base.ts(1383,7): error TS2322: Type 'MaybePromise<Node<NodeValue, NodeOptions, Record<string, unknown>>>' is not assignable to type 'Node<NodeValue, NodeOptions, Record<string, unknown>>'.
  Type 'Promise<Node<NodeValue, NodeOptions, Record<string, unknown>>>' is missing the following properties from type 'Node<NodeValue, NodeOptions, Record<string, unknown>>': _location, location, _meta, _metaFlags, and 67 more.
src/tree/node-base.ts(1610,44): error TS2345: Argument of type 'Context | PrintOptions | undefined' is not assignable to parameter of type 'Context | RenderKey | undefined'.
  Type 'PrintOptions' is not assignable to type 'Context | RenderKey | undefined'.
    Type 'PrintOptions' is missing the following properties from type 'Context': plugins, opts, treeContext, errors, and 63 more.
src/tree/operation.ts(43,26): error TS2341: Property '_meta' is private and only accessible within class 'Node<Data, O, ChildData>'.
src/tree/paren.ts(118,25): error TS2540: Cannot assign to 'parent' because it is a read-only property.
src/tree/quoted.ts(100,23): error TS2540: Cannot assign to 'parent' because it is a read-only property.
src/tree/reference.ts(169,5): error TS2322: Type 'undefined' is not assignable to type 'Rules'.
src/tree/reference.ts(966,69): error TS2769: No overload matches this call.
  Overload 1 of 3, '(key: "value", renderKey: RenderKey | undefined): Node<NodeValue, NodeOptions, Record<string, unknown>>', gave the following error.
    Argument of type 'Context | { renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'RenderKey | undefined'.
      Type 'Context' is not assignable to type 'RenderKey | undefined'.
  Overload 2 of 3, '(key: "value", ctx: Context | undefined): Node<NodeValue, NodeOptions, Record<string, unknown>>', gave the following error.
    Argument of type 'Context | { renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context | undefined'.
      Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/reference.ts(975,43): error TS2345: Argument of type 'Context | { renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context'.
  Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/reference.ts(978,64): error TS2345: Argument of type 'Context | { renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context'.
  Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/reference.ts(980,80): error TS2345: Argument of type 'Context | { renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context'.
  Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/reference.ts(983,67): error TS2345: Argument of type 'Context | { renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context'.
  Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/rules.ts(306,39): error TS2345: Argument of type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context'.
  Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/rules.ts(479,48): error TS2345: Argument of type 'Context | undefined' is not assignable to parameter of type 'Context'.
  Type 'undefined' is not assignable to type 'Context'.
src/tree/rules.ts(726,52): error TS2345: Argument of type 'Context | undefined' is not assignable to parameter of type 'Context'.
  Type 'undefined' is not assignable to type 'Context'.
src/tree/rules.ts(784,17): error TS2540: Cannot assign to 'parent' because it is a read-only property.
src/tree/rules.ts(843,9): error TS2352: Conversion of type '{ rulesContext: this; renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 31 more ...; composeSetValues: Map<...>; }' to type 'Context' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Type '{ rulesContext: this; renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 30 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/rules.ts(859,19): error TS2540: Cannot assign to 'parent' because it is a read-only property.
src/tree/rules.ts(1065,20): error TS2304: Cannot find name 'isBareAmpersandOwnSelector'.
src/tree/rules.ts(2330,34): error TS2345: Argument of type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to parameter of type 'Declaration<DeclarationOptions>'.
  Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is missing the following properties from type 'Declaration<DeclarationOptions>': name, value, important, _getAssignmentRenderKey, and 11 more.
src/tree/ruleset.ts(242,57): error TS2345: Argument of type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context | RenderKey | undefined'.
  Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/ruleset.ts(243,34): error TS2345: Argument of type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context'.
  Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/ruleset.ts(293,28): error TS2345: Argument of type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context'.
  Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/ruleset.ts(312,28): error TS2345: Argument of type '{ renderKey: RenderKey; plugins?: PluginInterface[] | undefined; opts?: ContextOptions | undefined; treeContext?: TreeContext | undefined; ... 32 more ...; composeSetValues?: Map<...> | undefined; }' is not assignable to parameter of type 'Context'.
  Type '{ renderKey: RenderKey; plugins?: PluginInterface[] | undefined; opts?: ContextOptions | undefined; treeContext?: TreeContext | undefined; ... 32 more ...; composeSetValues?: Map<...> | undefined; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/ruleset.ts(737,7): error TS2345: Argument of type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; } | undefined' is not assignable to parameter of type 'Context | undefined'.
  Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/ruleset.ts(1057,25): error TS2571: Object is of type 'unknown'.
src/tree/sequence.ts(60,26): error TS2341: Property '_meta' is private and only accessible within class 'Node<Data, O, ChildData>'.
src/tree/sequence.ts(192,48): error TS2339: Property 'Negative' does not exist on type 'typeof N'.
src/tree/url.ts(65,9): error TS2322: Type 'Reference' is not assignable to type 'Any<AnyRole> | Quoted'.
  Type 'Reference' is missing the following properties from type 'Quoted': value, quote, escaped
src/tree/url.ts(67,9): error TS2322: Type 'Reference' is not assignable to type 'Any<AnyRole> | Quoted'.
  Type 'Reference' is missing the following properties from type 'Quoted': value, quote, escaped
src/tree/util/__tests__/fast-reject.test.ts(126,34): error TS2339: Property 'keySetLibrary' does not exist on type 'Nil | Selector<any, NodeOptions, Record<string, unknown>>'.
  Property 'keySetLibrary' does not exist on type 'Nil'.
src/tree/util/__tests__/fast-reject.test.ts(173,34): error TS2339: Property 'keySetLibrary' does not exist on type 'Nil | Selector<any, NodeOptions, Record<string, unknown>>'.
  Property 'keySetLibrary' does not exist on type 'Nil'.
src/tree/util/__tests__/list-like.test.ts(47,27): error TS2322: Type 'Primitive' is not assignable to type 'string'.
  Type 'undefined' is not assignable to type 'string'.
src/tree/util/__tests__/list-like.test.ts(59,25): error TS2322: Type 'Primitive' is not assignable to type 'string'.
  Type 'undefined' is not assignable to type 'string'.
src/tree/util/__tests__/process-extends.test.ts(151,40): error TS2339: Property 'selector' does not exist on type 'Node<NodeValue, NodeOptions, Record<string, unknown>>'.
src/tree/util/__tests__/selector-match-unit.test.ts(745,46): error TS2322: Type 'MaybePromise<Nil> | MaybePromise<Selector<SimpleSelector<any, NodeOptions, Record<string, unknown>>[], NodeOptions, Record<string, unknown>>>' is not assignable to type 'Nil | Selector<any, NodeOptions, Record<string, unknown>> | undefined'.
  Type 'Promise<Nil>' is not assignable to type 'Nil | Selector<any, NodeOptions, Record<string, unknown>> | undefined'.
src/tree/util/__tests__/selector-match-unit.test.ts(747,46): error TS2322: Type 'MaybePromise<Nil> | MaybePromise<Selector<SimpleSelector<any, NodeOptions, Record<string, unknown>>[], NodeOptions, Record<string, unknown>>>' is not assignable to type 'Nil | Selector<any, NodeOptions, Record<string, unknown>> | undefined'.
  Type 'Promise<Nil>' is not assignable to type 'Nil | Selector<any, NodeOptions, Record<string, unknown>> | undefined'.
src/tree/util/__tests__/selector-match-unit.test.ts(764,46): error TS2322: Type 'MaybePromise<Nil> | MaybePromise<Selector<SimpleSelector<any, NodeOptions, Record<string, unknown>>[], NodeOptions, Record<string, unknown>>>' is not assignable to type 'Nil | Selector<any, NodeOptions, Record<string, unknown>> | undefined'.
  Type 'Promise<Nil>' is not assignable to type 'Nil | Selector<any, NodeOptions, Record<string, unknown>> | undefined'.
src/tree/util/__tests__/selector-match-unit.test.ts(766,46): error TS2322: Type 'MaybePromise<Nil> | MaybePromise<Selector<SimpleSelector<any, NodeOptions, Record<string, unknown>>[], NodeOptions, Record<string, unknown>>>' is not assignable to type 'Nil | Selector<any, NodeOptions, Record<string, unknown>> | undefined'.
  Type 'Promise<Nil>' is not assignable to type 'Nil | Selector<any, NodeOptions, Record<string, unknown>> | undefined'.
src/tree/util/__tests__/selector-match-unit.test.ts(771,46): error TS2345: Argument of type 'MaybePromise<Nil> | MaybePromise<Selector<SimpleSelector<any, NodeOptions, Record<string, unknown>>[], NodeOptions, Record<string, unknown>>>' is not assignable to parameter of type 'Selector<any, NodeOptions, Record<string, unknown>> | undefined'.
  Type 'Nil' is missing the following properties from type 'Selector<any, NodeOptions, Record<string, unknown>>': getKeySet, isSelector, _valueOf, keySetLibrary, and 9 more.
src/tree/util/__tests__/selector-match-unit.test.ts(799,36): error TS2322: Type 'MaybePromise<Nil> | MaybePromise<Selector<ComplexSelectorValue, NodeOptions, Record<string, unknown>>>' is not assignable to type 'Nil | Selector<any, NodeOptions, Record<string, unknown>> | undefined'.
  Type 'Promise<Nil>' is not assignable to type 'Nil | Selector<any, NodeOptions, Record<string, unknown>> | undefined'.
src/tree/util/__tests__/selector-match-unit.test.ts(803,36): error TS2322: Type 'MaybePromise<Nil> | MaybePromise<Selector<ComplexSelectorValue, NodeOptions, Record<string, unknown>>>' is not assignable to type 'Nil | Selector<any, NodeOptions, Record<string, unknown>> | undefined'.
  Type 'Promise<Nil>' is not assignable to type 'Nil | Selector<any, NodeOptions, Record<string, unknown>> | undefined'.
src/tree/util/__tests__/selector-match-unit.test.ts(810,46): error TS2345: Argument of type 'MaybePromise<Nil> | MaybePromise<Selector<ComplexSelectorValue, NodeOptions, Record<string, unknown>>>' is not assignable to parameter of type 'Selector<any, NodeOptions, Record<string, unknown>> | undefined'.
  Type 'Nil' is missing the following properties from type 'Selector<any, NodeOptions, Record<string, unknown>>': getKeySet, isSelector, _valueOf, keySetLibrary, and 9 more.
src/tree/util/compare.ts(62,34): error TS18048: 'aChild' is possibly 'undefined'.
src/tree/util/compare.ts(62,50): error TS18048: 'aChild' is possibly 'undefined'.
src/tree/util/compare.ts(63,34): error TS18048: 'bChild' is possibly 'undefined'.
src/tree/util/compare.ts(63,50): error TS18048: 'bChild' is possibly 'undefined'.
src/tree/util/extend-core.ts(168,5): error TS2322: Type 'unknown' is not assignable to type 'readonly Selector<any, NodeOptions, Record<string, unknown>>[] | undefined'.
src/tree/util/extend-core.ts(279,40): error TS2769: No overload matches this call.
  Overload 1 of 3, '(source: SelectorList, value: Selector<any, NodeOptions, Record<string, unknown>>[]): SelectorList', gave the following error.
    Argument of type 'CompoundSelector | SelectorList | ComplexSelector' is not assignable to parameter of type 'SelectorList'.
      Type 'CompoundSelector' is not assignable to type 'SelectorList'.
        Types of property 'type' are incompatible.
          Type '"CompoundSelector"' is not assignable to type '"SelectorList"'.
  Overload 2 of 3, '(source: ComplexSelector, value: ComplexSelectorValue): ComplexSelector', gave the following error.
    Argument of type 'CompoundSelector | SelectorList | ComplexSelector' is not assignable to parameter of type 'ComplexSelector'.
      Type 'CompoundSelector' is not assignable to type 'ComplexSelector'.
        Types of property 'type' are incompatible.
          Type '"CompoundSelector"' is not assignable to type '"ComplexSelector"'.
  Overload 3 of 3, '(source: CompoundSelector, value: Selector<any, NodeOptions, Record<string, unknown>>[]): CompoundSelector', gave the following error.
    Argument of type 'CompoundSelector | SelectorList | ComplexSelector' is not assignable to parameter of type 'CompoundSelector'.
      Type 'SelectorList' is not assignable to type 'CompoundSelector'.
        Types of property 'type' are incompatible.
          Type '"SelectorList"' is not assignable to type '"CompoundSelector"'.
src/tree/util/extend-core.ts(294,28): error TS2349: This expression is not callable.
  Each member of the union type '{ <K extends "value">(key: K): CompoundSelectorChildData[K]; <K extends "value">(key: K, renderKey: RenderKey | undefined): CompoundSelectorChildData[K]; <K extends "value">(key: K, ctx: Context | undefined): CompoundSelectorChildData[K]; } | { ...; } | { ...; }' has signatures, but none of those signatures are compatible with each other.
src/tree/util/extend-core.ts(322,60): error TS2345: Argument of type 'unknown' is not assignable to parameter of type 'readonly Selector<any, NodeOptions, Record<string, unknown>>[]'.
src/tree/util/extend-core.ts(324,77): error TS2769: No overload matches this call.
  Overload 1 of 3, '(source: SelectorList, value: Selector<any, NodeOptions, Record<string, unknown>>[]): SelectorList', gave the following error.
    Argument of type 'Selector<any, NodeOptions, Record<string, unknown>>' is not assignable to parameter of type 'SelectorList'.
      Type 'Selector<any, NodeOptions, Record<string, unknown>>' is missing the following properties from type 'SelectorList': value, length, _withValue
  Overload 2 of 3, '(source: ComplexSelector, value: ComplexSelectorValue): ComplexSelector', gave the following error.
    Argument of type 'Selector<any, NodeOptions, Record<string, unknown>>' is not assignable to parameter of type 'ComplexSelector'.
      Type 'Selector<any, NodeOptions, Record<string, unknown>>' is missing the following properties from type 'ComplexSelector': value, length, _withValue
  Overload 3 of 3, '(source: CompoundSelector, value: Selector<any, NodeOptions, Record<string, unknown>>[]): CompoundSelector', gave the following error.
    Argument of type 'Selector<any, NodeOptions, Record<string, unknown>>' is not assignable to parameter of type 'CompoundSelector'.
      Type 'Selector<any, NodeOptions, Record<string, unknown>>' is missing the following properties from type 'CompoundSelector': value, length, _withValue
src/tree/util/extend-core.ts(440,25): error TS2571: Object is of type 'unknown'.
src/tree/util/extend-core.ts(447,34): error TS2339: Property 'get' does not exist on type 'never'.
src/tree/util/extend-core.ts(459,82): error TS2339: Property 'get' does not exist on type 'never'.
src/tree/util/extend-core.ts(695,42): error TS2345: Argument of type 'Selector<any, NodeOptions, Record<string, unknown>>' is not assignable to parameter of type 'CompoundSelector | SelectorList | ComplexSelector'.
  Type 'Selector<any, NodeOptions, Record<string, unknown>>' is missing the following properties from type 'ComplexSelector': value, length, _withValue
src/tree/util/extend-core.ts(809,42): error TS2345: Argument of type 'Nil | Selector<any, NodeOptions, Record<string, unknown>>' is not assignable to parameter of type 'Selector<any, NodeOptions, Record<string, unknown>>'.
  Type 'Nil' is missing the following properties from type 'Selector<any, NodeOptions, Record<string, unknown>>': getKeySet, isSelector, _valueOf, keySetLibrary, and 9 more.
src/tree/util/extend-core.ts(830,59): error TS2345: Argument of type 'Nil | Selector<any, NodeOptions, Record<string, unknown>>' is not assignable to parameter of type 'Selector<any, NodeOptions, Record<string, unknown>>'.
  Type 'Nil' is missing the following properties from type 'Selector<any, NodeOptions, Record<string, unknown>>': getKeySet, isSelector, _valueOf, keySetLibrary, and 9 more.
src/tree/util/extend-core.ts(849,56): error TS2345: Argument of type 'Nil | Selector<any, NodeOptions, Record<string, unknown>>' is not assignable to parameter of type 'Selector<any, NodeOptions, Record<string, unknown>>'.
  Type 'Nil' is missing the following properties from type 'Selector<any, NodeOptions, Record<string, unknown>>': getKeySet, isSelector, _valueOf, keySetLibrary, and 9 more.
src/tree/util/extend-core.ts(888,3): error TS2322: Type 'Node<NodeValue, NodeOptions, Record<string, unknown>> | undefined' is not assignable to type 'Selector<any, NodeOptions, Record<string, unknown>> | undefined'.
  Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is missing the following properties from type 'Selector<any, NodeOptions, Record<string, unknown>>': getKeySet, isSelector, _valueOf, keySetLibrary, and 9 more.
src/tree/util/extend-core.ts(1297,37): error TS2345: Argument of type 'Selector<any, NodeOptions, Record<string, unknown>> | undefined' is not assignable to parameter of type 'Selector<any, NodeOptions, Record<string, unknown>>'.
  Type 'undefined' is not assignable to type 'Selector<any, NodeOptions, Record<string, unknown>>'.
src/tree/util/extend-core.ts(1454,30): error TS2345: Argument of type 'Selector<any, NodeOptions, Record<string, unknown>>' is not assignable to parameter of type 'ComplexSelector'.
  Type 'Selector<any, NodeOptions, Record<string, unknown>>' is missing the following properties from type 'ComplexSelector': value, length, _withValue
src/tree/util/extend-core.ts(1584,49): error TS2345: Argument of type 'Selector<any, NodeOptions, Record<string, unknown>>' is not assignable to parameter of type 'CompoundSelector | SelectorList | ComplexSelector'.
  Type 'Selector<any, NodeOptions, Record<string, unknown>>' is missing the following properties from type 'ComplexSelector': value, length, _withValue
src/tree/util/extend-core.ts(1710,9): error TS2345: Argument of type 'Selector<any, NodeOptions, Record<string, unknown>>' is not assignable to parameter of type 'CompoundSelector | SelectorList | ComplexSelector'.
  Type 'Selector<any, NodeOptions, Record<string, unknown>>' is missing the following properties from type 'ComplexSelector': value, length, _withValue
src/tree/util/extend-core.ts(1720,19): error TS2339: Property 'hoistToRoot' does not exist on type 'never'.
src/tree/util/extend-core.ts(2025,48): error TS2345: Argument of type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to parameter of type 'Selector<any, NodeOptions, Record<string, unknown>>'.
  Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is missing the following properties from type 'Selector<any, NodeOptions, Record<string, unknown>>': getKeySet, isSelector, _valueOf, keySetLibrary, and 9 more.
src/tree/util/extend-core.ts(2089,44): error TS2345: Argument of type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to parameter of type 'Selector<any, NodeOptions, Record<string, unknown>>'.
  Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is missing the following properties from type 'Selector<any, NodeOptions, Record<string, unknown>>': getKeySet, isSelector, _valueOf, keySetLibrary, and 9 more.
src/tree/util/extend-roots.ts(52,50): error TS2554: Expected 0 arguments, but got 1.
src/tree/util/extend-roots.ts(113,46): error TS2554: Expected 0 arguments, but got 1.
src/tree/util/extend-roots.ts(576,46): error TS2554: Expected 0 arguments, but got 1.
src/tree/util/extend-roots.ts(724,46): error TS2554: Expected 0 arguments, but got 1.
src/tree/util/extend-roots.ts(730,59): error TS2554: Expected 0 arguments, but got 1.
src/tree/util/extend-roots.ts(911,45): error TS2554: Expected 1 arguments, but got 2.
src/tree/util/field-helpers.ts(75,5): error TS2322: Type 'unknown' is not assignable to type 'readonly Node<NodeValue, NodeOptions, Record<string, unknown>>[]'.
src/tree/util/field-helpers.ts(129,42): error TS2345: Argument of type 'unknown' is not assignable to parameter of type 'RenderKey'.
src/tree/util/field-helpers.ts(162,8): error TS2540: Cannot assign to 'parent' because it is a read-only property.
src/tree/util/field-helpers.ts(229,3): error TS2322: Type 'unknown' is not assignable to type 'readonly Node<NodeValue, NodeOptions, Record<string, unknown>>[]'.
src/tree/util/mixin-instance-primitives.ts(89,30): error TS2769: No overload matches this call.
  Overload 1 of 3, '(key: "params", renderKey: RenderKey | undefined): List<Node<NodeValue, NodeOptions, Record<string, unknown>>> | undefined', gave the following error.
    Argument of type 'Context | RenderKey | undefined' is not assignable to parameter of type 'RenderKey | undefined'.
      Type 'Context' is not assignable to type 'RenderKey | undefined'.
  Overload 2 of 3, '(key: "params", ctx: Context | undefined): List<Node<NodeValue, NodeOptions, Record<string, unknown>>> | undefined', gave the following error.
    Argument of type 'Context | RenderKey | undefined' is not assignable to parameter of type 'Context | undefined'.
      Type 'number' is not assignable to type 'Context'.
src/tree/util/mixin-instance-primitives.ts(230,31): error TS2345: Argument of type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context'.
  Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/util/mixin-instance-primitives.ts(344,12): error TS2540: Cannot assign to 'parent' because it is a read-only property.
src/tree/util/mixin-instance-primitives.ts(371,9): error TS2540: Cannot assign to 'parent' because it is a read-only property.
src/tree/util/mixin-instance-primitives.ts(387,11): error TS2540: Cannot assign to 'parent' because it is a read-only property.
src/tree/util/mixin-instance-primitives.ts(597,42): error TS2345: Argument of type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context'.
  Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/util/mixin-instance-primitives.ts(603,54): error TS2345: Argument of type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context'.
  Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/util/mixin-instance-primitives.ts(609,46): error TS2345: Argument of type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context'.
  Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/util/mixin-instance-primitives.ts(632,62): error TS2345: Argument of type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context'.
  Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/util/mixin-instance-primitives.ts(656,62): error TS2345: Argument of type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context'.
  Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/util/mixin-instance-primitives.ts(1093,31): error TS18046: 'children' is of type 'unknown'.
src/tree/util/mixin-instance-primitives.ts(1094,17): error TS18046: 'children' is of type 'unknown'.
src/tree/util/mixin-instance-primitives.ts(1098,69): error TS2345: Argument of type 'unknown' is not assignable to parameter of type 'Node<NodeValue, NodeOptions, Record<string, unknown>>'.
src/tree/util/mixin-instance-primitives.ts(1099,15): error TS18046: 'child' is of type 'unknown'.
src/tree/util/mixin-instance-primitives.ts(1100,13): error TS2341: Property '_setChildAt' is private and only accessible within class 'Rules'.
src/tree/util/mixin-instance-primitives.ts(1142,23): error TS18046: 'children' is of type 'unknown'.
src/tree/util/mixin-instance-primitives.ts(1156,27): error TS18046: 'child' is of type 'unknown'.
src/tree/util/mixin-instance-primitives.ts(1444,20): error TS2339: Property 'type' does not exist on type 'never'.
src/tree/util/mixin-instance-primitives.ts(1818,73): error TS2551: Property 'value' does not exist on type 'Node<NodeValue, NodeOptions, Record<string, unknown>>'. Did you mean 'valueOf'?
src/tree/util/mixin-instance-primitives.ts(1974,49): error TS2345: Argument of type 'Mixin' is not assignable to parameter of type 'Ruleset<RulesetValue>'.
  Type 'Mixin' is missing the following properties from type 'Ruleset<RulesetValue>': frames, selector, selectorEdge, rulesEdge, and 26 more.
src/tree/util/registry-utils.ts(239,54): error TS2345: Argument of type 'Node<NodeValue, NodeOptions, Record<string, unknown>> | undefined' is not assignable to parameter of type 'Nil | Selector<any, NodeOptions, Record<string, unknown>> | undefined'.
  Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to type 'Nil | Selector<any, NodeOptions, Record<string, unknown>> | undefined'.
    Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is missing the following properties from type 'Selector<any, NodeOptions, Record<string, unknown>>': getKeySet, isSelector, _valueOf, keySetLibrary, and 9 more.
src/tree/util/registry-utils.ts(253,42): error TS2345: Argument of type 'Node<NodeValue, NodeOptions, Record<string, unknown>> | undefined' is not assignable to parameter of type 'Nil | Selector<any, NodeOptions, Record<string, unknown>> | undefined'.
  Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to type 'Nil | Selector<any, NodeOptions, Record<string, unknown>> | undefined'.
    Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is missing the following properties from type 'Selector<any, NodeOptions, Record<string, unknown>>': getKeySet, isSelector, _valueOf, keySetLibrary, and 9 more.
src/tree/util/registry-utils.ts(307,37): error TS18048: 'selectorToIndex' is possibly 'undefined'.
src/tree/util/registry-utils.ts(323,36): error TS18048: 'callableSelector' is possibly 'undefined'.
src/tree/util/registry-utils.ts(396,29): error TS2345: Argument of type 'Set<Type>' is not assignable to parameter of type 'IndexType'.
  'Set<Type>' is assignable to the constraint of type 'IndexType', but 'IndexType' could be instantiated with a different subtype of constraint 'Node<NodeValue, NodeOptions, Record<string, unknown>> | Set<Type> | { [key: string]: any; value: Type; }[]'.
src/tree/util/registry-utils.ts(493,51): error TS2769: No overload matches this call.
  The last overload gave the following error.
    Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
      Type 'undefined' is not assignable to type 'string'.
src/tree/util/registry-utils.ts(506,36): error TS2488: Type 'never' must have a '[Symbol.iterator]()' method that returns an iterator.
src/tree/util/registry-utils.ts(589,9): error TS2322: Type 'IndexType' is not assignable to type 'Type | Set<Type> | undefined'.
  Type 'Type | Set<Type> | { [key: string]: any; value: Type; }[]' is not assignable to type 'Type | Set<Type> | undefined'.
    Type '{ [key: string]: any; value: Type; }[]' is not assignable to type 'Type | Set<Type> | undefined'.
      Type '{ [key: string]: any; value: Type; }[]' is missing the following properties from type 'Set<Type>': add, clear, delete, has, and 9 more.
        Type 'IndexType' is not assignable to type 'Set<Type>'.
          Type 'Type | Set<Type> | { [key: string]: any; value: Type; }[]' is not assignable to type 'Set<Type>'.
            Type 'Type' is not assignable to type 'Set<Type>'.
              Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is missing the following properties from type 'Set<Type>': add, clear, delete, forEach, and 14 more.
src/tree/util/registry-utils.ts(953,13): error TS2740: Type '{ rulesContext: Rules; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/util/registry-utils.ts(988,51): error TS2345: Argument of type 'Context | { rulesContext: Rules; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; } | undefined' is not assignable to parameter of type 'Context | undefined'.
  Type '{ rulesContext: Rules; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/util/registry-utils.ts(1048,7): error TS2740: Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/util/registry-utils.ts(1300,39): error TS2345: Argument of type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to parameter of type 'Ruleset<RulesetValue> | Mixin'.
  Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is missing the following properties from type 'Mixin': name, rules, params, guard, and 3 more.
src/tree/util/registry-utils.ts(1317,70): error TS2769: No overload matches this call.
  The last overload gave the following error.
    Argument of type '{ rulesContext: Rules; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; } | undefined' is not assignable to parameter of type 'Context | undefined'.
      Type '{ rulesContext: Rules; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/util/registry-utils.ts(1318,33): error TS2339: Property 'indexPendingItems' does not exist on type 'never'.
  The intersection 'RulesetRegistry & DeclarationRegistry & MixinRegistry & FunctionRegistry' was reduced to 'never' because property '_index' exists in multiple constituents and is private in some.
src/tree/util/registry-utils.ts(1319,33): error TS2339: Property 'find' does not exist on type 'never'.
  The intersection 'RulesetRegistry & DeclarationRegistry & MixinRegistry & FunctionRegistry' was reduced to 'never' because property '_index' exists in multiple constituents and is private in some.
src/tree/util/registry-utils.ts(1357,30): error TS2322: Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>[]' is not assignable to type '(Ruleset<RulesetValue> | Mixin)[]'.
  Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to type 'Ruleset<RulesetValue> | Mixin'.
    Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is missing the following properties from type 'Mixin': name, rules, params, guard, and 3 more.
src/tree/util/registry-utils.ts(1636,35): error TS2345: Argument of type '{ rulesContext: Rules; renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context'.
  Type '{ rulesContext: Rules; renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/util/registry-utils.ts(1643,7): error TS2322: Type 'Context | { rulesContext: Rules; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; } | undefined' is not assignable to type 'Context | undefined'.
  Type '{ rulesContext: Rules; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/util/registry-utils.ts(1657,15): error TS7022: 'parent' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
src/tree/util/registry-utils.ts(1676,48): error TS2345: Argument of type 'Rules | undefined' is not assignable to parameter of type 'Rules'.
  Type 'undefined' is not assignable to type 'Rules'.
src/tree/util/registry-utils.ts(1677,48): error TS2345: Argument of type 'Rules | undefined' is not assignable to parameter of type 'Rules'.
  Type 'undefined' is not assignable to type 'Rules'.
src/tree/util/registry-utils.ts(1838,53): error TS2345: Argument of type 'Rules | undefined' is not assignable to parameter of type 'Rules'.
  Type 'undefined' is not assignable to type 'Rules'.
src/tree/util/registry-utils.ts(1839,53): error TS2345: Argument of type 'Rules | undefined' is not assignable to parameter of type 'Rules'.
  Type 'undefined' is not assignable to type 'Rules'.
src/tree/util/registry-utils.ts(1883,9): error TS2322: Type 'Node<NodeValue, NodeOptions, Record<string, unknown>> | undefined' is not assignable to type 'Declaration<DeclarationOptions> | undefined'.
  Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is missing the following properties from type 'Declaration<DeclarationOptions>': name, value, important, _getAssignmentRenderKey, and 11 more.
src/tree/util/registry-utils.ts(1885,26): error TS2345: Argument of type '(a: Declaration, b: Declaration) => number' is not assignable to parameter of type '(a: Node<NodeValue, NodeOptions, Record<string, unknown>>, b: Node<NodeValue, NodeOptions, Record<string, unknown>>) => number'.
  Types of parameters 'a' and 'a' are incompatible.
    Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is missing the following properties from type 'Declaration<DeclarationOptions>': name, value, important, _getAssignmentRenderKey, and 11 more.
src/tree/util/registry-utils.ts(1887,7): error TS2322: Type 'Node<NodeValue, NodeOptions, Record<string, unknown>> | undefined' is not assignable to type 'Declaration<DeclarationOptions> | undefined'.
  Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is missing the following properties from type 'Declaration<DeclarationOptions>': name, value, important, _getAssignmentRenderKey, and 11 more.
src/tree/util/registry-utils.ts(1906,20): error TS2345: Argument of type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to parameter of type 'Declaration<DeclarationOptions>'.
  Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is missing the following properties from type 'Declaration<DeclarationOptions>': name, value, important, _getAssignmentRenderKey, and 11 more.
src/tree/util/scoped-body-eval.ts(74,41): error TS2345: Argument of type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context'.
  Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/util/scoped-body-eval.ts(78,17): error TS2540: Cannot assign to 'parent' because it is a read-only property.
src/tree/util/scoped-body-eval.ts(79,40): error TS2345: Argument of type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; ... 32 more ...; composeSetValues: Map<...>; }' is not assignable to parameter of type 'Context'.
  Type '{ renderKey: RenderKey; plugins: PluginInterface[]; opts: ContextOptions; treeContext: TreeContext; errors: ErrorDiagnostic[]; ... 31 more ...; composeSetValues: Map<...>; }' is missing the following properties from type 'Context': _searchScope, searchScope, getSearchScopeIdentity, hasInSearchScope, and 35 more.
src/tree/util/scoped-body-eval.ts(118,7): error TS18048: 'childKeys' is possibly 'undefined'.
src/tree/util/scoped-body-eval.ts(119,28): error TS18048: 'childKeys' is possibly 'undefined'.
src/tree/util/scoped-body-eval.ts(123,23): error TS18048: 'childKeys' is possibly 'undefined'.
src/tree/util/selector-match-core.ts(1195,26): error TS2349: This expression is not callable.
  Each member of the union type '{ <K extends "value">(key: K): CompoundSelectorChildData[K]; <K extends "value">(key: K, renderKey: RenderKey | undefined): CompoundSelectorChildData[K]; <K extends "value">(key: K, ctx: Context | undefined): CompoundSelectorChildData[K]; } | { ...; }' has signatures, but none of those signatures are compatible with each other.
src/tree/util/selector-match-core.ts(1269,37): error TS2349: This expression is not callable.
  Each member of the union type '{ <K extends "value">(key: K): CompoundSelectorChildData[K]; <K extends "value">(key: K, renderKey: RenderKey | undefined): CompoundSelectorChildData[K]; <K extends "value">(key: K, ctx: Context | undefined): CompoundSelectorChildData[K]; } | { ...; }' has signatures, but none of those signatures are compatible with each other.
src/tree/util/selector-match-core.ts(1277,35): error TS2349: This expression is not callable.
  Each member of the union type '{ <K extends "value">(key: K): CompoundSelectorChildData[K]; <K extends "value">(key: K, renderKey: RenderKey | undefined): CompoundSelectorChildData[K]; <K extends "value">(key: K, ctx: Context | undefined): CompoundSelectorChildData[K]; } | { ...; }' has signatures, but none of those signatures are compatible with each other.
src/tree/util/selector-match-core.ts(1289,32): error TS2349: This expression is not callable.
  Each member of the union type '{ <K extends "value">(key: K): CompoundSelectorChildData[K]; <K extends "value">(key: K, renderKey: RenderKey | undefined): CompoundSelectorChildData[K]; <K extends "value">(key: K, ctx: Context | undefined): CompoundSelectorChildData[K]; } | { ...; }' has signatures, but none of those signatures are compatible with each other.
src/tree/util/selector-match-core.ts(1290,28): error TS2349: This expression is not callable.
  Each member of the union type '{ <K extends "value">(key: K): CompoundSelectorChildData[K]; <K extends "value">(key: K, renderKey: RenderKey | undefined): CompoundSelectorChildData[K]; <K extends "value">(key: K, ctx: Context | undefined): CompoundSelectorChildData[K]; } | { ...; }' has signatures, but none of those signatures are compatible with each other.
src/tree/util/selector-match-core.ts(1688,80): error TS2349: This expression is not callable.
  Each member of the union type '{ <K extends "value">(key: K): CompoundSelectorChildData[K]; <K extends "value">(key: K, renderKey: RenderKey | undefined): CompoundSelectorChildData[K]; <K extends "value">(key: K, ctx: Context | undefined): CompoundSelectorChildData[K]; } | { ...; }' has signatures, but none of those signatures are compatible with each other.
src/tree/util/selector-utils.ts(122,36): error TS2345: Argument of type 'number | Context' is not assignable to parameter of type 'Context'.
  Type 'number' is not assignable to type 'Context'.
src/tree/util/selector-utils.ts(155,25): error TS2339: Property 'Extend' does not exist on type 'typeof N'.
src/tree/util/selector-utils.ts(300,12): error TS2571: Object is of type 'unknown'.
src/tree/util/selector-utils.ts(300,39): error TS7006: Parameter 'item' implicitly has an 'any' type.
src/tree/util/selector-utils.ts(319,12): error TS2571: Object is of type 'unknown'.
src/tree/util/selector-utils.ts(319,39): error TS7006: Parameter 'item' implicitly has an 'any' type.
src/tree/util/selector-utils.ts(443,7): error TS2740: Type 'Nil' is missing the following properties from type 'Selector<any, NodeOptions, Record<string, unknown>>': getKeySet, isSelector, _valueOf, keySetLibrary, and 9 more.
src/tree/util/selector-utils.ts(493,25): error TS18046: 'selectorData' is of type 'unknown'.
src/tree/util/selector-utils.ts(494,20): error TS18046: 'selectorData' is of type 'unknown'.
src/tree/util/selector-utils.ts(557,7): error TS2740: Type 'Nil' is missing the following properties from type 'Selector<any, NodeOptions, Record<string, unknown>>': getKeySet, isSelector, _valueOf, keySetLibrary, and 9 more.
src/tree/util/selector-utils.ts(568,26): error TS2339: Property 'get' does not exist on type 'never'.
src/tree/util/selector-utils.ts(570,29): error TS2339: Property 'copy' does not exist on type 'never'.
src/tree/util/selector-utils.ts(578,19): error TS2339: Property 'copy' does not exist on type 'never'.
src/tree/util/serialize-helper.ts(89,29): error TS2341: Property '_getRenderChildren' is private and only accessible within class 'Rules'.
src/tree/util/serialize-helper.ts(384,34): error TS2345: Argument of type 'Rules | Ruleset<RulesetValue> | AtRule' is not assignable to parameter of type 'Ruleset<RulesetValue> | AtRule'.
  Type 'Rules' is not assignable to type 'Ruleset<RulesetValue> | AtRule'.
    Type 'Rules' is missing the following properties from type 'AtRule': name, prelude, rules, preludeEdge, and 15 more.
../css-parser/src/cssRecursiveParser.ts(151,7): error TS4114: This member must have an 'override' modifier because it overrides a member in the base class 'EmbeddedActionsParser'.
../css-parser/src/cssRecursiveParser.ts(225,7): error TS4114: This member must have an 'override' modifier because it overrides a member in the base class 'EmbeddedActionsParser'.
../less-parser/src/productions/values.ts(499,20): error TS2345: Argument of type 'Node<NodeValue, NodeOptions, Record<string, unknown>> | Any<AnyRole>' is not assignable to parameter of type 'Any<AnyRole> | Quoted'.
  Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to type 'Any<AnyRole> | Quoted'.
    Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is missing the following properties from type 'Quoted': value, quote, escaped
/Users/matthew/git/worktrees/jess-dev/packages/core:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @jesscss/core@2.0.0-alpha.5 typecheck: `tsc -p tsconfig.json --noEmit`
Exit status 2
```

### 2) packages/core

- Command: `pnpm exec eslint packages/core/src/tree/util/mixin-instance-primitives.ts`
- Exit: `1`

```
/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/util/mixin-instance-primitives.ts
   227:4   error    Unsafe type assertion: type '{ value: Node<NodeValue, NodeOptions, Record<string, unknown>>[]; }' is more narrow than the original type            @typescript-eslint/no-unsafe-type-assertion
   417:41  error    Unsafe type assertion: type 'Context' is more narrow than the original type                                                                        @typescript-eslint/no-unsafe-type-assertion
   422:22  error    Unsafe type assertion: type 'typeof Node' is more narrow than the original type                                                                    @typescript-eslint/no-unsafe-type-assertion
   427:20  error    Unsafe type assertion: type 'Record<string, unknown>' is more narrow than the original type                                                        @typescript-eslint/no-unsafe-type-assertion
   442:10  warning  'bindStructuralParentTree' is defined but never used. Allowed unused vars must match /^_/u                                                         @typescript-eslint/no-unused-vars
   453:22  error    Unsafe type assertion: type 'typeof Node' is more narrow than the original type                                                                    @typescript-eslint/no-unsafe-type-assertion
   458:20  error    Unsafe type assertion: type 'Record<string, unknown>' is more narrow than the original type                                                        @typescript-eslint/no-unsafe-type-assertion
   483:29  error    Unsafe type assertion: type 'Context' is more narrow than the original type                                                                        @typescript-eslint/no-unsafe-type-assertion
   544:17  error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety                                                           @typescript-eslint/no-unsafe-type-assertion
   545:19  error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety                                                           @typescript-eslint/no-unsafe-type-assertion
   551:31  error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety                                                           @typescript-eslint/no-unsafe-type-assertion
   552:9   error    Unsafe assertion from `any` detected: consider using type guards or a safer assertion                                                              @typescript-eslint/no-unsafe-type-assertion
   552:10  error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety                                                           @typescript-eslint/no-unsafe-type-assertion
   667:32  error    Unsafe type assertion: type '{ value?: string | undefined; }' is more narrow than the original type                                                @typescript-eslint/no-unsafe-type-assertion
   668:19  error    Unsafe type assertion: type '{ value: string; }' is more narrow than the original type                                                             @typescript-eslint/no-unsafe-type-assertion
  1000:25  error    Unsafe type assertion: type 'Context' is more narrow than the original type                                                                        @typescript-eslint/no-unsafe-type-assertion
  1007:28  error    Unsafe type assertion: type 'Context' is more narrow than the original type                                                                        @typescript-eslint/no-unsafe-type-assertion
  1041:28  error    Unsafe type assertion: type 'Context' is more narrow than the original type                                                                        @typescript-eslint/no-unsafe-type-assertion
  1056:25  error    Unsafe type assertion: type 'Ruleset<RulesetValue> | AtRule' is more narrow than the original type                                                 @typescript-eslint/no-unsafe-type-assertion
  1086:25  error    Unsafe type assertion: type 'Context' is more narrow than the original type                                                                        @typescript-eslint/no-unsafe-type-assertion
  1136:25  error    Unsafe type assertion: type 'Context' is more narrow than the original type                                                                        @typescript-eslint/no-unsafe-type-assertion
  1148:51  error    Unsafe type assertion: type 'Context' is more narrow than the original type                                                                        @typescript-eslint/no-unsafe-type-assertion
  1158:50  error    Unsafe type assertion: type 'Context' is more narrow than the original type                                                                        @typescript-eslint/no-unsafe-type-assertion
  1180:28  error    Unsafe type assertion: type 'Context' is more narrow than the original type                                                                        @typescript-eslint/no-unsafe-type-assertion
  1284:10  error    Unsafe type assertion: type 'Rules | undefined' is more narrow than the original type                                                              @typescript-eslint/no-unsafe-type-assertion
  1318:28  error    Unsafe assertion from `any` detected: consider using type guards or a safer assertion                                                              @typescript-eslint/no-unsafe-type-assertion
  1336:29  error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety                                                           @typescript-eslint/no-unsafe-type-assertion
  1337:8   error    Unsafe assertion to `any` detected: consider using a more specific type to ensure safety                                                           @typescript-eslint/no-unsafe-type-assertion
  1383:28  error    Unsafe type assertion: type '{ value: unknown; }' is more narrow than the original type                                                            @typescript-eslint/no-unsafe-type-assertion
  1384:22  error    Unsafe type assertion: type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is more narrow than the original type                          @typescript-eslint/no-unsafe-type-assertion
  1384:52  error    Unsafe type assertion: type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is more narrow than the original type                          @typescript-eslint/no-unsafe-type-assertion
  1385:32  error    Unsafe type assertion: type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is more narrow than the original type                          @typescript-eslint/no-unsafe-type-assertion
  1388:36  error    Unsafe type assertion: type '{ value: Node<NodeValue, NodeOptions, Record<string, unknown>>[]; }' is more narrow than the original type            @typescript-eslint/no-unsafe-type-assertion
  1432:10  error    Unsafe type assertion: type '{ name?: Node<NodeValue, NodeOptions, Record<string, unknown>> | undefined; }' is more narrow than the original type  @typescript-eslint/no-unsafe-type-assertion
  1437:41  error    Expected parentheses around arrow function argument having a body with curly braces                                                                @stylistic/arrow-parens
  1549:43  error    Unsafe type assertion: type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is more narrow than the original type                          @typescript-eslint/no-unsafe-type-assertion
  1593:30  error    Unsafe type assertion: type '{ name?: { valueOf?: (() => string) | undefined; } | undefined; }' is more narrow than the original type              @typescript-eslint/no-unsafe-type-assertion
  1594:11  error    Unsafe type assertion: type '{ name?: string | undefined; }' is more narrow than the original type                                                 @typescript-eslint/no-unsafe-type-assertion
  1599:18  error    Unsafe type assertion: type '{ value: unknown; }' is more narrow than the original type                                                            @typescript-eslint/no-unsafe-type-assertion
  1610:18  error    Unsafe type assertion: type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is more narrow than the original type                          @typescript-eslint/no-unsafe-type-assertion
  1610:56  error    Unsafe type assertion: type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is more narrow than the original type                          @typescript-eslint/no-unsafe-type-assertion
  1629:45  error    Unsafe assertion from `any` detected: consider using type guards or a safer assertion                                                              @typescript-eslint/no-unsafe-type-assertion
  1660:34  error    Unsafe type assertion: type 'Mixin' is more narrow than the original type                                                                          @typescript-eslint/no-unsafe-type-assertion
  1741:26  error    Unsafe type assertion: type 'Context' is more narrow than the original type                                                                        @typescript-eslint/no-unsafe-type-assertion
  1760:29  error    Unsafe type assertion: type 'Context' is more narrow than the original type                                                                        @typescript-eslint/no-unsafe-type-assertion
  1783:29  error    Unsafe type assertion: type 'Context' is more narrow than the original type                                                                        @typescript-eslint/no-unsafe-type-assertion
  1792:13  error    Unsafe type assertion: type 'Context' is more narrow than the original type                                                                        @typescript-eslint/no-unsafe-type-assertion
  1809:39  error    Unsafe type assertion: type 'Mixin' is more narrow than the original type                                                                          @typescript-eslint/no-unsafe-type-assertion
  1974:26  error    Unsafe type assertion: type 'Condition | Bool | undefined' is more narrow than the original type                                                   @typescript-eslint/no-unsafe-type-assertion

✖ 49 problems (48 errors, 1 warning)
  1 error and 0 warnings potentially fixable with the `--fix` option.
```

