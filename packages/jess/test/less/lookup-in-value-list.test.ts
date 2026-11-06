import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/*
 * A lookup or namespace read is one item of the value it is written in. A
 * comma or space list that starts with one keeps every item after it, in
 * order (`font-family: @typography[family], sans-serif` keeps `sans-serif`)
 * in a declaration, a variable, a mixin argument, a function argument and an
 * escaped `~( … )` list, with or without `!important`.
 */
const defs = [
  '@t: { family: Georgia; w: 1px; @inner: { x: 2px; } }',
  '.m() { r: 3px; }',
  '#ns { .m() { x: 4px; } }',
  '.p(@a) { b: @a; }'
].join('\n');

async function render(source: string): Promise<string> {
  const css = await new Compiler().renderString(`${defs}\n${source}`, { filePath: 'entry.less', extension: '.less' });
  return String(css).replace(/\s+/g, ' ').trim();
}

describe('a value list that holds a lookup', () => {
  it.each([
    ['a lookup leading a comma list', 'b: @t[family], sans-serif;', 'b: Georgia, sans-serif;'],
    ['a lookup inside a comma list', 'b: serif, @t[family], sans-serif;', 'b: serif, Georgia, sans-serif;'],
    ['a lookup leading a space list', 'b: @t[w] 1px solid;', 'b: 1px 1px solid;'],
    ['a nested lookup leading a comma list', 'b: @t[@inner][x], y;', 'b: 2px, y;'],
    ['a nested lookup leading a space list', 'b: @t[@inner][x] y;', 'b: 2px y;'],
    ['a namespace read leading a comma list', 'b: #ns.m()[x], y;', 'b: 4px, y;'],
    ['a namespace read leading a space list', 'b: #ns.m()[x] y;', 'b: 4px y;'],
    ['a mixin read leading a comma list', 'b: .m()[r], y;', 'b: 3px, y;'],
    ['a lookup list with !important', 'b: @t[family], sans-serif !important;', 'b: Georgia, sans-serif !important;'],
    ['a namespace read list with !important', 'b: #ns.m()[x], y !important;', 'b: 4px, y !important;']
  ])('keeps every item of %s in a declaration', async (_shape, declaration, expected) => {
    expect(await render(`.a { ${declaration} }`)).toBe(`.a { ${expected} }`);
  });

  it.each([
    ['a lookup leading a comma list', '@t[family], sans-serif', 'Georgia, sans-serif'],
    ['a lookup leading a space list', '@t[w] 1px solid', '1px 1px solid'],
    ['a namespace read leading a comma list', '#ns.m()[x], y', '4px, y'],
    ['a lookup list with !important', '@t[family], sans-serif !important', 'Georgia, sans-serif !important']
  ])('keeps every item of %s in a variable', async (_shape, value, expected) => {
    expect(await render(`@v: ${value};\n.a { b: @v; }`)).toBe(`.a { b: ${expected}; }`);
  });

  it.each([
    ['a lookup leading a comma list', '.p(@t[family], sans-serif;);', 'Georgia, sans-serif'],
    ['a lookup leading a space list', '.p(@t[w] 1px solid);', '1px 1px solid'],
    ['a namespace read leading a comma list', '.p(#ns.m()[x], y;);', '4px, y']
  ])('keeps every item of %s in a mixin argument', async (_shape, call, expected) => {
    expect(await render(`.a { ${call} }`)).toBe(`.a { b: ${expected}; }`);
  });

  it.each([
    ['a lookup leading the arguments', 'fn(@t[family], sans-serif)', 'fn(Georgia, sans-serif)'],
    ['a lookup leading a space list', 'fn(@t[w] 1px, sans-serif)', 'fn(1px 1px, sans-serif)'],
    ['a namespace read leading a space list', 'fn(#ns.m()[x] y, z)', 'fn(4px y, z)']
  ])('keeps every item of %s in a function argument', async (_shape, call, expected) => {
    expect(await render(`.a { b: ${call}; }`)).toBe(`.a { b: ${expected}; }`);
  });

  it.each([
    ['a lookup leading the list', '~(@t[family], y)', 'Georgia, y'],
    ['a namespace read leading the list', '~(#ns.m()[x], y)', '4px, y']
  ])('keeps every item of %s in an escaped list', async (_shape, value, expected) => {
    expect(await render(`.a { b: ${value}; }`)).toBe(`.a { b: ${expected}; }`);
  });

  it.each([
    ['a lookup', 'b: @t[family];', 'b: Georgia;'],
    ['a lookup with !important', 'b: @t[family] !important;', 'b: Georgia !important;'],
    ['a namespace read', 'b: #ns.m()[x];', 'b: 4px;'],
    ['a namespace read in math', 'b: #ns.m()[x] + 1;', 'b: 5px;']
  ])('renders %s alone as its value', async (_shape, declaration, expected) => {
    expect(await render(`.a { ${declaration} }`)).toBe(`.a { ${expected} }`);
  });
});
