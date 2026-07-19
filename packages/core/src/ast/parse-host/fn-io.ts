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
 * render's source file), falling back to the process cwd. `readFile` returns the
 * file's raw bytes, or `null` when the specifier resolves to nothing readable — the
 * signal an IO fn uses to degrade gracefully (a `url()` / verbatim fallback).
 */
export function createFsFnIo(filePath?: string): FnIo {
  const baseDir = filePath ? path.dirname(filePath) : process.cwd();
  return {
    readFile(specifier: string): Uint8Array | null {
      const bases = baseDir === process.cwd() ? [baseDir] : [baseDir, process.cwd()];
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
