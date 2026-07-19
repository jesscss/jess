/**
 * The default filesystem-backed {@link FnIo} handed to the IO built-ins
 * (`data-uri`/`image-size`/`image-width`/`image-height`) during a whole-document
 * render. It is the HOST half of the injected file-read seam: it owns path
 * resolution POLICY (resolve a specifier against the source file's directory, then
 * the process cwd) and reads the bytes synchronously; the fn bodies own everything
 * else (mime/charset decision, base64/percent encoding, image-header parsing).
 *
 * This lives in `parse-host/` (the front-end layer that is already allowed to touch
 * `node:fs` — the same category as import resolution), NOT under the value engine:
 * `serialize`/`evaluator` only ever see the abstract `FnIo` interface, so the value
 * domain keeps its clean, fs-free boundary and the capability stays injected rather
 * than global.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FnIo } from '../functions/types.js';

/**
 * Build an `FnIo` that resolves specifiers relative to `filePath`'s directory (the
 * render's source file), then against each configured include-path search dir
 * (Less's `paths` option — `data-uri`/`image-*` honour `paths` exactly like
 * `@import`), falling back to the process cwd. A relative search dir is resolved
 * against the source file's directory, matching import resolution + the legacy
 * resolver. `readFile` returns the file's raw bytes, or `null` when the specifier
 * resolves to nothing readable — the signal an IO fn uses to degrade gracefully
 * (a `url()` / verbatim fallback).
 */
export function createFsFnIo(filePath?: string, searchDirs?: readonly string[]): FnIo {
  const baseDir = filePath ? path.dirname(filePath) : process.cwd();
  const searchBases = (searchDirs ?? []).map(dir =>
    path.isAbsolute(dir) ? dir : path.resolve(baseDir, dir),
  );
  return {
    readFile(specifier: string): Uint8Array | null {
      // Source-file dir FIRST, then each `paths` entry, then cwd (deduped).
      const bases = [...new Set([baseDir, ...searchBases, process.cwd()])];
      const candidates = path.isAbsolute(specifier)
        ? [specifier]
        : bases.map((b) => path.resolve(b, specifier));
      for (const candidate of candidates) {
        try {
          return fs.readFileSync(candidate);
        } catch {
          // Try the next base; a genuine miss returns null below.
        }
      }
      return null;
    },
  };
}
