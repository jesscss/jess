import path from 'path';
import { fileURLToPath } from 'url';
import { Compiler } from '../lib/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const lessPath = path.resolve(__dirname, '../../node_modules/@less/test-data/tests-unit/extend-chaining/extend-chaining.less');
const lessRelativePath = path.relative(process.cwd(), lessPath);

async function main() {
  const compiler = new Compiler({
    output: { collapseNesting: true },
    compile: {}
  });

  const context = compiler.createContext(lessRelativePath, { outputFile: `${lessPath}.out.css` });
  const { node } = await context.getTree(lessRelativePath);
  const evald = await node.eval(context);

  console.log('Rendered CSS:');
  console.log(evald.toString({ context }));

  console.log('Extend roots count:', context.extendRoots.getAlts().size);
  console.log('Roots detail:');
  for (const root of context.extendRoots.getAlts()) {
    console.log(
      ' - root',
      root.value.map((n) => (n && typeof n.toString === 'function' ? n.toString() : '?'))
    );
  }
}

main().catch((error) => {
  console.error('Error during repro:', error);
  process.exit(1);
});
