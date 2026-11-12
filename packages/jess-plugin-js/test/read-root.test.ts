import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { governingPackageRoots, readRootsBelowUnreadableFolders, readRootsOf, readSetFor } from '../src/engine.js';

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
  it('is the folder holding a plain node_modules', async () => {
    const project = tmp();
    write(path.join(project, 'node_modules/pkg/package.json'), '{}');
    const styles = path.join(project, 'src/styles');
    fs.mkdirSync(styles, { recursive: true });
    expect(readRootsOf(styles, styles)).toEqual([project]);
  });

  it('follows a pnpm package link to the workspace root its store is in', async () => {
    const { ws, app } = pnpmWorkspace();
    expect(governingPackageRoots(app)).toEqual([ws]);
    expect(readRootsOf(app, app)).toEqual([ws]);
  });

  it('is not widened by a stray node_modules above a project that has its own', async () => {
    const home = tmp();
    write(path.join(home, 'node_modules/stray/package.json'), '{}');
    const project = path.join(home, 'project');
    write(path.join(project, 'node_modules/pkg/package.json'), '{}');
    write(path.join(project, 'main.less'));
    expect(readRootsOf(project, project)).toEqual([project]);
  });

  it('takes nothing from a linked package whose real path is in no node_modules', async () => {
    const base = tmp();
    const checkout = path.join(base, 'checkout/pkg');
    write(path.join(checkout, 'package.json'), '{}');
    const project = path.join(base, 'project');
    fs.mkdirSync(path.join(project, 'node_modules'), { recursive: true });
    fs.symlinkSync(checkout, path.join(project, 'node_modules/linked'));
    expect(governingPackageRoots(project)).toEqual([]);
    expect(readRootsOf(project, project)).toEqual([project]);
  });

  it('keeps an entry beside the folder its packages live in as its own root', async () => {
    const { ws } = pnpmWorkspace();
    const elsewhere = tmp();
    fs.symlinkSync(path.join(ws, 'packages/app/node_modules'), path.join(elsewhere, 'node_modules'));
    expect(readRootsOf(elsewhere, elsewhere)).toEqual([elsewhere, ws]);
  });

  it('lists a root in each spelling the render uses for it', async () => {
    const real = tmp();
    const alias = path.join(tmp(), 'alias');
    fs.symlinkSync(real, alias);
    expect(readSetFor(alias, alias, [])).toEqual([real, alias]);
  });
});

/*
 * The asynchronous discovery the synchronous one replaced, kept as the
 * reference: both must find the same read set for the same tree.
 */
const reference = (() => {
  const realpathAsync = (p: string) => fs.promises.realpath(p).catch((): undefined => undefined);
  const isInside = (child: string, parent: string) => {
    const rel = path.relative(parent, child);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };
  const outermostNodeModules = (realPath: string) => {
    let found: string | undefined;
    for (let dir = path.dirname(realPath); path.dirname(dir) !== dir; dir = path.dirname(dir)) {
      if (path.basename(dir) === 'node_modules') {
        found = dir;
      }
    }
    return found;
  };
  const packageEntries = async (nodeModules: string) => {
    const names = await fs.promises.readdir(nodeModules).catch((): string[] => []);
    const lists = await Promise.all(names.filter(name => !name.startsWith('.')).map(async (name) => {
      const full = path.join(nodeModules, name);
      if (!name.startsWith('@')) {
        return [full];
      }
      const scoped = await fs.promises.readdir(full).catch((): string[] => []);
      return scoped.map(entry => path.join(full, entry));
    }));
    return lists.flat();
  };
  const governing = async (entryDir: string): Promise<string[]> => {
    for (let dir = path.resolve(entryDir); ; dir = path.dirname(dir)) {
      const nodeModules = path.join(dir, 'node_modules');
      if (fs.existsSync(nodeModules)) {
        const reals = await Promise.all((await packageEntries(nodeModules)).map(realpathAsync));
        const outers = reals.map(real => (real === undefined ? undefined : outermostNodeModules(real)));
        return [...new Set(outers.filter((outer): outer is string => outer !== undefined).map(outer => path.dirname(outer)))];
      }
      if (path.dirname(dir) === dir) {
        return [];
      }
    }
  };
  const roots = async (entryDir: string, jsReadRoot: string) => {
    const canonical = async (dir: string) => (await realpathAsync(dir)) ?? path.resolve(dir);
    const candidates = [await canonical(entryDir), await canonical(jsReadRoot), ...await governing(entryDir)];
    return candidates.filter((dir, index) =>
      !candidates.some((other, at) => at !== index && isInside(dir, other) && (dir !== other || at < index)));
  };
  const spellings = async (entryDir: string, jsReadRoot: string) => {
    const found = await roots(entryDir, jsReadRoot);
    const all = new Set(found);
    for (const written of [path.resolve(entryDir), path.resolve(jsReadRoot)]) {
      const ancestors: string[] = [];
      for (let dir = written; ; dir = path.dirname(dir)) {
        ancestors.push(dir);
        if (path.dirname(dir) === dir) {
          break;
        }
      }
      const reals = await Promise.all(ancestors.map(realpathAsync));
      ancestors.forEach((dir, at) => {
        const real = reals[at];
        if (real !== undefined && real !== dir && found.includes(real)) {
          all.add(dir);
        }
      });
    }
    return [...all];
  };
  return {
    governing,
    readSet: async (entryDir: string, jsReadRoot: string, code: readonly string[]) => {
      const all = await spellings(entryDir, jsReadRoot);
      return [...all, ...code.filter(dir => !all.some(root => isInside(dir, root)))];
    },
    below: async (entryDir: string, jsReadRoot: string) => {
      const all = await spellings(entryDir, jsReadRoot);
      return all.filter((root) => {
        const parent = path.dirname(root);
        return parent !== root && !all.some(other => isInside(parent, other));
      });
    }
  };
})();

describe('the synchronous read-root discovery', () => {
  const expectSameAsReference = async (entryDir: string, jsReadRoot = entryDir, code: readonly string[] = []) => {
    expect(governingPackageRoots(entryDir)).toEqual(await reference.governing(entryDir));
    expect(readSetFor(entryDir, jsReadRoot, code)).toEqual(await reference.readSet(entryDir, jsReadRoot, code));
    expect(readRootsBelowUnreadableFolders(entryDir, jsReadRoot)).toEqual(await reference.below(entryDir, jsReadRoot));
  };

  it('finds the same read set as the asynchronous one for npm, pnpm, scoped, linked and aliased packages', async () => {
    const { ws, app } = pnpmWorkspace();
    const scopedStore = path.join(ws, 'node_modules/.pnpm/@s+bar@1.0.0/node_modules/@s/bar');
    write(path.join(scopedStore, 'package.json'), '{}');
    fs.mkdirSync(path.join(app, 'node_modules/@s'));
    fs.symlinkSync(scopedStore, path.join(app, 'node_modules/@s/bar'));
    write(path.join(app, 'node_modules/@s/plain/package.json'), '{}');
    fs.symlinkSync(path.join(ws, 'nowhere'), path.join(app, 'node_modules/broken'));
    const checkout = path.join(tmp(), 'checkout/pkg');
    write(path.join(checkout, 'package.json'), '{}');
    fs.symlinkSync(checkout, path.join(app, 'node_modules/linked'));
    const scopeLinked = tmp();
    write(path.join(scopeLinked, 'node_modules/real-scope/one/package.json'), '{}');
    fs.symlinkSync(path.join(scopeLinked, 'node_modules/real-scope'), path.join(scopeLinked, 'node_modules/@linked'));
    const npm = tmp();
    write(path.join(npm, 'node_modules/pkg/package.json'), '{}');
    write(path.join(npm, 'node_modules/@scope/pkg/package.json'), '{}');
    const alias = path.join(tmp(), 'alias');
    fs.symlinkSync(app, alias);
    const npmAlias = path.join(tmp(), 'npm-alias');
    fs.symlinkSync(npm, npmAlias);
    const elsewhere = tmp();
    fs.symlinkSync(path.join(app, 'node_modules'), path.join(elsewhere, 'node_modules'));
    const styles = path.join(app, 'src/styles');
    fs.mkdirSync(styles, { recursive: true });

    await expectSameAsReference(app);
    await expectSameAsReference(styles, app, [checkout, path.join(ws, 'packages')]);
    await expectSameAsReference(scopeLinked);
    await expectSameAsReference(npm);
    await expectSameAsReference(alias);
    await expectSameAsReference(path.join(alias, 'src/styles'), alias);
    await expectSameAsReference(npmAlias);
    await expectSameAsReference(path.join(npmAlias, 'node_modules/pkg'), npmAlias);
    await expectSameAsReference(elsewhere);
    await expectSameAsReference(path.join(tmp(), 'missing'));
  });

  it('finds the same read set as the asynchronous one through a linked ancestor of the temp folder', async () => {
    const written = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-read-root-written-'));
    dirs.push(written);
    write(path.join(written, 'node_modules/pkg/package.json'), '{}');
    const styles = path.join(written, 'src/styles');
    fs.mkdirSync(styles, { recursive: true });
    await expectSameAsReference(written);
    await expectSameAsReference(styles, written);
    const real = fs.realpathSync(written);
    expect(readSetFor(styles, written, [])).toEqual(real === written ? [written] : [real, written]);
  });

  /*
   * The one tree where the two differ: a `node_modules` that can be listed but
   * not entered. The asynchronous discovery could not take a real path inside it
   * and fell back to the entry folder; the synchronous one needs no lookup inside
   * it for an entry that is not a link, so it finds the folder holding it, the
   * read root of ledger A19 (§8.2 of the sandbox design).
   */
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('takes the folder holding a node_modules that can be listed but not entered', async () => {
    const project = tmp();
    write(path.join(project, 'node_modules/pkg/package.json'), '{}');
    const styles = path.join(project, 'src/styles');
    fs.mkdirSync(styles, { recursive: true });
    fs.chmodSync(path.join(project, 'node_modules'), 0o644);
    try {
      expect(readRootsOf(styles, styles)).toEqual([project]);
      expect(await reference.readSet(styles, styles, [])).toEqual([styles]);
    } finally {
      fs.chmodSync(path.join(project, 'node_modules'), 0o755);
    }
  });

  it('finds the same read set as the asynchronous one in this workspace', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    await expectSameAsReference(here);
    await expectSameAsReference(path.resolve(here, '../../..'), here);
  });
});
