import { CstChild } from '@jesscss/css-parser'
import type { JessParser } from '../jessParser'

export default function(this: JessParser, $: JessParser) {
  $.jsExpression = $.RULE('jsExpression', () => {
    const children: CstChild[] = [
      $.CONSUME($.T.JsStart)
    ]
    /**
     * If we follow `$` with parens, then we only allow
     * one paren block.
     */
    $.OR({
      IGNORE_AMBIGUITIES: true,
      DEF: [
        {
          ALT: () => {
            const blockChildren: CstChild[] = []
            const start = $.CONSUME($.T.LParen)
            $.MANY(() => blockChildren.push($.SUBRULE2($.jsTokens)))
            
            children.push({
              name: 'jsBlock',
              children: [
                start,
                {
                  name: 'jsBlockTokens',
                  children: blockChildren
                },
                $.CONSUME($.T.RParen),
                $.OPTION(() => $.CONSUME($.T.Ident))
              ]
            })
          }
        },
        {
          ALT: () => {
            children.push($.SUBRULE($.jsValue))
            $.MANY2(() => {
              $.OPTION2(() => {
                children.push($.CONSUME($.T.Dot))
              })
              children.push($.SUBRULE2($.jsValue))
            })
          }
        }
      ]
    })
    
    return {
      name: 'jsExpression',
      children
    }
  })

  $.jsValue = $.RULE('jsValue',
    () => ({
      name: 'jsValue',
      children: $.OR([
        { ALT: () => [
          /** 
             * JS ident 
             */
          $.CONSUME($.T.PlainIdent)
        ]},
        { ALT: () => [$.CONSUME($.T.StringLiteral)]},
        /** I guess this can happen? */
        { ALT: () => [$.CONSUME($.T.UriString)]},
        // Look for matching blocks
        {
          ALT: () => {
            const children: CstChild[] = []
            const start: CstChild = $.OR2([
              { ALT: () => $.CONSUME($.T.Function) },
              { ALT: () => $.CONSUME($.T.LParen) }
            ])
            $.MANY(() => children.push($.SUBRULE($.jsTokens)))

            return [{
              name: 'jsBlock',
              children: [
                start,
                {
                  name: 'jsBlockTokens',
                  children
                },
                $.CONSUME($.T.RParen)
              ]
            }]
          }
        },
        {
          ALT: () => {
            const children: CstChild[] = []
            const start = $.CONSUME($.T.LSquare)
            $.MANY2(() => children.push($.SUBRULE2($.jsTokens)))
            
            return [{
              name: 'jsBlock',
              children: [
                start,
                {
                  name: 'jsBlockTokens',
                  children
                },
                $.CONSUME($.T.RSquare)
              ]
            }]
          }
        },
        {
          ALT: () => {
            const children: CstChild[] = []
            const start = $.CONSUME($.T.LCurly)
            $.MANY3(() => children.push($.SUBRULE3($.jsTokens)))
            return [{
              name: 'jsBlock',
              children: [
                start,
                {
                  name: 'jsBlockTokens',
                  children
                },
                $.CONSUME($.T.RCurly)
              ]
            }]
          }
        }
      ])
    })
  )

  /**
   * For now, we'll just tokenize as CSS tokens, instead of specially
   * parsing JS. This will not check that the JS is valid! Something
   * else should do that?
   */
  $.jsTokens = $.RULE('jsTokens',
    () => $.OR([
      { ALT: () => $.SUBRULE($.jsValue) },
      { ALT: () => $.CONSUME($.T.WS) },
      { ALT: () => $.CONSUME($.T.Dot) },
      { ALT: () => $.CONSUME($.T.Colon) },
      { ALT: () => $.CONSUME($.T.Ampersand) },
      { ALT: () => $.CONSUME($.T.Pipe) },
      { ALT: () => $.CONSUME($.T.Comma) },
      { ALT: () => $.CONSUME($.T.SemiColon) },
      { ALT: () => $.CONSUME($.T.NotMark) },
      { ALT: () => $.CONSUME($.T.Number) },
      /** =, >, <, <=, => */
      { ALT: () => $.CONSUME($.T.CompareOperator) },
      { ALT: () => $.CONSUME($.T.AdditionOperator) },
      { ALT: () => $.CONSUME($.T.MultiplicationOperator) },
      { ALT: () => $.CONSUME($.T.Ellipsis) },
      /** Try not to put these in your identifiers, it's confusing */
      { ALT: () => $.CONSUME($.T.JsStart) }
    ])
  )
}