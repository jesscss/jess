/**
 * Test helper: build an {@link FnRegistry} populated with the full built-in Less
 * set, now sourced from `@jesscss/fns`'s `builtinLessFns` (the successor to the
 * former in-core `FN_LIST`). This is the DEFAULT registration used everywhere the
 * built-in evaluator is exercised in tests. The seam (`buildEvaluator` taking an
 * injected registry) is unchanged; only the fn SOURCE moved out of core.
 *
 * Core production code imports zero fns; this lives under `__tests__` (tests may
 * import `@jesscss/fns`).
 */
import { builtinLessFns } from '@jesscss/fns';
import { createFnRegistry, type FnRegistry } from '../../value-dispatch.js';

export function makeBuiltinRegistry(): FnRegistry {
  const registry = createFnRegistry();
  registry.registerAll(builtinLessFns);
  return registry;
}
