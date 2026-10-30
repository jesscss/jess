import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin, type NativeLessPlugin } from '@jesscss/plugin-less-compat';
import { Compiler } from '../src/index.js';

/*
 * `compile.jsSandbox` decides where stylesheet JavaScript runs: per call in the
 * Deno sandbox ('call', the default), the whole compile in the Deno sandbox
 * ('compile'), or in this process (false). The CSS must not depend on it.
 */

const tempDirs: string[] = [];
const compilers: Compiler[] = [];

const makeTmpDir = () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jess-sandbox-modes-')));
  tempDirs.push(dir);
  return dir;
};

const compilerFor = (jsSandbox: 'call' | 'compile' | false | undefined, plugins: NativeLessPlugin[] = []) => {
  const compiler = new Compiler({
    compile: {
      ...(jsSandbox === undefined ? {} : { jsSandbox }),
      ...(plugins.length === 0 ? {} : { plugins: [lessPlugin(), lessCompatPlugin({ plugins })] })
    }
  });
  compilers.push(compiler);
  return compiler;
};

const PLUGIN = [
  'registerPlugin({',
  '  install: function(less, _manager, functions) {',
  '    functions.add("double", function(n) { return new tree.Dimension(n.value * 2, n.unit); });',
  '    functions.add("lookup", function() {',
  '      var hit = this.context.frames[0].variable("@base");',
  '      return hit ? hit.value : "none";',
  '    });',
  '    functions.add("darker", function(c) { return this.context.pluginManager.less.functions.functionRegistry.get("darken")(c, new tree.Dimension(10, "%")); });',
  '    functions.add("version", function() { return new tree.Keyword("v1"); });',
  '  }',
  '});'
].join('\n');

const STYLESHEET = [
  '@plugin "./plugin.js";',
  '@base: 4px;',
  '.a { width: double(3px); margin: lookup(); color: darker(#336699); v: version(); }'
].join('\n');

const writeFixture = () => {
  const root = makeTmpDir();
  fs.writeFileSync(path.join(root, 'plugin.js'), PLUGIN, 'utf8');
  fs.writeFileSync(path.join(root, 'main.less'), STYLESHEET, 'utf8');
  return root;
};

describe('compile.jsSandbox', () => {
  afterEach(() => {
    for (const compiler of compilers.splice(0)) {
      compiler.dispose();
    }
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('renders the same CSS in every mode', async () => {
    const root = writeFixture();
    const entry = path.join(root, 'main.less');
    const outputs = await Promise.all([undefined, 'call', 'compile', false].map(async mode =>
      compilerFor(mode as 'call' | 'compile' | false | undefined).render(entry, { suppressWarnings: true })));
    expect(outputs[0]).toContain('width: 6px');
    expect(outputs[0]).toContain('margin: 4px');
    expect(outputs[0]).toContain('v: v1');
    expect(new Set(outputs).size).toBe(1);
  });

  it('runs a whole compile as one request to a warm engine, reloading a plugin only when its file changes', async () => {
    const root = writeFixture();
    const entry = path.join(root, 'main.less');
    const compiler = compilerFor('compile');
    await compiler.render(entry, { suppressWarnings: true });

    /* Count the requests the engine's plugin sends from here on. */
    const engine: unknown = await Reflect.get(compiler, 'compileEngine');
    const callWorker: unknown = Reflect.get(Object(engine), 'callWorker');
    let requests = 0;
    Reflect.set(Object(engine), 'callWorker', function(this: unknown, ...args: unknown[]) {
      requests++;
      return Reflect.apply(callWorker as (...a: unknown[]) => unknown, this, args);
    });

    await compiler.render(entry, { suppressWarnings: true });
    expect(requests).toBe(1);

    fs.writeFileSync(path.join(root, 'plugin.js'), PLUGIN.replace('"v1"', '"v2"'), 'utf8');
    const later = new Date(Date.now() + 2000);
    fs.utimesSync(path.join(root, 'plugin.js'), later, later);
    expect(await compiler.render(entry, { suppressWarnings: true })).toContain('v: v2');
    expect(requests).toBe(2);
  });

  it('runs scripts in this process only with jsSandbox: false', async () => {
    const root = makeTmpDir();
    fs.writeFileSync(
      path.join(root, 'plugin.js'),
      'registerPlugin({ install: function(_l, _m, functions) { functions.add("realm", function() { return new tree.Keyword(typeof Deno === "undefined" ? "node" : "deno"); }); } });',
      'utf8'
    );
    const entry = path.join(root, 'main.less');
    fs.writeFileSync(entry, '@plugin "./plugin.js"; .a { realm: realm(); }', 'utf8');
    const realm = async (mode: 'call' | 'compile' | false | undefined) =>
      (await compilerFor(mode).render(entry, { suppressWarnings: true })).match(/realm: (\w+)/)?.[1];
    expect(await realm(undefined)).toBe('deno');
    expect(await realm('call')).toBe('deno');
    expect(await realm('compile')).toBe('deno');
    expect(await realm(false)).toBe('node');
  });

  it('rebuilds a function passed in compiler options inside the engine', async () => {
    const root = makeTmpDir();
    const entry = path.join(root, 'main.less');
    fs.writeFileSync(entry, '.a { width: triple(3px); }', 'utf8');
    const inline: NativeLessPlugin = {
      install(less, _manager, functions) {
        functions.add('triple', n => new less.tree.Dimension(Number(n) * 3, 'px'));
      }
    };
    const css = await compilerFor('compile', [inline]).render(entry, { suppressWarnings: true });
    expect(css).toContain('width: 9px');
  });

  it('names the outside variable a rebuilt function reads', async () => {
    const root = makeTmpDir();
    const entry = path.join(root, 'main.less');
    fs.writeFileSync(entry, '.a { width: scale(3px); }', 'utf8');
    const factor = 5;
    const capturing: NativeLessPlugin = {
      install(less, _manager, functions) {
        functions.add('scale', n => new less.tree.Dimension(Number(n) * factor, 'px'));
      }
    };
    await expect(compilerFor('compile', [capturing]).render(entry, { suppressWarnings: true }))
      .rejects.toMatchObject({ code: 'plugin/function-threw', note: expect.stringContaining('uses `factor` from outside its own body') });
  });
});

/*
 * The compile engine runs plugins in the same Deno process as the compiler, so
 * the process's permissions ARE the plugin's. These are the probes of
 * `@jesscss/plugin-js`'s own security suite, run as a `@plugin` inside a whole
 * compile.
 */
describe('compile.jsSandbox: "compile" permissions', () => {
  afterEach(() => {
    for (const compiler of compilers.splice(0)) {
      compiler.dispose();
    }
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('denies env, reads outside the roots, net, run, write, ffi and sys to a plugin', async () => {
    const root = makeTmpDir();
    const outside = makeTmpDir();
    const secret = path.join(outside, 'secret.txt');
    fs.writeFileSync(secret, 'secret', 'utf8');
    const probes: Record<string, string> = {
      env: 'Deno.env.get("HOME")',
      processEnvHome: 'process.env.HOME === undefined ? (() => { throw new Error("no HOME fact"); })() : process.env.HOME',
      readOutside: `Deno.readTextFileSync(${JSON.stringify(secret)})`,
      readOutsideUrl: `Deno.readTextFileSync(new URL("file://" + ${JSON.stringify(secret)}))`,
      readEtcHosts: 'Deno.readTextFileSync("/etc/hosts")',
      listOutside: `Array.from(Deno.readDirSync(${JSON.stringify(outside)}))`,
      writeInRoot: `Deno.writeTextFileSync(${JSON.stringify(path.join(root, 'pwn.txt'))}, "x")`,
      run: 'new Deno.Command("echo", { args: ["x"] }).outputSync()',
      sys: 'Deno.hostname()',
      ffi: 'Deno.dlopen("/usr/lib/libSystem.dylib", {})'
    };
    const asyncProbes: Record<string, string> = {
      net: 'await fetch("https://example.com")',
      importNet: 'await import("https://example.com/mod.ts")',
      nodeChildProcess: '(await import("node:child_process")).execFileSync("echo", ["x"])'
    };
    const plugin = [
      'registerPlugin({',
      '  install: function(_less, _manager, functions) {',
      ...Object.entries(probes).map(([name, expr]) =>
        `    functions.add("${name}", function() { try { ${expr}; return "ALLOWED"; } catch (e) { return "DENIED"; } });`),
      ...Object.entries(asyncProbes).map(([name, expr]) =>
        `    functions.add("${name}", async function() { try { ${expr}; return "ALLOWED"; } catch (e) { return "DENIED"; } });`),
      '    functions.add("readOwnRoot", function() { try { Deno.readTextFileSync("./main.less".replace(".", ' + JSON.stringify(root) + ')); return "ALLOWED"; } catch (e) { return "DENIED"; } });',
      '  }',
      '});'
    ].join('\n');
    const names = [...Object.keys(probes), ...Object.keys(asyncProbes), 'readOwnRoot'];
    fs.writeFileSync(path.join(root, 'probe.js'), plugin, 'utf8');
    fs.writeFileSync(
      path.join(root, 'main.less'),
      ['@plugin "./probe.js";', `.probe { ${names.map(name => `${name}: ${name}();`).join(' ')} }`].join('\n'),
      'utf8'
    );

    const css = await compilerFor('compile').render(path.join(root, 'main.less'), { suppressWarnings: true });
    for (const name of names) {
      expect(css, name).toContain(`${name}: ${name === 'readOwnRoot' ? 'ALLOWED' : 'DENIED'}`);
    }
    expect(fs.existsSync(path.join(root, 'pwn.txt'))).toBe(false);
  });

  it('refuses a stylesheet import outside the roots that the in-process compile would read', async () => {
    const root = makeTmpDir();
    const outside = makeTmpDir();
    fs.writeFileSync(path.join(outside, 'secret.less'), '.secret { a: b; }', 'utf8');
    fs.writeFileSync(path.join(root, 'main.less'), `@import ${JSON.stringify(path.join(outside, 'secret.less'))};`, 'utf8');
    await expect(compilerFor('compile').render(path.join(root, 'main.less'), { suppressWarnings: true }))
      .rejects.toMatchObject({ name: 'JessError' });
  });
});
