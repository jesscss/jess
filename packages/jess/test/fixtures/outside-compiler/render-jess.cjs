/* The `jess` compiler from its CommonJS build, whose identity names that build's `.cjs` file. */
const { Compiler } = require('jess');
const lessPlugin = require('@jesscss/plugin-less').default;

const compiler = new Compiler({ compile: { plugins: [lessPlugin({})] } });
import('./report.mjs').then(({ report }) => report(compiler, process.argv[2])).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
