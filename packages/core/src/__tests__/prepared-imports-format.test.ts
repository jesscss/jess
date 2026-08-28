import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { decl, keyword, quoted, rule, styleImport, stylesheet } from '../ast/nodes.js';

const requireFromTest = createRequire(import.meta.url);

/*
 * This suite exercises the PACKAGED bundle (built `lib/`), not the source graph
 * the rest of the suite runs against through vitest's src alias. Skip it when
 * `lib/` is absent — e.g. a fresh worktree before `pnpm run build` — so a missing
 * bundle reports as a clear skip instead of a cryptic MODULE_NOT_FOUND. CI (which
 * builds) still runs it at full strength.
 */
const libBuilt = existsSync(new URL('../../lib/index.cjs', import.meta.url));
const describeBundle = libBuilt ? describe : describe.skip;

describeBundle('PreparedImports package boundary', () => {
  it('reuses a CJS-prepared graph through the ESM serializer', async () => {
    const cjs = requireFromTest('../../lib/index.cjs') as typeof import('../index.js');
    const esm = await import(new URL('../../lib/index.js', import.meta.url).href) as typeof import('../index.js');
    const imported = stylesheet([rule('.imported', [decl('color', keyword('blue'))])]);
    const root = stylesheet([
      styleImport('@import', quoted('"library.less"', 'library.less', '"', false)),
      rule('.entry', [decl('color', keyword('red'))])
    ]);
    const importDocument = vi.fn(() => ({ document: imported, key: 'library.less' }));
    const preparedImports = await Promise.resolve(cjs.prepareStaticImports(root, { importDocument }));

    await expect(Promise.resolve(esm.serialize(root, { importDocument, preparedImports }))).resolves.toEqual({
      css: '.imported {\n  color: blue;\n}\n.entry {\n  color: red;\n}\n'
    });
    expect(importDocument).toHaveBeenCalledTimes(1);
  });
});
