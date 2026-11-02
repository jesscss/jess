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

/*
 * Ledger A19: a conversion from the engine names only the `.jess` sibling of a
 * stylesheet inside the read roots the host computed for the render.
 */
describe('a conversion the engine returns', () => {
  const result = (files: unknown) => ({ css: null, errors: [], warnings: [], files });
  const project = () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jess-conversion-route-')));
    const proj = path.join(base, 'proj');
    const other = path.join(base, 'other');
    fs.mkdirSync(proj);
    fs.mkdirSync(other);
    for (const file of ['a.less', 'b.scss', 'c.css', 'c.jess', 'd.less', 'package.json']) {
      fs.writeFileSync(path.join(proj, file), '');
    }
    fs.writeFileSync(path.join(other, 'theme.less'), '');
    fs.symlinkSync(path.join(other, 'theme.less'), path.join(proj, 'link.less'));
    fs.symlinkSync(other, path.join(proj, 'dirlink'), 'dir');
    fs.symlinkSync(path.join(other, 'theme.less'), path.join(proj, 'd.jess'));
    fs.mkdirSync(path.join(proj, 'adir.less'));
    return { base, proj, other };
  };

  it('derives each `jessPath` from its source and ignores the one the engine sent', () => {
    const { base, proj } = project();
    const { files } = fromEngine.conversion(result([
      { source: path.join(proj, 'a.less'), jessPath: '/etc/cron.d/evil.jess', jess: '.a { w: 1 }' },
      { source: path.join(proj, 'b.scss'), jessPath: '../../outside.jess', gaps: [{ nodeType: 'StyleImport', reason: 'r' }] },
      { source: path.join(proj, 'c.css'), jess: '' }
    ]), [proj]);
    expect(files.map(file => file.jessPath)).toEqual([path.join(proj, 'a.jess'), path.join(proj, 'b.jess'), path.join(proj, 'c.jess')]);
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('refuses a source outside the read roots, through a symlink or `..`, or not a stylesheet, and a malformed body', () => {
    const { base, proj, other } = project();
    const forged = {
      otherProject: path.join(other, 'theme.less'),
      packageJson: path.join(proj, 'package.json'),
      homeRc: path.join(os.homedir(), '.zshrc'),
      symlink: path.join(proj, 'link.less'),
      throughDirLink: path.join(proj, 'dirlink', 'theme.less'),
      dotdot: path.join(proj, '..', 'other', 'theme.less'),
      directory: path.join(proj, 'adir.less'),
      noExtension: path.join(proj, 'dirlink'),
      jessSource: path.join(proj, 'c.jess'),
      missing: path.join(proj, 'none.less'),
      relative: 'a.less',
      symlinkedJessPath: path.join(proj, 'd.less')
    };
    for (const [name, source] of Object.entries(forged)) {
      expect(() => fromEngine.conversion(result([{ source, jess: 'EVIL' }]), [proj]), name).toThrow(/compile engine/);
    }
    for (const entry of [{ jess: '' }, { source: path.join(proj, 'a.less') }, { source: path.join(proj, 'a.less'), gaps: [{ nodeType: 1, reason: 'r' }] }, null]) {
      expect(() => fromEngine.conversion(result([entry]), [proj])).toThrow(/compile engine/);
    }
    fs.rmSync(base, { recursive: true, force: true });
  });
});
