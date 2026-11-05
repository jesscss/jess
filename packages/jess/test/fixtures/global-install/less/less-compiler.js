import { Compiler } from '@jesscss/compiler';
import nodeModulesPlugin from '@jesscss/plugin-node-modules';

/** The shape of the `less` package's compiler: a subclass the sandbox makes again from this module. */
export class LessCompiler extends Compiler {
  static moduleIdentity = { module: import.meta.url, exportName: 'LessCompiler' };

  constructor(configOptions) {
    super(configOptions, {
      defaultPlugins: context => [nodeModulesPlugin({ basePath: context.resolutionBaseDir })],
      scriptPluginSpecifier: '@jesscss/plugin-js',
      scriptPluginResolveFrom: import.meta.url
    });
  }
}
