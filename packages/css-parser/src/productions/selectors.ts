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
import { tokenMatcher } from '../cssRecursiveParser.js';
import { EOF } from 'chevrotain';

type P = CssRecursiveParser;

export type Alt = IOrAlt<any>[];
export type AltContext = (ctx?: RuleContext) => Alt;

export function stylesheet(this: P, T: TokenMap) {
  const $ = this;
  return (options: Record<string, any> = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    let context: P['context'];
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
      let rules = root.data as Node[];

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

export function main(this: P, T: TokenMap, alt?: AltContext | Alt) {
  let $ = this;
  alt ??= (ctx: RuleContext = {}) => [
    { ALT: () => $.SUBRULE($.qualifiedRule, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.atRule, { ARGS: [ctx] }) }
  ];

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;

    const isRoot = !!ctx.isRoot;
    let context: P['context'];

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
      const wrapped = $.wrap(returnNode!, true);

      return wrapped;
    }
  };
}

export function qualifiedRule(this: P, T: TokenMap, selectorAlt?: AltContext) {
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
export function simpleSelector(this: P, T: TokenMap, selectorAlt?: AltContext) {
  const $ = this;

  selectorAlt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => $.CONSUME(T.Ident)
    },
    {
      GATE: () => !!ctx.inner,
      ALT: () => $.CONSUME(T.Ampersand)
    },
    { ALT: () => $.SUBRULE($.classSelector, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.idSelector, { ARGS: [ctx] }) },
    { ALT: () => $.CONSUME(T.Star) },
    { ALT: () => $.SUBRULE($.pseudoSelector, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.attributeSelector, { ARGS: [ctx] }) },
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
      return selector as Node;
    }
  };
}

export function classSelector(this: P, T: TokenMap) {
  const $ = this;

  return () => {
    let selector = $.CONSUME(T.DotName);
    if (!$.RECORDING_PHASE) {
      return new BasicSelector(selector.image, undefined, $.getLocationInfo(selector), this.context);
    }
  };
}

export function idSelector(this: P, T: TokenMap, selectorAlt?: AltContext) {
  const $ = this;

  selectorAlt ??= (ctx: RuleContext = {}) => [
    { ALT: () => $.CONSUME(T.HashName) },
    { ALT: () => $.CONSUME(T.ColorIdentStart) }
  ];

  return (ctx: RuleContext = {}) => {
    let selector = $.OR(selectorAlt(ctx));
    if (!$.RECORDING_PHASE) {
      return new BasicSelector(selector.image, undefined, $.getLocationInfo(selector), this.context);
    }
  };
}

export function pseudoSelector(this: P, T: TokenMap, selectorAlt?: AltContext) {
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
        let val = $.SUBRULE($.nthValue, { ARGS: [ctx] });
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
        let values = $.OR4([
          {
            GATE: $.noSep,
            ALT: () => {
              name += $.CONSUME(T.GenericFunctionStart).image;
              let RECORDING_PHASE = $.RECORDING_PHASE;
              let values: Node[];
              if (!RECORDING_PHASE) {
                values = [];
                name = name.slice(0, -1);
              }
              let valuesLocation: LocationInfo;

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

              if (!RECORDING_PHASE && values!.length) {
                return new Sequence(values!, undefined, valuesLocation!, this.context);
              }
            }
          },
          {
            GATE: $.noSep,
            ALT: () => {
              name += $.CONSUME(T.Ident).image;
            }
          }
        ]);
        return createPseudo(name, values!);
      }
    }
  ];

  return (ctx: RuleContext = {}) => {
    $.startRule();
    return $.OR(selectorAlt(ctx));
  };
}

export function nthValue(this: P, ctx: RuleContext = {}, valueAlt?: AltContext) {
  const $ = this;
  valueAlt ??= (ctx: RuleContext = {}) => {
    return [
      { ALT: () => $.CONSUME($.T.NthOdd) },
      { ALT: () => $.CONSUME($.T.NthEven) },
      { ALT: () => $.CONSUME($.T.Integer) },
      {
        ALT: () => {
          $.OR([
            { ALT: () => $.CONSUME($.T.NthSignedDimension) },
            { ALT: () => $.CONSUME($.T.NthUnsignedDimension) },
            { ALT: () => $.CONSUME($.T.NthSignedPlus) },
            { ALT: () => $.CONSUME($.T.NthIdent) }
          ]);
          $.OPTION(() => {
            $.OR([
              { ALT: () => $.CONSUME($.T.SignedInt) },
              {
                ALT: () => {
                  $.CONSUME($.T.Minus);
                  $.CONSUME($.T.UnsignedInt);
                }
              }
            ]);
          });
          $.OPTION(() => {
            $.CONSUME($.T.Of);
            $.SUBRULE($.complexSelector, { ARGS: [ctx] });
          });
        }
      }
    ];
  };

  /**
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/:nth-child
   */
  $.startRule();
  let startTokenOffset: number | undefined = $.LA(1).startOffset;

  $.OR(valueAlt(ctx));

  /** Coelesce all token values into one value */
  const endTokenOffset = $.LA(0).startOffset ?? 0;
  let location = $.endRule();
  let origTokens = $.originalInput;
  let origLength = origTokens.length;
  let tokenValues = '';
  for (let i = 0; i < origLength; i++) {
    let token = origTokens[i]!;
    if (token.startOffset > endTokenOffset) {
      break;
    }
    if (token.startOffset >= startTokenOffset!) {
      tokenValues += token.image;
    }
  }
  return $.wrap(new Any(tokenValues, { role: 'any' }, location, $.context), 'both');
}

// attributeSelector
//   : LSQUARE WS* identifier (STAR | TILDE | CARET | DOLLAR | PIPE)? EQ WS* (identifier | STRING) WS* (ATTRIBUTE_FLAG WS*)? RSQUARE
//   ;
export function attributeSelector(this: P, ctx: RuleContext = {}, valueAlt?: AltContext) {
  const $ = this;
  valueAlt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        let token = $.CONSUME($.T.Ident);
        return new Any(token.image, { role: 'ident' }, $.getLocationInfo(token), $.context);
      }
    },
    { ALT: () => $.SUBRULE($.string) as Node }
  ];

  $.startRule();

  $.CONSUME($.T.LSquare);
  let key = $.CONSUME($.T.Ident);
  let op: IToken | undefined;
  let value: Node | undefined;
  let mod: IToken | undefined;
  $.OPTION(() => {
    op = $.OR([
      { ALT: () => $.CONSUME($.T.Eq) },
      { ALT: () => $.CONSUME($.T.AttrMatch) }
    ]) as IToken;
    value = $.OR(valueAlt(ctx)) as Node | undefined;
  });
  $.OPTION(() => mod = $.CONSUME($.T.AttrFlag));
  $.CONSUME($.T.RSquare);

  let location = $.endRule();
  return new AttributeSelector({
    name: key.image,
    op: op?.image,
    value,
    mod: mod?.image
  }, undefined, location, $.context);
}

export function compoundSelector(this: P, ctx: RuleContext = {}) {
  const $ = this;
  /**
      A sequence of simple selectors that are not separated by
      a combinator.
        .e.g. `a#selected`
    */
  // compoundSelector
  //   : simpleSelector+
  //   ;
  let selectors: SimpleSelector[] = [];
  let sel = $.SUBRULE($.simpleSelector, { ARGS: [ctx] });
  selectors!.push(sel as SimpleSelector);
  $.MANY({
    /** Make sure we don't ignore space combinators */
    GATE: () => !$.hasWS(),
    DEF: () => {
      sel = $.SUBRULE($.simpleSelector, { ARGS: [ctx] });
      /** Make sure we don't add implicit whitespace */
      if (!$.RECORDING_PHASE) {
        (sel as Node).pre = 0;
      }
      selectors.push(sel as SimpleSelector);
    }
  });
  if (selectors!.length === 1) {
    return selectors![0]!;
  }
  return new CompoundSelector(selectors!, undefined, $.getLocationFromNodes(selectors!), $.context);
}

/**
 * @param manyGate - Exposed for Less to exclude the keyword 'all' from the selector list
 */
export function complexSelector(this: P, ctx: RuleContext = {}, manyGate?: (ctx: RuleContext) => () => boolean) {
  const $ = this;
  manyGate ??= (ctx: RuleContext) => () => $.hasWS() || tokenMatcher($.LA(1), $.T.Combinator);

  /**
      A sequence of one or more simple and/or compound selectors
      that are separated by combinators.
        .e.g. a#selected > .icon
    */
  // complexSelector
  //   : compoundSelector (WS* (combinator WS*)? compoundSelector)*
  //   ;
  let GATE = manyGate(ctx);
  $.startRule();
  const selectors: ComplexSelectorValue = [$.SUBRULE($.compoundSelector, { ARGS: [ctx] }) as ComplexSelectorComponent];

  /**
   * Only space combinators and specified combinators will enter the MANY
   */
  $.MANY({
    GATE,
    DEF: () => {
      let co: IToken | undefined;
      let combinator: Combinator;
      $.OPTION(() => {
        co = $.CONSUME($.T.Combinator);
      });
      /** Capture the startOffset BEFORE compoundSelector, so we can
       *  retroactively attach pre-tokens to the whitespace combinator
       *  only after compoundSelector succeeds. This prevents eagerly
       *  consuming skipped tokens (comments) that belong to the
       *  previous selector's post when compoundSelector fails. */
      let wsCombinatorOffset: number | undefined;
      if (co) {
        combinator = $.wrap(new Combinator(co.image as Combinators, undefined, $.getLocationInfo(co), $.context), 'both');
      } else {
        /** Whitespace combinators are special */
        wsCombinatorOffset = $.LA(1).startOffset;
        /**
         * Technically, a whitespace combinator may not actually _include_
         * a literal space (it can be a newline, for example), but we'll just use a
         * space for now.
         */
        combinator = new Combinator(' ', undefined, undefined, $.context);
      }
      let compound = $.SUBRULE($.compoundSelector, { ARGS: [ctx] }) as CompoundSelector;
      /** Now that compoundSelector succeeded, attach pre-tokens to the WS combinator */
      if (wsCombinatorOffset !== undefined) {
        let pre = $.getPrePost(wsCombinatorOffset);
        if (pre === 1) {
          pre = 0;
        } else if (pre) {
          let last = (pre as any[])[(pre as any[]).length - 1];
          if (typeof last === 'string' && last.endsWith(' ')) {
            /** remove the last character if a space */
            (pre as any[])[(pre as any[]).length - 1] = last.slice(0, -1);
          }
        }
        combinator.pre = pre;
      }
      selectors.push(
        combinator!,
        compound
      );
    }
  });

  let location = $.endRule();
  if (selectors.length === 1) {
    return selectors[0]!;
  }
  return new ComplexSelector(selectors as ComplexSelectorValue, undefined, location, $.context);
}

/**
    A selector representing an element relative to one or more
    anchor elements preceded by a combinator.
      e.g. + div#topic > #reference
  */
// relativeSelector
//   : (combinator WS*)? complexSelector
//   ;
export function relativeSelector(this: P, ctx: RuleContext = {}) {
  const $ = this;
  return $.OR([
    {
      ALT: () => {
        const co = $.CONSUME($.T.Combinator);
        let complex = $.SUBRULE($.complexSelector, { ARGS: [ctx] }) as Node;

        let combinator = new Combinator(co.image as Combinators, undefined, $.getLocationInfo(co), $.context);
        if (complex instanceof ComplexSelector) {
          complex = new ComplexSelector(
            [combinator, ...complex.data],
            undefined,
            $.getLocationFromNodes([combinator, complex]),
            $.context
          );
          complex.location[0] = co.startOffset;
          complex.location[1] = co.startLine;
          complex.location[2] = co.startColumn;
        } else {
          complex = new ComplexSelector(
            [combinator, complex as ComplexSelectorComponent],
            undefined,
            $.getLocationFromNodes([combinator, complex]),
            $.context
          );
        }
        return complex;
      }
    },
    {
      ALT: () => $.SUBRULE($.complexSelector, { ARGS: [ctx] }) as Node
    }
  ]) as Node;
}

export function forgivingSelectorList(this: P, ctx: RuleContext = {}) {
  const $ = this;
  /**
      https://www.w3.org/TR/css-nesting-1/

      NOTE: implementers should throw a parsing
      error if the selectorlist starts with an identifier
    */
  // forgivingSelectorList
  //   : relativeSelector (WS* COMMA WS* relativeSelector)*
  //   ;
  $.startRule();

  let sequences: ComplexSelector[] = [];
  let i = 0;

  $.AT_LEAST_ONE_SEP({
    SEP: $.T.Comma,
    DEF: () => {
      const selector = $.SUBRULE($.relativeSelector, { ARGS: [ctx] }) as Node;
      i++;
      if (i === 1 && ctx.qualifiedRule) {
        // Only attach post; leave pre for the parent Rules to lift comments
        sequences.push($.wrap(selector, true) as ComplexSelector);
      } else {
        sequences.push($.wrap(selector, i === 1 ? true : 'both') as ComplexSelector);
      }
    }
  });

  let location = $.endRule();
  if (sequences!.length === 1) {
    return sequences![0];
  }
  return new SelectorList(sequences!, undefined, location, $.context);
}

export function selectorList(this: P, ctx: RuleContext = {}) {
  const $ = this;
  // selectorList
  //   : complexSelector (WS* COMMA WS* complexSelector)*
  //   ;
  $.startRule();
  let i = 0;
  let sequences: ComplexSelector[] = [];

  $.AT_LEAST_ONE_SEP({
    SEP: $.T.Comma,
    DEF: () => {
      const sel = $.SUBRULE($.complexSelector, { ARGS: [ctx] }) as Node;
      i++;
      // Do not consume leading pre for the first selector of a qualified rule,
      // so that pre-rule comments remain available to be lifted to Rules.
      if (i === 1 && ctx.qualifiedRule) {
        // Only attach post; leave pre for the parent Rules to lift comments
        sequences.push($.wrap(sel, true) as ComplexSelector);
      } else {
        sequences.push($.wrap(sel, i === 1 ? true : 'both') as ComplexSelector);
      }
    }
  });

  let location = $.endRule();
  if (sequences!.length === 1) {
    return sequences![0]!;
  }

  return new SelectorList(sequences!, undefined, location, $.context);
}

export function declarationList(this: P, T: TokenMap, alt?: AltContext) {
  const $ = this;
  alt ??= (ctx: RuleContext = {}) => [
    {
      GATE: () => {
        let t1 = $.LA(1).tokenType;
        if (t1 === T.CustomProperty) return true;
        if ($.legacyMode && t1 === T.LegacyPropIdent) return true;
        if (!tokenMatcher($.LA(1), T.Ident) || $.LA(2).tokenType !== T.Colon) return false;
        if (!$.noSep(2)) return true;
        let depth = 0;
        for (let i = 3; ; i++) {
          let tok = $.LA(i);
          let tt = tok.tokenType;
          if (depth === 0) {
            if (tt === T.LCurly) return false;
            if (tt === T.Semi || tt === T.RCurly || tt === EOF) return true;
          }
          if (tt === T.LParen || tokenMatcher(tok, T.FunctionStart)) depth++;
          else if (tt === T.RParen || tt === T.UrlEnd) depth--;
          else if (tt === T.LSquare) depth++;
          else if (tt === T.RSquare) depth--;
          if (tt === EOF) return true;
        }
      },
      ALT: () => $.SUBRULE($.declaration, { ARGS: [ctx] })
    },
    { ALT: () => $.SUBRULE($.innerAtRule, { ARGS: [{ ...ctx, inner: true }] }) },
    { ALT: () => $.SUBRULE($.qualifiedRule, { ARGS: [{ ...ctx, inner: true }] }) },
    { ALT: () => $.CONSUME(T.Semi) }
  ];

  return main.call(this, T, alt);
}
