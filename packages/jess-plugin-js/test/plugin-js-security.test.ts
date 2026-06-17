import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Any, Color, Dimension, List, Quoted, Sequence } from '@jesscss/core';
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

  it('uses ESM module scope by default without Jess or Less compatibility globals', async () => {
    const root = makeTmpDir('jess-js-root-');
    const modulePath = path.join(root, 'esm-api-test.ts');
    fs.writeFileSync(
      modulePath,
      [
        'export function inspectRuntimeApi() {',
        '  const g = globalThis as any;',
        '  return {',
        '    hasJess: !!g.jess,',
        '    hasJessUpper: !!g.Jess,',
        '    hasLess: !!g.less,',
        '    hasLessUpper: !!g.Less',
        '  };',
        '}',
        'export const token = { spacing: 12 };',
        'export function readToken() {',
        '  return token.spacing;',
        '}'
      ].join('\n'),
      'utf8'
    );
    const plugin = jsPlugin({ jsReadRoot: root }) as JsPlugin;
    plugins.push(plugin);
    const mod = await plugin.import(modulePath);
    await expect(mod.inspectRuntimeApi()).resolves.toEqual({
      hasJess: false,
      hasJessUpper: false,
      hasLess: false,
      hasLessUpper: false
    });
    expect(mod.token).toEqual({ spacing: 12 });
    await expect(mod.readToken()).resolves.toBe(12);
  });

  it('bridges Jess values into Deno-side Less-compatible classes', async () => {
    const root = makeTmpDir('jess-js-root-');
    const modulePath = path.join(root, 'bridge-test.ts');
    fs.writeFileSync(
      modulePath,
      [
        'const tree = (globalThis as any).less.tree;',
        'export function bumpDimension(value: unknown) {',
        '  if (!(value instanceof tree.Dimension)) {',
        '    return "NOT_DIMENSION";',
        '  }',
        '  const dim = value as any;',
        '  return new tree.Dimension(dim.value + 1, dim.unit);',
        '}',
        'export function fade(color: unknown) {',
        '  if (!(color instanceof tree.Color)) {',
        '    return "NOT_COLOR";',
        '  }',
        '  const c = color as any;',
        '  return new tree.Color(c.rgb, 0.25);',
        '}',
        'export function quote(value: unknown) {',
        '  if (!(value instanceof tree.Quoted)) {',
        '    return "NOT_QUOTED";',
        '  }',
        '  return new tree.Quoted("\'", "ok", false);',
        '}',
        'export function firstDimension(value: unknown) {',
        '  if (!(value instanceof tree.Value)) {',
        '    return "NOT_VALUE";',
        '  }',
        '  const first = (value as any).value[0];',
        '  if (!(first instanceof tree.Dimension)) {',
        '    return "NOT_DIMENSION_IN_VALUE";',
        '  }',
        '  return new tree.Value([new tree.Dimension(first.value + 2, first.unit)], (value as any).separator);',
        '}',
        'export function expressionLength(value: unknown) {',
        '  if (!(value instanceof tree.Expression)) {',
        '    return "NOT_EXPRESSION";',
        '  }',
        '  return new tree.Expression([new tree.Dimension((value as any).value.length, "")]);',
        '}',
        'export function helperDimension() {',
        '  const value = (globalThis as any).less.dimension(9, "rem");',
        '  if (!(value instanceof tree.Dimension)) {',
        '    return "NOT_HELPER_DIMENSION";',
        '  }',
        '  return value;',
        '}',
        'export function helperValue(value: unknown) {',
        '  const out = (globalThis as any).less.value([(value as any).value[0]], "/");',
        '  if (!(out instanceof tree.Value)) {',
        '    return "NOT_HELPER_VALUE";',
        '  }',
        '  return out;',
        '}',
        'export function helperValueWithPrimitives() {',
        '  const out = (globalThis as any).less.value(["raw", 2, true], "/");',
        '  if (!(out instanceof tree.Value)) {',
        '    return "NOT_HELPER_VALUE_PRIMITIVES";',
        '  }',
        '  return out;',
        '}'
      ].join('\n'),
      'utf8'
    );
    const plugin = jsPlugin({ jsReadRoot: root, runtimeApi: 'less' }) as JsPlugin;
    plugins.push(plugin);
    const mod = await plugin.import(modulePath);
    const dimensionResult = await mod.bumpDimension(new Dimension({ number: 4, unit: 'px' }));
    expect(dimensionResult).toBeInstanceOf(Dimension);
    expect(dimensionResult.value).toEqual({ number: 5, unit: 'px' });

    const colorResult = await mod.fade(new Color({ rgb: [10, 20, 30], alpha: 0.75 }));
    expect(colorResult).toBeInstanceOf(Color);
    expect(colorResult.rgb).toEqual([10, 20, 30]);
    expect(colorResult.alpha).toBe(0.25);

    const quotedResult = await mod.quote(new Quoted('hello', { quote: '"' }));
    expect(quotedResult).toBeInstanceOf(Quoted);
    expect(quotedResult.value).toBe('ok');
    expect(quotedResult.options.quote).toBe('\'');

    const listResult = await mod.firstDimension(new List([
      new Dimension({ number: 1, unit: 'em' }),
      new Any('ignored')
    ], { sep: '/' }));
    expect(listResult).toBeInstanceOf(List);
    expect(listResult.options.sep).toBe('/');
    const listFirst = listResult.value[0];
    expect(listFirst).toBeInstanceOf(Dimension);
    if (!(listFirst instanceof Dimension)) {
      throw new Error('Expected first list result item to be a Dimension');
    }
    expect(listFirst.value).toEqual({ number: 3, unit: 'em' });

    const sequenceResult = await mod.expressionLength(new Sequence([
      new Any('a'),
      new Any('b')
    ]));
    expect(sequenceResult).toBeInstanceOf(Sequence);
    const sequenceFirst = sequenceResult.value[0];
    expect(sequenceFirst).toBeInstanceOf(Dimension);
    if (!(sequenceFirst instanceof Dimension)) {
      throw new Error('Expected first sequence result item to be a Dimension');
    }
    expect(sequenceFirst.value.number).toBe(2);

    const helperDimensionResult = await mod.helperDimension();
    expect(helperDimensionResult).toBeInstanceOf(Dimension);
    expect(helperDimensionResult.value).toEqual({ number: 9, unit: 'rem' });

    const helperValueResult = await mod.helperValue(new List([
      new Dimension({ number: 6, unit: 'vw' })
    ]));
    expect(helperValueResult).toBeInstanceOf(List);
    expect(helperValueResult.options.sep).toBe('/');
    const helperValueFirst = helperValueResult.value[0];
    expect(helperValueFirst).toBeInstanceOf(Dimension);
    if (!(helperValueFirst instanceof Dimension)) {
      throw new Error('Expected first helper value result item to be a Dimension');
    }
    expect(helperValueFirst.value).toEqual({ number: 6, unit: 'vw' });

    const helperValueWithPrimitivesResult = await mod.helperValueWithPrimitives();
    expect(helperValueWithPrimitivesResult).toBeInstanceOf(List);
    expect(helperValueWithPrimitivesResult.options.sep).toBe('/');
    expect(helperValueWithPrimitivesResult.value.map((item: Any) => item.value)).toEqual(['raw', '2', 'true']);
  });

  it('loads legacy Less @plugin wrapper files in Deno with injected variables', async () => {
    const root = makeTmpDir('jess-js-root-');
    const modulePath = path.join(root, 'legacy-plugin.js');
    fs.writeFileSync(
      modulePath,
      [
        'registerPlugin({',
        '  install: function(_less, _manager, functions) {',
        '    functions.add("triple", function(value) {',
        '      if (!(value instanceof tree.Dimension)) {',
        '        return "NOT_DIMENSION";',
        '      }',
        '      return new tree.Dimension(value.value * 3, value.unit);',
        '    });',
        '    functions.add("probeProcess", function() {',
        '      return typeof process === "undefined" ? "DENIED" : "LEAKED";',
        '    });',
        '  }',
        '});'
      ].join('\n'),
      'utf8'
    );
    const plugin = jsPlugin({ jsReadRoot: root, runtimeApi: 'less' }) as JsPlugin;
    plugins.push(plugin);
    const loaded = await plugin.importLessPlugin(modulePath);
    expect(Object.keys(loaded.functions).sort()).toEqual(['probeprocess', 'triple']);

    const dimensionResult = await loaded.functions.triple(new Dimension({ number: 2, unit: 'px' }));
    expect(dimensionResult).toBeInstanceOf(Dimension);
    expect(dimensionResult.value).toEqual({ number: 6, unit: 'px' });
    await expect(loaded.functions.probeprocess()).resolves.toBe('DENIED');
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

  it('denies reading system file /etc/hosts from Deno context', async () => {
    const root = makeTmpDir('jess-js-root-');
    const modulePath = path.join(root, 'read-hosts.ts');
    fs.writeFileSync(
      modulePath,
      [
        'export function readEtcHosts(): string {',
        '  try {',
        '    return Deno.readTextFileSync("/etc/hosts");',
        '  } catch (e) {',
        '    return "DENIED";',
        '  }',
        '}'
      ].join('\n'),
      'utf8'
    );
    const plugin = jsPlugin({ jsReadRoot: root }) as JsPlugin;
    plugins.push(plugin);
    const mod = await plugin.import(modulePath);
    await expect(mod.readEtcHosts()).resolves.toBe('DENIED');
  });

  it('denies access to process (Node global) from Deno context', async () => {
    const root = makeTmpDir('jess-js-root-');
    const modulePath = path.join(root, 'process-probe.ts');
    fs.writeFileSync(
      modulePath,
      [
        'export function getProcessEnv(): string {',
        '  try {',
        '    return (typeof (globalThis as any).process !== "undefined"',
        '      ? (globalThis as any).process.env?.HOME ?? "LEAKED"',
        '      : "DENIED");',
        '  } catch {',
        '    return "DENIED";',
        '  }',
        '}'
      ].join('\n'),
      'utf8'
    );
    const plugin = jsPlugin({ jsReadRoot: root }) as JsPlugin;
    plugins.push(plugin);
    const mod = await plugin.import(modulePath);
    await expect(mod.getProcessEnv()).resolves.toBe('DENIED');
  });
});
