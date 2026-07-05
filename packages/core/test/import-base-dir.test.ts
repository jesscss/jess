import { describe, it, expect } from 'vitest';
import { Context, TreeContext } from '../src/context.js';
import { AbstractPlugin } from '../src/plugin.js';
import { rules } from '../src/index.js';

/**
 * Repro for Cluster B: relative `@import` base dir must come from the importing
 * file's directory (the root `Rules`'s `_treeContext.file.path`), NOT `process.cwd()`.
 *
 * The functional Less parser is context-free, so the plugin (`LessPlugin.safeParse`)
 * must attach its file-bearing `TreeContext` to the parsed root `Rules`. When it does,
 * `_setupContextForRules` propagates it to `context.treeContext`, and `_getPath` resolves
 * `currentDirectory = treeContext.file.path`. Without it, resolution falls back to cwd.
 */

/** A locate plugin that records the base directory `_getPath` resolves against. */
class CapturingPlugin extends AbstractPlugin {
  name = 'capture';
  supportedExtensions = ['.less'];
  seenDir: string | undefined;

  override locate(_paths: string[], currentDir: string) {
    this.seenDir = currentDir;
    // Return a resolved path so `_getPath` doesn't throw before we can assert.
    return '/resolved/tokens.less';
  }
}

describe('import base dir resolution', () => {
  const fileDir = '/project/src';

  function driveGetPath(root: ReturnType<typeof rules>) {
    const plugin = new CapturingPlugin();
    const context = new Context({}, [plugin]);
    // Mirror `_setupContextForRules`: a root Rules carrying a treeContext
    // establishes the eval-time treeContext.
    if (root._treeContext) {
      context.treeContext = root._treeContext;
    }
    // We only care about the base dir `_getPath` passes to `locate`; that fires
    // before `getTree` reads the (nonexistent) resolved file. Swallow the later throw.
    return { plugin, promise: context.getTree('tokens').catch(() => undefined) };
  }

  it('uses file.path when the root Rules carries a file-bearing treeContext', async () => {
    const root = rules([]);
    root._treeContext = new TreeContext({
      file: { name: 'entry.less', path: fileDir, fullPath: `${fileDir}/entry.less`, source: '' }
    });

    const { plugin, promise } = driveGetPath(root);
    await promise;

    expect(plugin.seenDir).toBe(fileDir);
  });

  it('falls back to process.cwd() when the root Rules has no treeContext', async () => {
    const root = rules([]);
    expect(root._treeContext).toBeUndefined();

    const { plugin, promise } = driveGetPath(root);
    await promise;

    expect(plugin.seenDir).toBe(process.cwd());
  });
});
