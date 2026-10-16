import { describe, it, expect } from 'vitest';
import { Context } from '../src/context.js';
import { AbstractPlugin } from '../src/plugin.js';
import { stylesheet } from '../src/ast/nodes.js';

/**
 * A relative `@import` resolves against the importing document's directory
 * (its `file.path`), NOT `process.cwd()`. `_getPath` reads that directory from
 * the active document, so the document has to be active when the import is
 * resolved.
 */

/** Parses any `.less` source to an empty stylesheet and records the base directory `_getPath` resolves against. */
class CapturingPlugin extends AbstractPlugin {
  name = 'capture';
  supportedExtensions = ['.less'];
  seenDir: string | undefined;

  safeParse() {
    return { document: stylesheet([]), errors: [], warnings: [] };
  }

  override locate(_paths: string[], currentDir: string) {
    this.seenDir = currentDir;

    // Return a resolved path so `_getPath` doesn't throw before we can assert.
    return '/resolved/tokens.less';
  }
}

describe('import base dir resolution', () => {
  const fileDir = '/project/src';

  /*
   * We only care about the base dir `_getPath` passes to `locate`; that fires
   * before `getTree` reads the (nonexistent) resolved file. Swallow the later throw.
   */
  const resolveTokens = (context: Context) => context.getTree('tokens').catch(() => undefined);

  it('uses the active document\'s file.path', async () => {
    const plugin = new CapturingPlugin();
    const context = new Context({}, [plugin]);
    const { node } = await context.parseString('', { filePath: `${fileDir}/entry.less` });

    await context.withDocument(node, () => resolveTokens(context));

    expect(plugin.seenDir).toBe(fileDir);
  });

  it('falls back to process.cwd() when no document is active', async () => {
    const plugin = new CapturingPlugin();
    const context = new Context({}, [plugin]);
    await context.parseString('', { filePath: `${fileDir}/entry.less` });

    await resolveTokens(context);

    expect(plugin.seenDir).toBe(process.cwd());
  });
});
