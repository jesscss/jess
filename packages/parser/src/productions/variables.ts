
import { JessParser } from '../jessParser'
import { EMPTY_ALT } from 'chevrotain'
import { CstChild, IToken, CstNode } from '@jesscss/css-parser'

export default function (this: JessParser, $: JessParser) {
  $.atLet = $.RULE('atLet',
    () => ({
      name: 'atLet',
      children: [
        $.CONSUME($.T.AtLet),
        $._(),
        $.SUBRULE($.atLetValue)
      ]
    })
  )

  $.atLetValue = $.RULE('atLetValue', () => {
    /** JS ident */
    const keyChildren: CstChild[] = [
      $.CONSUME($.T.PlainIdent),
      $._(1)
    ]
    const valueChildren: CstChild[] = []
    
    $.OR([
      {
        ALT: () => {
          keyChildren.push(
            $.CONSUME($.T.Colon),
            $._(2)
          )
          valueChildren.push(
            $.SUBRULE($.expressionList),
            $.OPTION(() => $.CONSUME($.T.SemiColon))
          )
        }
      },
      { ALT: () => valueChildren.push($.SUBRULE($.jsCollection)) }
    ])

    return {
      name: 'atLetValue',
      children: [
        {
          name: 'key',
          children: keyChildren
        },
        {
          name: 'value',
          children: valueChildren
        }
      ]
    }
  })

  $.jsCollection = $.RULE('jsCollection', () => {
    const children: CstChild[] = [
      $.CONSUME($.T.LCurly),
      $._()
    ]
    const collectionChildren: CstChild[] = []

    $.MANY(() => {
      collectionChildren.push({
        name: 'jsCollectionNode',
        children: [
          $.SUBRULE($.atLetValue),
          $._(1)
        ]
      })
    })
    return {
      name: 'jsCollection',
      children: [
        ...children,
        {
          name: 'jsCollectionNodes',
          children: collectionChildren
        },
        $.CONSUME($.T.RCurly)
      ]
    }
  })
}