import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Context } from '@jesscss/core';
import { lookupMime } from './mime.js';

export { lookupMime } from './mime.js';

export function resolveAssetPath(context: Context, rawPath: string): string | undefined {
  const currentDir = context.sourceContext?.file?.path ?? process.cwd();
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
