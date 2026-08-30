import { CstChild } from '@jesscss/css-parser'
import type { JessParser } from '../jessParser'

export default function(this: JessParser, $: JessParser) {
  /** "color" in "color: red" */
  $.property = $.OVERRIDE_RULE('property', () => {
    const children: CstChild[] = []
    /** Legacy - remove? */
    $.OPTION(() => children.push($.CONSUME($.T.Star)))

    $.AT_LEAST_ONE(
      () => children.push($.OR2([
        { ALT: () => $.CONSUME($.T.Ident) },
        { ALT: () => $.SUBRULE($.jsExpression) },
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
        { ALT: () => $.SUBRULE($.jsExpression) },
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