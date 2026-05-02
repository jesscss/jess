// Methods to be mixed into CssRecursiveParser
import type { CssRecursiveParser, RuleContext, TokenMap } from '../cssRecursiveParser.js';
import type { IToken, IOrAlt } from '@chevrotain/types';
import {
  Node, Any, BasicSelector, Ampersand, CompoundSelector, ComplexSelector,
  type ComplexSelectorValue, Combinator, type Combinators, SelectorList,
  Ruleset, Rules, Sequence, PseudoSelector, AttributeSelector,
  type SimpleSelector, type ComplexSelectorComponent,
  type LocationInfo
} from '@jesscss/core';

type C = CssRecursiveParser;

export type Alt = Array<IOrAlt<any>>;
type AltContext = (ctx?: RuleContext) => Alt;
type SelectorRule = (ctx?: RuleContext) => Node | undefined;
type StylesheetRule = (options?: Record<string, any>) => Node | undefined;

export function stylesheet(this: C, T: TokenMap): StylesheetRule {
  const $ = this;

  return (options: Record<string, any> = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    let context: C['context'];
    if (!RECORDING_PHASE) {
      context = this.context;
    }

    let charset: IToken | undefined;

    $.OPTION(() => {
      charset = $.CONSUME(T.Charset);
    });

    const ctx: RuleContext = { isRoot: true };
    let root: Node = $.SUBRULE($.main, { ARGS: [ctx] });

    if (!RECORDING_PHASE) {
      if (charset && root instanceof Rules) {
        let loc = $.getLocationInfo(charset);
        let rootLoc = root.location;
        let rules = root.value;
        root.set(null, [new Any(charset.image, { role: 'charset' }, loc, context!), ...rules]);
        rootLoc[0] = loc[0];
        rootLoc[1] = loc[1];
        rootLoc[2] = loc[2];
      }

      return root;
    }
  };
}

export function main(this: C, T: TokenMap, alt?: AltContext | Alt) {
  let $ = this;
  alt ??= (ctx: RuleContext = {}) => [
    { ALT: () => $.SUBRULE($.qualifiedRule, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.atRule, { ARGS: [ctx] }) }
  ];

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;

    const isRoot = !!ctx.isRoot;
    let context: C['context'];

    if (!RECORDING_PHASE) {
      context = this.context;
    }
    let rules: Node[];

    if (!RECORDING_PHASE) {
      rules = [];
    }

    let requiredSemi = false;

    let lastRule: Node | undefined;

    $.MANY({
      GATE: () => !requiredSemi || (requiredSemi && (
        $.LA(1).tokenType === T.Semi
        || $.LA(0).tokenType === T.Semi
      )),
      DEF: () => {
        const localAlt = typeof alt === 'function' ? alt(ctx) : alt;
        let value = $.OR(localAlt!);
        if (!RECORDING_PHASE) {
          if (!(value instanceof Node)) {
            if (lastRule) {
              lastRule.options.semi = true;
            } else {
              rules.push(new Any(';', { role: 'semi' }, $.getLocationInfo($.LA(1)), context!));
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
      const wrapped = returnNode!;

      return wrapped;
    }
  };
}

export function qualifiedRule(this: C, T: TokenMap, selectorAlt?: AltContext) {
  const $ = this;

  selectorAlt ??= (ctx: RuleContext = {}) => [
    {
      GATE: () => !ctx.inner,
      ALT: () => $.SUBRULE($.selectorList, { ARGS: [ctx] })
    },
    {
      GATE: () => !!ctx.inner,
      ALT: () => $.SUBRULE($.forgivingSelectorList, { ARGS: [ctx] })
    }
  ];

  return (ctx: RuleContext = {}) => {
    $.startRule();

    let selector = $.OR(selectorAlt(ctx));

    $.CONSUME(T.LCurly);
    let rules: Rules = $.SUBRULE($.declarationList, { ARGS: [ctx] });
    $.CONSUME(T.RCurly);

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();

      const ruleset = new Ruleset({
        selector,
        rules
      }, undefined, location, this.context);
      return ruleset;
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
export function simpleSelector(this: C, T: TokenMap, selectorAlt?: AltContext): SelectorRule {
  const $ = this;

  selectorAlt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => $.CONSUME(T.Ident)
    },
    {
      /** In CSS Nesting, outer selector can't contain an ampersand */
      GATE: () => !!ctx.inner,
      ALT: () => $.CONSUME(T.Ampersand)
    },
    { ALT: () => $.SUBRULE($.classSelector, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.idSelector, { ARGS: [ctx] }) },
    { ALT: () => $.CONSUME(T.Star) },
    { ALT: () => $.SUBRULE($.pseudoSelector, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.attributeSelector, { ARGS: [ctx] }) },
    /** Supports keyframes selectors */
    { ALT: () => $.CONSUME(T.DimensionInt) },
    { ALT: () => $.CONSUME(T.DimensionNum) }
  ];

  return (ctx: RuleContext = {}) => {
    let selector = $.OR(selectorAlt(ctx));

    if (!$.RECORDING_PHASE) {
      if ($.isToken(selector)) {
        if (selector.tokenType.name === 'Ampersand') {
          return new Ampersand(undefined, undefined, $.getLocationInfo(selector), this.context);
        }
        return new BasicSelector(selector.image, undefined, $.getLocationInfo(selector), this.context);
      }
      const node: Node = selector;
      return node;
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
    if ($.RECORDING_PHASE) {
      return;
    }
    return new BasicSelector(selector.image, undefined, $.getLocationInfo(selector), this.context);
  };
}

export function idSelector(this: C, T: TokenMap, selectorAlt?: AltContext) {
  const $ = this;

  selectorAlt ??= (ctx: RuleContext = {}) => [
    { ALT: () => $.CONSUME(T.HashName) },
    { ALT: () => $.CONSUME(T.ColorIdentStart) }
  ];
  /** #id, #FF0000 are both valid ids */
  return (ctx: RuleContext = {}) => {
    let selector = $.OR(selectorAlt(ctx));
    if ($.RECORDING_PHASE) {
      return;
    }
    return new BasicSelector(selector.image, undefined, $.getLocationInfo(selector), this.context);
  };
}

export function pseudoSelector(this: C, T: TokenMap, selectorAlt?: AltContext) {
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

  selectorAlt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        let name = $.CONSUME(T.NthPseudoClass);
        let val = $.SUBRULE2($.nthValue, { ARGS: [ctx] });
        $.CONSUME2(T.RParen);

        return createPseudo(name.image.slice(0, -1), val);
      }
    },
    {
      ALT: () => {
        let name = $.CONSUME3(T.SelectorPseudoClass);
        let val = $.SUBRULE3($.forgivingSelectorList, { ARGS: [ctx] });
        $.CONSUME4(T.RParen);

        return createPseudo(name.image.slice(0, -1), val);
      }
    },
    {
      ALT: () => {
        let name = $.CONSUME5(T.Colon).image;
        $.OPTION({
          GATE: $.noSep,
          DEF: () => {
            name += $.CONSUME6(T.Colon).image;
          }
        });
        let values = $.OR4([
          {
            /** ::unknown(values) */
            GATE: $.noSep,
            ALT: () => {
              name += $.CONSUME7(T.GenericFunctionStart).image;
              let RECORDING_PHASE = $.RECORDING_PHASE;
              let values: Node[];
              if (!RECORDING_PHASE) {
                values = [];
                name = name.slice(0, -1);
              }
              let valuesLocation: LocationInfo;

              $.startRule();
              $.MANY(() => {
                let val = $.SUBRULE4($.anyInnerValue);
                if (!RECORDING_PHASE) {
                  values!.push(val);
                }
              });
              if (!RECORDING_PHASE) {
                valuesLocation = $.endRule();
              }
              $.CONSUME8(T.RParen);

              if (!RECORDING_PHASE && values!.length) {
                return new Sequence(values!, undefined, valuesLocation!, this.context);
              }
            }
          },
          {
            /** ::unknown  */
            GATE: $.noSep,
            ALT: () => {
              name += $.CONSUME9(T.Ident).image;
            }
          }
        ]);
        return createPseudo(name, values!);
      }
    }
  ];

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

export function nthValue(this: C, T: TokenMap, valueAlt?: AltContext) {
  const $ = this;

  valueAlt ??= (ctx: RuleContext = {}) => {
    return [
      { ALT: () => $.CONSUME(T.NthOdd) },
      { ALT: () => $.CONSUME(T.NthEven) },
      { ALT: () => $.CONSUME(T.Integer) },
      {
        ALT: () => {
          $.OR2([
            { ALT: () => $.CONSUME(T.NthSignedDimension) },
            { ALT: () => $.CONSUME(T.NthUnsignedDimension) },
            { ALT: () => $.CONSUME(T.NthSignedPlus) },
            { ALT: () => $.CONSUME(T.NthIdent) }
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
            $.SUBRULE($.complexSelector, { ARGS: [ctx] });
          });
        }
      }
    ];
  };

  /**
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/:nth-child
   */
  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let startTokenOffset: number | undefined;
    if (!RECORDING_PHASE) {
      startTokenOffset = this.LA(1).startOffset;
    }

    $.OR(valueAlt(ctx));

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
      return new Any(tokenValues, { role: 'any' }, location, this.context);
    }
  };
}

// attributeSelector
//   : LSQUARE WS* identifier (STAR | TILDE | CARET | DOLLAR | PIPE)? EQ WS* (identifier | STRING) WS* (ATTRIBUTE_FLAG WS*)? RSQUARE
//   ;
export function attributeName(this: C, T: TokenMap) {
  const $ = this;

  return () => {
    let namespacePrefix = '';

    if ($.isType(T.Pipe)) {
      namespacePrefix = $.CONSUME(T.Pipe).image;
    } else if ($.isType(T.Star) && $.isTypeAt(2, T.Pipe) && !$.hasWS() && !$.hasWS(2)) {
      namespacePrefix = $.CONSUME2(T.Star).image;
      namespacePrefix += $.CONSUME3(T.Pipe).image;
    } else if ($.isType(T.Ident) && $.isTypeAt(2, T.Pipe) && !$.hasWS() && !$.hasWS(2)) {
      namespacePrefix = $.CONSUME4(T.Ident).image;
      namespacePrefix += $.CONSUME5(T.Pipe).image;
    }

    let key = $.CONSUME6(T.Ident);

    if ($.RECORDING_PHASE) {
      return;
    }
    return new Any(`${namespacePrefix}${key.image}`, { role: 'ident' }, $.getLocationInfo(key), this.context);
  };
}

export function attributeSelector(this: C, T: TokenMap, valueAlt?: AltContext) {
  const $ = this;

  valueAlt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        let token = $.CONSUME5(T.Ident);
        if ($.RECORDING_PHASE) {
          return;
        }
        return new Any(token.image, { role: 'ident' }, $.getLocationInfo(token), this.context);
      }
    },
    { ALT: () => $.SUBRULE($.string) }
  ];

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    $.CONSUME2(T.LSquare);
    let key: Any = $.SUBRULE2($.attributeName);
    let op: IToken | undefined;
    let value: Node | undefined;
    let mod: IToken | undefined;
    $.OPTION(() => {
      op = $.OR([
        { ALT: () => $.CONSUME4(T.Eq) },
        { ALT: () => $.CONSUME6(T.AttrMatch) }
      ]);
      value = $.OR2(valueAlt(ctx));
    });
    $.OPTION2(() => mod = $.CONSUME7(T.AttrFlag));
    $.CONSUME8(T.RSquare);

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      return new AttributeSelector({
        name: key.valueOf(),
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
    let selectors: SimpleSelector[];
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
          selectors.push(sel);
        }
      }
    });
    if (RECORDING_PHASE) {
      return;
    }
    if (selectors!.length === 1) {
      return selectors![0]!;
    }
    return new CompoundSelector(selectors!, undefined, $.getLocationFromNodes(selectors!), this.context);
  };
}

/**
 * @param manyGate - Exposed for Less to exclude the keyword 'all' from the selector list
 */
export function complexSelector(this: C, T: TokenMap, manyGate?: (ctx: RuleContext) => () => boolean) {
  const $ = this;

  manyGate ??= (ctx: RuleContext) => () => $.hasWS() || $.isTypeAt(1, T.Combinator);

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
    let GATE = manyGate(ctx);
    $.startRule();
    let selectors: ComplexSelectorValue = [$.SUBRULE($.compoundSelector, { ARGS: [ctx] })];

    /**
     * Only space combinators and specified combinators will enter the MANY
     */
    $.MANY({
      GATE,
      DEF: () => {
        let co: IToken | undefined;
        let combinator: Combinator;
        $.OPTION(() => {
          co = $.CONSUME(T.Combinator);
        });
        if (!RECORDING_PHASE) {
          if (co) {
            combinator = new Combinator(co.image as Combinators, undefined, $.getLocationInfo(co), this.context);
          } else {
            combinator = new Combinator(' ', undefined, undefined, this.context);
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
          let complex: Node = $.SUBRULE2($.complexSelector, { ARGS: [ctx] });

          if (!$.RECORDING_PHASE) {
            let combinator = new Combinator(co.image as Combinators, undefined, $.getLocationInfo(co), this.context);
            if (complex instanceof ComplexSelector) {
              complex.set(null, [combinator, ...complex.value]);
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
        ALT: () => $.SUBRULE3($.complexSelector, { ARGS: [ctx] })
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
            sequences.push(selector);
          } else {
            sequences.push(selector);
          }
        }
      }
    });

    if (RECORDING_PHASE) {
      return;
    }
    let location = $.endRule();
    if (sequences!.length === 1) {
      return sequences![0];
    }
    return new SelectorList(sequences!, undefined, location, this.context);
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
            sequences.push(sel);
          } else {
            sequences.push(sel);
          }
        }
      }
    });

    if (RECORDING_PHASE) {
      return;
    }
    let location = $.endRule();
    if (sequences!.length === 1) {
      return sequences![0]!;
    }
    return new SelectorList(sequences!, undefined, location, this.context);
  };
}

export function declarationList(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;
  const shouldTryQualifiedRule = () => $.shouldTryQualifiedRuleInDeclarationList();
  /** * Declarations ***/
  // https://www.w3.org/TR/css-syntax-3/#declaration-list-diagram
  // declarationList
  //   : WS* (
  //     declaration? (WS* SEMI declarationList)*
  //     | innerAtRule declarationList
  //     | innerQualifiedRule declarationList
  //   )
  //   ;

  alt ??= (ctx: RuleContext = {}) => [
    { ALT: () => $.SUBRULE($.innerAtRule, { ARGS: [{ ...ctx, inner: true }] }) },
    {
      /** Keep this routing bounded; do not scan ahead to the closing delimiter. */
      GATE: shouldTryQualifiedRule,
      ALT: () => $.SUBRULE2($.qualifiedRule, { ARGS: [{ ...ctx, inner: true }] })
    },
    { ALT: () => $.SUBRULE($.declaration, { ARGS: [ctx] }) },
    { ALT: () => $.CONSUME2(T.Semi) }
  ];

  return main.call(this, T, alt);
}
