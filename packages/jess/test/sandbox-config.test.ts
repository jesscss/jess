import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Compiler } from '../src/index.js';

/** core's built entry, for a plugin factory module written in a test folder. */
const CORE = fileURLToPath(new URL('../../core/lib/index.js', import.meta.url));

/*
 * A render that runs a script runs in the Deno sandbox, which cannot read a
 * `styles.config` above its read root. The host sends the settings it resolved
 * for the entry, and the chain of configs above each read root, as data
 * (docs/design/DENO-SANDBOX-COMPILE.md §4), so every file of a sandboxed render,
 * imports included, has the settings it has in Node. A config that cannot cross
 * into the sandbox fails the render, naming it, instead of being left out.
 */
const dirs: string[] = [];
const compilers: Compiler[] = [];

afterEach(() => {
  for (const compiler of compilers.splice(0)) {
    compiler.dispose();
  }
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A project folder holding `child/`, whose own config makes `child/` the read root; `parent` is the config above it. */
const layout = (parent: string | undefined) => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jess-sandbox-config-')));
  dirs.push(base);
  const child = path.join(base, 'child');
  fs.mkdirSync(path.join(child, 'sub'), { recursive: true });
  if (parent !== undefined) {
    fs.writeFileSync(path.join(base, 'styles.config.cjs'), parent);
  }
  fs.writeFileSync(path.join(child, 'styles.config.cjs'), 'module.exports = { compile: { allowCallerScope: true } };');
  fs.writeFileSync(path.join(child, 'plugin.js'), 'module.exports = { install() {} };');
  fs.writeFileSync(path.join(child, 'sub/part.less'), '.part { .inner { w: 4px / 2; } }');
  const compiler = new Compiler();
  compilers.push(compiler);
  const render = (name: string, source: string) => {
    fs.writeFileSync(path.join(child, name), source);
    return compiler.render(path.join(child, name), { suppressWarnings: true });
  };
  return { base, render };
};

const COLLAPSE = 'module.exports = { output: { collapseNesting: true }, compile: { mathMode: \'always\' } };';

describe('styles.config settings in the script sandbox', () => {
  it('are the settings the render has in Node, configs above the read root included', async () => {
    const { render } = layout(COLLAPSE);
    const inNode = await render('plain.less', '.a { .b { c: d; } }');
    const sandboxed = await render('scripted.less', '@plugin "./plugin.js";\n.a { .b { c: d; } }');
    expect(inNode).toContain('.a .b {');
    expect(sandboxed).toBe(inNode);
  }, 60_000);

  it('are the settings an import has in Node, from the configs above the read root', async () => {
    const { render } = layout(COLLAPSE);
    const inNode = await render('plain.less', '@import "./sub/part.less";');
    const sandboxed = await render('scripted.less', '@plugin "./plugin.js";\n@import "./sub/part.less";');
    expect(inNode).toContain('w: 2px');
    expect(sandboxed).toBe(inNode);
  }, 60_000);

  it('fail, naming the config, when a config above the read root cannot cross into the sandbox', async () => {
    const { base, render } = layout('class Banner { name = "banner"; }\nmodule.exports = { compile: { plugins: [new Banner()] } };');
    await expect(render('plain.less', '@import "./sub/part.less";')).resolves.toContain('.part');
    await expect(render('scripted.less', '@plugin "./plugin.js";\n@import "./sub/part.less";'))
      .rejects.toThrow(path.join(base, 'styles.config.cjs'));
  }, 60_000);

  it('do not stop an import when no config lies above the read root', async () => {
    const { render } = layout(undefined);
    const inNode = await render('plain.less', '@import "./sub/part.less";');
    const sandboxed = await render('scripted.less', '@plugin "./plugin.js";\n@import "./sub/part.less";');
    expect(sandboxed).toBe(inNode);
  }, 60_000);
  it('leave a chain above a read root that no file needs unloaded, so it cannot break the render', async () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jess-sandbox-config-unused-')));
    dirs.push(base);
    const write = (rel: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
      fs.writeFileSync(path.join(base, rel), text);
    };
    write('other/plug.mjs', `import { recordPluginModule } from ${JSON.stringify(CORE)};\nexport default () => recordPluginModule({ name: 'other-plug' }, import.meta.url, 'default', []);`);
    write('other/styles.config.mjs', `import plug from './plug.mjs';\nexport default { compile: { plugins: [plug()] } };`);
    fs.mkdirSync(path.join(base, 'other/scripts'), { recursive: true });
    write('proj/package.json', '{}');
    write('proj/child/styles.config.cjs', `module.exports = { compile: { jsReadRoot: ${JSON.stringify(path.join(base, 'other/scripts'))} } };`);
    write('proj/child/plugin.js', 'module.exports = { install() {} };');
    write('proj/child/plain.less', '.a { b: c; }');
    write('proj/child/scripted.less', '@plugin "./plugin.js";\n.a { b: c; }');
    const compiler = new Compiler();
    compilers.push(compiler);
    const inNode = await compiler.render(path.join(base, 'proj/child/plain.less'), { suppressWarnings: true });
    await expect(compiler.render(path.join(base, 'proj/child/scripted.less'), { suppressWarnings: true })).resolves.toBe(inNode);
  }, 60_000);

  it('fail, naming the config, when a chain the render needs holds a plugin the sandbox cannot load', async () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jess-sandbox-config-factory-')));
    dirs.push(base);
    fs.mkdirSync(path.join(base, 'child'));
    fs.writeFileSync(path.join(base, 'plug.mjs'), `import { recordPluginModule } from ${JSON.stringify(CORE)};\nexport default () => recordPluginModule({ name: 'up-plug' }, import.meta.url, 'default', []);`);
    fs.writeFileSync(path.join(base, 'styles.config.mjs'), `import plug from './plug.mjs';\nexport default { compile: { plugins: [plug()] } };`);
    fs.writeFileSync(path.join(base, 'child/styles.config.cjs'), 'module.exports = { compile: { allowCallerScope: true } };');
    fs.writeFileSync(path.join(base, 'child/plugin.js'), 'module.exports = { install() {} };');
    fs.writeFileSync(path.join(base, 'child/scripted.less'), '@plugin "./plugin.js";\n.a { b: c; }');
    const compiler = new Compiler();
    compilers.push(compiler);
    await expect(compiler.render(path.join(base, 'child/scripted.less'), { suppressWarnings: true }))
      .rejects.toMatchObject({ code: 'config/outside-read-root', message: expect.stringContaining(path.join(base, 'styles.config.mjs')) });
  }, 60_000);

  it('cross into the sandbox as the settings Jess defines only', async () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jess-sandbox-config-known-')));
    dirs.push(base);
    fs.mkdirSync(path.join(base, 'child/sub'), { recursive: true });
    fs.writeFileSync(path.join(base, 'styles.config.cjs'), [
      'module.exports = {',
      `  secretToken: 'S3CRET-TOP',`,
      `  compile: { mathMode: 'always', secretToken: 'S3CRET-COMPILE' },`,
      `  language: { jess: { unitMode: 'strict', secretToken: 'S3CRET-JESS' }, less: { strictUnits: true }, other: { secretToken: 'S3CRET-OTHER' } }`,
      '};'
    ].join('\n'));
    fs.writeFileSync(path.join(base, 'child/styles.config.cjs'), 'module.exports = { compile: { allowCallerScope: true } };');
    fs.writeFileSync(path.join(base, 'child/sub/part.less'), '.part { w: 4px / 2; }');
    fs.writeFileSync(path.join(base, 'child/dump.js'), `module.exports = { install(less, manager, functions) {
  functions.add('dump', () => new tree.Quoted('"', JSON.stringify(globalThis[Symbol.for('@jesscss/compiler/host-configs')] ?? null, (key, value) => (value instanceof Map ? Object.fromEntries(value) : value)).replace(/"/g, "'")));
} };`);
    fs.writeFileSync(path.join(base, 'child/main.less'), '@plugin "./dump.js";\n@import "./sub/part.less";\n.a { d: dump(); }');
    const compiler = new Compiler();
    compilers.push(compiler);
    const css = await compiler.render(path.join(base, 'child/main.less'), { suppressWarnings: true });
    expect(css).toContain('w: 2px');
    expect(css).not.toContain('S3CRET');
    expect(css).toContain(`'mathMode':'always'`);
    expect(css).toContain(`'unitMode':'strict'`);
    expect(css).toContain(`'strictUnits':true`);
  }, 60_000);
});
