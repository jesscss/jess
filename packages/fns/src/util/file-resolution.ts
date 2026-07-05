import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Context } from '@jesscss/core';

const MIME_BY_EXT = new Map<string, { type: string; ascii: boolean }>([
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

export function resolveAssetPath(context: Context, rawPath: string): string | undefined {
  const currentDir = context.treeContext?.file?.path ?? process.cwd();
  const searchPaths = context.opts.searchPaths ?? [];
  const bases = [currentDir, ...searchPaths, process.cwd()];

  const tryPath = (candidate: string): string | undefined => {
    if (existsSync(candidate)) {
      return candidate;
    }
    return undefined;
  };

  const cleanPath = rawPath.split('#')[0]!;
  if (path.isAbsolute(cleanPath)) {
    return tryPath(cleanPath);
  }

  for (const base of bases) {
    const baseDir = path.isAbsolute(base) ? base : path.resolve(currentDir, base);
    const resolved = tryPath(path.resolve(baseDir, cleanPath));
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

export async function readAsset(context: Context, rawPath: string): Promise<{ contents: Buffer }> {
  // Prefer the compiler's plugin file manager (search paths, locators) over a
  // hand-rolled fs walk. Falls back to local base-dir resolution when no plugin
  // resolver is wired (e.g. a bare Context in a unit test).
  try {
    return { contents: await context.readBinary(rawPath) };
  } catch {
    const resolvedPath = resolveAssetPath(context, rawPath);
    if (!resolvedPath) {
      throw new Error(`File not found: ${rawPath}`);
    }
    return { contents: readFileSync(resolvedPath) };
  }
}

export function lookupMime(filePath: string): { type: string; ascii: boolean } {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXT.get(ext) ?? { type: 'application/octet-stream', ascii: false };
}
