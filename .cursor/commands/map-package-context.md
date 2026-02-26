# Map Package Context

Use this when you want an evidence-based map of a single package (entrypoints, scripts, tests, hotspots, suggested rule globs).

## Workflow

1. **Pick the target package directory**
   - Example: `packages/core`, `packages/jess`, `packages/less-parser`

2. **Run a cartography pass**
   - Use the `codebase-mapper` agent to produce:
     - files inspected (paths)
     - entrypoints (`package.json` exports/main/types)
     - scripts (build/test/lint/ci)
     - test layout
     - hotspots
     - suggested `globs`

3. **Apply the map**
   - If needed, add/update:
     - `.cursor/rules/packages/<pkg>.mdc`
     - `.cursor/rules/subtrees/<pkg>__<subtree>.mdc`
   - Keep rules short; put procedures into skills.

