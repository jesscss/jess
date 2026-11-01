import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fromEngine, packageInstalled, prewarmWhenInstalled } from '../src/sandbox-route.js';

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

/* Ledger A19: the engine never names a path the host writes. */
describe('a conversion the engine returns', () => {
  const result = (files: unknown) => ({ css: null, errors: [], warnings: [], files });
  const project = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-conversion-route-'));
    for (const name of ['a.less', 'b.scss', 'c.jess']) {
      fs.writeFileSync(path.join(root, name), '');
    }
    return root;
  };

  it('derives each `jessPath` from its source and ignores the one the engine sent', () => {
    const root = project();
    const { files } = fromEngine.conversion(result([
      { source: path.join(root, 'a.less'), jessPath: '/etc/cron.d/evil.jess', jess: '.a { w: 1 }' },
      { source: path.join(root, 'b.scss'), jessPath: '../../outside.jess', gaps: [{ nodeType: 'StyleImport', reason: 'r' }] }
    ]));
    expect(files.map(file => file.jessPath)).toEqual([path.join(root, 'a.jess'), path.join(root, 'b.jess')]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('refuses a source that is not a stylesheet on this host, and a malformed body', () => {
    const root = project();
    const at = path.join(root, 'a.less');
    for (const entry of [
      { jessPath: at, jess: '' },
      { source: 'a.less', jess: '' },
      { source: path.join(root, 'c.jess'), jess: '' },
      { source: path.join(root, '..', 'elsewhere', 'x.less'), jess: '' },
      { source: at },
      { source: at, gaps: [{ nodeType: 1, reason: 'r' }] },
      null
    ]) {
      expect(() => fromEngine.conversion(result([entry]))).toThrow(/compile engine/);
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
});
