import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * A keyframe stop is any identifier, a `<percentage>`, or a timeline range name
 * with its percentage (Scroll-driven Animations 1, Appendix A:
 * `<keyframe-selector> = from | to | <percentage [0,100]> | <timeline-range-name>
 * <percentage>`). Each compiles in every dialect and renders as written; Less and
 * SCSS can also name a stop through an interpolation.
 */
const compile = (dialect: string, source: string) =>
  new Compiler({ quiet: true }).renderToResult(
    { source, filePath: `/proj/entry.${dialect}` },
    { quiet: true, suppressWarnings: true, breakOnError: false }
  );

const STOPS = '@keyframes x { foo { opacity: 0; } 10%, bar { opacity: 0.5; } entry 10%, exit 100% { opacity: 1; } }';
const CSS = '@keyframes x {\n  foo {\n    opacity: 0;\n  }\n  10%,\n  bar {\n    opacity: 0.5;\n  }\n  entry 10%,\n  exit 100% {\n    opacity: 1;\n  }\n}\n';
const INTERPOLATED = '@keyframes y {\n  contain 50% {\n    opacity: 1;\n  }\n}\n';

describe.each(['css', 'less', 'scss', 'jess'])('.%s', (dialect) => {
  it('renders identifier and timeline-range stops as written', async () => {
    const result = await compile(dialect, STOPS);
    expect(result.errors).toEqual([]);
    expect(result.css).toBe(CSS);
  });
});

describe('an interpolated keyframe stop', () => {
  it.each([
    ['less', '@s: contain 50%; @keyframes y { @{s} { opacity: 1; } }'],
    ['scss', '$s: contain 50%; @keyframes y { #{$s} { opacity: 1; } }']
  ])('.%s', async (dialect, source) => {
    const result = await compile(dialect, source);
    expect(result.errors).toEqual([]);
    expect(result.css).toBe(INTERPOLATED);
  });
});
