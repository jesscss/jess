/**
 * Import-resolving oracle (TEST-ONLY helper, outside the tree2 boundary).
 *
 * The `renderRealOracle` in `../oracle.ts` renders a PRE-PARSED tree with a bare
 * Context — it has no file manager / source getter, so it does NOT resolve
 * `@import`. Import fixtures therefore need the FULL jess import path as their
 * oracle: the `jess` Compiler with the Less plugin, which resolves + inlines
 * imports from disk exactly as production does. This lives under `__tests__/`
 * (excluded from the core build), so importing the `jess` app from here never
 * pollutes core's build graph. Vitest aliases every workspace package to its
 * `src`, so the import resolves to source.
 */

import { Compiler } from 'jess';
import lessPlugin from '@jesscss/plugin-less';
// `@jesscss/plugin-less-compat` has no root-tsconfig path mapping (unlike the
// other workspace packages), so import its BUILT lib by relative path — a real
// file tsc and vitest both resolve. The compat plugin matches Less-4.x output
// framing (without it the render gains a spurious leading newline), so it is
// part of the faithful import oracle.
import { lessCompatPlugin } from '../../../../../jess-plugin-less-compat/lib/index.js';

/** Render a `.less` FILE (resolving its imports from disk) — the import oracle. */
export async function renderImportOracle(file: string): Promise<string> {
  const compiler = new Compiler({
    output: { collapseNesting: true },
    compile: { plugins: [lessPlugin(), lessCompatPlugin()] },
  });
  return await compiler.render(file);
}
