import type { Plugin } from 'rollup'
import * as path from 'path'
import * as fs from 'fs'
import { renderModule } from '../render-module'

export default function(options = {}): Plugin {
  return {
    name: 'jess',

    async transform(code, id) {
      if (!(/\.jess$/.test(id))) {
        return null
      }
      const result = await renderModule(code, id)
      // For testing...
      // fs.writeFileSync(id.replace(/\.jess/, '__.js'), result.code)
      this.emitFile({
        type: 'asset',
        name: path.basename(id),
        source: result.code
      })
      return result
    }
  }
}