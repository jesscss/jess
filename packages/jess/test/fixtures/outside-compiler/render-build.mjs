/* A compiler whose identity names a CommonJS build with an ES module beside it. */
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { OutsideCompiler } from './outside-compiler.mjs';
import { report } from './report.mjs';

class BuildCompiler extends OutsideCompiler {
  static moduleIdentity = { module: new URL('./es-build.cjs', import.meta.url).href, exportName: 'BuildCompiler' };
}

await report(new BuildCompiler({ compile: { plugins: [lessPlugin({}), lessCompatPlugin({ plugins: [] })] } }), process.argv[2]);
