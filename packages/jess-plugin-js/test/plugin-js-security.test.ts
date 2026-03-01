import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import jsPlugin, { JsPlugin } from '../src/index.js';

const makeTmpDir = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

describe('@jesscss/plugin-js security', () => {
  const testFilePath = fileURLToPath(import.meta.url);
  const plugins: JsPlugin[] = [];

  afterEach(() => {
    for (const plugin of plugins) {
      plugin.dispose();
    }
    plugins.length = 0;
  });

  it('denies environment access by default in broker mode', async () => {
    const root = makeTmpDir('jess-js-root-');
    const modulePath = path.join(root, 'env-test.ts');
    fs.writeFileSync(
      modulePath,
      [
        'export function readEnv() {',
        '  try {',
        '    return Deno.env.get(\'HOME\') ?? \'EMPTY\';',
        '  } catch {',
        '    return \'DENIED\';',
        '  }',
        '}'
      ].join('\n'),
      'utf8'
    );
    const plugin = jsPlugin({ jsReadRoot: root }) as JsPlugin;
    plugins.push(plugin);
    const mod = await plugin.import(modulePath);
    await expect(mod.readEnv()).resolves.toBe('DENIED');
  });

  it('denies file reads outside jsReadRoot', async () => {
    const root = makeTmpDir('jess-js-root-');
    const modulePath = path.join(root, 'file-test.ts');
    fs.writeFileSync(
      modulePath,
      [
        'export function readPath(p) {',
        '  try {',
        '    return Deno.readTextFileSync(p);',
        '  } catch {',
        '    return \'DENIED\';',
        '  }',
        '}'
      ].join('\n'),
      'utf8'
    );
    const plugin = jsPlugin({ jsReadRoot: root }) as JsPlugin;
    plugins.push(plugin);
    const mod = await plugin.import(modulePath);
    await expect(mod.readPath(testFilePath)).resolves.toBe('DENIED');
  });

  it('denies network by default', async () => {
    const root = makeTmpDir('jess-js-root-');
    const modulePath = path.join(root, 'net-test.ts');
    fs.writeFileSync(
      modulePath,
      [
        'export async function fetchExample() {',
        '  try {',
        '    await fetch(\'https://example.com\');',
        '    return \'ALLOWED\';',
        '  } catch {',
        '    return \'DENIED\';',
        '  }',
        '}'
      ].join('\n'),
      'utf8'
    );
    const plugin = jsPlugin({ jsReadRoot: root }) as JsPlugin;
    plugins.push(plugin);
    const mod = await plugin.import(modulePath);
    await expect(mod.fetchExample()).resolves.toBe('DENIED');
  });

  it('allows module execution from node_modules outside jsReadRoot', async () => {
    const root = makeTmpDir('jess-js-root-');
    const outside = makeTmpDir('jess-js-out-');
    const modulePath = path.join(outside, 'node_modules', 'pkg', 'index.js');
    fs.mkdirSync(path.dirname(modulePath), { recursive: true });
    fs.writeFileSync(
      modulePath,
      'export const value = 42; export function plus(a, b) { return a + b; }',
      'utf8'
    );
    const plugin = jsPlugin({ jsReadRoot: root }) as JsPlugin;
    plugins.push(plugin);
    const mod = await plugin.import(modulePath);
    expect(mod.value).toBe(42);
    await expect(mod.plus(2, 3)).resolves.toBe(5);
  });

  it('allows @jesscss/fns paths even when deno command is unavailable', async () => {
    const root = makeTmpDir('jess-js-root-');
    const modulePath = path.join(root, 'packages', 'fns', 'index.js');
    fs.mkdirSync(path.dirname(modulePath), { recursive: true });
    fs.writeFileSync(modulePath, 'export const fnValue = 7;', 'utf8');
    const plugin = jsPlugin({
      jsReadRoot: root,
      denoCommand: '__definitely_missing_deno__'
    }) as JsPlugin;
    plugins.push(plugin);
    const mod = await plugin.import(modulePath);
    expect(mod.fnValue).toBe(7);
  });

  it('does not treat arbitrary "#less/#sass" filesystem paths as pass-through', async () => {
    const root = makeTmpDir('jess-js-root-');
    const lessAliasPath = path.join(root, '#less', 'math.js');
    const sassAliasPath = path.join(root, '#sass', 'map.js');
    fs.mkdirSync(path.dirname(lessAliasPath), { recursive: true });
    fs.mkdirSync(path.dirname(sassAliasPath), { recursive: true });
    fs.writeFileSync(lessAliasPath, 'export const lessAliasOk = true;', 'utf8');
    fs.writeFileSync(sassAliasPath, 'export const sassAliasOk = true;', 'utf8');

    const plugin = jsPlugin({
      jsReadRoot: root,
      denoCommand: '__definitely_missing_deno__'
    }) as JsPlugin;
    plugins.push(plugin);

    await expect(plugin.import(lessAliasPath)).rejects.toThrow(
      'Deno runtime is required for @jesscss/plugin-js, but no usable Deno binary was found.'
    );
    await expect(plugin.import(sassAliasPath)).rejects.toThrow(
      'Deno runtime is required for @jesscss/plugin-js, but no usable Deno binary was found.'
    );
  });

  it('fails with actionable message when deno runtime is missing for restricted scripts', async () => {
    const root = makeTmpDir('jess-js-root-');
    const modulePath = path.join(root, 'runtime-test.ts');
    fs.writeFileSync(modulePath, 'export const value = 1;', 'utf8');
    const plugin = jsPlugin({
      jsReadRoot: root,
      denoCommand: '__definitely_missing_deno__'
    }) as JsPlugin;
    plugins.push(plugin);
    await expect(plugin.import(modulePath)).rejects.toThrow(
      'Deno runtime is required for @jesscss/plugin-js, but no usable Deno binary was found.'
    );
  });

  it('denies adversarial module probes by default', async () => {
    const root = makeTmpDir('jess-js-root-');
    const outside = makeTmpDir('jess-js-out-');
    const outsideFile = path.join(outside, 'secret.txt');
    fs.writeFileSync(outsideFile, 'secret', 'utf8');
    const modulePath = path.join(root, 'adversarial-module.ts');
    fs.writeFileSync(
      modulePath,
      [
        'export function envProbe() {',
        '  try {',
        '    return Deno.env.get(\'HOME\') ?? \'EMPTY\';',
        '  } catch {',
        '    return \'DENIED\';',
        '  }',
        '}',
        'export function fsOutsideProbe(p) {',
        '  try {',
        '    return Deno.readTextFileSync(p);',
        '  } catch {',
        '    return \'DENIED\';',
        '  }',
        '}',
        'export function fsOutsideFileUrlProbe(p) {',
        '  try {',
        '    const u = new URL(\'file://\' + p);',
        '    return Deno.readTextFileSync(u);',
        '  } catch {',
        '    return \'DENIED\';',
        '  }',
        '}',
        'export async function netProbe() {',
        '  try {',
        '    await fetch(\'https://example.com\');',
        '    return \'ALLOWED\';',
        '  } catch {',
        '    return \'DENIED\';',
        '  }',
        '}',
        'export async function dynamicImportNetProbe() {',
        '  try {',
        '    await import(\'https://example.com/mod.ts\');',
        '    return \'ALLOWED\';',
        '  } catch {',
        '    return \'DENIED\';',
        '  }',
        '}'
      ].join('\n'),
      'utf8'
    );

    const plugin = jsPlugin({ jsReadRoot: root }) as JsPlugin;
    plugins.push(plugin);
    const mod = await plugin.import(modulePath);

    const cases: Array<{ name: string; run: () => Promise<unknown>; expected: unknown }> = [
      { name: 'envProbe', run: () => mod.envProbe(), expected: 'DENIED' },
      { name: 'fsOutsideProbe', run: () => mod.fsOutsideProbe(outsideFile), expected: 'DENIED' },
      { name: 'fsOutsideFileUrlProbe', run: () => mod.fsOutsideFileUrlProbe(outsideFile), expected: 'DENIED' },
      { name: 'netProbe', run: () => mod.netProbe(), expected: 'DENIED' },
      { name: 'dynamicImportNetProbe', run: () => mod.dynamicImportNetProbe(), expected: 'DENIED' }
    ];

    for (const testCase of cases) {
      await expect(testCase.run(), `case failed: ${testCase.name}`).resolves.toBe(testCase.expected);
    }
  });
});
