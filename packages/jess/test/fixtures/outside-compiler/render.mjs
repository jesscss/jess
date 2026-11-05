import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { OutsideCompiler } from './outside-compiler.mjs';

const compiler = new OutsideCompiler({ compile: { plugins: [lessPlugin({}), lessCompatPlugin({ plugins: [] })] } });
process.stdout.write(await compiler.render(process.argv[2], { suppressWarnings: true }));
compiler.dispose();
