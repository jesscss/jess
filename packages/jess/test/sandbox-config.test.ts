import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../src/index.js';

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
});
