/* A plugin instance with no recorded factory, and what a caller receives for it. */
import lessPlugin from '@jesscss/plugin-less';
import { OutsideCompiler } from './outside-compiler.mjs';

class Instance {
  name = 'instance';
}

const compiler = new OutsideCompiler({ compile: { plugins: [lessPlugin({}), new Instance()] } });
await compiler.renderToResult(process.argv[2], { suppressWarnings: true }).catch((error) => {
  process.stderr.write(JSON.stringify({ code: error.code, filename: error.filename, message: error.message }));
  process.exit(1);
});
