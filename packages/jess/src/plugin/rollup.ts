import type { Plugin } from 'rollup'

export default function(options = {}): Plugin {
  return {
    name: 'jess',

    transform(code, id) {
      if (!(/\.jess$/.test(id))) {
        return null
      }
      
    }
  }
}