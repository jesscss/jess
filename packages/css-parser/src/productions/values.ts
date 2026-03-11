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
  alt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        let name: IToken;
        this.or([
          {
            ALT: () => name = this.consume(this.T.Ident)
          },
          {
            GATE: () => this.legacyMode,
            ALT: () => name = this.consume(this.T.LegacyPropIdent)
          }
        ]);
        let assign = this.consume(this.T.Assign);
        let value = this.valueList(ctx);
        let important: IToken | undefined;
        this.option(() => {
          important = this.consume(this.T.Important);
        });
        let nameNode = this.wrap(new Any(name!.image, { role: 'property' }, this.getLocationInfo(name!), this.context), true);
        return [nameNode, assign, value, important];
      }
    },
    {
      ALT: () => {
        let name = this.consume(this.T.CustomProperty);
        let assign = this.consume(this.T.Assign);
        let nodes: Node[] = [];
        this.startRule();
        this.many(() => {
          let val = this.customValue({ ...ctx, inCustomPropertyValue: true });
          nodes.push(val);
        });
        let location = this.endRule();
        let nameNode = this.wrap(new Any(name.image, { role: 'property' }, this.getLocationInfo(name), this.context), true);
        let value = new Sequence(nodes, undefined, location, this.context);
        return [nameNode, assign, value];
      }
    }
  ];
  // declaration
  //   : identifier WS* COLON WS* valueList (WS* IMPORTANT)?
  //   | CUSTOM_IDENT WS* COLON CUSTOM_VALUE*
  //   ;
  this.startRule();
  let name: Any<'property'> | undefined;
  let assign: IToken | undefined;
  let value: Node | undefined;
  let important: IToken | undefined;
  let val = this.or(alt(ctx));

  ([name, assign, value, important] = val);

  let location = this.endRule();
  const isCustom = name!.valueOf().startsWith('--');
  const wrapCtx = isCustom ? { ...ctx, inCustomPropertyValue: true } : ctx;
  return new (isCustom ? CustomDeclaration : Declaration)({
    name: name!,
    value: this.wrap(value!, 'both', wrapCtx),
    important: important ? this.wrap(new Any(important.image, { role: 'flag' }, this.getLocationInfo(important), this.context), 'both') : undefined
  }, { assign: assign!.image as AssignmentType }, location, this.context);
}

/**
 * @todo - This could be implemented with a multi-mode lexer?
 * Multi-modes was the right way to do it with Antlr, but
 * Chevrotain does not support recursive tokens very well.
 */
export function customValue(this: P, ctx: RuleContext = {}, alt?: AltContext) {
  /** Should be almost anything, but custom blocks need matching closers */
  // Order matters: prefer nested blocks first, then strings, then raw tokens.
  // Avoid knownFunctions here to remove ambiguity with custom blocks.
  alt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        return this.customBlock(ctx);
      }
    },
    {
      ALT: () => {
        return this.string(ctx);
      }
    },
    {
      ALT: () => {
        const token = this.or([
          { ALT: () => this.consume(this.T.Value) },
          { ALT: () => this.consume(this.T.CustomProperty) },
          { ALT: () => this.consume(this.T.Colon) },
          { ALT: () => this.consume(this.T.AtName) },
          { ALT: () => this.consume(this.T.Comma) },
          { ALT: () => this.consume(this.T.Important) },
          { ALT: () => this.consume(this.T.Unknown) }
        ]);
        return this.wrap(this.processValueToken(token, ctx), undefined, ctx);
      }
    }
  ];

  return this.or(alt(ctx));
}

export function innerCustomValue(this: P, ctx: RuleContext = {}, alt?: AltContext) {
  alt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        /** Can also have semi-colons */
        let semi = this.consume(this.T.Semi);
        return this.wrap(new Any(semi.image, { role: 'semi' }, this.getLocationInfo(semi), this.context));
      }
    },
    { ALT: () => this.customValue(ctx) }
  ];

  return this.or(alt(ctx));
}

/**
 * Extra tokens in a custom property or general enclosed. Should include any
 * and every token possible (except semis), including unknown tokens.
 *
 * @todo - In tests, is there a way to test that every token is captured?
 */
export function extraTokens(this: P, ctx: RuleContext = {}, alt?: AltContext) {
  alt ??= (ctx: RuleContext = {}) => [
    { ALT: () => this.functionCallLike(ctx) },
    { ALT: () => this.consume(this.T.Value) },
    { ALT: () => this.consume(this.T.CustomProperty) },
    { ALT: () => this.consume(this.T.Colon) },
    { ALT: () => this.consume(this.T.AtName) },
    { ALT: () => this.consume(this.T.Comma) },
    { ALT: () => this.consume(this.T.Important) },
    { ALT: () => this.consume(this.T.Unknown) }
  ];

  let node: Node = this.or(alt(ctx));
  if (!(node instanceof Node)) {
    node = this.wrap(this.processValueToken(node));
  }
  return node;
}

export function customBlock(this: P, ctx: RuleContext = {}, alt?: AltContext) {
  alt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        let start: IToken;
        let nodes: Node[] = [];
        this.or([
          /**
           * All tokens that have a left parentheses.
           * These need to match a right parentheses.
           */
          { ALT: () => start = this.consume(this.T.LParen) },
          { ALT: () => start = this.consume(this.T.FunctionStart) },
          { ALT: () => start = this.consume(this.T.FunctionalPseudoClass) }
        ]);

        this.many(() => {
          let val = this.innerCustomValue(ctx);
          nodes.push(val);
        });
        let end = this.consume(this.T.RParen);
        return [start!, nodes, end];
      }
    },
    {
      ALT: () => {
        let nodes: Node[] = [];
        let start = this.consume(this.T.LSquare);
        this.many(() => {
          let val = this.innerCustomValue(ctx);
          nodes.push(val);
        });
        let end = this.consume(this.T.RSquare);

        return [start, nodes, end];
      }
    },
    {
      ALT: () => {
        let nodes: Node[] = [];
        let start = this.consume(this.T.LCurly);
        this.many(() => {
          let val = this.innerCustomValue(ctx);
          nodes.push(val);
        });
        let end = this.consume(this.T.RCurly);

        return [start, nodes, end];
      }
    }
  ];

  this.startRule();
  let start: IToken | undefined;
  let end: IToken | undefined;
  let nodes: Node[];

  let val = this.or(alt(ctx));

  ([start, nodes, end] = val);

  let location = this.endRule();
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
    const seqLoc = nodes!.length ? this.getLocationFromNodes(nodes!) : undefined;
    let seq = new Sequence(nodes!, undefined, seqLoc, this.context);
    return this.wrap(new Block(this.wrap(seq, true, ctx), { type }, location, this.context), undefined, ctx);
  } else {
    let startNode = this.wrap(new Any(start!.image, { role: 'any' }, this.getLocationInfo(start!), this.context), undefined, ctx);
    let endNode = this.wrap(new Any(end!.image, { role: 'any' }, this.getLocationInfo(end!), this.context), undefined, ctx);
    nodes = [startNode, ...nodes!, endNode];
    return new Sequence(nodes, undefined, location, this.context);
  }
}

export function valueList(this: P, ctx: RuleContext = {}) {
  /** Values separated by commas */
  // valueList
  //   : value+ (, value+)*
  //   ;
  this.startRule();
  let nodes: Node[] = [];

  this.atLeastOneSep({
    SEP: this.T.Comma,
    DEF: () => {
      let seq = this.valueSequence(ctx);
      nodes.push(seq);
    }
  });

  let location = this.endRule();
  if (nodes.length === 1) {
    return nodes[0];
  }
  return new List(nodes, undefined, location, this.context);
}

export function valueSequence(this: P, ctx: RuleContext = {}) {
  /** Often space-separated */
  this.startRule();
  let nodes: Node[] = [];

  this.atLeastOne(() => {
    let value = this.value(ctx);

    nodes.push(this.wrap(value));
  });

  let location = this.endRule();
  if (nodes.length === 1) {
    return this.wrap(nodes[0]!, true);
  }
  return this.wrap(new Sequence(nodes, undefined, location, this.context), true);
}

export function squareValue(this: P, ctx: RuleContext = {}) {
  this.startRule();
  this.consume(this.T.LSquare);
  let ident = this.consume(this.T.Ident);
  this.consume(this.T.RSquare);
  let location = this.endRule();
  let identNode = new Any(ident.image, { role: 'ident' }, this.getLocationInfo(ident), this.context);
  return new Block(identNode, { type: 'square' }, location, this.context);
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
  valueAlt ??= (ctx: RuleContext = {}) => [
    /** Function should appear before Ident */
    { ALT: () => this.functionCall(ctx) },
    { ALT: () => this.consume(this.T.Ident) },
    { ALT: () => this.consume(this.T.Dimension) },
    { ALT: () => this.consume(this.T.Number) },
    { ALT: () => this.consume(this.T.Color) },
    { ALT: () => this.consume(this.T.UnicodeRange) },
    { ALT: () => this.string(ctx) },
    { ALT: () => this.squareValue(ctx) },
    {
      /** e.g. progid:DXImageTransform.Microsoft.Blur(pixelradius=2) */
      GATE: () => this.legacyMode,
      ALT: () => this.consume(this.T.LegacyMSFilter)
    }
  ];

  this.startRule();
  let node: Node = this.or(valueAlt(ctx));
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
  this.option(() => {
    this.consume(this.T.Slash);
    additionalValue = this.value(ctx);
  });
  let location = this.endRule();
  if (!(node instanceof Node)) {
    node = this.processValueToken(node);
  }
  if (additionalValue) {
    return this.wrap(new List([this.wrap(node, true), additionalValue], { sep: '/' }, location, this.context));
  }
  return this.wrap(node);
}

export function string(this: P, ctx: RuleContext = {}, stringAlt?: AltContext) {
  stringAlt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        this.startRule();
        let quote = this.consume(this.T.SingleQuoteStart);
        let contents: IToken | undefined;
        this.option(() => contents = this.consume(this.T.SingleQuoteStringContents));
        this.consume(this.T.SingleQuoteEnd);
        let location = this.endRule();
        const escaped = quote.image.startsWith('~');
        const quoteChar = quote.image.replace(/^~/, '') as '"' | '\'';
        let value = contents?.image ?? '';
        if (escaped) {
          value = value.replace(/\\(?:\r\n?|\n|\f)/g, '\n');
        }
        return new Quoted(new Any(value, { role: 'any' }), { quote: quoteChar, escaped }, location, this.context);
      }
    },
    {
      ALT: () => {
        this.startRule();
        let quote = this.consume(this.T.DoubleQuoteStart);
        let contents: IToken | undefined;
        this.option(() => contents = this.consume(this.T.DoubleQuoteStringContents));
        this.consume(this.T.DoubleQuoteEnd);
        let location = this.endRule();
        const escaped = quote.image.startsWith('~');
        const quoteChar = quote.image.replace(/^~/, '') as '"' | '\'';
        let value = contents?.image ?? '';
        if (escaped) {
          value = value.replace(/\\(?:\r\n?|\n|\f)/g, '\n');
        }
        return new Quoted(new Any(value, { role: 'any' }), { quote: quoteChar, escaped }, location, this.context);
      }
    }
  ];

  return this.or(stringAlt(ctx));
}

/** Abstracted for easy over-ride */
// $.RULE('expression', () => {
//   $.SUBRULE($.mathSum)
// })
export function mathSum(this: P, ctx: RuleContext = {}) {
  let opAlt = [
    { ALT: () => this.consume(this.T.Plus) },
    { ALT: () => this.consume(this.T.Minus) }
  ];
  // mathSum
  //   : mathProduct (WS* ('+' | '-') WS* mathProduct)*
  //   ;
  this.startRule();

  let left: Node = this.mathProduct(ctx);

  this.many(() => {
    let op = this.or(opAlt);
    let right: Node = this.mathProduct(ctx);

    left = new Operation([left, op.image as Operator, right], { inCalc: true }, undefined, this.context);
  });
  left._location = this.endRule();
  return left;
}

// mathProduct
//   : mathValue (WS* ('*' | '/') WS* mathValue)*
//   ;
export function mathProduct(this: P, ctx: RuleContext = {}) {
  let opAlt = [
    { ALT: () => this.consume(this.T.Star) },
    { ALT: () => this.consume(this.T.Divide) }
  ];

  this.startRule();

  let left: Node = this.mathValue(ctx);

  this.many(() => {
    let op = this.or(opAlt);
    let right: Node = this.mathValue(ctx);

    left = new Operation([left, op.image as Operator, right], { inCalc: true }, undefined, this.context);
  });

  left._location = this.endRule();
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
  alt ??= (ctx: RuleContext = {}) => [
    { ALT: () => this.consume(this.T.Number) },
    { ALT: () => this.consume(this.T.Dimension) },
    // Allow identifiers like channel names in color space calcs (e.g., calc(l - 0.1))
    { ALT: () => this.consume(this.T.Ident) },
    { ALT: () => this.consume(this.T.MathConstant) },
    { ALT: () => this.knownFunctions(ctx) },
    { ALT: () => this.mathParen(ctx) }
  ];

  let node: Node = this.or(alt(ctx));
  if (!(node instanceof Node)) {
    node = this.processValueToken(node);
  }
  return this.wrap(node, 'both');
}

export function mathParen(this: P, ctx: RuleContext = {}) {
  this.startRule();
  this.consume(this.T.LParen);
  let node = this.mathSum(ctx);
  this.consume(this.T.RParen);
  let location = this.endRule();
  return new Paren(node, undefined, location, this.context);
}

// function
//   : URL_FUNCTION
//   | VAR_FUNCTION '(' WS* CUSTOM_IDENT (WS* COMMA WS* valueList)? ')'
//   | CALC_FUNCTION '(' WS* mathSum WS* ')'
//   | identifier '(' valueList ')'
//   ;
// These have special parsing rules
export function knownFunctions(this: P, ctx: RuleContext = {}, alt?: AltContext) {
  alt ??= (ctx: RuleContext = {}) => [
    { ALT: () => this.urlFunction(ctx) },
    { ALT: () => this.varFunction(ctx) },
    { ALT: () => this.calcFunction(ctx) }
  ];

  return this.or(alt(ctx));
}

export function ifFunctionArgs(this: P, ctx: RuleContext = {}) {
  this.startRule();
  let branches: Node[] = [];
  this.atLeastOneSep({
    SEP: this.T.Semi,
    DEF: () => {
      const condition = this.valueSequence({ ...ctx, inner: true });
      this.consume(this.T.Assign);
      const value = this.valueList({ ...ctx, inner: true });
      const sep = this.wrap(new Any(':', { role: 'operator' }, undefined, this.context), true);
      const loc = this.getLocationFromNodes([condition as Node, value as Node].filter(Boolean));
      branches.push(new Sequence([this.wrap(condition as Node, true), sep, this.wrap(value as Node, true)], undefined, loc, this.context));
    }
  });
  this.option(() => this.consume(this.T.Semi));
  const location = this.endRule();
  if (branches.length === 1) {
    return branches[0]!;
  }
  return new List(branches, { sep: ';' }, location, this.context);
}

export function ifFunction(this: P, ctx: RuleContext = {}) {
  this.startRule();
  const start = this.consume(this.T.FunctionStart);
  const args = this.ifFunctionArgs({ ...ctx, inner: true }) as Node;
  this.consume(this.T.RParen);
  const location = this.endRule();
  return new Call({
    name: start.image.slice(0, -1),
    args: new List([args])
  }, undefined, location, this.context);
}

export function varFunction(this: P, ctx: RuleContext = {}) {
  this.startRule();
  this.consume(this.T.Var);
  let prop = this.consume(this.T.CustomProperty);
  let args: List | undefined;
  this.option(() => {
    this.consume(this.T.Comma);
    args = this.valueList(ctx) as List;
  });
  this.consume(this.T.RParen);

  let location = this.endRule();
  let propNode = this.wrap(new Any(prop.image, { role: 'customprop' }, this.getLocationInfo(prop), this.context), 'both');
  if (!args) {
    args = new List([propNode], undefined, this.getLocationInfo(prop), this.context);
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

export function calcFunction(this: P, ctx: RuleContext = {}) {
  this.startRule();

  this.consume(this.T.Calc);
  let args = this.mathSum(ctx);
  this.consume(this.T.RParen);

  let location = this.endRule();
  return new Call({
    name: 'calc',
    args: new List([args])
  }, undefined, location, this.context);
}

export function urlFunction(this: P, ctx: RuleContext = {}, alt?: AltContext) {
  alt ??= (ctx: RuleContext = {}) => [
    { ALT: () => this.string(ctx) },
    { ALT: () => this.consume(this.T.NonQuotedUrl) }
  ];

  this.startRule();

  this.consume(this.T.UrlStart);
  let node: Any | IToken = this.or(alt(ctx));
  this.consume(this.T.UrlEnd);

  let location = this.endRule();
  if (!(node instanceof Node)) {
    /** Whitespace should be included in the NonQuotedUrl */
    node = new Any(node.image, { role: 'urlvalue' }, this.getLocationInfo(node), this.context);
  }
  return new Url(node, undefined, location, this.context);
}
