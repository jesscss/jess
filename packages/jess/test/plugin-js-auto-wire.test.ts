import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import type { PluginInterface } from '@jesscss/core';

/**
 * `@jesscss/plugin-js` is an end-user installed plugin package, not a `jess`
 * dependency: it embeds a Deno runtime and must not ship by default. When it is
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

const makeDirectCompiler = (): Compiler =>
  new Compiler({
    output: { collapseNesting: true },
    compile: { plugins: [lessPlugin()] }
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

  it('loads a typed Plugin through Context and applies its grammar-owned options', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-direct-plugin-'));
    tempDirs.push(directory);
    const entry = path.join(directory, 'main.less');
    const module = path.join(directory, 'option-plugin.js');
    fs.writeFileSync(module, [
      'registerPlugin({',
      '  setOptions: function(value) { this.value = value; },',
      '  install: function(_less, _manager, functions) {',
      '    var self = this;',
      '    functions.add("from-plugin", function() { return self.value; });',
      '  }',
      '});'
    ].join('\n'));
    fs.writeFileSync(entry, [
      '@plugin (chosen=@{value}) "./option-plugin.js";',
      '@value: yes;',
      '.entry { value: from-plugin(); }'
    ].join('\n'));

    await expect(makeDirectCompiler().render(entry)).resolves.toBe('.entry {\n  value: chosen=yes;\n}\n');
  });

  it('hoists Plugin functions over a lexical body without leaking its nested shadow', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-direct-plugin-scope-'));
    tempDirs.push(directory);
    const entry = path.join(directory, 'main.less');
    const module = path.join(directory, 'scope-plugin.js');
    fs.writeFileSync(module, [
      'registerPlugin({',
      '  setOptions: function(value) { this.value = value; },',
      '  install: function(_less, _manager, functions) {',
      '    var self = this;',
      '    functions.add("scope-plugin", function() { return self.value; });',
      '  }',
      '});'
    ].join('\n'));
    fs.writeFileSync(entry, [
      '@plugin (root) "./scope-plugin.js";',
      '.local { value: scope-plugin(); @plugin (local) "./scope-plugin.js"; after: scope-plugin(); }',
      '.sibling { value: scope-plugin(); }'
    ].join('\n'));

    await expect(makeDirectCompiler().render(entry)).resolves.toBe([
      '.local {',
      '  value: local;',
      '  after: local;',
      '}',
      '.sibling {',
      '  value: root;',
      '}',
      ''
    ].join('\n'));
  });

  it('propagates an async Plugin load failure through the direct compiler route', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-direct-plugin-error-'));
    tempDirs.push(directory);
    const entry = path.join(directory, 'main.less');
    const module = path.join(directory, 'broken-plugin.js');
    fs.writeFileSync(module, 'registerPlugin({ install: function() { throw new Error("plugin install exploded"); } });');
    fs.writeFileSync(entry, '@plugin "./broken-plugin.js"; .entry { value: ok; }');

    await expect(makeDirectCompiler().render(entry)).rejects.toThrow('plugin install exploded');
  });

  it('hoists and isolates typed Plugins in root, mixin, and detached lexical bodies', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-direct-plugin-bodies-'));
    tempDirs.push(directory);
    const entry = path.join(directory, 'main.less');
    const module = path.join(directory, 'body-plugin.js');
    fs.writeFileSync(module, [
      'registerPlugin({',
      '  setOptions: function(value) { this.value = value; },',
      '  install: function(_less, _manager, functions) {',
      '    var self = this;',
      '    functions.add("body-plugin", function() { return self.value; });',
      '  }',
      '});'
    ].join('\n'));
    fs.writeFileSync(entry, [
      '@plugin (root) "./body-plugin.js";',
      '.mixin() { before: body-plugin(); @plugin (mixin) "./body-plugin.js"; after: body-plugin(); }',
      '@detached: { before: body-plugin(); @plugin (detached) "./body-plugin.js"; after: body-plugin(); };',
      '.entry { .mixin(); @detached(); outside: body-plugin(); }'
    ].join('\n'));

    await expect(makeDirectCompiler().render(entry)).resolves.toBe([
      '.entry {',
      '  before: mixin;',
      '  after: mixin;',
      '  before: detached;',
      '  after: detached;',
      '  outside: root;',
      '}',
      ''
    ].join('\n'));
  });

  it('bridges raw sequences, explicit lists, and detached maps through a real Less @plugin call', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-direct-plugin-values-'));
    tempDirs.push(directory);
    const entry = path.join(directory, 'main.less');
    const module = path.join(directory, 'values-plugin.js');
    fs.writeFileSync(module, [
      'registerPlugin({',
      '  install: function(_less, _manager, functions) {',
      '    functions.add("scalar", function(value) {',
      '      return value instanceof tree.Dimension ? new tree.Dimension(value.value + 1, value.unit) : new tree.Anonymous("bad-scalar");',
      '    });',
      '    functions.add("sequence", function(value) {',
      '      return new tree.Anonymous(value instanceof tree.Expression ? "expression" : "bad-sequence");',
      '    });',
      '    functions.add("list", function(value) {',
      '      return new tree.Anonymous(value instanceof tree.Value && value.separator === "," ? "value" : "bad-list");',
      '    });',
      '    functions.add("map-size", function(value) {',
      '      var valid = value instanceof tree.Mixin && value.name instanceof tree.Nil && value.args instanceof tree.Nil;',
      '      return new tree.Dimension(valid ? value.ruleset.rules.length : 0, "px");',
      '    });',
      '    functions.add("slash", function() { return less.value([new tree.Dimension(1, "px"), new tree.Dimension(2, "px")], "/"); });',
      '    functions.add("semicolon", function() { return less.value([new tree.Dimension(3, "px"), new tree.Dimension(4, "px")], ";"); });',
      '  }',
      '});'
    ].join('\n'));
    fs.writeFileSync(entry, [
      '@plugin "./values-plugin.js";',
      '@comma: red, blue;',
      '@map: { one: 1px; two: 2px; };',
      '.entry {',
      '  scalar: scalar(4px);',
      '  sequence: sequence(red blue);',
      '  list: list(@comma);',
      '  map: map-size(@map);',
      '  slash: slash();',
      '  semicolon: semicolon();',
      '}'
    ].join('\n'));

    await expect(makeDirectCompiler().render(entry)).resolves.toBe([
      '.entry {',
      '  scalar: 5px;',
      '  sequence: expression;',
      '  list: value;',
      '  map: 2px;',
      '  slash: 1px / 2px;',
      '  semicolon: 3px, 4px;',
      '}',
      ''
    ].join('\n'));
  });
});
