import * as rollup from 'rollup';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Compiler } from 'jess';
import jess, { moduleCode } from '../src/index.js';
import commonJs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';

type Runtime = { css: string; vars: (values: Record<string, string>) => Record<string, string> };

/** The bundled module, once it is known to export the runtime. */
function isRuntime(module: unknown): module is Runtime {
  return typeof module === 'object' && module !== null && 'vars' in module && typeof module.vars === 'function';
}

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
  it('calls a body directly only for a recipe whose arguments the page proves colours', () => {
    const fn = { module: '@jesscss/fns/less', name: 'lightness' };
    const body = { module: '@jesscss/fns/less/bodies', name: 'lightnessOf', bytes: true as const };
    // eslint-disable-next-line @typescript-eslint/naming-convention -- custom property names
    const runtime = { exports: ['brand'], keys: { brand: 'brand' }, defaults: { brand: '#c00' }, units: {}, ratios: [], colors: ['brand'], names: false, ownNames: false, direct: true, derived: { '--brand-lightness': { fn, args: [{ export: 'brand' }], body } } };
    const hex = moduleCode('', runtime);
    expect(hex).toContain('import { lightnessOf as f0 } from "@jesscss/fns/less/bodies";');
    expect(hex).toContain('[(a) => f0(...a).bytes, [{"export":"brand"}]]');
    expect(hex).not.toContain('emitValue');

    /* A body whose result is not marked as one node keeps the value writer. */
    // eslint-disable-next-line @typescript-eslint/naming-convention -- custom property names
    const unmarked = moduleCode('', { ...runtime, derived: { '--brand-lightness': { fn, args: [{ export: 'brand' }], body: { module: body.module, name: body.name } } } });
    expect(unmarked).toContain('[(a) => f0(...a), [{"export":"brand"}]]');
    expect(unmarked).toContain('emitValue as f1');

    /* A page that reads colour names may be given a keyword, so its call keeps the defined function, which checks it. */
    const names = moduleCode('', { ...runtime, names: true });
    expect(names).toContain('import { lightness as f1 } from "@jesscss/fns/less";');
    expect(names).toContain('[f0(f1), [{"export":"brand"}]]');
    expect(names).toContain('import { call as f0, emitValue as f2 } from "@jesscss/fns/runtime";');
    expect(names).not.toContain('lightnessOf');
  });

  it('exports the runtime of a stylesheet that exposes variables', async () => {
    const bundle = await rollup.rollup({ input: path.resolve(__dirname, './runtime.less'), plugins: [nodeResolve(), commonJs(), jess()] });
    const { output } = await bundle.generate({ format: 'es' });
    const css = output.find(item => item.type === 'asset' && item.fileName === 'runtime.css');
    expect(css && css.type === 'asset' ? String(css.source) : '').toContain('opacity: var(--brand-lightness, 40%);');

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollup-plugin-jess-'));
    try {
      const file = path.join(directory, 'runtime.mjs');
      fs.writeFileSync(file, output[0].code);
      const module: unknown = await import(file);
      const recompiled = await new Compiler().renderString('@use "#less";\n.a { b: @less.lightness(#08f); }', { filePath: 'entry.less', extension: '.less' });
      expect(isRuntime(module)).toBe(true);
      if (isRuntime(module)) {
        expect(recompiled).toContain(`b: ${module.vars({ brand: '#08f' })['--brand-lightness']};`);
        expect(module.vars({ brand: '#08f' })['--brand']).toBe('#08f');
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('adds no function to the runtime of a stylesheet that prints only CSS forms', async () => {
    const bundle = await rollup.rollup({ input: path.resolve(__dirname, './printed.less'), plugins: [nodeResolve(), commonJs(), jess()] });
    const { output } = await bundle.generate({ format: 'es' });
    const css = output.find(item => item.type === 'asset' && item.fileName === 'printed.css');
    expect(css && css.type === 'asset' ? String(css.source) : '').toContain('color: rgb(from var(--brand, #c00) r g b / 0.5);');
    expect(output[0].code).not.toContain('--brand-');

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollup-plugin-jess-'));
    try {
      const file = path.join(directory, 'printed.mjs');
      fs.writeFileSync(file, output[0].code);
      const module: unknown = await import(file);
      // eslint-disable-next-line @typescript-eslint/naming-convention -- custom property names
      expect(isRuntime(module) && module.vars({ brand: '#08f' })).toEqual({ '--brand': '#08f' });
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
