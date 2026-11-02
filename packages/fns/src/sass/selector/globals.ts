/**
 * The `sass:selector` members that are also reachable as deprecated GLOBAL
 * functions, under their global names. A registry keys on `fn.name`, so each
 * gets its own callable that delegates to the single body in the module file.
 */
import { defineFunction } from '@jesscss/core/value';
import parse, { parseSelectorValue } from './parse.js';

/** `selector-parse($selector)` — the global spelling of `selector.parse()`. */
export const selectorParse = defineFunction('selector-parse', {
  params: parse.params,
  variadic: true,
  body: parseSelectorValue
});
