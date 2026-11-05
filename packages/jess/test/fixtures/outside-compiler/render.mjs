import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { OutsideCompiler } from './outside-compiler.mjs';
import { report } from './report.mjs';

await report(new OutsideCompiler({ compile: { plugins: [lessPlugin({}), lessCompatPlugin({ plugins: [] })] } }), process.argv[2]);
