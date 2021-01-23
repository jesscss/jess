import { CstChild, CstNode } from '@jesscss/css-parser'
import type { LessParser } from '../lessParser'

export default function(this: LessParser, $: LessParser) {
  $.selectorList = $.OVERRIDE_RULE('selectorList', () => {
    const children: CstChild[] = [
      $.SUBRULE($.complexSelector)
    ]
    
    let allExtends = $.hasExtend
    let guard: CstNode
  
    $.OR([
      { ALT: () => guard = $.SUBRULE($.guard) },
      {
        ALT: () => {
          $.MANY(() => {
            children.push(
              {
                name: 'delimiter',
                children: [
                  $.CONSUME($.T.Comma),
                  $._(1)
                ]
              },
              $.SUBRULE2($.complexSelector)
            )
           
            allExtends = allExtends && $.hasExtend
          })
        }
      }
    ])
    if (guard) {
      return {
        name: 'selectorGuard',
        children: [
          children[0],
          guard
        ]
      }
    } else if (children.length === 1) {
      return children[0]
    }
    
    /** Determines here if can omit a curly block */
    $.hasExtend = allExtends

    return {
      name: 'selectorList',
      children
    }
  })
  
  $.complexSelector = $.OVERRIDE_RULE('complexSelector', () => {
    const selectors: CstChild[] = []

    $.OR([
      { ALT: () => {
        selectors.push(
          $.SUBRULE($.compoundSelector)
        )
        $.MANY(() => selectors.push($.SUBRULE($.combinatorSelector)))
      }},
      {
        ALT: () => $.AT_LEAST_ONE(
          () => selectors.push($.SUBRULE2($.combinatorSelector))
        )
      }
    ])

    let extend: CstNode = $.OPTION(() => {
      $.hasExtend = true
      return {
        name: 'extend',
        children: [
          $.CONSUME($.T.Extend),
          $.SUBRULE($.selectorList),
          $.CONSUME($.T.RParen),
          $._(1)
        ]
      }
    })

    return {
      name: 'complexSelector',
      children: [
        {
          name: 'selectors',
          children: selectors
        },
        extend
      ]
    }
  })

  $.simpleSelector = $.OVERRIDE_RULE('simpleSelector',
    () => $.OR([
      { ALT: () => $.SUBRULE($.pseudoSelector) },
      { ALT: () => $.SUBRULE($.attrSelector) },
      { ALT: () => $.SUBRULE($.nameSelector) },
      /** Used in keyframes as a selector */
      { ALT: () => $.CONSUME($.T.Dimension) },
      /** Can be a partial class, as in `&-1` */
      { ALT: () => $.CONSUME($.T.Number) }
    ])
  )

  $.attrIdent = $.OVERRIDE_RULE('attrIdent', () => $.SUBRULE($.identOrInterpolated))
}