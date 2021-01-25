import { CstChild } from '@jesscss/css-parser'
import type { LessParser } from '../lessParser'

export default function(this: LessParser, $: LessParser) {
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