import { defineConfig, type PluginOption } from 'vite'
import { visualizer } from 'rollup-plugin-visualizer'
// import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { externalizeDeps } from 'vite-plugin-externalize-deps'
// import circleDependency from 'vite-plugin-circular-dependency'
import circularDependencies from 'rollup-plugin-circular-dependencies'

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
    circularDependencies(),
    // circleDependency()
    // nodePolyfills({
    //   globals: {
    //     Buffer: true,
    //     process: true,
    //     global: true
    //   },
    //   protocolImports: true
    // }),
    visualizer({
      template: 'flamegraph',
      open: true
    }) as PluginOption
  ]
})