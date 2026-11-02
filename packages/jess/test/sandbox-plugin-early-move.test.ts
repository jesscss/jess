import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../src/index.js';

/*
 * A render moves into the script sandbox early, when planning places a
 * document, only for a `@plugin` evaluation is certain to reach
 * (docs/design/DENO-SANDBOX-COMPILE.md §2). A `@plugin` in a sheet imported by
 * a mixin no one calls, or under a guard that is false, is never evaluated: the
 * render stays in this process and its CSS is what it is without the
 * `@plugin`. Each case also imports a sheet outside the read root, which only
 * a render in this process can read.
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

const folder = (name: string) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `jess-early-move-${name}-`)));
  dirs.push(dir);
  return dir;
};

/** Renders `main` beside a `lib.less` holding `lib`, with an `OUTSIDE` sheet outside the read root. */
const render = async (main: string, lib: string) => {
  const root = folder('root');
  const outside = folder('outside');
  fs.writeFileSync(path.join(outside, 'shared.less'), '.shared { x: y; }');
  fs.writeFileSync(path.join(root, 'p.js'), 'module.exports = { install() {} };');
  fs.writeFileSync(path.join(root, 'lib.less'), lib);
  fs.writeFileSync(path.join(root, 'main.less'), main.replace('OUTSIDE', outside));
  const compiler = new Compiler();
  compilers.push(compiler);
  return compiler.render(path.join(root, 'main.less'), { suppressWarnings: true });
};

const sameWithoutThePlugin = async (main: string) => {
  const css = await render(main, '@plugin "./p.js";');
  expect(css).toContain('.shared');
  expect(css).toBe(await render(main, ''));
};

describe('a @plugin evaluation never reaches', () => {
  it('in a sheet imported by a mixin no one calls, leaves the render here', async () => {
    await sameWithoutThePlugin('.m() { @import "./lib.less"; }\n@import "OUTSIDE/shared.less";\n.a { b: c; }');
  }, 60_000);

  it('in a sheet imported under a false guard, leaves the render here', async () => {
    await sameWithoutThePlugin('.a when (false) { @import "./lib.less"; }\n@import "OUTSIDE/shared.less";\n.b { c: d; }');
  }, 60_000);

  it('does not stop an import from outside the read root', async () => {
    const css = await render('.m() { @import "./lib.less"; }\n@import "OUTSIDE/shared.less";\n.a { b: c; }', '@plugin "./p.js";');
    expect(css).toContain('.shared');
    expect(css).toContain('.a');
  }, 60_000);
});
