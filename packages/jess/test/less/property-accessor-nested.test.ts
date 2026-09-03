import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

/*
 * A `$name` property accessor must resolve the same declarations whether the
 * output is nested (the Less 5 default) or collapsed; the nested emitter used
 * to skip publishing declarations to the accessor timeline, so `$width` was a
 * name-not-found error under the default and fine under collapseNesting.
 */
const render = (source: string, collapseNesting: boolean) =>
  new Compiler({ compile: { plugins: [lessPlugin({ collapseNesting })] } })
    .renderToResult({ source, language: 'less', extension: '.less' }, {});

const cases: [string, string, RegExp][] = [
  ['sibling', '.a { width: 100px; height: ($width / 2); }', /height: 50px/],
  ['parent from nested rule', '.a { width: 100px; .b { height: $width; } }', /height: 100px/],
  ['last wins', '.a { color: red; color: blue; b: $color; }', /b: blue/],
  ['from a mixin body', '.m() { width: 100px; } .a { .m(); height: $width; }', /height: 100px/]
];

describe('$property accessor resolves identically nested and collapsed', () => {
  for (const [name, source, expected] of cases) {
    it(name, async () => {
      const nested = await render(source, false);
      const flat = await render(source, true);
      expect(nested.errors, `${name} nested`).toHaveLength(0);
      expect(flat.errors, `${name} collapsed`).toHaveLength(0);
      expect(nested.css, `${name} nested`).toMatch(expected);
      expect(flat.css, `${name} collapsed`).toMatch(expected);
    });
  }
});
