// Methods to be mixed into CssRecursiveParser
// This file is a temporary build artifact for assembly
import type { CssRecursiveParser, RuleContext } from '../cssRecursiveParser.js';
import type { IToken, IOrAlt } from '@chevrotain/types';
import {
  Node, Any, BasicSelector, Ampersand, CompoundSelector, ComplexSelector,
  type ComplexSelectorValue, Combinator, type Combinators, SelectorList,
  Ruleset, Rules, Sequence, PseudoSelector, AttributeSelector,
  type SimpleSelector, type ComplexSelectorComponent,
  type LocationInfo
} from '@jesscss/core';
import { tokenMatcher } from '../cssRecursiveParser.js';

type P = CssRecursiveParser;

export type Alt = IOrAlt<any>[];
export type AltContext = (ctx?: RuleContext) => Alt;

export function stylesheet(this: P, options: Record<string, any> = {}) {
  const $ = this;
  /** During Chevrotain grammar recording, return a dummy to avoid crashes */
  if (this.RECORDING_PHASE) {
    return new Rules([], undefined, undefined, $.context) as Node;
  }
  let context = $.context;

  const charset = $.OPTION(() => $.CONSUME($.T.Charset)) as IToken | undefined;

  const ctx: RuleContext = { isRoot: true };
  const root = $.SUBRULE($.main) as Node;

  const rules = root?.data as Node[] | undefined;
  if (charset && rules) {
    const loc = $.getLocationInfo(charset);
    const rootLoc = root.location;
    rules.unshift(new Any(charset.image, { role: 'charset' }, loc, context!));
    rootLoc[0] = loc[0];
    rootLoc[1] = loc[1];
    rootLoc[2] = loc[2];
  }

  return root;
}

export function main(this: P, ctx: RuleContext = {}, alt?: AltContext | Alt) {
  const $ = this;
  alt ??= (ctx: RuleContext = {}) => [
    /** GATE kept: @ commits to atRule for correct error reporting */
    { GATE: () => tokenMatcher($.LA(1), $.T.AtName), ALT: () => $.SUBRULE($.atRule) },
    { ALT: () => $.SUBRULE($.qualifiedRule) }
  ];

  const isRoot = !!ctx.isRoot;
  let context = $.context;
  let rules: Node[] = [];

  let requiredSemi = false;

  let lastRule: Node | undefined;
  /**
   * In this production rule, semi-colons are not required
   * but this is repurposed by declarationList and by Less / Sass,
   * so that's why this gate is here.
   */
  $.MANY({
    GATE: () => {
      const next = $.LA(1);
      // Stop at RCurly (belongs to parent block) or end of input
      if ($.isType($.T.RCurly) || next.tokenType?.name === 'EOF') {
        return false;
      }
      return !requiredSemi || (requiredSemi && (
        $.isType($.T.Semi)
        || $.isTypeAt(0, $.T.Semi)
      ));
    },
    DEF: () => {
      const localAlt = typeof alt === 'function' ? alt(ctx) : alt!;
      let value = $.OR(localAlt);
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
  });

  let returnNode = $.getRulesWithComments(rules!, $.getLocationInfo($.LA(1)));
  // Attaches remaining whitespace at the end of rules
  const wrapped = $.wrap(returnNode!, true);

  return wrapped;
}

export function qualifiedRule(this: P, ctx: RuleContext = {}, selectorAlt?: AltContext) {
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
  // qualifiedRule
  //   : selectorList WS* LCURLY declarationList RCURLY
  //   ;
  $.startRule();

  const selector = $.OR(selectorAlt(ctx));

  $.CONSUME($.T.LCurly);
  const rules = $.SUBRULE($.declarationList) as Rules;
  $.CONSUME($.T.RCurly);

  let location = $.endRule();

  const ruleset = new Ruleset({
    selector,
    rules
  }, undefined, location, $.context);
  return ruleset;
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
export function simpleSelector(this: P, ctx: RuleContext = {}, selectorAlt?: AltContext) {
  const $ = this;
  selectorAlt ??= (ctx: RuleContext = {}) => [
    {
      /**
       * It used to be the case that, in CSS Nesting, the first selector
       * could not be an identifier. However, it looks like that's no
       * longer the case.
       *
       * @see: https://github.com/w3c/csswg-drafts/issues/9317
       */
      ALT: () => $.CONSUME($.T.Ident)
    },
    {
      /** In CSS Nesting, outer selector can't contain an ampersand */
      GATE: () => !!ctx.inner,
      ALT: () => $.CONSUME($.T.Ampersand)
    },
    { ALT: () => $.SUBRULE($.classSelector) },
    { ALT: () => $.SUBRULE($.idSelector, { ARGS: [ctx] }) },
    { ALT: () => $.CONSUME($.T.Star) },
    { ALT: () => $.SUBRULE($.pseudoSelector, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.attributeSelector, { ARGS: [ctx] }) },
    /** Supports keyframes selectors */
    { ALT: () => $.CONSUME($.T.DimensionInt) },
    { ALT: () => $.CONSUME($.T.DimensionNum) }
  ];

  const selector = $.OR(selectorAlt(ctx)) as IToken | Node;

  if ($.isToken(selector)) {
    if (selector.tokenType.name === 'Ampersand') {
      return new Ampersand(undefined, undefined, $.getLocationInfo(selector), $.context);
    }
    return new BasicSelector(selector.image, undefined, $.getLocationInfo(selector), $.context);
  }
  return selector as Node;
}

// classSelector
//   : DOT identifier
//   ;
export function classSelector(this: P) {
  const $ = this;
  let selector = $.CONSUME($.T.DotName);
  return new BasicSelector(selector.image, undefined, $.getLocationInfo(selector), $.context);
}

export function idSelector(this: P, ctx: RuleContext = {}, selectorAlt?: AltContext) {
  const $ = this;
  selectorAlt ??= (ctx: RuleContext = {}) => [
    { ALT: () => $.CONSUME($.T.HashName) },
    { ALT: () => $.CONSUME($.T.ColorIdentStart) }
  ];
  /** #id, #FF0000 are both valid ids */
  const selector = $.OR(selectorAlt(ctx)) as IToken;
  return new BasicSelector(selector.image, undefined, $.getLocationInfo(selector), $.context);
}

export function pseudoSelector(this: P, ctx: RuleContext = {}, selectorAlt?: AltContext) {
  const $ = this;
  const createPseudo = (name: string, arg?: Node) => {
    let location = $.endRule();
    return new PseudoSelector({
      name,
      arg
    }, undefined, location, $.context);
  };

  selectorAlt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        let name = $.CONSUME($.T.NthPseudoClass);
        const val = $.SUBRULE($.nthValue, { ARGS: [ctx] }) as Node | undefined;
        $.CONSUME($.T.RParen);

        return createPseudo(name.image.slice(0, -1), val);
      }
    },
    {
      ALT: () => {
        let name = $.CONSUME($.T.SelectorPseudoClass);
        const val = $.SUBRULE($.forgivingSelectorList, { ARGS: [ctx] }) as Node | undefined;
        $.CONSUME($.T.RParen);

        return createPseudo(name.image.slice(0, -1), val);
      }
    },
    {
      ALT: () => {
        let name = $.CONSUME($.T.Colon).image;
        if ($.noSep()) {
          $.OPTION(() => {
            name += $.CONSUME($.T.Colon).image;
          });
        }
        /**
         * We use OR often to assert that no whitespace is allowed.
         * There's no other way currently to do a positive-assertion Gate
         * in Chevrotain.
         */
        const values = $.OR([
          {
            /** ::unknown(values) */
            GATE: $.noSep.bind($),
            ALT: () => {
              name += $.CONSUME($.T.GenericFunctionStart).image;
              const innerValues: Node[] = [];
              name = name.slice(0, -1);
              let valuesLocation: LocationInfo;

              $.startRule();
              $.MANY({
                GATE: () => !$.isType($.T.RParen),
                DEF: () => {
                  const val = $.SUBRULE($.anyInnerValue) as Node;
                  innerValues.push(val);
                }
              });
              valuesLocation = $.endRule();
              $.CONSUME($.T.RParen);

              if (innerValues.length) {
                return new Sequence(innerValues, undefined, valuesLocation!, $.context);
              }
            }
          },
          {
            /** ::unknown  */
            GATE: $.noSep.bind($),
            ALT: () => {
              name += $.CONSUME($.T.Ident).image;
            }
          }
        ]) as Node | undefined;
        return createPseudo(name, values);
      }
    }
  ];

  // pseudoSelector
  //   : NTH_PSEUDO_CLASS '(' WS* nthValue WS* ')'
  //   | FUNCTIONAL_PSEUDO_CLASS '(' WS* forgivingSelectorList WS* ')'
  //   | COLON COLON? identifier ('(' anyInnerValue* ')')?
  //   ;
  $.startRule();
  return $.OR(selectorAlt(ctx)) as Node;
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

export function declarationList(this: P, ctx: RuleContext = {}, alt?: AltContext): Node {
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

  alt ??= (ctx: RuleContext = {}) => [
    /** GATE kept: @ commits to innerAtRule for correct error reporting */
    { GATE: () => tokenMatcher($.LA(1), $.T.AtName), ALT: () => $.SUBRULE($.innerAtRule, { ARGS: [{ ...ctx, inner: true }] }) },
    {
      /**
       * Declaration vs nested rule disambiguation for ident-colon starts.
       *
       * `a:hover { }` (no WS after colon) → nested rule selector
       * `color: red;` (WS after colon) → declaration
       *
       * We use whitespace presence after the colon as a fast O(1) heuristic.
       * CSS authors virtually always put a space after `:` in declarations
       * and never in pseudo-selectors. This avoids expensive lookahead
       * for `{` and handles 99%+ of real-world CSS correctly.
       *
       * Custom properties (--foo: ...) are handled by declaration's own GATE.
       */
      GATE: () => {
        const la1 = $.LA(1);
        // Only applies when LA(1) is Ident and LA(2) is Colon/Assign
        if (!tokenMatcher(la1, $.T.Ident)) {
          return true; // non-ident: let declaration try normally
        }
        const la2 = $.LA(2);
        if (!tokenMatcher(la2, $.T.Assign)) {
          return true; // no colon: let declaration try normally
        }
        // WS after colon → declaration; no WS → pseudo-selector (skip declaration)
        return $.hasWSBeforeByPos[$.currIdx + 3] === 1;
      },
      ALT: () => $.SUBRULE($.declaration, { ARGS: [ctx] })
    },
    { ALT: () => $.SUBRULE($.qualifiedRule, { ARGS: [{ ...ctx, inner: true }] }) },
    { ALT: () => $.CONSUME($.T.Semi) }
  ];

  return $.SUBRULE($.main, { ARGS: [ctx, alt] }) as Node;
}
