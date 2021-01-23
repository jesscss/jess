import type { Plugin } from 'rollup'
import { renderModule } from '../render-module'

export default function(options = {}): Plugin {
  return {
    name: 'jess',

    async transform(code, id) {
      if (!(/\.jess$/.test(id))) {
        return null
      }
      const result = await renderModule(code, id)
      return result
    }
  }
}