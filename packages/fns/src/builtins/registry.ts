/**
 * Assemble the built-in Less {@link FnRegistry} for the AST-v2 value domain.
 *
 * This is the single production home for turning `builtinLessFns` (this package's
 * self-describing `Fn` set) into a dispatch registry via core's `createFnRegistry`
 * (imported through the narrow `@jesscss/core/value` substrate — the one allowed
 * `fns → core` edge). Consumers that render `.less` through the ast/ engine
 * (`@jesscss/plugin-less`) build the value evaluator from this registry; the core
 * ast/ test harness re-exports it too, so test and production share ONE assembly.
 *
 * Core imports zero fns by design, so the registry cannot be assembled in core;
 * `fns` owns the fn set and already depends on core, making this the natural,
 * cycle-free home.
 */
import { createFnRegistry, type FnRegistry } from '@jesscss/core/value';
import { builtinLessFns } from './index.js';

/** Build a fresh registry populated with the full built-in Less fn set. */
export function makeBuiltinRegistry(): FnRegistry {
  const registry = createFnRegistry();
  registry.registerAll(builtinLessFns);
  return registry;
}
