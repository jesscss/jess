import { Context } from '../../context.js';
import type { PluginInterface } from '../../plugin.js';
import { resolve } from 'node:path';

/**
 * Helper to create a context with test plugin support
 * The plugin checks sourceTrees first before trying to locate files
 */
export function createTestContext(): Context {
  const ctx = new Context();
  const plugin: PluginInterface = {
    name: 'test-plugin',
    supportedExtensions: ['.jess'],
    resolve(filePath: string | string[], currentDir: string) {
      const paths = Array.isArray(filePath) ? filePath : [filePath];
      // Resolve all paths to absolute paths
      return paths.map((p) => {
        // If already absolute, return as-is
        if (p.startsWith('/') || (process.platform === 'win32' && /^[A-Z]:/i.test(p))) {
          return p;
        }
        return resolve(currentDir, p);
      });
    },
    locate(pathCandidates: string[], currentDir: string): string | null {
      // Check all candidates - try both resolved and as-is
      for (const candidate of pathCandidates) {
        // Check candidate as-is (might already be absolute)
        if (ctx.sourceTrees.has(candidate)) {
          return candidate;
        }
        // Try resolving relative to currentDir
        const absPath = resolve(currentDir, candidate);
        if (ctx.sourceTrees.has(absPath)) {
          return absPath;
        }
        // Also try resolving relative to process.cwd() as fallback
        const cwdPath = resolve(process.cwd(), candidate);
        if (ctx.sourceTrees.has(cwdPath)) {
          return cwdPath;
        }
        // Check if any sourceTree key ends with the candidate filename
        // (handles cases where path resolution differs)
        const candidateName = candidate.split('/').pop() || candidate;
        for (const [key] of ctx.sourceTrees) {
          if (key.endsWith(candidateName) || key.endsWith(candidate)) {
            return key;
          }
        }
      }
      return null;
    }
  };
  ctx.plugins.push(plugin);
  return ctx;
}
