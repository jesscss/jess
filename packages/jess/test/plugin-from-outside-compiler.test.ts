import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * A package other than Jess (the `less` wrapper is one) subclasses the base
 * compiler and loads its plugins through plain Node, from either module
 * format. These drivers run outside vitest's source aliases, against the built
 * packages a consumer gets. The CSS does not depend on the route
 * (`docs/design/DENO-SANDBOX-COMPILE.md` §2).
 */
const FIXTURES = fileURLToPath(new URL('./fixtures/outside-compiler/', import.meta.url));

/* Math whose output depends on one copy of Jess's module state. Nothing here is a script, so only the route can change it. */
const SHEET = '@px: 14px; @em: 1.4em; @cm: 10cm;\n.u { a: ((@px + @em) + @cm); k: min((@px + @em), 3cm); }\n';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const projectWith = (firstLine: string): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jess-outside-compiler-')));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'plugin.js'), 'module.exports = { install() {} };');
  fs.writeFileSync(path.join(dir, 'entry.less'), `${firstLine}\n${SHEET}`);
  return path.join(dir, 'entry.less');
};

const run = (driver: string, entry: string, ...rest: string[]) =>
  spawnSync(process.execPath, [path.join(FIXTURES, driver), entry, ...rest], { encoding: 'utf8' });

const rendered = (driver: string, entry: string, ...rest: string[]): unknown => {
  const { status, stdout, stderr } = run(driver, entry, ...rest);
  expect(stderr).toBe('');
  expect(status).toBe(0);
  return JSON.parse(stdout);
};

describe('a compiler from outside the Jess packages', () => {
  it('renders the same CSS and warnings in Node and in the sandbox, from either module format', () => {
    const inNode = rendered('render.mjs', projectWith(''));
    expect(inNode).toEqual({
      css: '.u {\n  a: calc((14px + 1.4em) + 10cm);\n  k: min((14px + 1.4em), 3cm);\n}\n',
      errors: [],
      warnings: expect.arrayContaining([expect.stringContaining('eval/unexpressible-unit')])
    });
    const scripted = projectWith('@plugin "./plugin";');
    expect(rendered('render.mjs', scripted)).toEqual(inNode);
    expect(rendered('render.cjs', scripted)).toEqual(inNode);
    expect(rendered('render-jess.cjs', scripted)).toEqual(inNode);
  }, 60_000);

  it('makes a compiler recorded from a CommonJS build from the ES module beside it', () => {
    expect(rendered('render-build.mjs', projectWith('@plugin "./plugin";'))).toMatchObject({ css: expect.stringContaining('.u') });
  }, 60_000);

  it.each(['default', 'hidden'])('makes a plugin with no ES build from its `%s` export', (name) => {
    expect(rendered('render-factory.mjs', projectWith('@plugin "./plugin";'), name)).toMatchObject({ css: expect.stringContaining('.u') });
  }, 60_000);

  it.each(['constructor', 'data', 'missing'])('refuses a recorded factory `%s` that the module does not export as a function', (name) => {
    const { status, stderr } = run('render-factory.mjs', projectWith('@plugin "./plugin";'), name);
    expect(status).not.toBe(0);
    expect(stderr).toContain(`"${name}"`);
    expect(stderr).toContain('commonjs-only.cjs');
  }, 60_000);

  it('names the entry and what to pass when a plugin instance cannot cross into the sandbox', () => {
    const entry = projectWith('@plugin "./plugin";');
    const { status, stderr } = run('render-instance.mjs', entry);
    expect(status).not.toBe(0);
    expect(JSON.parse(stderr)).toEqual({
      code: 'plugin/engine-option',
      filename: entry,
      message: expect.stringContaining('is an instance of Instance, which the sandbox cannot make again')
    });
  }, 60_000);
});
