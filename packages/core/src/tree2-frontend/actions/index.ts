/**
 * [tree2-native] ACTION_LIST — the registry of tree2 build-host families.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ HOW TO ADD A NODE FAMILY (3 lines — the only shared edit)                 │
 * │                                                                           │
 * │ 1. Create `actions/<family>.ts` exporting `<FAMILY>_ACTIONS: BuildAction[]`│
 * │    (one entry per grammar `type` it constructs; see `ruleset.ts`).        │
 * │ 2. `import { <FAMILY>_ACTIONS } from './<family>.js';` below.             │
 * │ 3. Append `...<FAMILY>_ACTIONS` to `ACTION_LIST`.                          │
 * │                                                                           │
 * │ Then add `actions/__tests__/<family>-host-byte-identity.test.ts` gating   │
 * │ `serialize(direct) === serialize(bridge)` for that family's shapes.       │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * `ACTION_LIST` is APPEND-ONLY, so parallel family agents each add one line at
 * the end — git auto-merges the additions and no agent touches another's module.
 * The dispatch host indexes the list by `type` once; later entries win a type
 * collision (intentional: a specialized family can override a seed default).
 *
 * Re-exports the `host-context` contract so a family module has a single import
 * surface (`from '../host-context.js'`) and this file names the public registry.
 */
export * from '../host-context.js';

import type { BuildAction } from '../host-context.js';
import { RULESET_ACTIONS } from './ruleset.js';
import { DECLARATION_STATIC_ACTIONS } from './declaration-static.js';
import { VALUE_LEAF_ACTIONS } from './value-leaf.js';

export const ACTION_LIST: readonly BuildAction[] = [
  ...RULESET_ACTIONS,
  ...DECLARATION_STATIC_ACTIONS,
  ...VALUE_LEAF_ACTIONS,
];
