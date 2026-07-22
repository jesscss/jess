/**
 * Pure MIME lookup for the file/`data-uri` built-ins — the extension→mimetype +
 * charset decision, with NO file-system or compiler-`Context` dependency (so both
 * the legacy `less/` fn set and the boundary-clean ast/ `builtins/` set can share
 * one source of truth). `ascii: true` means the format is text (US-ASCII / UTF-8),
 * so `data-uri` percent-encodes it; `ascii: false` means binary → base64. Mirrors
 * Less 4.x `environment.mimeLookup` + `charsetLookup`.
 */
import path from 'node:path';

export interface MimeInfo {
  /** The mimetype string (e.g. `image/jpeg`). */
  readonly type: string;
  /** True when the payload is text (percent-encode); false → binary (base64). */
  readonly ascii: boolean;
}

const MIME_BY_EXT = new Map<string, MimeInfo>([
  ['.css', { type: 'text/css', ascii: true }],
  ['.gif', { type: 'image/gif', ascii: false }],
  ['.htm', { type: 'text/html', ascii: true }],
  ['.html', { type: 'text/html', ascii: true }],
  ['.jpg', { type: 'image/jpeg', ascii: false }],
  ['.jpeg', { type: 'image/jpeg', ascii: false }],
  ['.js', { type: 'application/javascript', ascii: true }],
  ['.json', { type: 'application/json', ascii: true }],
  ['.png', { type: 'image/png', ascii: false }],
  ['.svg', { type: 'image/svg+xml', ascii: true }],
  ['.txt', { type: 'text/plain', ascii: true }],
  ['.webp', { type: 'image/webp', ascii: false }],
  ['.xml', { type: 'application/xml', ascii: true }]
]);

/** Guess a file's `{ type, ascii }` from its extension; unknown → binary octet-stream. */
export function lookupMime(filePath: string): MimeInfo {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXT.get(ext) ?? { type: 'application/octet-stream', ascii: false };
}
