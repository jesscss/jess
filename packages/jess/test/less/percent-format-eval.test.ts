import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

const compiler = new Compiler({
  output: { collapseNesting: true },
  compile: { plugins: [lessPlugin()] }
});

async function render(less: string): Promise<string> {
  return compiler.renderString(less, { language: 'less' });
}

describe('%() lowering — eval', () => {
  it('renders %("rgb(%d, %d, %d)", 255, 0, 0) as "rgb(255, 0, 0)"', async () => {
    const css = await render('.a { x: %("rgb(%d, %d, %d)", 255, 0, 0); }');
    expect(css).toContain('x: "rgb(255, 0, 0)"');
  });

  it('%s inserts a quoted string with quotes stripped', async () => {
    const css = await render('.a { x: %("hello %s", "world"); }');
    expect(css).toContain('x: "hello world"');
  });

  it('%A url-encodes (escape)', async () => {
    const css = await render('.a { x: %("red is %A", #ff0000); }');
    expect(css).toContain('x: "red is %23ff0000"');
  });

  it('preserves single-quote format quoting', async () => {
    const css = await render('.a { x: %(\'hello %s\', "single world"); }');
    expect(css).toContain('x: \'hello single world\'');
  });

  it('escaped ~"..." format renders unquoted', async () => {
    const css = await render('.a { x: %(~"hello %s", "escaped world"); }');
    expect(css).toContain('x: hello escaped world');
  });

  it('%s with a color renders the color as string', async () => {
    const css = await render('.a { x: %("%s", #123); }');
    expect(css).toContain('x: "#123"');
  });

  it('keeps quoted CSS bytes for %a/%d while %s uses string text', async () => {
    const css = await render('.a { a: %("%a", "x y"); d: %("%d", "x y"); s: %("%s", "x y"); }');
    expect(css).toBe('.a {\n  a: ""x y"";\n  d: ""x y"";\n  s: "x y";\n}\n');
  });

  it('evaluates replace() through the canonical typed Less registry', async () => {
    const css = await render('.a { x: replace("Hello", "h", "x", "i"); }');
    expect(css).toContain('x: "xello"');
  });
});
