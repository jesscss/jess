import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { JessError, makeDimension } from '@jesscss/core';
import jsPlugin, { type JsPlugin } from '../src/index.js';
import { registered } from './registered.js';

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
      ['pluginManager.getVisitors()', 'manager.getVisitors();', 'visitor API'],
      ['pluginManager.visitor()', 'manager.visitor().first();', 'visitor API'],
      ['pluginManager.visitors', 'manager.visitors.push({});', 'visitor API'],
      ['pluginManager.iterator', 'void manager.iterator;', 'visitor API'],
      ['pluginManager.addPreProcessor()', 'manager.addPreProcessor({});', 'before it reaches the compiler'],
      ['pluginManager.getPreProcessors()', 'manager.getPreProcessors();', 'before it reaches the compiler'],
      ['pluginManager.preProcessors', 'manager.preProcessors.push({});', 'before it reaches the compiler'],
      ['pluginManager.addPostProcessor()', 'manager.addPostProcessor({});', 'output.compress'],
      ['pluginManager.getPostProcessors()', 'manager.getPostProcessors();', 'output.compress'],
      ['pluginManager.postProcessors', 'manager.postProcessors.push({});', 'output.compress'],
      ['pluginManager.addFileManager()', 'manager.addFileManager({});', '@jesscss/plugin-node-modules'],
      ['pluginManager.getFileManagers()', 'manager.getFileManagers();', '@jesscss/plugin-node-modules'],
      ['pluginManager.fileManagers', 'manager.fileManagers.push({});', '@jesscss/plugin-node-modules'],
      ['pluginManager.Loader', 'manager.Loader.loadPlugin("x");', 'pluginManager.addPlugin()'],
      ['less.visitors', 'new less.visitors.Visitor(this);', 'visitor API'],
      ['less.FileManager', 'new less.FileManager();', '@jesscss/plugin-node-modules'],
      ['less.environment', 'less.environment.addFileManager({});', '@jesscss/plugin-node-modules']
    ];

    /** The refusal the host reports, never a plain "script threw" load failure. */
    const refusal = (pending: Promise<unknown>): Promise<JessError> => pending.then(
      () => {
        throw new Error('expected the plugin to be refused');
      },
      (error: unknown) => {
        if (error instanceof JessError) {
          return error;
        }
        throw error;
      }
    );

    it.each(cases)('%s', async (feature, call, replacement) => {
      const { runtime, entry } = project([
        ['root/plugin.js', `registerPlugin({ install: function(less, manager) { ${call} } });`]
      ]);
      const refused = await refusal(runtime.importLessPlugin(entry));
      expect(refused.code).toBe('plugin/unsupported-feature');
      expect(refused.message).toBe(`Plugin "plugin.js" uses ${feature}, which is not supported`);
      expect(refused.fix).toContain(replacement);
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
      const refused = await refusal(runtime.importLessPlugin(entry));
      expect(refused.message).toContain('less.visitors');
    }, 30000);

    it('refuses a function that reaches for the hook API when it is called', async () => {
      const { runtime, entry } = project([
        ['root/plugin.js', 'functions.add("late", () => less.visitors);']
      ]);
      const loaded = await runtime.importLessPlugin(entry);
      const refused = await refusal(Promise.resolve(registered(loaded, 'late')()));
      expect(refused.code).toBe('plugin/unsupported-feature');
      expect(refused.message).toContain('less.visitors');
    }, 30000);

    it('refuses the hook API on the call-time this.context.pluginManager', async () => {
      const { runtime, entry } = project([
        ['root/plugin.js', 'functions.add("late", function() { return this.context.pluginManager.getVisitors(); });']
      ]);
      const loaded = await runtime.importLessPlugin(entry);
      const refused = await refusal(Promise.resolve(registered(loaded, 'late')()));
      expect(refused.message).toBe('Plugin "plugin.js" uses pluginManager.getVisitors(), which is not supported');
    }, 30000);

    it.each([
      ['less', 'new less.visitors.Visitor({})'],
      ['globalThis.less', 'new globalThis.less.visitors.Visitor({})'],
      ['Less', 'new Less.visitors.Visitor({})']
    ])('refuses the hook API reached from a required file through %s', async (_view, use) => {
      const { runtime, entry } = project([
        ['root/plugin.js', 'require("./visitor");'],
        ['root/visitor.js', `module.exports = ${use};`]
      ]);
      const refused = await refusal(runtime.importLessPlugin(entry));
      expect(refused.message).toBe('Plugin "plugin.js" uses less.visitors, which is not supported');
    }, 30000);

    it.each([
      ['less.visitors', 'new Less.visitors.Visitor({});'],
      ['less.FileManager', 'new globalThis.less.FileManager();'],
      ['less.environment', 'globalThis.Less.environment.addFileManager({});']
    ])('refuses %s on the worker-global facade too', async (feature, use) => {
      const { runtime, entry } = project([['root/plugin.js', use]]);
      const refused = await refusal(runtime.importLessPlugin(entry));
      expect(refused.message).toBe(`Plugin "plugin.js" uses ${feature}, which is not supported`);
    }, 30000);
  });

  describe('the rest of the Less 4 plugin manager works', () => {
    it('installs function plugins through pluginManager.addPlugin() and addPlugins()', async () => {
      const { runtime, entry } = project([
        ['root/plugin.js', [
          'const one = { install(l, m, registry) { registry.add("one", () => new tree.Dimension(1)); } };',
          'registerPlugin({',
          '  install(less, manager) {',
          '    manager.addPlugin(one, "one.js");',
          '    manager.addPlugins([{ install(l, m, registry) { registry.add("two", () => new tree.Dimension(2)); } }]);',
          '    manager.addPlugins(undefined);',
          '    const facts = [',
          '      manager.get("one.js") === one, manager.get("none.js"), manager.installedPlugins.length,',
          '      manager.get(fileInfo.filename) === manager.installedPlugins[0], manager.less === less',
          '    ];',
          '    functions.add("facts", () => facts.join(","));',
          '  }',
          '});'
        ].join('\n')]
      ]);
      const loaded = await runtime.importLessPlugin(entry);
      expect(Object.keys(loaded.functions).sort()).toEqual(['facts', 'one', 'two']);
      await expect(registered(loaded, 'one')()).resolves.toMatchObject({ number: 1 });
      await expect(registered(loaded, 'two')()).resolves.toMatchObject({ number: 2 });

      /* The registered plugin itself is installed first, cached by its file, as 4.x's loader does. */
      await expect(registered(loaded, 'facts')()).resolves.toBe('true,,3,true,true');
    }, 30000);

    it('hands the call-time this.context.pluginManager the install-time plugins', async () => {
      const { runtime, entry } = project([
        ['root/plugin.js', [
          'registerPlugin({',
          '  install(less, manager) {',
          '    manager.addPlugin({ name: "child" }, "child.js");',
          '    functions.add("child", function() { return this.context.pluginManager.get("child.js").name; });',
          '  }',
          '});'
        ].join('\n')]
      ]);
      const loaded = await runtime.importLessPlugin(entry);
      await expect(registered(loaded, 'child')()).resolves.toBe('child');
    }, 30000);

    it('installs from any array-like passed to addPlugins(), as 4.x does', async () => {
      const { runtime, entry } = project([
        ['root/plugin.js', [
          'registerPlugin({',
          '  install(less, manager) {',
          '    manager.addPlugins({ length: 1, 0: { install(l, m, registry) { registry.add("three", () => new tree.Dimension(3)); } } });',
          '  }',
          '});'
        ].join('\n')]
      ]);
      const loaded = await runtime.importLessPlugin(entry);
      await expect(registered(loaded, 'three')()).resolves.toMatchObject({ number: 3 });
    }, 30000);

    it('lets a plugin spread its manager and less without tripping the refused fields', async () => {
      const { runtime, entry } = project([
        ['root/plugin.js', [
          'registerPlugin({',
          '  install(less, manager) {',
          '    const keys = Object.keys({ ...manager, ...less }).filter(key => key === "visitors" || key === "FileManager");',
          '    functions.add("keys", () => keys.join(","));',
          '  }',
          '});'
        ].join('\n')]
      ]);
      const loaded = await runtime.importLessPlugin(entry);
      await expect(registered(loaded, 'keys')()).resolves.toBe('');
    }, 30000);

    it('refuses installing a plugin from inside a function body, whose functions the host would never learn', async () => {
      const { runtime, entry } = project([
        ['root/plugin.js', [
          'functions.add("late", function() {',
          '  this.context.pluginManager.addPlugin({ install(l, m, registry) { registry.add("never", () => 1); } });',
          '});'
        ].join('\n')]
      ]);
      const loaded = await runtime.importLessPlugin(entry);
      await expect(Promise.resolve(registered(loaded, 'late')())).rejects.toThrow('not from inside a function body');
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
      await expect(registered(loaded, 'double')(makeDimension(4, 'px'))).resolves.toMatchObject({ number: 8, unit: 'px' });
      await expect(registered(loaded, 'triple')(makeDimension(4, 'px'))).resolves.toMatchObject({ number: 12, unit: 'px' });
    }, 30000);

    it('resolves as Node does: .json is parsed, a directory reaches its index, .cjs is not guessed', async () => {
      const { runtime, entry } = project([
        ['root/plugin.js', [
          'const data = require("./data");',
          'const sub = require("./sub");',
          'let cjs;',
          'try { require("./only-cjs"); cjs = "found"; } catch (e) { cjs = "missing"; }',
          'functions.add("probe", () => [data.size, sub, cjs].join(","));'
        ].join('\n')],
        ['root/data.json', '{ "size": 3 }'],
        ['root/sub/index.json', '"sub-index"'],
        ['root/only-cjs.cjs', 'module.exports = 1;']
      ]);
      const loaded = await runtime.importLessPlugin(entry);
      await expect(registered(loaded, 'probe')()).resolves.toBe('3,sub-index,missing');
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
      await expect(registered(loaded, 'probe')()).resolves.toBe('b:a:true');
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

    it('hands required files the plugin\'s own less, whose registry the plugin owns', async () => {
      const { runtime, entry } = project([
        ['root/plugin.js', 'require("./lib");'],
        ['root/lib.js', 'less.functions.functionRegistry.add("fromlib", () => new less.tree.Dimension(7, "px"));']
      ]);
      const loaded = await runtime.importLessPlugin(entry);
      await expect(registered(loaded, 'fromlib')()).resolves.toMatchObject({ number: 7, unit: 'px' });
    }, 30000);

    it('does not hand required files the plugin globals or Node process', async () => {
      const { runtime, entry } = project([
        ['root/plugin.js', 'const probe = require("./probe");\nfunctions.add("probe", () => probe);'],
        ['root/probe.js', 'module.exports = [typeof functions, typeof registerPlugin, typeof process].join(",");']
      ]);
      const loaded = await runtime.importLessPlugin(entry);
      await expect(registered(loaded, 'probe')()).resolves.toBe('undefined,undefined,undefined');
    }, 30000);
  });
});
