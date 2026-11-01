import { ProvidedModules } from '@jesscss/core';
import { createRequire } from 'node:module';

/**
 * `#sass` and `#sass/<module>` are this plugin's private paths to the Sass
 * built-in modules in `@jesscss/fns` (the grammar spells `@use "sass:math"` as
 * `#sass/math`), resolved from THIS package's location. The plugin loads and
 * trusts them (no script runtime); the package spelling reaching the same file
 * is the same module.
 *
 * Its own entry (`@jesscss/plugin-scss/provided-modules`), which loads no
 * grammar, so a host can resolve and trust these modules before it loads the
 * plugin.
 */
export const providedModules = new ProvidedModules([
  ['#sass', '@jesscss/fns/sass'],
  ...['color', 'list', 'map', 'math', 'selector', 'string'].map(name => [`#sass/${name}`, `@jesscss/fns/sass/${name}`] as const)
], createRequire(import.meta.url));
