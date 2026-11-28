/**
 * The `sass:selector` members that are also reachable as deprecated GLOBAL
 * functions, under their global names. A registry keys on `fn.name`, so each
 * gets its own callable that delegates to the single body in the module file.
 */
import { define } from '@jesscss/core/value';
import append from './append.js';
import { appendSelectors, nestSelectors } from './compose.js';
import extend, { extendValue } from './extend.js';
import nest from './nest.js';
import parse, { parseSelectorValue } from './parse.js';

/** `selector-append($selectors...)` — the global spelling of `selector.append()`. */
export const selectorAppend = define('selector-append', {
  params: append.params,
  variadic: true,
  body: appendSelectors
});

/** `selector-extend($selector, $extendee, $extender)` — the global spelling of `selector.extend()`. */
export const selectorExtend = define('selector-extend', {
  params: extend.params,
  variadic: true,
  body: extendValue
});

/** `selector-nest($selectors...)` — the global spelling of `selector.nest()`. */
export const selectorNest = define('selector-nest', {
  params: nest.params,
  variadic: true,
  body: nestSelectors
});

/** `selector-parse($selector)` — the global spelling of `selector.parse()`. */
export const selectorParse = define('selector-parse', {
  params: parse.params,
  variadic: true,
  body: parseSelectorValue
});
