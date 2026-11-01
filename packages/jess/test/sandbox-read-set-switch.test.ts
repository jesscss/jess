import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../src/index.js';

/*
 * One Deno process serves one read set (docs/design/DENO-SANDBOX-COMPILE.md §5).
 * Two renders of one compiler whose entries lie in different folders, under
 * one shared script root, need different read sets: each must run in a
 * process started for its own, neither may stop the other's, and each sees
 * only its own folder.
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

const PLUGIN = `
module.exports = {
  install(less, manager, functions) {
    functions.add('peek', (file) => {
      let seen;
      try {
        seen = 'read:' + Deno.readTextFileSync(file.value);
      } catch (err) {
        seen = 'denied:' + err.name;
      }
      return new tree.Quoted('"', seen);
    });
    functions.add('linger', () => new Promise(resolve => setTimeout(() => resolve(new tree.Quoted('"', 'late')), 2000)));
  }
};
`;

const folder = (name: string) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `jess-read-set-${name}-`)));
  dirs.push(dir);
  return dir;
};

describe('renders under different read sets', () => {
  it('each run in their own process, in either order, cold or warm', async () => {
    const shared = folder('scripts');
    const one = folder('one');
    const two = folder('two');
    fs.writeFileSync(path.join(two, 'own.txt'), 'TWO');
    for (const dir of [one, two]) {
      fs.writeFileSync(path.join(dir, 'plugin.js'), PLUGIN);
      fs.writeFileSync(path.join(dir, 'main.less'), `@plugin "./plugin.js";\n.a { v: peek("${path.join(two, 'own.txt')}"); }`);
    }
    const render = (compiler: Compiler, dir: string) => compiler.render(path.join(dir, 'main.less'), { suppressWarnings: true });

    for (const warm of [false, true]) {
      for (const [first, second] of [[one, two], [two, one]]) {
        const compiler = new Compiler({ compile: { jsReadRoot: shared } });
        compilers.push(compiler);
        if (warm) {
          await render(compiler, first!);
        }
        const started = Date.now();
        const [a, b] = await Promise.all([render(compiler, first!), render(compiler, second!)]);
        const css = first === one ? { one: a, two: b } : { one: b, two: a };
        expect(css.one).toContain('v: "denied:NotFound"');
        expect(css.two).toContain('v: "read:TWO"');
        expect(Date.now() - started).toBeLessThan(20_000);
        compiler.dispose();
      }
    }
  }, 120_000);

  it('a render whose engine is disposed fails at once instead of waiting out its time limit', async () => {
    const dir = folder('disposed');
    fs.writeFileSync(path.join(dir, 'plugin.js'), PLUGIN);
    fs.writeFileSync(path.join(dir, 'main.less'), '@plugin "./plugin.js";\n.a { v: linger(); }');
    const compiler = new Compiler();
    compilers.push(compiler);
    await compiler.render(path.join(dir, 'main.less'), { suppressWarnings: true });

    const started = Date.now();
    const pending = compiler.render(path.join(dir, 'main.less'), { suppressWarnings: true });
    setTimeout(() => compiler.dispose(), 300);
    await expect(pending).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 60_000);
});
