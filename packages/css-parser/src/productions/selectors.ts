// Methods to be mixed into CssRecursiveParser
// This file is a temporary build artifact for assembly
import type { CssRecursiveParser, RuleContext } from '../cssRecursiveParser.js';
import type { IToken, OrAlternative } from '@jesscss/parser-runtime';
import { tokenMatches } from '@jesscss/parser-runtime';
import {
  Node, Any, BasicSelector, Ampersand, CompoundSelector, ComplexSelector,
  type ComplexSelectorValue, Combinator, type Combinators, SelectorList,
  Ruleset, Rules, Sequence, PseudoSelector, AttributeSelector,
  type SimpleSelector, type ComplexSelectorComponent,
  type LocationInfo
} from '@jesscss/core';

type P = CssRecursiveParser;

export type Alt = OrAlternative[];
export type AltContext = (ctx?: RuleContext) => Alt;

export function stylesheet(this: P, options: Record<string, any> = {}) {
  /** Auto-creates tree context */
  let context = this.context;

  let charset: IToken | undefined;

  this.option(() => {
    charset = this.consume(this.T.Charset);
  });

  const ctx: RuleContext = { isRoot: true };
  let root: Node = this.main();

  let rules = root.value as Node[];

  if (charset) {
    let loc = this.getLocationInfo(charset);
    let rootLoc = root.location;
    rules.unshift(new Any(charset.image, { role: 'charset' }, loc, context!));
    rootLoc[0] = loc[0];
    rootLoc[1] = loc[1];
    rootLoc[2] = loc[2];
  }

  return root;
}

export function main(this: P, ctx: RuleContext = {}, alt?: AltContext | Alt) {
  alt ??= (ctx: RuleContext = {}) => [
    /** GATE kept: @ commits to atRule for correct error reporting */
    { GATE: () => tokenMatches(this.la(1), this.T.AtName), ALT: () => this.atRule() },
    { ALT: () => this.qualifiedRule() }
  ];

  const isRoot = !!ctx.isRoot;
  let context = this.context;
  let rules: Node[] = [];

  let requiredSemi = false;

  let lastRule: Node | undefined;
  /**
   * In this production rule, semi-colons are not required
   * but this is repurposed by declarationList and by Less / Sass,
   * so that's why this gate is here.
   */
  this.many({
    GATE: () => {
      const next = this.la(1);
      // Stop at RCurly (belongs to parent block) or end of input
      if (next.tokenType === this.T.RCurly || next.tokenType.name === 'EOF') {
        return false;
      }
      return !requiredSemi || (requiredSemi && (
        next.tokenType === this.T.Semi
        || this.la(0).tokenType === this.T.Semi
      ));
    },
    DEF: () => {
      const localAlt = typeof alt === 'function' ? alt(ctx) : alt!;
      let value = this.or(localAlt);
      if (!(value instanceof Node)) {
        /** This is a semi-colon token */
        if (lastRule) {
          lastRule.options.semi = true;
        } else {
          rules.push(new Any(';', { role: 'semi' }, this.getLocationInfo(this.la(1)), context));
        }
      } else {
        requiredSemi = !!value.requiredSemi;
        rules.push(value);
        lastRule = value;
      }
    }
  });

  let returnNode = this.getRulesWithComments(rules!, this.getLocationInfo(this.la(1)));
  // Attaches remaining whitespace at the end of rules
  const wrapped = this.wrap(returnNode!, true);

  return wrapped;
}

export function qualifiedRule(this: P, ctx: RuleContext = {}, selectorAlt?: AltContext) {
  selectorAlt ??= (ctx: RuleContext = {}) => [
    {
      GATE: () => !ctx.inner,
      ALT: () => this.selectorList(ctx)
    },
    {
      GATE: () => !!ctx.inner,
      ALT: () => this.forgivingSelectorList(ctx)
    }
  ];
  // qualifiedRule
  //   : selectorList WS* LCURLY declarationList RCURLY
  //   ;
  this.startRule();

  let selector = this.or(selectorAlt(ctx));

  this.consume(this.T.LCurly);
  let rules = this.declarationList() as Rules;
  this.consume(this.T.RCurly);

  let location = this.endRule();

  const ruleset = new Ruleset({
    selector,
    rules
  }, undefined, location, this.context);
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
  selectorAlt ??= (ctx: RuleContext = {}) => [
    {
      /**
       * It used to be the case that, in CSS Nesting, the first selector
       * could not be an identifier. However, it looks like that's no
       * longer the case.
       *
       * @see: https://github.com/w3c/csswg-drafts/issues/9317
       */
      ALT: () => this.consume(this.T.Ident)
    },
    {
      /** In CSS Nesting, outer selector can't contain an ampersand */
      GATE: () => !!ctx.inner,
      ALT: () => this.consume(this.T.Ampersand)
    },
    { ALT: () => this.classSelector() },
    { ALT: () => this.idSelector(ctx) },
    { ALT: () => this.consume(this.T.Star) },
    { ALT: () => this.pseudoSelector(ctx) },
    { ALT: () => this.attributeSelector(ctx) },
    /** Supports keyframes selectors */
    { ALT: () => this.consume(this.T.DimensionInt) },
    { ALT: () => this.consume(this.T.DimensionNum) }
  ];

  let selector = this.or(selectorAlt(ctx));

  if (this.isToken(selector)) {
    if (selector.tokenType.name === 'Ampersand') {
      return new Ampersand(undefined, undefined, this.getLocationInfo(selector), this.context);
    }
    return new BasicSelector(selector.image, undefined, this.getLocationInfo(selector), this.context);
  }
  return selector as Node;
}

// classSelector
//   : DOT identifier
//   ;
export function classSelector(this: P) {
  let selector = this.consume(this.T.DotName);
  return new BasicSelector(selector.image, undefined, this.getLocationInfo(selector), this.context);
}

export function idSelector(this: P, ctx: RuleContext = {}, selectorAlt?: AltContext) {
  selectorAlt ??= (ctx: RuleContext = {}) => [
    { ALT: () => this.consume(this.T.HashName) },
    { ALT: () => this.consume(this.T.ColorIdentStart) }
  ];
  /** #id, #FF0000 are both valid ids */
  let selector = this.or(selectorAlt(ctx));
  return new BasicSelector(selector.image, undefined, this.getLocationInfo(selector), this.context);
}

export function pseudoSelector(this: P, ctx: RuleContext = {}, selectorAlt?: AltContext) {
  const createPseudo = (name: string, arg?: Node) => {
    let location = this.endRule();
    return new PseudoSelector({
      name,
      arg
    }, undefined, location, this.context);
  };

  selectorAlt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        let name = this.consume(this.T.NthPseudoClass);
        let val = this.nthValue(ctx);
        this.consume(this.T.RParen);

        return createPseudo(name.image.slice(0, -1), val);
      }
    },
    {
      ALT: () => {
        let name = this.consume(this.T.SelectorPseudoClass);
        let val = this.forgivingSelectorList(ctx);
        this.consume(this.T.RParen);

        return createPseudo(name.image.slice(0, -1), val);
      }
    },
    {
      ALT: () => {
        let name = this.consume(this.T.Colon).image;
        if (this.noSep()) {
          this.option(() => {
            name += this.consume(this.T.Colon).image;
          });
        }
        /**
         * We use OR often to assert that no whitespace is allowed.
         * There's no other way currently to do a positive-assertion Gate
         * in Chevrotain.
         */
        let values = this.or([
          {
            /** ::unknown(values) */
            GATE: this.noSep.bind(this),
            ALT: () => {
              name += this.consume(this.T.GenericFunctionStart).image;
              let values: Node[] = [];
              name = name.slice(0, -1);
              let valuesLocation: LocationInfo;

              this.startRule();
              this.many(() => {
                let val = this.anyInnerValue();
                values!.push(val);
              });
              valuesLocation = this.endRule();
              this.consume(this.T.RParen);

              if (values!.length) {
                return new Sequence(values!, undefined, valuesLocation!, this.context);
              }
            }
          },
          {
            /** ::unknown  */
            GATE: this.noSep.bind(this),
            ALT: () => {
              name += this.consume(this.T.Ident).image;
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
  this.startRule();
  return this.or(selectorAlt(ctx));
}

export function nthValue(this: P, ctx: RuleContext = {}, valueAlt?: AltContext) {
  valueAlt ??= (ctx: RuleContext = {}) => {
    return [
      { ALT: () => this.consume(this.T.NthOdd) },
      { ALT: () => this.consume(this.T.NthEven) },
      { ALT: () => this.consume(this.T.Integer) },
      {
        ALT: () => {
          this.or([
            { ALT: () => this.consume(this.T.NthSignedDimension) },
            { ALT: () => this.consume(this.T.NthUnsignedDimension) },
            { ALT: () => this.consume(this.T.NthSignedPlus) },
            { ALT: () => this.consume(this.T.NthIdent) }
          ]);
          this.option(() => {
            this.or([
              { ALT: () => this.consume(this.T.SignedInt) },
              {
                ALT: () => {
                  this.consume(this.T.Minus);
                  this.consume(this.T.UnsignedInt);
                }
              }
            ]);
          });
          this.option(() => {
            this.consume(this.T.Of);
            this.complexSelector(ctx);
          });
        }
      }
    ];
  };

  /**
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/:nth-child
   */
  this.startRule();
  let startTokenOffset: number | undefined = this.la(1).startOffset;

  this.or(valueAlt(ctx));

  /** Coelesce all token values into one value */
  let endTokenOffset = this.la(0).startOffset;
  let location = this.endRule();
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
  return this.wrap(new Any(tokenValues, { role: 'any' }, location, this.context), 'both');
}

// attributeSelector
//   : LSQUARE WS* identifier (STAR | TILDE | CARET | DOLLAR | PIPE)? EQ WS* (identifier | STRING) WS* (ATTRIBUTE_FLAG WS*)? RSQUARE
//   ;
export function attributeSelector(this: P, ctx: RuleContext = {}, valueAlt?: AltContext) {
  valueAlt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        let token = this.consume(this.T.Ident);
        return new Any(token.image, { role: 'ident' }, this.getLocationInfo(token), this.context);
      }
    },
    { ALT: () => this.string() }
  ];

  this.startRule();

  this.consume(this.T.LSquare);
  let key = this.consume(this.T.Ident);
  let op: IToken | undefined;
  let value: Node | undefined;
  let mod: IToken | undefined;
  this.option(() => {
    op = this.or([
      { ALT: () => this.consume(this.T.Eq) },
      { ALT: () => this.consume(this.T.AttrMatch) }
    ]);
    value = this.or(valueAlt(ctx));
  });
  this.option(() => mod = this.consume(this.T.AttrFlag));
  this.consume(this.T.RSquare);

  let location = this.endRule();
  return new AttributeSelector({
    name: key.image,
    op: op?.image,
    value,
    mod: mod?.image
  }, undefined, location, this.context);
}

export function compoundSelector(this: P, ctx: RuleContext = {}) {
  /**
      A sequence of simple selectors that are not separated by
      a combinator.
        .e.g. `a#selected`
    */
  // compoundSelector
  //   : simpleSelector+
  //   ;
  let selectors: SimpleSelector[] = [];
  let sel = this.simpleSelector(ctx);
  selectors!.push(sel as SimpleSelector);
  this.many({
    /** Make sure we don't ignore space combinators */
    GATE: () => !this.hasWS(),
    DEF: () => {
      sel = this.simpleSelector(ctx);
      /** Make sure we don't add implicit whitespace */
      sel.pre = 0;
      selectors.push(sel as SimpleSelector);
    }
  });
  if (selectors!.length === 1) {
    return selectors![0]!;
  }
  return new CompoundSelector(selectors!, undefined, this.getLocationFromNodes(selectors!), this.context);
}

/**
 * @param manyGate - Exposed for Less to exclude the keyword 'all' from the selector list
 */
export function complexSelector(this: P, ctx: RuleContext = {}, manyGate?: (ctx: RuleContext) => () => boolean) {
  manyGate ??= (ctx: RuleContext) => () => this.hasWS() || tokenMatches(this.la(1), this.T.Combinator);

  /**
      A sequence of one or more simple and/or compound selectors
      that are separated by combinators.
        .e.g. a#selected > .icon
    */
  // complexSelector
  //   : compoundSelector (WS* (combinator WS*)? compoundSelector)*
  //   ;
  let GATE = manyGate(ctx);
  this.startRule();
  let selectors: ComplexSelectorValue = [this.compoundSelector(ctx)];

  /**
   * Only space combinators and specified combinators will enter the MANY
   */
  this.many({
    GATE,
    DEF: () => {
      let co: IToken | undefined;
      let combinator: Combinator;
      this.option(() => {
        co = this.consume(this.T.Combinator);
      });
      if (co) {
        combinator = this.wrap(new Combinator(co.image as Combinators, undefined, this.getLocationInfo(co), this.context), 'both');
      } else {
        /** Whitespace combinators are special */
        let startOffset = this.la(1).startOffset;
        /**
         * Technically, a whitespace combinator may not actually _include_
         * a literal space (it can be a newline, for example), but we'll just use a
         * space for now.
         */
        combinator = new Combinator(' ', undefined, undefined, this.context);
        let pre = this.getPrePost(startOffset);
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
      let compound = this.compoundSelector(ctx) as CompoundSelector;
      selectors.push(
        combinator!,
        compound
      );
    }
  });

  let location = this.endRule();
  if (selectors.length === 1) {
    return selectors[0]!;
  }
  return new ComplexSelector(selectors as ComplexSelectorValue, undefined, location, this.context);
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
  return this.or([
    {
      ALT: () => {
        let co = this.consume(this.T.Combinator);
        let complex: Node = this.complexSelector(ctx);

        let combinator = new Combinator(co.image as Combinators, undefined, this.getLocationInfo(co), this.context);
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
            this.getLocationFromNodes([combinator, complex]),
            this.context
          );
        }
        return complex;
      }
    },
    {
      ALT: () => this.complexSelector(ctx)
    }
  ]);
}

export function forgivingSelectorList(this: P, ctx: RuleContext = {}) {
  /**
      https://www.w3.org/TR/css-nesting-1/

      NOTE: implementers should throw a parsing
      error if the selectorlist starts with an identifier
    */
  // forgivingSelectorList
  //   : relativeSelector (WS* COMMA WS* relativeSelector)*
  //   ;
  this.startRule();

  let sequences: ComplexSelector[] = [];
  let i = 0;

  this.atLeastOneSep({
    SEP: this.T.Comma,
    DEF: () => {
      let selector = this.relativeSelector(ctx);
      i++;
      if (i === 1 && ctx.qualifiedRule) {
        // Only attach post; leave pre for the parent Rules to lift comments
        sequences.push(this.wrap(selector, true) as ComplexSelector);
      } else {
        sequences.push(this.wrap(selector, i === 1 ? true : 'both') as ComplexSelector);
      }
    }
  });

  let location = this.endRule();
  if (sequences!.length === 1) {
    return sequences![0];
  }
  return new SelectorList(sequences!, undefined, location, this.context);
}

export function selectorList(this: P, ctx: RuleContext = {}) {
  // selectorList
  //   : complexSelector (WS* COMMA WS* complexSelector)*
  //   ;
  this.startRule();
  let i = 0;
  let sequences: ComplexSelector[] = [];

  this.atLeastOneSep({
    SEP: this.T.Comma,
    DEF: () => {
      let sel = this.complexSelector(ctx);
      i++;
      // Do not consume leading pre for the first selector of a qualified rule,
      // so that pre-rule comments remain available to be lifted to Rules.
      if (i === 1 && ctx.qualifiedRule) {
        // Only attach post; leave pre for the parent Rules to lift comments
        sequences.push(this.wrap(sel, true) as ComplexSelector);
      } else {
        sequences.push(this.wrap(sel, i === 1 ? true : 'both') as ComplexSelector);
      }
    }
  });

  let location = this.endRule();
  if (sequences!.length === 1) {
    return sequences![0]!;
  }

  return new SelectorList(sequences!, undefined, location, this.context);
}

export function declarationList(this: P, ctx: RuleContext = {}, alt?: AltContext): Node {
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
    { GATE: () => tokenMatches(this.la(1), this.T.AtName), ALT: () => this.innerAtRule({ ...ctx, inner: true }) },
    { ALT: () => this.declaration(ctx) },
    { ALT: () => this.qualifiedRule({ ...ctx, inner: true }) },
    { ALT: () => this.consume(this.T.Semi) }
  ];

  return this.main(ctx, alt);
}
