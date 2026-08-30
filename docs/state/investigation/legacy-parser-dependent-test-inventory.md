# Legacy Parser-Dependent Semantic-Test Inventory

This is a bounded migration inventory, not an architectural exception. The
production parser contract is the public dialect plugin route:

`parse source once -> Stylesheet -> Context/Compiler render`.

The occurrences below were historical `tree/` test setup that invoked the
removed `LessParser` shape to obtain legacy nodes. They did not motivate a
compatibility parser, BuilderHost, bridge, or source reparse, and have now been
removed after public direct-AST replacements were paired and verified.

## Audit method

The exact search is:

```sh
rg -n "new Parser|\\{ Parser \\}" \
  packages/core/src/tree/__tests__/{at-rule,reference,mixin}.test.ts
```

It finds no setup sites. The final removal covered one at-rule site, two
reference sites, and five mixin sites.

## Exact sites and behavior status

| Legacy test site | Historical behavior | Public direct-AST replacement status |
| --- | --- | --- |
| Removed from `packages/core/src/tree/__tests__/at-rule.test.ts` | Two parameterized mixin calls keep independent nested `@media` fallback values. | Paired and green: `packages/jess/test/less/at-rules.test.ts` renders both `100px` and `200px` branches through `Stylesheet` + `Compiler`. |
| Removed from `packages/core/src/tree/__tests__/reference.test.ts` | `+:` merge-chain property references render ordered comma lists without the old public lookup bridge. | Paired and green: `packages/jess/test/less/namespace-public-semantics.test.ts` asserts exact `box-shadow+` and `background+` output. |
| Removed from `packages/core/src/tree/__tests__/reference.test.ts` | Mixin-call accessors: parameter-bound `[@return]`, comma arguments with `[]`, and dynamic `[@@key]`. | Paired and green: `packages/jess/test/less/reference-public-semantics.test.ts` covers all three. |
| Removed from `packages/core/src/tree/__tests__/mixin.test.ts` | Guarded namespace union chooses all matching callable definitions through `#guarded > #deeper > .mixin()`. | Paired and green: exact public output covers all matching guarded definitions in source order. |
| Removed from `packages/core/src/tree/__tests__/mixin.test.ts` | Stable namespace paths resolve nested, compound, and parameterized callable rulesets. | Paired and green: exact public output covers nested, compound, and bare parameterized paths. |
| Removed from `packages/core/src/tree/__tests__/mixin.test.ts` | A namespaced ruleset remains a namespace container while its terminal parameterized mixin dispatches. | Paired and green: exact public output keeps the outer namespace container and dispatches only the terminal mixin. |
| Removed from `packages/core/src/tree/__tests__/mixin.test.ts` | Recursive namespace descent excludes only the terminal ruleset from a parameterized call candidate set. | Paired and green: exact public output proves the same terminal-only exclusion through nested namespace descent. |
| Removed from `packages/core/src/tree/__tests__/mixin.test.ts` | Interpolated nested mixin paths preserve sibling closure and selector composition. | Paired and green: exact public output covers the complete historical source, including the final parameterized interpolated ruleset lookup. A second public regression proves separate mixin calls retain separate interpolated-rule call frames. |

## Green public replacements already added in this migration batch

- Simple/parameterized Less mixin definitions and calls.
- Less variable-reference output.
- Recursive guarded mixin expansion.
- Detached-ruleset argument capture.
- Call-site `!important` propagation.
- Lexical nested mixin scope.
- Reference-import namespace output.
- Parsed nested media output.
- Namespaced mixin property access, `[]` call return, and dynamic `[@@key]`.

## Result

The legacy Parser-dependent setup has been deleted. Direct-node core tests
remain where they test deliberate node/runtime invariants; the public dialect
tests own the source-to-`Stylesheet` behavior above.
