import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const lib = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lib/index.js');
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A package whose `.config/config.json` holds a `styles` key: cosmiconfig reads it as the config. */
const project = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'styles-meta-config-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.config'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"meta-config","private":true}\n');
  fs.writeFileSync(path.join(dir, '.config/config.json'), '{"styles":{"output":{"sourceMap":true}}}\n');
  return dir;
};

/*
 * A separate process with a time limit: a search that never ends cannot be
 * stopped from inside the test's own process.
 */
const loadIn = (cwd: string, call: string): { status: number | null; config: unknown } => {
  const script = `
    const config = await import(${JSON.stringify(lib)});
    console.log(JSON.stringify(await ${call}));
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-'], { input: script, encoding: 'utf8', cwd, timeout: 10_000 });
  return { status: run.status, config: run.status === 0 ? JSON.parse(run.stdout.trim()) : undefined };
};

describe('a styles key in the meta-config', () => {
  it('is loaded once by loadConfigSync', () => {
    const { status, config } = loadIn(project(), 'config.loadConfigSync()');
    expect(status).toBe(0);
    expect(config).toMatchObject({ output: { sourceMap: true } });
  });

  it('is loaded once by loadConfig', () => {
    const { status, config } = loadIn(project(), 'config.loadConfig()');
    expect(status).toBe(0);
    expect(config).toMatchObject({ output: { sourceMap: true } });
  });
});
