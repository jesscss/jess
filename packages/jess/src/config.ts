import { cosmiconfigSync } from 'cosmiconfig'

const explorerSync = cosmiconfigSync('jess', {
  searchPlaces: [
    '.jessrc.js',
    'jess.config.js'
  ]
})

export const getConfig = (searchFrom?: string) => {
  searchFrom ??= process.cwd()
  let result = explorerSync.search(searchFrom)?.config || { options: {} }
  if ('default' in result) {
    result = result.default
  }
  return result
}