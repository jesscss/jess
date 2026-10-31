import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { governingPackageRoots, readRootsOf, readSetFor } from '../src/engine.js';

/*
 * The read root of a sandboxed render (ledger A19): of the folder its packages
 * really live in, the script root and the entry stylesheet's folder, the one
 * nearest the filesystem root.
 */
const dirs: string[] = [];
const tmp = () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jess-read-root-')));
  dirs.push(dir);
  return dir;
};
const write = (file: string, content = '') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

/** A pnpm workspace: `packages/app/node_modules/foo` links into the root `.pnpm` store. */
const pnpmWorkspace = () => {
  const ws = tmp();
  write(path.join(ws, 'package.json'), '{}');
  const store = path.join(ws, 'node_modules/.pnpm/foo@1.0.0/node_modules/foo');
  write(path.join(store, 'package.json'), '{"name":"foo"}');
  write(path.join(store, 'style.less'), '.foo { a: b }');
  const app = path.join(ws, 'packages/app');
  write(path.join(app, 'package.json'), '{}');
  fs.mkdirSync(path.join(app, 'node_modules'));
  fs.symlinkSync(path.relative(path.join(app, 'node_modules'), store), path.join(app, 'node_modules/foo'));
  return { ws, app };
};

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('the read root of a sandboxed render', () => {
  it('is the folder holding a plain node_modules', () => {
    const project = tmp();
    write(path.join(project, 'node_modules/pkg/package.json'), '{}');
    const styles = path.join(project, 'src/styles');
    fs.mkdirSync(styles, { recursive: true });
    expect(readRootsOf(styles, styles)).toEqual([project]);
  });

  it('follows a pnpm package link to the workspace root its store is in', () => {
    const { ws, app } = pnpmWorkspace();
    expect(governingPackageRoots(app)).toEqual([ws]);
    expect(readRootsOf(app, app)).toEqual([ws]);
  });

  it('is not widened by a stray node_modules above a project that has its own', () => {
    const home = tmp();
    write(path.join(home, 'node_modules/stray/package.json'), '{}');
    const project = path.join(home, 'project');
    write(path.join(project, 'node_modules/pkg/package.json'), '{}');
    write(path.join(project, 'main.less'));
    expect(readRootsOf(project, project)).toEqual([project]);
  });

  it('takes nothing from a linked package whose real path is in no node_modules', () => {
    const base = tmp();
    const checkout = path.join(base, 'checkout/pkg');
    write(path.join(checkout, 'package.json'), '{}');
    const project = path.join(base, 'project');
    fs.mkdirSync(path.join(project, 'node_modules'), { recursive: true });
    fs.symlinkSync(checkout, path.join(project, 'node_modules/linked'));
    expect(governingPackageRoots(project)).toEqual([]);
    expect(readRootsOf(project, project)).toEqual([project]);
  });

  it('keeps an entry beside the folder its packages live in as its own root', () => {
    const { ws } = pnpmWorkspace();
    const elsewhere = tmp();
    fs.symlinkSync(path.join(ws, 'packages/app/node_modules'), path.join(elsewhere, 'node_modules'));
    expect(readRootsOf(elsewhere, elsewhere)).toEqual([elsewhere, ws]);
  });

  it('lists a root in each spelling the render uses for it', () => {
    const real = tmp();
    const alias = path.join(tmp(), 'alias');
    fs.symlinkSync(real, alias);
    expect(readSetFor(alias, alias, [])).toEqual([real, alias]);
  });
});
