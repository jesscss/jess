import * as rollup from 'rollup';
import * as path from 'path';
import jess from '../src/index.js';
import commonJs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';

const buildFile = async (filePath: string) => {
  const input = path.resolve(__dirname, filePath);
  const bundle = await rollup.rollup({
    input,
    plugins: [nodeResolve(), commonJs(), jess()],
  });
  const { output } = await bundle.generate({ format: 'umd', name: 'jess' });
  return output;
};

describe('rollup-plugin-jess', () => {
  it('renders a `.jess` module with Jess syntax through the public compiler integration', async () => {
    const result = await buildFile('./direct.jess');
    const css = result.find(item => item.type === 'asset' && item.fileName === 'direct.css');

    expect(css && css.type === 'asset' ? String(css.source) : '').toContain('color: red');
  });
});
