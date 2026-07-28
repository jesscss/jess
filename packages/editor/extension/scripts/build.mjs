import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: [path.join(__dirname, '..', 'src', 'extension.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  sourcemap: true,
  outfile: path.join(__dirname, '..', 'dist', 'extension.js'),
  external: ['vscode'],
  target: ['node18']
});

if (watch) {
  await ctx.watch();
  console.log('watching...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
