import { afterEach, describe, expect, it } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { prepareConfigsFor } from '../src/config.js';

/*
 * In the script sandbox, the config chain above a read root is decoded when a
 * file first needs it (`prepareConfigsFor`). Two files that need one chain at
 * the same time share one decode: decoding runs recorded plugin factories.
 */
const HOST_CONFIGS = Symbol.for('@jesscss/compiler/host-configs');

afterEach(() => {
  Reflect.deleteProperty(globalThis, HOST_CONFIGS);
});

describe('prepareConfigsFor', () => {
  it('decodes a chain once for files that need it at the same time', async () => {
    /* A folder that does not exist reads as one the sandbox may not read: the search leaves the read root there. */
    const unreadable = path.join(os.tmpdir(), `jess-unreadable-${process.pid}-${Date.now()}`);
    let decodes = 0;
    const decoded = new Map<string, unknown>();
    Reflect.set(globalThis, HOST_CONFIGS, {
      folders: {},
      above: { [unreadable]: { config: {}, configFilePaths: [] } },
      decoded,
      decode: async (encoded: unknown) => {
        decodes++;
        await new Promise(resolve => setTimeout(resolve, 20));
        return encoded;
      }
    });
    await Promise.all([prepareConfigsFor(unreadable), prepareConfigsFor(unreadable)]);
    expect(decodes).toBe(1);
    expect(decoded.has(unreadable)).toBe(true);
  });
});
