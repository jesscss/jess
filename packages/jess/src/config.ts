import { cosmiconfigSync } from 'cosmiconfig'

const explorerSync = cosmiconfigSync('jess', {
  searchPlaces: [
    '.jessrc.js',
    'jess.config.js'
  ]
})

let result = explorerSync.search()?.config || { options: {} }
if ('default' in result) {
  result = result.default
}

export default result