import type { CssParser, CstNode, CstChild } from '../cssParser'

export default function(this: CssParser, $: CssParser) {
  /** A comma-separated list of selectors */
  $.selectorList = $.RULE('selectorList', () => {
    const children = [
      $.SUBRULE($.complexSelector)
    ]
    
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
    })
    return {
      name: 'selectorList',
      children
    }
  })

  /**
   * "A complex selector is a sequence of one or more compound selectors
   *  separated by combinators. It represents a set of simultaneous
   *  conditions on a set of elements in the particular relationships
   *  described by its combinators."
   *
   * For simplicity, this is returned as a stream of selectors
   * and combinators.
   *
   * @see https://www.w3.org/TR/selectors-4/#structure
   */
  $.complexSelector = $.RULE('complexSelector', () => {
    const children: CstNode[] = [
      $.SUBRULE($.compoundSelector)
    ]
    $.MANY(() => children.push($.SUBRULE($.combinatorSelector)))
    children.push($._())
    return {
      name: 'complexSelector',
      children
    }
  })

  /**
   * A combinator, then a compound selector
   *  e.g. `> div.class`
   */
  $.combinatorSelector = $.RULE('combinatorSelector',
    () => ({
      name: 'combinatorSelector',
      children: $.OR([
        {
          ALT: () => [
            /**
             * Combinator with optional whitespace
             */
            {
              name: 'combinator',
              children: [
                $.CONSUME($.T.Combinator),
                $.OPTION(() => $.CONSUME($.T.WS))
              ]
            },
            $.SUBRULE2($.compoundSelector)
          ]
        },
        {
          /**
           * Whitespace with optional combinator,
           * (or we treat as trailing ws)
           */
          ALT: () => {
            const children = [
              $.CONSUME2($.T.WS)
            ]
            let sel
            $.OPTION2(() => {
              $.OPTION3(() => {
                children.push($.CONSUME2($.T.Combinator))
                $.OPTION4(() => children.push($.CONSUME3($.T.WS)))
              })
              
              sel = $.SUBRULE3($.compoundSelector)
            })
            if (sel) {
              return [
                {
                  name: 'combinator',
                  children
                },
                sel
              ]
            }
            return children
          }
        }
      ])
    })
  )

  /**
   * "A compound selector is a sequence of simple selectors that are not separated by a combinator,
   * and represents a set of simultaneous conditions on a single element. If it contains a type
   * selector or universal selector, that selector must come first in the sequence."
   *
   * @see https://www.w3.org/TR/selectors-4/#structure
   */
  $.compoundSelector = $.RULE('compoundSelector',
    () => ({
      name: 'compoundSelector',
      children: $.OR([
        { ALT: () => [$.CONSUME($.T.Star)] },
        {
          ALT: () => {
            const children: CstNode[] = []
            $.AT_LEAST_ONE(() => children.push($.SUBRULE($.simpleSelector)))
            return children
          }
        }
      ])
    })
  )

  /**
   * "A simple selector is a single condition on an element. A type selector,
   * universal selector, attribute selector, class selector, ID selector,
   * or pseudo-class is a simple selector."
   *
   * @see https://www.w3.org/TR/selectors-4/#structure
   */
  $.simpleSelector = $.RULE('simpleSelector',
    () => $.OR([
      { ALT: () => $.SUBRULE($.pseudoSelector) },
      { ALT: () => $.SUBRULE($.attrSelector) },
      { ALT: () => $.SUBRULE($.nameSelector) },
      /** Used in keyframes as a selector */
      { ALT: () => $.CONSUME($.T.Dimension) }
    ])
  )

  /** e.g. `:pseudo` | `::pseudo` | `:pseudo()` */
  $.pseudoSelector = $.RULE('pseudoSelector', () => {
    const pseudoName = [$.CONSUME($.T.Colon)]
    $.OPTION(() => pseudoName.push($.CONSUME2($.T.Colon)))
    const getName = () => ({
      name: 'pseudoName',
      children: pseudoName
    })
    let args
    let R
    $.OR2([
      {
        ALT: () => {
          pseudoName.push($.CONSUME($.T.Ident))
          /** Handle functions parsed as idents (like `not`) */
          $.OPTION2(() => {
            pseudoName.push($.CONSUME($.T.LParen))
            args = $.SUBRULE($.expressionList),
            R = $.CONSUME($.T.RParen)
          })
        }
      },
      {
        /** e.g. :pseudo(...) */
        ALT: () => {
          pseudoName.push($.CONSUME($.T.Function))
          args = $.SUBRULE2($.expressionList),
          R = $.CONSUME2($.T.RParen)
        }
      }
    ])

    return {
      name: 'pseudoSelector',
      children: [
        getName(),
        args,
        R
      ]
    }
  })

  /** e.g. [id^="bar"] [*|ns|="foo"] */
  $.attrSelector = $.RULE('attrSelector', () => {
    const attr: CstChild[] = []
    const L = $.CONSUME($.T.LSquare)
    let eq, value

    $.OR([
      { ALT: () => {
        $.OPTION(() => attr.push($.CONSUME($.T.Star)))
        attr.push(
          $.CONSUME($.T.Pipe),
          $.SUBRULE($.attrIdent)
        )
      }},
      { ALT: () => {
        attr.push($.SUBRULE2($.attrIdent))
        $.OPTION2(() => {
          attr.push(
            $.CONSUME2($.T.Pipe),
            $.SUBRULE3($.attrIdent)
          )
        })
      }}
    ])
    $.OPTION4(() => {
      eq = $.OR2([
        { ALT: () => $.CONSUME($.T.Eq) },
        { ALT: () => $.CONSUME($.T.AttrMatch) }
      ])
      value = $.OR3([
        { ALT: () => $.SUBRULE4($.attrIdent) },
        { ALT: () => $.CONSUME3($.T.Dimension) },
        { ALT: () => $.CONSUME($.T.StringLiteral) }
      ])
    })
    const R = $.CONSUME($.T.RSquare)

    return {
      name: 'attrSelector',
      children: [
        L,
        {
          name: 'attr',
          children: attr
        },
        eq,
        value,
        R
      ]
    }
  })

  /** Separated out for Less overriding */
  $.attrIdent = $.RULE('attrIdent', () => $.CONSUME($.T.Ident))
  $.nameSelector = $.RULE('nameSelector', () => $.CONSUME($.T.Selector))
}