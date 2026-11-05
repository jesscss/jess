import { writeFileSync } from 'node:fs';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { LessCompiler } from './less-compiler.js';

const compiler = new LessCompiler({ compile: { plugins: [lessPlugin({}), lessCompatPlugin({ plugins: [] })] } });
const { css, errors } = await compiler.renderToResult(process.argv[2], { suppressWarnings: true });
compiler.dispose();
if (errors.length > 0) {
  process.stderr.write(errors.map(error => `${error.code}: ${error.message}`).join('\n'));
  process.exitCode = 1;
} else {
  writeFileSync(process.argv[3], css);
}
