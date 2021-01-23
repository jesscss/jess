import type { Plugin } from 'rollup'
import * as path from 'path'
import { renderModule } from '../render-module'

export default function(options = {}): Plugin {
  return {
    name: 'jess',

    async transform(code, id) {
      if (!(/\.jess$/.test(id))) {
        return null
      }
      const result = await renderModule(code, id)
      this.emitFile({
        type: 'asset',
        name: path.basename(id),
        source: result.code
      })
      return result
    }
  }
}