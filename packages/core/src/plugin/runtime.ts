import type { Plugin } from 'rollup'
import * as path from 'path'
import { render } from '../render'
import { renderModule } from '../render-module'

/**
 * Rollup plugin to create CSS / runtime
 */
export default function(options = {}): Plugin {
  let jessFiles = new Set<string>()
  return {
    name: 'jess',

    async transform(code, id) {
      if (!(/\.jess$/.test(id))) {
        return null
      }
      jessFiles.add(id)
      let result = await renderModule(code, id, options)

      return { code: result.$js_runtime }
    },

    async buildEnd() {
      let emitCss = async (id: string) => {
        /**
         * @todo - even though the file is already read, I couldn't figure
         * out a way yet to pass that as a string to the internal Jess Rollup
         * process in the `render` function. So, technically, this file
         * will be read from the filesystem twice.
         */
        let result = await render(id, options)
        this.emitFile({
          type: 'asset',
          name: path.basename(id.replace(/\.jess/, '.css')),
          source: result.$toCSS()
        })
      }

      /**
       * If Jess is the entry file for this Rollup process,
       * or is imported by a non-Jess file, then generate a
       * CSS asset.
       */
      let entries = jessFiles.values()
      for (let file of entries) {
        let info = this.getModuleInfo(file)
        /** If it's the entry file, we can stop */
        if (info.isEntry) {
          await emitCss(file)
          break
        }
        let nonJessImporters = info.importers.filter(id => !/\.jess$/.test(id))
        if (nonJessImporters.length !== 0) {
          await emitCss(file)
        }
      }
    }
  }
}