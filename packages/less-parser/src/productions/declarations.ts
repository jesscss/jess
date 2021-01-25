import { CstChild } from '@jesscss/css-parser'
import type { LessParser } from '../lessParser'

export default function(this: LessParser, $: LessParser) {
  /** "color" in "color: red" */
  $.property = $.OVERRIDE_RULE('property', () => {
    const children: CstChild[] = []
    /** Legacy - remove? */
    $.OPTION(() => children.push($.CONSUME($.T.Star)))

    $.AT_LEAST_ONE(
      () => children.push($.OR2([
        { ALT: () => $.CONSUME($.T.Ident) },
        { ALT: () => $.CONSUME($.T.InterpolatedIdent) },
        /** Isolated dashes */
        { ALT: () => $.CONSUME($.T.Minus) }
      ]))
    )
    return {
      name: 'property',
      children
    }
  })
  
  $.customProperty = $.OVERRIDE_RULE('customProperty', () => {
    const children: CstChild[] = [
      $.CONSUME($.T.CustomProperty)
    ]
    $.MANY(
      () => children.push($.OR([
        { ALT: () => $.CONSUME($.T.Ident) },
        { ALT: () => $.CONSUME($.T.InterpolatedIdent) },
        /** Isolated dashes */
        { ALT: () => $.CONSUME($.T.Minus) }
      ]))
    )
    return {
      name: 'property',
      children
    }
  })

}