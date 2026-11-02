import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * The first render in a process starts the Deno engine ahead of time, so its
 * start overlaps the render in Node (docs/design/DENO-SANDBOX-COMPILE.md §2).
 * A render that never reaches a script lets it go. Each case runs in a fresh
 * process on the BUILT libs, since the ahead-of-time start happens once per
 * process; skipped before a build.
 */
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const builtLibsPresent = fs.existsSync(path.join(repoRoot, 'packages/jess/lib/index.js'));

/** Runs `body` after a render of `source`, in a fresh process; prints one JSON line. */
const runRender = (source: string, body: string) => spawnSync(process.execPath, ['--input-type=module', '--eval', [
  'import fs from "node:fs";',
  'import os from "node:os";',
  'import path from "node:path";',
  'import { execFileSync } from "node:child_process";',
  'import { Compiler } from "./packages/jess/lib/index.js";',
  'const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jess-prewarm-")));',
  'fs.writeFileSync(path.join(root, "plugin.js"), "module.exports = { install(less, m, functions) { functions.add(\\"probe\\", () => new less.tree.Keyword(\\"ok\\")); } };");',
  `fs.writeFileSync(path.join(root, "main.less"), ${JSON.stringify(source)});`,
  'const compiler = new Compiler();',
  'const css = await compiler.render(path.join(root, "main.less"), { suppressWarnings: true });',
  '/* Child processes of this one whose command is the Deno engine. */',
  'const engines = () => execFileSync("ps", ["-A", "-o", "ppid=,command="], { encoding: "utf8" })',
  '  .split("\\n").filter(line => line.trim().startsWith(`${process.pid} `) && line.includes("runtime-worker")).length;',
  body,
  'compiler.dispose();',
  'fs.rmSync(root, { recursive: true, force: true });'
].join('\n')], { cwd: repoRoot, encoding: 'utf8', timeout: 60_000 });

describe('the engine started ahead of a render', () => {
  it.skipIf(!builtLibsPresent || process.platform === 'win32')('is let go when the render loads no script', () => {
    const run = runRender('.a { b: c; }', [
      'await new Promise(resolve => setTimeout(resolve, 500));',
      'console.log(JSON.stringify({ css, engines: engines() }));'
    ].join('\n'));
    expect(run.status, run.stderr).toBe(0);
    const out = JSON.parse(run.stdout.trim().split('\n').at(-1)!);
    expect(out.css).toContain('b: c');
    expect(out.engines).toBe(0);
  }, 70_000);

  it.skipIf(!builtLibsPresent || process.platform === 'win32')('runs the render that reaches a script, in one engine', () => {
    const run = runRender('@plugin "./plugin.js";\n.a { b: probe(); }', 'console.log(JSON.stringify({ css, engines: engines() }));');
    expect(run.status, run.stderr).toBe(0);
    const out = JSON.parse(run.stdout.trim().split('\n').at(-1)!);
    expect(out.css).toContain('b: ok');
    expect(out.engines).toBe(1);
  }, 70_000);

  /*
   * The compiler loads the script plugin only from its own install, so the
   * ahead-of-time start looks there too: a `@jesscss/plugin-js` beside the
   * stylesheet, but not beside the compiler, is neither loaded nor started.
   */
  it.skipIf(!builtLibsPresent || process.platform === 'win32')('is not started from a script plugin beside the stylesheet only', () => {
    const run = spawnSync(process.execPath, ['--input-type=module', '--eval', [
      'import fs from "node:fs";',
      'import os from "node:os";',
      'import path from "node:path";',
      'import { pathToFileURL } from "node:url";',
      'import { DefaultCompiler } from "./packages/compiler-preset/lib/index.js";',
      'const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jess-prewarm-beside-")));',
      'const home = path.join(root, "compiler-home");',
      'fs.mkdirSync(home);',
      'const shipped = path.join(root, "project/node_modules/@jesscss/plugin-js");',
      'fs.mkdirSync(shipped, { recursive: true });',
      'fs.writeFileSync(path.join(shipped, "package.json"), JSON.stringify({ name: "@jesscss/plugin-js", type: "module", exports: { ".": "./index.js", "./package.json": "./package.json" } }));',
      'const marker = path.join(root, "loaded.txt");',
      'fs.writeFileSync(path.join(shipped, "index.js"), `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, "loaded"); export default () => ({ name: "js", supportedExtensions: [".js"], renderInEngine() {}, prewarmEngine() { fs.writeFileSync(${JSON.stringify(marker)}, "started"); } });`);',
      'const entry = path.join(root, "project/main.less");',
      'fs.writeFileSync(entry, ".a { b: c; }");',
      'const compiler = new DefaultCompiler(undefined, pathToFileURL(path.join(home, "index.js")).href);',
      'const css = await compiler.render(entry, { suppressWarnings: true });',
      'await new Promise(resolve => setTimeout(resolve, 500));',
      'console.log(JSON.stringify({ css, shipped: fs.existsSync(marker) ? fs.readFileSync(marker, "utf8") : "untouched" }));',
      'compiler.dispose();',
      'fs.rmSync(root, { recursive: true, force: true });'
    ].join('\n')], { cwd: repoRoot, encoding: 'utf8', timeout: 60_000 });
    expect(run.status, run.stderr).toBe(0);
    const out = JSON.parse(run.stdout.trim().split('\n').at(-1)!);
    expect(out.css).toContain('b: c');
    expect(out.shipped).toBe('untouched');
  }, 70_000);
});
