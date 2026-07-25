/**
 * Public direct-AST extend contracts.
 *
 * These are deliberately Compiler source-route tests: they assert rendered CSS,
 * never legacy Rules state, spine admission, or plan/solve implementation
 * details. Cross-import closure and reference-import visibility already live in
 * `extend-cross-import.test.ts` with real files and Less 4 output oracles.
 */
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

async function render(source: string): Promise<string> {
  return new Compiler({ output: { collapseNesting: true } }).renderString(source, {
    language: 'less',
    filePath: '/virtual/extend-contract.less'
  });
}

describe('public direct-AST extend contracts', () => {
  it('contains an extend inside its @media scope without changing a root subject', async () => {
    const css = await render([
      '@media screen {',
      '  .a { color: red; }',
      '  .b:extend(.a) {}',
      '}',
      '.a { color: blue; }'
    ].join('\n'));

    expect(css).toBe([
      '@media screen {',
      '  .a,',
      '  .b {',
      '    color: red;',
      '  }',
      '}',
      '.a {',
      '  color: blue;',
      '}',
      ''
    ].join('\n'));
  });

  it('emits a nested extender as its composed selector path', async () => {
    const css = await render([
      '.sidebar { color: red; }',
      '.type1 {',
      '  .sidebar3 { &:extend(.sidebar all); color: green; }',
      '}'
    ].join('\n'));

    expect(css).toBe([
      '.sidebar,',
      '.type1 .sidebar3 {',
      '  color: red;',
      '}',
      '.type1 .sidebar3 {',
      '  color: green;',
      '}',
      ''
    ].join('\n'));
  });

  it('adds a local extender to its matched subject and keeps the extender body', async () => {
    const css = await render('.target { color: red; }\n.ext:extend(.target) { background: blue; }');

    expect(css).toBe([
      '.target,',
      '.ext {',
      '  color: red;',
      '}',
      '.ext {',
      '  background: blue;',
      '}',
      ''
    ].join('\n'));
  });

  it('resolves a typed interpolated extend target through the public compiler route', async () => {
    const css = await render('@name: target; .target { color: red; } .replacement:extend(.@{name}) { color: blue; }');

    expect(css).toBe([
      '.target,',
      '.replacement {',
      '  color: red;',
      '}',
      '.replacement {',
      '  color: blue;',
      '}',
      ''
    ].join('\n'));
  });

  it('rejects a comma-list parent in a non-leading ampersand merge template', async () => {
    await expect(render([
      '@list-quoted: ~\'apple, satsuma, banana, pear\';',
      '@{list-quoted} { .fruit-quoted-& { content: "Quoted"; } }'
    ].join('\n'))).rejects.toMatchObject({ code: 'selector/comma-list-interpolation' });
  });
});
