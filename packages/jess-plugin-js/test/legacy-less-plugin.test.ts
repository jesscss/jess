import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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
});
