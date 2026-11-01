import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../src/index.js';

/*
 * The proof that Deno itself enforces the sandbox of a render that runs
 * `@plugin` JavaScript (docs/design/DENO-SANDBOX-COMPILE.md §5, ledger A19).
 * The host makes no check of its own: the render runs whole in Deno under
 * `--allow-read=<read root> --ignore-read` and no `--allow-net`, and each probe
 * reports the error Deno raised. A positive control reads inside the root, and
 * the symlink probe pins §8.3 (Deno checks the path as written).
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
const attempt = (run) => {
  try {
    return 'read:' + String(run()).trim();
  } catch (err) {
    return 'denied:' + err.name + ':' + (err.code || '');
  }
};
const quoted = text => new tree.Quoted('"', text);
module.exports = {
  install(less, manager, functions) {
    functions.add('in-engine', () => quoted(String(globalThis[Symbol.for('@jesscss/plugin-js/engine')] === true)));
    functions.add('read-file', file => quoted(attempt(() => Deno.readTextFileSync(file.value))));
    functions.add('fetch-url', async (url) => {
      try {
        await fetch(url.value);
        return quoted('reached');
      } catch (err) {
        return quoted('denied:' + err.name);
      }
    });
  }
};
`;

describe('a sandboxed render is confined by Deno', () => {
  it('denies reads outside the read root and network without allowHttp, with Deno\'s own errors', async () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jess-sandbox-denial-')));
    dirs.push(base);
    const root = path.join(base, 'root');
    const outside = path.join(base, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'SECRET');
    fs.writeFileSync(path.join(root, 'inside.txt'), 'INSIDE');
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
    fs.writeFileSync(path.join(root, 'plugin.js'), PLUGIN);
    const entry = path.join(root, 'main.less');
    fs.writeFileSync(entry, [
      '@plugin "./plugin.js";',
      '.a {',
      '  engine: in-engine();',
      `  inside: read-file("${path.join(root, 'inside.txt')}");`,
      `  outside: read-file("${path.join(outside, 'secret.txt')}");`,
      `  system: read-file("/etc/hosts");`,
      `  symlink: read-file("${path.join(root, 'link.txt')}");`,
      '  net: fetch-url("https://example.com/");',
      '}'
    ].join('\n'));

    const compiler = new Compiler();
    compilers.push(compiler);
    const css = await compiler.render(entry, { suppressWarnings: true });

    expect(css).toContain('engine: "true"');
    expect(css).toContain('inside: "read:INSIDE"');
    expect(css).toContain('outside: "denied:NotFound:ENOENT"');
    expect(css).toContain('system: "denied:NotFound:ENOENT"');

    /* §8.3: a symlink inside the read root is read through, as written. */
    expect(css).toContain('symlink: "read:SECRET"');
    expect(css).toContain('net: "denied:NotCapable"');
  }, 60_000);

  /*
   * A package whose real path is in no `node_modules` (a `link:` or `file:`
   * dependency on a sibling checkout) gives no read root (ledger A19), so a
   * render that runs a script cannot read it. The same import compiles in a
   * render without scripts, which runs in Node.
   */
  it('cannot read a linked package outside the read root once the render runs a script', async () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jess-sandbox-linked-')));
    dirs.push(base);
    const checkout = path.join(base, 'checkout/pkg');
    fs.mkdirSync(checkout, { recursive: true });
    fs.writeFileSync(path.join(checkout, 'package.json'), '{"name":"linked"}');
    fs.writeFileSync(path.join(checkout, 'style.less'), '.linked { a: b; }');
    const project = path.join(base, 'project');
    fs.mkdirSync(path.join(project, 'node_modules'), { recursive: true });
    fs.symlinkSync(checkout, path.join(project, 'node_modules/linked'));
    fs.writeFileSync(path.join(project, 'plugin.js'), 'module.exports = { install() {} };');
    fs.writeFileSync(path.join(project, 'plain.less'), '@import "linked/style.less";');
    fs.writeFileSync(path.join(project, 'scripted.less'), '@plugin "./plugin.js";\n@import "linked/style.less";');

    const compiler = new Compiler();
    compilers.push(compiler);
    await expect(compiler.render(path.join(project, 'plain.less'), { suppressWarnings: true }))
      .resolves.toContain('.linked');
    await expect(compiler.render(path.join(project, 'scripted.less'), { suppressWarnings: true }))
      .rejects.toMatchObject({ code: 'import/not-found' });
  }, 60_000);
});
