import { CstChild } from '@less/css-parser'
import type { JessParser } from '../jessParser'

export default function(this: JessParser, $: JessParser) {
  $.identOrInterpolated = $.RULE('identOrInterpolated', () => {
    const children: CstChild[] = []
    $.AT_LEAST_ONE(() => {
      children.push($.OR([
        { ALT: () => $.CONSUME($.T.Ident) },
        { ALT: () => $.CONSUME($.T.InterpolatedIdent) }
      ]))
    })
    return {
      name: 'identOrInterpolated',
      children
    }
  })
}