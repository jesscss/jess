import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import type { PluginInterface } from '@jesscss/core';

/**
 * `@jesscss/plugin-js` is an OPTIONAL dependency of `jess`. When it is
 * resolvable it must auto-wire (Less `@plugin` / script-module imports "just
 * work" without listing it in `plugins`); when it is absent `jess` must gate
 * gracefully rather than hard-break. These tests exercise both sides of that
 * contract via the `loadPluginForExtension` auto-wire hook, without listing
 * plugin-js explicitly and without uninstalling it (absence is simulated by
 * stubbing the internal proxy factory — a resolver stub).
 */

const tempDirs: string[] = [];

const makeTmpFile = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-plugin-js-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'main.less');
  fs.writeFileSync(file, '.a { color: red; }', 'utf8');
  return file;
};

const makeCompiler = (): Compiler =>
  new Compiler({
    output: { collapseNesting: true },
    compile: {
      // NOTE: '@jesscss/plugin-js' is intentionally NOT listed here — the point
      // is that it auto-wires when resolvable.
      plugins: [lessPlugin(), lessCompatPlugin({ plugins: [] })]
    }
  });

describe('@jesscss/plugin-js optional auto-wiring', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('auto-wires plugin-js for JS/TS script extensions when it is present', async () => {
    const file = makeTmpFile();
    const context = makeCompiler().createContext(file);

    const loader = context.opts.loadPluginForExtension;
    expect(typeof loader).toBe('function');

    const jsPlugin = (await loader?.('.js')) as PluginInterface & {
      importLessPlugin?: unknown;
    } | undefined;
    expect(jsPlugin).toBeDefined();
    expect(jsPlugin?.supportedExtensions).toContain('.js');
    // The proxy exposes the Less @plugin executor once plugin-js is loaded.
    expect(typeof jsPlugin?.importLessPlugin).toBe('function');

    // A non-script extension is not something plugin-js handles.
    expect(await loader?.('.css')).toBeUndefined();
  });

  it('gates gracefully when plugin-js is absent (simulated resolver miss)', async () => {
    const file = makeTmpFile();
    const compiler = makeCompiler();
    // Simulate plugin-js being unresolvable without uninstalling it: the proxy
    // factory returns undefined exactly as it does when resolution fails.
    compiler['createJsPluginProxy'] = () => undefined;

    const context = compiler.createContext(file);
    const loader = context.opts.loadPluginForExtension;
    expect(typeof loader).toBe('function');

    // Absent => no plugin returned; core then emits the "Install @jesscss/plugin-js"
    // gate at the point a script actually needs to execute (no hard crash here).
    expect(await loader?.('.js')).toBeUndefined();
  });
});
