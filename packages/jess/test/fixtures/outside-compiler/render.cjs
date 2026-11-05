/*
 * The same compiler from a CommonJS bundle: its plugins come from each
 * package's CommonJS build, and its identity names the ES module the sandbox
 * imports.
 */
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Compiler } = require('@jesscss/compiler');
const lessPlugin = require('@jesscss/plugin-less').default;
const { lessCompatPlugin } = require('@jesscss/plugin-less-compat');
const nodeModulesPlugin = require('@jesscss/plugin-node-modules').default;

class OutsideCompiler extends Compiler {
  static moduleIdentity = { module: pathToFileURL(path.join(__dirname, 'outside-compiler.mjs')).href, exportName: 'OutsideCompiler' };

  constructor(options) {
    super(options, {
      defaultPlugins: context => [nodeModulesPlugin({ basePath: context.resolutionBaseDir })],
      scriptPluginSpecifier: '@jesscss/plugin-js',
      scriptPluginResolveFrom: __filename
    });
  }
}

const compiler = new OutsideCompiler({ compile: { plugins: [lessPlugin({}), lessCompatPlugin({ plugins: [] })] } });
compiler.render(process.argv[2], { suppressWarnings: true }).then((css) => {
  process.stdout.write(css);
  compiler.dispose();
}, (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
