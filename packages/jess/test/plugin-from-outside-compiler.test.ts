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
 * packages a consumer gets.
 */
const FIXTURES = fileURLToPath(new URL('./fixtures/outside-compiler/', import.meta.url));

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const renderWith = (driver: string) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jess-outside-compiler-')));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'plugin.js'), 'module.exports = { install(less, manager, functions) { functions.add("answer", () => "42"); } };');
  fs.writeFileSync(path.join(dir, 'entry.less'), '@plugin "./plugin";\n.a { b: answer(); }\n');
  return spawnSync(process.execPath, [path.join(FIXTURES, driver), path.join(dir, 'entry.less')], { encoding: 'utf8' });
};

describe('a compiler subclass from outside the Jess packages', () => {
  it.each(['render.mjs', 'render.cjs'])('runs a real @plugin file in the sandbox from %s', (driver) => {
    const { status, stdout, stderr } = renderWith(driver);
    expect(stderr).toBe('');
    expect(status).toBe(0);
    expect(stdout).toBe('.a {\n  b: 42;\n}\n');
  }, 60_000);
});
