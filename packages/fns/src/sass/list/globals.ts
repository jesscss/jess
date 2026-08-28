/**
 * The `sass:list` members that are also reachable as deprecated GLOBAL
 * functions, under their global names.
 *
 * Eight members keep their name as a global (`length`, `nth`, `index`,
 * `is-bracketed`, `set-nth`, `join`, `append`, `zip`) and are re-exported from
 * the module index unchanged. Only `separator` is renamed — the global is
 * `list-separator` — and a registry keys on `fn.name`, so it gets its own
 * callable that delegates to the single body in the module file. This is the
 * same shape as `sass/string/globals.ts`.
 */
import { defineFunction } from '@jesscss/core';
import separator from './separator.js';

/** `list-separator($list)` — the global spelling of `list.separator()`. */
export const listSeparator = defineFunction('list-separator', {
  params: separator.params,
  body: list => separator(list)
});
