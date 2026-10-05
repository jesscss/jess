import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { makeDimension } from '@jesscss/core';
import jsPlugin, { type JsPlugin } from '../src/index.js';

/*
 * The deprecated Less `@plugin` script runtime: what a 4.x plugin file may and
 * may not reach for inside the Deno sandbox.
 */
describe('legacy Less @plugin runtime', () => {
  const plugins: JsPlugin[] = [];
  const dirs: string[] = [];

  afterEach(() => {
    for (const plugin of plugins.splice(0)) {
      plugin.dispose();
    }
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /** Writes `[path, source]` files under a fresh parent dir; the runtime is sandboxed to its `root/`. */
  function project(files: ReadonlyArray<readonly [string, string]>) {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-legacy-plugin-'));
    dirs.push(parent);
    const root = path.join(parent, 'root');
    for (const [name, source] of files) {
      const file = path.join(parent, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, source, 'utf8');
    }
    fs.mkdirSync(root, { recursive: true });
    const runtime = jsPlugin({ jsReadRoot: root, runtimeApi: 'less' }) as JsPlugin;
    plugins.push(runtime);
    return { runtime, entry: path.join(root, 'plugin.js') };
  }

  describe('Less 4 plugin-manager hooks are refused, naming the replacement', () => {
    const cases: Array<[string, string, string]> = [
      ['pluginManager.addVisitor()', 'manager.addVisitor({});', 'visitor API'],
      ['pluginManager.addPreProcessor()', 'manager.addPreProcessor({});', 'before it reaches the compiler'],
      ['pluginManager.addPostProcessor()', 'manager.addPostProcessor({});', 'output.compress'],
      ['pluginManager.addFileManager()', 'manager.addFileManager({});', '@jesscss/plugin-node-modules'],
      ['less.visitors', 'new less.visitors.Visitor(this);', 'visitor API'],
      ['less.FileManager', 'new less.FileManager();', '@jesscss/plugin-node-modules'],
      ['less.environment', 'less.environment.addFileManager({});', '@jesscss/plugin-node-modules']
    ];

    it.each(cases)('%s', async (feature, call, replacement) => {
      const { runtime, entry } = project([
        ['root/plugin.js', `registerPlugin({ install: function(less, manager) { ${call} } });`]
      ]);
      const failure = await runtime.importLessPlugin(entry).then(
        () => new Error('expected the plugin load to be refused'),
        (error: unknown) => error
      );
      expect(failure).toBeInstanceOf(Error);
      const message = failure instanceof Error ? failure.message : '';
      expect(message).toContain(feature);
      expect(message).toContain('not supported');
      expect(message).toContain(replacement);
    }, 30000);

    it('refuses the plugin-preeval visitor shape at its destructured less.visitors', async () => {
      const { runtime, entry } = project([
        ['root/plugin.js', [
          'module.exports = {',
          '  install({ tree: { Quoted }, visitors }, manager) {',
          '    manager.addVisitor(new visitors.Visitor(this));',
          '  }',
          '};'
        ].join('\n')]
      ]);
      await expect(runtime.importLessPlugin(entry)).rejects.toThrow('less.visitors');
    }, 30000);
  });

  describe('relative require() of sibling CommonJS files', () => {
    it('loads a function plugin split across files', async () => {
      const { runtime, entry } = project([
        ['root/plugin.js', [
          'const { scale } = require("./lib/scale");',
          'functions.add("double", value => new tree.Dimension(scale(value.value, 2), value.unit));',
          'functions.add("triple", value => new tree.Dimension(require("./lib/scale.js").scale(value.value, 3), value.unit));'
        ].join('\n')],
        ['root/lib/scale.js', 'const { times } = require("../util");\nexports.scale = (n, k) => times(n, k);'],
        ['root/util/index.js', 'module.exports = { times: (a, b) => a * b };']
      ]);
      const loaded = await runtime.importLessPlugin(entry);
      expect(Object.keys(loaded.functions).sort()).toEqual(['double', 'triple']);
      await expect(loaded.functions.double(makeDimension(4, 'px'))).resolves.toMatchObject({ number: 8, unit: 'px' });
      await expect(loaded.functions.triple(makeDimension(4, 'px'))).resolves.toMatchObject({ number: 12, unit: 'px' });
    }, 30000);

    it('evaluates each required file once and hands a cycle its partial exports', async () => {
      const { runtime, entry } = project([
        ['root/plugin.js', [
          'const a = require("./a");',
          'functions.add("probe", () => `${a.seenB}:${require("./b").seenA}:${require("./a") === a}`);'
        ].join('\n')],
        ['root/a.js', 'exports.early = "a";\nexports.seenB = require("./b").name;'],
        ['root/b.js', 'exports.name = "b";\nexports.seenA = require("./a").early;']
      ]);
      const loaded = await runtime.importLessPlugin(entry);
      await expect(loaded.functions.probe()).resolves.toBe('b:a:true');
    }, 30000);

    it('does not widen the read sandbox: a require outside jsReadRoot is denied', async () => {
      const { runtime, entry } = project([
        ['root/plugin.js', 'require("../outside/secret.js");'],
        ['outside/secret.js', 'module.exports = "LEAKED";']
      ]);
      const failure = await runtime.importLessPlugin(entry).then(
        () => new Error('expected the require to be refused'),
        (error: unknown) => error
      );
      expect(failure).toBeInstanceOf(Error);
      const message = failure instanceof Error ? failure.message : '';
      expect(message).toContain('require("../outside/secret.js")');
      expect(message).toContain('was refused: Read access denied by Jess policy.');
    }, 30000);

    it('refuses package and built-in specifiers with a clear message', async () => {
      const { runtime, entry } = project([['root/plugin.js', 'require("fs");']]);
      await expect(runtime.importLessPlugin(entry)).rejects.toThrow(
        'Less @plugin require("fs") is not supported: only relative requires ("./file", "../file") of CommonJS files inside the script root are.'
      );
    }, 30000);

    it('does not hand required files the plugin globals or Node process', async () => {
      const { runtime, entry } = project([
        ['root/plugin.js', 'const probe = require("./probe");\nfunctions.add("probe", () => probe);'],
        ['root/probe.js', 'module.exports = [typeof functions, typeof registerPlugin, typeof process].join(",");']
      ]);
      const loaded = await runtime.importLessPlugin(entry);
      await expect(loaded.functions.probe()).resolves.toBe('undefined,undefined,undefined');
    }, 30000);
  });
});
