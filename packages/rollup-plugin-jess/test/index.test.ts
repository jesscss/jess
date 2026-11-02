import * as rollup from 'rollup';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Compiler } from 'jess';
import jess from '../src/index.js';
import commonJs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';

const buildFile = async (filePath: string) => {
  const input = path.resolve(__dirname, filePath);
  const bundle = await rollup.rollup({
    input,
    plugins: [nodeResolve(), commonJs(), jess()]
  });
  const { output } = await bundle.generate({ format: 'umd', name: 'jess' });
  return output;
};

describe('rollup-plugin-jess', () => {
  it('exports the runtime of a stylesheet that exports variables', async () => {
    const bundle = await rollup.rollup({ input: path.resolve(__dirname, './runtime.less'), plugins: [nodeResolve(), commonJs(), jess()] });
    const { output } = await bundle.generate({ format: 'es' });
    const css = output.find(item => item.type === 'asset' && item.fileName === 'runtime.css');
    expect(css && css.type === 'asset' ? String(css.source) : '').toContain('border-color: var(--brand-darken, #990000);');

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollup-plugin-jess-'));
    try {
      const file = path.join(directory, 'runtime.mjs');
      fs.writeFileSync(file, output[0].code);
      const module = await import(file) as { vars: (values: Record<string, string>) => Record<string, string> };
      const recompiled = await new Compiler().renderString('@use "#less";\n.a { b: @less.darken(#08f, 10%); }', { filePath: 'entry.less', extension: '.less' });
      expect(recompiled).toContain(`b: ${module.vars({ brand: '#08f' })['--brand-darken']};`);
      expect(module.vars({ brand: '#08f' })['--brand']).toBe('#08f');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('renders a `.jess` module with Jess syntax through the public compiler integration', async () => {
    const result = await buildFile('./direct.jess');
    const css = result.find(item => item.type === 'asset' && item.fileName === 'direct.css');

    expect(css && css.type === 'asset' ? String(css.source) : '').toContain('color: red');
  });

  /*
   * The compiler never prints the error it throws; the plugin hands it to
   * Rollup, which rejects the build with it. That rejection is the one report:
   * nothing reaches stdout or stderr on the way.
   */
  it.each([
    ['a parse error', '.a {\n  color: red;\n', 'Missing closing brace.'],
    ['an undefined variable', '.a {\n  color: $missing;\n}\n', 'Name not found']
  ])('reports %s once, through the rejected build', async (_name, source, message) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollup-plugin-jess-'));
    const printed: string[] = [];
    const capture = (chunk: unknown) => {
      printed.push(String(chunk));
      return true;
    };
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(capture);
    try {
      const input = path.join(directory, 'entry.jess');
      fs.writeFileSync(input, source);
      const build = rollup.rollup({ input, plugins: [jess()] });
      await expect(build).rejects.toThrow(message);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      fs.rmSync(directory, { recursive: true, force: true });
    }
    expect(printed.join('')).toBe('');
  });
});
