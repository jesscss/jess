import type { Plugin } from 'rollup'
import * as path from 'path'
import * as fs from 'fs'
import { render } from 'jess/lib/render'

export default function(options = {}): Plugin {
  return {
    name: 'jess',

    async transform(code, id) {
      if (!(/\.jess$/.test(id))) {
        return null
      }
      /**
       * @todo - even though the file is already read, I couldn't figure
       * out a way yet to pass that as a string to the internal Jess Rollup
       * process in the `render` function.
       */
      const result = await render(id, options)
      
      // For testing...
      // fs.writeFileSync(id.replace(/\.jess/, '__.js'), result.code)
      // this.emitFile({
      //   type: 'asset',
      //   name: path.basename(id),
      //   source: result.code
      // })


      return result
    }
  }
}