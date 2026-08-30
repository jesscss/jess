import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeColorRgb, makeDimension, makeKeyword, makeList, makeQuoted, RGB } from '@jesscss/core';
import jsPlugin, { JsPlugin, sanitizeSpawnEnv } from '../src/index.js';

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
    const dimensionResult = await mod.bumpDimension(makeDimension(4, 'px'));
    expect(dimensionResult.type).toBe('Dimension');
    expect(dimensionResult.number).toBe(5);
    expect(dimensionResult.unit).toBe('px');

    const colorResult = await mod.fade(makeColorRgb([10, 20, 30], 0.75, RGB));
    expect(colorResult.type).toBe('Color');
    expect(colorResult.rgb).toEqual([10, 20, 30]);
    expect(colorResult.alpha).toBe(0.25);

    const quotedResult = await mod.quote(makeQuoted('hello', '"', false));
    expect(quotedResult.type).toBe('Quoted');
    expect(quotedResult.value).toBe('ok');
    expect(quotedResult.quote).toBe('\'');

    const listResult = await mod.firstDimension(makeList([
      makeDimension(1, 'em'),
      makeKeyword('ignored')
    ], '/'));
    expect(listResult.type).toBe('List');
    expect(listResult.sep).toBe('/');
    const listFirst = listResult.value[0];
    expect(listFirst?.type).toBe('Dimension');
    if (listFirst?.type !== 'Dimension') {
      throw new Error('Expected first list result item to be a Dimension');
    }
    expect(listFirst.number).toBe(3);
    expect(listFirst.unit).toBe('em');

    const sequenceResult = await mod.expressionLength([makeKeyword('a'), makeKeyword('b')]);
    expect(Array.isArray(sequenceResult)).toBe(true);
    const sequenceFirst = Array.isArray(sequenceResult) ? sequenceResult[0] : undefined;
    expect(sequenceFirst?.type).toBe('Dimension');
    if (sequenceFirst?.type !== 'Dimension') {
      throw new Error('Expected an expression result item to be a Dimension');
    }
    expect(sequenceFirst.number).toBe(2);

    const helperDimensionResult = await mod.helperDimension();
    expect(helperDimensionResult.type).toBe('Dimension');
    expect(helperDimensionResult.number).toBe(9);
    expect(helperDimensionResult.unit).toBe('rem');

    const helperValueResult = await mod.helperValue(makeList([
      makeDimension(6, 'vw')
    ], '/'));
    expect(helperValueResult.type).toBe('List');
    expect(helperValueResult.sep).toBe('/');
    const helperValueFirst = helperValueResult.value[0];
    expect(helperValueFirst?.type).toBe('Dimension');
    if (helperValueFirst?.type !== 'Dimension') {
      throw new Error('Expected first helper value result item to be a Dimension');
    }
    expect(helperValueFirst.number).toBe(6);
    expect(helperValueFirst.unit).toBe('vw');

    const helperValueWithPrimitivesResult = await mod.helperValueWithPrimitives();
    expect(helperValueWithPrimitivesResult.type).toBe('List');
    expect(helperValueWithPrimitivesResult.sep).toBe('/');
    expect(helperValueWithPrimitivesResult.value.map(item => item.bytes)).toEqual(['raw', '2', 'true']);
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

    const dimensionResult = await loaded.functions.triple(makeDimension(2, 'px'));
    expect(dimensionResult.type).toBe('Dimension');
    expect(dimensionResult.number).toBe(6);
    expect(dimensionResult.unit).toBe('px');
    await expect(loaded.functions.probeprocess()).resolves.toBe('DENIED');
  });

  it('keeps executable Plugin options instance-local in the Deno runtime', async () => {
    const root = makeTmpDir('jess-js-root-');
    const modulePath = path.join(root, 'options-plugin.js');
    fs.writeFileSync(
      modulePath,
      [
        'registerPlugin({',
        '  setOptions: function(value) { this.value = value; },',
        '  install: function(_less, _manager, functions) {',
        '    var self = this;',
        '    functions.add("plugin-option", function() { return self.value || "none"; });',
        '  }',
        '});'
      ].join('\n'),
      'utf8'
    );
    const runtime = jsPlugin({ jsReadRoot: root, runtimeApi: 'less' }) as JsPlugin;
    plugins.push(runtime);

    const first = await runtime.importPlugin(modulePath, 'first=value');
    const second = await runtime.importPlugin(modulePath, 'second=value');
    await expect(first.functions['plugin-option']()).resolves.toBe('first=value');
    await expect(second.functions['plugin-option']()).resolves.toBe('second=value');
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

  it('sanitizeSpawnEnv strips node debugger/inspector-attach variables', () => {
    const poisoned: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOME: '/home/user',
      NODE_OPTIONS: '--require /path/to/ms-vscode.js-debug/bootloader.js',
      NODE_INSPECT_RESUME_ON_START: '1',
      VSCODE_INSPECTOR_OPTIONS: ':::{"inspectorIpc":"/tmp/x"}',
      SOME_TOOL_PATH: '/opt/js-debug/loader'
    };
    const cleaned = sanitizeSpawnEnv(poisoned);
    expect(cleaned.PATH).toBe('/usr/bin');
    expect(cleaned.HOME).toBe('/home/user');
    expect(cleaned.NODE_OPTIONS).toBeUndefined();
    expect(cleaned.NODE_INSPECT_RESUME_ON_START).toBeUndefined();
    expect(cleaned.VSCODE_INSPECTOR_OPTIONS).toBeUndefined();
    // Stripped because its value references js-debug even though the key is benign.
    expect(cleaned.SOME_TOOL_PATH).toBeUndefined();
    // The original env object is not mutated.
    expect(poisoned.NODE_OPTIONS).toBe('--require /path/to/ms-vscode.js-debug/bootloader.js');
  });

  it('starts the Deno worker even when the parent env carries an inspector bootloader', async () => {
    const root = makeTmpDir('jess-js-root-');
    const modulePath = path.join(root, 'poisoned-env.ts');
    fs.writeFileSync(modulePath, 'export const value = 123;', 'utf8');

    const savedNodeOptions = process.env.NODE_OPTIONS;
    const savedInspectorOptions = process.env.VSCODE_INSPECTOR_OPTIONS;
    // Simulate VS Code / Cursor "Auto Attach" poisoning the parent environment.
    process.env.NODE_OPTIONS =
      '--require /nonexistent/ms-vscode.js-debug/bootloader.js';
    process.env.VSCODE_INSPECTOR_OPTIONS =
      ':::{"inspectorIpc":"/nonexistent/inspector.sock"}';
    try {
      const plugin = jsPlugin({ jsReadRoot: root }) as JsPlugin;
      plugins.push(plugin);
      const mod = await plugin.import(modulePath);
      expect(mod.value).toBe(123);
    } finally {
      if (savedNodeOptions === undefined) {
        delete process.env.NODE_OPTIONS;
      } else {
        process.env.NODE_OPTIONS = savedNodeOptions;
      }
      if (savedInspectorOptions === undefined) {
        delete process.env.VSCODE_INSPECTOR_OPTIONS;
      } else {
        process.env.VSCODE_INSPECTOR_OPTIONS = savedInspectorOptions;
      }
    }
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
