import { CstChild, CstNode } from '@jesscss/css-parser'
import type { JessParser } from '../jessParser'

export default function(this: JessParser, $: JessParser) {
  $.nameSelector = $.OVERRIDE_RULE('nameSelector', () => {
    $.OR([
      { ALT: () => $.CONSUME($.T.Selector) },
      { ALT: () => $.CONSUME($.T.Ident) },
      { ALT: () => $.SUBRULE($.jsExpression) },
      /** We added dot tokens for JS, so we need to match a class name */
      { ALT: () => {
        $.CONSUME($.T.Dot)
        $.CONSUME2($.T.Ident)
      }}
    ])
  })
}