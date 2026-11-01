import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { packageInstalled, prewarmWhenInstalled } from '../src/sandbox-route.js';

/*
 * The engine is started ahead of time only where the script plugin is
 * installed; elsewhere nothing but an asynchronous look for it happens.
 */
describe('starting the engine ahead of time', () => {
  const project = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-prewarm-route-'));
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    return root;
  };

  it('finds a package installed above a file or a file: URL, and only then', async () => {
    const root = project();
    const entry = path.join(root, 'src', 'main.less');
    await expect(packageInstalled('@scope/pkg', [entry])).resolves.toBe(false);
    fs.mkdirSync(path.join(root, 'node_modules', '@scope', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', '@scope', 'pkg', 'package.json'), '{}');
    await expect(packageInstalled('@scope/pkg', [entry])).resolves.toBe(true);
    await expect(packageInstalled('@scope/pkg', [undefined, pathToFileURL(entry)])).resolves.toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('starts nothing where the package is missing, or once let go', async () => {
    let starts = 0;
    const start = () => {
      starts++;
      return () => undefined;
    };
    prewarmWhenInstalled(Promise.resolve(false), start);
    prewarmWhenInstalled(Promise.resolve(true), start)();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(starts).toBe(0);
    prewarmWhenInstalled(Promise.resolve(true), start);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(starts).toBe(1);
  });
});
