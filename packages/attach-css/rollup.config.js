
import typescript from '@rollup/plugin-typescript'

export default {
  input: './src/index.ts',
  plugins: [
    typescript({
      outDir: './dist',
      lib: ['es5', 'es6', 'dom'],
      target: 'es5'
    })
  ],
  output: {
    file: './dist/index.js',
    format: 'umd',
    name: 'jess'
  }
}