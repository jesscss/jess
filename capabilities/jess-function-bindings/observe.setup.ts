/*
 * Records the `functions` option every `emitJess` call in a consumer suite
 * receives, one JSON line per call, to `$COD_JESS_FUNCTIONS_OUT`. Loaded only by
 * this capability's `vitest.config.ts`, so ordinary runs never mock core. The
 * mock targets the file the consumers themselves load: `@jesscss/core` as
 * `packages/jess` resolves it.
 */
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, vi } from 'vitest';
import type * as Core from '@jesscss/core';

const coreDir = realpathSync(fileURLToPath(new URL('../../packages/jess/node_modules/@jesscss/core', import.meta.url)));
const coreEntry = join(coreDir, JSON.parse(readFileSync(join(coreDir, 'package.json'), 'utf8')).exports['.'].import);

vi.doMock(coreEntry, async (importOriginal) => {
  const core = await importOriginal<typeof Core>();
  const emitJess: typeof core.emitJess = (root, options) => {
    const functions = options?.functions;
    appendFileSync(process.env.COD_JESS_FUNCTIONS_OUT!, `${JSON.stringify({
      file: expect.getState().testPath,
      functions: functions && { from: functions.from, names: [...functions.names].sort(([a], [b]) => (a < b ? -1 : 1)) }
    })}\n`);
    return core.emitJess(root, options);
  };
  return { ...core, emitJess };
});
