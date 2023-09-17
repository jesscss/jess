import type { Plugin } from 'rollup'
import * as path from 'path'
// import * as fs from 'fs'
import { renderModule } from '../render-module'

/**
 * Rollup plugin to transpile .jess at compile-time
 */
export default function(options: Record<string, any> = {}): Plugin {
  return {
    name: 'jess',

    async transform(code, id) {
      if (!(/\.jess$/.test(id))) {
        return null
      }
      let result = await renderModule(code, id, options)
      // For testing...
      // fs.writeFileSync(id.replace(/\.jess/, '__.js'), result.code)

      this.emitFile({
        type: 'asset',
        name: path.basename(id),
        source: result.$js_runtime
      })

      return { code: result.$js }
    }
  }
}