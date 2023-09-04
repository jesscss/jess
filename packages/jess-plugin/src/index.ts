export type PluginOptions = {
  name: string
  /** Extension to match */
  ext: string
}

export const definePlugin = (opts: PluginOptions) => opts

export default definePlugin({
  name: 'jess',
  ext: '.jess'
})