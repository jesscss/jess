// jess/useWebpackResolver.ts
import path from 'node:path';
import fs from 'node:fs';
import {
  ResolverFactory,
  CachedInputFileSystem
} from 'enhanced-resolve';
import type { Plugin } from 'enhanced-resolve';
import type { PluginInterface } from './plugin.js';

const { isArray } = Array;

export type WebpackResolverCtor<Opts = unknown> = new (opts?: Opts) => Plugin;
type InferCtorOpts<C> = C extends new (opts?: infer O) => Plugin ? O : never;

export function useWebpackResolver<Ctor extends WebpackResolverCtor>(
  CtorRef: Ctor
): (opts?: InferCtorOpts<Ctor>) => PluginInterface {
  return (opts?: InferCtorOpts<Ctor>): PluginInterface => {
    const fileSystem = new CachedInputFileSystem(fs, 4000);
    const pluginInstance = new CtorRef(opts);

    const er = ResolverFactory.createResolver({
      fileSystem,
      plugins: [pluginInstance]
    });

    const resolveOnce = (basedir: string, request: string) =>
      new Promise<string | null>((resolve) => {
        er.resolve({}, basedir, request, {}, (err, out) => {
          resolve(err || !out ? null : out);
        });
      });

    return {
      name: `webpack-resolver(${CtorRef.name || 'ctor'})`,
      async resolve(filePath, currentDir, searchPaths) {
        const bases = [currentDir, ...searchPaths];
        const out: string[] = [];
        const seen = new Set<string>();
        filePath = isArray(filePath) ? filePath : [filePath];
        for (const base of bases) {
          const baseDir = path.isAbsolute(base) ? base : path.resolve(currentDir, base);
          for (const path of filePath) {
            const abs = await resolveOnce(baseDir, path);
            if (abs && !seen.has(abs)) {
              seen.add(abs);
              out.push(abs);
            }
          }
        }
        return out;
      }
    };
  };
}
