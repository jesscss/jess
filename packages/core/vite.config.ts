import { defineConfig, type PluginOption } from 'vite'
import { visualizer } from 'rollup-plugin-visualizer'
// import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { externalizeDeps } from 'vite-plugin-externalize-deps'
import circleDependency from 'vite-plugin-circular-dependency'

export default defineConfig({
  build: {
    lib: {
      entry: 'src/tree/index.ts',
      name: 'JessCore',
      formats: ['es']
    }
  },
  plugins: [
    externalizeDeps(),
    circleDependency()
    // nodePolyfills({
    //   globals: {
    //     Buffer: true,
    //     process: true,
    //     global: true
    //   },
    //   protocolImports: true
    // }),
    // visualizer({
    //   // template: 'raw-data',
    //   open: true
    // }) as PluginOption
  ]
})