import type { UserConfig } from 'tsdown';

type OutputOptions = Parameters<NonNullable<UserConfig['outputOptions']>>[0];
type ChunkFileNames = OutputOptions['chunkFileNames'];

/**
 * Keep shared chunks out of the entry filename namespace.
 *
 * tsdown resolves `chunkFileNames` to the same `[name]` pattern as
 * `entryFileNames` whenever `hash: false` is set, so a shared chunk carrying a
 * module that is *also* a declared entry wants the entry's own filename.
 * Rolldown breaks the tie by suffixing a digit, which is how a `grammar` entry
 * ended up beside a `grammar2` chunk holding the real compiled grammar.
 *
 * Entry filenames are public API — they are what each package's `exports` map
 * points at — so the chunk is what has to move. Emitting shared chunks into
 * their own directory makes the collision structurally impossible while
 * leaving the bundling strategy untouched; chunk filenames are internal, and
 * rolldown rewrites the importing entries to match.
 */
export function nestSharedChunks(chunkFileNames: ChunkFileNames): ChunkFileNames {
  if (typeof chunkFileNames === 'function') {
    return chunk => `chunks/${chunkFileNames(chunk)}`;
  }
  return `chunks/${chunkFileNames ?? '[name].js'}`;
}
