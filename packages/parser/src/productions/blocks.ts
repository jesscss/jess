import { EMPTY_ALT } from 'chevrotain'
import type { JessParser } from '../jessParser'

export default function(this: JessParser, $: JessParser) {
  $.qualifiedRule = $.OVERRIDE_RULE('qualifiedRule',
    () => ({
      name: 'qualifiedRule',
      children: [
        $.SUBRULE($.selectorList),
        $.SUBRULE($.rulePrimary)
      ]
    })
  )
  
  $.rulePrimary = $.RULE('rulePrimary', () => {
    $.CONSUME($.T.LCurly)
    $._()
    $.MANY(() => {
      $.OR([
        /** 
         * @todo When we do @media bubbling, set a state
         * variable that these are now "inner" atRules,
         * some of which should instead parse rulePrimary
         * children
         * 
         * e.g.  $.isNested = true 
         */
        { ALT: () => $.SUBRULE($.atRule) },
        { ALT: () => $.SUBRULE($.customDeclaration) },
        { ALT: () => $.SUBRULE($.declaration) },
        { ALT: () => $.SUBRULE($.nested) },
        { ALT: () => EMPTY_ALT }
      ])
      $._(1)
    })
    $.CONSUME($.T.RCurly)
  })

  /**
   *     `@nest .sel, #sel { }`
   * or  `&.sel
   */
  $.nested = $.RULE('nested', () => {
    $.OR([
      {
        ALT: () => {
          $.CONSUME($.T.Ampersand)
          $.OPTION(() => $.SUBRULE($.selectorList))
        }
      },
      {
        ALT: () => {
          $.CONSUME($.T.AtNest)
          $.SUBRULE2($.selectorList)
        }
      },
    ])
    $.SUBRULE($.rulePrimary)
  })

}