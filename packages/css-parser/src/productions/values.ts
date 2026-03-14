// Methods to be mixed into CssRecursiveParser
import type { CssRecursiveParser, RuleContext } from '../cssRecursiveParser.js';
import type { IToken } from '@jesscss/parser-runtime';
import { tokenMatches } from '@jesscss/parser-runtime';
import {
  Node, Any, Declaration, CustomDeclaration, Sequence, List, Block,
  Quoted, Call, Url, Paren, Operation, type AssignmentType, type Operator, Keyword
} from '@jesscss/core';

type P = CssRecursiveParser;

type Alt = Array<{ ALT: () => any; GATE?: () => boolean }>;
type AltContext = (ctx?: RuleContext) => Alt;

export function declaration(this: P, ctx: RuleContext = {}, alt?: AltContext) {
  const $ = this;
  alt ??= (ctx: RuleContext = {}) => [
    {
      GATE: () => !$.isType($.T.CustomProperty),
      ALT: () => {
        let name: IToken;
        $.OR([
          {
            ALT: () => name = $.CONSUME($.T.Ident)
          },
          {
            GATE: () => $.legacyMode,
            ALT: () => name = $.CONSUME($.T.LegacyPropIdent)
          }
        ]);
        let assign = $.CONSUME($.T.Assign);
        let value = $.valueList(ctx);
        let important: IToken | undefined;
        $.OPTION(() => {
          important = $.CONSUME($.T.Important);
        });
        let nameNode = $.wrap(new Any(name!.image, { role: 'property' }, $.getLocationInfo(name!), $.context), true);
        return [nameNode, assign, value, important];
      }
    },
    {
      GATE: () => $.isType($.T.CustomProperty),
      ALT: () => {
        let name = $.CONSUME($.T.CustomProperty);
        let assign = $.CONSUME($.T.Assign);
        let nodes: Node[] = [];
        $.startRule();
        $.MANY({
          GATE: () => !$.isType($.T.Semi) && !$.isType($.T.RCurly) && $.LA(1).tokenType.name !== 'EOF',
          DEF: () => {
            let val = $.customValue({ ...ctx, inCustomPropertyValue: true });
            nodes.push(val);
          }
        });
        let location = $.endRule();
        let nameNode = $.wrap(new Any(name.image, { role: 'property' }, $.getLocationInfo(name), $.context), true);
        let value = new Sequence(nodes, undefined, location, $.context);
        return [nameNode, assign, value];
      }
    }
  ];
  // declaration
  //   : identifier WS* COLON WS* valueList (WS* IMPORTANT)?
  //   | CUSTOM_IDENT WS* COLON CUSTOM_VALUE*
  //   ;
  $.startRule();
  let name: Any<'property'> | undefined;
  let assign: IToken | undefined;
  let value: Node | undefined;
  let important: IToken | undefined;
  let val = $.OR(alt(ctx));

  ([name, assign, value, important] = val);

  let location = $.endRule();
  const isCustom = name!.valueOf().startsWith('--');
  const wrapCtx = isCustom ? { ...ctx, inCustomPropertyValue: true } : ctx;
  return new (isCustom ? CustomDeclaration : Declaration)({
    name: name!,
    value: $.wrap(value!, 'both', wrapCtx),
    important: important ? $.wrap(new Any(important.image, { role: 'flag' }, $.getLocationInfo(important), $.context), 'both') : undefined
  }, { assign: assign!.image as AssignmentType }, location, $.context);
}

/**
 * @todo - This could be implemented with a multi-mode lexer?
 * Multi-modes was the right way to do it with Antlr, but
 * Chevrotain does not support recursive tokens very well.
 */
export function customValue(this: P, ctx: RuleContext = {}, alt?: AltContext) {
  const $ = this;
  /** Should be almost anything, but custom blocks need matching closers */
  // Order matters: prefer nested blocks first, then strings, then raw tokens.
  // Avoid knownFunctions here to remove ambiguity with custom blocks.
  alt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        return $.customBlock(ctx);
      }
    },
    {
      ALT: () => {
        return $.string(ctx);
      }
    },
    {
      ALT: () => {
        const token = $.OR([
          { ALT: () => $.CONSUME($.T.Value) },
          { ALT: () => $.CONSUME($.T.CustomProperty) },
          { ALT: () => $.CONSUME($.T.Colon) },
          { ALT: () => $.CONSUME($.T.AtName) },
          { ALT: () => $.CONSUME($.T.Comma) },
          { ALT: () => $.CONSUME($.T.Important) },
          { ALT: () => $.CONSUME($.T.Unknown) }
        ]);
        return $.wrap($.processValueToken(token, ctx), undefined, ctx);
      }
    }
  ];

  return $.OR(alt(ctx));
}

export function innerCustomValue(this: P, ctx: RuleContext = {}, alt?: AltContext) {
  const $ = this;
  alt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        /** Can also have semi-colons */
        let semi = $.CONSUME($.T.Semi);
        return $.wrap(new Any(semi.image, { role: 'semi' }, $.getLocationInfo(semi), $.context));
      }
    },
    { ALT: () => $.customValue(ctx) }
  ];

  return $.OR(alt(ctx));
}

/**
 * Extra tokens in a custom property or general enclosed. Should include any
 * and every token possible (except semis), including unknown tokens.
 *
 * @todo - In tests, is there a way to test that every token is captured?
 */
export function extraTokens(this: P, ctx: RuleContext = {}, alt?: AltContext) {
  const $ = this;
  alt ??= (ctx: RuleContext = {}) => [
    { ALT: () => $.functionCallLike(ctx) },
    { ALT: () => $.CONSUME($.T.Value) },
    { ALT: () => $.CONSUME($.T.CustomProperty) },
    { ALT: () => $.CONSUME($.T.Colon) },
    { ALT: () => $.CONSUME($.T.AtName) },
    { ALT: () => $.CONSUME($.T.Comma) },
    { ALT: () => $.CONSUME($.T.Important) },
    { ALT: () => $.CONSUME($.T.Unknown) }
  ];

  let node: Node = $.OR(alt(ctx));
  if (!(node instanceof Node)) {
    node = $.wrap($.processValueToken(node));
  }
  return node;
}

export function customBlock(this: P, ctx: RuleContext = {}, alt?: AltContext) {
  const $ = this;
  alt ??= (ctx: RuleContext = {}) => [
    {
      GATE: () => $.isType($.T.LParen)
        || $.isType($.T.FunctionStart)
        || $.isType($.T.GenericFunctionStart)
        || $.isType($.T.FunctionalPseudoClass),
      ALT: () => {
        let start: IToken;
        let nodes: Node[] = [];
        $.OR([
          /**
           * All tokens that have a left parentheses.
           * These need to match a right parentheses.
           */
          { ALT: () => start = $.CONSUME($.T.LParen) },
          { ALT: () => start = $.CONSUME($.T.FunctionStart) },
          { ALT: () => start = $.CONSUME($.T.GenericFunctionStart) },
          { ALT: () => start = $.CONSUME($.T.FunctionalPseudoClass) }
        ]);

        $.MANY({
          GATE: () => !$.isType($.T.RParen),
          DEF: () => {
            let val = $.innerCustomValue(ctx);
            nodes.push(val);
          }
        });
        let end = $.CONSUME($.T.RParen);
        return [start!, nodes, end];
      }
    },
    {
      GATE: () => $.isType($.T.LSquare),
      ALT: () => {
        let nodes: Node[] = [];
        let start = $.CONSUME($.T.LSquare);
        $.MANY({
          GATE: () => !$.isType($.T.RSquare),
          DEF: () => {
            let val = $.innerCustomValue(ctx);
            nodes.push(val);
          }
        });
        let end = $.CONSUME($.T.RSquare);

        return [start, nodes, end];
      }
    },
    {
      GATE: () => $.isType($.T.LCurly),
      ALT: () => {
        let nodes: Node[] = [];
        let start = $.CONSUME($.T.LCurly);
        $.MANY({
          GATE: () => !$.isType($.T.RCurly),
          DEF: () => {
            let val = $.innerCustomValue(ctx);
            nodes.push(val);
          }
        });
        let end = $.CONSUME($.T.RCurly);

        return [start, nodes, end];
      }
    }
  ];

  $.startRule();
  let start: IToken | undefined;
  let end: IToken | undefined;
  let nodes: Node[];

  let val = $.OR(alt(ctx));

  ([start, nodes, end] = val);

  let location = $.endRule();
  let type: 'square' | 'curly' | undefined;
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
    let seq = new Sequence(nodes!, undefined, seqLoc, $.context);
    return $.wrap(new Block($.wrap(seq, true, ctx), { type }, location, $.context), undefined, ctx);
  } else {
    let startNode = $.wrap(new Any(start!.image, { role: 'any' }, $.getLocationInfo(start!), $.context), undefined, ctx);
    let endNode = $.wrap(new Any(end!.image, { role: 'any' }, $.getLocationInfo(end!), $.context), undefined, ctx);
    nodes = [startNode, ...nodes!, endNode];
    return new Sequence(nodes, undefined, location, $.context);
  }
}

export function valueList(this: P, ctx: RuleContext = {}) {
  const $ = this;
  /** Values separated by commas */
  // valueList
  //   : value+ (, value+)*
  //   ;
  $.startRule();
  let nodes: Node[] = [];

  $.AT_LEAST_ONE_SEP({
    SEP: $.T.Comma,
    DEF: () => {
      let seq = $.valueSequence(ctx);
      nodes.push(seq);
    }
  });

  let location = $.endRule();
  if (nodes.length === 1) {
    return nodes[0];
  }
  return new List(nodes, undefined, location, $.context);
}

export function valueSequence(this: P, ctx: RuleContext = {}) {
  const $ = this;
  /** Often space-separated */
  $.startRule();
  let nodes: Node[] = [];

  $.AT_LEAST_ONE(() => {
    let value = $.value(ctx);

    nodes.push($.wrap(value));
  });

  let location = $.endRule();
  if (nodes.length === 1) {
    return $.wrap(nodes[0]!, true);
  }
  return $.wrap(new Sequence(nodes, undefined, location, $.context), true);
}

export function squareValue(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  $.CONSUME($.T.LSquare);
  let ident = $.CONSUME($.T.Ident);
  $.CONSUME($.T.RSquare);
  let location = $.endRule();
  let identNode = new Any(ident.image, { role: 'ident' }, $.getLocationInfo(ident), $.context);
  return new Block(identNode, { type: 'square' }, location, $.context);
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
export function value(this: P, ctx: RuleContext = {}, valueAlt?: AltContext) {
  const $ = this;
  valueAlt ??= (ctx: RuleContext = {}) => [
    /** Function should appear before Ident */
    {
      GATE: () => $.check($.T.FunctionStart),
      ALT: () => $.functionCall(ctx)
    },
    { ALT: () => $.CONSUME($.T.Ident) },
    { ALT: () => $.CONSUME($.T.Dimension) },
    { ALT: () => $.CONSUME($.T.Number) },
    { ALT: () => $.CONSUME($.T.Color) },
    { ALT: () => $.CONSUME($.T.UnicodeRange) },
    { ALT: () => $.string(ctx) },
    { ALT: () => $.squareValue(ctx) },
    {
      /** e.g. progid:DXImageTransform.Microsoft.Blur(pixelradius=2) */
      GATE: () => $.legacyMode,
      ALT: () => $.CONSUME($.T.LegacyMSFilter)
    }
  ];

  $.startRule();
  let node: Node = $.OR(valueAlt(ctx));
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
    $.CONSUME($.T.Slash);
    additionalValue = $.value(ctx);
  });
  let location = $.endRule();
  if (!(node instanceof Node)) {
    node = $.processValueToken(node);
  }
  if (additionalValue) {
    return $.wrap(new List([$.wrap(node, true), additionalValue], { sep: '/' }, location, $.context));
  }
  return $.wrap(node);
}

export function string(this: P, ctx: RuleContext = {}, stringAlt?: AltContext) {
  const $ = this;
  stringAlt ??= (ctx: RuleContext = {}) => [
    {
      GATE: () => $.isType($.T.SingleQuoteStart),
      ALT: () => {
        $.startRule();
        let quote = $.CONSUME($.T.SingleQuoteStart);
        let contents: IToken | undefined;
        $.OPTION(() => contents = $.CONSUME($.T.SingleQuoteStringContents));
        $.CONSUME($.T.SingleQuoteEnd);
        let location = $.endRule();
        const escaped = quote.image.startsWith('~');
        const quoteChar = quote.image.replace(/^~/, '') as '"' | '\'';
        let value = contents?.image ?? '';
        if (escaped) {
          value = value.replace(/\\(?:\r\n?|\n|\f)/g, '\n');
        }
        return new Quoted(new Any(value, { role: 'any' }), { quote: quoteChar, escaped }, location, $.context);
      }
    },
    {
      GATE: () => $.isType($.T.DoubleQuoteStart),
      ALT: () => {
        $.startRule();
        let quote = $.CONSUME($.T.DoubleQuoteStart);
        let contents: IToken | undefined;
        $.OPTION(() => contents = $.CONSUME($.T.DoubleQuoteStringContents));
        $.CONSUME($.T.DoubleQuoteEnd);
        let location = $.endRule();
        const escaped = quote.image.startsWith('~');
        const quoteChar = quote.image.replace(/^~/, '') as '"' | '\'';
        let value = contents?.image ?? '';
        if (escaped) {
          value = value.replace(/\\(?:\r\n?|\n|\f)/g, '\n');
        }
        return new Quoted(new Any(value, { role: 'any' }), { quote: quoteChar, escaped }, location, $.context);
      }
    }
  ];

  return $.OR(stringAlt(ctx));
}

/** Abstracted for easy over-ride */
// $.RULE('expression', () => {
//   $.SUBRULE($.mathSum)
// })
export function mathSum(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let opAlt = [
    { ALT: () => $.CONSUME($.T.Plus) },
    { ALT: () => $.CONSUME($.T.Minus) }
  ];
  // mathSum
  //   : mathProduct (WS* ('+' | '-') WS* mathProduct)*
  //   ;
  $.startRule();

  let left: Node = $.mathProduct(ctx);

  $.MANY({
    GATE: () => $.isType($.T.Plus) || $.isType($.T.Minus),
    DEF: () => {
      let op = $.OR(opAlt);
      let right: Node = $.mathProduct(ctx);

      left = new Operation([left, op.image as Operator, right], { inCalc: true }, undefined, $.context);
    }
  });
  left._location = $.endRule();
  return left;
}

// mathProduct
//   : mathValue (WS* ('*' | '/') WS* mathValue)*
//   ;
export function mathProduct(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let opAlt = [
    { ALT: () => $.CONSUME($.T.Star) },
    { ALT: () => $.CONSUME($.T.Divide) }
  ];

  $.startRule();

  let left: Node = $.mathValue(ctx);

  $.MANY({
    GATE: () => $.isType($.T.Star) || $.isType($.T.Divide),
    DEF: () => {
      let op = $.OR(opAlt);
      let right: Node = $.mathValue(ctx);

      left = new Operation([left, op.image as Operator, right], { inCalc: true }, undefined, $.context);
    }
  });

  left._location = $.endRule();
  return left;
}

// mathValue
//   : number
//   | dimension
//   | percentage
//   | mathConstant
//   | '(' WS* mathSum WS* ')'
//   ;
export function mathValue(this: P, ctx: RuleContext = {}, alt?: AltContext) {
  const $ = this;
  alt ??= (ctx: RuleContext = {}) => [
    { ALT: () => $.CONSUME($.T.Number) },
    { ALT: () => $.CONSUME($.T.Dimension) },
    // Allow identifiers like channel names in color space calcs (e.g., calc(l - 0.1))
    { ALT: () => $.CONSUME($.T.Ident) },
    { ALT: () => $.CONSUME($.T.MathConstant) },
    { ALT: () => $.knownFunctions(ctx) },
    { ALT: () => $.mathParen(ctx) }
  ];

  let node: Node = $.OR(alt(ctx));
  if (!(node instanceof Node)) {
    node = $.processValueToken(node);
  }
  return $.wrap(node, 'both');
}

export function mathParen(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  $.CONSUME($.T.LParen);
  let node = $.mathSum(ctx);
  $.CONSUME($.T.RParen);
  let location = $.endRule();
  return new Paren(node, undefined, location, $.context);
}

// function
//   : URL_FUNCTION
//   | VAR_FUNCTION '(' WS* CUSTOM_IDENT (WS* COMMA WS* valueList)? ')'
//   | CALC_FUNCTION '(' WS* mathSum WS* ')'
//   | identifier '(' valueList ')'
//   ;
// These have special parsing rules
export function knownFunctions(this: P, ctx: RuleContext = {}, alt?: AltContext) {
  const $ = this;
  alt ??= (ctx: RuleContext = {}) => [
    { ALT: () => $.urlFunction(ctx) },
    { ALT: () => $.varFunction(ctx) },
    { ALT: () => $.calcFunction(ctx) }
  ];

  return $.OR(alt(ctx));
}

export function ifFunctionArgs(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  let branches: Node[] = [];
  $.AT_LEAST_ONE_SEP({
    SEP: $.T.Semi,
    DEF: () => {
      const condition = $.valueSequence({ ...ctx, inner: true });
      $.CONSUME($.T.Assign);
      const value = $.valueList({ ...ctx, inner: true });
      const sep = $.wrap(new Any(':', { role: 'operator' }, undefined, $.context), true);
      const loc = $.getLocationFromNodes([condition as Node, value as Node].filter(Boolean));
      branches.push(new Sequence([$.wrap(condition as Node, true), sep, $.wrap(value as Node, true)], undefined, loc, $.context));
    }
  });
  $.OPTION(() => $.CONSUME($.T.Semi));
  const location = $.endRule();
  if (branches.length === 1) {
    return branches[0]!;
  }
  return new List(branches, { sep: ';' }, location, $.context);
}

export function ifFunction(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  const start = $.CONSUME($.T.FunctionStart);
  const args = $.ifFunctionArgs({ ...ctx, inner: true }) as Node;
  $.CONSUME($.T.RParen);
  const location = $.endRule();
  return new Call({
    name: start.image.slice(0, -1),
    args: new List([args])
  }, undefined, location, $.context);
}

export function varFunction(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  $.CONSUME($.T.Var);
  let prop = $.CONSUME($.T.CustomProperty);
  let args: List | undefined;
  $.OPTION(() => {
    $.CONSUME($.T.Comma);
    args = $.valueList(ctx) as List;
  });
  $.CONSUME($.T.RParen);

  let location = $.endRule();
  let propNode = $.wrap(new Any(prop.image, { role: 'customprop' }, $.getLocationInfo(prop), $.context), 'both');
  if (!args) {
    args = new List([propNode], undefined, $.getLocationInfo(prop), $.context);
  } else {
    const newData = [propNode, ...args.data];
    const loc = $.getLocationFromNodes([propNode, ...args.data]);
    args = new List(newData, undefined, loc ?? $.getLocationInfo(prop), $.context);
  }
  return new Call({
    name: 'var',
    args
  }, undefined, location, $.context);
}

export function calcFunction(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  $.CONSUME($.T.Calc);
  let args = $.mathSum(ctx);
  $.CONSUME($.T.RParen);

  let location = $.endRule();
  return new Call({
    name: 'calc',
    args: new List([args])
  }, undefined, location, $.context);
}

export function urlFunction(this: P, ctx: RuleContext = {}, alt?: AltContext) {
  const $ = this;
  alt ??= (ctx: RuleContext = {}) => [
    { ALT: () => $.string(ctx) },
    { ALT: () => $.CONSUME($.T.NonQuotedUrl) }
  ];

  $.startRule();

  $.CONSUME($.T.UrlStart);
  let node: Any | IToken = $.OR(alt(ctx));
  $.CONSUME($.T.UrlEnd);

  let location = $.endRule();
  if (!(node instanceof Node)) {
    /** Whitespace should be included in the NonQuotedUrl */
    node = new Any(node.image, { role: 'urlvalue' }, $.getLocationInfo(node), $.context);
  }
  return new Url(node, undefined, location, $.context);
}
