
import sucrase from '@rollup/plugin-sucrase'

export default {
  input: './src/index.ts',
  plugins: [
    sucrase({
      transforms: ['typescript']
    })
  ],
  output: {
    file: './dist/index.js',
    format: 'umd',
    name: 'patchCss'
  }
}