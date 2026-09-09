/**
 * A quoted string whose body is exactly a bare operator char (`"/"`, `'-'`, `"%"`)
 * must stay a quoted string, not collapse to the bare slash/sign/percent operator.
 *
 * Regression: `isLessTerminalText` matched any object with a string `.value`, and a
 * `Quoted` AST node carries `value: "/"`, so a standalone `"/"` was rewritten to a
 * `Keyword '/'` in the value reducer — Bootstrap's breadcrumb divider
 * (`@breadcrumb-divider: "/"; content: @breadcrumb-divider;`) emitted the invalid
 * `content: /`. Only a lone operator char was affected; `"//"`, `"a/b"` were fine.
 * Oracle: lessc 4.x emits `content: "/"`.
 */
import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

const compile = async (source: string): Promise<string> => {
  const c = new Compiler({ output: { collapseNesting: true }, compile: { plugins: [lessPlugin()] } });
  return (await c.renderToResult({ source, language: 'less', extension: '.less' }, {})).css.trim();
};

describe('quoted lone-operator strings keep their quotes', () => {
  it('literal content: "/"', async () => {
    expect(await compile('.a::before { content: "/"; }')).toBe('.a::before {\n  content: "/";\n}');
  });
  it('breadcrumb-style variable divider', async () => {
    expect(await compile('@d: "/";\n.a::before { content: @d; }')).toBe('.a::before {\n  content: "/";\n}');
  });
  it('single-quoted and other operator chars survive', async () => {
    expect(await compile(`.a { x: '/'; y: "-"; z: "%"; }`)).toBe(`.a {\n  x: '/';\n  y: "-";\n  z: "%";\n}`);
  });
  it('bare slash still forms the font shorthand', async () => {
    expect(await compile('.a { font: 12px/1.5 sans-serif; }')).toBe('.a {\n  font: 12px/1.5 sans-serif;\n}');
  });
});
