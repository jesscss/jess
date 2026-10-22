import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * A query feature's NAME takes the dialect's interpolation — Less `@{…}`, SCSS
 * `#{…}`, `.jess` `${…}` (ledger P13 (a): a prelude name takes interpolation) —
 * whether the interpolation leads the name or follows an identifier, and the
 * feature's VALUE after it is a value position (P13 (a), owner 2026-10-20). The
 * parser reads the name as the feature's name, so each dialect writes the
 * feature as `.css` writes the literal one: ".css in general is just .css".
 */
type Extension = '.css' | '.less' | '.scss' | '.jess';

const render = async (source: string, extension: Extension): Promise<string> =>
  new Compiler({}).renderString(source, { extension });

const rule = (prelude: string): string => `${prelude} {\n  .a {\n    b: c;\n  }\n}\n`;

/** `[expected prelude, extension, source]`; the `.css` row is the literal input. */
const features: ReadonlyArray<readonly [string, Extension, string]> = [
  ['@media (min-width: 600px) and (max-width: 900px)', '.css', '@media (min-width: 600px) and (max-width: 900px) { .a { b: c; } }'],
  ['@media (min-width: 600px) and (max-width: 900px)', '.less', '@dimension: width;\n@media (min-@{dimension}: 600px) and (max-@{dimension}: 900px) { .a { b: c; } }'],
  ['@media (min-width: 600px) and (max-width: 900px)', '.scss', '$dimension: width;\n@media (min-#{$dimension}: 600px) and (max-#{$dimension}: 900px) { .a { b: c; } }'],
  ['@media (min-width: 600px) and (max-width: 900px)', '.jess', '$dimension: width;\n@media (min-${dimension}: 600px) and (max-${dimension}: 900px) { .a { b: c; } }'],

  ['@media screen and (min-width: 600px)', '.css', '@media screen and (min-width: 600px) { .a { b: c; } }'],
  ['@media screen and (min-width: 600px)', '.less', '@feature: min-width;\n@breakpoint: 600px;\n@media screen and (@{feature}: @breakpoint) { .a { b: c; } }'],
  ['@media screen and (min-width: 600px)', '.scss', '$feature: min-width;\n$breakpoint: 600px;\n@media screen and (#{$feature}: $breakpoint) { .a { b: c; } }'],
  ['@media screen and (min-width: 600px)', '.jess', '$feature: min-width;\n$breakpoint: 600px;\n@media screen and (${feature}: $breakpoint) { .a { b: c; } }'],

  ['@media (400px <= width <= 900px)', '.css', '@media (400px <= width <= 900px) { .a { b: c; } }'],
  ['@media (400px <= width <= 900px)', '.less', '@dimension: width;\n@media (400px <= @{dimension} <= 900px) { .a { b: c; } }'],

  ['@container card (min-width: 400px)', '.css', '@container card (min-width: 400px) { .a { b: c; } }'],
  ['@container card (min-width: 400px)', '.less', '@dimension: width;\n@container card (min-@{dimension}: 400px) { .a { b: c; } }'],
  ['@container card (min-width: 400px)', '.scss', '$dimension: width;\n@container card (min-#{$dimension}: 400px) { .a { b: c; } }'],
  ['@container card (min-width: 400px)', '.jess', '$dimension: width;\n@container card (min-${dimension}: 400px) { .a { b: c; } }'],

  ['@container (min-width: 400px)', '.css', '@container (min-width: 400px) { .a { b: c; } }'],
  ['@container (min-width: 400px)', '.less', '@feature: min-width;\n@container (@{feature}: 400px) { .a { b: c; } }'],
  ['@container (min-width: 400px)', '.scss', '$feature: min-width;\n@container (#{$feature}: 400px) { .a { b: c; } }'],
  ['@container (min-width: 400px)', '.jess', '$feature: min-width;\n@container (${feature}: 400px) { .a { b: c; } }'],

  ['@supports (display: grid)', '.css', '@supports (display:grid) { .a { b: c; } }'],
  ['@supports (display: grid)', '.less', '@property: display;\n@supports (@{property}:grid) { .a { b: c; } }'],
  ['@supports (display: grid)', '.scss', '$property: display;\n@supports (#{$property}:grid) { .a { b: c; } }'],
  ['@supports (display: grid)', '.jess', '$property: display;\n@supports (${property}:grid) { .a { b: c; } }'],

  ['@supports not (display: grid)', '.css', '@supports not ( display : grid ) { .a { b: c; } }'],
  ['@supports not (display: grid)', '.less', '@property: display;\n@supports not ( @{property} : grid ) { .a { b: c; } }'],
  ['@supports not (display: grid)', '.scss', '$property: display;\n@supports not ( #{$property} : grid ) { .a { b: c; } }'],
  ['@supports not (display: grid)', '.jess', '$property: display;\n@supports not ( ${property} : grid ) { .a { b: c; } }']
];

describe('an interpolated query feature name', () => {
  it.each(features)('writes %s from %s `%s`', async (prelude, extension, source) => {
    await expect(render(source, extension)).resolves.toBe(rule(prelude));
  });
});
