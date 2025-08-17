import type { CssActionsParser, TokenMap, RuleContext } from './cssActionsParser';
import { EMPTY_ALT, type IToken, type IOrAlt, type OrMethodOpts, tokenMatcher } from 'chevrotain';
import {
  type TreeContext,
  Node,
  type LocationInfo,
  type AssignmentType,
  type Operator,
  Any,
  Block,
  Ruleset,
  Declaration,
  type SimpleSelector,
  SelectorList,
  CompoundSelector,
  ComplexSelector,
  type ComplexSelectorValue,
  Rules,
  Combinator,
  BasicSelector,
  Ampersand,
  List,
  Sequence,
  Call,
  Url,
  Paren,
  Operation,
  Quoted,
  PseudoSelector,
  AttributeSelector,
  AtRule,
  QueryCondition,
  CustomDeclaration,
  RawRules,
  type ComplexSelectorComponent
} from '@jesscss/core';

type C = CssActionsParser;

export type Alt = Array<IOrAlt<any>> | OrMethodOpts<any>;

/** ALT which makes decisions based on context */
export type AltContext = (ctx?: RuleContext) => Alt;

export function stylesheet(this: C, T: TokenMap) {
  const $ = this;

  // stylesheet
  //   : CHARSET? main EOF
  //   ;
  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    let context: TreeContext;
    if (!RECORDING_PHASE) {
      /** Auto-creates tree context */
      context = this.context;
    }

    let charset: IToken | undefined;

    $.OPTION(() => {
      charset = $.CONSUME(T.Charset);
    });

    let root: Node = $.SUBRULE($.main, { ARGS: [{ isRoot: true }] });

    if (!RECORDING_PHASE) {
      let rules = root.value as Node[];

      if (charset) {
        let loc = $.getLocationInfo(charset);
        let rootLoc = root.location;
        rules.unshift(new Any(charset.image, { role: 'charset' }, loc, context!));
        rootLoc[0] = loc[0];
        rootLoc[1] = loc[1];
        rootLoc[2] = loc[2];
      }

      return root;
    }
  };
}

export function main(this: C, T: TokenMap, alt?: Alt) {
  let $ = this;
  let ruleAlt = alt ?? [
    { ALT: () => $.SUBRULE($.qualifiedRule) },
    { ALT: () => $.SUBRULE($.atRule) }
  ];

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;

    const isRoot = !!ctx.isRoot;
    let context: TreeContext;

    if (!RECORDING_PHASE) {
      context = this.context;
    }
    let rules: Node[];

    if (!RECORDING_PHASE) {
      rules = [];
    }

    let requiredSemi = false;

    let lastRule: Node | undefined;
    /**
     * In this production rule, semi-colons are not required
     * but this is repurposed by declarationList and by Less / Sass,
     * so that's why this gate is here.
     */
    $.MANY({
      GATE: () => !requiredSemi || (requiredSemi && (
        $.LA(1).tokenType === T.Semi
        || $.LA(0).tokenType === T.Semi
      )),
      DEF: () => {
        let value = $.OR(ruleAlt);
        if (!RECORDING_PHASE) {
          if (!(value instanceof Node)) {
            /** This is a semi-colon token */
            if (lastRule) {
              lastRule.options.semi = true;
            } else {
              rules.push(new Any(';', { role: 'semi' }, $.getLocationInfo($.LA(1)), context));
            }
          } else {
            requiredSemi = !!value.requiredSemi;
            rules.push(value);
            lastRule = value;
          }
        }
      }
    });

    if (!RECORDING_PHASE) {
      let returnNode = $.getRulesWithComments(rules!, $.getLocationInfo($.LA(1)));
      // Attaches remaining whitespace at the end of rules
      return $.wrap(returnNode!, true);
    }
  };
}

export function qualifiedRule(this: C, T: TokenMap, altContext?: AltContext) {
  const $ = this;

  let selectorAlt = altContext ?? ((ctx: RuleContext) => [
    {
      GATE: () => !ctx.inner,
      ALT: () => $.SUBRULE($.selectorList, { ARGS: [{ ...ctx, qualifiedRule: true }] })
    },
    {
      GATE: () => !!ctx.inner,
      ALT: () => $.SUBRULE($.forgivingSelectorList, { ARGS: [{ ...ctx, firstSelector: true, qualifiedRule: true }] })
    }
  ]);
  // qualifiedRule
  //   : selectorList WS* LCURLY declarationList RCURLY
  //   ;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    let selector = $.OR(selectorAlt(ctx));

    $.CONSUME(T.LCurly);
    let rules = $.SUBRULE($.declarationList);
    $.CONSUME(T.RCurly);

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      return new Ruleset({
        selector,
        rules
      }, undefined, location, this.context);
    }
  };
}

/** * SELECTORS ***/
/** @see https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors  */
/**
      A selector with a single component, such as a single id selector
      or type selector, that's not used in combination with or contains
      any other selector component or combinator
        .e.g `a` | `#selected` | `.foo`

      @todo Define known pseudos

      NOTE: A COLOR_IDENT_START token is a valid ID
    */
// simpleSelector
//   : classSelector
//   | ID
//   | COLOR_IDENT_START
//   | identifier
//   | AMPERSAND
//   | STAR
//   | pseudoSelector
//   | attributeSelector
//   ;
export function simpleSelector(this: C, T: TokenMap, altContext?: AltContext) {
  const $ = this;

  let selectorAlt = altContext ?? ((ctx: RuleContext) => [
    {
      /**
       * It used to be the case that, in CSS Nesting, the first selector
       * could not be an identifier. However, it looks like that's no
       * longer the case.
       *
       * @see: https://github.com/w3c/csswg-drafts/issues/9317
       */
      ALT: () => $.CONSUME(T.Ident)
    },
    {
      /** In CSS Nesting, outer selector can't contain an ampersand */
      GATE: () => !!ctx.inner,
      ALT: () => $.CONSUME(T.Ampersand)
    },
    { ALT: () => $.SUBRULE($.classSelector) },
    { ALT: () => $.SUBRULE($.idSelector) },
    { ALT: () => $.CONSUME(T.Star) },
    { ALT: () => $.SUBRULE($.pseudoSelector, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.attributeSelector) }
  ]);

  return (ctx: RuleContext = {}) => {
    let selector = $.OR(selectorAlt(ctx));

    if (!$.RECORDING_PHASE) {
      if ($.isToken(selector)) {
        if (selector.tokenType.name === 'Ampersand') {
          return new Ampersand(undefined, undefined, $.getLocationInfo(selector), this.context);
        }
        return new BasicSelector(selector.image, undefined, $.getLocationInfo(selector), this.context);
      }
      return selector as Node;
    }
  };
}

// classSelector
//   : DOT identifier
//   ;
export function classSelector(this: C, T: TokenMap) {
  const $ = this;

  return () => {
    let selector = $.CONSUME(T.DotName);
    if (!$.RECORDING_PHASE) {
      return new BasicSelector(selector.image, undefined, $.getLocationInfo(selector), this.context);
    }
  };
}

export function idSelector(this: C, T: TokenMap, alt?: Alt) {
  const $ = this;

  let selectorAlt = alt ?? [
    { ALT: () => $.CONSUME(T.HashName) },
    { ALT: () => $.CONSUME(T.ColorIdentStart) }
  ];
  /** #id, #FF0000 are both valid ids */
  return () => {
    let selector = $.OR(selectorAlt);
    if (!$.RECORDING_PHASE) {
      return new BasicSelector(selector.image, undefined, $.getLocationInfo(selector), this.context);
    }
  };
}

export function pseudoSelector(this: C, T: TokenMap, altContext?: AltContext) {
  const $ = this;
  const createPseudo = (name: string, arg?: Node) => {
    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      return new PseudoSelector({
        name,
        arg
      }, undefined, location, this.context);
    }
  };

  let selectorAlt = altContext ?? ((ctx: RuleContext) => [
    {
      ALT: () => {
        let name = $.CONSUME(T.NthPseudoClass);
        let val = $.SUBRULE($.nthValue);
        $.CONSUME(T.RParen);

        return createPseudo(name.image.slice(0, -1), val);
      }
    },
    {
      ALT: () => {
        let name = $.CONSUME(T.SelectorPseudoClass);
        let val = $.SUBRULE($.forgivingSelectorList, { ARGS: [ctx] });
        $.CONSUME2(T.RParen);

        return createPseudo(name.image.slice(0, -1), val);
      }
    },
    {
      ALT: () => {
        let name = $.CONSUME(T.Colon).image;
        $.OPTION({
          GATE: $.noSep,
          DEF: () => {
            name += $.CONSUME2(T.Colon).image;
          }
        });
        /**
         * We use OR often to assert that no whitespace is allowed.
         * There's no other way currently to do a positive-assertion Gate
         * in Chevrotain.
         */
        let values = $.OR4([
          {
            GATE: $.noSep,
            ALT: () => {
              let RECORDING_PHASE = $.RECORDING_PHASE;
              name += $.CONSUME(T.Ident).image;
              let values: Node[];
              if (!RECORDING_PHASE) {
                values = [];
              }
              let valuesLocation: LocationInfo;
              $.OPTION2(() => {
                $.CONSUME(T.LParen);
                $.startRule();
                $.MANY(() => {
                  let val = $.SUBRULE($.anyInnerValue);
                  if (!RECORDING_PHASE) {
                    values!.push(val);
                  }
                });
                if (!RECORDING_PHASE) {
                  valuesLocation = $.endRule();
                }
                $.CONSUME3(T.RParen);
              });
              if (!RECORDING_PHASE && values!.length) {
                return new Sequence(values!, undefined, valuesLocation!, this.context);
              }
            }
          }
        ]);
        return createPseudo(name, values);
      }
    }
  ]);

  // pseudoSelector
  //   : NTH_PSEUDO_CLASS '(' WS* nthValue WS* ')'
  //   | FUNCTIONAL_PSEUDO_CLASS '(' WS* forgivingSelectorList WS* ')'
  //   | COLON COLON? identifier ('(' anyInnerValue* ')')?
  //   ;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    return $.OR(selectorAlt(ctx));
  };
}

export function nthValue(this: C, T: TokenMap, alt?: Alt) {
  const $ = this;

  let valueAlt = alt ?? [
    { ALT: () => $.CONSUME(T.NthOdd) },
    { ALT: () => $.CONSUME(T.NthEven) },
    { ALT: () => $.CONSUME(T.Integer) },
    {
      ALT: () => {
        $.OR2([
          { ALT: () => $.CONSUME(T.NthDimension) },
          { ALT: () => $.CONSUME(T.NthDimensionSigned) }
        ]);
        $.OPTION(() => {
          $.OR3([
            { ALT: () => $.CONSUME(T.SignedInt) },
            {
              ALT: () => {
                $.CONSUME(T.Minus);
                $.CONSUME(T.UnsignedInt);
              }
            }
          ]);
        });
        $.OPTION2(() => {
          $.CONSUME(T.Of);
          $.SUBRULE($.complexSelector);
        });
      }
    }
  ];

  /**
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/:nth-child
   */
  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let startTokenOffset: number | undefined;
    if (!RECORDING_PHASE) {
      startTokenOffset = this.LA(1).startOffset;
    }

    $.OR(valueAlt);

    if (!RECORDING_PHASE) {
      /** Coelesce all token values into one value */
      let endTokenOffset = $.LA(-1).startOffset;
      let location = $.endRule();
      let origTokens = this.originalInput;
      let origLength = origTokens.length;
      let tokenValues = '';
      for (let i = 0; i < origLength; i++) {
        let token = origTokens[i]!;
        if (token.startOffset >= startTokenOffset!) {
          tokenValues += token.image;
        }
        if (token.startOffset > endTokenOffset) {
          break;
        }
      }
      return $.wrap(new Any(tokenValues, { role: 'any' }, location, this.context), 'both');
    }
  };
}

// attributeSelector
//   : LSQUARE WS* identifier (STAR | TILDE | CARET | DOLLAR | PIPE)? EQ WS* (identifier | STRING) WS* (ATTRIBUTE_FLAG WS*)? RSQUARE
//   ;
export function attributeSelector(this: C, T: TokenMap, alt?: Alt) {
  const $ = this;

  let valueAlt = alt ?? [
    {
      ALT: () => {
        let token = $.CONSUME2(T.Ident);
        if (!$.RECORDING_PHASE) {
          return new Any(token.image, { role: 'ident' }, $.getLocationInfo(token), this.context);
        }
      }
    },
    { ALT: () => $.SUBRULE($.string) }
  ];

  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    $.CONSUME(T.LSquare);
    let key = $.CONSUME(T.Ident);
    let op: IToken | undefined;
    let value: Node | undefined;
    let mod: IToken | undefined;
    $.OPTION(() => {
      op = $.OR([
        { ALT: () => $.CONSUME(T.Eq) },
        { ALT: () => $.CONSUME(T.AttrMatch) }
      ]);
      value = $.OR2(valueAlt);
    });
    $.OPTION2(() => mod = $.CONSUME(T.AttrFlag));
    $.CONSUME(T.RSquare);

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      return new AttributeSelector({
        name: key.image,
        op: op?.image,
        value,
        mod: mod?.image
      }, undefined, location, this.context);
    }
  };
}

export function compoundSelector(this: C, T: TokenMap) {
  const $ = this;
  /**
      A sequence of simple selectors that are not separated by
      a combinator.
        .e.g. `a#selected`
    */
  // compoundSelector
  //   : simpleSelector+
  //   ;
  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    let selectors:  SimpleSelector[];
    if (!RECORDING_PHASE) {
      selectors = [];
    }
    let sel = $.SUBRULE($.simpleSelector, { ARGS: [ctx] });
    if (!RECORDING_PHASE) {
      selectors!.push(sel);
    }
    $.MANY({
      /** Make sure we don't ignore space combinators */
      GATE: () => !$.hasWS(),
      DEF: () => {
        sel = $.SUBRULE2($.simpleSelector, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          /** Make sure we don't add implicit whitespace */
          sel.pre = 0;
          selectors.push(sel);
        }
      }
    });
    if (!RECORDING_PHASE) {
      if (selectors!.length === 1) {
        return selectors![0]!;
      }
      return new CompoundSelector(selectors!, undefined, undefined, this.context);
    }
  };
}

export function complexSelector(this: C, T: TokenMap) {
  const $ = this;

  /**
      A sequence of one or more simple and/or compound selectors
      that are separated by combinators.
        .e.g. a#selected > .icon
    */
  // complexSelector
  //   : compoundSelector (WS* (combinator WS*)? compoundSelector)*
  //   ;
  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let selectors: ComplexSelectorValue = [$.SUBRULE($.compoundSelector, { ARGS: [ctx] })];

    /**
     * Only space combinators and specified combinators will enter the MANY
     */
    $.MANY({
      GATE: () => $.hasWS() || tokenMatcher($.LA(1), T.Combinator),
      DEF: () => {
        let co: IToken | undefined;
        let combinator: Combinator;
        $.OPTION(() => {
          co = $.CONSUME(T.Combinator);
        });
        if (!RECORDING_PHASE) {
          if (co) {
            combinator = $.wrap(new Combinator(co.image, undefined, $.getLocationInfo(co), this.context), 'both');
          } else {
            /** Whitespace combinators are special */
            let startOffset = this.LA(1).startOffset;
            /**
             * This can be confusing at first, but a whitespace combinator
             * may not be a literal space character. It could be a newline,
             * for example. So we store it as an empty string, which we can
             * test against, and add the actual space character as pre/post
             * nodes.
             */
            combinator = new Combinator('', undefined, undefined, this.context);
            combinator.pre = $.getPrePost(startOffset);
          }
        }
        let compound: CompoundSelector = $.SUBRULE2($.compoundSelector, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          selectors.push(
            combinator!,
            compound
          );
        }
      }
    });

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      if (selectors.length === 1) {
        return selectors[0]!;
      }
      return new ComplexSelector(selectors as ComplexSelectorValue, undefined, location, this.context);
    }
  };
}
/**
    A selector representing an element relative to one or more
    anchor elements preceded by a combinator.
      e.g. + div#topic > #reference
  */
// relativeSelector
//   : (combinator WS*)? complexSelector
//   ;
export function relativeSelector(this: C, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    return $.OR([
      {
        ALT: () => {
          let co = $.CONSUME(T.Combinator);
          let complex: Node = $.SUBRULE($.complexSelector, { ARGS: [ctx] });

          if (!$.RECORDING_PHASE) {
            let combinator = new Combinator(co.image, undefined, $.getLocationInfo(co), this.context);
            if (complex instanceof ComplexSelector) {
              complex.value.unshift(combinator);
              let location = complex.location;
              location[0] = co.startOffset;
              location[1] = co.startLine;
              location[2] = co.startColumn;
            } else {
              complex = new ComplexSelector(
                [combinator, complex as ComplexSelectorComponent],
                undefined,
                $.getLocationFromNodes([combinator, complex]),
                this.context
              );
            }
          }
          return complex;
        }
      },
      {
        ALT: () => $.SUBRULE2($.complexSelector, { ARGS: [ctx] })
      }
    ]);
  };
}

export function forgivingSelectorList(this: C, T: TokenMap) {
  const $ = this;
  /**
      https://www.w3.org/TR/css-nesting-1/

      NOTE: implementers should throw a parsing
      error if the selectorlist starts with an identifier
    */
  // forgivingSelectorList
  //   : relativeSelector (WS* COMMA WS* relativeSelector)*
  //   ;
  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let sequences: ComplexSelector[];
    let i = 0;

    if (!RECORDING_PHASE) {
      sequences = [];
    }

    $.AT_LEAST_ONE_SEP({
      SEP: T.Comma,
      DEF: () => {
        let selector = $.SUBRULE($.relativeSelector, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          i++;
          if (i === 1 && ctx.qualifiedRule) {
            // Only attach post; leave pre for the parent Rules to lift comments
            sequences.push($.wrap(selector, true));
          } else {
            sequences.push($.wrap(selector, i === 1 ? true : 'both'));
          }
        }
      }
    });

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      if (sequences!.length === 1) {
        return sequences![0];
      }
      return new SelectorList(sequences!, undefined, location, this.context);
    }
  };
}

export function selectorList(this: C, T: TokenMap) {
  const $ = this;
  // selectorList
  //   : complexSelector (WS* COMMA WS* complexSelector)*
  //   ;
  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let i = 0;
    let sequences: ComplexSelector[];

    if (!RECORDING_PHASE) {
      sequences = [];
    }

    $.AT_LEAST_ONE_SEP({
      SEP: T.Comma,
      DEF: () => {
        let sel = $.SUBRULE2($.complexSelector, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          i++;
          // Do not consume leading pre for the first selector of a qualified rule,
          // so that pre-rule comments remain available to be lifted to Rules.
          if (i === 1 && ctx.qualifiedRule) {
            // Only attach post; leave pre for the parent Rules to lift comments
            sequences.push($.wrap(sel, true));
          } else {
            sequences.push($.wrap(sel, i === 1 ? true : 'both'));
          }
        }
      }
    });

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      if (sequences!.length === 1) {
        return sequences![0]!;
      }

      return new SelectorList(sequences!, undefined, location, this.context);
    }
  };
}

export function declarationList(this: C, T: TokenMap, alt?: Alt) {
  const $ = this;
  /** * Declarations ***/
  // https://www.w3.org/TR/css-syntax-3/#declaration-list-diagram
  // declarationList
  //   : WS* (
  //     declaration? (WS* SEMI declarationList)*
  //     | innerAtRule declarationList
  //     | innerQualifiedRule declarationList
  //   )
  //   ;
  /**
   * Originally this was structured much like the CSS spec,
   * like this:
   *  $.OPTION(() => $.SUBRULE($.declaration))
   *  $.OPTION2(() => {
   *     $.CONSUME(T.Semi)
   *     $.SUBRULE3($.declarationList)
   *   })
   * ...but chevrotain-allstar doesn't deal well with
   * recursivity, as it predicts the ENTIRE path for
   * each alt
   */

  let ruleAlt = alt ?? [
    { ALT: () => $.SUBRULE($.declaration) },
    { ALT: () => $.SUBRULE($.innerAtRule) },
    { ALT: () => $.SUBRULE2($.qualifiedRule, { ARGS: [{ inner: true }] }) },
    { ALT: () => $.CONSUME2(T.Semi) }
  ];

  return main.call(this, T, ruleAlt);
}

export function declaration(this: C, T: TokenMap, alt?: Alt) {
  const $ = this;

  let ruleAlt = alt ?? [
    {
      ALT: () => {
        let name: IToken;
        $.OR2([
          {
            ALT: () => name = $.CONSUME(T.Ident)
          },
          {
            GATE: () => $.legacyMode,
            ALT: () => name = $.CONSUME(T.LegacyPropIdent)
          }
        ]);
        let assign = $.CONSUME(T.Assign);
        let value = $.SUBRULE($.valueList);
        let important: IToken | undefined;
        $.OPTION(() => {
          important = $.CONSUME(T.Important);
        });
        if (!$.RECORDING_PHASE) {
          let nameNode = $.wrap(new Any(name!.image, { role: 'property' }, $.getLocationInfo(name!), this.context), true);
          return [nameNode, assign, value, important];
        }
      }
    },
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE;
        let name = $.CONSUME(T.CustomProperty);
        let assign = $.CONSUME2(T.Assign);
        let nodes: Node[];
        if (!RECORDING_PHASE) {
          nodes = [];
        }
        $.startRule();
        $.MANY(() => {
          let val = $.SUBRULE($.customValue);
          if (!RECORDING_PHASE) {
            nodes!.push(val);
          }
        });
        if (!RECORDING_PHASE) {
          let location = $.endRule();
          let nameNode = $.wrap(new Any(name.image, { role: 'property' }, $.getLocationInfo(name), this.context), true);
          let value = new Sequence(nodes!, undefined, location, this.context);
          return [nameNode, assign, value];
        }
      }
    }
  ];
  // declaration
  //   : identifier WS* COLON WS* valueList (WS* IMPORTANT)?
  //   | CUSTOM_IDENT WS* COLON CUSTOM_VALUE*
  //   ;
  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let name: Any<'property'> | undefined;
    let assign: IToken | undefined;
    let value: Node | undefined;
    let important: IToken | undefined;
    let val = $.OR(ruleAlt);

    if (!RECORDING_PHASE) {
      ([name, assign, value, important] = val);
    }

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      const isCustom = name!.valueOf().startsWith('--');
      return new (isCustom ? CustomDeclaration : Declaration)({
        name: name!,
        value: $.wrap(value!, 'both'),
        important: important ? $.wrap(new Any(important.image, { role: 'flag' }, $.getLocationInfo(important), this.context), 'both') : undefined
      }, { assign: assign!.image as AssignmentType }, location, this.context);
    }
  };
}

/**
 * @todo - This could be implemented with a multi-mode lexer?
 * Multi-modes was the right way to do it with Antlr, but
 * Chevrotain does not support recursive tokens very well.
 */
export function customValue(this: C, T: TokenMap, alt?: Alt) {
  const $ = this;

  /** Should be almost anything, but custom blocks need matching closers */
  // Order matters: prefer nested blocks first, then strings, then raw tokens.
  // Avoid knownFunctions here to remove ambiguity with custom blocks.
  let valueAlt = alt ?? [
    { ALT: () => $.SUBRULE($.customBlock) },
    { ALT: () => $.SUBRULE($.string) },
    {
      ALT: () => {
        const token = $.OR3([
          { ALT: () => $.CONSUME(T.Value) },
          { ALT: () => $.CONSUME(T.CustomProperty) },
          { ALT: () => $.CONSUME(T.Colon) },
          { ALT: () => $.CONSUME(T.AtName) },
          { ALT: () => $.CONSUME(T.Comma) },
          { ALT: () => $.CONSUME(T.Important) },
          { ALT: () => $.CONSUME(T.Unknown) }
        ]);
        if (!$.RECORDING_PHASE) {
          return $.wrap($.processValueToken(token));
        }
      }
    }
  ];

  return () => $.OR(valueAlt);
}

export function innerCustomValue(this: C, T: TokenMap, alt?: Alt) {
  const $ = this;

  let valueAlt = alt ?? [
    {
      ALT: () => {
        /** Can also have semi-colons */
        let semi = $.CONSUME(T.Semi);
        if (!$.RECORDING_PHASE) {
          return $.wrap(new Any(semi.image, { role: 'semi' }, $.getLocationInfo(semi), this.context));
        }
      }
    },
    { ALT: () => $.SUBRULE($.customValue) }
  ];

  return () => $.OR(valueAlt);
}

/**
 * Extra tokens in a custom property or general enclosed. Should include any
 * and every token possible (except semis), including unknown tokens.
 *
 * @todo - In tests, is there a way to test that every token is captured?
 */
export function extraTokens(this: C, T: TokenMap, alt?: Alt) {
  const $ = this;

  let valueAlt = alt ?? [
    { ALT: () => $.SUBRULE($.functionCallLike) },
    { ALT: () => $.CONSUME(T.Value) },
    { ALT: () => $.CONSUME(T.CustomProperty) },
    { ALT: () => $.CONSUME(T.Colon) },
    { ALT: () => $.CONSUME(T.AtName) },
    { ALT: () => $.CONSUME(T.Comma) },
    { ALT: () => $.CONSUME(T.Important) },
    { ALT: () => $.CONSUME(T.Unknown) }
  ];

  return () => {
    let node: Node = $.OR(valueAlt);
    if (!$.RECORDING_PHASE) {
      if (!(node instanceof Node)) {
        node = $.wrap($.processValueToken(node));
      }
      return node;
    }
  };
}

export function customBlock(this: C, T: TokenMap, alt?: Alt) {
  const $ = this;

  let blockAlt = alt ?? [
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE;
        let start: IToken;
        let end: IToken;
        let nodes: Node[];
        if (!RECORDING_PHASE) {
          nodes = [];
        }
        $.OR2([
          /**
           * All tokens that have a left parentheses.
           * These need to match a right parentheses.
           */
          { ALT: () => start = $.CONSUME(T.LParen) },
          { ALT: () => start = $.CONSUME(T.FunctionStart) },
          { ALT: () => start = $.CONSUME(T.FunctionalPseudoClass) }
        ]);

        $.MANY(() => {
          let val = $.SUBRULE($.innerCustomValue);
          if (!$.RECORDING_PHASE) {
            nodes!.push(val);
          }
        });
        end = $.CONSUME(T.RParen);
        return [start!, nodes!, end];
      }
    },
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE;
        let nodes: Node[];
        if (!RECORDING_PHASE) {
          nodes = [];
        }
        let start = $.CONSUME(T.LSquare);
        $.MANY2(() => {
          let val = $.SUBRULE2($.innerCustomValue);
          if (!RECORDING_PHASE) {
            nodes!.push(val);
          }
        });
        let end = $.CONSUME(T.RSquare);

        return [start, nodes!, end];
      }
    },
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE;
        let nodes: Node[];
        if (!RECORDING_PHASE) {
          nodes = [];
        }
        let start = $.CONSUME(T.LCurly);
        $.MANY3(() => {
          let val = $.SUBRULE3($.innerCustomValue);
          if (!RECORDING_PHASE) {
            nodes!.push(val);
          }
        });
        let end = $.CONSUME(T.RCurly);

        return [start, nodes!, end];
      }
    }
  ];

  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let start: IToken | undefined;
    let end: IToken | undefined;
    let nodes: Node[];

    let val = $.OR(blockAlt);

    if (!RECORDING_PHASE) {
      ([start, nodes, end] = val);
    }

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      let type: 'paren' | 'square' | 'curly' | undefined;
      switch (start!.image) {
        case '[':
          type = 'square';
          break;
        case '{':
          type = 'curly';
          break;
      }
      if (type) {
        // Preserve inner sequence post so trailing semicolons become part of block content
        const seqLoc = nodes!.length ? $.getLocationFromNodes(nodes!) : undefined;
        let seq = new Sequence(nodes!, undefined, seqLoc, this.context);
        if (type === 'paren') {
          return $.wrap(new Paren($.wrap(seq, true), undefined, location, this.context));
        }
        return $.wrap(new Block($.wrap(seq, true), { type }, location, this.context));
      } else {
        let startNode = $.wrap(new Any(start!.image, { role: 'any' }, $.getLocationInfo(start!), this.context));
        let endNode = $.wrap(new Any(end!.image, { role: 'any' }, $.getLocationInfo(end!), this.context));
        nodes = [startNode, ...nodes!, endNode];
        return new Sequence(nodes, undefined, location, this.context);
      }
    }
  };
}

export function valueList(this: C, T: TokenMap) {
  const $ = this;

  /** Values separated by commas */
  // valueList
  //   : value+ (, value+)*
  //   ;
  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let nodes: Node[];
    if (!RECORDING_PHASE) {
      nodes = [];
    }

    $.AT_LEAST_ONE_SEP({
      SEP: T.Comma,
      DEF: () => {
        let seq = $.SUBRULE($.valueSequence, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          nodes!.push(seq);
        }
      }
    });

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      if (nodes!.length === 1) {
        return nodes![0];
      }
      return new List(nodes!, undefined, location, this.context);
    }
  };
}

export function valueSequence(this: C, T: TokenMap) {
  const $ = this;

  /** Often space-separated */
  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let nodes: Node[];

    if (!RECORDING_PHASE) {
      nodes = [];
    }

    $.AT_LEAST_ONE(() => {
      let value = $.SUBRULE($.value, { ARGS: [ctx] });

      if (!RECORDING_PHASE) {
        nodes.push($.wrap(value));
      }
    });

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      if (nodes!.length === 1) {
        return $.wrap(nodes![0]!, true);
      }
      return $.wrap(new Sequence(nodes!, undefined, location, this.context), true);
    }
  };
}

export function squareValue(this: C, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME(T.LSquare);
    let ident = $.CONSUME(T.Ident);
    $.CONSUME(T.RSquare);
    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      let identNode = new Any(ident.image, { role: 'ident' }, $.getLocationInfo(ident), this.context);
      return new Block(identNode, { type: 'square' }, location, this.context);
    }
  };
}

// value
//   : WS
//   | identifier
//   | integer
//   | number
//   | dimension
//   | COLOR_IDENT_START
//   | COLOR_INT_START
//   | STRING
//   | function
//   | '[' identifier ']'
//   | unknownValue
//   ;
export function value(this: C, T: TokenMap, alt?: Alt) {
  const $ = this;

  let valueAlt = alt ?? [
    /** Function should appear before Ident */
    { ALT: () => $.SUBRULE($.functionCall) },
    { ALT: () => $.CONSUME(T.Ident) },
    { ALT: () => $.CONSUME(T.Dimension) },
    { ALT: () => $.CONSUME(T.Number) },
    { ALT: () => $.CONSUME(T.Color) },
    { ALT: () => $.SUBRULE($.string) },
    { ALT: () => $.SUBRULE($.squareValue) },
    {
      /** e.g. progid:DXImageTransform.Microsoft.Blur(pixelradius=2) */
      GATE: () => $.legacyMode,
      ALT: () => $.CONSUME(T.LegacyMSFilter)
    }
  ];

  return (ctx: RuleContext = {}) => {
    $.startRule();
    let node: Node = $.OR(valueAlt);
    /**
     * Allows slash separators. Note that, structurally, the meaning
     * of slash separators in CSS is inconsistent and ambiguous. It
     * could separate a sequence of tokens from another sequence,
     * or it could separate ONE token from another, with other tokens
     * not included in the "slash list", OR it can represent division
     * in a math expression. CSS is just, unfortunately, not a very
     * syntactically-consistent language, and each property's value
     * essentially has a defined "micro-syntax".
     */
    let additionalValue: Node | undefined;
    $.OPTION(() => {
      $.CONSUME(T.Slash);
      additionalValue = $.SUBRULE($.value);
    });
    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      if (!(node instanceof Node)) {
        node = $.processValueToken(node);
      }
      if (additionalValue) {
        return $.wrap(new List([$.wrap(node, true), additionalValue], { sep: '/' }, location, this.context));
      }
      return $.wrap(node);
    }
  };
}

export function string(this: C, T: TokenMap, alt?: Alt) {
  const $ = this;

  let stringAlt = alt ?? [
    {
      ALT: () => {
        $.startRule();
        let quote = $.CONSUME(T.SingleQuoteStart);
        let contents: IToken | undefined;
        $.OPTION(() => contents = $.CONSUME(T.SingleQuoteStringContents));
        $.CONSUME(T.SingleQuoteEnd);
        if (!$.RECORDING_PHASE) {
          let location = $.endRule();
          let value = contents?.image;
          return new Quoted(new Any(value ?? '', { role: 'any' }), { quote: quote.image as '"' | '\'' }, location, this.context);
        }
      }
    },
    {
      ALT: () => {
        $.startRule();
        let quote = $.CONSUME(T.DoubleQuoteStart);
        let contents: IToken | undefined;
        $.OPTION2(() => contents = $.CONSUME(T.DoubleQuoteStringContents));
        $.CONSUME(T.DoubleQuoteEnd);
        if (!$.RECORDING_PHASE) {
          let location = $.endRule();
          let value = contents?.image;
          return new Quoted(new Any(value ?? '', { role: 'any' }), { quote: quote.image as '"' | '\'' }, location, this.context);
        }
      }
    }
  ];

  return () => $.OR(stringAlt);
}

/** Implementers can decide to throw errors or warnings or not */
// unknownValue
//   : COLON
//   | EQ
//   | DOT
//   | ID
//   | UNKNOWN
//   | AT_RULE
//   ;
// $.RULE('unknownValue', () => {
//   $.OR([
//     { ALT: () => $.CONSUME(T.Colon) },
//     { ALT: () => $.CONSUME(T.Eq) },
//     { ALT: () => $.CONSUME(T.DotName) },
//     { ALT: () => $.CONSUME(T.HashName) },
//     { ALT: () => $.CONSUME(T.Unknown) },
//     { ALT: () => $.CONSUME(T.AtName) }
//   ])
// })

/** Abstracted for easy over-ride */
// $.RULE('expression', () => {
//   $.SUBRULE($.mathSum)
// })
export function mathSum(this: C, T: TokenMap) {
  const $ = this;

  let opAlt = [
    { ALT: () => $.CONSUME(T.Plus) },
    { ALT: () => $.CONSUME(T.Minus) }
  ];
  // mathSum
  //   : mathProduct (WS* ('+' | '-') WS* mathProduct)*
  //   ;
  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let left: Node = $.SUBRULE($.mathProduct);

    $.MANY(() => {
      let op = $.OR(opAlt);
      let right: Node = $.SUBRULE2($.mathProduct);

      if (!RECORDING_PHASE) {
        left = new Operation([left, op.image as Operator, right], { inCalc: true }, undefined, this.context);
      }
    });
    if (!RECORDING_PHASE) {
      left._location = $.endRule();
      return left;
    }
  };
}

// mathProduct
//   : mathValue (WS* ('*' | '/') WS* mathValue)*
//   ;
export function mathProduct(this: C, T: TokenMap) {
  const $ = this;

  let opAlt = [
    { ALT: () => $.CONSUME(T.Star) },
    { ALT: () => $.CONSUME(T.Divide) }
  ];

  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let left: Node = $.SUBRULE($.mathValue);

    $.MANY(() => {
      let op = $.OR(opAlt);
      let right: Node = $.SUBRULE2($.mathValue);

      if (!RECORDING_PHASE) {
        left = new Operation([left, op.image as Operator, right], { inCalc: true }, undefined, this.context);
      }
    });

    if (!RECORDING_PHASE) {
      left._location = $.endRule();
      return left;
    }
  };
}

// mathValue
//   : number
//   | dimension
//   | percentage
//   | mathConstant
//   | '(' WS* mathSum WS* ')'
//   ;
export function mathValue(this: C, T: TokenMap, alt?: Alt) {
  const $ = this;

  let valueAlt = alt ?? [
    { ALT: () => $.CONSUME(T.Number) },
    { ALT: () => $.CONSUME(T.Dimension) },
    // Allow identifiers like channel names in color space calcs (e.g., calc(l - 0.1))
    { ALT: () => $.CONSUME(T.Ident) },
    { ALT: () => $.CONSUME(T.MathConstant) },
    { ALT: () => $.SUBRULE($.knownFunctions) },
    { ALT: () => $.SUBRULE($.mathParen) }
  ];

  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    let node: Node = $.OR(valueAlt);
    if (!RECORDING_PHASE) {
      if (!(node instanceof Node)) {
        node = $.processValueToken(node);
      }
      return $.wrap(node, 'both');
    }
  };
}

export function mathParen(this: C, T: TokenMap) {
  const $ = this;

  return () => {
    $.startRule();
    $.CONSUME(T.LParen);
    let node = $.SUBRULE($.mathSum);
    $.CONSUME(T.RParen);
    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      return new Paren(node, undefined, location, this.context);
    }
  };
}

// function
//   : URL_FUNCTION
//   | VAR_FUNCTION '(' WS* CUSTOM_IDENT (WS* COMMA WS* valueList)? ')'
//   | CALC_FUNCTION '(' WS* mathSum WS* ')'
//   | identifier '(' valueList ')'
//   ;
// These have special parsing rules
export function knownFunctions(this: C, T: TokenMap, alt?: Alt) {
  const $ = this;

  let funcAlt = alt ?? [
    { ALT: () => $.SUBRULE($.urlFunction) },
    { ALT: () => $.SUBRULE($.varFunction) },
    { ALT: () => $.SUBRULE($.calcFunction) }
  ];

  return () => $.OR(funcAlt);
}

export function varFunction(this: C, T: TokenMap) {
  const $ = this;

  return () => {
    $.startRule();
    $.CONSUME(T.Var);
    let prop = $.CONSUME(T.CustomProperty);
    let args: List | undefined;
    $.OPTION(() => {
      $.CONSUME(T.Comma);
      args = $.SUBRULE($.valueList);
    });
    $.CONSUME(T.RParen);

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      let propNode = $.wrap(new Any(prop.image, { role: 'customprop' }, $.getLocationInfo(prop), this.context), 'both');
      if (!args) {
        args = new List([propNode], undefined, $.getLocationInfo(prop), this.context);
      } else {
        let { startOffset, startLine, startColumn } = prop;
        args.value.unshift(propNode);
        args.location[0] = startOffset;
        args.location[1] = startLine!;
        args.location[2] = startColumn!;
      }
      return new Call({
        name: 'var',
        args
      }, undefined, location, this.context);
    }
  };
}

export function calcFunction(this: C, T: TokenMap) {
  const $ = this;

  return () => {
    $.startRule();

    $.CONSUME(T.Calc);
    let args = $.SUBRULE($.mathSum);
    $.CONSUME2(T.RParen);

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      return new Call({
        name: 'calc',
        args: new List([args]).inherit(args)
      }, undefined, location, this.context);
    }
  };
}

export function urlFunction(this: C, T: TokenMap, alt?: Alt) {
  const $ = this;

  let valueAlt = alt ?? [
    { ALT: () => $.SUBRULE($.string) },
    { ALT: () => $.CONSUME(T.NonQuotedUrl) }
  ];

  return () => {
    $.startRule();

    $.CONSUME(T.UrlStart);
    let node: Any | IToken = $.OR(valueAlt);
    $.CONSUME(T.UrlEnd);

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      if (!(node instanceof Node)) {
        /** Whitespace should be included in the NonQuotedUrl */
        node = new Any(node.image, { role: 'urlvalue' }, $.getLocationInfo(node), this.context);
      }
      return new Url(node, undefined, location, this.context);
    }
  };
}

/**
    All At-rules according to spec are supposed to end with either
    a semi-colon or a curly-braced block. Some pre-processors
    (like PostCSS) allow the semi-colon to be optional, so we also
    allow it and insert it if it's missing.
  */
// atRule
//   : importAtRule
//   | mediaAtRule
//   | unknownAtRule
//   | pageAtRule
//   | fontFaceAtRule
//   | supportsAtRule
//   ;
export function atRule(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;

  let ruleAlt = alt ?? ((ctx?: RuleContext) => ([
    { ALT: () => $.SUBRULE($.containerAtRule, { ARGS: [!!ctx?.inner] }) },
    { ALT: () => $.SUBRULE($.scopeAtRule, { ARGS: [!!ctx?.inner] }) },
    { ALT: () => $.SUBRULE($.documentAtRule, { ARGS: [!!ctx?.inner] }) },
    { ALT: () => $.SUBRULE($.layerAtRule, { ARGS: [!!ctx?.inner] }) },
    { ALT: () => $.SUBRULE($.keyframesAtRule) },
    { ALT: () => $.SUBRULE($.importAtRule) },
    { ALT: () => $.SUBRULE($.mediaAtRule, { ARGS: [!!ctx?.inner] }) },
    { ALT: () => $.SUBRULE($.pageAtRule) },
    { ALT: () => $.SUBRULE($.fontFaceAtRule) },
    { ALT: () => $.SUBRULE($.supportsAtRule, { ARGS: [!!ctx?.inner] }) },
    { ALT: () => $.SUBRULE($.nestedAtRule) },
    { ALT: () => $.SUBRULE($.nonNestedAtRule) },
    { ALT: () => $.SUBRULE($.unknownAtRule) }
  ]));

  return (ctx?: RuleContext) => $.OR(ruleAlt(ctx));
}

/**
  Inner rules are mostly the same except they have a declarationList
  instead of a main block within {}
*/
// innerAtRule
//   : innerMediaAtRule
//   | unknownAtRule
//   ;
export function innerAtRule(this: C, T: TokenMap, alt?: Alt) {
  const $ = this;

  let ruleAlt = alt ?? [
    { ALT: () => $.SUBRULE($.containerAtRule, { ARGS: [true] }) },
    { ALT: () => $.SUBRULE($.scopeAtRule, { ARGS: [true] }) },
    { ALT: () => $.SUBRULE($.documentAtRule, { ARGS: [true] }) },
    { ALT: () => $.SUBRULE($.layerAtRule, { ARGS: [true] }) },
    { ALT: () => $.SUBRULE($.keyframesAtRule) },
    { ALT: () => $.SUBRULE($.mediaAtRule, { ARGS: [true] }) },
    { ALT: () => $.SUBRULE($.supportsAtRule, { ARGS: [true] }) },
    { ALT: () => $.SUBRULE($.nestedAtRule) },
    { ALT: () => $.SUBRULE($.unknownAtRule) }
  ];

  return () => $.OR(ruleAlt);
}

/**
 * @see https://www.w3.org/TR/css-nesting-1/#conditionals
 */
export function atRuleBody(this: C, T: TokenMap) {
  const $ = this;

  return (inner: boolean = false) =>
    $.OR([
      {
        GATE: () => !inner,
        ALT: () => $.SUBRULE($.main)
      },
      {
        GATE: () => inner,
        ALT: () => $.SUBRULE($.declarationList)
      }
    ]);
}

// mediaAtRule
//   : MEDIA_RULE WS* mediaQuery WS* LCURLY main RCURLY
//   ;
export function mediaAtRule(this: C, T: TokenMap) {
  const $ = this;

  return (inner?: boolean) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let name = $.CONSUME(T.AtMedia);
    let rules: Rules;
    let prelude: Node = $.SUBRULE($.mediaQueryList);
    $.CONSUME(T.LCurly);
    rules = $.SUBRULE($.atRuleBody, { ARGS: [inner] });
    $.CONSUME(T.RCurly);

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      return new AtRule({
        name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context), true),
        prelude: $.wrap(prelude, true),
        rules
      }, undefined, location, this.context);
    }
  };
}

export function mediaQueryList(this: C, T: TokenMap) {
  const $ = this;

  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let queries: Node[] = RECORDING_PHASE ? undefined as unknown as Node[] : [];
    $.AT_LEAST_ONE_SEP({
      SEP: T.Comma,
      DEF: () => {
        let query = $.SUBRULE($.mediaQuery);
        if (!RECORDING_PHASE) {
          queries.push(query);
        }
      }
    });

    if (!RECORDING_PHASE) {
      if (queries!.length === 1) {
        $.endRule();
        return queries![0]!;
      }
      return new List(queries!, undefined, $.endRule(), this.context);
    }
  };
}

/**
 * @see https://w3c.github.io/csswg-drafts/mediaqueries/#mq-syntax
 * Note, some of the spec had to be re-written for less ambiguity.
 * However, this is a spec-compliant implementation.
 */
// mediaQuery
//   : mediaCondition
//   | ((NOT | ONLY) WS*)? mediaType (WS* AND WS* mediaConditionWithoutOr)?
//   ;
export function mediaQuery(this: C, T: TokenMap, alt?: Alt) {
  const $ = this;

  let queryAlt = alt ?? [
    { ALT: () => $.SUBRULE($.mediaCondition) },
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();

        let token: IToken | undefined;
        let node: Node | undefined;
        let nodes: Node[];

        if (!RECORDING_PHASE) {
          nodes = [];
        }

        $.OPTION(() => {
          $.OR2([
            { ALT: () => token = $.CONSUME(T.Not) },
            { ALT: () => token = $.CONSUME(T.Only) }
          ]);
        });

        if (token && !RECORDING_PHASE) {
          nodes!.push($.wrap(new Any(token.image, { role: 'keyword' }, $.getLocationInfo(token), this.context)));
          token = undefined;
        }
        let type = $.SUBRULE($.mediaType);

        if (!RECORDING_PHASE) {
          nodes!.push(type);
        }

        $.OPTION2(() => {
          token = $.CONSUME(T.And);
          node = $.SUBRULE($.mediaConditionWithoutOr);
        });
        if (!RECORDING_PHASE) {
          if (token) {
            nodes!.push($.wrap(new Any(token.image, { role: 'keyword' }, $.getLocationInfo(token), this.context)));
          }
          if (node) {
            nodes!.push(node);
          }
        }
        if (!RECORDING_PHASE) {
          let location = $.endRule();
          return new QueryCondition(nodes!, undefined, location, this.context);
        }
      }
    }
  ];

  return () => $.OR(queryAlt);
}

/** Doesn't include only, not, and, or, layer */
// mediaType
//   : IDENT
//   | SCREEN
//   | PRINT
//   | ALL
//   ;
export function mediaType(this: C, T: TokenMap, alt?: Alt) {
  const $ = this;

  let typeAlt = alt ?? [
    { ALT: () => $.CONSUME(T.PlainIdent) },
    { ALT: () => $.CONSUME(T.Screen) },
    { ALT: () => $.CONSUME(T.Print) },
    { ALT: () => $.CONSUME(T.All) }
  ];

  return () => {
    let token = $.OR(typeAlt);
    if (!$.RECORDING_PHASE) {
      return $.wrap(new Any(token.image, { role: 'keyword' }, $.getLocationInfo(token), this.context));
    }
  };
}

// mediaCondition
//   : mediaNot | mediaInParens ( WS* (mediaAnd* | mediaOr* ))
//   ;
export function mediaCondition(this: C, T: TokenMap, alt?: Alt) {
  const $ = this;

  let conditionAlt = alt ?? [
    { ALT: () => $.SUBRULE($.mediaNot) },
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        let nodes: Node[];
        if (!RECORDING_PHASE) {
          nodes = [];
        }
        let node = $.SUBRULE($.mediaInParens);
        if (!RECORDING_PHASE) {
          nodes!.push(node);
        }
        $.MANY(() => {
          let rule =
            $.OR2([
              { ALT: () => $.SUBRULE($.mediaAnd) },
              { ALT: () => $.SUBRULE($.mediaOr) }
            ]);
          if (!RECORDING_PHASE) {
            nodes!.push(...rule);
          }
        });
        if (!RECORDING_PHASE) {
          let location = $.endRule();
          return new QueryCondition(nodes!, undefined, location, this.context);
        }
      }
    }
  ];

  return () => $.OR(conditionAlt);
}

// mediaConditionWithoutOr
//   : mediaNot | mediaInParens (WS* mediaAnd)*
//   ;
export function mediaConditionWithoutOr(this: C, T: TokenMap, alt?: Alt) {
  const $ = this;

  let conditionAlt = alt ?? [
    { ALT: () => $.SUBRULE($.mediaNot) },
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        let nodes: Node[];
        if (!RECORDING_PHASE) {
          nodes = [];
        }
        let node = $.SUBRULE($.mediaInParens);
        if (!RECORDING_PHASE) {
          nodes!.push(node);
        }
        $.MANY(() => {
          let rule = $.SUBRULE($.mediaAnd);
          if (!RECORDING_PHASE) {
            nodes!.push(...rule);
          }
        });

        if (!RECORDING_PHASE) {
          return new QueryCondition(nodes!, undefined, $.endRule(), this.context);
        }
      }
    }
  ];

  return () => $.OR(conditionAlt);
}

// mediaNot
//   : NOT WS* mediaInParens
//   ;
export function mediaNot(this: C, T: TokenMap) {
  const $ = this;

  return () => {
    $.startRule();

    let token = $.CONSUME(T.Not);
    let node = $.SUBRULE($.mediaInParens);

    if (!$.RECORDING_PHASE) {
      return new QueryCondition([
        $.wrap(new Any(token.image, { role: 'keyword' }, $.getLocationInfo(token), this.context)),
        node
      ], undefined, $.endRule(), this.context);
    }
  };
}

// mediaAnd
//   : AND WS* mediaInParens
//   ;
export function mediaAnd(this: C, T: TokenMap) {
  const $ = this;

  /** Returns an array */
  return () => {
    let token = $.CONSUME(T.And);
    let node = $.SUBRULE($.mediaInParens);

    if (!$.RECORDING_PHASE) {
      return [
        $.wrap(new Any(token.image, { role: 'keyword' }, $.getLocationInfo(token), this.context)),
        node
      ];
    }
  };
}

// mediaOr
//   : OR WS* mediaInParens
//   ;
export function mediaOr(this: C, T: TokenMap) {
  const $ = this;

  /** Returns an array */
  return () => {
    let token = $.CONSUME(T.Or);
    let node = $.SUBRULE($.mediaInParens);

    if (!$.RECORDING_PHASE) {
      return [
        $.wrap(new Any(token.image, { role: 'keyword' }, $.getLocationInfo(token), this.context)),
        node
      ];
    }
  };
}

// mediaInParens
//   : '(' WS* (mediaCondition | mediaFeature) WS* ')'
//   | generalEnclosed
//   ;
export function mediaInParens(this: C, T: TokenMap, alt?: Alt) {
  const $ = this;

  let conditionAlt = alt ?? [
    { ALT: () => $.SUBRULE($.mediaCondition) },
    { ALT: () => $.SUBRULE($.mediaFeature) }
  ];

  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.LParen);

    /*
     * CSS also allows for parentheses to contain
     * almost anything, including a wild sequence
     * of tokens (e.g. `@media (!!&) {}`), as it would
     * be up to the user agent to decide what the content
     * of the parentheses means. (CSS defines this as
     * "generalEnclosed" in the spec.)
     *
     * But that would mean that detecting errors in
     * parsing would not be possible. So we only parse
     * "known" media queries.
     */
    let node = $.OR2(conditionAlt);
    $.CONSUME(T.RParen);

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      return $.wrap(new Paren($.wrap(node, 'both'), undefined, location, this.context));
    }
  };
}

/**
    An identifier is a legal value, so it can be
    ambiguous which side of the expression we're on
    while parsing. The browser figures this out
    post-parsing.
  */
// mediaFeature
// : identifier (WS* (
//   COLON WS* mfValue
//   | mediaRange
//   | mfComparison WS* mfNonIdentifierValue
// ))?
// | mfNonIdentifierValue WS* (
//   mfComparison WS* identifier
//   | mediaRange
// )
// ;
export function mediaFeature(this: C, T: TokenMap, alt?: Alt) {
  const $ = this;

  let featureAlt = alt ?? [
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        let rule: Node | undefined;
        let ident = $.CONSUME(T.Ident);
        $.OPTION(() => {
          rule = $.OR2([
            {
              ALT: () => {
                $.CONSUME(T.Colon);
                let value = $.SUBRULE($.mfValue);
                if (!RECORDING_PHASE) {
                  let location = $.endRule();
                  return $.wrap(
                    new Declaration({
                      name: $.wrap(new Any(ident.image, { role: 'property' }), true),
                      value: $.wrap(value)
                    }, undefined, location, this.context),
                    'both');
                }
              }
            },
            {
              ALT: () => {
                let seq = $.SUBRULE($.mediaRange);
                if (!RECORDING_PHASE) {
                  let [startOffset, startLine, startColumn] = $.endRule();
                  seq.value.unshift($.wrap(new Any(ident.image, { role: 'ident' }, $.getLocationInfo(ident), this.context)));
                  seq.location[0] = startOffset;
                  seq.location[1] = startLine;
                  seq.location[2] = startColumn;
                }
                return seq;
              }
            },
            {
              ALT: () => {
                let op = $.SUBRULE($.mfComparison);
                let value = $.SUBRULE($.mfNonIdentifierValue);

                if (!RECORDING_PHASE) {
                  let location = $.endRule();
                  return new Sequence([
                    $.wrap(new Any(ident.image, { role: 'ident' }, $.getLocationInfo(ident), this.context)),
                    $.wrap(new Any(op.image, { role: 'keyword' }, $.getLocationInfo(op), this.context)),
                    value
                  ], undefined, location, this.context);
                }
              }
            }
          ]);
        });
        if (!RECORDING_PHASE && !rule) {
          let location = $.endRule();
          return $.wrap(new Any(ident.image, { role: 'keyword' }, location, this.context));
        }
        return rule;
      }
    },
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        let rule1 = $.SUBRULE2($.mfNonIdentifierValue);
        return $.OR3([
          {
            ALT: () => {
              let op = $.SUBRULE2($.mfComparison);
              let value = $.CONSUME2(T.Ident);
              if (!RECORDING_PHASE) {
                let location = $.endRule();
                return new Sequence([
                  rule1,
                  $.wrap(new Any(op.image, { role: 'keyword' }, $.getLocationInfo(op), this.context)),
                  $.wrap(new Any(value.image, { role: 'ident' }, $.getLocationInfo(value), this.context))
                ], undefined, location, this.context);
              }
            }
          },
          {
            ALT: () => {
              let seq = $.SUBRULE2($.mediaRange);
              if (!RECORDING_PHASE) {
                let [startOffset, startLine, startColumn] = $.endRule();
                seq.value.unshift(rule1);
                seq.location[0] = startOffset;
                seq.location[1] = startLine;
                seq.location[2] = startColumn;
                return seq;
              }
              return seq;
            }
          }
        ]);
      }
    }
  ];

  return () => $.OR(featureAlt);
}

/**
 * @note Both comparison operators have to match.
 */
// mediaRange
//   : mfLt WS* identifier (WS* mfLt WS* mfValue)?
//   | mfGt WS* identifier (WS* mfGt WS* mfValue)?
//   ;
export function mediaRange(this: C, T: TokenMap) {
  const $ = this;

  let rangeAlt: Array<IOrAlt<[IToken, IToken, IToken | undefined, Node | undefined]>> = [
    {
      ALT: () => {
        let op1 = $.CONSUME(T.MfLt);
        let val1 = $.CONSUME(T.Ident);
        let op2: IToken | undefined;
        let val2: Node | undefined;
        $.OPTION(() => {
          op2 = $.CONSUME2(T.MfLt);
          val2 = $.SUBRULE($.mfValue);
        });
        return [op1, val1, op2, val2];
      }
    },
    {
      ALT: () => {
        let op1 = $.CONSUME(T.MfGt);
        let val1 = $.CONSUME2(T.Ident);
        let op2: IToken | undefined;
        let val2: Node | undefined;
        $.OPTION2(() => {
          op2 = $.CONSUME2(T.MfGt);
          val2 = $.SUBRULE2($.mfValue);
        });
        return [op1, val1, op2, val2];
      }
    }
  ];

  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let op1: IToken;
    let val1: IToken;
    let op2: IToken | undefined;
    let val2: Node | undefined;

    let val = $.OR(rangeAlt);

    if (!RECORDING_PHASE) {
      ([op1, val1, op2, val2] = val);
    }

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      let nodes: Node[] = [
        $.wrap(new Any(op1!.image, { role: 'keyword' }, $.getLocationInfo(op1!), this.context)),
        $.wrap(new Any(val1!.image, { role: 'ident' }, $.getLocationInfo(val1!), this.context))
      ];
      if (op2) {
        nodes.push($.wrap(new Any(op2.image, { role: 'keyword' }, $.getLocationInfo(op2), this.context)));
        nodes.push($.wrap(val2!, 'both'));
      }
      return new Sequence(nodes, undefined, location, this.context);
    }
  };
}

// mfNonIdentifierValue
//   : number (WS* '/' WS* number)?
//   | dimension
//   ;
export function mfNonIdentifierValue(this: C, T: TokenMap, alt?: Alt) {
  const $ = this;

  let valueAlt = alt ?? [
    {
      ALT: () => {
        $.startRule();
        let num1 = $.CONSUME(T.Number);
        let num2: IToken | undefined;
        $.OPTION(() => {
          $.CONSUME(T.Slash);
          num2 = $.CONSUME2(T.Number);
        });
        if (!$.RECORDING_PHASE) {
          let location = $.endRule();
          let num1Node = $.wrap($.processValueToken(num1), 'both');
          if (!num2) {
            return num1Node;
          }
          let num2Node = $.wrap($.processValueToken(num2), 'both');
          return new List([num1Node, num2Node], { sep: '/' }, location, this.context);
        }
      }
    },
    {
      ALT: () => {
        let dim = $.CONSUME(T.Dimension);
        if (!$.RECORDING_PHASE) {
          return $.wrap($.processValueToken(dim), 'both');
        }
      }
    }
  ];

  return () => $.OR(valueAlt);
}

// mfValue
//   : mfNonIdentifierValue | identifier
//   ;
export function mfValue(this: C, T: TokenMap) {
  const $ = this;

  let valueAlt = [
    { ALT: () => $.SUBRULE($.mfNonIdentifierValue) },
    {
      ALT: () => {
        let token = $.CONSUME(T.Ident);
        if (!$.RECORDING_PHASE) {
          return $.wrap(new Any(token.image, { role: 'ident' }, $.getLocationInfo(token), this.context));
        }
      }
    }
  ];

  return () => $.OR(valueAlt);
}

// mfComparison
//   : mfLt | mfGt | mfEq
//   ;
export function mfComparison(this: C, T: TokenMap) {
  const $ = this;

  let comparisonAlt = [
    { ALT: () => $.CONSUME(T.MfLt) },
    { ALT: () => $.CONSUME(T.MfGt) },
    { ALT: () => $.CONSUME(T.Eq) }
  ];

  return () => $.OR(comparisonAlt);
}

/**
 * @see https://www.w3.org/TR/css-page-3/
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@page
 */
export function pageAtRule(this: C, T: TokenMap) {
  const $ = this;

  return () => {
    $.startRule();

    let name = $.CONSUME(T.AtPage);
    let selector: Node[] = [];
    $.MANY_SEP({
      SEP: T.Comma,
      DEF: () => selector.push($.SUBRULE($.pageSelector))
    });
    $.CONSUME(T.LCurly);
    let rules = $.SUBRULE($.declarationList);
    $.CONSUME(T.RCurly);

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      return new AtRule({
        name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context), true),
        prelude: selector.length ? $.wrap(new List(selector, undefined, $.getLocationFromNodes(selector), this.context), true) : undefined,
        rules
      }, undefined, location, this.context);
    }
  };
}

export function pageSelector(this: C, T: TokenMap) {
  const $ = this;

  return () => {
    $.startRule();
    let token = '';

    $.OPTION(() => token += $.CONSUME(T.Ident).image);
    $.MANY({
      GATE: () => $.LA(1).tokenType === T.Colon && $.noSep(1),
      DEF: () => {
        token += $.CONSUME(T.Colon).image;
        token += $.CONSUME(T.PagePseudoClassKeywords).image;
      }
    });

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      return $.wrap(new BasicSelector(token, undefined, location, this.context));
    }
  };
}

// fontFaceAtRule
//   : FONT_FACE_RULE WS* LCURLY declarationList RCURLY
//   ;
export function fontFaceAtRule(this: C, T: TokenMap) {
  const $ = this;

  return () => {
    $.startRule();

    let name = $.CONSUME(T.AtFontFace);
    $.CONSUME(T.LCurly);
    let rules = $.SUBRULE($.declarationList);
    $.CONSUME(T.RCurly);

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      return new AtRule({
        name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context), true),
        rules
      }, undefined, location, this.context);
    }
  };
}

// keyframesAtRule
//   : (AT_KEYFRAMES | vendorKeyframes) WS* IDENT WS* '{' keyframeBlock* '}'
//   ;
export function keyframesAtRule(this: C, T: TokenMap) {
  const $ = this;

  return () => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    const atTok = $.CONSUME(T.AtKeyframes);
    // prelude: a single animation name
    let preludeNode: Node | undefined = $.SUBRULE($.keyframesName);
    $.CONSUME(T.LCurly);

    // keyframe blocks: selectors are percentages or 'from'/'to'
    const blocks: Node[] = RECORDING_PHASE ? ([] as unknown as Node[]) : [];
    $.MANY2(() => {
      $.startRule();
      // selector list for keyframes
      const selectors: Node[] = RECORDING_PHASE ? ([] as unknown as Node[]) : [];
      $.AT_LEAST_ONE_SEP({
        SEP: T.Comma,
        DEF: () => {
          const sel = $.OR2([
            { ALT: () => $.CONSUME(T.From) },
            { ALT: () => $.CONSUME(T.To) },
            { ALT: () => $.CONSUME(T.DimensionInt) }, // handles 0%
            { ALT: () => $.CONSUME(T.DimensionNum) }  // handles 12.5%
          ]);
          if (!RECORDING_PHASE) {
            const node = $.processValueToken(sel);
            // Do not consume leading pre for the first selector in a keyframe block,
            // so comments immediately after '{' are liftable to the keyframes Rules.
            selectors.push($.wrap(node, selectors.length === 0 ? true : 'both'));
          }
        }
      });
      $.CONSUME2(T.LCurly);
      const decls = $.SUBRULE($.declarationList);
      $.CONSUME(T.RCurly);
      if (!RECORDING_PHASE) {
        const loc = $.endRule();
        // Reuse Ruleset node shape: selector is a list, rules are decls
        blocks.push(new Ruleset({
          selector: new SelectorList(selectors as any, undefined, $.getLocationFromNodes(selectors as any), this.context) as any,
          rules: decls
        } as any, undefined, loc, this.context));
      }
    });

    const endTok = $.CONSUME2(T.RCurly);

    if (!$.RECORDING_PHASE) {
      return new AtRule({
        name: $.wrap(new Any(atTok.image, { role: 'atkeyword' }, $.getLocationInfo(atTok), this.context), true),
        prelude: preludeNode ? $.wrap(preludeNode, 'both') : undefined,
        // Include isolated comments inside the keyframes body
        rules: $.getRulesWithComments(blocks, $.getLocationInfo(endTok))
      }, undefined, $.endRule(), this.context);
    }
  };
}

/**
 * Keyframes name prelude
 * CSS: Ident | String
 */
export function keyframesName(this: C, T: TokenMap) {
  const $ = this;
  return () => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    let node: Node | undefined;
    $.OR({
      DEF: [
        { ALT: () => {
          const tok = $.CONSUME(T.Ident);
          if (!RECORDING_PHASE) node = $.wrap($.processValueToken(tok));
        } },
        { ALT: () => node = $.SUBRULE($.string) }
      ]
    });
    return node!;
  };
}

// containerAtRule: @container <prelude>? { main }
export function containerAtRule(this: C, T: TokenMap) {
  const $ = this;
  return (inner?: boolean) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    const name = $.CONSUME(T.AtContainer);
    const preludeNodes: Node[] = !RECORDING_PHASE ? [] : undefined as unknown as Node[];
    $.MANY(() => {
      const node = $.SUBRULE($.anyOuterValue);
      if (!RECORDING_PHASE) {
        preludeNodes.push($.wrap(node));
      }
    });
    $.CONSUME(T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [inner] });
    $.CONSUME(T.RCurly);
    if (!$.RECORDING_PHASE) {
      return new AtRule({
        name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context), true),
        prelude: preludeNodes.length ? $.wrap(new Sequence(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), this.context), 'both') : undefined,
        rules
      }, undefined, $.endRule(), this.context);
    }
  };
}

// scopeAtRule: @scope <prelude>? { main }
export function scopeAtRule(this: C, T: TokenMap) {
  const $ = this;
  return (inner?: boolean) => {
    $.startRule();
    const name = $.CONSUME(T.AtScope);
    const preludeNodes: Node[] = [];
    $.MANY(() => preludeNodes.push($.wrap($.SUBRULE($.anyOuterValue))));
    $.CONSUME(T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [inner] });
    $.CONSUME(T.RCurly);
    if (!$.RECORDING_PHASE) {
      return new AtRule({
        name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context), true),
        prelude: preludeNodes.length ? $.wrap(new Sequence(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), this.context), 'both') : undefined,
        rules
      }, undefined, $.endRule(), this.context);
    }
  };
}

// documentAtRule (non-standard): @document <prelude>? { main }
export function documentAtRule(this: C, T: TokenMap) {
  const $ = this;
  return (inner?: boolean) => {
    $.startRule();
    const name = $.CONSUME(T.AtDocument);
    const preludeNodes: Node[] = [];
    $.MANY(() => preludeNodes.push($.wrap($.SUBRULE($.anyOuterValue))));
    $.CONSUME(T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [inner] });
    $.CONSUME(T.RCurly);
    if (!$.RECORDING_PHASE) {
      return new AtRule({
        name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context), true),
        prelude: preludeNodes.length ? $.wrap(new Sequence(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), this.context), 'both') : undefined,
        rules
      }, undefined, $.endRule(), this.context);
    }
  };
}

/**
 * `@layer` at rule
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@layer
 *
 * `@layer` =
 * `@layer` <layer-name>? { <rule-list> }  |
 * `@layer` <layer-name># ;
 *
 * `<layer-name>` =
 * <ident> [ '.' <ident> ]*
 */
export function layerAtRule(this: C, T: TokenMap) {
  const $ = this;
  return (inner?: boolean) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    const atTok = $.CONSUME(T.AtLayer);

    // Optional single layer-name before a block, or first of a comma list in statement form
    const preludeNodes: Node[] = RECORDING_PHASE ? ([] as unknown as Node[]) : [];

    return $.OR([
      {
        ALT: () => {
          $.OPTION(() => {
            const nameNode: Node = $.SUBRULE($.layerName);
            if (!RECORDING_PHASE) {
              preludeNodes.push($.wrap(nameNode));
            }
          });
          $.CONSUME(T.LCurly);
          const rules = $.SUBRULE($.atRuleBody, { ARGS: [inner] });
          $.CONSUME(T.RCurly);
          if (!RECORDING_PHASE) {
            return new AtRule({
              name: $.wrap(new Any(atTok.image, { role: 'atkeyword' }, $.getLocationInfo(atTok), this.context), true),
              prelude: preludeNodes.length ? $.wrap(new Sequence(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), this.context), 'both') : undefined,
              rules
            }, undefined, $.endRule(), this.context);
          }
        }
      },
      {
        ALT: () => {
          $.MANY_SEP({
            SEP: T.Comma,
            DEF: () => {
              let nameNode: Node = $.SUBRULE2($.layerName);
              if (!RECORDING_PHASE) {
                preludeNodes.push($.wrap(nameNode));
              }
            }
          });
          $.CONSUME(T.Semi);
          if (!RECORDING_PHASE) {
            return new AtRule({
              name: $.wrap(new Any(atTok.image, { role: 'atkeyword' }, $.getLocationInfo(atTok), this.context), true),
              prelude: preludeNodes.length ? $.wrap(new List(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), this.context), 'both') : undefined
            }, undefined, $.endRule(), this.context);
          }
        }
      }
    ]);
  };
}

/**
 * <layer-name> = <ident> ('.' <ident>)*
 */
export function layerName(this: C, T: TokenMap) {
  const $ = this;
  return () => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    const nodes: Node[] = RECORDING_PHASE ? ([] as unknown as Node[]) : [];

    const first = $.CONSUME(T.Ident);
    if (!RECORDING_PHASE) {
      nodes.push($.wrap($.processValueToken(first)));
    }

    $.MANY({
      GATE: $.noSep,
      DEF: () => {
        const seg = $.CONSUME(T.DotName);
        if (!RECORDING_PHASE) {
          nodes.push($.wrap($.processValueToken(seg)));
        }
      }
    });

    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      return new Sequence(nodes, undefined, loc, this.context);
    }
  };
}

/**
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@supports
   */
// supportsAtRule
//   : SUPPORTS_RULE WS* supportsCondition WS* LCURLY main RCURLY
//   ;
export function supportsAtRule(this: C, T: TokenMap) {
  const $ = this;

  return (inner?: boolean) => {
    $.startRule();

    let name = $.CONSUME(T.AtSupports);
    let prelude = $.SUBRULE($.supportsCondition);
    $.CONSUME(T.LCurly);
    let rules = $.SUBRULE($.atRuleBody, { ARGS: [inner] });
    $.CONSUME(T.RCurly);

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      return new AtRule({
        name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context), true),
        prelude: $.wrap(prelude, 'both'),
        rules
      }, undefined, location, this.context);
    }
  };
}

/** spec-compliant but simplified */
// supportsCondition
//   : NOT supportsInParens
//   | supportsInParens (WS* AND supportsInParens)*
//   | supportsInParens (WS* OR supportsInParens)*
//   ;
export function supportsCondition(this: C, T: TokenMap) {
  const $ = this;

  let conditionAlt = [
    {
      GATE: () => $.LA(1).tokenType === T.Not,
      ALT: () => {
        $.startRule();
        let keyword = $.CONSUME(T.Not);
        let value = $.SUBRULE($.supportsInParens);

        if (!$.RECORDING_PHASE) {
          let location = $.endRule();
          return new QueryCondition([
            $.wrap(new Any(keyword.image, { role: 'keyword' }, $.getLocationInfo(keyword), this.context)),
            value
          ], undefined, location, this.context);
        }
      }
    },
    {
      GATE: () => $.LA(1).tokenType !== T.Not,
      ALT: () => {
        let start = $.startRule();
        let RECORDING_PHASE = $.RECORDING_PHASE;
        let [startOffset, startLine, startColumn] = start ?? [];

        let left = $.SUBRULE2($.supportsInParens);

        /**
         * Can be followed by many ands or many ors
         */
        $.OR2([
          {
            ALT: () => {
              $.AT_LEAST_ONE(() => {
                let keyword = $.CONSUME(T.And);
                let right: Node = $.SUBRULE3($.supportsInParens);
                if (!RECORDING_PHASE) {
                  let [,,,endOffset, endLine, endColumn] = right.location;
                  left = new QueryCondition([
                    left,
                    $.wrap(new Any(keyword.image, { role: 'keyword' }, $.getLocationInfo(keyword), this.context)),
                    right
                  ], undefined, [startOffset!, startLine!, startColumn!, endOffset!, endLine!, endColumn!], this.context);
                }
              });
            }
          },
          {
            ALT: () => {
              $.AT_LEAST_ONE2(() => {
                let keyword = $.CONSUME(T.Or);
                let right: Node = $.SUBRULE5($.supportsInParens);
                if (!RECORDING_PHASE) {
                  let [,,,endOffset, endLine, endColumn] = right.location;
                  left = new QueryCondition([
                    left,
                    $.wrap(new Any(keyword.image, { role: 'keyword' }, $.getLocationInfo(keyword), this.context)),
                    right
                  ], undefined, [startOffset!, startLine!, startColumn!, endOffset!, endLine!, endColumn!], this.context);
                }
              });
            }
          },
          {
            ALT: EMPTY_ALT()
          }
        ]);

        if (!RECORDING_PHASE) {
          $.endRule();
        }

        return left;
      }
    }
  ];

  return () => $.OR(conditionAlt);
}

// supportsInParens
// : '(' WS* supportsCondition WS* ')'
// | '(' WS* declaration WS* ')'
// | generalEnclosed
// ;
export function supportsInParens(this: C, T: TokenMap) {
  const $ = this;

  let conditionAlt = [
    {
      ALT: () => {
        $.startRule();
        /** Function-like call */
        let name = $.CONSUME(T.Ident);
        let args: List | undefined;
        $.OR2([
          {
            GATE: $.noSep,
            ALT: () => {
              $.CONSUME(T.LParen);
              args = $.SUBRULE($.valueList);
              $.CONSUME(T.RParen);
            }
          }
        ]);

        if (!$.RECORDING_PHASE) {
          let location = $.endRule();
          return new Call({
            name: name.image,
            args
          }, undefined, location, this.context);
        }
      }
    },
    {
      ALT: () => {
        $.startRule();
        let values: Node[] = [];
        $.CONSUME2(T.LParen);
        /**
         * Intentionally omits "generalEnclosed" from spec.
         * See the note on media queries.
         */
        let value = $.OR3([
          { ALT: () => $.SUBRULE($.supportsCondition) },
          { ALT: () => $.SUBRULE($.declaration) }
        ]);
        $.CONSUME2(T.RParen);

        if (!$.RECORDING_PHASE) {
          let location = $.endRule();
          if (!(value instanceof Node)) {
            value = new Sequence(values, undefined, $.getLocationFromNodes(values), this.context);
          }
          return $.wrap(new Paren($.wrap(value, 'both'), undefined, location, this.context));
        }
      }
    }
  ];

  return () => $.OR(conditionAlt);
}

/** Used within anyOuterValue  */
export function functionCallLike(this: C, T: TokenMap) {
  const $ = this;
  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    const name = $.CONSUME(T.FunctionStart);
    let args: Node[] = !RECORDING_PHASE ? [] : undefined as unknown as Node[];
    let seq: Sequence | undefined;
    let list: List | undefined;
    $.MANY({
      GATE: () => {
        let tt = $.LA(1).tokenType;
        return tt !== T.RParen && tt !== T.UrlEnd;
      },
      DEF: () => {
        const node = $.SUBRULE($.anyOuterValue);
        if (!RECORDING_PHASE) {
          args.push($.wrap(node));
        }
      }
    });
    if (!RECORDING_PHASE) {
      let location = args.length ? $.getLocationFromNodes(args) : undefined;
      if (args.length) {
        seq = new Sequence(args, undefined, location, this.context);
      }
      list = $.wrap(new List(seq ? [seq] : [], undefined, location, this.context), true);
    }
    $.OR([
      { ALT: () => $.CONSUME(T.RParen) },
      { ALT: () => $.CONSUME(T.UrlEnd) }
    ]);
    if (!RECORDING_PHASE) {
      const location = $.endRule();
      return $.wrap(new Call({ name: name.image.slice(0, -1), args: list }, undefined, location, this.context));
    }
  };
}

export function functionCall(this: C, T: TokenMap, alt?: Alt) {
  const $ = this;

  let funcAlt = alt ?? [
    {
      // Disambiguate known functions by their dedicated tokens
      GATE: () => {
        let tokenType = $.LA(1).tokenType;
        return tokenType === T.UrlStart
          || tokenType === T.Var
          || tokenType === T.Calc;
      },
      ALT: () => $.SUBRULE($.knownFunctions)
    },
    {
      GATE: () => {
        let tokenType = $.LA(1).tokenType;
        return tokenType !== T.UrlStart
          && tokenType !== T.Var
          && tokenType !== T.Calc;
      },
      ALT: () => {
        $.startRule();

        let name = $.CONSUME(T.FunctionStart);
        let args: List | undefined;

        $.OPTION(() => args = $.SUBRULE($.functionCallArgs));
        $.CONSUME(T.RParen);

        if (!$.RECORDING_PHASE) {
          let location = $.endRule();
          return new Call({
            name: name.image.slice(0, -1),
            args
          }, undefined, location, this.context);
        }
      }
    }
  ];

  return () => $.OR(funcAlt);
}

/**
 * Originally, function arguments always had commas,
 * but it looks like that might be expanded in the
 * future in CSS to allow for semi-colon separators.
 * with the same rationale of why this was introduced
 * by Less (that values can already have commas).
 *
 * @see https://drafts.csswg.org/css-values-4/#interpolate
 *
 * @todo - if a function is introduced where semi-colons
 * are separators AND only 1 argument is required, then
 * that will have to be specially handled.
 */
export function functionCallArgs(this: C, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let node = $.SUBRULE($.valueSequence, { ARGS: [ctx] });

    let commaNodes: Node[];
    let semiNodes: Node[];
    if (!RECORDING_PHASE) {
      commaNodes = [$.wrap(node, true)];
      semiNodes = [];
    }
    let isSemiList = false;

    $.MANY(() => {
      $.OR([
        {
          GATE: () => !isSemiList,
          ALT: () => {
            $.CONSUME(T.Comma);
            node = $.SUBRULE2($.valueSequence, { ARGS: [ctx] });
            if (!RECORDING_PHASE) {
              commaNodes!.push($.wrap(node, true));
            }
          }
        },
        {
          ALT: () => {
            isSemiList = true;

            $.CONSUME(T.Semi);

            if (!RECORDING_PHASE) {
              /** Aggregate the previous set of comma-nodes */
              if (commaNodes.length > 1) {
                let commaList = new List(commaNodes, undefined, $.getLocationFromNodes(commaNodes), this.context);
                semiNodes.push(commaList);
              } else {
                semiNodes.push(commaNodes[0]!);
              }
            }
            node = $.SUBRULE3($.valueList, { ARGS: [ctx] });
            if (!RECORDING_PHASE) {
              semiNodes.push($.wrap(node, true));
            }
          }
        }
      ]);
    });

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      let nodes = isSemiList ? semiNodes! : commaNodes!;
      let sep: ';' | ',' = isSemiList ? ';' : ',';
      return $.wrap(new List(nodes, { sep }, location, this.context), 'both');
    }
  };
}

// https://www.w3.org/TR/css-cascade-4/#at-import
// importAtRule
//   : IMPORT_RULE WS* (URL_FUNCTION | STRING) (WS* SUPPORTS_FUNCTION WS* (supportsCondition | declaration))? (WS* mediaQuery)? SEMI
//   ;
export function importAtRule(this: C, T: TokenMap) {
  const $ = this;

  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let name = $.CONSUME(T.AtImport);
    let preludeNodes: Node[];
    if (!RECORDING_PHASE) {
      preludeNodes = [];
    }
    let node = $.SUBRULE($.importPrelude) as Node;

    if (!RECORDING_PHASE) {
      preludeNodes!.push($.wrap(node));
    }

    let extraNodes: Node[] | undefined;
    $.OPTION(() => {
      extraNodes = $.SUBRULE($.importPostlude) as Node[];
    });
    if (!RECORDING_PHASE && extraNodes && extraNodes.length) {
      for (const n of extraNodes) preludeNodes!.push(n);
    }
    $.CONSUME(T.Semi);

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      return new AtRule({
        name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context), true),
        prelude: new Sequence(preludeNodes!, undefined, $.getLocationFromNodes(preludeNodes!), this.context)
      }, undefined, location, this.context);
    }
  };
}

/** import prelude: url(...) or "string" */
export function importPrelude(this: C, T: TokenMap) {
  const $ = this;
  return () => {
    return $.OR([
      { ALT: () => $.SUBRULE($.urlFunction) },
      { ALT: () => $.SUBRULE($.string) }
    ]);
  };
}

/** import postlude: optional layer(), supports(), media. Returns Node[] */
export function importPostlude(this: C, T: TokenMap) {
  const $ = this;
  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    let nodes: Node[] | undefined;
    if (!RECORDING_PHASE) nodes = [];

    /** layer(responsive) */
    $.OPTION(() => {
      let start = $.CONSUME(T.Layer);
      let value: Node = $.SUBRULE($.layerName);
      let end = $.CONSUME(T.RParen);
      if (!RECORDING_PHASE) {
        let { startOffset, startLine, startColumn } = start;
        let { endOffset, endLine, endColumn } = end;
        let location: LocationInfo = [startOffset, startLine!, startColumn!, endOffset!, endLine!, endColumn!];
        nodes!.push(
          $.wrap(
            new Call({
              name: 'layer',
              args: new List([value], undefined, value._location as LocationInfo, this.context)
            }, undefined, location, this.context)
          )
        );
      }
    });

    /** supports(display: grid) */
    $.OPTION2(() => {
      let start = $.CONSUME(T.Supports);
      let value = $.OR4([
        { ALT: () => $.SUBRULE($.supportsCondition) },
        { ALT: () => $.SUBRULE($.declaration) }
      ]);
      let end = $.CONSUME2(T.RParen);
      if (!RECORDING_PHASE) {
        let { startOffset, startLine, startColumn } = start;
        let { endOffset, endLine, endColumn } = end;
        let location: LocationInfo = [startOffset, startLine!, startColumn!, endOffset!, endLine!, endColumn!];
        nodes!.push(
          $.wrap(
            new Call({
              name: 'supports',
              args: $.wrap(value, 'both')
            }, undefined, location, this.context)
          )
        );
      }
    });

    /** media query list */
    $.OPTION3(() => {
      let mediaNode = $.SUBRULE($.mediaQueryList);
      if (!RECORDING_PHASE) nodes!.push(mediaNode);
    });

    return nodes!;
  };
}

/**
 * @todo - add more structure for known nested at-rules.
 */
export function nestedAtRule(this: C, T: TokenMap) {
  const $ = this;

  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let name = $.CONSUME(T.AtNested);
    let preludeNodes: Node[];
    let rules: Rules;

    if (!RECORDING_PHASE) {
      preludeNodes = [];
    }

    $.MANY(() => {
      let value = $.SUBRULE($.anyOuterValue);
      if (!RECORDING_PHASE) {
        preludeNodes.push($.wrap(value));
      }
    });
    $.CONSUME(T.LCurly);
    // All known nested at-rules use declaration lists in their blocks
    rules = $.SUBRULE($.declarationList);
    $.CONSUME(T.RCurly);

    if (!$.RECORDING_PHASE) {
      return new AtRule({
        name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context), true),
        prelude: preludeNodes!.length ? $.wrap(new Sequence(preludeNodes!, undefined, $.getLocationFromNodes(preludeNodes!), this.context), 'both') : undefined,
        rules
      }, undefined, $.endRule(), this.context);
    }
  };
}

export function nonNestedAtRule(this: C, T: TokenMap) {
  const $ = this;

  return () => {
    $.startRule();
    let preludeNodes: Node[] = [];

    let name = $.CONSUME(T.AtNonNested);
    $.MANY(() => preludeNodes.push($.wrap($.SUBRULE($.anyOuterValue))));
    $.CONSUME(T.Semi);

    if (!$.RECORDING_PHASE) {
      return new AtRule({
        name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context), true),
        prelude: $.wrap(new Sequence(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), this.context))
      }, undefined, $.endRule(), this.context);
    }
  };
}

// unknownAtRule
//   : AT_RULE anyOuterValue* (SEMI | LCURLY anyInnerValue* RCURLY)
//   ;
export function unknownAtRule(this: C, T: TokenMap) {
  const $ = this;

  return () => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let preludeNodes: Node[];
    let ruleNodes: Node[];
    let declRules: Rules | undefined;
    let endToken: IToken | undefined;
    let innerBlockLocation: LocationInfo | undefined;

    if (!RECORDING_PHASE) {
      preludeNodes = [];
    }

    let name = $.CONSUME(T.AtKeyword);
    $.MANY(() => {
      let val = $.SUBRULE($.anyOuterValue);
      if (!RECORDING_PHASE) {
        preludeNodes.push($.wrap(val, 'both'));
      }
    });
    $.OR([
      { ALT: () => $.CONSUME(T.Semi) },
      {
        ALT: () => {
          if (!RECORDING_PHASE) {
            ruleNodes = [];
          }
          $.CONSUME(T.LCurly);
          // Mark inner-content start to ensure a stable location even when empty
          $.startRule();
          // 1) Fast selector/nested-at-rule start gate
          const t1 = $.LA(1).tokenType;
          const t2 = $.LA(2).tokenType;
          const isRuleStart = (
            t1 === T.DotName
            || t1 === T.HashName
            || t1 === T.Ampersand
            || t1 === T.LSquare
            || t1 === T.SelectorPseudoClass
            || t1 === T.NthPseudoClass
            || t1 === T.Star
            || t1 === T.ColorIdentStart
            || t1 === T.AtKeyword
            // Also treat IDENT followed by '{' as a rule start (e.g., @-moz-document url-prefix() { a { ... } })
            || ((t1 === T.PlainIdent || t1 === T.CustomProperty || (T.LegacyPropIdent ? t1 === T.LegacyPropIdent : false)) && t2 === T.LCurly)
          );
          if (isRuleStart) {
            declRules = $.SUBRULE($.main);
          } else {
            // 2) Constant-time declaration start: IDENT ':'
            const isDeclStart = (
              t1 === T.PlainIdent || t1 === T.CustomProperty || (T.LegacyPropIdent ? t1 === T.LegacyPropIdent : false)
            ) && t2 === T.Colon;
            if (isDeclStart) {
              declRules = $.SUBRULE($.declarationList);
            } else {
              // 3) Fallback to raw capture
              $.MANY2(() => {
                const rule = $.SUBRULE($.anyInnerValue);
                if (!RECORDING_PHASE) {
                  ruleNodes.push($.wrap(rule, 'both'));
                }
              });
            }
          }
          endToken = $.CONSUME(T.RCurly);
          if (!RECORDING_PHASE) {
            innerBlockLocation = $.endRule();
          }
        }
      }
    ]);

    if (!$.RECORDING_PHASE) {
      // Build rules result: declaration list, or single-sequence fallback, or undefined
      let rulesResult: Rules | undefined;
      if (declRules) {
        rulesResult = declRules;
      } else if (endToken) {
        // Create a single Sequence from all inner nodes, so serialization treats it as one unit
        const seqLoc = innerBlockLocation ?? (ruleNodes!.length ? $.getLocationFromNodes(ruleNodes!) : undefined);
        const seq = new Sequence(ruleNodes!, undefined, seqLoc, this.context);
        const rulesLoc = innerBlockLocation ?? $.getLocationFromNodes([seq]);
        // Use RawRules to avoid inserting newlines/indentation during serialization
        rulesResult = new RawRules([seq], undefined, rulesLoc, this.context) as unknown as Rules;
      }
      return new AtRule({
        name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context), true),
        prelude: preludeNodes!.length ? new Sequence(preludeNodes!, undefined, $.getLocationFromNodes(preludeNodes!), this.context) : undefined,
        rules: rulesResult
      }, undefined, $.endRule(), this.context);
    }
  };
}
/**
  @todo - add all tokens
  @see - https://stackoverflow.com/questions/55594491/antlr-4-parser-match-any-token

  From - https://w3c.github.io/csswg-drafts/css-syntax-3/#typedef-any-value
  The <any-value> production is identical to <declaration-value>, but also allows
  top-level <semicolon-token> tokens and <delim-token> tokens with a value of "!".
  It represents the entirety of what valid CSS can be in any context.

  Parts of the spec that allow any value should not display a warning or error
  for any unknown token.
*/
// anyOuterValue
//   : value
//   | COMMA
//   | '(' anyInnerValue* ')'
//   | '[' anyInnerValue* ']'
//   ;
export function anyOuterValue(this: C, T: TokenMap) {
  const $ = this;

  let valueAlt = [
    { ALT: () => $.SUBRULE($.extraTokens) },
    { ALT: () => $.SUBRULE($.string) },
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        let nodes: Node[];
        if (!RECORDING_PHASE) {
          nodes = [];
        }
        $.CONSUME(T.LParen);
        $.MANY(() => {
          let val = $.SUBRULE($.anyInnerValue);
          if (!RECORDING_PHASE) {
            nodes.push($.wrap(val));
          }
        });
        $.CONSUME(T.RParen);

        if (!RECORDING_PHASE) {
          let location = $.endRule();
          return new Paren(
            nodes!.length ? new Sequence(nodes!, undefined, $.getLocationFromNodes(nodes!), this.context) : undefined,
            undefined,
            location,
            this.context
          );
        }
      }
    },
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        let nodes: Node[];

        if (!RECORDING_PHASE) {
          nodes = [];
        }

        $.CONSUME(T.LSquare);
        $.MANY2(() => {
          let node = $.SUBRULE2($.anyInnerValue);
          if (!RECORDING_PHASE) {
            nodes.push($.wrap(node));
          }
        });
        $.CONSUME(T.RSquare);

        if (!RECORDING_PHASE) {
          let location = $.endRule();
          return new Paren(
            $.wrap(new Sequence(nodes!, undefined, $.getLocationFromNodes(nodes!), this.context), true),
            undefined,
            location,
            this.context
          );
        }
      }
    }
  ];

  return () => $.OR(valueAlt);
}

/**
   * Same as allowable outer values, but allows
   * semi-colons and curly blocks.
   */
// anyInnerValue
//   : anyOuterValue
//   | '{' anyInnerValue* '}'
//   | ID
//   | SEMI
//   | pseudoSelector
//   ;
export function anyInnerValue(this: C, T: TokenMap) {
  const $ = this;

  let valueAlt = [
    { ALT: () => $.SUBRULE($.anyOuterValue) },
    {
      ALT: () => {
        $.startRule();
        let RECORDING_PHASE = $.RECORDING_PHASE;
        let nodes: Node[];
        if (!RECORDING_PHASE) {
          nodes = [];
        }
        $.CONSUME(T.LCurly);
        $.MANY(() => {
          let node = $.SUBRULE2($.anyInnerValue);
          if (!RECORDING_PHASE) {
            nodes.push(node);
          }
        });
        $.CONSUME(T.RCurly);

        if (!RECORDING_PHASE) {
          let location = $.endRule();

          return new Block(
            $.wrap(new Sequence(nodes!, undefined, $.getLocationFromNodes(nodes!), this.context), 'both'),
            { type: 'curly' },
            location,
            this.context
          );
        }
      }
    },
    {
      ALT: () => {
        let semi = $.CONSUME(T.Semi);

        if (!$.RECORDING_PHASE) {
          return $.wrap(new Any(semi.image, { role: 'semi' }, $.getLocationInfo(semi), this.context));
        }
      }
    }
  ];

  return () => $.OR(valueAlt);
}