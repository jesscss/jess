import type { ValueGroup } from '@jesscss/core/value';

/**
 * Dart Sass's arity errors for a built-in whose parameters are all required:
 * `Missing argument $value.` and `Only 1 argument allowed, but 2 were passed.`
 */
export function exactArgs(items: readonly ValueGroup[], names: readonly string[]): void {
  if (items.length < names.length) {
    throw new TypeError(`Missing argument $${names[items.length]}.`);
  }
  if (items.length > names.length) {
    throw new TypeError(`Only ${names.length} argument${names.length === 1 ? '' : 's'} allowed, but ${items.length} were passed.`);
  }
}
