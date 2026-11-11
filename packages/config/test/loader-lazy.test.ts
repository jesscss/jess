import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * cosmiconfig and picomatch load only when a compile needs them: a config file
 * to read, a glob `file` option to match. Each case runs in a fresh process,
 * where Node's module cache shows what loaded.
 */
const lib = fileURLToPath(new URL('../lib/index.js', import.meta.url));
const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'styles-config-lazy-'));
const project = path.join(parent, 'project');
const nested = path.join(project, 'src', 'deep');
fs.mkdirSync(nested, { recursive: true });
fs.writeFileSync(path.join(project, 'package.json'), '{"private":true}\n');

/** Runs `body` against the built package and reports the config it found and which of the two libraries loaded. */
const probe = (body: string): { config: unknown; cosmiconfig: boolean; picomatch: boolean } => {
  const script = `
    import { createRequire } from 'node:module';
    const config = await import(${JSON.stringify(lib)});
    const result = ${body};
    const loaded = Object.keys(createRequire(import.meta.url).cache);
    console.log(JSON.stringify({
      config: result,
      cosmiconfig: loaded.some(file => file.includes('/cosmiconfig/')),
      picomatch: loaded.some(file => file.includes('/picomatch/'))
    }));
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-'], { input: script, encoding: 'utf8' });
  expect(run.stderr).toBe('');
  const parsed: unknown = JSON.parse(run.stdout.trim());
  return {
    config: Reflect.get(Object(parsed), 'config'),
    cosmiconfig: Reflect.get(Object(parsed), 'cosmiconfig') === true,
    picomatch: Reflect.get(Object(parsed), 'picomatch') === true
  };
};

describe('styles-config loads its dependencies on demand', () => {
  afterAll(() => {
    fs.rmSync(parent, { recursive: true, force: true });
  });

  it('does not load cosmiconfig when no config file is there to read', () => {
    expect(probe(`config.loadConfigSync(${JSON.stringify(nested)})`)).toEqual({ config: {}, cosmiconfig: false, picomatch: false });
  });

  it('does not look above the package root', () => {
    fs.writeFileSync(path.join(parent, 'styles.config.cjs'), 'module.exports = { outside: true };\n');
    try {
      expect(probe(`config.loadConfigSync(${JSON.stringify(nested)})`).cosmiconfig).toBe(false);
    } finally {
      fs.rmSync(path.join(parent, 'styles.config.cjs'));
    }
  });

  it('loads cosmiconfig to read a config found above the start folder', () => {
    fs.writeFileSync(path.join(project, 'styles.config.cjs'), 'module.exports = { found: true };\n');
    try {
      expect(probe(`config.loadConfigSync(${JSON.stringify(nested)})`)).toMatchObject({ config: { found: true }, cosmiconfig: true, picomatch: false });
    } finally {
      fs.rmSync(path.join(project, 'styles.config.cjs'));
    }
  });

  it('loads picomatch only to match a glob', () => {
    const options = (file: string) => `config.getOptions({ input: [{ file: ${JSON.stringify(file)}, leakyScope: true }] }, { input: 'src/a.less' }).leakyScope ?? null`;
    expect(probe(options('a.less'))).toEqual({ config: true, cosmiconfig: false, picomatch: false });
    expect(probe(options('src/*.less'))).toEqual({ config: true, cosmiconfig: false, picomatch: true });
  });
});
