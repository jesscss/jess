import { JessParser } from '../jessParser'
import { EMPTY_ALT } from 'chevrotain'
import { CstChild, IToken, CstNode } from '@jesscss/css-parser'

export default function (this: JessParser, $: JessParser) {
  
  $.expression = $.OVERRIDE_RULE('expression', () => {
    const children: CstChild[] = []
    $.OPTION(() => {
      children.push($.CONSUME($.T.WS))
    })
    $.OR([
      { ALT: () => {
        children.push($.SUBRULE($.jsCollection))
        $.OPTION2(() => {
          children.push($.CONSUME2($.T.WS))
        })
      }},
      { ALT: () => {
        $.MANY(() => children.push($.SUBRULE($.value)))
      }}
    ])
    
    if (children.length === 1) {
      return children[0]
    }
    return {
      name: 'expression',
      children
    }
  })

  $.value = $.OVERRIDE_RULE('value',
    () => $.OR([
      { ALT: () => $.SUBRULE($.block) },
      { ALT: () => $.SUBRULE($.jsExpression) },
      { ALT: () => $.CONSUME($.T.Value) },
      { ALT: () => $.CONSUME($.T.CustomProperty) },
      { ALT: () => $.CONSUME($.T.Colon) },
      { ALT: () => $.CONSUME($.T.WS) }
    ])
  )
}
