
export type PluginOptions = {
  language?: {
    name: string
    ext: string
  }
}

export const definePlugin = (opts: PluginOptions) => opts

export default definePlugin({
  language: {
    name: 'jess',
    ext: '.jess'
  }
})