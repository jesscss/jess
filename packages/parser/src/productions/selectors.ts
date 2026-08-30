import { CstNode, IToken } from '@jesscss/css-parser'
import type { JessParser } from '../jessParser'

export default function(this: JessParser, $: JessParser) {
  /** Borrowed from the Less parser */
  $.complexSelector = $.OVERRIDE_RULE('complexSelector', () => {
    const children: CstNode[] = []
    $.OR([
      { ALT: () => {
        children.push(
          $.SUBRULE($.compoundSelector)
        )
        $.MANY(() => children.push($.SUBRULE($.combinatorSelector)))
      }},
      {
        ALT: () => $.AT_LEAST_ONE(
          () => children.push($.SUBRULE2($.combinatorSelector))
        )
      }
    ])
    children.push($._())
    return {
      name: 'complexSelector',
      children
    }
  })


  $.nameSelector = $.OVERRIDE_RULE('nameSelector',
    () => $.OR([
      { ALT: () => $.CONSUME($.T.Selector) },
      { ALT: () => $.CONSUME($.T.Ident) },
      { ALT: () => $.SUBRULE($.jsExpression) },
      /** We added dot tokens for JS, so we need to match a class name */
      { ALT: () => {
        const dot = $.CONSUME($.T.Dot)
        const ident = $.CONSUME2($.T.Ident)
        return <IToken>{
          image: dot.image + ident.image,
          startLine: dot.startLine,
          startColumn: dot.startColumn,
          startOffset: dot.startOffset,
          endLine: ident.endLine,
          endColumn: ident.endColumn,
          endOffset: ident.endOffset
        }
      }}
    ])
  )
}