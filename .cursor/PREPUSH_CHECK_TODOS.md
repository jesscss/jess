# Pre-push Check TODOs

Generated: 2026-04-05T02:33:28.305Z

These checks failed during `--mode=upstream` and were treated as non-blocking.

## TODO Items
1. [ ] `packages/core` - `pnpm --filter ./packages/core typecheck` (exit 2)

## Failure Details
### 1) packages/core

- Command: `pnpm --filter ./packages/core typecheck`
- Exit: `2`

```
> @jesscss/core@2.0.0-alpha.5 typecheck /Users/matthew/git/worktrees/jess-dev/packages/core
> tsc -p tsconfig.json --noEmit

src/define-function.ts(173,17): error TS2391: Function implementation is missing or not immediately following the declaration.
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
src/tree/__tests__/extend-less-fixtures.test.ts(505,5): error TS2322: Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules'.
  Types of property 'value' are incompatible.
    Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>'.
        Types have separate declarations of a private property '_meta'.
src/tree/__tests__/extend-less-fixtures.test.ts(506,35): error TS2345: Argument of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/context").Context' is not assignable to parameter of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Context'.
  Types of property 'plugins' are incompatible.
    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface[]' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface'.
        Types of property 'parse' are incompatible.
          Type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules) | undefined' is not assignable to type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules) | undefined'.
            Type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules' is not assignable to type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules'.
              Call signature return types 'Rules' and 'Rules' are incompatible.
                The types of 'value' are incompatible between these types.
                  Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]'.
                    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>'.
                      Types have separate declarations of a private property '_meta'.
src/tree/__tests__/extend-less-fixtures.test.ts(754,5): error TS2322: Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules'.
  Types of property 'value' are incompatible.
    Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>'.
        Types have separate declarations of a private property '_meta'.
src/tree/__tests__/extend-less-fixtures.test.ts(755,35): error TS2345: Argument of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/context").Context' is not assignable to parameter of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Context'.
  Types of property 'plugins' are incompatible.
    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface[]' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface'.
        Types of property 'parse' are incompatible.
          Type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules) | undefined' is not assignable to type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules) | undefined'.
            Type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules' is not assignable to type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules'.
              Call signature return types 'Rules' and 'Rules' are incompatible.
                The types of 'value' are incompatible between these types.
                  Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]'.
                    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>'.
                      Types have separate declarations of a private property '_meta'.
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
src/tree/__tests__/ruleset.test.ts(59,5): error TS2322: Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules'.
  Types of property 'value' are incompatible.
    Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>'.
        Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(60,35): error TS2345: Argument of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/context").Context' is not assignable to parameter of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Context'.
  Types of property 'plugins' are incompatible.
    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface[]' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface'.
        Types of property 'parse' are incompatible.
          Type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules) | undefined' is not assignable to type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules) | undefined'.
            Type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules' is not assignable to type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules'.
              Call signature return types 'Rules' and 'Rules' are incompatible.
                The types of 'value' are incompatible between these types.
                  Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]'.
                    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>'.
                      Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(62,52): error TS2322: Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/context").Context' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Context'.
  Types of property 'plugins' are incompatible.
    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface[]' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface'.
        Types of property 'parse' are incompatible.
          Type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules) | undefined' is not assignable to type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules) | undefined'.
            Type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules' is not assignable to type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules'.
              Call signature return types 'Rules' and 'Rules' are incompatible.
                The types of 'value' are incompatible between these types.
                  Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]'.
                    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>'.
                      Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(102,5): error TS2322: Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules'.
  Types of property 'value' are incompatible.
    Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>'.
        Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(103,35): error TS2345: Argument of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/context").Context' is not assignable to parameter of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Context'.
  Types of property 'plugins' are incompatible.
    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface[]' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface'.
        Types of property 'parse' are incompatible.
          Type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules) | undefined' is not assignable to type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules) | undefined'.
            Type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules' is not assignable to type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules'.
              Call signature return types 'Rules' and 'Rules' are incompatible.
                The types of 'value' are incompatible between these types.
                  Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]'.
                    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>'.
                      Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(105,52): error TS2322: Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/context").Context' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Context'.
  Types of property 'plugins' are incompatible.
    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface[]' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface'.
        Types of property 'parse' are incompatible.
          Type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules) | undefined' is not assignable to type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules) | undefined'.
            Type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules' is not assignable to type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules'.
              Call signature return types 'Rules' and 'Rules' are incompatible.
                The types of 'value' are incompatible between these types.
                  Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]'.
                    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>'.
                      Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(131,5): error TS2322: Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules'.
  Types of property 'value' are incompatible.
    Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>'.
        Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(132,35): error TS2345: Argument of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/context").Context' is not assignable to parameter of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Context'.
  Types of property 'plugins' are incompatible.
    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface[]' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface'.
        Types of property 'parse' are incompatible.
          Type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules) | undefined' is not assignable to type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules) | undefined'.
            Type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules' is not assignable to type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules'.
              Call signature return types 'Rules' and 'Rules' are incompatible.
                The types of 'value' are incompatible between these types.
                  Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]'.
                    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>'.
                      Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(134,52): error TS2322: Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/context").Context' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Context'.
  Types of property 'plugins' are incompatible.
    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface[]' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface'.
        Types of property 'parse' are incompatible.
          Type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules) | undefined' is not assignable to type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules) | undefined'.
            Type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules' is not assignable to type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules'.
              Call signature return types 'Rules' and 'Rules' are incompatible.
                The types of 'value' are incompatible between these types.
                  Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]'.
                    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>'.
                      Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(164,5): error TS2322: Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules'.
  Types of property 'value' are incompatible.
    Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>'.
        Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(165,35): error TS2345: Argument of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/context").Context' is not assignable to parameter of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Context'.
  Types of property 'plugins' are incompatible.
    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface[]' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface'.
        Types of property 'parse' are incompatible.
          Type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules) | undefined' is not assignable to type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules) | undefined'.
            Type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules' is not assignable to type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules'.
              Call signature return types 'Rules' and 'Rules' are incompatible.
                The types of 'value' are incompatible between these types.
                  Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]'.
                    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>'.
                      Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(167,52): error TS2322: Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/context").Context' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Context'.
  Types of property 'plugins' are incompatible.
    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface[]' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface'.
        Types of property 'parse' are incompatible.
          Type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules) | undefined' is not assignable to type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules) | undefined'.
            Type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules' is not assignable to type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules'.
              Call signature return types 'Rules' and 'Rules' are incompatible.
                The types of 'value' are incompatible between these types.
                  Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]'.
                    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>'.
                      Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(196,5): error TS2322: Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules'.
  Types of property 'value' are incompatible.
    Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>'.
        Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(197,35): error TS2345: Argument of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/context").Context' is not assignable to parameter of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Context'.
  Types of property 'plugins' are incompatible.
    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface[]' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface'.
        Types of property 'parse' are incompatible.
          Type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules) | undefined' is not assignable to type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules) | undefined'.
            Type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules' is not assignable to type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules'.
              Call signature return types 'Rules' and 'Rules' are incompatible.
                The types of 'value' are incompatible between these types.
                  Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]'.
                    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>'.
                      Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(199,52): error TS2322: Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/context").Context' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Context'.
  Types of property 'plugins' are incompatible.
    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface[]' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface'.
        Types of property 'parse' are incompatible.
          Type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules) | undefined' is not assignable to type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules) | undefined'.
            Type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules' is not assignable to type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules'.
              Call signature return types 'Rules' and 'Rules' are incompatible.
                The types of 'value' are incompatible between these types.
                  Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]'.
                    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>'.
                      Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(234,5): error TS2322: Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules'.
  Types of property 'value' are incompatible.
    Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>'.
        Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(235,35): error TS2345: Argument of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/context").Context' is not assignable to parameter of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Context'.
  Types of property 'plugins' are incompatible.
    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface[]' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface'.
        Types of property 'parse' are incompatible.
          Type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules) | undefined' is not assignable to type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules) | undefined'.
            Type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules' is not assignable to type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules'.
              Call signature return types 'Rules' and 'Rules' are incompatible.
                The types of 'value' are incompatible between these types.
                  Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]'.
                    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>'.
                      Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(237,52): error TS2322: Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/context").Context' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Context'.
  Types of property 'plugins' are incompatible.
    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface[]' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface'.
        Types of property 'parse' are incompatible.
          Type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules) | undefined' is not assignable to type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules) | undefined'.
            Type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules' is not assignable to type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules'.
              Call signature return types 'Rules' and 'Rules' are incompatible.
                The types of 'value' are incompatible between these types.
                  Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]'.
                    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>'.
                      Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(272,5): error TS2322: Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules'.
  Types of property 'value' are incompatible.
    Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>'.
        Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(273,35): error TS2345: Argument of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/context").Context' is not assignable to parameter of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Context'.
  Types of property 'plugins' are incompatible.
    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface[]' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface'.
        Types of property 'parse' are incompatible.
          Type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules) | undefined' is not assignable to type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules) | undefined'.
            Type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules' is not assignable to type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules'.
              Call signature return types 'Rules' and 'Rules' are incompatible.
                The types of 'value' are incompatible between these types.
                  Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]'.
                    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>'.
                      Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(275,52): error TS2322: Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/context").Context' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Context'.
  Types of property 'plugins' are incompatible.
    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface[]' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface'.
        Types of property 'parse' are incompatible.
          Type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules) | undefined' is not assignable to type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules) | undefined'.
            Type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules' is not assignable to type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules'.
              Call signature return types 'Rules' and 'Rules' are incompatible.
                The types of 'value' are incompatible between these types.
                  Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]'.
                    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>'.
                      Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(304,5): error TS2322: Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules'.
  Types of property 'value' are incompatible.
    Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>'.
        Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(305,35): error TS2345: Argument of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/context").Context' is not assignable to parameter of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Context'.
  Types of property 'plugins' are incompatible.
    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface[]' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface'.
        Types of property 'parse' are incompatible.
          Type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules) | undefined' is not assignable to type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules) | undefined'.
            Type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules' is not assignable to type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules'.
              Call signature return types 'Rules' and 'Rules' are incompatible.
                The types of 'value' are incompatible between these types.
                  Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]'.
                    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>'.
                      Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(307,52): error TS2322: Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/context").Context' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Context'.
  Types of property 'plugins' are incompatible.
    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface[]' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface'.
        Types of property 'parse' are incompatible.
          Type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules) | undefined' is not assignable to type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules) | undefined'.
            Type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules' is not assignable to type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules'.
              Call signature return types 'Rules' and 'Rules' are incompatible.
                The types of 'value' are incompatible between these types.
                  Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]'.
                    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>'.
                      Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(387,5): error TS2322: Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules'.
  Types of property 'value' are incompatible.
    Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>'.
        Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(388,35): error TS2345: Argument of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/context").Context' is not assignable to parameter of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Context'.
  Types of property 'plugins' are incompatible.
    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface[]' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface'.
        Types of property 'parse' are incompatible.
          Type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules) | undefined' is not assignable to type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules) | undefined'.
            Type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules' is not assignable to type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules'.
              Call signature return types 'Rules' and 'Rules' are incompatible.
                The types of 'value' are incompatible between these types.
                  Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]'.
                    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>'.
                      Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(390,52): error TS2322: Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/context").Context' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Context'.
  Types of property 'plugins' are incompatible.
    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface[]' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface'.
        Types of property 'parse' are incompatible.
          Type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules) | undefined' is not assignable to type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules) | undefined'.
            Type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules' is not assignable to type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules'.
              Call signature return types 'Rules' and 'Rules' are incompatible.
                The types of 'value' are incompatible between these types.
                  Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]'.
                    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>'.
                      Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(418,5): error TS2322: Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules'.
  Types of property 'value' are incompatible.
    Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>'.
        Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(419,35): error TS2345: Argument of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/context").Context' is not assignable to parameter of type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Context'.
  Types of property 'plugins' are incompatible.
    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface[]' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface[]'.
      Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginInterface' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginInterface'.
        Types of property 'parse' are incompatible.
          Type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules) | undefined' is not assignable to type '((filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules) | undefined'.
            Type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/plugin").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/rules").Rules' is not assignable to type '(filePath: string, source: string, options?: import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").PluginParseOptions | undefined) => import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Rules'.
              Call signature return types 'Rules' and 'Rules' are incompatible.
                The types of 'value' are incompatible between these types.
                  Type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>[]' is not assignable to type 'readonly import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>[]'.
                    Type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").Node<import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeValue, import("/Users/matthew/git/worktrees/jess-dev/packages/core/src/tree/node-base").NodeOptions, Record<...>>' is not assignable to type 'import("/Users/matthew/git/worktrees/jess-dev/packages/core/lib/index").Node<NodeValue, NodeOptions, Record<string, unknown>>'.
                      Types have separate declarations of a private property '_meta'.
src/tree/__tests__/ruleset.test.ts(426,24): error TS2339: Property 'rules' does not exist on type 'never'.
  The intersection 'Node<NodeValue, NodeOptions, Record<string, unknown>> & Ruleset<RulesetValue>' was reduced to 'never' because property '_meta' exists in multiple constituents and is private in some.
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
src/tree/node-base.ts(334,7): error TS2322: Type 'Object' is not assignable to type 'O & AllNodeOptions'.
  The 'Object' type is assignable to very few other types. Did you mean to use the 'any' type instead?
    Type 'Object' is not assignable to type 'O'.
      'Object' is assignable to the constraint of type 'O', but 'O' could be instantiated with a different subtype of constraint 'NodeOptions'.
        The 'Object' type is assignable to very few other types. Did you mean to use the 'any' type instead?
src/tree/node-base.ts(336,5): error TS2322: Type '(O & AllNodeOptions) | undefined' is not assignable to type 'O & AllNodeOptions'.
  Type 'undefined' is not assignable to type 'O & AllNodeOptions'.
    Type 'undefined' is not assignable to type 'O'.
      'O' could be instantiated with an arbitrary type which could be unrelated to 'undefined'.
src/tree/node-base.ts(590,11): error TS7053: Element implicitly has an 'any' type because expression of type 'string' can't be used to index type 'Node<Data, O, ChildData>'.
  No index signature with a parameter of type 'string' was found on type 'Node<Data, O, ChildData>'.
src/tree/node-base.ts(593,7): error TS7053: Element implicitly has an 'any' type because expression of type 'string' can't be used to index type 'Node<Data, O, ChildData>'.
  No index signature with a parameter of type 'string' was found on type 'Node<Data, O, ChildData>'.
src/tree/node-base.ts(850,44): error TS2339: Property 'length' does not exist on type 'ChildData[K]'.
src/tree/node-base.ts(854,21): error TS2322: Type 'any[]' is not assignable to type 'ChildData[K]'.
  'any[]' is assignable to the constraint of type 'ChildData[K]', but 'ChildData[K]' could be instantiated with a different subtype of constraint 'unknown'.
src/tree/node-base.ts(854,54): error TS2488: Type 'ChildData[K]' must have a '[Symbol.iterator]()' method that returns an iterator.
src/tree/node-base.ts(857,13): error TS7053: Element implicitly has an 'any' type because expression of type 'number' can't be used to index type 'unknown'.
  No index signature with a parameter of type 'number' was found on type 'unknown'.
src/tree/node-base.ts(887,11): error TS2322: Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to type 'InstanceType<T>'.
src/tree/node-base.ts(922,36): error TS2345: Argument of type '(n: Node<NodeValue, NodeOptions, Record<string, unknown>>, idx?: number | undefined) => MaybePromise<Node<NodeValue, NodeOptions, Record<...>>>' is not assignable to parameter of type '(n: Node<NodeValue, NodeOptions, Record<string, unknown>>, idx?: number | undefined) => Node<NodeValue, NodeOptions, Record<...>>'.
  Type 'MaybePromise<Node<NodeValue, NodeOptions, Record<string, unknown>>>' is not assignable to type 'Node<NodeValue, NodeOptions, Record<string, unknown>>'.
    Type 'Promise<Node<NodeValue, NodeOptions, Record<string, unknown>>>' is missing the following properties from type 'Node<NodeValue, NodeOptions, Record<string, unknown>>': _location, location, _meta, _metaFlags, and 67 more.
src/tree/node-base.ts(1378,7): error TS2322: Type 'MaybePromise<Node<NodeValue, NodeOptions, Record<string, unknown>>>' is not assignable to type 'Node<NodeValue, NodeOptions, Record<string, unknown>>'.
  Type 'Promise<Node<NodeValue, NodeOptions, Record<string, unknown>>>' is missing the following properties from type 'Node<NodeValue, NodeOptions, Record<string, unknown>>': _location, location, _meta, _metaFlags, and 67 more.
src/tree/node-base.ts(1393,7): error TS2322: Type 'MaybePromise<Node<NodeValue, NodeOptions, Record<string, unknown>>>' is not assignable to type 'Node<NodeValue, NodeOptions, Record<string, unknown>>'.
  Type 'Promise<Node<NodeValue, NodeOptions, Record<string, unknown>>>' is missing the following properties from type 'Node<NodeValue, NodeOptions, Record<string, unknown>>': _location, location, _meta, _metaFlags, and 67 more.
src/tree/node-base.ts(1620,44): error TS2345: Argument of type 'Context | PrintOptions | undefined' is not assignable to parameter of type 'Context | RenderKey | undefined'.
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
src/tree/util/selector-utils.ts(123,36): error TS2345: Argument of type 'number | Context' is not assignable to parameter of type 'Context'.
  Type 'number' is not assignable to type 'Context'.
src/tree/util/selector-utils.ts(160,25): error TS2339: Property 'Extend' does not exist on type 'typeof N'.
src/tree/util/selector-utils.ts(308,12): error TS2571: Object is of type 'unknown'.
src/tree/util/selector-utils.ts(308,39): error TS7006: Parameter 'item' implicitly has an 'any' type.
src/tree/util/selector-utils.ts(327,12): error TS2571: Object is of type 'unknown'.
src/tree/util/selector-utils.ts(327,39): error TS7006: Parameter 'item' implicitly has an 'any' type.
src/tree/util/selector-utils.ts(451,7): error TS2740: Type 'Nil' is missing the following properties from type 'Selector<any, NodeOptions, Record<string, unknown>>': getKeySet, isSelector, _valueOf, keySetLibrary, and 9 more.
src/tree/util/selector-utils.ts(501,25): error TS18046: 'selectorData' is of type 'unknown'.
src/tree/util/selector-utils.ts(502,20): error TS18046: 'selectorData' is of type 'unknown'.
src/tree/util/selector-utils.ts(565,7): error TS2740: Type 'Nil' is missing the following properties from type 'Selector<any, NodeOptions, Record<string, unknown>>': getKeySet, isSelector, _valueOf, keySetLibrary, and 9 more.
src/tree/util/selector-utils.ts(576,26): error TS2339: Property 'get' does not exist on type 'never'.
src/tree/util/selector-utils.ts(578,29): error TS2339: Property 'copy' does not exist on type 'never'.
src/tree/util/selector-utils.ts(586,19): error TS2339: Property 'copy' does not exist on type 'never'.
src/tree/util/serialize-helper.ts(89,29): error TS2341: Property '_getRenderChildren' is private and only accessible within class 'Rules'.
src/tree/util/serialize-helper.ts(384,34): error TS2345: Argument of type 'Rules | Ruleset<RulesetValue> | AtRule' is not assignable to parameter of type 'Ruleset<RulesetValue> | AtRule'.
  Type 'Rules' is not assignable to type 'Ruleset<RulesetValue> | AtRule'.
    Type 'Rules' is missing the following properties from type 'AtRule': name, prelude, rules, preludeEdge, and 15 more.
test/eval-model-characterization.test.ts(81,65): error TS2339: Property 'createPlacementWrapperWithChildren' does not exist on type 'never'.
  The intersection 'Rules & { createPlacementWrapperWithChildren: (...args: unknown[]) => unknown; createShallowBodyWrapper: (...args: unknown[]) => unknown; registerNode: (...args: unknown[]) => unknown; _connectSharedChildren: (...args: unknown[]) => unknown; }' was reduced to 'never' because property '_connectSharedChildren' exists in multiple constituents and is private in some.
test/eval-model-characterization.test.ts(82,55): error TS2339: Property 'createShallowBodyWrapper' does not exist on type 'never'.
  The intersection 'Rules & { createPlacementWrapperWithChildren: (...args: unknown[]) => unknown; createShallowBodyWrapper: (...args: unknown[]) => unknown; registerNode: (...args: unknown[]) => unknown; _connectSharedChildren: (...args: unknown[]) => unknown; }' was reduced to 'never' because property '_connectSharedChildren' exists in multiple constituents and is private in some.
test/eval-model-characterization.test.ts(83,43): error TS2339: Property 'registerNode' does not exist on type 'never'.
  The intersection 'Rules & { createPlacementWrapperWithChildren: (...args: unknown[]) => unknown; createShallowBodyWrapper: (...args: unknown[]) => unknown; registerNode: (...args: unknown[]) => unknown; _connectSharedChildren: (...args: unknown[]) => unknown; }' was reduced to 'never' because property '_connectSharedChildren' exists in multiple constituents and is private in some.
test/eval-model-characterization.test.ts(84,52): error TS2339: Property '_connectSharedChildren' does not exist on type 'never'.
  The intersection 'Rules & { createPlacementWrapperWithChildren: (...args: unknown[]) => unknown; createShallowBodyWrapper: (...args: unknown[]) => unknown; registerNode: (...args: unknown[]) => unknown; _connectSharedChildren: (...args: unknown[]) => unknown; }' was reduced to 'never' because property '_connectSharedChildren' exists in multiple constituents and is private in some.
test/eval-model-characterization.test.ts(86,3): error TS2322: Type '(this: Node, ...args: unknown[]) => unknown' is not assignable to type '((deep?: boolean | undefined, cloneFn?: ((n: Node<NodeValue, NodeOptions, Record<string, unknown>>) => Node<NodeValue, NodeOptions, Record<...>>) | undefined, ctx?: Context | undefined) => Node<...> & { ...; }) & ((...args: unknown[]) => unknown)'.
  Type '(this: Node, ...args: unknown[]) => unknown' is not assignable to type '(deep?: boolean | undefined, cloneFn?: ((n: Node<NodeValue, NodeOptions, Record<string, unknown>>) => Node<NodeValue, NodeOptions, Record<...>>) | undefined, ctx?: Context | undefined) => Node<...> & { ...; }'.
    Type 'unknown' is not assignable to type 'Node<NodeValue, NodeOptions, Record<string, unknown>> & { clone: (...args: unknown[]) => unknown; }'.
      Type 'unknown' is not assignable to type 'Node<NodeValue, NodeOptions, Record<string, unknown>>'.
test/eval-model-characterization.test.ts(90,14): error TS2339: Property 'createPlacementWrapperWithChildren' does not exist on type 'never'.
  The intersection 'Rules & { createPlacementWrapperWithChildren: (...args: unknown[]) => unknown; createShallowBodyWrapper: (...args: unknown[]) => unknown; registerNode: (...args: unknown[]) => unknown; _connectSharedChildren: (...args: unknown[]) => unknown; }' was reduced to 'never' because property '_connectSharedChildren' exists in multiple constituents and is private in some.
test/eval-model-characterization.test.ts(94,14): error TS2339: Property 'createShallowBodyWrapper' does not exist on type 'never'.
  The intersection 'Rules & { createPlacementWrapperWithChildren: (...args: unknown[]) => unknown; createShallowBodyWrapper: (...args: unknown[]) => unknown; registerNode: (...args: unknown[]) => unknown; _connectSharedChildren: (...args: unknown[]) => unknown; }' was reduced to 'never' because property '_connectSharedChildren' exists in multiple constituents and is private in some.
test/eval-model-characterization.test.ts(98,14): error TS2339: Property 'registerNode' does not exist on type 'never'.
  The intersection 'Rules & { createPlacementWrapperWithChildren: (...args: unknown[]) => unknown; createShallowBodyWrapper: (...args: unknown[]) => unknown; registerNode: (...args: unknown[]) => unknown; _connectSharedChildren: (...args: unknown[]) => unknown; }' was reduced to 'never' because property '_connectSharedChildren' exists in multiple constituents and is private in some.
test/eval-model-characterization.test.ts(102,14): error TS2339: Property '_connectSharedChildren' does not exist on type 'never'.
  The intersection 'Rules & { createPlacementWrapperWithChildren: (...args: unknown[]) => unknown; createShallowBodyWrapper: (...args: unknown[]) => unknown; registerNode: (...args: unknown[]) => unknown; _connectSharedChildren: (...args: unknown[]) => unknown; }' was reduced to 'never' because property '_connectSharedChildren' exists in multiple constituents and is private in some.
test/eval-model-characterization.test.ts(112,16): error TS2339: Property 'createPlacementWrapperWithChildren' does not exist on type 'never'.
  The intersection 'Rules & { createPlacementWrapperWithChildren: (...args: unknown[]) => unknown; createShallowBodyWrapper: (...args: unknown[]) => unknown; registerNode: (...args: unknown[]) => unknown; _connectSharedChildren: (...args: unknown[]) => unknown; }' was reduced to 'never' because property '_connectSharedChildren' exists in multiple constituents and is private in some.
test/eval-model-characterization.test.ts(113,16): error TS2339: Property 'createShallowBodyWrapper' does not exist on type 'never'.
  The intersection 'Rules & { createPlacementWrapperWithChildren: (...args: unknown[]) => unknown; createShallowBodyWrapper: (...args: unknown[]) => unknown; registerNode: (...args: unknown[]) => unknown; _connectSharedChildren: (...args: unknown[]) => unknown; }' was reduced to 'never' because property '_connectSharedChildren' exists in multiple constituents and is private in some.
test/eval-model-characterization.test.ts(114,16): error TS2339: Property 'registerNode' does not exist on type 'never'.
  The intersection 'Rules & { createPlacementWrapperWithChildren: (...args: unknown[]) => unknown; createShallowBodyWrapper: (...args: unknown[]) => unknown; registerNode: (...args: unknown[]) => unknown; _connectSharedChildren: (...args: unknown[]) => unknown; }' was reduced to 'never' because property '_connectSharedChildren' exists in multiple constituents and is private in some.
test/eval-model-characterization.test.ts(115,16): error TS2339: Property '_connectSharedChildren' does not exist on type 'never'.
  The intersection 'Rules & { createPlacementWrapperWithChildren: (...args: unknown[]) => unknown; createShallowBodyWrapper: (...args: unknown[]) => unknown; registerNode: (...args: unknown[]) => unknown; _connectSharedChildren: (...args: unknown[]) => unknown; }' was reduced to 'never' because property '_connectSharedChildren' exists in multiple constituents and is private in some.
test/eval-model-characterization.test.ts(129,55): error TS2339: Property 'prepareRender' does not exist on type 'never'.
  The intersection 'Compiler & { prepareRender: (filePath: string, options?: unknown) => Promise<{ context: any; profile: unknown; }>; evaluateInput: (context: any, input: { filePath: string; }, profile?: unknown) => Promise<...>; renderTree: (tree: any, context: any, profile?: unknown) => string; }' was reduced to 'never' because property 'prepareRender' exists in multiple constituents and is private in some.
test/eval-model-characterization.test.ts(143,39): error TS2339: Property 'evaluateInput' does not exist on type 'never'.
  The intersection 'Compiler & { prepareRender: (filePath: string, options?: unknown) => Promise<{ context: any; profile: unknown; }>; evaluateInput: (context: any, input: { filePath: string; }, profile?: unknown) => Promise<...>; renderTree: (tree: any, context: any, profile?: unknown) => string; }' was reduced to 'never' because property 'prepareRender' exists in multiple constituents and is private in some.
test/eval-model-characterization.test.ts(144,27): error TS2339: Property 'renderTree' does not exist on type 'never'.
  The intersection 'Compiler & { prepareRender: (filePath: string, options?: unknown) => Promise<{ context: any; profile: unknown; }>; evaluateInput: (context: any, input: { filePath: string; }, profile?: unknown) => Promise<...>; renderTree: (tree: any, context: any, profile?: unknown) => string; }' was reduced to 'never' because property 'prepareRender' exists in multiple constituents and is private in some.
../less-parser/src/productions/values.ts(398,18): error TS1362: 'Negative' cannot be used as a value because it was exported using 'export type'.
../less-parser/src/productions/values.ts(499,20): error TS2345: Argument of type 'Any<AnyRole> | Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to parameter of type 'Quoted | Any<AnyRole>'.
  Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is not assignable to type 'Quoted | Any<AnyRole>'.
    Type 'Node<NodeValue, NodeOptions, Record<string, unknown>>' is missing the following properties from type 'Any<AnyRole>': value, role
/Users/matthew/git/worktrees/jess-dev/packages/core:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @jesscss/core@2.0.0-alpha.5 typecheck: `tsc -p tsconfig.json --noEmit`
Exit status 2
```

