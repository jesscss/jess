import { Compiler } from '@jesscss/compiler';
import nodeModulesPlugin from '@jesscss/plugin-node-modules';

/**
 * A compiler built by a package other than Jess: the base class, its hooks in
 * the constructor, and its own identity so the sandbox can make it again.
 */
export class OutsideCompiler extends Compiler {
  static moduleIdentity = { module: import.meta.url, exportName: 'OutsideCompiler' };

  constructor(options) {
    super(options, {
      defaultPlugins: context => [nodeModulesPlugin({ basePath: context.resolutionBaseDir })],
      scriptPluginSpecifier: '@jesscss/plugin-js',
      scriptPluginResolveFrom: import.meta.url
    });
  }
}
