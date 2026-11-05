import { defineFunction, makeKeyword } from '@jesscss/core/value';

/** The base-36 range dart-sass draws from: always six digits, never zero-padded away. */
const MIN = 36 ** 5;
const RANGE = 36 ** 6 - MIN;

/**
 * Sass `string.unique-id()` — the `unique-id()` global.
 *
 * An UNQUOTED string, `u` followed by six base-36 digits (dart-sass 1.101.0
 * emits e.g. `uu7ad4j`, `uuvphk8`). The value is random per call, not a
 * monotonic counter, so nothing may depend on a particular id.
 */
const uniqueId = defineFunction('unique-id', {
  params: [] as const,
  body: () => makeKeyword(`u${Math.floor(MIN + Math.random() * RANGE).toString(36)}`)
});

export default uniqueId;
