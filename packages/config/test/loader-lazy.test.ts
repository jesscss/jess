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
const probe = (body: string, cwd?: string): { config: unknown; cosmiconfig: boolean; picomatch: boolean } => {
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
  const run = spawnSync(process.execPath, ['--input-type=module', '-'], { input: script, encoding: 'utf8', cwd });
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

  /*
   * cosmiconfig reads a meta-config in the working directory, which can add
   * search places: with one there, it loads, and its search finds what
   * cosmiconfig's own search finds.
   */
  it('loads cosmiconfig when a .config/config.* meta-config is in the working directory', () => {
    const dir = path.join(parent, 'meta-file');
    fs.mkdirSync(path.join(dir, '.config'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), '{"private":true}\n');
    fs.writeFileSync(path.join(dir, '.config', 'config.json'), '{"cosmiconfig":{"searchPlaces":["styles.json"]}}\n');
    fs.writeFileSync(path.join(dir, 'src', 'styles.json'), '{"output":{"sourceMap":true}}\n');
    expect(probe(`config.loadConfigSync(${JSON.stringify(path.join(dir, 'src', 'deep'))})`, dir))
      .toMatchObject({ config: { output: { sourceMap: true } }, cosmiconfig: true });
  });

  it('loads cosmiconfig when the working directory\'s package.json has a cosmiconfig key', () => {
    const dir = path.join(parent, 'meta-key');
    fs.mkdirSync(path.join(dir, 'src', 'deep'), { recursive: true });

    /* cosmiconfig 9 reads the `cosmiconfig` key of a package.json twice over, so its options sit one level deeper. */
    fs.writeFileSync(path.join(dir, 'package.json'), '{"private":true,"cosmiconfig":{"cosmiconfig":{"searchPlaces":["styles.json"]}}}\n');
    fs.writeFileSync(path.join(dir, 'src', 'styles.json'), '{"output":{"sourceMap":true}}\n');
    expect(probe(`config.loadConfigSync(${JSON.stringify(path.join(dir, 'src', 'deep'))})`, dir))
      .toMatchObject({ config: { output: { sourceMap: true } }, cosmiconfig: true });
  });

  it('loads picomatch only when an exact or basename match fails', () => {
    const options = (file: string) => `config.getOptions({ input: [{ file: ${JSON.stringify(file)}, leakyScope: true }] }, { input: 'src/a.less' }).leakyScope ?? null`;
    expect(probe(options('a.less'))).toEqual({ config: true, cosmiconfig: false, picomatch: false });
    expect(probe(options('src/*.less'))).toEqual({ config: true, cosmiconfig: false, picomatch: true });
  });
});
