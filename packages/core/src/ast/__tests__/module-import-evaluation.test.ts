import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AbstractPlugin } from '../../plugin.js';
import { Context } from '../../context.js';
import { buildEvaluator } from '../evaluator.js';
import { createFnRegistry, defineFunction } from '../value-dispatch.js';
import {
  callArg,
  collection,
  collectionEntry,
  decl,
  declarationReference,
  dimension,
  funcCall,
  keyword,
  lookupStep,
  moduleImport,
  quoted,
  reference,
  rule,
  stylesheet,
  variableDeclaration,
  variableReference
} from '../nodes.js';
import { prepareStaticImports, serialize } from '../serialize.js';
import { makeDimension } from '../value-factory.js';

const evaluator = buildEvaluator(createFnRegistry());
const tempDirs: string[] = [];

class ModulePlugin extends AbstractPlugin {
  name = 'module-test';
  supportedExtensions = ['.js'];
  importCalls = 0;

  constructor(private readonly exportsByPath: ReadonlyMap<string, Record<string, unknown>>) {
    super();
  }

  override async import(absoluteFilePath: string): Promise<Record<string, unknown>> {
    this.importCalls++;
    const exports = this.exportsByPath.get(absoluteFilePath);
    if (exports === undefined) {
      throw new Error(`Unexpected module path: ${absoluteFilePath}`);
    }
    return exports;
  }
}

function tempModule(name = 'module.js'): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-module-import-'));
  tempDirs.push(directory);
  const file = path.join(directory, name);
  fs.writeFileSync(file, 'export {};', 'utf8');
  return file;
}

function modulePath(file: string) {
  return quoted(`"${file}"`, file, '"', false);
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('ModuleImport evaluation', () => {
  it('binds named functions as explicit references without changing CSS-shaped calls', async () => {
    const file = tempModule();
    const twice = defineFunction('twice', {
      params: [{ type: 'Dimension' }] as const,
      body: value => makeDimension(value.number * 2, value.unit)
    });
    const plugin = new ModulePlugin(new Map([[file, { twice, default: twice }]]));
    const context = new Context({}, [plugin]);
    const document = stylesheet([
      rule('.before', [decl('value', funcCall('double', [dimension(3)]))]),
      moduleImport(modulePath(file), 'from', null, [{ name: 'twice', alias: 'double' }]),
      moduleImport(modulePath(file), 'from', null, [{ name: 'twice', alias: 'again' }]),
      moduleImport(modulePath(file), 'from', null, [], 'primary'),
      rule('.after', [
        decl('explicit', reference(
          variableReference('again', 'live', '$again'),
          [{ type: 'Call', args: [callArg(dimension(4))] }],
          '$again(4)'
        )),
        decl('css', funcCall('again', [dimension(4)])),
        decl('default-explicit', reference(
          variableReference('primary', 'live', '$primary'),
          [{ type: 'Call', args: [callArg(dimension(5))] }],
          '$primary(5)'
        )),
        decl('default-css', funcCall('primary', [dimension(5)]))
      ])
    ]);

    const preparedImports = await prepareStaticImports(document, { context, evaluator });
    expect(plugin.importCalls).toBe(1);
    await expect(Promise.resolve(serialize(document, { context, evaluator, preparedImports }))).resolves.toEqual({
      css: '.before {\n  value: double(3);\n}\n.after {\n  explicit: 8;\n  css: again(4);\n  default-explicit: 10;\n  default-css: primary(5);\n}\n'
    });
    await expect(Promise.resolve(serialize(document, { context, evaluator, preparedImports }))).resolves.toEqual({
      css: '.before {\n  value: double(3);\n}\n.after {\n  explicit: 8;\n  css: again(4);\n  default-explicit: 10;\n  default-css: primary(5);\n}\n'
    });
    expect(plugin.importCalls).toBe(1);
  });

  it('binds @-use functions under a namespace and supports as *', async () => {
    const file = tempModule('math.js');
    const inc = defineFunction('inc', {
      params: [{ type: 'Dimension' }] as const,
      body: value => makeDimension(value.number + 1, value.unit)
    });
    const context = new Context({}, [new ModulePlugin(new Map([[file, { inc }]]))]);
    const namespacedCall = reference(
      declarationReference('$'),
      [lookupStep('member', 'math'), lookupStep('member', 'inc'), { type: 'Call', args: [callArg(dimension(2))] }],
      '$math.inc(2)'
    );
    const document = stylesheet([
      moduleImport(modulePath(file), 'use', 'math'),
      rule('.named', [decl('value', namespacedCall)]),
      moduleImport(modulePath(file), 'use', '*'),
      rule('.flat', [
        decl('explicit', reference(
          variableReference('inc', 'live', '$inc'),
          [{ type: 'Call', args: [callArg(dimension(4))] }],
          '$inc(4)'
        )),
        decl('css', funcCall('inc', [dimension(4)]))
      ])
    ]);

    await expect(Promise.resolve(serialize(document, { context, evaluator }))).resolves.toEqual({
      css: '.named {\n  value: 3;\n}\n.flat {\n  explicit: 5;\n  css: inc(4);\n}\n'
    });
  });

  it('binds JSON-compatible values as namespace members without a script runtime', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-module-json-'));
    tempDirs.push(directory);
    const file = path.join(directory, 'tokens.json');
    fs.writeFileSync(file, JSON.stringify({ color: 'blue', scale: { compact: 4 } }), 'utf8');
    const context = new Context({}, [new ModulePlugin(new Map())]);
    const document = stylesheet([
      moduleImport(modulePath(file), 'use', 'tokens'),
      rule('.entry', [
        decl('color', reference(declarationReference('$'), [lookupStep('member', 'tokens'), lookupStep('member', 'color')], '$tokens.color')),
        decl('gap', reference(variableReference('tokens', 'live', '$tokens'), [lookupStep('prop', 'scale'), lookupStep('prop', 'compact')], '$tokens.scale.compact'))
      ])
    ]);

    await expect(Promise.resolve(serialize(document, { context, evaluator }))).resolves.toEqual({
      css: '.entry {\n  color: blue;\n  gap: 4;\n}\n'
    });
  });

  it('does not dispatch a module function through a shadowing local value', async () => {
    const file = tempModule('math.js');
    const inc = defineFunction('inc', {
      params: [{ type: 'Dimension' }] as const,
      body: value => makeDimension(value.number + 1, value.unit)
    });
    const context = new Context({}, [new ModulePlugin(new Map([[file, { inc }]]))]);
    const namespacedCall = reference(
      declarationReference('$'),
      [lookupStep('member', 'math'), lookupStep('member', 'inc'), { type: 'Call', args: [callArg(dimension(2))] }],
      '$math.inc(2)'
    );
    const document = stylesheet([
      moduleImport(modulePath(file), 'use', 'math'),
      rule('.shadow', [
        variableDeclaration('math', collection([collectionEntry(keyword('inc'), keyword('local'))]), { mode: 'declare' }),
        decl('value', namespacedCall)
      ])
    ]);

    await expect(Promise.resolve(serialize(document, { context, evaluator }))).resolves.toEqual({
      css: '.shadow {\n  value: local;\n}\n'
    });
  });

  it('fails when a selected export does not exist', async () => {
    const file = tempModule();
    const context = new Context({}, [new ModulePlugin(new Map([[file, { present: keyword('ok') }]]))]);
    const document = stylesheet([
      moduleImport(modulePath(file), 'from', null, [{ name: 'missing', alias: null }])
    ]);

    await expect(Promise.resolve(serialize(document, { context, evaluator })))
      .rejects.toThrow('Module has no export named "missing"');
  });
});
