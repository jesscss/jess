/**
 * @todo
 * When we're bundling, replace this module with a subset of config,
 * specifically an object with only an `options` prop, so that these
 * dependencies are not bundled
 */
import { cosmiconfigSync } from 'cosmiconfig'

const explorerSync = cosmiconfigSync('jess', {
  searchPlaces: [
    '.jessrc.js',
    'jess.config.js',
  ]
})

let result = explorerSync.search()?.config || { options: {} }
if ('default' in result) {
  result = result.default
}

export default result